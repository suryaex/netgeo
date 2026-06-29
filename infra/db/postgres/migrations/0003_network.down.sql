-- =============================================================================
-- NetGeo — Migration 0003: NETWORK / WIRELESS / OPTICAL (DOWN / rollback)
-- DESTRUCTIVE: drops links, L3 control plane, wireless and optical plant.
-- Run AFTER 0004..0006 down-migrations; BEFORE 0002 down.
-- =============================================================================
BEGIN;
SET search_path TO netgeo, public;

-- Break the cyclic FK added back onto interfaces (from 0002).
ALTER TABLE IF EXISTS netgeo.interfaces DROP CONSTRAINT IF EXISTS interfaces_peer_link_fk;

-- Optical
DROP TABLE IF EXISTS netgeo.fiber_links     CASCADE;
DROP TABLE IF EXISTS netgeo.onts            CASCADE;
DROP TABLE IF EXISTS netgeo.splitters       CASCADE;
DROP TABLE IF EXISTS netgeo.olts            CASCADE;
-- Wireless
DROP TABLE IF EXISTS netgeo.radios          CASCADE;
DROP TABLE IF EXISTS netgeo.wireless_sites  CASCADE;
DROP TABLE IF EXISTS netgeo.rf_profiles     CASCADE;
DROP TABLE IF EXISTS netgeo.channels        CASCADE;
DROP TABLE IF EXISTS netgeo.antennas        CASCADE;
-- L3 control plane
DROP TABLE IF EXISTS netgeo.qos_profiles    CASCADE;
DROP TABLE IF EXISTS netgeo.firewall_rules  CASCADE;
DROP TABLE IF EXISTS netgeo.nat_rules       CASCADE;
DROP TABLE IF EXISTS netgeo.isis_instances  CASCADE;
DROP TABLE IF EXISTS netgeo.ospf_areas      CASCADE;
DROP TABLE IF EXISTS netgeo.bgp_neighbors   CASCADE;
DROP TABLE IF EXISTS netgeo.static_routes   CASCADE;
DROP TABLE IF EXISTS netgeo.routing_tables  CASCADE;
-- Links
DROP TABLE IF EXISTS netgeo.links           CASCADE;
DROP TABLE IF EXISTS netgeo.link_profiles   CASCADE;

DROP TYPE IF EXISTS netgeo.fiber_kind;
DROP TYPE IF EXISTS netgeo.pon_tech;
DROP TYPE IF EXISTS netgeo.antenna_kind;
DROP TYPE IF EXISTS netgeo.radio_tech;
DROP TYPE IF EXISTS netgeo.rf_band;
DROP TYPE IF EXISTS netgeo.fw_direction;
DROP TYPE IF EXISTS netgeo.fw_action;
DROP TYPE IF EXISTS netgeo.nat_kind;
DROP TYPE IF EXISTS netgeo.isis_level;
DROP TYPE IF EXISTS netgeo.ospf_area_type;
DROP TYPE IF EXISTS netgeo.link_status;
DROP TYPE IF EXISTS netgeo.link_medium;

DELETE FROM netgeo.schema_migrations WHERE version = '0003';

COMMIT;
