-- =============================================================================
-- NetGeo — Migration 0004: GIS (DOWN / rollback)
-- DESTRUCTIVE: drops map projects/layers/tiles, terrain, buildings, population.
-- =============================================================================
BEGIN;
SET search_path TO netgeo, public;

DROP TABLE IF EXISTS netgeo.population     CASCADE;
DROP TABLE IF EXISTS netgeo.buildings      CASCADE;
DROP TABLE IF EXISTS netgeo.terrain_models CASCADE;
DROP TABLE IF EXISTS netgeo.map_tiles      CASCADE;
DROP TABLE IF EXISTS netgeo.map_layers     CASCADE;
DROP TABLE IF EXISTS netgeo.map_projects   CASCADE;

DROP TYPE IF EXISTS netgeo.terrain_source;
DROP TYPE IF EXISTS netgeo.map_layer_kind;

DELETE FROM netgeo.schema_migrations WHERE version = '0004';

COMMIT;
