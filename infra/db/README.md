# NetGeo — Database Layer (authoritative guide)

Owner: **db-devops-architect**. This document is the single source of truth for
*which* schema is authoritative, how the two historical migration trees relate,
and how to apply migrations.

---

## 1. TL;DR — which tree is authoritative?

```
infra/db/
├── postgres/migrations/   ✅ AUTHORITATIVE  (NetGeo Enterprise ERD)
│   ├── 0001_core.up/down.sql          workspace, RBAC, projects
│   ├── 0002_devices.up/down.sql       vendors, OS, models, instances, ifaces, vlans
│   ├── 0003_network.up/down.sql       links, L3 control plane, wireless, optical
│   ├── 0004_gis.up/down.sql           map projects/layers/tiles, terrain, buildings
│   └── 0005_simulation_metrics.*.sql  sims, runs, events, traces, time-series metrics
│
├── migrations/            🗄️ LEGACY   (MASTER_SPEC §4 "simple topology" model)
│   └── 0001_init.up/down.sql          app_user, project, node, iface, link, ...
└── schema.sql             🗄️ LEGACY   (single-file mirror of the legacy 0001_init)
```

**Authoritative = `infra/db/postgres/migrations/`, baseline `0001_core`.**
The new `0002`–`0005` migrations build directly on `0001_core` (same `netgeo`
schema, same `BIGINT GENERATED ALWAYS AS IDENTITY` + `uuid` convention, same
`netgeo.schema_migrations` ledger and `netgeo.attach_updated_at()` helper). They
are **not** compatible with the legacy baseline and must never be mixed with it.

### Why two trees exist

| | Legacy tree (`migrations/`, `schema.sql`) | Authoritative tree (`postgres/migrations/`) |
|---|---|---|
| Spec | `MASTER_SPEC.md §4`, `infra/db/ERD.md` | `NetGeo/08_DATABASE_AND_ERD.md` |
| Scope | Single-user topology editor (router/switch graph) | Multi-tenant enterprise platform (workspace, RBAC, GIS, metrics) |
| PK style | `UUID DEFAULT gen_random_uuid()` | `BIGINT … IDENTITY` surrogate + public `uuid` |
| Core tables | `app_user, project, node, iface, link, scenario, config_artifact, simulation_run` | `workspaces, users, roles, projects, device_instances, interfaces, links, …` |
| Status | Frozen — kept only because the **current backend store still targets it** (see §5) | Forward target — the intended schema per the ERD spec |

The legacy tree is **retained, not deleted**: the running backend's Postgres
sketch and Pydantic contract still speak the legacy table/column names. Deleting
it now would strand that code. It is superseded once the backend store is ported
to the enterprise schema (tracked as a flag in §5).

---

## 2. Conventions (authoritative tree)

* Surrogate PK: `id BIGINT GENERATED ALWAYS AS IDENTITY`
* Public/API id: `uuid UUID DEFAULT gen_random_uuid()` (UNIQUE)
* FKs: `<entity>_id` → `<entity>.id`; explicit `ON DELETE` on every FK
* Timestamps: `created_at` / `updated_at` (+ `deleted_at` for soft-deletable rows)
* `updated_at` auto-stamped via `netgeo.attach_updated_at(ARRAY[...])`
* Enums: native PostgreSQL `ENUM` in the `netgeo` schema, created inside a
  `DO`-block guard so re-runs don't error
* Flexible payloads: `JSONB` (+ GIN index where queried)
* High-volume time-series (`simulation_events`, `packet_traces`, `metrics`,
  `*_statistics`) are `PARTITION BY RANGE (ts)` with a DEFAULT partition and a
  `netgeo.ensure_time_partitions()` helper (schedule via pg_cron / pg_partman in prod)

Each migration is transactional (`BEGIN … COMMIT`) and records itself:
`INSERT INTO netgeo.schema_migrations(version, description) … ON CONFLICT DO NOTHING`.

---

## 3. Dependency & ordering (authoritative tree)

Apply **up** in ascending order, roll **down** in descending order:

```
0001_core      →  schema, helpers, enums, schema_migrations, workspaces, users,
                  roles/permissions, projects
0002_devices   →  vendors → operating_systems → device_models → device_instances
                  → device_configs (closes device_instances.active_config_id cycle)
                  → interfaces (peer_link_id left dangling) → interface_addresses
                  → vlans → interface_vlans
0003_network   →  link_profiles → links → CLOSES interfaces.peer_link_id → links.id
                  → routing/static/bgp/ospf/isis/nat/firewall/qos
                  → wireless (antennas/channels/rf_profiles/sites/radios)
                  → optical (olts/splitters/onts/fiber_links)
0004_gis       →  map_projects → map_layers → map_tiles; terrain/buildings/population
0005_sim+metrics→ simulations → simulation_runs → simulation_events(part.)
                  → packet_traces(part.) → traffic_generators
                  → metrics + interface/device/rf statistics (all partitioned)
```

**Cyclic FKs are handled explicitly** (and unwound in the down-migrations before
the referenced table is dropped):

* `device_instances.active_config_id → device_configs.id` — added at the end of
  `0002` (after `device_configs` exists); dropped first in `0002_down`.
* `interfaces.peer_link_id → links.id` — column declared in `0002`, FK added in
  `0003` (after `links` exists); dropped first in `0003_down`.

Cross-tree FK targets all resolve within the authoritative tree (`netgeo.projects`,
`netgeo.users`, `netgeo.workspaces`, `netgeo.interfaces`, `netgeo.device_instances`,
`netgeo.links`, `netgeo.simulation_runs`, `netgeo.radios`). Verified: no FK in
0002–0005 references a table that does not yet exist at apply time.

Full teardown order: `0005_down → 0004_down → 0003_down → 0002_down → 0001_down`.

---

## 4. How to apply

### A. Fresh container (automatic, first boot)
`docker-compose.yml` / `docker-compose.prod.yml` mount the authoritative tree
plus `postgres/bootstrap.sh` into `docker-entrypoint-initdb.d`. On an **empty**
data volume the bootstrap applies `0001 … 0005` in order. Nothing to run by hand.

```bash
make up            # dev stack; postgres self-bootstraps the full schema
```

### B. Existing / already-running database
Use the runner (idempotent — safe to re-run):

```bash
# from infra/db/postgres
export DATABASE_URL='postgres://netgeo:netgeo@localhost:5432/netgeo'
./migrate.sh up            # apply all pending
./migrate.sh up 0003       # apply up to & including 0003
./migrate.sh status        # applied vs available
./migrate.sh down 0005     # roll back one version (DESTRUCTIVE)
```

### C. Into the compose Postgres container (no local psql)
```bash
make migrate       # streams infra/db/postgres/migrations/*.up.sql through
                   # `docker compose exec -T postgres psql` in order
```

`DATABASE_URL` accepts the SQLAlchemy form (`postgresql+asyncpg://…`); the runner
strips the `+driver` suffix automatically.

---

## 5. ⚠️ Flagged: backend store ↔ schema mismatch (for the orchestrator)

The backend (read-only for this agent) still targets the **legacy** model, so it
does **not** line up with the authoritative enterprise schema:

| Backend artifact | Expects (legacy) | Authoritative tree provides |
|---|---|---|
| `backend/app/store/postgres.py` `ProjectRow` | table `projects`, PK `String(36)` UUID | `netgeo.projects` PK `BIGINT IDENTITY` (uuid is a *separate* column) |
| `NodeRow` | table `nodes` (+ JSONB `interfaces` column) | no `nodes`; closest is `netgeo.device_instances` + normalized `netgeo.interfaces` |
| `LinkRow` | table `links`, cols `a_iface`/`b_iface`/`bandwidth`/`delay`/`loss` | `netgeo.links`, cols `a_interface_id`/`b_interface_id`/`bandwidth_mbps`/`delay_ms`/`loss_pct` |
| `ScenarioRow` | table `scenarios` | no `scenarios`; scenario data folded into `netgeo.simulations.steps/expected` |
| `ConfigRow` | table `config_artifacts`, `node_id` | `netgeo.device_configs`, `device_instance_id` |
| `app/models/schemas.py` | flat `Node/Link/Iface`, integer-less UUID ids | `device_instances/interfaces/links` with bigint ids |

This is **pre-existing**, not introduced here: the legacy `store/postgres.py` is
an explicitly-disabled *sketch* (default store is `MemoryRepository`, which never
touches Postgres), and its docstring already points at `infra/db/schema.sql` (the
legacy file) as its DDL. So switching the bootstrap to the authoritative tree
does **not** break any running code today.

**Action required from the orchestrator / backend agent:** port
`app/store/postgres.py` + `app/models/schemas.py` to the enterprise schema (new
table/column names, bigint ids + uuid surface) before enabling
`PostgresRepository`. Until then, the legacy `schema.sql` / `migrations/0001_init`
remain on disk strictly as the reference for that pending port.

---

## 6. Brand / credential note (rebrand Phase 2)

Compose service env, image names and DB user/database are already `netgeo`
(`POSTGRES_USER=netgeo`, `POSTGRES_DB=netgeo`, `ghcr.io/netgeo/*`), so no
`netforge` literal remains in the infra compose env.

For **existing deployments** still running a `netforge` Postgres role/database,
do **not** hard-cut. Coordinated rename (per `docs/REBRAND_PLAN.md §8`):

```sql
-- 1. create the new role/db alongside the old one
CREATE ROLE netgeo LOGIN PASSWORD '...';
CREATE DATABASE netgeo OWNER netgeo;
-- 2. move data
--    pg_dump -U netforge -d netforge | psql -U netgeo -d netgeo
-- 3. update connection strings (compose, .env, CI) to netgeo
-- 4. only after verification, in a SEPARATE cleanup migration:
--    DROP DATABASE netforge;  DROP ROLE netforge;
```

`ForgeOS` / `forgeos` (the native declarative NOS, ERD §5) is a **feature name,
not the old brand** — it is intentionally left unchanged. The `nf:` Redis key
prefix in `infra/redis-design.md` is consumed by backend code and is left as-is
to avoid runtime divergence; renaming it is a separate, backend-coordinated task.
