-- =============================================================================
-- NetGeo — Migration 0001: CORE (DOWN / rollback)
-- DESTRUCTIVE: drops all core tables, RBAC, projects and their data.
-- Run later domain down-migrations (0006 -> 0001) BEFORE this one.
-- =============================================================================
BEGIN;
SET search_path TO netgeo, public;

DROP TABLE IF EXISTS netgeo.project_members   CASCADE;
DROP TABLE IF EXISTS netgeo.project_tags      CASCADE;
DROP TABLE IF EXISTS netgeo.project_versions  CASCADE;
DROP TABLE IF EXISTS netgeo.projects          CASCADE;
DROP TABLE IF EXISTS netgeo.workspace_members CASCADE;
DROP TABLE IF EXISTS netgeo.api_keys          CASCADE;
DROP TABLE IF EXISTS netgeo.role_permissions  CASCADE;
DROP TABLE IF EXISTS netgeo.permissions       CASCADE;
DROP TABLE IF EXISTS netgeo.roles             CASCADE;
DROP TABLE IF EXISTS netgeo.users             CASCADE;
DROP TABLE IF EXISTS netgeo.workspace_settings CASCADE;
DROP TABLE IF EXISTS netgeo.workspaces        CASCADE;

DROP TYPE IF EXISTS netgeo.api_key_status;
DROP TYPE IF EXISTS netgeo.project_status;
DROP TYPE IF EXISTS netgeo.edition_type;

DROP FUNCTION IF EXISTS netgeo.attach_updated_at(text[]);
DROP FUNCTION IF EXISTS netgeo.set_updated_at();

DELETE FROM netgeo.schema_migrations WHERE version = '0001';
-- schema_migrations + schema itself are kept (drop manually if truly tearing down):
--   DROP TABLE netgeo.schema_migrations; DROP SCHEMA netgeo CASCADE;

COMMIT;
