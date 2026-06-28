# NetGeo — Desain Pemakaian Redis

Redis adalah lapisan **state realtime + message bus + job queue** NetGeo,
mendampingi PostgreSQL (sumber-kebenaran persisten). MASTER_SPEC §2 menetapkan
Redis untuk *state realtime* dan *job queue*.

> Catatan status: backend WebSocket saat ini **in-process** (fan-out di satu
> proses Uvicorn). Dokumen ini adalah **target produksi**: begitu backend
> di-scale ke banyak worker/replica, Redis Pub/Sub menjadi tulang punggung
> fan-out lintas-proses. Pola di sini dirancang agar transisi mulus tanpa
> mengubah kontrak WS ke frontend.

## Mengapa Redis (bukan hanya Postgres)

| Kebutuhan | Kenapa Redis |
|---|---|
| State live node/link (status, util, telemetry) | Berubah per-detik; menulis tiap tick ke Postgres = beban tulis masif & churn WAL. Redis in-memory + TTL pas. |
| Fan-out WS ke banyak client/replica | Pub/Sub mengirim event ke semua subscriber lintas proses tanpa polling DB. |
| Antrian job simulasi/emulasi | Stream + consumer group memberi at-least-once delivery, retry, dan backpressure. |
| Lock & idempotensi | `SET NX PX` untuk lock per-project saat mutasi topologi / start sim. |

Postgres tetap menyimpan kebenaran final (hasil run, config artifact, topologi).
Redis menyimpan yang *ephemeral & hot*.

---

## 1. State realtime node & link

Disimpan sebagai **Hash** per-entity, dengan TTL sebagai heartbeat (entity yang
enginenya berhenti melapor akan expire → dianggap stale).

### Skema key

```
nf:rt:node:{project_id}:{node_id}     HASH   TTL 30s
  status        running|booting|degraded|error|stopped
  cpu           0..100         (emulasi)
  mem_mb        int
  last_seen     epoch_ms
  uptime_s      int

nf:rt:link:{project_id}:{link_id}     HASH   TTL 30s
  state         up|down
  util_tx_pct   0..100
  util_rx_pct   0..100
  drops         int
  delay_ms      float          (terukur, vs nominal di Postgres)

nf:rt:project:{project_id}:nodes      SET           # indeks node aktif
nf:rt:project:{project_id}:links      SET           # indeks link aktif
```

Pola `nf:` prefix konsisten + `rt:` (realtime). Memudahkan `SCAN` dan housekeeping.

### Alur tulis (engine → Redis)

```
HSET   nf:rt:node:{pid}:{nid} status running cpu 12 last_seen <ms>
EXPIRE nf:rt:node:{pid}:{nid} 30
SADD   nf:rt:project:{pid}:nodes {nid}
PUBLISH nf:ev:topology:{pid} '{"t":"node","id":"...","status":"running",...}'
```

Pakai **pipeline** untuk batch update ribuan node per tick (target SIM_MAX_NODES=5000).

### Alur baca (backend → frontend)

- Bootstrap WS `/ws/topology`: backend `HGETALL` semua node/link aktif project →
  kirim snapshot awal.
- Update berikutnya datang lewat Pub/Sub (bagian 2), bukan polling.

---

## 2. Pub/Sub untuk fan-out WebSocket

Setiap perubahan realtime di-`PUBLISH` ke channel per-project / per-node. Tiap
proses backend yang punya client WS aktif men-`SUBSCRIBE` channel terkait dan
mem-forward pesan ke socket lokalnya. Inilah yang membuat WS bekerja walau ada
banyak replica backend di belakang load balancer.

### Channel

```
nf:ev:topology:{project_id}        # status node/link, perubahan graph  -> /ws/topology
nf:ev:console:{node_id}            # stream output console node          -> /ws/console/{node_id}
nf:ev:sim:{project_id}             # progress/metrik simulation run
nf:ev:notify:{user_id}             # notifikasi level user (job selesai, dll)
```

### Format pesan (JSON)

```json
{ "v": 1, "t": "node|link|console|sim|notify",
  "id": "<entity-id>", "ts": 1719200000123, "data": { ... } }
```

`v` = versi skema event (forward-compat). Frontend men-switch pada `t`.

### Diagram fan-out (as-text)

```
            ┌── engine/worker ──┐
            │ HSET + PUBLISH     │
            └─────────┬──────────┘
                      │  PUBLISH nf:ev:topology:{pid}
                      ▼
                 ┌─────────┐
                 │  REDIS  │  (pub/sub broker)
                 └────┬────┘
        SUBSCRIBE     │ SUBSCRIBE      SUBSCRIBE
        ┌─────────────┼─────────────────┐
        ▼             ▼                 ▼
   backend#1     backend#2          backend#3
   (WS clients)  (WS clients)       (WS clients)
        │             │                 │
     browsers      browsers          browsers
```

> Catatan: Redis Pub/Sub bersifat fire-and-forget (tanpa replay). Untuk event
> yang TIDAK boleh hilang (mis. hasil job), pakai **Streams** (bagian 3), bukan
> Pub/Sub. Pub/Sub khusus telemetry live yang boleh "drop frame".

---

## 3. Job queue simulasi & emulasi (Redis Streams)

Endpoint `POST /api/simulate` membuat `simulation_run` (status `queued` di
Postgres) lalu mendorong job ke **Redis Stream**. Worker engine mengonsumsi via
**consumer group** (at-least-once, ada `XACK`, retry, dan claim job mati).

### Key & grup

```
nf:q:sim                 STREAM            # antrian job simulasi
  group: sim-workers     (XGROUP CREATE)   # consumer group worker engine

nf:q:emul                STREAM            # antrian build/boot containerlab (mode emul)
  group: emul-workers
```

### Enqueue (backend)

```
XADD nf:q:sim '*' run_id <uuid> project_id <uuid> scenario_id <uuid> \
              mode sim seed 0 enqueued_at <ms>
```

### Konsumsi (worker)

```
XREADGROUP GROUP sim-workers worker-1 COUNT 1 BLOCK 5000 STREAMS nf:q:sim >
# ... jalankan simulasi, PUBLISH progress ke nf:ev:sim:{pid} ...
XACK nf:q:sim sim-workers <message-id>
```

### Reliability

- **Pending entries**: job yang diambil tapi tak di-`XACK` (worker crash)
  terlihat di `XPENDING`; job lain bisa `XCLAIM` setelah idle threshold.
- **Idempotensi**: worker cek status `simulation_run` di Postgres sebelum mulai
  (skip bila sudah `done`) → aman untuk redelivery at-least-once.
- **Backpressure**: batasi panjang stream dengan `XADD ... MAXLEN ~ 10000`.

### Sinkronisasi status (kebenaran final ke Postgres)

```
queued   -> Redis Stream + simulation_run.status='queued'
running  -> worker UPDATE simulation_run SET status='running', started_at=now()
            + PUBLISH progress nf:ev:sim:{pid}
done     -> UPDATE status='done', finished_at, result=<jsonb>  (Postgres = truth)
failed   -> UPDATE status='failed', result.error
```

State live (progress %) di Redis; hasil final & audit di Postgres
(`simulation_run`, lihat `db/schema.sql`).

---

## 4. Lock & koordinasi

```
nf:lock:project:{project_id}        SET NX PX 10000   # mutasi topologi atomik
nf:lock:sim:{project_id}            SET NX PX 30000   # cegah dua sim paralel/project
nf:seq:project:{project_id}:ver     INCR              # bantu optimistic version bump
```

Lock pakai pola `SET key <token> NX PX <ms>`; lepas via skrip Lua compare-and-del
agar tak melepas lock milik proses lain.

---

## 5. Konfigurasi & operasional

- **Persistence**: AOF `appendonly yes` + `appendfsync everysec`. State realtime
  boleh hilang saat restart (engine akan mengisi ulang), tetapi Streams job
  sebaiknya bertahan agar job antri tak lenyap.
- **Memory policy**: `maxmemory-policy noeviction` untuk instance yang memegang
  Streams (jangan evict job!). Jika ingin memisah, pakai **dua logical DB** atau
  dua instance: satu untuk cache/state (boleh `allkeys-lru`), satu untuk
  queue/streams (`noeviction`). Awal cukup satu instance + `noeviction`.
- **Database index**: `REDIS_URL=redis://redis:6379/0` (DB 0). Pisahkan namespace
  via prefix `nf:` daripada banyak logical DB (lebih ramah cluster).
- **Sizing awal**: 5000 node × ~200 byte hash ≈ < 5 MB state + overhead → instance
  256–512 MB cukup untuk dev/early prod.

## 6. Ringkasan key-space

| Prefix | Tipe | Isi | TTL/retensi |
|---|---|---|---|
| `nf:rt:node:*` | Hash | status & metrik node live | 30s heartbeat |
| `nf:rt:link:*` | Hash | status & util link live | 30s heartbeat |
| `nf:rt:project:*:nodes/links` | Set | indeks entity aktif | mengikuti project |
| `nf:ev:topology|console|sim|notify:*` | Pub/Sub | event fan-out WS | ephemeral |
| `nf:q:sim`, `nf:q:emul` | Stream | job queue | MAXLEN ~10000 |
| `nf:lock:*` | String (NX PX) | distributed lock | 10–30s |
| `nf:seq:*` | String (INCR) | counter versi | persisten |
