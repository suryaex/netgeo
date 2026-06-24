# Skenario 3 — ISP Nasional: BGP Multi-AS, Route Reflector, Peering IX

**File topologi:** [`isp-nasional-bgp-multias-rr.json`](./isp-nasional-bgp-multias-rr.json)
**Skala:** 32 node — 5 AS (1 AS ISP utama dengan RR + 4 AS pelanggan/upstream/peer).
**Mode rekomendasi:** `emul` untuk PE dan Route Reflector (BGP behavior — path selection,
attribute manipulation — wajib akurat, sebaiknya FRRouting/BIRD nyata), `sim` untuk CE
pelanggan (cukup originate prefix, tidak perlu full BGP stack).

## Tujuan

Mereplikasi ISP nasional dengan iBGP scalable (route reflector, **bukan full-mesh** — full-mesh
iBGP untuk puluhan PE router tidak praktis, n(n-1)/2 session meledak cepat), eBGP ke pelanggan
korporat (multihomed maupun single-homed), eBGP ke upstream Tier-1, dan peering settlement-free
di Internet Exchange (IX) domestik. Ini skenario rujukan untuk uji **BGP policy** (community,
local-pref, MED, prefix-list/AS-path filter) dan **skala control-plane** (jumlah prefix di RIB/FIB).

## Topologi (ringkasan naratif)

```
                    ┌─────────────┐
                    │  UPSTREAM    │  AS 64512 (Tier-1 simulasi, full table ~950k prefix IPv4)
                    │  (transit)   │
                    └──────┬──────┘
                           │ eBGP (default-route + full table, opsional partial)
                    ┌──────┴──────┐
        ┌───────────┤   PE-EDGE-01 ├───────────┐
        │           │  AS 65001    │           │
        │           └──────┬──────┘           │
   ┌────┴─────┐      ┌──────┴──────┐    ┌──────┴─────┐
   │   IX-NODE │      │  RR-01/RR-02 │    │  PE-EDGE-02│
   │ (peering) │      │ (Route Reflector,│  │ AS 65001   │
   │ AS 65530  │      │  cluster-id 1)   │  └──────┬─────┘
   └──────────┘      └──────┬──────┘           │
                           │ iBGP (RR client, BUKAN full-mesh)
            ┌──────────────┼──────────────┬─────────────┐
       ┌────┴────┐   ┌─────┴────┐   ┌─────┴────┐  ┌──────┴───┐
       │  PE-01    │   │  PE-02    │   │  PE-03    │  │  PE-04   │   (8x PE, RR client)
       │ (jkt)     │   │ (sby)     │   │ (bdg)     │  │ (mdn)    │
       └────┬────┘   └─────┬────┘   └─────┬────┘  └──────┬───┘
            │ eBGP multihop ke CE pelanggan
       ┌────┴────┐                                  ┌──────┴───┐
       │ CE-CORP-A │ AS 65101 (multihomed: PE-01+PE-02)│CE-CORP-B │ AS 65102 (single-homed)
       └──────────┘                                  └──────────┘
```

- **AS ISP utama**: AS 65001 (privat, representatif), terdiri PE-01..PE-08 (8 PE router di
  8 kota), RR-01 + RR-02 (route reflector redundant, **cluster-id sama** supaya loop-prevention
  RR berjalan benar — kuirk penting: kalau cluster-id beda tanpa sengaja, originator-id check
  tidak akan mendeteksi loop dengan benar).
- **iBGP**: seluruh PE jadi **client** dari RR-01 dan RR-02 (redundant RR, tiap PE peering ke
  keduanya). Tidak ada PE-to-PE iBGP langsung → mengurangi session dari potensi 28 (full-mesh
  8 node) menjadi 16 (8 PE × 2 RR).
- **eBGP upstream**: PE-EDGE-01 dan PE-EDGE-02 (2 router edge terpisah, beda lokasi) masing-masing
  punya eBGP ke AS 64512 (Tier-1 simulasi) — **multihomed upstream**, bukan single transit,
  supaya tidak ada SPOF di level internet connectivity.
- **Peering IX**: AS 65001 peering settlement-free dengan beberapa AS lain (disimulasikan
  sebagai 1 node "IX-NODE" route-server AS 65530 yang mewakili peering fabric ala APJII-IX/
  Indonesia IX) — pola realistis: ISP kecil-menengah peering lewat route-server IX daripada
  bilateral satu-satu ke puluhan peer.
- **Pelanggan korporat**: CE-CORP-A (AS 65101) multihomed ke PE-01 dan PE-02 dengan
  **AS-path prepend** untuk traffic engineering inbound (load balance asimetris), CE-CORP-B
  (AS 65102) single-homed standar.

## Profil Trafik & Skala Prefix (Realistis)

- **Full BGP table internet (IPv4)**: ~950.000 prefix (kondisi 2025-2026), IPv6 ~200.000 prefix.
  Engine **wajib** bisa menyuntikkan jumlah prefix sebesar ini di RIB simulasi upstream tanpa
  collapse — ini beban RAM/CPU signifikan (lihat `scaling-guidelines.md`), TAPI untuk skenario
  demo/CI default, gunakan **partial table** (~5.000-10.000 prefix sintetis) supaya tidak
  membutuhkan resource carrier-grade hanya untuk smoke test.
- **Prefix pelanggan**: CE-CORP-A originate 2 prefix /24, CE-CORP-B originate 1 prefix /24.
- **Komunitas BGP** dipakai untuk policy: `65001:100` = customer route, `65001:200` = peer
  route, `65001:300` = upstream/transit route — dipakai filter `export` ke upstream
  (jangan pernah leak full table peer ke peer lain — **route leak prevention** adalah salah
  satu kegagalan paling umum & berbahaya di lapangan, lihat insiden BGP leak terkenal industri).

## Failure Scenario yang Harus Bisa Disimulasikan

1. **RR-01 mati** → seluruh PE harus tetap menerima update via RR-02 tanpa kehilangan rute
   (uji redundansi RR, bukan SPOF).
2. **Upstream PE-EDGE-01 putus dari Tier-1** → default route/full-table hilang dari edge itu,
   trafik harus reroute ke PE-EDGE-02; ukur waktu BGP hold-down (default `holdtime 180s`,
   keepalive 60s — **lambat** kalau tanpa BFD; uji versi dengan dan tanpa BFD-triggered BGP
   session reset untuk menunjukkan gap).
3. **Route leak simulation**: PE-03 secara tidak sengaja meng-export rute upstream ke peer IX
   (misconfigured filter) → engine harus bisa mendeteksi/menampilkan ini sebagai anomali
   (rute yang seharusnya tidak ada di tabel peer), berguna untuk training/lab keamanan routing.
4. **CE-CORP-A failover**: link ke PE-01 putus → trafik otomatis lewat PE-02 (BGP multihomed),
   ukur asimetri RTT akibat AS-path prepend yang tadinya disengaja untuk TE.
5. **iBGP session reset massal** (mis. RR restart, semua PE client drop sekaligus) → uji
   "BGP convergence storm": berapa CPU/event-queue load saat 8 PE + RR re-establish session
   dan re-advertise ribuan prefix bersamaan — kasus nyata yang sering jadi penyebab brief
   outage saat maintenance window.

## Acceptance Criteria

- [ ] iBGP via RR mendistribusikan rute pelanggan ke seluruh PE client dalam < 5 detik
      (tanpa BGP scan-time delay yang tidak realistis).
- [ ] Saat RR-01 down, tidak ada PE yang kehilangan rute pelanggan sama sekali (redundant RR).
- [ ] Route leak test case terdeteksi (rute upstream muncul di tabel yang diterima IX peer)
      dan dapat ditandai sebagai violation pada hasil simulasi.
- [ ] CE-CORP-A failover ke PE-02 terjadi tanpa blackhole, walau ada periode transient
      sesuai BGP timer yang dikonfigurasi.

## Catatan Lapangan

- **Full-mesh iBGP itu O(n²)** — untuk ISP dengan >5-10 PE router, route reflector atau
  confederation BUKAN opsional, itu kebutuhan dasar. Banyak training lab keliru mengajarkan
  full-mesh untuk semua skala; NetForge sebaiknya **flag warning** kalau user membuat
  full-mesh iBGP di topologi >8 node tanpa RR — good catch untuk fitur UX validasi desain.
- **BGP convergence di internet nyata itu LAMBAT** dibanding IGP — best-path re-selection
  setelah event besar (mis. upstream major outage) bisa makan puluhan detik hingga menit
  karena BGP path-hunting (mencoba banyak rute alternatif sebelum stabil), beda jauh dari
  OSPF/IS-IS yang konvergen dalam hitungan detik. Simulasi yang membuat BGP "instan" akan
  memberikan ekspektasi keliru ke pengguna baru yang belajar dari NetForge.
