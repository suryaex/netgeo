-- =============================================================================
-- NetGeo — Enterprise (PostgreSQL) — Migration 0004: GIS
-- =============================================================================
-- Map projects, layers, tile cache, terrain, buildings, population.
-- Spec: NetGeo/08_DATABASE_AND_ERD.md "GIS" + 05_MAP_ENGINE.md.
--
-- Geometry is stored as GeoJSON in JSONB to avoid a hard PostGIS dependency for
-- the community/dev path. PostGIS columns can be layered on later (see note at
-- end). Coordinates default to EPSG:4326 (WGS84 lat/lon).
--
-- Depends on: 0001_core (projects).
-- =============================================================================
BEGIN;
SET search_path TO netgeo, public;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname='map_layer_kind') THEN
        CREATE TYPE netgeo.map_layer_kind AS ENUM
            ('tile','vector','geojson','raster','heatmap','marker','wms','wmts');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname='terrain_source') THEN
        CREATE TYPE netgeo.terrain_source AS ENUM ('srtm','aster','lidar','custom');
    END IF;
END$$;

-- =============================================================================
-- MAP_PROJECTS  (a GIS context attached to a project)
-- =============================================================================
CREATE TABLE netgeo.map_projects (
    id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    uuid         UUID   NOT NULL DEFAULT gen_random_uuid(),
    project_id   BIGINT NOT NULL REFERENCES netgeo.projects(id) ON DELETE CASCADE,
    name         TEXT   NOT NULL,
    crs          TEXT   NOT NULL DEFAULT 'EPSG:4326',
    center_lat   DOUBLE PRECISION,
    center_lon   DOUBLE PRECISION,
    default_zoom INTEGER NOT NULL DEFAULT 5,
    bbox         JSONB  NOT NULL DEFAULT '{}'::jsonb,  -- [minLon,minLat,maxLon,maxLat]
    attributes   JSONB  NOT NULL DEFAULT '{}'::jsonb,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT map_projects_uuid_uq UNIQUE (uuid),
    CONSTRAINT map_projects_name_uq UNIQUE (project_id, name),
    CONSTRAINT map_projects_zoom_chk CHECK (default_zoom BETWEEN 0 AND 24)
);
CREATE INDEX idx_map_projects_project ON netgeo.map_projects(project_id);

-- =============================================================================
-- MAP_LAYERS
-- =============================================================================
CREATE TABLE netgeo.map_layers (
    id             BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    uuid           UUID   NOT NULL DEFAULT gen_random_uuid(),
    map_project_id BIGINT NOT NULL REFERENCES netgeo.map_projects(id) ON DELETE CASCADE,
    name           TEXT   NOT NULL,
    kind           netgeo.map_layer_kind NOT NULL DEFAULT 'tile',
    source_url     TEXT,
    z_index        INTEGER NOT NULL DEFAULT 0,
    is_visible     BOOLEAN NOT NULL DEFAULT TRUE,
    opacity        NUMERIC(4,3) NOT NULL DEFAULT 1.0,
    min_zoom       INTEGER NOT NULL DEFAULT 0,
    max_zoom       INTEGER NOT NULL DEFAULT 22,
    style          JSONB  NOT NULL DEFAULT '{}'::jsonb,
    attributes     JSONB  NOT NULL DEFAULT '{}'::jsonb,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT map_layers_uuid_uq UNIQUE (uuid),
    CONSTRAINT map_layers_name_uq UNIQUE (map_project_id, name),
    CONSTRAINT map_layers_opacity_chk CHECK (opacity BETWEEN 0 AND 1)
);
CREATE INDEX idx_map_layers_mapproj ON netgeo.map_layers(map_project_id, z_index);

-- =============================================================================
-- MAP_TILES  (offline tile cache; can grow large — store object key, not bytes)
-- =============================================================================
CREATE TABLE netgeo.map_tiles (
    id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    map_layer_id BIGINT NOT NULL REFERENCES netgeo.map_layers(id) ON DELETE CASCADE,
    z            INTEGER NOT NULL,
    x            INTEGER NOT NULL,
    y            INTEGER NOT NULL,
    format       TEXT   NOT NULL DEFAULT 'png',
    storage_key  TEXT,                              -- object-storage key (preferred)
    data         BYTEA,                             -- inline fallback (small/offline)
    etag         TEXT,
    size_bytes   INTEGER,
    fetched_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at   TIMESTAMPTZ,
    CONSTRAINT map_tiles_zxy_uq CHECK (z BETWEEN 0 AND 24),
    CONSTRAINT map_tiles_uq     UNIQUE (map_layer_id, z, x, y)
);
CREATE INDEX idx_map_tiles_layer ON netgeo.map_tiles(map_layer_id);
CREATE INDEX idx_map_tiles_expiry ON netgeo.map_tiles(expires_at) WHERE expires_at IS NOT NULL;

-- =============================================================================
-- TERRAIN_MODELS  (DEM references)
-- =============================================================================
CREATE TABLE netgeo.terrain_models (
    id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    uuid         UUID   NOT NULL DEFAULT gen_random_uuid(),
    project_id   BIGINT NOT NULL REFERENCES netgeo.projects(id) ON DELETE CASCADE,
    name         TEXT   NOT NULL,
    source       netgeo.terrain_source NOT NULL DEFAULT 'srtm',
    resolution_m NUMERIC(8,2),
    bbox         JSONB  NOT NULL DEFAULT '{}'::jsonb,
    storage_key  TEXT,
    attributes   JSONB  NOT NULL DEFAULT '{}'::jsonb,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT terrain_models_uuid_uq UNIQUE (uuid),
    CONSTRAINT terrain_models_name_uq UNIQUE (project_id, name)
);
CREATE INDEX idx_terrain_models_project ON netgeo.terrain_models(project_id);

-- =============================================================================
-- BUILDINGS  (footprints for line-of-sight / RF obstruction)
-- =============================================================================
CREATE TABLE netgeo.buildings (
    id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    uuid        UUID   NOT NULL DEFAULT gen_random_uuid(),
    project_id  BIGINT NOT NULL REFERENCES netgeo.projects(id) ON DELETE CASCADE,
    name        TEXT,
    footprint   JSONB  NOT NULL DEFAULT '{}'::jsonb,  -- GeoJSON polygon
    centroid_lat DOUBLE PRECISION,
    centroid_lon DOUBLE PRECISION,
    height_m    NUMERIC(7,2),
    levels      INTEGER,
    attributes  JSONB  NOT NULL DEFAULT '{}'::jsonb,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT buildings_uuid_uq UNIQUE (uuid)
);
CREATE INDEX idx_buildings_project ON netgeo.buildings(project_id);
CREATE INDEX idx_buildings_footprint ON netgeo.buildings USING GIN (footprint);

-- =============================================================================
-- POPULATION  (demand modelling / coverage planning)
-- =============================================================================
CREATE TABLE netgeo.population (
    id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    uuid            UUID   NOT NULL DEFAULT gen_random_uuid(),
    project_id      BIGINT NOT NULL REFERENCES netgeo.projects(id) ON DELETE CASCADE,
    area_name       TEXT,
    centroid_lat    DOUBLE PRECISION,
    centroid_lon    DOUBLE PRECISION,
    geom            JSONB  NOT NULL DEFAULT '{}'::jsonb,  -- GeoJSON polygon
    headcount       BIGINT,
    density_per_km2 NUMERIC(12,2),
    year            INTEGER,
    source          TEXT,
    attributes      JSONB  NOT NULL DEFAULT '{}'::jsonb,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT population_uuid_uq UNIQUE (uuid)
);
CREATE INDEX idx_population_project ON netgeo.population(project_id);

-- -----------------------------------------------------------------------------
-- updated_at triggers (map_tiles has no updated_at — cache rows are replaced)
-- -----------------------------------------------------------------------------
SELECT netgeo.attach_updated_at(ARRAY[
    'map_projects','map_layers','terrain_models','buildings','population'
]);

-- NOTE (PostGIS, optional/enterprise): to enable true spatial queries, run
--   CREATE EXTENSION IF NOT EXISTS postgis;
-- then ALTER TABLE ... ADD COLUMN geom geometry(...) + GIST index. The JSONB
-- GeoJSON columns above remain the portable source; PostGIS becomes a derived
-- spatial index. Kept out of the base migration to preserve community parity.

INSERT INTO netgeo.schema_migrations(version, description)
VALUES ('0004','gis: map projects, layers, tiles, terrain, buildings, population')
ON CONFLICT DO NOTHING;

COMMIT;
