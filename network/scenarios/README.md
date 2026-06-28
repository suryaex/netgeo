# network/scenarios/ — Katalog Skenario Skala Besar NetGeo

**Pemilik area:** `network-backbone-datacenter-advisor` (lihat `MASTER_SPEC.md` §3).
**Fokus:** skenario topologi skala besar (backbone, datacenter, ISP, DCI) + analisis kemampuan
engine untuk menangani **ribuan node** secara realistis — bukan demo mainan.

Setiap skenario di sini ditulis dari sudut pandang field engineer/NOC: bukan hanya "gambar topologi",
tapi termasuk angka kapasitas link yang masuk akal, kebijakan redundansi, dan failure mode yang
nyata terjadi di lapangan. Semua topologi mengikuti **Model Data Inti §4 MASTER_SPEC.md**
(Node/Interface/Link/Scenario), diserialisasi sebagai JSON agar bisa langsung dikonsumsi
`POST /api/projects` + `/api/nodes` + `/api/links` oleh backend.

---

## Daftar Isi

| # | File | Skenario | Skala (node) | Mode rekomendasi |
|---|---|---|---|---|
| 1 | [`backbone-metro-dwdm-multipop.md`](./backbone-metro-dwdm-multipop.md) + `.json` | Backbone Metro-E/DWDM multi-POP (ISP regional) | 18 node fisik, 6 POP | `emul` (router core) / `sim` (ROADM) |
| 2 | [`dc-spine-leaf-evpn-vxlan.md`](./dc-spine-leaf-evpn-vxlan.md) + `.json` | Datacenter spine-leaf EVPN-VXLAN 3-tier | 46 node (1 DC, scalable pattern) | `emul` (leaf/spine kritikal) / `sim` (host) |
| 3 | [`isp-nasional-bgp-multias-rr.md`](./isp-nasional-bgp-multias-rr.md) + `.json` | ISP nasional multi-AS, route reflector, peering IX | 32 node, 5 AS | `emul` (PE/RR) / `sim` (CE pelanggan) |
| 4 | [`dci-multidatacenter-sr-mpls.md`](./dci-multidatacenter-sr-mpls.md) + `.json` | Interkoneksi multi-DC (DCI) via SR-MPLS/SRv6 | 24 node, 3 DC + 2 transit POP | `emul` (PE/P) |
| 5 | [`stress-test-1000-node.md`](./stress-test-1000-node.md) + [`-generator.json`](./stress-test-1000-node-generator.json) + [`-sample.json`](./stress-test-1000-node-sample.json) | Uji skala 1000+ node (fat-tree clos sintetis) | 1.296 node (parametrik, bisa di-scale ke 10k+) | `sim` murni (full emulasi tidak realistis) |
| — | [`scaling-guidelines.md`](./scaling-guidelines.md) | Analisis kapasitas engine: sim vs emul, bottleneck, sharding | — | — |
| — | [`SLA-redundancy.md`](./SLA-redundancy.md) | Pola HA: dual-homing, ECMP, FRR/BFD, simulasi failure | — | — |

Setiap skenario `.md` berisi: tujuan, topologi (deskripsi + tabel), file `.json` pendamping
(model §4), profil trafik, failure scenario yang harus bisa disimulasikan, dan acceptance
criteria (`expected_outcomes` pada objek `Scenario`).

---

## Konvensi Penamaan & ID (dipakai konsisten di semua skenario)

- **Node ID**: `{site}-{role}-{seq}` → contoh `jkt-core-01`, `sby-leaf-03`, `pop-bdg-rr-01`.
- **Site code**: ikut kode bandara/kota 3 huruf lokal (`jkt`, `sby`, `bdg`, `mdn`, `mks`, `dps`)
  agar konsisten dengan penamaan POP ISP Indonesia pada umumnya.
- **Interface name**: gaya vendor-neutral `et-{slot}/{port}` untuk eth/SFP, `gpon-{slot}/{port}`
  untuk akses OLT, sesuai field `Interface.type` pada §4.
- **AS Number**: skenario memakai blok **privat 4-byte** `4200000000–4294967294` atau 16-bit
  privat `64512–65534` agar tidak collide dengan AS publik nyata saat dipakai demo/CI.
- **IP**: blok `RFC 5737`/`RFC 3849` (TEST-NET: `192.0.2.0/24`, `198.51.100.0/24`,
  `203.0.113.0/24`; IPv6 documentation: `2001:db8::/32`) — **wajib**, supaya skenario contoh
  tidak pernah bocor ke internet nyata kalau user lalai saat emulasi dengan `mode=emul`
  (container yang ter-attach ke interface fisik).
- **Link bandwidth**: dalam **Mbps** integer (field `Link.bandwidth`), delay dalam **ms** (float),
  loss dalam **persen** (float 0–100), sesuai §4.

---

## Kebutuhan ke Tim Backend / Engine (ringkasan — detail lengkap di `scaling-guidelines.md`)

Bagian ini ditulis di README (bukan `NEEDS.md` terpisah) karena diminta eksplisit oleh tugas;
namun **lintas-area dengan `backend-network-sim-architect`** — orchestrator tolong sinkronkan.

1. **Mode hybrid per-node wajib bisa di-set massal.** Pada topologi 1000+ node, operator
   harus bisa men-tag "yang ini `emul`, sisanya `sim`" lewat **pola/regex pada Node ID atau
   tag**, bukan klik satu-satu. Usulan API: `PATCH /api/nodes/bulk` dengan filter
   `{tag: "spine"}` → `{mode: "emul"}`.
2. **Event-driven, bukan polling per-tick seragam.** Untuk simulasi BGP convergence pada
   skenario #3 (32 node) maupun #5 (1280 node), engine discrete-event harus mendukung event
   queue prioritas (bukan fixed timestep), karena BGP/IS-IS convergence time bisa berbeda
   3 orde magnitude antara physical-link-down (µs) vs path-hunting/count-to-infinity (detik–menit).
3. **Agregasi/sampling topologi untuk render UI.** Pada skenario 1000+ node, canvas
   React Flow tidak mungkin render semua node sekaligus secara performant. Engine perlu
   endpoint **cluster summary** (`GET /api/topology/clusters?zoom=N`) yang mengembalikan
   node-group teragregasi (per POD/POP) saat zoom level rendah — lihat `scaling-guidelines.md`
   §"Rendering & UI".
4. **State link harus mendukung partial-failure, bukan hanya up/down biner.** Untuk
   mensimulasikan degradasi fiber (power budget turun, BER naik tapi link belum down—lihat
   `SLA-redundancy.md`), `Link` perlu field tambahan opsional `signal_quality` (0–100) yang
   memengaruhi `loss` secara dinamis, bukan field statis.
5. **BFD timer realistis perlu dukungan sub-detik di event loop.** BFD default 50ms×3 miss
   (RFC 5880 umum di lapangan) artinya engine harus sanggup event resolution ≤10ms untuk
   skenario HA di `SLA-redundancy.md` tanpa mendegradasi throughput simulasi node lain.
6. **Import/generator skenario besar harus deklaratif-parametrik**, bukan hanya literal JSON.
   Skenario #5 disertai *spec generator* (lihat file terkait) karena 1280 node sebagai JSON
   literal sudah ~2-3 MB dan tidak maintainable—engine sebaiknya punya endpoint
   `POST /api/topology/generate` yang menerima parameter pola (`clos`, `pod_count`,
   `hosts_per_leaf`, dst) dan men-generate Node/Link di sisi server/DB, bukan dikirim dari
   client sebagai blob JSON raksasa.

## Asumsi yang Diambil (catat di sini, bukan ADR—itu milik tech-lead)

- Semua angka kapasitas (jumlah node sim vs emul, RAM per container, dst.) di
  `scaling-guidelines.md` adalah **estimasi field-engineering** berbasis pengalaman operasional
  router/switch carrier-grade dan container networking (FRRouting di Docker/containerlab),
  **bukan hasil benchmark langsung terhadap codebase NetGeo** (karena `backend/engine/`
  belum berisi implementasi saat dokumen ini ditulis — 2026-06-23). Tim backend wajib
  memvalidasi ulang dengan benchmark nyata begitu engine berjalan, dan melaporkan delta-nya.
- Topologi geografis (kota, jarak fiber) bersifat **representatif Indonesia** (Jakarta–Surabaya–
  Bandung–Medan–Makassar–Denpasar) untuk realisme, bukan data infrastruktur ISP riil tertentu.
