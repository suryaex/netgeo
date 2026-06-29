-- =============================================================================
-- NetGeo — Enterprise (PostgreSQL) — Migration 0005: SIMULATION + METRICS
-- =============================================================================
-- Simulation definitions/runs/events/packet traces/traffic generators, plus the
-- time-series metrics tables. High-volume tables (events, traces, *_statistics,
-- metrics) are RANGE-partitioned by timestamp for prune-friendly retention.
-- Spec: NetGeo/08_DATABASE_AND_ERD.md "Simulation","Metrics" + 07_SIMULATION_ENGINE.md.
--
-- Persisted truth only: live progress lives in Redis (infra/redis-design.md).
-- Depends on: 0001_core, 0002_devices, 0003_network.
-- =============================================================================
BEGIN;
SET search_path TO netgeo, public;

-- -----------------------------------------------------------------------------
-- Enumerations (simulation/metrics)
-- -----------------------------------------------------------------------------
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname='sim_kind') THEN
        CREATE TYPE netgeo.sim_kind AS ENUM ('sim','emul');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname='run_status') THEN
        CREATE TYPE netgeo.run_status AS ENUM
            ('queued','running','done','failed','cancelled');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname='event_severity') THEN
        CREATE TYPE netgeo.event_severity AS ENUM ('debug','info','warning','error','critical');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname='traffic_kind') THEN
        CREATE TYPE netgeo.traffic_kind AS ENUM ('cbr','poisson','burst','replay','ramp');
    END IF;
END$$;

-- -----------------------------------------------------------------------------
-- Partition helpers (monthly RANGE partitions). Production: schedule
-- ensure_time_partitions() via pg_cron, or adopt pg_partman. A DEFAULT partition
-- guarantees inserts never fail even if a month partition is missing.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION netgeo.create_time_partition(
    parent regclass, from_ts timestamptz, to_ts timestamptz)
RETURNS void AS $$
DECLARE
    parent_name text;
    part_name   text;
BEGIN
    SELECT relname INTO parent_name FROM pg_class WHERE oid = parent;
    part_name := format('%s_p%s', parent_name, to_char(from_ts, 'YYYYMM'));
    IF NOT EXISTS (
        SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE c.relname = part_name AND n.nspname = 'netgeo'
    ) THEN
        EXECUTE format(
            'CREATE TABLE netgeo.%I PARTITION OF %s FOR VALUES FROM (%L) TO (%L);',
            part_name, parent::text, from_ts, to_ts);
    END IF;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION netgeo.ensure_time_partitions(
    parent regclass, months_ahead integer DEFAULT 2)
RETURNS void AS $$
DECLARE
    m date := date_trunc('month', now())::date;
    i integer;
BEGIN
    FOR i IN 0..months_ahead LOOP
        PERFORM netgeo.create_time_partition(
            parent,
            (m + (i     || ' month')::interval)::timestamptz,
            (m + (i + 1 || ' month')::interval)::timestamptz);
    END LOOP;
END;
$$ LANGUAGE plpgsql;

-- =============================================================================
-- SIMULATIONS  (a reusable simulation definition; vs. its runs)
-- =============================================================================
CREATE TABLE netgeo.simulations (
    id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    uuid        UUID   NOT NULL DEFAULT gen_random_uuid(),
    project_id  BIGINT NOT NULL REFERENCES netgeo.projects(id) ON DELETE CASCADE,
    name        TEXT   NOT NULL,
    kind        netgeo.sim_kind NOT NULL DEFAULT 'sim',
    engine      TEXT,                               -- discrete-event/containerlab/...
    description TEXT,
    config      JSONB  NOT NULL DEFAULT '{}'::jsonb,
    steps       JSONB  NOT NULL DEFAULT '[]'::jsonb,  -- scenario steps
    expected    JSONB  NOT NULL DEFAULT '[]'::jsonb,  -- expected outcomes
    created_by  BIGINT REFERENCES netgeo.users(id) ON DELETE SET NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT simulations_uuid_uq UNIQUE (uuid),
    CONSTRAINT simulations_name_uq UNIQUE (project_id, name),
    CONSTRAINT simulations_steps_arr CHECK (jsonb_typeof(steps) = 'array')
);
CREATE INDEX idx_simulations_project ON netgeo.simulations(project_id);

-- =============================================================================
-- SIMULATION_RUNS  (each execution; moderate volume, NOT partitioned)
-- =============================================================================
CREATE TABLE netgeo.simulation_runs (
    id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    uuid          UUID   NOT NULL DEFAULT gen_random_uuid(),
    simulation_id BIGINT REFERENCES netgeo.simulations(id) ON DELETE SET NULL,
    project_id    BIGINT NOT NULL REFERENCES netgeo.projects(id) ON DELETE CASCADE,
    triggered_by  BIGINT REFERENCES netgeo.users(id) ON DELETE SET NULL,
    status        netgeo.run_status NOT NULL DEFAULT 'queued',
    seed          BIGINT NOT NULL DEFAULT 0,
    progress      NUMERIC(5,2) NOT NULL DEFAULT 0,   -- 0..100 last-known snapshot
    result        JSONB  NOT NULL DEFAULT '{}'::jsonb,
    error         TEXT,
    queued_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    started_at    TIMESTAMPTZ,
    finished_at   TIMESTAMPTZ,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT simulation_runs_uuid_uq UNIQUE (uuid),
    CONSTRAINT simulation_runs_progress_chk CHECK (progress BETWEEN 0 AND 100)
);
CREATE INDEX idx_sim_runs_project ON netgeo.simulation_runs(project_id, created_at DESC);
CREATE INDEX idx_sim_runs_sim     ON netgeo.simulation_runs(simulation_id);
CREATE INDEX idx_sim_runs_status  ON netgeo.simulation_runs(status) WHERE status IN ('queued','running');

-- =============================================================================
-- SIMULATION_EVENTS  (high volume — partitioned by ts)
-- =============================================================================
CREATE TABLE netgeo.simulation_events (
    id                 BIGINT GENERATED ALWAYS AS IDENTITY,
    ts                 TIMESTAMPTZ NOT NULL DEFAULT now(),
    simulation_run_id  BIGINT NOT NULL REFERENCES netgeo.simulation_runs(id) ON DELETE CASCADE,
    sim_time_ms        BIGINT,
    event_type         TEXT   NOT NULL,
    severity           netgeo.event_severity NOT NULL DEFAULT 'info',
    device_instance_id BIGINT REFERENCES netgeo.device_instances(id) ON DELETE SET NULL,
    link_id            BIGINT REFERENCES netgeo.links(id) ON DELETE SET NULL,
    payload            JSONB  NOT NULL DEFAULT '{}'::jsonb,
    PRIMARY KEY (id, ts)
) PARTITION BY RANGE (ts);
CREATE INDEX idx_sim_events_run ON netgeo.simulation_events(simulation_run_id, ts DESC);
CREATE INDEX idx_sim_events_type ON netgeo.simulation_events(event_type, ts DESC);
CREATE TABLE netgeo.simulation_events_default
    PARTITION OF netgeo.simulation_events DEFAULT;
SELECT netgeo.ensure_time_partitions('netgeo.simulation_events'::regclass, 2);

-- =============================================================================
-- PACKET_TRACES  (highest volume — partitioned by ts; no FK to partitioned ev.)
-- =============================================================================
CREATE TABLE netgeo.packet_traces (
    id                  BIGINT GENERATED ALWAYS AS IDENTITY,
    ts                  TIMESTAMPTZ NOT NULL DEFAULT now(),
    simulation_run_id   BIGINT NOT NULL REFERENCES netgeo.simulation_runs(id) ON DELETE CASCADE,
    simulation_event_id BIGINT,                     -- soft ref into partitioned events
    sim_time_ms         BIGINT,
    hop_index           INTEGER,
    device_instance_id  BIGINT REFERENCES netgeo.device_instances(id) ON DELETE SET NULL,
    ingress_interface_id BIGINT REFERENCES netgeo.interfaces(id) ON DELETE SET NULL,
    egress_interface_id  BIGINT REFERENCES netgeo.interfaces(id) ON DELETE SET NULL,
    src_ip              INET,
    dst_ip              INET,
    protocol            TEXT,
    latency_ms          DOUBLE PRECISION,
    dropped             BOOLEAN NOT NULL DEFAULT FALSE,
    drop_reason         TEXT,
    payload             JSONB  NOT NULL DEFAULT '{}'::jsonb,
    PRIMARY KEY (id, ts)
) PARTITION BY RANGE (ts);
CREATE INDEX idx_packet_traces_run ON netgeo.packet_traces(simulation_run_id, ts DESC);
CREATE TABLE netgeo.packet_traces_default
    PARTITION OF netgeo.packet_traces DEFAULT;
SELECT netgeo.ensure_time_partitions('netgeo.packet_traces'::regclass, 2);

-- =============================================================================
-- TRAFFIC_GENERATORS
-- =============================================================================
CREATE TABLE netgeo.traffic_generators (
    id               BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    uuid             UUID   NOT NULL DEFAULT gen_random_uuid(),
    project_id       BIGINT NOT NULL REFERENCES netgeo.projects(id) ON DELETE CASCADE,
    simulation_id    BIGINT REFERENCES netgeo.simulations(id) ON DELETE SET NULL,
    name             TEXT   NOT NULL,
    source_device_id BIGINT REFERENCES netgeo.device_instances(id) ON DELETE SET NULL,
    dest_device_id   BIGINT REFERENCES netgeo.device_instances(id) ON DELETE SET NULL,
    src_interface_id BIGINT REFERENCES netgeo.interfaces(id) ON DELETE SET NULL,
    kind             netgeo.traffic_kind NOT NULL DEFAULT 'cbr',
    protocol         TEXT,
    rate_pps         BIGINT,
    packet_size      INTEGER,
    duration_s       INTEGER,
    config           JSONB  NOT NULL DEFAULT '{}'::jsonb,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT traffic_generators_uuid_uq UNIQUE (uuid),
    CONSTRAINT traffic_generators_name_uq UNIQUE (project_id, name)
);
CREATE INDEX idx_traffic_generators_project ON netgeo.traffic_generators(project_id);

-- =============================================================================
-- METRICS (time-series, partitioned by ts)
-- =============================================================================
-- Generic metric points (entity-agnostic).
CREATE TABLE netgeo.metrics (
    id          BIGINT GENERATED ALWAYS AS IDENTITY,
    ts          TIMESTAMPTZ NOT NULL DEFAULT now(),
    project_id  BIGINT NOT NULL REFERENCES netgeo.projects(id) ON DELETE CASCADE,
    entity_type TEXT   NOT NULL,                    -- device/interface/link/radio/...
    entity_id   BIGINT NOT NULL,
    metric_name TEXT   NOT NULL,
    value       DOUBLE PRECISION NOT NULL,
    unit        TEXT,
    labels      JSONB  NOT NULL DEFAULT '{}'::jsonb,
    PRIMARY KEY (id, ts)
) PARTITION BY RANGE (ts);
CREATE INDEX idx_metrics_entity ON netgeo.metrics(entity_type, entity_id, ts DESC);
CREATE INDEX idx_metrics_name   ON netgeo.metrics(metric_name, ts DESC);
CREATE TABLE netgeo.metrics_default PARTITION OF netgeo.metrics DEFAULT;
SELECT netgeo.ensure_time_partitions('netgeo.metrics'::regclass, 2);

-- Per-interface counters/utilization.
CREATE TABLE netgeo.interface_statistics (
    id                BIGINT GENERATED ALWAYS AS IDENTITY,
    ts                TIMESTAMPTZ NOT NULL DEFAULT now(),
    interface_id      BIGINT NOT NULL REFERENCES netgeo.interfaces(id) ON DELETE CASCADE,
    simulation_run_id BIGINT REFERENCES netgeo.simulation_runs(id) ON DELETE CASCADE,
    rx_bytes      BIGINT,
    tx_bytes      BIGINT,
    rx_packets    BIGINT,
    tx_packets    BIGINT,
    rx_errors     BIGINT,
    tx_errors     BIGINT,
    rx_drops      BIGINT,
    tx_drops      BIGINT,
    util_rx_pct   NUMERIC(5,2),
    util_tx_pct   NUMERIC(5,2),
    PRIMARY KEY (id, ts)
) PARTITION BY RANGE (ts);
CREATE INDEX idx_iface_stats_iface ON netgeo.interface_statistics(interface_id, ts DESC);
CREATE TABLE netgeo.interface_statistics_default
    PARTITION OF netgeo.interface_statistics DEFAULT;
SELECT netgeo.ensure_time_partitions('netgeo.interface_statistics'::regclass, 2);

-- Per-device resource stats.
CREATE TABLE netgeo.device_statistics (
    id                 BIGINT GENERATED ALWAYS AS IDENTITY,
    ts                 TIMESTAMPTZ NOT NULL DEFAULT now(),
    device_instance_id BIGINT NOT NULL REFERENCES netgeo.device_instances(id) ON DELETE CASCADE,
    simulation_run_id  BIGINT REFERENCES netgeo.simulation_runs(id) ON DELETE CASCADE,
    cpu_pct       NUMERIC(5,2),
    mem_used_mb   BIGINT,
    mem_total_mb  BIGINT,
    temperature_c NUMERIC(5,2),
    uptime_s      BIGINT,
    session_count INTEGER,
    PRIMARY KEY (id, ts)
) PARTITION BY RANGE (ts);
CREATE INDEX idx_device_stats_device ON netgeo.device_statistics(device_instance_id, ts DESC);
CREATE TABLE netgeo.device_statistics_default
    PARTITION OF netgeo.device_statistics DEFAULT;
SELECT netgeo.ensure_time_partitions('netgeo.device_statistics'::regclass, 2);

-- Per-radio RF stats.
CREATE TABLE netgeo.rf_statistics (
    id                BIGINT GENERATED ALWAYS AS IDENTITY,
    ts                TIMESTAMPTZ NOT NULL DEFAULT now(),
    radio_id          BIGINT NOT NULL REFERENCES netgeo.radios(id) ON DELETE CASCADE,
    simulation_run_id BIGINT REFERENCES netgeo.simulation_runs(id) ON DELETE CASCADE,
    rssi_dbm          NUMERIC(6,2),
    snr_db            NUMERIC(6,2),
    noise_dbm         NUMERIC(6,2),
    tx_rate_mbps      NUMERIC(10,2),
    rx_rate_mbps      NUMERIC(10,2),
    channel_util_pct  NUMERIC(5,2),
    connected_clients INTEGER,
    PRIMARY KEY (id, ts)
) PARTITION BY RANGE (ts);
CREATE INDEX idx_rf_stats_radio ON netgeo.rf_statistics(radio_id, ts DESC);
CREATE TABLE netgeo.rf_statistics_default
    PARTITION OF netgeo.rf_statistics DEFAULT;
SELECT netgeo.ensure_time_partitions('netgeo.rf_statistics'::regclass, 2);

-- -----------------------------------------------------------------------------
-- updated_at triggers (only mutable, non-partitioned tables)
-- -----------------------------------------------------------------------------
SELECT netgeo.attach_updated_at(ARRAY[
    'simulations','simulation_runs','traffic_generators'
]);

INSERT INTO netgeo.schema_migrations(version, description)
VALUES ('0005','simulation + metrics (partitioned time-series)')
ON CONFLICT DO NOTHING;

COMMIT;
