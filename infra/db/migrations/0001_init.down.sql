-- =============================================================================
-- Migration 0001 — init (DOWN / rollback)
-- Membatalkan migrasi 0001. DESTRUKTIF: menghapus seluruh data NetGeo.
-- Urutan drop memperhatikan dependensi FK (anak -> induk) lalu type & schema.
-- =============================================================================
BEGIN;
SET search_path TO netgeo, public;

DROP VIEW  IF EXISTS v_project_topology;

DROP TABLE IF EXISTS simulation_run   CASCADE;
DROP TABLE IF EXISTS config_artifact  CASCADE;
DROP TABLE IF EXISTS scenario         CASCADE;
DROP TABLE IF EXISTS link             CASCADE;
DROP TABLE IF EXISTS iface            CASCADE;
DROP TABLE IF EXISTS node             CASCADE;
DROP TABLE IF EXISTS project_member   CASCADE;
DROP TABLE IF EXISTS project          CASCADE;
DROP TABLE IF EXISTS app_user         CASCADE;

DROP FUNCTION IF EXISTS set_updated_at();

DROP TYPE IF EXISTS user_role;
DROP TYPE IF EXISTS config_format;
DROP TYPE IF EXISTS link_type;
DROP TYPE IF EXISTS iface_type;
DROP TYPE IF EXISTS node_status;
DROP TYPE IF EXISTS node_mode;
DROP TYPE IF EXISTS nos_kind;
DROP TYPE IF EXISTS node_kind;

-- Schema dibiarkan (mungkin dipakai objek lain). Hapus manual bila perlu:
-- DROP SCHEMA IF EXISTS netgeo CASCADE;

COMMIT;
