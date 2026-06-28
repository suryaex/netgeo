# Skenario 4 — Interkoneksi Multi-Datacenter (DCI) via SR-MPLS/SRv6

**File topologi:** [`dci-multidatacenter-sr-mpls.json`](./dci-multidatacenter-sr-mpls.json)
**Skala:** 24 node — 3 DC (border-leaf masing-masing) + 2 transit POP (P-router) + 1 controller
SR-PCE (path computation element, opsional/sim).
**Mode rekomendasi:** `emul` untuk PE/P router (segment routing real butuh kontrol-plane
IS-IS-SR/OSPF-SR yang akurat), `sim` untuk controller SR-PCE (cukup model algoritma TE, tidak
perlu full stack).

## Tujuan

Menghubungkan 3 datacenter (bisa berasal dari skenario 2, masing-masing punya border-leaf)
lewat backbone **SR-MPLS** (Segment Routing berbasis MPLS, bukan SRv6 native — pilihan paling
umum di deployment carrier saat ini karena interop hardware lebih luas) untuk **DCI** (DataCenter
Interconnect): L2 stretch (EVPN VPWS/VPLS antar DC) dan L3 VPN (untuk DR/replication trafik).
Skenario ini adalah "lapisan penghubung" antara skenario 1 (backbone fisik) dan skenario 2
(fabric DC) — secara konsep, border-leaf DC adalah customer-facing PE dari sudut pandang DCI ini.

## Topologi (ringkasan naratif)

```
   DC-1 (jkt)                DC-2 (sby)                 DC-3 (bdg)
  border-leaf-a1            border-leaf-b1              border-leaf-c1
       │                         │                            │
       │ access link             │ access link                │ access link
       │                         │                            │
   PE-DCI-01 ──── P-TRANSIT-01 ──┼──── P-TRANSIT-02 ──── PE-DCI-02
   (jkt-pop)        (jkt-bdg)    │       (sby-bdg)         (bdg-pop)
       │                         │                            │
       └─────────────────────────┴────────────────────────────┘
              SR-MPLS underlay (IS-IS-SR, SRGB 16000-23999)
                     │
              SR-PCE Controller (opsional, untuk TE explicit-path)
```

- **PE-DCI**: router edge yang menghadap ke border-leaf tiap DC, menjalankan EVPN
  (untuk L2 DCI stretch) dan/atau L3VPN MPLS klasik (untuk trafik routed antar-DC, mis. DR
  replication database).
- **P-router (transit)**: murni label-switching, tidak punya customer-facing service, hanya
  forwarding berdasarkan SID (segment ID) dari SR-MPLS.
- **Segment Routing**: setiap node punya **Node-SID** unik dari SRGB global block
  (16000-23999, label range umum dipakai). Explicit path (TE) dibuat dengan **SID-list**,
  mis. paksa trafik DC-1→DC-3 lewat P-TRANSIT-01 saja (menghindari P-TRANSIT-02 yang sedang
  dipakai untuk trafik prioritas lain) — ini keunggulan utama SR dibanding RSVP-TE klasik:
  tidak perlu signaling per-hop, cukup encode list SID di header packet.
- **L2 DCI (EVPN VPWS)**: untuk stretch VLAN/subnet yang sama antar DC (mis. live migration
  VM antar-DC, butuh L2 adjacency) — **harus dipakai dengan hati-hati**, L2 stretch antar DC
  jauh menambah blast radius failure domain (broadcast storm di satu DC bisa merambat ke DC
  lain jika tidak ada storm-control/BPDU filtering yang benar).
- **L3 DCI (L3VPN/VRF)**: untuk trafik routed normal antar DC (replication terstruktur,
  API call antar microservice multi-region) — domain failure lebih terisolasi, **direkomendasikan
  sebagai default** kecuali ada kebutuhan eksplisit L2 stretch.

## Profil Trafik

- DR/replication database: trafik terus-menerus (steady-state) 5-15 Gbps per pasangan DC,
  **sangat sensitif latency & jitter** untuk replication synchronous (mis. PostgreSQL sync
  replication akan stall jika RTT antar DC > beberapa puluh ms — pertimbangan **jarak fisik
  DC** sangat menentukan apakah sync replication feasible; async lebih toleran).
- Live-migration VM (kalau L2 DCI dipakai): burst tinggi (line-rate sesaat) durasi singkat,
  sangat sensitif terhadap packet loss (migration bisa gagal/retry jika loss tinggi).
- Trafik backup/snapshot: bulk, toleran latency, cocok di-throttle/diprioritaskan rendah
  (QoS class "best-effort/scavenger") supaya tidak mengganggu replication sinkron.

## Failure Scenario yang Harus Bisa Disimulasikan

1. **P-TRANSIT-01 down** → SR-TE path yang eksplisit lewat node itu harus **otomatis
   gagal over** ke SID-list alternatif (lewat P-TRANSIT-02) jika fitur TI-LFA (Topology
   Independent LFA — fast-reroute native SR) aktif; tanpa TI-LFA, harus menunggu IGP-SR
   reconverge penuh. Ini titik uji paling penting skenario DCI.
2. **PE-DCI-01 down (total)** → DC-1 kehilangan konektivitas DCI sepenuhnya jika hanya
   1 PE-DCI per DC (**ini SPOF yang harus di-flag** — desain produksi nyata butuh PE-DCI
   redundant per DC, skenario default ini sengaja dibuat minimal untuk highlight risiko,
   lihat `SLA-redundancy.md`).
3. **Replication link latency naik tiba-tiba** (mis. reroute lewat path lebih jauh karena
   failure di atas) → harus terdeteksi sebagai potential application-level impact
   (sync replication stall), bukan cuma "link masih up".
4. **L2 DCI broadcast storm dari salah satu DC** → uji apakah storm-control/rate-limit di
   PE-DCI mencegah storm itu merambat ke DC lain (jika dimodelkan), atau confirm bahwa
   tanpa mitigasi, dampaknya benar-benar menyebar (mengajarkan risiko L2 stretch).

## Acceptance Criteria

- [ ] TI-LFA failover saat P-TRANSIT-01 down: < 50ms (jika diaktifkan); tanpa TI-LFA,
      dicatat waktu IGP-SR full reconverge sebagai pembanding.
- [ ] SID-list TE eksplisit tetap dihormati (trafik tidak "bocor" ke ECMP default) selama
      path yang di-spesifikasikan masih valid.
- [ ] Latency antar-DC dilaporkan ke layer aplikasi/metric sehingga simulasi dapat
      menandai risiko stall replication sinkron saat RTT melewati threshold (mis. >20ms).
- [ ] PE-DCI tunggal per DC ditandai sebagai "redundancy gap" oleh validator topologi
      (lihat `SLA-redundancy.md` §Dual-homing).

## Catatan Lapangan

- **SR-MPLS vs SRv6**: SR-MPLS lebih matang untuk interop hardware existing (kebanyakan
  router carrier sudah dukung MPLS label switching dasar selama puluhan tahun), SRv6 lebih
  "future" tapi butuh dukungan native IPv6 extension header di seluruh path — untuk skenario
  DCI yang harus jalan di hardware campuran/legacy, **SR-MPLS adalah pilihan default yang lebih
  aman**, SRv6 dicatat sebagai opsi lanjutan di roadmap ForgeOS.
- **Latency DC-to-DC adalah constraint fisik yang tidak bisa "dioptimasi software".** Field
  engineer sering ditekan untuk "percepat replication", tapi kalau jarak DC-1 ke DC-3 adalah
  150km, RTT minimum murni propagasi cahaya dalam fiber sudah ~1.5ms one-way (~3ms RTT)
  ditambah overhead OEO/router setiap hop — ini hukum fisika, bukan bug. NetGeo sebaiknya
  menampilkan **RTT teoretis minimum berbasis jarak** di UI supaya user tidak salah ekspektasi.
