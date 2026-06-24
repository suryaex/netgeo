# Pemetaan Satu Intent → Banyak Vendor

Dokumen ini menunjukkan **field intent mana menghasilkan baris config mana** di tiap-tiap 7
template vendor, memakai contoh nyata dari `../examples/leaf-evpn-vxlan.yaml` (subset BGP+EVPN)
dan `../examples/pe-router-bgp-ospf.yaml` (subset OSPF+VRF). Ini adalah bukti konkret klaim
MASTER_SPEC §5: **"satu intent → banyak target NOS, dapat diverifikasi sebelum deploy."**

Sumber kebenaran pemetaan adalah kode template itu sendiri (`../../templates/*.j2`) — dokumen ini
adalah penjelasan naratif, bukan pengganti. Jika ada divergensi, **template yang menang**.

---

## Studi Kasus 1 — Field BGP Neighbor

**Intent (potongan dari `leaf-evpn-vxlan.yaml`):**
```yaml
bgp:
  asn: 65101
  router_id: "10.255.0.11"
  neighbors:
    - ip: "10.0.1.0"
      remote_as: 65000
      description: "underlay to SPINE1"
      evpn: true
```

| Vendor | Template | Baris dihasilkan |
|---|---|---|
| Cisco IOS | `cisco_ios.j2` L30-46 | `router bgp 65101` / ` bgp router-id 10.255.0.11` / ` neighbor 10.0.1.0 remote-as 65000` / ` neighbor 10.0.1.0 description underlay to SPINE1` / ` address-family ipv4 unicast` → ` neighbor 10.0.1.0 activate` (catatan: `evpn: true` **tidak** dibaca cisco_ios.j2 — gap, lihat README §3) |
| Junos | `junos.j2` L18-26 | `set routing-options autonomous-system 65101` / `set routing-options router-id 10.255.0.11` / `set protocols bgp group ext neighbor 10.0.1.0 peer-as 65000` / `set protocols bgp group ext neighbor 10.0.1.0 description "underlay to SPINE1"` |
| Arista EOS | `arista_eos.j2` L27-45 | `router bgp 65101` / `   router-id 10.255.0.11` / `   neighbor 10.0.1.0 remote-as 65000` / `   neighbor 10.0.1.0 send-community extended` (krn `evpn: true`) / blok `address-family evpn` → `      neighbor 10.0.1.0 activate` |
| MikroTik RouterOS | `mikrotik_routeros.j2` L15-20 | `/routing bgp connection add name=peer-1 remote.address=10.0.1.0 remote.as=65000 as=65101 router-id=10.255.0.11` |
| VyOS | `vyos.j2` L16-22 | `set protocols bgp system-as '65101'` / `set protocols bgp parameters router-id '10.255.0.11'` / `set protocols bgp neighbor 10.0.1.0 remote-as '65000'` (catatan: `description` tidak dibaca vyos.j2 — gap) |
| FRRouting | `frr.j2` L23-38 | `router bgp 65101` / ` bgp router-id 10.255.0.11` / ` neighbor 10.0.1.0 remote-as 65000` / ` address-family ipv4 unicast` → `  neighbor 10.0.1.0 activate` |
| ForgeOS (native) | `forgeos.j2` L24-34 | `bgp:` → `    asn: 65101` / `    router_id: 10.255.0.11` / `    neighbors:` → `      - peer: 10.0.1.0` / `        remote_as: 65000` |

**Insight**: field `evpn: true` pada neighbor **hanya** punya efek di `arista_eos.j2` saat ini —
ini contoh nyata bahwa satu field intent bisa "tidak relevan" untuk sebagian vendor (Cisco IOS
classic tidak punya address-family EVPN di template ini) tanpa membuat compile gagal — field
yang tidak dibaca template tertentu cukup diabaikan, bukan error.

---

## Studi Kasus 2 — Field EVPN VNI

**Intent (potongan dari `leaf-evpn-vxlan.yaml`):**
```yaml
evpn:
  vnis:
    - vlan: 10
      vni: 10010
    - vlan: 20
      vni: 10020
```

| Vendor | Template | Hasil |
|---|---|---|
| Arista EOS | `arista_eos.j2` | `interface Vxlan1` / `   vxlan source-interface Loopback0` / `   vxlan udp-port 4789` / `   vxlan vlan 10 vni 10010` / `   vxlan vlan 20 vni 10020` — render **lengkap**, masih vendor dengan detail data-plane VNI paling eksplisit |
| MikroTik RouterOS | `mikrotik_routeros.j2` | `/interface vxlan add name=vxlan10010 vni=10010 interface=bridge` / `/interface bridge port add bridge=bridge interface=vxlan10010 pvid=10` (diulang per VNI) |
| VyOS | `vyos.j2` | `set interfaces vxlan vxlan0 source-interface 'lo'` / `set interfaces vxlan vxlan0 vni-to-vlan vni 10010 vlan 10` (diulang per VNI) |
| FRRouting | `frr.j2` | `address-family l2vpn evpn` → `  neighbor ... activate` (per neighbor `evpn: true`) → `  advertise-all-vni` — **hanya level BGP control-plane**; data-plane VXLAN (`ip link add vxlan...`) tetap di luar `frr.conf`, jadi tidak direpresentasikan di output ini |
| ForgeOS (native) | `forgeos.j2` | `overlay:` → `  evpn_vxlan:` → `    vnis: 2` — render **ringkas** (hanya jumlah VNI, bukan daftar detail — representasi native ForgeOS yang sengaja disederhanakan sbg "echo" intent, bukan CLI siap-pakai) |
| Cisco IOS / Junos | — | **Tidak ada output** — EVPN asli NX-OS/Junos punya model config signifikan berbeda dari baseline IOS classic/Junos `set` yang dipakai kedua template ini; butuh varian template vendor terpisah (roadmap Fase 3, lihat `NEEDS.md`) |

**Insight**: setelah update 2026-06-24, EVPN-VXLAN punya representasi nyata di 5 dari 7 vendor.
Gap yang tersisa di Cisco IOS/Junos bukan "belum sempat", tapi keputusan sengaja menghindari
config yang setengah-jadi/menyesatkan — `nv overlay`/`instance-type evpn` butuh struktur context
berbeda dari yang dipakai baseline `cisco_ios.j2`/`junos.j2` saat ini. Operator tetap harus
mengecek tabel cakupan `../../README.md` §3 sebelum mengandalkan compile ke vendor tertentu.

---

## Studi Kasus 3 — Field VRF (MPLS L3VPN)

**Intent (potongan dari `pe-router-bgp-ospf.yaml`):**
```yaml
vrfs:
  - name: CUST-A
    rd: "65000:100"
    import: ["65000:100"]
    export: ["65000:100"]
```

| Vendor | Template | Hasil |
|---|---|---|
| Cisco IOS | `cisco_ios.j2` | `vrf definition CUST-A` / ` rd 65000:100` / ` route-target import 65000:100` / ` route-target export 65000:100` |
| Junos | `junos.j2` | `set routing-instances CUST-A instance-type vrf` / `set routing-instances CUST-A route-distinguisher 65000:100` / `set routing-instances CUST-A vrf-import 65000:100` / `set routing-instances CUST-A vrf-export 65000:100` |
| Arista EOS | `arista_eos.j2` | `vrf instance CUST-A` (top-level) + di dalam `router bgp <asn>`: `   vrf CUST-A` → `      rd 65000:100` → `      route-target import evpn 65000:100` / `route-target import vpn-ipv4 65000:100` (dan simetris utk export) |
| MikroTik RouterOS | `mikrotik_routeros.j2` | `/ip vrf add name=CUST-A interfaces="" route-distinguisher=65000:100` / `/routing bgp vrf-import-rt add vrf=CUST-A route-target=65000:100` / `/routing bgp vrf-export-rt add vrf=CUST-A route-target=65000:100` |
| VyOS | `vyos.j2` | `set vrf name CUST-A table 101` / `set vrf name CUST-A protocols bgp route-distinguisher '65000:100'` / `set vrf name CUST-A protocols bgp address-family ipv4-unicast route-target import '65000:100'` (dan simetris utk export) |
| FRRouting | `frr.j2` | `vrf CUST-A` → ` exit-vrf` (deklarasi top-level) + `router bgp <asn> vrf CUST-A` → ` address-family ipv4 unicast` → `  rd vpn export 65000:100` / `  route-target import 65000:100` / `  route-target export 65000:100` (blok per-VRF BGP ini hanya muncul jika `bgp` intent juga terisi) |
| ForgeOS (native) | `forgeos.j2` | `vrfs:` → `  - name: CUST-A` → `    rd: 65000:100` → `    import: [65000:100]` → `    export: [65000:100]` — render ringkas, echo langsung dari intent |

---

## Studi Kasus 4 — Field OSPF (lintas SEMUA vendor — fitur paling matang)

**Intent (potongan dari `pe-router-bgp-ospf.yaml`):**
```yaml
ospf:
  process_id: 1
  router_id: "10.255.255.1"
  networks:
    - prefix: "10.0.12.0/30"
      area: 0
```

| Vendor | Template | Hasil |
|---|---|---|
| Cisco IOS | `cisco_ios.j2` | `router ospf 1` / ` router-id 10.255.255.1` / ` network 10.0.12.0/30 area 0` |
| Junos | `junos.j2` | `set protocols ospf router-id 10.255.255.1` / `set protocols ospf area 0 interface all` (catatan: Junos memakai konsep `interface`, bukan `network` statement — `net.interface` default `'all'` jika tidak diisi intent; idealnya intent harus isi `interface:` eksplisit per network agar akurat) |
| Arista EOS | `arista_eos.j2` | `router ospf 1` / `   router-id 10.255.255.1` (catatan: `networks` **tidak** dirender arista_eos.j2 — gap, area/network statement EOS perlu ditambahkan) |
| MikroTik RouterOS | `mikrotik_routeros.j2` | `/routing ospf instance add name=default version=2 router-id=10.255.255.1` / `/routing ospf network add network=10.0.12.0/30 area=backbone` (catatan: `area_name` default `'backbone'`, BUKAN angka `0` — RouterOS butuh nama area, bukan angka; jika intent ingin area non-default harus isi `area_name:` eksplisit) |
| VyOS | `vyos.j2` | `set protocols ospf parameters router-id '10.255.255.1'` / `set protocols ospf area '0' network '10.0.12.0/30'` |
| FRRouting | `frr.j2` | `router ospf` / ` ospf router-id 10.255.255.1` / ` network 10.0.12.0/30 area 0` |
| ForgeOS (native) | `forgeos.j2` | `routing:` → `  ospf:` → `    router_id: 10.255.255.1` (catatan: `networks` tidak dirender forgeos.j2 — gap minor, native view ini memang dimaksudkan ringkas) |

**Insight**: OSPF adalah fitur paling matang di compiler v0.1 — satu-satunya yang punya representasi
di SEMUA 7 vendor (meski detail seperti nama field area berbeda signifikan: Cisco/FRR/VyOS pakai
angka, RouterOS pakai nama, Junos pakai konsep interface bukan network-statement). Ini contoh
nyata bahwa "satu intent" tidak selalu berarti "semantik identik" — operator perlu paham idiom
tiap vendor saat menulis `area_name`/`interface` di intent jika target vendornya beragam.

## Ringkasan Tingkat Kematangan Pemetaan (update 2026-06-24, lihat juga `../../README.md` §3)

| Field intent | Vendor dgn render lengkap | Vendor dgn gap (disengaja, vendor-capability) |
|---|---|---|
| `interfaces` (IP/MTU) | Semua 7 | — |
| `ospf` | Semua 7 (semantik beda detail) | `networks` tidak ada di `arista_eos.j2`, `forgeos.j2` |
| `bgp` | Semua 7 | `networks` tidak ada di `junos.j2`, `vyos.j2`; EVPN-AF di `arista_eos.j2`/`vyos.j2`/`frr.j2` |
| `vrfs` | Semua 7 (`arista_eos.j2`, `mikrotik_routeros.j2`, `vyos.j2`, `frr.j2`, `forgeos.j2` ditambahkan) | — |
| `vlans` | `arista_eos.j2`, `mikrotik_routeros.j2`, `vyos.j2`, `forgeos.j2` | `cisco_ios.j2`, `junos.j2` (belum perlu), `frr.j2` (VLAN = konsep kernel/bridge, di luar `vtysh`) |
| `evpn` | `arista_eos.j2` (lengkap), `mikrotik_routeros.j2`, `vyos.j2`, `frr.j2` (BGP-level saja), `forgeos.j2` (ringkas) | `cisco_ios.j2`, `junos.j2` (EVPN NX-OS/Junos beda model, butuh varian template terpisah — roadmap Fase 3) |
| `fhrp` | `cisco_ios.j2`, `junos.j2`, `mikrotik_routeros.j2`, `arista_eos.j2` (native `vrrp`), `vyos.j2` (native `high-availability vrrp`) | `frr.j2` (gap arsitektural disengaja — perlu `keepalived` terpisah, lihat `../../README.md` §3), `forgeos.j2` (gap minor) |
| `static_routes` | `cisco_ios.j2`, `junos.j2`, `mikrotik_routeros.j2`, `vyos.j2`, `frr.j2`, `arista_eos.j2` | `forgeos.j2` (gap minor) |
| `isis` | `cisco_ios.j2`, `junos.j2`, `arista_eos.j2`, `vyos.j2`, `frr.j2`, `forgeos.j2` | `mikrotik_routeros.j2` (RouterOS tidak punya daemon IS-IS — gap vendor, bukan gap template) |

Sisa baris "gap" di atas adalah keterbatasan vendor/protokol yang nyata (didokumentasikan satu per
satu di `../README.md` §3), bukan baris Jinja yang terlewat — lihat checklist menambah fitur baru
di `../../README.md` §4 jika ada kasus pakai baru yang butuh menutup salah satu gap ini.

## Lihat Juga

- `../schema.md` — definisi skema lengkap tiap field.
- `../examples/` — file intent YAML sumber studi kasus di atas.
- `../../README.md` §3 — tabel cakupan render per vendor (versi ringkas tabel di dokumen ini).
- `../../../network/protocols/scenarios/` — skenario yang melatarbelakangi kebutuhan tiap field.
