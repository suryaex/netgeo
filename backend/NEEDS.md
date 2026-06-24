# Backend — Kebutuhan Lintas-Area (NEEDS)

Backend menulis HANYA di `backend/`. Berikut yang dibutuhkan dari area agent
lain agar integrasi penuh berjalan. Orchestrator yang menyatukan.

## 1. `config-gen/` — template Jinja2 per-vendor  → `network-engineer`
- **Dipakai oleh**: `app/services/configgen.py` (memuat dari
  `config-gen/templates/<vendor>.j2`).
- **Status**: template baseline SUDAH ADA dan teruji (ios, junos, eos,
  routeros, vyos, frr, forgeos) — test `tests/test_configgen.py` hijau.
- **Kontrak konteks render** (key yang dibaca template, lihat `_context()`):
  `hostname, kind, nos, interfaces[], bgp, ospf, isis, vrfs[], vlans[], evpn,
  fhrp, static_routes[], intent`.
  - Catatan: template memakai `StrictUndefined` — bila sub-tree disertakan,
    field wajibnya harus lengkap (mis. `ospf` butuh `router_id`).
- **Diminta**: template untuk NOS sisa (iosxr, nxos, sros, vrp) + skema intent
  ForgeOS final (`config-gen/forgeos/schema.md`) sebagai sumber kebenaran key
  konteks.

## 2. `infra/db/schema.sql` — DDL PostgreSQL  → `db-devops-architect`
- **Dipakai oleh**: `app/store/postgres.py` (sketsa ORM saat ini).
- **Diminta**: DDL kanonik (tabel projects/nodes/links/scenarios/
  config_artifacts) + index, FK `ON DELETE CASCADE`, tipe JSONB untuk
  `interfaces`/`intent`/`steps`. Nama kolom WAJIB cocok dengan `models/schemas.py`
  (§4). Sketsa ORM kami mengikuti, bukan mendefinisikan, schema produksi.
- **Diminta**: pola koneksi Redis (state realtime / pub-sub WS / job queue)
  bila ada konvensi bersama (`infra/redis-design.md`).

## 3. Spec protokol & skenario  → `network-engineer` / `network-backbone-datacenter-advisor`
- **Dipakai oleh**: `engine/protocols/` (subclass `NodeRuntime`).
- **Diminta**: daftar protokol prioritas (OSPFv3, IS-IS, BGP, EVPN-VXLAN) +
  skenario uji skala besar (spine-leaf, ISP/FTTH, backbone) untuk validasi
  engine pada ribuan node.

## 4. Kontrak tipe frontend  → `frontend-architecture-advisor`
- **Acuan**: `frontend/src/api/types.ts` + `client.ts` harus tetap selaras
  dengan `models/schemas.py` (§4). Bila frontend mengubah bentuk payload,
  koordinasikan agar enum/field tetap identik di kedua sisi.

## 5. Emulasi  → orchestrator / `db-devops-architect`
- **Dipakai oleh**: `engine/emulation/` (`EmulationAdaptor` ABC).
- **Diminta**: ketersediaan runtime containerlab/Docker di lingkungan dev/prod
  + image NOS, agar adaptor konkret (mis. `containerlab.py`) bisa dibangun.
  Default saat ini `NullEmulationAdaptor` (run murni-sim, import-able tanpa
  Docker).
