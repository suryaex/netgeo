# config-gen — Generator Konfigurasi Multi-Vendor & Compiler ForgeOS

> **Kepemilikan**: agent `network-engineer`. Area ini berisi template Jinja2 per-vendor dan
> spesifikasi compiler ForgeOS (intent → config vendor nyata), sesuai MASTER_SPEC §5.
>
> Eksekusi runtime (memanggil Jinja2, membangun context, menyimpan `ConfigArtifact`) adalah
> kepemilikan `backend-network-sim-architect` di `backend/app/services/configgen.py` — folder ini
> menyediakan **template** dan **kontrak skema** yang dikonsumsi oleh service tersebut. Dokumen ini
> dijaga selaras dengan implementasi nyata service itu (lihat referensi langsung di bawah).

## Isi Folder

```
config-gen/
├── README.md                      ← dokumen ini
├── templates/                     ← template Jinja2 flat per-vendor (BUKAN subfolder per-vendor)
│   ├── cisco_ios.j2                 (dipakai utk nos: ios, iosxr, nxos)
│   ├── junos.j2                     (dipakai utk nos: junos)
│   ├── arista_eos.j2                (dipakai utk nos: eos)
│   ├── mikrotik_routeros.j2         (dipakai utk nos: routeros)
│   ├── vyos.j2                      (dipakai utk nos: vyos)
│   ├── frr.j2                       (dipakai utk nos: frr)
│   └── forgeos.j2                   (dipakai utk nos: forgeos — native, vendor-neutral)
└── forgeos/
    ├── schema.md                   ← skema intent YAML ForgeOS (sub-tree bgp/ospf/isis/vrfs/...)
    ├── examples/                   ← contoh intent YAML siap pakai
    │   ├── pe-router-bgp-ospf.yaml
    │   └── leaf-evpn-vxlan.yaml
    └── mappings/                   ← pemetaan 1 intent -> baris config tiap vendor
        └── intent-to-vendor-mapping.md
```

**Catatan penting**: template Jinja2 disimpan **flat** langsung di `templates/*.j2`, **bukan**
dalam subfolder per-vendor. Ini karena `backend/app/services/configgen.py` me-resolve nama file
template secara langsung lewat `_TEMPLATE_MAP` (lihat §2) dan `FileSystemLoader(templates/)` —
struktur subfolder akan membuat loader gagal menemukan file.

## 1. Alur End-to-End: Intent ForgeOS → Config Vendor

```
 ┌──────────────────┐     ┌────────────────────┐     ┌─────────────────────┐     ┌───────────────┐
 │ ForgeOS Intent    │     │  Node (model §4)    │     │  configgen._context  │     │ Jinja2 Sandbox │
 │ (YAML, deklaratif)│ --> │  node.intent = {...} │ --> │  (flatten ke dict)    │ --> │  render(vendor) │
 │ bgp/ospf/vrfs/... │     │  + node.interfaces[] │     │  hostname, kind, nos, │     │  *.j2 template   │
 └──────────────────┘     └────────────────────┘     │  interfaces, bgp,     │     └───────┬───────┘
                                                       │  ospf, isis, vrfs,     │             │
                                                       │  vlans, evpn, fhrp,    │             ▼
                                                       │  static_routes, intent │     ┌───────────────┐
                                                       └────────────────────┘     │ ConfigArtifact │
                                                                                    │ (content, vendor)│
                                                                                    └───────────────┘
```

Langkah konkret (selaras `backend/app/services/configgen.py`):

1. User/operator mendefinisikan **intent** ForgeOS dalam YAML (lihat `forgeos/schema.md`) —
   ini adalah deskripsi *maksud* vendor-neutral: "node ini PE BGP AS 65001, redistribute OSPF,
   EVPN-VXLAN VNI 100", bukan sintaks CLI.
2. Intent disimpan di field `node.intent` (dict) pada model `Node`. Field-field intent yang
   dikenali compiler: `bgp`, `ospf`, `isis`, `vrfs`, `vlans`, `evpn`, `fhrp`, `static_routes`.
3. Fungsi `_context(node)` meratakan (`flatten`) `node` + `node.intent` menjadi **satu dict
   konteks tunggal** yang dilihat oleh SEMUA template vendor secara identik:
   ```python
   {
     "hostname": node.name, "kind": node.kind, "nos": node.nos,
     "interfaces": [...],            # dari node.interfaces (fisik)
     "bgp": intent.get("bgp"),
     "ospf": intent.get("ospf"),
     "isis": intent.get("isis"),
     "vrfs": intent.get("vrfs", []),
     "vlans": intent.get("vlans", []),
     "evpn": intent.get("evpn"),
     "fhrp": intent.get("fhrp"),
     "static_routes": intent.get("static_routes", []),
     "intent": intent,               # raw, untuk akses field non-standar di template forgeos.j2
   }
   ```
4. `render(node, vendor)` memilih file template lewat `_TEMPLATE_MAP` berdasarkan `vendor` yang
   diminta (bisa berbeda dari `node.nos` asli — **inilah mekanisme "satu intent → banyak vendor"**),
   lalu merender template tersebut dengan context di atas memakai `jinja2.sandbox.SandboxedEnvironment`.
5. Hasil render (string CLI/config) dibungkus jadi `ConfigArtifact { id, node_id, vendor,
   format=cli, content, generated_at }` sesuai model §4 MASTER_SPEC, siap disimpan/ditampilkan/
   dikirim ke device emulasi (containerlab) atau diunduh user.

### Pemetaan vendor → template (`_TEMPLATE_MAP`, sumber kebenaran di `configgen.py`)

| `nos` / vendor diminta | Template file | Catatan |
|---|---|---|
| `ios` | `cisco_ios.j2` | Cisco IOS classic |
| `iosxr` | `cisco_ios.j2` | Baseline v0.1 — dipetakan sama dgn IOS (sintaks cukup dekat utk fitur dasar; divergensi XR sejati seperti `commit`-model belum dimodelkan, lihat roadmap) |
| `nxos` | `cisco_ios.j2` | Baseline v0.1 — sama alasannya dengan IOS-XR |
| `junos` | `junos.j2` | Juniper Junos, gaya `set` |
| `eos` | `arista_eos.j2` | Arista EOS — satu-satunya template dengan blok EVPN-VXLAN aktif (lihat §3) |
| `routeros` | `mikrotik_routeros.j2` | MikroTik RouterOS, gaya script `/path add ...` |
| `vyos` | `vyos.j2` | VyOS, gaya `set` (mirip Junos, beda namespace) |
| `frr` | `frr.j2` | FRRouting — default NOS open-source untuk mode `emul` |
| `forgeos` | `forgeos.j2` | Native ForgeOS — render *vendor-neutral* berupa echo terstruktur dari intent itu sendiri |

Jika `vendor` tidak ada di tabel ini, `configgen.render()` melempar `ConfigGenError`. Menambah
vendor baru = menambah satu baris di `_TEMPLATE_MAP` (punya `backend-network-sim-architect`) +
satu file `.j2` baru di folder ini (punya `network-engineer`) — lihat §4 untuk checklist.

## 2. Mengapa Jinja2 `SandboxedEnvironment`, bukan `Environment` biasa

Konfigurasi device adalah **CLI teks**, bukan HTML, jadi `autoescape=False`. Namun karena
`node.intent` bisa berasal dari input pengguna (lewat UI/JSON API), template dirender dalam
`SandboxedEnvironment` (bukan `Environment` biasa) untuk membatasi akses atribut Python dan
mencegah Server-Side Template Injection (SSTI) — lihat `security/hardening-guide.md` §4
(kepemilikan `security-pentest-debugger`). Implikasi untuk penulisan template di folder ini:

- **Jangan** memakai filter/global Jinja2 yang membuka akses ke objek Python arbitrer
  (`__class__`, `__globals__`, dll — sandbox sudah memblokir, tapi tetap hindari pola yang
  bergantung padanya).
- `StrictUndefined` aktif — mengakses key intent yang tidak ada **akan error**, bukan diam-diam
  jadi string kosong. Karena itu setiap akses field opsional **wajib** memakai `| default(...)`
  atau dibungkus `{% if %}` (lihat semua template yang sudah ada — pola ini konsisten dipakai).
- Tiga filter custom terdaftar di `_env()`:

| Filter | Fungsi | Contoh |
|---|---|---|
| `cidr_to_mask` | `"10.0.0.1/24"` → `"255.255.255.0"` (dotted netmask) | dipakai `cisco_ios.j2` utk sintaks `ip address <ip> <mask>` |
| `ip_only` | `"10.0.0.1/24"` → `"10.0.0.1"` | dipakai saat vendor butuh IP & mask/prefix terpisah |
| `prefixlen` | `"10.0.0.1/24"` → `"24"` | komplemen `ip_only`, untuk vendor yang butuh prefix length terpisah |

Junos/VyOS/RouterOS/EOS umumnya menerima format CIDR langsung (`10.0.0.1/24`) jadi tidak perlu
filter ini; Cisco IOS classic butuh format `<ip> <netmask>` sehingga `cisco_ios.j2` memakainya.

## 3. Status & Cakupan Fitur per Template (kondisi aktual saat ini)

Tabel ini mencerminkan **apa yang benar-benar dirender** oleh tiap `.j2` saat ini — selaras
matriks protokol di `../network/protocols/README.md` tapi mempersempit ke "apa yang sudah ada
baris Jinja-nya", bukan "apa yang didukung engine simulasi secara konsep".

| Field intent | cisco_ios | junos | arista_eos | mikrotik_routeros | vyos | frr | forgeos |
|---|---|---|---|---|---|---|---|
| `interfaces[]` (IP, MTU) | ✅ | ✅ | ✅ (+ no switchport) | ✅ (IP saja) | ✅ | ✅ | ✅ |
| `vlans[]` | — | — | ✅ | ✅ (`/interface vlan`) | ✅ (`vif`) | — (lihat catatan FRR di bawah) | ✅ (ringkas) |
| `ospf` (router_id, networks/area) | ✅ | ✅ | ✅ (router-id saja, network via area belum) | ✅ | ✅ | ✅ | ✅ (router_id saja) |
| `bgp` (asn, neighbors, networks) | ✅ | ✅ (tanpa networks/AF block) | ✅ (+ EVPN AF jika `nb.evpn`) | ✅ (gaya connection) | ✅ (+ AF l2vpn-evpn jika `nb.evpn`) | ✅ (+ AF l2vpn evpn jika `evpn`) | ✅ |
| `isis` | ✅ (`router isis`) | ✅ (`set protocols isis`, NET via `lo0` family iso) | ✅ (`router isis <tag>`) | — (RouterOS tidak punya daemon IS-IS, gap vendor bukan gap template) | ✅ (`set protocols isis`) | ✅ (`router isis`, `isisd`) | ✅ (ringkas: net/level/jumlah interface) |
| `vrfs[]` (rd, import, export) | ✅ | ✅ (routing-instances) | ✅ (`vrf instance` + per-VRF `router bgp ... vrf`) | ✅ (`/ip vrf` + `vrf-import-rt`/`vrf-export-rt`) | ✅ (`set vrf name`) | ✅ (`vrf` stanza + per-VRF `router bgp ... vrf`, butuh `bgp` intent terisi) | ✅ (ringkas) |
| `evpn` (vnis[]) | — (NX-OS EVPN beda signifikan dari IOS classic, belum dimodelkan — lihat roadmap) | — (Junos EVPN butuh `set routing-instances ... instance-type evpn` + switch-options, belum dimodelkan — roadmap) | ✅ (interface Vxlan1 + vni map) | ✅ (`/interface vxlan` per VNI + bridge port `pvid`) | ✅ (`set interfaces vxlan` + `vni-to-vlan`) | ✅ (`address-family l2vpn evpn` + `advertise-all-vni`, level BGP saja — data-plane VXLAN ada di kernel/`ip link`, di luar `frr.conf`) | ✅ (ringkas: jumlah VNI) |
| `fhrp` (vrrp/hsrp) | ✅ (standby/HSRP-style) | ✅ (vrrp-group) | ✅ (native `vrrp` di EOS, bukan `standby`) | ✅ (`/interface vrrp`) | ✅ (`set high-availability vrrp`, VyOS 1.3+) | — (lihat "FRR + keepalived" di bawah — gap arsitektural, disengaja) | — (native echo belum memodelkan fhrp, gap minor) |
| `static_routes[]` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | — (gap minor, jarang fokus skenario EVPN/L3VPN) |

**Status per 2026-06-24**: gap `isis`/`vrfs`/`evpn`+`vlans` yang tercatat di README §3 versi
sebelumnya dan di `../network/protocols/NEEDS.md` §3 sudah **ditutup** di seluruh template yang
secara vendor-real mendukung fitur tersebut. Sisa "—" di tabel atas adalah **gap vendor-capability
yang disengaja** (bukan baris Jinja yang terlewat) — dijelaskan satu per satu di bawah.

**Gap yang TERSISA (disengaja, bukan bug)**:
- `isis` di `mikrotik_routeros.j2` — RouterOS (semua versi, termasuk v7) tidak punya daemon IS-IS
  sama sekali; tidak ada baris CLI yang valid untuk ini, jadi sengaja tidak dirender (lihat komentar
  di kepala file template).
- `evpn` di `cisco_ios.j2`/`junos.j2` — EVPN-VXLAN asli di NX-OS (`nv overlay`, `evpn` submode) dan
  Junos (`routing-instances ... instance-type evpn`, `switch-options`) punya model konfigurasi yang
  jauh berbeda dari baseline IOS classic/Junos `set` yang dipakai template ini saat ini; menambahnya
  dengan benar butuh template/cabang vendor terpisah (mis. `cisco_nxos.j2` sendiri, bukan dibagi
  dengan `cisco_ios.j2`) — dicatat sbg roadmap Fase 3, lihat `NEEDS.md`.
- `fhrp` di `frr.j2` — **lihat sub-bagian "FRR + keepalived" di bawah.**
- `fhrp` di `forgeos.j2` — native ForgeOS echo belum memodelkan FHRP secara ringkas; gap minor,
  tidak memblokir skenario manapun saat ini.
- `vlans` di `frr.j2` — FRR adalah *routing* daemon suite (zebra/bgpd/ospfd/isisd/...), VLAN/bridge
  adalah konsep Linux kernel (`ip link add vlanX type vlan ...` / `bridge vlan`), bukan sesuatu yang
  dikonfigurasi lewat `vtysh`/`frr.conf` — sengaja tidak dirender di sini, sama prinsipnya dengan
  FHRP+keepalived di bawah (di luar lingkup satu file `.conf`).
- `static_routes` di `forgeos.j2` — gap minor, native view ini memang disederhanakan.

### FRR + keepalived — pendekatan integrasi untuk `fhrp` (bukan baris di `frr.j2`)

FRR (`zebra`/`bgpd`/`ospfd`/`isisd`/dst.) **tidak punya daemon VRRP/HSRP native**. VRRP di atas
Linux+FRR secara nyata diimplementasikan oleh paket **`keepalived`** terpisah yang berjalan
berdampingan dengan FRR, masing-masing dengan file config sendiri (`keepalived.conf`, format
`vrrp_instance { ... }`, BUKAN `frr.conf`/`vtysh`). Karena itu `frr.j2` **sengaja tidak**
menyuntikkan sintaks VRRP palsu ke `frr.conf` — itu akan menghasilkan config yang terlihat valid
tapi tidak pernah benar-benar dipakai FRR daemon manapun (functionally dead config, lebih buruk
daripada tidak ada output sama sekali).

Pendekatan yang didokumentasikan di sini (keputusan arsitektur, bukan baris Jinja):

1. **Artefak terpisah**: jika `node.intent.fhrp` ada dan `vendor == "frr"`, `configgen.py` (pemilik
   `backend-network-sim-architect`) idealnya menghasilkan **dua** `ConfigArtifact` untuk node
   tersebut — satu `format=cli` isi `frr.conf` (dari `frr.j2`, tanpa fhrp), satu lagi artefak baru
   (mis. `format=keepalived` atau `vendor="frr-keepalived"`) berisi `keepalived.conf` yang
   di-generate dari template terpisah, mis. `config-gen/templates/frr_keepalived.j2` (belum dibuat —
   item ini dicatat sbg follow-up, bukan bagian dari penutupan gap render saat ini karena butuh
   keputusan skema artefak baru dari pemilik `configgen.py`).
2. **Pemetaan field intent → `keepalived.conf`** (rencana skema, memakai field `fhrp` yang sama):
   ```
   vrrp_instance VI_{{ fhrp.group }} {
       interface {{ fhrp.interface }}
       state {{ 'MASTER' if fhrp.priority | default(100) >= 150 else 'BACKUP' }}
       virtual_router_id {{ fhrp.group }}
       priority {{ fhrp.priority | default(100) }}
       advert_int 1
       {% if fhrp.preempt | default(true) == false %}nopreempt{% endif %}
       virtual_ipaddress {
           {{ fhrp.vip }}
       }
   }
   ```
   (Sintaks `keepalived.conf` nyata, gaya VyOS/Debian — bukan placeholder.)
3. **Mengapa tidak dipaksa ke satu file**: `frr.conf` dan `keepalived.conf` punya siklus hidup
   proses berbeda (`systemctl restart frr` vs `systemctl restart keepalived`) — menggabungkannya
   jadi satu artefak akan menyesatkan operator soal *service mana yang benar-benar membaca baris
   yang mana*. Ini sejalan dengan prinsip §5 keamanan: jangan hasilkan config yang "terlihat
   siap pakai" tapi sebenarnya tidak fungsional.
4. **Koordinasi lanjutan**: kebutuhan field/skema artefak baru di atas sudah dicatat ke
   `NEEDS.md` untuk `backend-network-sim-architect` — `network-engineer` tidak menambah field baru
   ke `_context()` secara sepihak karena itu di luar kepemilikan folder ini.

Menambah baris fitur ke template yang sudah ada **harus** mengikuti pola yang sudah dipakai
(`{% if x %}` + `| default(...)` + indentasi sintaks asli vendor) — lihat `forgeos/mappings/`
untuk peta lengkap field intent → baris config per vendor sebagai acuan saat menambah baris baru.

## 4. Checklist Menambah Vendor / Fitur Baru

**Menambah vendor baru** (mis. Nokia SR OS, Huawei VRP — lihat roadmap MASTER_SPEC §1):
1. Buat `config-gen/templates/<vendor>.j2` (flat, langsung di `templates/`, jangan buat subfolder).
2. Minta `backend-network-sim-architect` menambah baris di `_TEMPLATE_MAP` (`backend/app/services/configgen.py`) — ini di luar kepemilikan `network-engineer`, catat di `NEEDS.md`.
3. Pakai context keys yang sama (`hostname, kind, nos, interfaces, bgp, ospf, isis, vrfs, vlans, evpn, fhrp, static_routes, intent`) — **jangan** minta field baru tanpa koordinasi, karena context dibangun satu kali untuk semua vendor.
4. Uji render manual dengan salah satu contoh di `forgeos/examples/` sebagai input intent.

**Menambah fitur (field intent baru)**:
1. Definisikan dulu strukturnya di `forgeos/schema.md`.
2. Tambahkan ke semua 7 template yang relevan (atau catat sebagai gap di §3 tabel atas jika belum sempat).
3. Update `forgeos/mappings/intent-to-vendor-mapping.md` dengan baris pemetaan baru.
4. Jika field butuh muncul di `_context()` (belum ada key-nya), catat kebutuhan di `NEEDS.md` untuk `backend-network-sim-architect`.

## 5. Keamanan

- Sandbox Jinja2 (lihat §2) adalah mitigasi SSTI **di level rendering**. Template sendiri tidak
  boleh menulis nilai intent mentah ke posisi yang bisa membentuk command injection di CLI vendor
  (mis. `description "{{ nb.description }}"` pada `junos.j2` — nilai `nb.description` berasal dari
  user input, harus disanitasi di layer `backend` sebelum masuk context; ini dicatat sbg item
  koordinasi ke `security-pentest-debugger`, lihat `security/hardening-guide.md`).
- Jangan pernah menaruh kredensial/password default di template (`enable secret`, SNMP community,
  dll) — biarkan field tersebut wajib diisi dari intent, error jika kosong (manfaatkan
  `StrictUndefined`), supaya tidak ada config "siap pakai" dengan password lemah ter-hardcode.

## Lihat Juga

- `forgeos/schema.md` — skema lengkap intent YAML ForgeOS.
- `forgeos/examples/` — contoh intent YAML siap pakai (PE BGP+OSPF, leaf EVPN-VXLAN).
- `forgeos/mappings/intent-to-vendor-mapping.md` — pemetaan field intent → baris config per vendor.
- `../network/protocols/README.md` — matriks dukungan protokol level-engine (lebih luas dari yang
  sudah ter-render template, lihat gap di §3 di atas).
- `../network/protocols/scenarios/` — skenario yang dipakai sebagai sumber contoh intent.
- `NEEDS.md` (folder ini) — kebutuhan ke `backend-network-sim-architect` & `security-pentest-debugger`.
