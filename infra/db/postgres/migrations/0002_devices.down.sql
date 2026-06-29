-- =============================================================================
-- NetGeo — Migration 0002: DEVICES (DOWN / rollback)
-- DESTRUCTIVE: drops the device library + all project device instances.
-- Run AFTER 0003..0006 down-migrations (they depend on interfaces/devices).
-- =============================================================================
BEGIN;
SET search_path TO netgeo, public;

-- Break cyclic FKs first.
ALTER TABLE IF EXISTS netgeo.device_instances DROP CONSTRAINT IF EXISTS device_instances_active_config_fk;

DROP TABLE IF EXISTS netgeo.interface_vlans      CASCADE;
DROP TABLE IF EXISTS netgeo.vlans                CASCADE;
DROP TABLE IF EXISTS netgeo.interface_addresses  CASCADE;
DROP TABLE IF EXISTS netgeo.interfaces           CASCADE;
DROP TABLE IF EXISTS netgeo.device_configs       CASCADE;
DROP TABLE IF EXISTS netgeo.device_instances     CASCADE;
DROP TABLE IF EXISTS netgeo.device_models        CASCADE;
DROP TABLE IF EXISTS netgeo.operating_systems    CASCADE;
DROP TABLE IF EXISTS netgeo.vendors              CASCADE;

DROP TYPE IF EXISTS netgeo.vlan_mode;
DROP TYPE IF EXISTS netgeo.config_format;
DROP TYPE IF EXISTS netgeo.oper_status;
DROP TYPE IF EXISTS netgeo.admin_status;
DROP TYPE IF EXISTS netgeo.interface_kind;
DROP TYPE IF EXISTS netgeo.device_status;
DROP TYPE IF EXISTS netgeo.device_mode;
DROP TYPE IF EXISTS netgeo.device_category;

DELETE FROM netgeo.schema_migrations WHERE version = '0002';

COMMIT;
