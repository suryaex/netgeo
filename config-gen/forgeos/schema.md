# ForgeOS Intent Schema — Spesifikasi YAML

> Skema ini mendefinisikan struktur `node.intent` (field `Node.config_ref` terkait, model §4
> MASTER_SPEC.md) yang dikonsumsi oleh `backend/app/services/configgen.py::_context()` dan
> dirender oleh template di `../templates/*.j2`. Setiap sub-tree di bawah **harus** memakai nama
> key yang persis sama dengan yang dibaca `_context()` — ini adalah kontrak biner antara
   dokumen ini dan kode backend, jangan menyimpang nama field tanpa update bersama.

## Prinsip Desain

1. **Vendor-neutral**: intent mendeskripsikan *maksud* ("node ini PE BGP AS 65001"), bukan sintaks
   CLI vendor manapun.
2. **Satu intent → banyak vendor**: field yang sama di intent dipakai untuk merender ke 7 template
   vendor sekaligus (lihat `../README.md` §1).
3. **Opsional secara eksplisit**: setiap sub-tree top-level (`bgp`, `ospf`, `isis`, `evpn`, `fhrp`)
   bersifat opsional — tidak ada artinya protokol itu tidak dikonfigurasi di node tersebut. Tidak
   ada default tersembunyi untuk hal yang berdampak keamanan (password, ASN, dll wajib eksplisit).
4. **Field tak dikenal tidak error** — `_context()` hanya mengekstrak 8 sub-tree yang dikenal
   (`bgp, ospf, isis, vrfs, vlans, evpn, fhrp, static_routes`); field intent lain yang ditambahkan
   user tetap tersimpan utuh di context key `intent` (raw dict) dan bisa diakses manual dari
   `forgeos.j2` (lihat blok `{{ intent.xxx }}` jika diperlukan), namun **tidak otomatis** dirender
   vendor lain kecuali ditambahkan ke `_context()` dan ke template terkait.

## Struktur Top-Level

```yaml
# contoh kerangka kosong (semua sub-tree opsional)
node:
  name: string            # -> hostname
  kind: router|switch|host|ap|olt|firewall|server
  nos: forgeos|ios|iosxr|nxos|junos|eos|routeros|vyos|frr   # NOS asli node (target render default)

interfaces:                # fisik, BUKAN bagian intent — berasal dari Node.interfaces (model §4)
  - name: string
    type: eth|sfp|sfp28|qsfp|gpon|wifi
    ip: ["a.b.c.d/nn", ...]
    mtu: int

intent:
  bgp: {...}               # lihat §BGP
  ospf: {...}              # lihat §OSPF
  isis: {...}              # lihat §IS-IS (CATATAN: belum dirender template manapun, lihat README §3)
  vrfs: [...]               # lihat §VRF / MPLS L3VPN
  vlans: [...]              # lihat §VLAN
  evpn: {...}               # lihat §EVPN-VXLAN
  fhrp: {...}                # lihat §FHRP (VRRP/HSRP)
  static_routes: [...]       # lihat §Static Route
  policy: {...}              # rencana — route-map/policy lintas vendor, belum dikonsumsi _context()
  acl: [...]                  # rencana — belum dikonsumsi _context()
```

Catatan: `node.intent` di model Python adalah dict yang **berisi langsung** isi blok `intent:` di
atas (tanpa nesting tambahan) — yaitu `node.intent["bgp"]`, bukan `node.intent["intent"]["bgp"]`.

---

## §BGP

```yaml
bgp:
  asn: int                       # wajib — Autonomous System Number node ini
  router_id: "a.b.c.d"           # wajib — disarankan = IP loopback
  neighbors:
    - ip: "a.b.c.d"              # wajib — IP neighbor
      remote_as: int             # wajib
      description: string        # opsional — masuk ke semua vendor yang mendukung field description
      evpn: true|false           # opsional, default false — jika true, neighbor diaktifkan di address-family EVPN (lihat arista_eos.j2)
  networks:                      # opsional — daftar prefix yang diiklankan via `network` statement
    - "a.b.c.d/nn"
```

**Dipakai oleh**: semua 7 template. Lihat tabel cakupan di `../README.md` §3 — `networks` belum
dirender di `junos.j2` dan `vyos.j2` (gap diketahui).

**Contoh minimal** (eBGP single-homed):
```yaml
bgp:
  asn: 65010
  router_id: "10.255.255.1"
  neighbors:
    - ip: "203.0.113.1"
      remote_as: 65001
      description: "Uplink to ISP-A"
  networks:
    - "198.51.100.0/24"
```

---

## §OSPF

```yaml
ospf:
  process_id: int                # opsional, default 1 (hanya dipakai cisco_ios.j2/arista_eos.j2; junos/vyos/frr tidak punya konsep process-id terpisah)
  router_id: "a.b.c.d"           # wajib
  networks:                      # opsional — daftar network+area
    - prefix: "a.b.c.d/nn"
      area: int|"a.b.c.d"        # area number (0, 1, ...) — format dotted-decimal juga valid di banyak vendor
      interface: string          # opsional, dipakai junos.j2 (set protocols ospf area X interface Y); default 'all' jika kosong
      area_name: string          # opsional, dipakai mikrotik_routeros.j2 (RouterOS pakai nama area, bukan angka); default 'backbone'
```

**Dipakai oleh**: semua 7 template. `forgeos.j2` saat ini hanya merender `router_id` (gap, lihat
`../README.md` §3).

**Contoh minimal**:
```yaml
ospf:
  process_id: 1
  router_id: "10.0.0.2"
  networks:
    - prefix: "10.10.10.0/24"
      area: 0
    - prefix: "10.0.0.0/30"
      area: 0
```

---

## §IS-IS

```yaml
isis:
  net: "49.0001.0100.0000.0001.00"   # NET (Network Entity Title) — wajib
  level: level-1|level-2|level-1-2   # opsional, default level-2
  interfaces:                        # interface mana yang ikut IS-IS + metric
    - name: string
      metric: int                    # opsional, default 10
      circuit_type: p2p|broadcast    # opsional, default broadcast
```

> **Status implementasi (update 2026-06-24)**: dirender di `cisco_ios.j2`, `junos.j2`,
> `arista_eos.j2`, `vyos.j2`, `frr.j2`, `forgeos.j2`. **Tidak** dirender di
> `mikrotik_routeros.j2` — disengaja, RouterOS tidak punya daemon IS-IS sama sekali (gap
> vendor-capability, bukan gap template; lihat `../README.md` §3).

---

## §VRF / MPLS L3VPN

```yaml
vrfs:
  - name: string                 # wajib — nama VRF
    rd: "asn:nn" | "ip:nn"        # wajib — Route Distinguisher
    import: ["asn:nn", ...]      # opsional — Route Target import list
    export: ["asn:nn", ...]      # opsional — Route Target export list
```

**Dipakai oleh**: semua 7 template (update 2026-06-24 — `arista_eos.j2`, `mikrotik_routeros.j2`,
`vyos.j2`, `frr.j2`, `forgeos.j2` ditambahkan; sebelumnya hanya `cisco_ios.j2`/`junos.j2`). Lihat
`../README.md` §3 untuk detail sintaks per vendor (mis. EOS pakai `vrf instance` + per-VRF
`router bgp ... vrf`, FRR pakai `vrf` stanza + per-VRF `router bgp ... vrf` yang butuh `bgp`
intent terisi).

**Contoh minimal**:
```yaml
vrfs:
  - name: CUST-A
    rd: "65000:100"
    import: ["65000:100"]
    export: ["65000:100"]
```

---

## §VLAN

```yaml
vlans:
  - id: int                      # wajib — VLAN ID 1-4094
    name: string                 # opsional — default "VLAN<id>" jika kosong (lihat arista_eos.j2)
```

**Dipakai oleh**: `arista_eos.j2`, `mikrotik_routeros.j2` (`/interface vlan`), `vyos.j2`
(`vif` sub-interface), `forgeos.j2` (ringkas). **Tidak** dirender di `cisco_ios.j2`/`junos.j2`
(belum perlu kasus pakai L2VLAN murni di skenario yang ada) maupun `frr.j2` (VLAN adalah konsep
Linux kernel/bridge, bukan sesuatu yang dikonfigurasi via `vtysh`/`frr.conf` — lihat
`../README.md` §3).

**Contoh minimal**:
```yaml
vlans:
  - id: 10
    name: FINANCE
  - id: 20
    name: HR
```

---

## §EVPN-VXLAN

```yaml
evpn:
  vnis:
    - vlan: int                  # wajib — VLAN lokal yang dipetakan ke VNI ini
      vni: int                   # wajib — VXLAN Network Identifier
```

**Dipakai oleh**: `arista_eos.j2` (render lengkap: `interface Vxlan1` + mapping per-VNI),
`mikrotik_routeros.j2` (`/interface vxlan` per VNI + bridge port `pvid`), `vyos.j2`
(`set interfaces vxlan vxlan0 vni-to-vlan`), `frr.j2` (level BGP saja —
`address-family l2vpn evpn` + `advertise-all-vni`; data-plane VXLAN tetap di Linux kernel/`ip
link`, di luar `frr.conf`), `forgeos.j2` (render ringkas: jumlah VNI saja). **Tidak** dirender di
`cisco_ios.j2`/`junos.j2` — EVPN asli NX-OS (`nv overlay`) dan Junos (`routing-instances ...
instance-type evpn`) punya model config yang signifikan berbeda dari baseline IOS classic/Junos
`set` yang dipakai kedua template ini; menambahnya benar butuh varian template vendor terpisah,
dicatat sbg roadmap Fase 3 (lihat `NEEDS.md`).

**Contoh minimal**:
```yaml
evpn:
  vnis:
    - vlan: 10
      vni: 10010
    - vlan: 20
      vni: 10020
```

---

## §FHRP (First-Hop Redundancy: VRRP/HSRP)

```yaml
fhrp:
  interface: string               # wajib — nama interface/SVI tempat FHRP berjalan
  group: int                      # wajib — group/VRID number
  vip: "a.b.c.d"                  # wajib — Virtual IP
  priority: int                   # opsional, default 100
  preempt: true|false             # opsional, default true (hanya dipakai cisco_ios.j2)
  local_ip: "a.b.c.d/nn"          # opsional — dipakai junos.j2 (Junos butuh IP lokal + vrrp-group dalam satu baris `set`)
```

**Dipakai oleh**: `cisco_ios.j2` (gaya `standby`, lihat README catatan — secara teknis ini sintaks
HSRP meski field generik bernama `fhrp`; untuk VRRP murni di Cisco perlu varian `vrrp` command,
dicatat sbg item lanjutan), `junos.j2` (vrrp-group asli), `mikrotik_routeros.j2` (`/interface
vrrp` asli), `arista_eos.j2` (update 2026-06-24 — native `vrrp <grp> priority-level`/`vrrp <grp>
ipv4` command, BUKAN gaya `standby` Cisco), `vyos.j2` (update 2026-06-24 — native
`set high-availability vrrp group`, VyOS 1.3+). **Tetap belum** dirender di `frr.j2` — FRR tidak
punya daemon VRRP/HSRP native, butuh integrasi `keepalived` terpisah (file `keepalived.conf`
sendiri, bukan `frr.conf`). Ini gap arsitektural yang disengaja, bukan baris Jinja yang
terlewat — pendekatan integrasinya didokumentasikan di `../README.md` §3 sub-bagian "FRR +
keepalived".

**Contoh minimal**:
```yaml
fhrp:
  interface: "Vlan10"
  group: 10
  vip: "10.10.10.1"
  priority: 110
  preempt: true
```

---

## §Static Route

```yaml
static_routes:
  - prefix: "a.b.c.d/nn"          # wajib
    next_hop: "a.b.c.d"           # wajib
```

**Dipakai oleh**: `cisco_ios.j2`, `junos.j2`, `mikrotik_routeros.j2`, `vyos.j2`, `frr.j2`. Belum
dirender di `arista_eos.j2`, `forgeos.j2` (gap minor — static route jarang jadi fokus skenario
EVPN/L3VPN yang sudah dipetakan ke kedua template ini, tapi tetap dicatat).

**Contoh minimal**:
```yaml
static_routes:
  - prefix: "0.0.0.0/0"
    next_hop: "203.0.113.1"
```

---

## Validasi yang Disarankan (untuk diimplementasikan backend, dicatat di `NEEDS.md`)

Skema ini didokumentasikan sebagai Markdown (bukan JSON Schema/Pydantic formal) karena validasi
runtime adalah tanggung jawab `backend-network-sim-architect`. Aturan yang disarankan saat
mengimplementasikan validator:

- `bgp.asn` harus 1-4294967295 (32-bit ASN, termasuk rentang 4-byte modern).
- `ospf.networks[].area` jika numerik harus 0-4294967295; jika dotted-decimal harus IPv4 valid.
- Semua field `*_ip`, `vip`, `router_id`, `next_hop` harus lolos parse `ipaddress.ip_address()`.
- Semua field `prefix`/CIDR harus lolos parse `ipaddress.ip_network()` (termasuk validasi host-bit
  tidak menyala di luar host-mask, kecuali memang dimaksudkan sbg host-route `/32`).
- `vrfs[].rd` harus match pola `<asn|ip>:<nn>` (RFC 4364 Route Distinguisher format).
- `vlans[].id` dan `evpn.vnis[].vlan` harus 1-4094; `evpn.vnis[].vni` harus 1-16777215 (24-bit).

## Lihat Juga

- `examples/pe-router-bgp-ospf.yaml` — contoh intent BGP + OSPF + VRF (skenario L3VPN PE router).
- `examples/leaf-evpn-vxlan.yaml` — contoh intent BGP EVPN + VLAN + VXLAN (skenario DC leaf switch).
- `mappings/intent-to-vendor-mapping.md` — pemetaan baris-per-baris field intent → output tiap vendor.
- `../README.md` — arsitektur generator & tabel cakupan render aktual per vendor.
- `../../network/protocols/scenarios/` — skenario topologi yang jadi sumber contoh intent ini.
