# Skenario 1 — Backbone Metro-E / DWDM Multi-POP

**File topologi:** [`backbone-metro-dwdm-multipop.json`](./backbone-metro-dwdm-multipop.json)
**Skala:** 18 node fisik (6 POP × 3 layer: core router, ROADM DWDM, agg switch) + 1 NOC.
**Mode rekomendasi:** `emul` untuk core router (BGP/IS-IS real), `sim` untuk ROADM/transponder
(behavior optik tidak perlu NOS nyata, cukup model matematis power budget).

## Tujuan

Mereplikasi backbone regional ISP carrier-grade: 6 POP yang dihubungkan **dual-ring DWDM**
(ring utama + ring proteksi terpisah jalur fisik), dengan IS-IS sebagai IGP backbone dan
MPLS/segment-routing untuk traffic engineering. Ini adalah skenario "as real as it gets" untuk
tim dev menguji: (1) konvergensi IGP saat fiber cut, (2) traffic engineering label-switched,
(3) interaksi layer fisik (DWDM power budget) dengan layer routing.

## Topologi (ringkasan naratif)

```
                         ┌──────────────┐
                         │   pop-jkt     │  (POP utama / hub, 2x core router N+1)
                         │  core-01/02   │
                         └──────┬───────┘
                  ring-A (clockwise, 100G DWDM)
        ┌─────────────────────┼─────────────────────┐
        │                     │                     │
   ┌────┴─────┐         ┌─────┴────┐          ┌─────┴────┐
   │ pop-bdg   │         │ pop-sby   │          │ pop-mdn  │
   │ core-01   │         │ core-01   │          │ core-01  │
   └────┬─────┘         └─────┬────┘          └─────┬────┘
        │                     │                     │
   ┌────┴─────┐         ┌─────┴────┐          ┌─────┴────┐
   │ pop-dps   │         │ pop-mks   │          │  (ring-A menutup ke jkt)
   │ core-01   │         │ core-01   │          │
   └──────────┘         └──────────┘
        ring-B (counter-clockwise, jalur fisik BERBEDA — proteksi)
```

- **Topologi fisik**: dual-ring DWDM 100G per λ (panjang gelombang), C-band 40 channel,
  jalur Ring-A dan Ring-B **wajib tidak berbagi duct/manhole yang sama** (diverse routing) —
  ini constraint yang sering dilanggar di lapangan dan jadi penyebab utama "redundant tapi
  tetap mati bareng" saat backhoe fade (galian putus 2 jalur sekaligus).
- **Layer routing**: IS-IS Level-2 sebagai IGP backbone (area tunggal, 6 router core),
  MPLS LDP/Segment Routing (SR-MPLS, label dari SRGB 16000-23999) untuk TE tunnel antar POP
  jauh (mis. `jkt → mks` lewat tunnel langsung tanpa hop semua ring).
- **Jarak fiber realistis** (estimasi rute darat/laut Indonesia, dipakai untuk hitung delay):
  jkt–bdg ~150 km, jkt–sby ~800 km (lewat jalur darat Pantura, span DWDM perlu 5-7 optical
  amplifier/EDFA tiap ~80-100km), sby–mks ~600 km (submarine/terrestrial mix), jkt–mdn ~1400 km
  (umumnya via submarine cable system), jkt–dps ~1000 km. Delay propagasi fiber ≈ 5 µs/km, jadi
  jkt–mdn one-way ≈ 7 ms murni propagasi (belum termasuk regen/OEO delay).
- **POP hub (jkt)** memiliki 2× core router (N+1 redundancy) + 2× ROADM independen (proteksi
  kontrol-plane optik), karena jkt adalah single point of failure terbesar jika cuma 1.

## Profil Trafik

- Setiap POP non-hub menyalurkan ~20-40 Gbps agregat trafik akses (downstream FTTH+korporat)
  ke jkt sebagai upstream/IX.
  jkt sendiri membawa total agregat ~150-200 Gbps di link inter-POP saat jam sibuk.
- Trafik antar-POP non-jkt (mis. sby↔mks) kecil (<5 Gbps), tidak perlu direct link — cukup
  transit lewat ring, dipakai untuk uji **traffic engineering** (apakah SR-TE tunnel
  benar-benar menghindari hop jkt saat ada kongesti).

## Failure Scenario yang Harus Bisa Disimulasikan

1. **Fiber cut single-span** (mis. `pop-bdg ↔ pop-jkt` ring-A putus) → trafik harus
   re-route otomatis lewat ring-B dalam **<50ms** (target carrier-grade FRR) bukan menunggu
   full IS-IS SPF recompute (~1-5 detik tanpa FRR). Engine wajib bisa model **dua skenario
   ini terpisah** (dengan FRR vs tanpa FRR) supaya tim dev paham gap performanya.
2. **Dual-ring putus bersamaan di titik berbeda** (mis. ring-A antara bdg-jkt DAN ring-B
   antara sby-mks) → segmen jaringan terbagi dua (network partition); skenario ini menguji
   apakah engine bisa mendeteksi dan menampilkan **partisi graf**, bukan cuma "link down".
3. **Core router hub (jkt) reload** (simulasi maintenance/crash) → konvergensi IS-IS,
   reroute MPLS LSP yang lewat jkt, ukur **packet loss durasi total** selama failover ke
   core-02 (jika ada BFD+ECMP, idealnya <1 detik; tanpa itu, bisa puluhan detik).
3. **Optical degradation gradual** (bukan hard-down): power budget ROADM turun perlahan
   (mis. konektor kotor/bengkok fiber) → BER naik → packet loss inkremental sebelum link
   benar-benar down. Ini butuh fitur `signal_quality` dinamis (lihat README §Kebutuhan Backend).

## Acceptance Criteria (`Scenario.expected_outcomes`)

- [ ] Convergence time re-route ring saat fiber cut < 5 detik (tanpa FRR), < 50ms (dengan FRR/BFD).
- [ ] Tidak ada blackhole routing permanen setelah re-converge (semua node tetap reachable
      kecuali yang benar-benar terisolasi oleh partisi).
- [ ] SR-TE tunnel `jkt→mks` tetap aktif dan tidak melewati hop yang sedang congested saat
      diuji dengan profil trafik jam sibuk.
- [ ] Degradasi optik gradual ter-render di UI sebagai warning (kuning) sebelum link benar-benar
      merah (down), bukan transisi biner.

## Catatan Lapangan (field notes)

- Power budget DWDM 80km span dengan SMF-28 standar (~0.22 dB/km attenuation) + 2 connector
  (~0.5dB tiap) ≈ 18.6 dB loss — masih dalam budget transponder 100G coherent (umumnya
  tolerable hingga 22-24dB tanpa amplifier). Span >80-100km **wajib** EDFA inline. Simulasi
  yang tidak memodelkan ini akan memberi rasa aman palsu untuk desain span jauh.
- Ring proteksi DWDM (optical 1+1 atau dengan OLP — optical line protection switch) punya
  switching time khas **<50ms**; ini terpisah dari L3 reroute time, dan keduanya harus
  dimodelkan sebagai dua "domain failover" berbeda di engine — jangan disamakan.
