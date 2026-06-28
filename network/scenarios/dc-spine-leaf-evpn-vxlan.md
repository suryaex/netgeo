# Skenario 2 — Datacenter Spine-Leaf EVPN-VXLAN (3-Tier)

**File topologi:** [`dc-spine-leaf-evpn-vxlan.json`](./dc-spine-leaf-evpn-vxlan.json)
**Skala:** 1 DC, 3-tier Clos: 4 super-spine + 8 spine + 16 leaf + 16 host/ToR-attached server
= **44 node infrastruktur** + 2 border-leaf (DCI/eksternal) = **46 node**. Pola ini
**parametrik** — bisa di-scale ke pod tambahan tanpa ubah struktur (lihat §"Cara Scale").
**Mode rekomendasi:** `emul` untuk leaf+spine (BGP EVPN real perlu FRRouting/cumulus aktual),
`sim` untuk host/server endpoint (cukup generate trafik, tidak perlu OS penuh).

## Tujuan

Model datacenter fabric modern: underlay CLOS (BGP unnumbered/eBGP per-link, ECMP) +
overlay EVPN-VXLAN untuk multi-tenancy L2/L3 di atas fabric L3-only. Ini skenario paling
representatif untuk cloud DC dan jadi rujukan utama tim dev untuk fitur VPC/tenant isolation.

## Topologi (ringkasan naratif)

```
              ┌────────────────────────────────────────┐
              │      SUPER-SPINE (4x, untuk multi-pod)   │
              │   ss-01   ss-02   ss-03   ss-04          │
              └──┬────┬─────┬────┬─────┬────┬─────┬────┘
                 │    │     │    │     │    │     │
        ┌────────┴────┴┐ ┌──┴────┴┐ ┌──┴────┴┐  (POD-1, POD-2, ... tiap pod identik)
        │  SPINE POD-1   │ │ SPINE POD-2│ ...
        │ sp-01  sp-02   │ │ sp-03  sp-04│
        └──┬──┬──┬──┬───┘ └────────────┘
           │  │  │  │
      ┌────┴┐┌┴──┴┐┌┴────┐┌─────┐   (tiap pod: 8 leaf, oversubscription 3:1 leaf-uplink)
      │leaf01││leaf02││leaf03││...│
      └──┬───┘└──┬───┘└──┬───┘
         │       │       │
     [server/VM] [server/VM] [server/VM]   (dual-homed ke 2 leaf via MLAG/EVPN multihoming)
```

- **Underlay**: eBGP per-link, setiap leaf punya AS unik (`65100x`), spine `65200x`,
  super-spine `65300x` — model "BGP everywhere" ala Facebook/Arista fabric.
  ECMP wajib aktif (`maximum-paths 8` setara) di semua hop.
- **Overlay**: EVPN Type-2 (MAC/IP route) untuk L2 stretch antar rack dalam VNI yang sama,
  Type-5 (IP prefix route) untuk inter-subnet routing antar tenant VRF. VTEP berada di leaf
  (tidak di spine — spine murni underlay routing, prinsip standar EVPN-VXLAN fabric).
- **VNI scheme**: VNI = `10000 + (tenant_id * 100) + vlan_id`, mis. tenant 3 VLAN 20 → VNI 10320.
  Border-leaf memegang VRF-lite/VRF-per-tenant untuk keluar ke DCI/internet (lihat skenario 4).
- **Oversubscription**: leaf 48x25G downlink ke server, 6x100G uplink ke spine →
  rasio (48×25)/(6×100) = **2:1**, lazim untuk DC umum (bukan AI/ML fabric yang butuh 1:1).
- **Dual-homing server**: tiap server/ToR terhubung ke **2 leaf berbeda** via EVPN multihoming
  (ESI — Ethernet Segment Identifier) setara MC-LAG tapi standards-based, bukan vendor proprietary.

## Profil Trafik

- **East-west dominan** (~80% trafik DC modern adalah server-to-server, bukan north-south),
  jadi simulasi harus fokus uji **ECMP load-balancing quality** (hashing 5-tuple) antar
  jalur leaf-spine-leaf, bukan cuma uji north-south ke internet.
- Microburst: trafik storage replication/East-West backup bisa burst ke line-rate 25G
  sebentar (<100ms) — relevan untuk uji buffer/queue drop di model link `loss` dinamis.

## Failure Scenario yang Harus Bisa Disimulasikan

1. **Single leaf failure** → server yang dual-homed harus tetap reachable lewat leaf
   pasangannya tanpa downtime (failover ESI/MLAG idealnya sub-detik, bergantung BFD).
2. **Single spine failure** → ECMP otomatis exclude spine itu, **tidak butuh perubahan
   konfigurasi**, hanya pengurangan path count. Uji bahwa engine memodelkan ECMP re-hash
   tanpa drop total (hanya flow yang sebelumnya lewat spine itu yang re-hash, prinsip
   "resilient hashing" — kalau engine reshuffle SEMUA flow saat satu path hilang, itu
   tidak realistis dan harus dicatat sebagai gap).
3. **Border-leaf failure** (kedua-duanya, simulasi total DC isolation dari luar) → fabric
   internal tetap fungsional (intra-DC tidak terganggu), hanya konektivitas eksternal hilang.
4. **BGP underlay flapping** (link flap cepat, mis. optic marginal) → uji **BGP dampening**
   /route-flap suppression; tanpa ini, flapping satu link bisa memicu reconvergence storm
   di seluruh fabric (CPU control-plane spike) — kuirk nyata yang sering terjadi di lapangan.
5. **VTEP/VNI misconfiguration** (salah VNI di satu leaf) → harus terdeteksi sebagai
   "tenant traffic leak" potensial, bukan cuma "link down" — ini kasus keamanan, bukan
   hanya keandalan.

## Cara Scale (pola untuk tim backend)

Pod tambahan = ulangi blok `spine pod-N + 8 leaf + N server` dan tambahkan link ke
super-spine yang sama. Dengan pola ini:
- 1 pod (skenario ini) = 46 node.
- 4 pod = ~150 node.
- 16 pod (DC besar) = ~550 node — masih dalam batas `emul` parsial yang wajar
  (lihat `scaling-guidelines.md` untuk batas RAM/CPU).

## Acceptance Criteria

- [ ] ECMP membagi trafik ke seluruh spine yang available dengan deviasi < 15% per path
      (indikasi hashing sehat, bukan polarized ke 1-2 path saja).
- [ ] Failover leaf tunggal: zero packet loss permanen untuk server dual-homed (transient
      loss < 1 detik dapat diterima, sesuai BFD timer).
- [ ] EVPN Type-2/Type-5 route propagasi ke seluruh leaf dalam < 2 detik setelah host baru
      muncul (MAC/IP learning via BGP, bukan flood-and-learn klasik).
- [ ] Tenant isolation: tenant A tidak bisa melihat/forward trafik ke VNI tenant B kecuali
      ada route-target export/import yang eksplisit (uji kebocoran VRF).

## Catatan Lapangan

- **Server dual-homed yang "asymmetric"** (satu NIC down, tapi LACP/ESI tidak terdeteksi
  karena salah konfigurasi suspend-individual) adalah penyebab insiden silent packet-loss
  paling sering di operasional DC nyata — worth dimodelkan sebagai failure mode khusus.
- Oversubscription 2:1 itu **rata-rata jam sibuk**, bukan worst-case. DC AI/ML training
  modern menuntut 1:1 (non-blocking) karena GPU-to-GPU RDMA sangat sensitif terhadap
  microburst drop — kalau NetGeo mau dukung skenario AI fabric di masa depan, ini perlu
  parameter oversubscription yang bisa diubah per-pod, bukan hardcoded.
