# SLA & Pola Redundansi — Apa yang Harus Bisa Disimulasikan NetForge

Dokumen ini mendaftar pola High Availability (HA) yang lazim di backbone/datacenter carrier-grade,
dijelaskan dari sudut pandang operasional nyata (bukan hanya teori buku), dan menyatakan
**apa yang dibutuhkan dari engine NetForge** agar pola-pola ini bisa benar-benar disimulasikan
dengan hasil yang dapat dipercaya — bukan sekadar "link merah jadi hijau lagi".

---

## 1. Dual-Homing (Server/CE ke 2 Upstream Berbeda)

**Definisi**: endpoint (server, CE router, ToR) terhubung ke **2 perangkat upstream berbeda**
secara fisik, sehingga kegagalan 1 upstream tidak memutus konektivitas.

### Varian yang harus didukung
- **Active-Active** (MLAG/MC-LAG klasik, atau EVPN Multihoming/ESI modern): kedua link
  dipakai bersamaan untuk forwarding (load-share), bukan satu standby murni.
- **Active-Standby**: 1 link primary, 1 backup idle sampai primary down (lebih sederhana,
  konvergensi lebih lambat karena perlu deteksi failure dulu sebelum switchover).
- **Asymmetric routing akibat TE** (skenario 3, AS-path prepend CORP-A): kedua link aktif tapi
  TIDAK simetris (inbound lewat 1 link, outbound bisa lewat link lain) — kasus nyata yang
  sering bikin bingung troubleshooting pemula karena traceroute forward/reverse beda jalur.

### Kebutuhan ke Engine
- Model `Link` butuh bisa diberi **role tag** (`primary`/`backup`/`active-active-member`)
  supaya engine tahu cara memperlakukan saat kalkulasi forwarding — bukan cuma "2 link ada,
  pilih salah satu secara default ECMP" jika sebenarnya yang dimaksud adalah active-standby.
- Failover time HARUS dipengaruhi oleh **mekanisme deteksi yang dipilih** (lihat §4 BFD):
  tanpa BFD, deteksi failure bergantung pada timeout link-layer atau keepalive protokol
  (detik-puluhan detik); dengan BFD, sub-detik. Engine **tidak boleh** mengasumsikan
  failover selalu instan — itu memberi ekspektasi keliru ke pengguna yang belajar dari simulasi.

### Acceptance Criteria
- [ ] Simulasi dual-homing active-active: saat 1 link diputus, sisa trafik di link lainnya
      naik proporsional (tidak ada packet loss permanen untuk flow yang sebelumnya tidak
      lewat link yang putus).
- [ ] Simulasi active-standby: ada periode "deteksi failure" yang terukur sebelum switchover,
      bukan transisi instan.

---

## 2. ECMP (Equal-Cost Multi-Path)

**Definisi**: ketika ada beberapa jalur dengan cost/metric sama, trafik didistribusikan
(biasanya via hashing 5-tuple: src-ip, dst-ip, src-port, dst-port, protocol) ke semua jalur,
bukan hanya satu yang "menang".

### Realitas Lapangan yang Sering Diabaikan
- **ECMP itu per-FLOW, bukan per-PACKET.** Packet dalam 1 flow (5-tuple sama) harus selalu
  lewat path yang sama (untuk hindari out-of-order delivery/reordering yang merusak performa
  TCP) — ini berarti distribusi trafik **tidak akan pernah perfectly even** kecuali jumlah
  flow sangat banyak dan acak (hukum bilangan besar). Simulasi yang menunjukkan distribusi
  ECMP 100% rata di semua kondisi adalah **tidak realistis** dan harus dikoreksi.
- **Polarization**: pada topologi multi-tier (spine-leaf bertingkat), hashing yang naif di
  setiap tier bisa menyebabkan beberapa path tidak pernah terpakai sama sekali (efek
  "polarisasi" — semua flow yang lolos hash tier-1 tertentu kebetulan jatuh ke hash yang sama
  di tier-2). Vendor nyata mengatasi ini dengan seed hash yang berbeda per-tier/per-device.
  **NetForge sebaiknya memodelkan risiko ini**, bukan asumsi ECMP selalu sempurna.
- **Resilient hashing** (modern, mis. Broadcom resilient ECMP): saat 1 path hilang, HANYA
  flow yang sebelumnya lewat path itu yang di-reshuffle — flow lain TIDAK terganggu. Hashing
  klasik (non-resilient) bisa reshuffle SEMUA flow saat 1 path berubah (member count ECMP
  group berubah → hash modulo berubah → flow lain yang tadinya stabil pun ikut pindah jalur,
  menyebabkan micro-burst reordering yang tidak perlu). Ini **detail penting** yang
  membedakan kualitas implementasi ECMP — lihat skenario 2 §Failure Scenario poin 2.

### Kebutuhan ke Engine
- Field `Link` (atau objek baru ECMP-group) perlu mendukung **simulasi hashing 5-tuple**
  (bukan random load-balance sederhana), supaya hasil simulasi mencerminkan flow-affinity
  nyata.
- Engine sebaiknya punya **mode konfigurasi**: `ecmp_hash_mode: classic | resilient` agar
  tim dev bisa membandingkan dampaknya — fitur edukasi berharga untuk pengguna yang belajar.

### Acceptance Criteria
- [ ] Distribusi flow ECMP terukur dengan deviasi wajar (bukan 100% rata, bukan 100%
      condong ke 1 path — target deviasi <15-20% antar path pada jumlah flow besar/random).
- [ ] Mode `resilient` terbukti tidak mengganggu flow lain saat 1 member ECMP group hilang;
      mode `classic` terbukti MEMANG mengganggu (validasi bahwa simulasi merefleksikan
      perbedaan nyata, bukan hanya cosmetic toggle).

---

## 3. FRR (Fast ReRoute) — IP/MPLS Fast Reroute, TI-LFA

**Definisi**: mekanisme reroute otomatis ke jalur backup **tanpa menunggu** full
control-plane reconverge (SPF recompute IGP, dst). Backup path **sudah dihitung di muka**
(pre-computed), tinggal diaktifkan saat failure terdeteksi.

### Jenis yang Relevan
- **TI-LFA (Topology Independent Loop-Free Alternate)**: standar modern untuk SR-MPLS/SRv6
  (dipakai di skenario 4 DCI) — backup path dijamin loop-free secara matematis, dihitung
  dari SPF backward+forward tanpa perlu signaling RSVP-TE penuh.
- **MPLS Fast Reroute (klasik, RSVP-TE based)**: lebih tua, butuh signaling penuh untuk
  backup tunnel, lebih kompleks operasionalnya dibanding TI-LFA tapi masih banyak dipakai
  di jaringan legacy.
- **Optical-layer protection** (1+1 OLP, ring protection — skenario 1 backbone DWDM):
  **terpisah** dari FRR L3. Failover optik <50ms umumnya tidak butuh trigger dari L3 sama
  sekali — ini domain failover sendiri yang harus dimodelkan independen (lihat skenario 1
  catatan lapangan).

### Target Waktu Failover (rule of thumb industri, untuk acceptance criteria)
| Mekanisme | Target Waktu | Catatan |
|---|---|---|
| Optical 1+1/OLP | < 50 ms | Layer fisik, tidak melibatkan routing protocol |
| TI-LFA / SR fast-reroute | < 50 ms | Pre-computed, trigger dari local link-down/BFD |
| MPLS FRR (RSVP-TE) | 50-200 ms | Sedikit lebih lambat karena kompleksitas signaling |
| IGP (IS-IS/OSPF) tanpa FRR, dengan BFD | 1-5 detik | Tergantung SPF compute time & jumlah prefix |
| IGP tanpa FRR, tanpa BFD (keepalive default) | 10-40 detik | Bergantung hello/dead timer default vendor |
| BGP convergence (tanpa BFD) | 30 detik - beberapa menit | Hold-timer default 180s, plus path-hunting |
| BGP dengan BFD | 1-5 detik | BFD mempercepat deteksi, tapi BGP best-path re-selection tetap perlu waktu |

### Kebutuhan ke Engine
- Engine **wajib bisa mensimulasikan dua kondisi berdampingan** (dengan FRR vs tanpa FRR)
  pada topologi yang SAMA, supaya tim dev/pengguna bisa melihat langsung gap performanya —
  ini value proposition edukasi terbesar dari fitur simulasi failure di NetForge.
- Backup path FRR harus **pre-computed sebelum failure terjadi** dalam model engine (state
  "siap pakai"), bukan dihitung on-the-fly saat failure — supaya waktu failover yang
  disimulasikan benar-benar mendekati realita (real FRR TIDAK menghitung saat failure,
  itulah yang membuatnya cepat).

---

## 4. BFD (Bidirectional Forwarding Detection)

**Definisi**: protokol deteksi link/neighbor failure yang sangat cepat (sub-detik),
berjalan independen dari routing protocol, dipakai untuk MEMICU FRR/reroute lebih cepat
daripada menunggu timer native routing protocol.

### Parameter Realistis (lazim di lapangan)
- **Interval default umum**: 50ms × 3 missed packet = **150ms deteksi** (agresif, dipakai di
  backbone core/DCI kritikal). Beberapa deployment lebih konservatif: 300ms × 3 = 900ms.
- **BFD echo mode vs async mode**: echo mode membebani CPU lebih sedikit (paket echo
  diproses di data-plane/forwarding silicon, tidak naik ke CPU control-plane) — relevan
  untuk skala besar (ribuan sesi BFD bisa membebani CPU control-plane kalau semua async).
- **Multihop BFD** (untuk eBGP multihop, mis. PE-edge ke upstream lewat beberapa hop):
  timer biasanya lebih konservatif (detik, bukan ms) karena jalur lebih panjang/tidak
  langsung, RFC 5883.

### Kebutuhan ke Engine
- Resolusi event loop **harus mendukung sub-10ms** untuk mensimulasikan BFD 50ms×3 secara
  meaningful (lihat README Kebutuhan Backend butir 5 dan `scaling-guidelines.md`). Kalau
  event resolution engine cuma granularity 100ms-1s, simulasi BFD jadi tidak bermakna
  (selalu "instan" relatif terhadap resolusi).
- BFD session harus dimodelkan **per link**, bisa independent down/up dari link state fisik
  murni (mis. BFD bisa "flap" karena CPU overload di node, bukan karena fisik link benar-benar
  putus — kasus nyata: BFD false-positive akibat router CPU spike, sering jadi sumber insiden
  "kok failover padahal link-nya fine?").

### Acceptance Criteria
- [ ] BFD dengan timer 150ms terbukti memicu failover dalam window waktu yang konsisten
      (150-300ms), bukan instan dan bukan menyamai timer IGP/BGP native.
- [ ] Skenario BFD false-positive (CPU overload tanpa link fisik down) dapat dimodelkan
      sebagai kasus uji terpisah dari "link benar-benar putus".

---

## 5. Redundansi Level Lain yang Wajib Tercakup (ringkasan, detail di tiap skenario)

| Pola | Domain | Lihat Skenario | Catatan Singkat |
|---|---|---|---|
| N+1 router redundancy (POP hub) | Backbone | Skenario 1 | 2 core router di POP kritikal, bukan cuma 1 |
| Dual-ring DWDM diverse routing | Transport fisik | Skenario 1 | WAJIB jalur fisik berbeda, bukan cuma logical diverse |
| Route Reflector redundant (2x RR, cluster-id sama) | BGP control-plane | Skenario 3 | Cluster-id SAMA, bukan beda (lihat catatan lapangan skenario 3) |
| Multihomed upstream (2 Tier-1 berbeda) | ISP edge | Skenario 3 | Hindari single transit SPOF |
| EVPN Multihoming (ESI) | DC fabric | Skenario 2 | Standards-based, lebih baik dari vendor-proprietary MC-LAG |
| PE-DCI redundant per DC | DCI | Skenario 4 | **GAP yang disengaja** di skenario 4 default — harus di-flag validator |
| VRRP/HSRP (gateway redundancy L2/L3 edge) | Akses/edge | *(belum ada skenario khusus — catat sebagai gap)* | Perlu skenario tambahan jika dibutuhkan tim lain |

## 6. Gap yang Diketahui & Perlu Didiskusikan Lintas-Tim

- **VRRP/HSRP** (first-hop gateway redundancy) belum punya skenario dedicated di area ini —
  ini lebih relevan ke skenario enterprise/campus (kemungkinan domain `network-engineer`).
  Dicatat di sini agar tidak hilang, orchestrator tolong sinkronkan kalau ada tumpang tindih.
- **Graceful Restart / NSF (Non-Stop Forwarding)** saat software upgrade router (data-plane
  tetap forward walau control-plane restart) belum dimodelkan di skenario manapun — ini
  pola HA penting untuk maintenance window tanpa downtime, layak jadi skenario tambahan
  di masa depan jika ada kapasitas.
- Semua **angka target waktu failover** di §3 adalah rule-of-thumb industri umum, BUKAN
  janji SLA kontraktual nyata — kalau NetForge nanti dipakai untuk semacam SLA compliance
  testing produk asli, angka ini harus disesuaikan dengan kontrak SLA spesifik yang relevan.
