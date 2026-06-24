-- =============================================================================
-- Migration 0001 — init (UP)
-- Membuat skema awal NetForge: ekstensi, enum, helper, dan tabel inti.
-- Setara dengan schema.sql, dipecah agar kompatibel dengan migration runner
-- (sqitch / dbmate / migrate / alembic-via-raw-sql).
-- =============================================================================
BEGIN;

CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "citext";

CREATE SCHEMA IF NOT EXISTS netforge;
SET search_path TO netforge, public;

-- ---- Enum -------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname='node_kind') THEN
    CREATE TYPE node_kind AS ENUM ('router','switch','host','ap','olt','firewall','server');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname='nos_kind') THEN
    CREATE TYPE nos_kind AS ENUM ('forgeos','ios','iosxr','nxos','junos','eos','routeros','vyos','sros','frr','vrp');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname='node_mode') THEN
    CREATE TYPE node_mode AS ENUM ('sim','emul');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname='node_status') THEN
    CREATE TYPE node_status AS ENUM ('stopped','booting','running','degraded','error');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname='iface_type') THEN
    CREATE TYPE iface_type AS ENUM ('eth','sfp','sfp28','qsfp','gpon','wifi');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname='link_type') THEN
    CREATE TYPE link_type AS ENUM ('copper','fiber','wireless','virtual');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname='config_format') THEN
    CREATE TYPE config_format AS ENUM ('cli','netconf','yaml');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname='user_role') THEN
    CREATE TYPE user_role AS ENUM ('owner','admin','editor','viewer');
  END IF;
END$$;

-- ---- Helper -----------------------------------------------------------------
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

-- ---- app_user ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS app_user (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    username      CITEXT NOT NULL UNIQUE,
    email         CITEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    display_name  TEXT,
    is_active     BOOLEAN NOT NULL DEFAULT TRUE,
    preferences   JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT app_user_email_chk CHECK (position('@' IN email) > 1)
);
CREATE TRIGGER trg_app_user_updated BEFORE UPDATE ON app_user
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---- project ----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS project (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id     UUID NOT NULL REFERENCES app_user(id) ON DELETE RESTRICT,
    name         TEXT NOT NULL,
    description  TEXT,
    version      INTEGER NOT NULL DEFAULT 1,
    topology_ref JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT project_name_owner_uq UNIQUE (owner_id, name),
    CONSTRAINT project_version_pos   CHECK (version >= 1)
);
CREATE INDEX IF NOT EXISTS idx_project_owner    ON project(owner_id);
CREATE INDEX IF NOT EXISTS idx_project_topology ON project USING GIN (topology_ref);
CREATE TRIGGER trg_project_updated BEFORE UPDATE ON project
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE IF NOT EXISTS project_member (
    project_id UUID NOT NULL REFERENCES project(id) ON DELETE CASCADE,
    user_id    UUID NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
    role       user_role NOT NULL DEFAULT 'viewer',
    added_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (project_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_member_user ON project_member(user_id);

-- ---- node -------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS node (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id  UUID NOT NULL REFERENCES project(id) ON DELETE CASCADE,
    name        TEXT NOT NULL,
    kind        node_kind NOT NULL,
    nos         nos_kind NOT NULL DEFAULT 'forgeos',
    mode        node_mode NOT NULL DEFAULT 'sim',
    x           DOUBLE PRECISION NOT NULL DEFAULT 0,
    y           DOUBLE PRECISION NOT NULL DEFAULT 0,
    status      node_status NOT NULL DEFAULT 'stopped',
    config_ref  UUID,
    attributes  JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT node_name_project_uq UNIQUE (project_id, name)
);
CREATE INDEX IF NOT EXISTS idx_node_project    ON node(project_id);
CREATE INDEX IF NOT EXISTS idx_node_status     ON node(project_id, status);
CREATE INDEX IF NOT EXISTS idx_node_attributes ON node USING GIN (attributes);
CREATE TRIGGER trg_node_updated BEFORE UPDATE ON node
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---- iface ------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS iface (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    node_id      UUID NOT NULL REFERENCES node(id) ON DELETE CASCADE,
    name         TEXT NOT NULL,
    type         iface_type NOT NULL DEFAULT 'eth',
    ip           INET[] NOT NULL DEFAULT '{}',
    mac          MACADDR,
    speed_mbps   BIGINT,
    mtu          INTEGER NOT NULL DEFAULT 1500,
    peer_link_id UUID,
    attributes   JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT iface_name_node_uq UNIQUE (node_id, name),
    CONSTRAINT iface_mtu_chk   CHECK (mtu BETWEEN 64 AND 65535),
    CONSTRAINT iface_speed_chk CHECK (speed_mbps IS NULL OR speed_mbps > 0)
);
CREATE INDEX IF NOT EXISTS idx_iface_node ON iface(node_id);
CREATE INDEX IF NOT EXISTS idx_iface_peer ON iface(peer_link_id);
CREATE TRIGGER trg_iface_updated BEFORE UPDATE ON iface
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---- link -------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS link (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id     UUID NOT NULL REFERENCES project(id) ON DELETE CASCADE,
    a_iface        UUID NOT NULL REFERENCES iface(id) ON DELETE CASCADE,
    b_iface        UUID NOT NULL REFERENCES iface(id) ON DELETE CASCADE,
    type           link_type NOT NULL DEFAULT 'copper',
    bandwidth_mbps BIGINT,
    delay_ms       DOUBLE PRECISION NOT NULL DEFAULT 0,
    loss_pct       DOUBLE PRECISION NOT NULL DEFAULT 0,
    mtu            INTEGER NOT NULL DEFAULT 1500,
    attributes     JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT link_distinct_iface CHECK (a_iface <> b_iface),
    CONSTRAINT link_loss_chk  CHECK (loss_pct BETWEEN 0 AND 100),
    CONSTRAINT link_delay_chk CHECK (delay_ms >= 0),
    CONSTRAINT link_mtu_chk   CHECK (mtu BETWEEN 64 AND 65535),
    CONSTRAINT link_bw_chk    CHECK (bandwidth_mbps IS NULL OR bandwidth_mbps > 0),
    CONSTRAINT link_pair_uq   UNIQUE (a_iface, b_iface)
);
CREATE INDEX IF NOT EXISTS idx_link_project ON link(project_id);
CREATE INDEX IF NOT EXISTS idx_link_a ON link(a_iface);
CREATE INDEX IF NOT EXISTS idx_link_b ON link(b_iface);
CREATE TRIGGER trg_link_updated BEFORE UPDATE ON link
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE iface DROP CONSTRAINT IF EXISTS iface_peer_link_fk;
ALTER TABLE iface ADD CONSTRAINT iface_peer_link_fk
    FOREIGN KEY (peer_link_id) REFERENCES link(id) ON DELETE SET NULL;

-- ---- scenario ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS scenario (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id        UUID NOT NULL REFERENCES project(id) ON DELETE CASCADE,
    name              TEXT NOT NULL,
    description       TEXT,
    steps             JSONB NOT NULL DEFAULT '[]'::jsonb,
    expected_outcomes JSONB NOT NULL DEFAULT '[]'::jsonb,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT scenario_name_project_uq UNIQUE (project_id, name),
    CONSTRAINT scenario_steps_is_array CHECK (jsonb_typeof(steps) = 'array'),
    CONSTRAINT scenario_outcomes_array CHECK (jsonb_typeof(expected_outcomes) = 'array')
);
CREATE INDEX IF NOT EXISTS idx_scenario_project ON scenario(project_id);
CREATE INDEX IF NOT EXISTS idx_scenario_steps   ON scenario USING GIN (steps);
CREATE TRIGGER trg_scenario_updated BEFORE UPDATE ON scenario
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---- config_artifact --------------------------------------------------------
CREATE TABLE IF NOT EXISTS config_artifact (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    node_id       UUID NOT NULL REFERENCES node(id) ON DELETE CASCADE,
    vendor        nos_kind NOT NULL,
    format        config_format NOT NULL DEFAULT 'cli',
    source_intent JSONB,
    content       TEXT NOT NULL,
    version       INTEGER NOT NULL DEFAULT 1,
    is_active     BOOLEAN NOT NULL DEFAULT FALSE,
    generated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT config_version_pos CHECK (version >= 1)
);
CREATE INDEX IF NOT EXISTS idx_config_node ON config_artifact(node_id, generated_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS uq_config_active_per_node
    ON config_artifact(node_id) WHERE is_active;

ALTER TABLE node DROP CONSTRAINT IF EXISTS node_config_ref_fk;
ALTER TABLE node ADD CONSTRAINT node_config_ref_fk
    FOREIGN KEY (config_ref) REFERENCES config_artifact(id) ON DELETE SET NULL;

-- ---- simulation_run ---------------------------------------------------------
CREATE TABLE IF NOT EXISTS simulation_run (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id   UUID NOT NULL REFERENCES project(id) ON DELETE CASCADE,
    scenario_id  UUID REFERENCES scenario(id) ON DELETE SET NULL,
    triggered_by UUID REFERENCES app_user(id) ON DELETE SET NULL,
    status       TEXT NOT NULL DEFAULT 'queued',
    result       JSONB NOT NULL DEFAULT '{}'::jsonb,
    started_at   TIMESTAMPTZ,
    finished_at  TIMESTAMPTZ,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT simrun_status_chk CHECK (status IN ('queued','running','done','failed','cancelled'))
);
CREATE INDEX IF NOT EXISTS idx_simrun_project ON simulation_run(project_id, created_at DESC);

-- ---- view -------------------------------------------------------------------
CREATE OR REPLACE VIEW v_project_topology AS
SELECT p.id AS project_id, p.name AS project_name, p.version AS project_version,
       (SELECT count(*) FROM node n WHERE n.project_id=p.id) AS node_count,
       (SELECT count(*) FROM link l WHERE l.project_id=p.id) AS link_count
FROM project p;

COMMIT;
