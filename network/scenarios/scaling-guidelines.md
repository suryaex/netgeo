# Scaling Guidelines — Analisis Skalabilitas Engine NetForge

**Status**: estimasi field-engineering, BELUM divalidasi benchmark langsung terhadap
`backend/engine/` (belum ada implementasi saat dokumen ditulis, 2026-06-23/24). Semua angka di
sini adalah **target & batas atas yang masuk akal** berdasarkan pengalaman operasional
container networking (FRRouting/BIRD di Docker, containerlab) dan discrete-event simulation
pada umumnya — bukan hasil profiling kode NetForge yang sebenarnya. Tim backend **wajib**
menjalankan benchmark nyata begitu engine ada, lalu mengoreksi dokumen ini.

---

## 1. Dua Mode Eksekusi — Karakteristik Berbeda Drastis

NetForge punya 2 mode per-node (§4 MASTER_SPEC `Node.mode`): `sim` (model matematis ringan)
dan `emul` (container NOS nyata via containerlab/Docker/Podman). Keduanya **tidak bisa
disamakan kapasitasnya** — gap-nya 1-2 orde magnitude.

### 1.1 Mode `sim` (discrete-event, model matematis)

- **Apa yang berjalan**: bukan OS/NOS nyata, melainkan model Python (state machine routing
  sederhana, forwarding table, link state) di dalam proses engine pusat.
- **Biaya per node**: didominasi memory untuk struktur data (RIB/FIB entry, interface state)
  + CPU untuk event processing (bukan proses OS terpisah). Estimasi realistis:
  **0.5-2 MB RAM/node** (tergantung jumlah rute & interface), CPU murni event-driven (tidak
  ada idle overhead seperti OS container).
- **Batas realistis** (single-process Python, asumsi GIL-bound untuk CPU-heavy event loop
  kecuali pakai multiprocessing/async worker pool):
  - **Demo/CI ringan**: 100-500 node, tick rate tinggi, jalan di laptop dev (8 core, 16GB RAM).
  - **Workstation dev kuat / server kecil** (16-32 core, 64GB RAM): **2.000-5.000 node**
    dengan event rate moderat (ribuan event/detik agregat).
  - **Server dedicated** (64+ core, dengan sharding — lihat §3): **10.000-50.000 node** jika
    arsitektur engine sudah event-sharded per region/cluster, BUKAN single event-loop global.
- **Bottleneck dominan**: **CPU single-thread untuk event loop** (Python GIL), bukan RAM.
  RAM untuk 5.000 node model sederhana hanya ~5-10 GB — jauh dari batas server modern. Yang
  membatasi adalah berapa event/detik yang sanggup diproses sebelum antrian event membengkak.

### 1.2 Mode `emul` (containerlab/Docker, NOS nyata: FRRouting, VyOS, dst.)

- **Apa yang berjalan**: container Linux nyata per node, menjalankan daemon routing nyata
  (FRRouting bgpd/ospfd/zebra, atau image vendor seperti VyOS/Cisco vIOS jika tersedia).
- **Biaya per node** (berdasarkan pengalaman operasional containerlab dengan FRRouting):
  - **RAM idle**: 80-150 MB per container (FRRouting minimal) hingga 512MB-1GB untuk
    image vendor lebih berat (Cisco vIOS-L2/XRv, Juniper vMX/vQFX — JAUH lebih berat,
    bisa 2-4GB/instance karena emulasi penuh termasuk virtual CPU/disk).
  - **CPU**: tiap container butuh CPU share untuk routing daemon aktif (BGP/OSPF convergence
    loop) — pada idle steady-state kecil (<5% core), tapi saat convergence event (banyak
    update sekaligus) bisa spike signifikan per container.
  - **Disk**: image dasar 150-400MB (cached, shared layer antar container jika image sama).
  - **Network namespace overhead**: tiap container = 1 network namespace + veth pair —
    di kernel Linux modern overhead ini kecil per-unit, tapi **jumlah total interface/veth**
    pada skala ribuan bisa membebani kernel networking stack itu sendiri (lihat §2).
- **Batas realistis**:
  - **Laptop dev** (8 core/16GB): **20-50 node** `emul` ringan (FRRouting), turun ke **5-10
    node** kalau pakai image vendor berat (vIOS/vMX).
  - **Server dev kuat** (32 core/128GB): **150-400 node** FRRouting-class, **30-60 node**
    vendor-image-class.
  - **Cluster container orchestration** (multi-host, Kubernetes/Swarm dengan containerlab
    multi-node, atau scale-out manual): **1.000-3.000 node** FRRouting-class — TAPI ini
    sudah masuk domain infrastruktur serius (banyak host fisik/VM besar), bukan single
    server, dan butuh networking antar-host (overlay VXLAN antar Docker host) yang
    menambah kompleksitas operasional signifikan.
- **Bottleneck dominan**: **RAM** (jumlah container × footprint masing-masing) dan
  **jumlah file descriptor/network namespace** di level kernel host — bukan CPU pada
  kondisi idle. Pada saat convergence storm (restart massal), CPU jadi bottleneck sekunder.

### 1.3 Implikasi Desain: Hybrid adalah KEHARUSAN, bukan fitur opsional

Untuk topologi 1000+ node (skenario 5), **tidak ada pilihan selain mayoritas `sim`**.
Pola realistis yang disarankan:
- **<2% node sebagai `emul`** (titik kritis yang perlu validasi behavior NOS nyata — mis.
  beberapa PE/RR di skenario BGP, beberapa leaf/spine kunci di skenario DC) — `emul` 1296
  node sepenuhnya artinya 1296 container, **bukan target yang realistis** bahkan di cluster
  multi-host kelas menengah.
- **>98% node sebagai `sim`** untuk fabric/backbone besar — sim cukup untuk menunjukkan
  perilaku agregat (load distribution, failover path, convergence time pada level topologi),
  sementara `emul` dipakai untuk memverifikasi config generator (§5 MASTER_SPEC ForgeOS)
  benar-benar valid di NOS nyata pada SAMPLE node, tidak perlu semua.

---

## 2. Bottleneck Spesifik & Cara Mengukurnya

| Bottleneck | Domain | Indikator Gejala | Cara Ukur |
|---|---|---|---|
| **Event queue growth** | `sim` CPU | Latency antara `t_simulasi` dan `t_wallclock` melebar terus | Log ukuran priority queue tiap N detik; plateau = sehat, growth linear/eksponensial = tidak sanggup keep up |
| **Python GIL contention** | `sim` CPU | CPU 1 core 100%, core lain idle, walau ada banyak event paralel secara logis | `py-spy`/profiler; pertimbangkan `multiprocessing` per-shard (lihat §3) atau rewrite hot-path ke Rust/C extension jika perlu |
| **Container RAM ceiling** | `emul` RAM | OOM-kill container acak, performa degradasi mendadak saat container count naik | `docker stats` / cgroup memory.max; set limit per container & alert di ambang 80% host RAM |
| **veth/namespace kernel overhead** | `emul` kernel | `ip link` lambat, packet loss meningkat tanpa link benar-benar bermasalah | Cek `dmesg` untuk warning kernel networking; cek jumlah network namespace aktif (`ip netns list \| wc -l`) vs limit sistem |
| **DB write amplification** | Storage (PostgreSQL) | Insert/update topologi besar (1000+ node sekali load) lambat, lock contention | `EXPLAIN ANALYZE` pada bulk insert; pertimbangkan `COPY`/batch insert, bukan row-by-row |
| **Redis state churn** | Realtime state | Redis CPU tinggi, latency WS naik saat banyak node berubah status bersamaan | `redis-cli --latency`, `INFO commandstats`; pertimbangkan batching update bukan per-event publish |
| **WS broadcast flood** | Frontend delivery | Browser tab freeze/lag pada topologi besar, walau backend sehat | Hitung message/detik per client; **WAJIB throttle/batch** (lihat README butir 3) |
| **React Flow render** | Frontend canvas | FPS canvas turun drastis di >200-300 node yang di-render sekaligus | Profiler browser; solusi: clustering/level-of-detail rendering (zoom-dependent aggregation) |

---

## 3. Strategi Sharding & Distribusi (untuk >5.000 node)

Pada skala ini, single-process engine TIDAK CUKUP. Rekomendasi arsitektur (untuk didiskusikan
dengan `backend-network-sim-architect` — ini saran lintas-area, bukan keputusan final saya):

1. **Sharding berbasis topologi, bukan hash acak.** Bagi simulasi per POD/POP/cluster
   (entitas yang secara alami punya batas trafik jelas — mis. tiap pod fat-tree skenario 5,
   tiap POP skenario 1) ke worker process/container terpisah. Event antar-shard (link yang
   menyeberangi boundary, mis. core switch yang menghubungkan semua pod) diproses lewat
   message queue (Redis pub/sub atau yang lebih robust, mis. NATS/Kafka jika skalanya
   menuntut) — **bukan shared memory langsung**, supaya shard bisa scale ke proses/host berbeda.
2. **Event timestamp global, bukan per-shard independent.** Karena ini discrete-event
   simulation, urutan waktu antar-shard tetap harus konsisten (event di shard A pada t=5.001s
   harus diproses sebelum event shard B pada t=5.002s jika keduanya saling terkait) — butuh
   **time synchronization barrier** antar worker (pola umum di distributed discrete-event
   simulation/DDES), bukan sekadar "jalankan paralel dan harap hasilnya benar".
3. **Container/emul scaling**: gunakan containerlab multi-host clustering atau migrasi ke
   Kubernetes dengan custom scheduler yang sadar topologi jaringan (taint/affinity supaya
   node yang saling terhubung erat ditempatkan di host fisik yang sama, mengurangi overhead
   tunneling antar-host untuk link virtual).
4. **Frontend**: backend menyediakan **aggregated cluster view** (lihat README butir 3),
   frontend hanya request detail node-level saat user benar-benar zoom in ke cluster
   tertentu — pola "level of detail" standar di tools visualisasi graf besar (mirip cara
   Google Maps tidak render semua jalan dunia sekaligus).

---

## 4. Spesifikasi Hardware Referensi (untuk benchmark awal tim backend)

Supaya angka di dokumen ini punya baseline yang jelas saat divalidasi ulang:

| Tier | CPU | RAM | Disk | Target skala `sim` | Target skala `emul` |
|---|---|---|---|---|---|
| Dev laptop | 8 core | 16 GB | NVMe SSD | 100-500 node | 20-50 node |
| Dev server / CI runner | 16-32 core | 64 GB | NVMe SSD | 2.000-5.000 node | 150-400 node |
| Production single-host | 64 core | 256 GB | NVMe RAID | 10.000-20.000 node (dgn sharding proses lokal) | 800-1.500 node |
| Production cluster (3+ host) | 64 core/host | 256 GB/host | NVMe RAID | 50.000+ node | 3.000+ node |

## 5. Rekomendasi Konkret ke Tim Backend (ringkasan actionable)

1. Implementasikan **benchmark harness** sejak awal (skrip yang load topologi N-node,
   ukur cold-start time, event throughput, RAM growth) — pakai `stress-test-1000-node-generator.json`
   sebagai input standar, supaya progres optimasi punya baseline terukur dari hari pertama.
2. **Jangan optimasi prematur** untuk skala >10.000 node sebelum 1.000-5.000 node sehat —
   urutan prioritas: (a) single-process sim 1000 node stabil, (b) sim 5000 node dengan
   sharding lokal (multiprocessing), (c) emul hybrid sample, (d) baru distributed cluster.
3. **WS broadcast throttling adalah prioritas tinggi**, bukan nice-to-have — ini bottleneck
   yang akan terlihat duluan di demo (UI freeze) walau backend sebenarnya sehat, dan
   memberi kesan keliru bahwa "engine lambat" padahal masalahnya di delivery layer.
4. Pertimbangkan **bahasa/komponen performa-kritis di luar Python murni** untuk hot-path
   event loop (mis. ekstensi Rust via PyO3, atau libray seperti `simpy`-style tapi
   dioptimasi) JIKA benchmark menunjukkan Python murni jadi bottleneck nyata pada skala
   target — tapi ukur dulu sebelum menulis ulang, jangan asumsi.
5. **Definisikan SLA performa internal** (mis. "topologi 1000 node harus cold-start <10s,
   convergence test harus selesai <60s wall-clock") sebagai bagian dari CI, supaya regresi
   performa terdeteksi otomatis, bukan ditemukan user di produksi.
