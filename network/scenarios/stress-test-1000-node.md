# Skenario 5 — Uji Skala 1000+ Node (Fat-Tree CLOS Sintetis)

**File pendamping:** [`stress-test-1000-node-generator.json`](./stress-test-1000-node-generator.json)
(spec generator parametrik, BUKAN dump literal — lihat alasan di README §Kebutuhan Backend
butir 6) + [`stress-test-1000-node-sample.json`](./stress-test-1000-node-sample.json) (contoh
1 pod kecil yang menunjukkan pola, untuk validasi generator).
**Skala:** parametrik. Default **1.280 node** (5 pod × 256 node/pod, fat-tree k=8 2-tier),
bisa di-scale ke **10.000+ node** dengan mengubah parameter `pod_count`/`k`.
**Mode rekomendasi:** `sim` murni untuk seluruh fabric inti. **TIDAK realistis** menjalankan
`emul` (container per node) untuk 1000+ node di laptop/server dev biasa — lihat perhitungan
RAM/CPU di `scaling-guidelines.md`. Skenario ini secara eksplisit adalah uji **engine
discrete-event**, bukan uji containerlab/Docker.

## Tujuan

Ini bukan skenario "real-world" dalam arti operasional (tidak ada satu pun perusahaan yang
men-deploy topologi sintetis fat-tree generik tanpa konteks bisnis) — tujuannya murni
**stress-test engine NetForge**: apakah discrete-event core, storage topologi (PostgreSQL),
state realtime (Redis), dan rendering frontend sanggup menangani skala ribuan node tanpa
collapse. Ini skenario WAJIB ada di test-suite backend sebelum klaim "mendukung simulasi
skala besar" di marketing/dokumentasi produk bisa dipertanggungjawabkan.

## Pola Topologi: Fat-Tree CLOS Parametrik

Memakai notasi fat-tree klasik (mirip riset DC networking — k-ary fat-tree):

```
parameter k = jumlah port per switch (genap, contoh k=8)
- core switch     : (k/2)^2        = 16 switch   (tier teratas, 1 instance global)
- aggregation     : k * k/2 / pod  = 4 switch/pod
- edge (ToR)      : k/2            = 4 switch/pod
- host per edge   : k/2            = 4 host/edge -> 16 host/pod
- pod count       : k              = 8 pod (skala penuh k=8 fat-tree klasik)

per pod: 4 agg + 4 edge + 16 host = 24 node/pod (skala klasik k=8 kecil ~209 node total)
```

Untuk mencapai **1.280 node** secara konkret (skala yang dipakai sebagai default stress-test,
lebih besar dari fat-tree klasik k=8 supaya benar-benar menguji "ribuan"), generator memakai
parameter custom (bukan rumus k murni):

```
pod_count        = 5
switch_per_pod    = (4 agg + 4 edge) = 8
host_per_pod      = 248   (host/server endpoint, mode=sim semua)
core_switch_count = 16    (global, menghubungkan seluruh pod)

total = pod_count * (switch_per_pod + host_per_pod) + core_switch_count
      = 5 * (8 + 248) + 16
      = 5 * 256 + 16
      = 1280 + 16  -- dibulatkan: 16 core dianggap bagian dari "tier 0", grand total 1.296
```

Lihat `stress-test-1000-node-generator.json` untuk definisi parameter mesin-baca lengkap.

## Mengapa JSON Literal TIDAK Dipakai untuk 1000+ Node

1. **Ukuran file**: 1.296 node × (1 Node + ~3 Interface + ~1.5 Link rata-rata) dalam JSON
   pretty-printed ≈ **2.5-3.5 MB**. Bisa diproses, tapi tidak maintainable untuk diedit manual,
   sulit di-review lewat `git diff`, dan rawan copy-paste error pada ID yang harus unik.
2. **Maintainability**: kalau parameter berubah (mis. mau coba 2000 node), regenerasi dari
   spec parametrik jauh lebih murah daripada menulis ulang/mengedit JSON literal raksasa.
3. **Selaras dengan kebutuhan engine** (README butir 6): tim backend sebaiknya menyediakan
   endpoint `POST /api/topology/generate` yang menerima spec ini langsung, dan men-generate
   Node/Interface/Link di sisi server — mengurangi payload network request secara drastis
   (mengirim ~1KB parameter vs ~3MB JSON).

**Catatan jujur**: pendekatan ini berarti file ini bersifat **spesifikasi yang harus
diimplementasikan tim backend**, bukan artefak yang "langsung jalan" hari ini. Itu trade-off
yang disengaja — menulis 1280 node literal hanya untuk "terlihat lengkap" tidak memberi nilai
nyata dan akan jadi technical debt (file besar yang tak terpelihara) sejak hari pertama.

## Profil Trafik untuk Stress-Test

- **Bukan trafik realistis** — tujuannya membebani engine, bukan mensimulasikan bisnis.
- Skenario beban: (a) **all-to-all ping sweep** (setiap host ping ke 10 host acak lain,
  menguji path computation/FIB lookup pada skala), (b) **BGP/IGP convergence storm**
  (restart 10% node serentak, ukur waktu seluruh topologi stabil kembali), (c) **event-rate
  ceiling test** (generate link flap acak pada 5% link per detik, ukur backlog event queue).

## Failure Scenario / Beban yang Harus Diukur

1. **Cold start**: load 1296 node + seluruh interface/link dari DB ke memory engine —
   ukur waktu (target awal yang masuk akal: < 10 detik; bila lebih, itu bottleneck nyata
   yang harus dilaporkan, bukan ditutup-tutupi).
2. **Steady-state tick rate**: pada discrete-event engine, ukur **event/detik** yang
   sanggup diproses tanpa antrian event membengkak tanpa batas (growing backlog = engine
   tidak sanggup keep up real-time).
3. **Topology mutation under load**: tambah/hapus 50 node saat simulasi berjalan — apakah
   engine butuh full restart/recompute, atau bisa incremental? (Incremental adalah target
   ideal; full recompute pada skala ini bisa makan banyak detik — harus diukur, bukan diasumsikan).
4. **Memory growth over time**: jalankan simulasi 30 menit wall-clock, pantau RAM — apakah
   ada leak (growth tak wajar tanpa pertambahan entity)?
5. **UI/WS broadcast saturation**: jika WS `/ws/topology` broadcast tiap perubahan status ke
   seluruh client tanpa throttle, pada 1296 node yang sering berubah status, berapa
   message/detik yang dikirim ke browser? (Ini sering jadi titik gagal tersembunyi — backend
   "kuat" tapi frontend/browser yang justru collapse karena flood pesan WS).

## Acceptance Criteria (untuk tim backend, sebagai target awal — sesuaikan setelah benchmark nyata)

- [ ] Cold start topologi 1296 node ke memory: < 10 detik pada hardware referensi (lihat
      `scaling-guidelines.md` §spesifikasi hardware referensi).
- [ ] Steady-state: sanggup proses minimal **50.000 event/detik** pada discrete-event core
      tanpa antrian event tumbuh tanpa batas (angka ini estimasi awal field-engineering,
      WAJIB divalidasi ulang dengan benchmark nyata begitu engine ada).
- [ ] WS broadcast topologi memakai throttling/batching (mis. max 10 update/detik per
      client, bukan push instan per event) — kalau belum ada, ini **Critical finding**
      untuk diteruskan ke `backend-network-sim-architect`.
- [ ] Tidak ada memory leak terdeteksi pada uji 30 menit (RAM stabil setelah warm-up).

## Catatan Lapangan

- Di operasional NOC nyata, monitoring system (mis. yang berbasis SNMP polling) untuk
  network sebesar ini **tidak polling semua node tiap detik** — mereka pakai tiered polling
  (interval lebih jarang untuk node non-kritikal, event-driven trap untuk yang kritikal).
  NetForge sebaiknya mengadopsi filosofi yang sama untuk simulasi skala besar: **tidak semua
  node perlu "hidup" pada resolusi waktu yang sama**. Host endpoint (sim) bisa di-update jarang,
  switch/router core perlu resolusi tinggi.
- "1000+ node" terdengar seperti angka marketing, tapi secara field-engineering ini **kecil**
  dibanding DC hyperscale nyata (puluhan ribu server per DC). Tujuan skenario ini adalah
  membuktikan **engine NetForge punya headroom**, bukan mengklaim sudah setara hyperscaler.
  Klaim yang jujur ke pengguna: "diuji hingga ~1300 node sintetis, performa nyata bergantung
  hardware host" — jangan over-promise di README utama produk.
