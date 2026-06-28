-- =============================================================================
-- NetGeo — Enterprise (PostgreSQL) — Migration 0001: CORE
-- =============================================================================
-- Source of truth for: Workspace, User/RBAC, Projects.
-- Spec: NetGeo/08_DATABASE_AND_ERD.md (Core ~15 tables) + database_erd.mmd.
--
-- Conventions (08_DATABASE_AND_ERD.md "Naming Convention"):
--   * Surrogate PK            : id  BIGINT GENERATED ALWAYS AS IDENTITY
--   * Public/API identifier   : uuid UUID (gen_random_uuid()), UNIQUE
--   * Foreign keys            : <entity>_id  -> references <entity>.id
--   * Timestamps              : created_at / updated_at / deleted_at (soft delete)
--   * Flexible payloads        : JSONB (+ GIN where queried)
--   * Enumerations            : native PostgreSQL ENUM (validate at DB level)
--
-- This migration is transactional and NOT meant to be re-run (it is the first
-- migration). Re-running is guarded by netgeo.schema_migrations.
-- =============================================================================
BEGIN;

-- -----------------------------------------------------------------------------
-- Extensions
-- -----------------------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS "pgcrypto";   -- gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS "citext";     -- case-insensitive email/username/slug
CREATE EXTENSION IF NOT EXISTS "pg_trgm";    -- fuzzy search on names
CREATE EXTENSION IF NOT EXISTS "btree_gin";  -- composite GIN (scalar + jsonb)

-- Application schema (keeps NetGeo objects out of public).
CREATE SCHEMA IF NOT EXISTS netgeo;
SET search_path TO netgeo, public;

-- -----------------------------------------------------------------------------
-- Migration ledger (applied by bootstrap.sh / Makefile migrate target)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS netgeo.schema_migrations (
    version     TEXT        PRIMARY KEY,
    description TEXT,
    applied_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- -----------------------------------------------------------------------------
-- Shared helpers
-- -----------------------------------------------------------------------------
-- Auto-stamp updated_at on UPDATE.
CREATE OR REPLACE FUNCTION netgeo.set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Attach the updated_at trigger to a list of tables (DRY across ~60 tables).
CREATE OR REPLACE FUNCTION netgeo.attach_updated_at(tables text[])
RETURNS void AS $$
DECLARE t text;
BEGIN
    FOREACH t IN ARRAY tables LOOP
        EXECUTE format('DROP TRIGGER IF EXISTS trg_%1$s_updated ON netgeo.%1$I;', t);
        EXECUTE format(
            'CREATE TRIGGER trg_%1$s_updated BEFORE UPDATE ON netgeo.%1$I '
            'FOR EACH ROW EXECUTE FUNCTION netgeo.set_updated_at();', t);
    END LOOP;
END;
$$ LANGUAGE plpgsql;

-- -----------------------------------------------------------------------------
-- Enumerations (core)
-- -----------------------------------------------------------------------------
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname='edition_type') THEN
        CREATE TYPE netgeo.edition_type AS ENUM ('community','enterprise');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname='project_status') THEN
        CREATE TYPE netgeo.project_status AS ENUM ('draft','active','archived','deleted');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname='api_key_status') THEN
        CREATE TYPE netgeo.api_key_status AS ENUM ('active','revoked','expired');
    END IF;
END$$;

-- =============================================================================
-- WORKSPACE
-- =============================================================================
-- A workspace is the top-level tenant. Community edition = exactly one
-- workspace; Enterprise = many, each with collaboration + HA.
CREATE TABLE netgeo.workspaces (
    id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    uuid          UUID NOT NULL DEFAULT gen_random_uuid(),
    name          TEXT NOT NULL,
    slug          CITEXT NOT NULL,
    edition       netgeo.edition_type NOT NULL DEFAULT 'enterprise',
    owner_user_id BIGINT,                    -- FK added after users exists (cyclic)
    description   TEXT,
    settings      JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at    TIMESTAMPTZ,
    CONSTRAINT workspaces_uuid_uq UNIQUE (uuid)
);
CREATE UNIQUE INDEX uq_workspaces_slug_live
    ON netgeo.workspaces(slug) WHERE deleted_at IS NULL;

-- Versioned / typed settings split out for large or per-key config.
CREATE TABLE netgeo.workspace_settings (
    id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    uuid         UUID NOT NULL DEFAULT gen_random_uuid(),
    workspace_id BIGINT NOT NULL REFERENCES netgeo.workspaces(id) ON DELETE CASCADE,
    key          TEXT NOT NULL,
    value        JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT workspace_settings_uuid_uq UNIQUE (uuid),
    CONSTRAINT workspace_settings_key_uq  UNIQUE (workspace_id, key)
);

-- =============================================================================
-- USER / RBAC
-- =============================================================================
CREATE TABLE netgeo.users (
    id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    uuid          UUID NOT NULL DEFAULT gen_random_uuid(),
    workspace_id  BIGINT NOT NULL REFERENCES netgeo.workspaces(id) ON DELETE CASCADE,
    username      CITEXT NOT NULL,
    email         CITEXT NOT NULL,
    password_hash TEXT NOT NULL,             -- argon2id, computed in backend
    display_name  TEXT,
    avatar_url    TEXT,
    locale        TEXT NOT NULL DEFAULT 'en',
    is_active     BOOLEAN NOT NULL DEFAULT TRUE,
    is_superuser  BOOLEAN NOT NULL DEFAULT FALSE,
    last_login_at TIMESTAMPTZ,
    preferences   JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at    TIMESTAMPTZ,
    CONSTRAINT users_uuid_uq  UNIQUE (uuid),
    CONSTRAINT users_email_chk CHECK (position('@' IN email) > 1)
);
CREATE UNIQUE INDEX uq_users_username_live
    ON netgeo.users(workspace_id, username) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX uq_users_email_live
    ON netgeo.users(workspace_id, email) WHERE deleted_at IS NULL;
CREATE INDEX idx_users_workspace ON netgeo.users(workspace_id);

-- Close the cyclic FK: workspace owner -> user.
ALTER TABLE netgeo.workspaces
    ADD CONSTRAINT workspaces_owner_fk
    FOREIGN KEY (owner_user_id) REFERENCES netgeo.users(id) ON DELETE SET NULL;

-- Roles: system roles (workspace_id NULL) + custom per-workspace roles.
CREATE TABLE netgeo.roles (
    id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    uuid         UUID NOT NULL DEFAULT gen_random_uuid(),
    workspace_id BIGINT REFERENCES netgeo.workspaces(id) ON DELETE CASCADE,
    name         CITEXT NOT NULL,            -- owner/admin/editor/viewer/custom
    description  TEXT,
    is_system    BOOLEAN NOT NULL DEFAULT FALSE,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT roles_uuid_uq UNIQUE (uuid)
);
-- A role name is unique per workspace; system roles (NULL ws) unique globally.
CREATE UNIQUE INDEX uq_roles_ws_name   ON netgeo.roles(workspace_id, name) WHERE workspace_id IS NOT NULL;
CREATE UNIQUE INDEX uq_roles_sys_name  ON netgeo.roles(name) WHERE workspace_id IS NULL;

-- Permission catalog (global). e.g. project.read, device.write, sim.run.
CREATE TABLE netgeo.permissions (
    id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    uuid        UUID NOT NULL DEFAULT gen_random_uuid(),
    code        CITEXT NOT NULL UNIQUE,      -- "project.read"
    resource    TEXT NOT NULL,               -- "project"
    action      TEXT NOT NULL,               -- "read"
    description TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT permissions_uuid_uq UNIQUE (uuid)
);

CREATE TABLE netgeo.role_permissions (
    role_id       BIGINT NOT NULL REFERENCES netgeo.roles(id) ON DELETE CASCADE,
    permission_id BIGINT NOT NULL REFERENCES netgeo.permissions(id) ON DELETE CASCADE,
    PRIMARY KEY (role_id, permission_id)
);

-- API keys (machine access; AI layer + CI). Hashed, never stored in clear.
CREATE TABLE netgeo.api_keys (
    id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    uuid         UUID NOT NULL DEFAULT gen_random_uuid(),
    workspace_id BIGINT NOT NULL REFERENCES netgeo.workspaces(id) ON DELETE CASCADE,
    user_id      BIGINT REFERENCES netgeo.users(id) ON DELETE SET NULL,
    name         TEXT NOT NULL,
    prefix       TEXT NOT NULL,              -- visible id e.g. "ngk_ab12"
    key_hash     TEXT NOT NULL,              -- sha256/argon2 of secret
    scopes       JSONB NOT NULL DEFAULT '[]'::jsonb,
    status       netgeo.api_key_status NOT NULL DEFAULT 'active',
    last_used_at TIMESTAMPTZ,
    expires_at   TIMESTAMPTZ,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT api_keys_uuid_uq   UNIQUE (uuid),
    CONSTRAINT api_keys_prefix_uq UNIQUE (prefix)
);
CREATE INDEX idx_api_keys_user ON netgeo.api_keys(user_id);

-- Workspace membership + role binding.
CREATE TABLE netgeo.workspace_members (
    workspace_id BIGINT NOT NULL REFERENCES netgeo.workspaces(id) ON DELETE CASCADE,
    user_id      BIGINT NOT NULL REFERENCES netgeo.users(id) ON DELETE CASCADE,
    role_id      BIGINT NOT NULL REFERENCES netgeo.roles(id) ON DELETE RESTRICT,
    added_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (workspace_id, user_id)
);
CREATE INDEX idx_ws_members_user ON netgeo.workspace_members(user_id);

-- =============================================================================
-- PROJECTS
-- =============================================================================
CREATE TABLE netgeo.projects (
    id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    uuid          UUID NOT NULL DEFAULT gen_random_uuid(),
    workspace_id  BIGINT NOT NULL REFERENCES netgeo.workspaces(id) ON DELETE CASCADE,
    owner_user_id BIGINT REFERENCES netgeo.users(id) ON DELETE SET NULL,
    name          TEXT NOT NULL,
    slug          CITEXT NOT NULL,
    description   TEXT,
    status        netgeo.project_status NOT NULL DEFAULT 'draft',
    -- Optimistic concurrency for the topology graph (bumped on each mutation).
    version       INTEGER NOT NULL DEFAULT 1,
    -- Presentational/meta topology snapshot (viewport, layout). Relational
    -- device/link tables remain the source of truth.
    topology_ref  JSONB NOT NULL DEFAULT '{}'::jsonb,
    settings      JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at    TIMESTAMPTZ,
    CONSTRAINT projects_uuid_uq    UNIQUE (uuid),
    CONSTRAINT projects_version_pos CHECK (version >= 1)
);
CREATE UNIQUE INDEX uq_projects_slug_live
    ON netgeo.projects(workspace_id, slug) WHERE deleted_at IS NULL;
CREATE INDEX idx_projects_workspace ON netgeo.projects(workspace_id);
CREATE INDEX idx_projects_owner     ON netgeo.projects(owner_user_id);
CREATE INDEX idx_projects_topology  ON netgeo.projects USING GIN (topology_ref);

-- Immutable version snapshots (undo/redo, audit, rollback).
CREATE TABLE netgeo.project_versions (
    id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    uuid         UUID NOT NULL DEFAULT gen_random_uuid(),
    project_id   BIGINT NOT NULL REFERENCES netgeo.projects(id) ON DELETE CASCADE,
    version_no   INTEGER NOT NULL,
    label        TEXT,
    snapshot     JSONB NOT NULL DEFAULT '{}'::jsonb,  -- serialized topology
    created_by   BIGINT REFERENCES netgeo.users(id) ON DELETE SET NULL,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT project_versions_uuid_uq UNIQUE (uuid),
    CONSTRAINT project_versions_no_uq   UNIQUE (project_id, version_no)
);
CREATE INDEX idx_project_versions_project ON netgeo.project_versions(project_id, version_no DESC);

CREATE TABLE netgeo.project_tags (
    project_id BIGINT NOT NULL REFERENCES netgeo.projects(id) ON DELETE CASCADE,
    tag        CITEXT NOT NULL,
    PRIMARY KEY (project_id, tag)
);
CREATE INDEX idx_project_tags_tag ON netgeo.project_tags(tag);

CREATE TABLE netgeo.project_members (
    project_id BIGINT NOT NULL REFERENCES netgeo.projects(id) ON DELETE CASCADE,
    user_id    BIGINT NOT NULL REFERENCES netgeo.users(id) ON DELETE CASCADE,
    role_id    BIGINT NOT NULL REFERENCES netgeo.roles(id) ON DELETE RESTRICT,
    added_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (project_id, user_id)
);
CREATE INDEX idx_project_members_user ON netgeo.project_members(user_id);

-- -----------------------------------------------------------------------------
-- updated_at triggers
-- -----------------------------------------------------------------------------
SELECT netgeo.attach_updated_at(ARRAY[
    'workspaces','workspace_settings','users','roles','api_keys','projects'
]);

-- -----------------------------------------------------------------------------
-- Seed: system roles + baseline permissions (idempotent)
-- -----------------------------------------------------------------------------
INSERT INTO netgeo.roles (name, description, is_system) VALUES
    ('owner','Full control of the workspace', TRUE),
    ('admin','Administer projects and members', TRUE),
    ('editor','Create and edit project content', TRUE),
    ('viewer','Read-only access', TRUE)
ON CONFLICT DO NOTHING;

INSERT INTO netgeo.permissions (code, resource, action, description) VALUES
    ('project.read','project','read','View projects'),
    ('project.write','project','write','Create/edit projects'),
    ('project.delete','project','delete','Delete projects'),
    ('device.read','device','read','View devices'),
    ('device.write','device','write','Create/edit devices'),
    ('simulation.run','simulation','run','Run simulations'),
    ('member.manage','member','manage','Manage workspace/project members'),
    ('plugin.manage','plugin','manage','Install/manage plugins'),
    ('ai.use','ai','use','Use AI assistant')
ON CONFLICT DO NOTHING;

INSERT INTO netgeo.schema_migrations(version, description)
VALUES ('0001','core: workspace, rbac, projects')
ON CONFLICT DO NOTHING;

COMMIT;
