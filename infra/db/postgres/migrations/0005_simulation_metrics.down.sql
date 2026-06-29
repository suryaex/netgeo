-- =============================================================================
-- NetGeo — Migration 0005: SIMULATION + METRICS (DOWN / rollback)
-- DESTRUCTIVE: drops simulations/runs/events/traces + all time-series metrics
-- (including every monthly partition via CASCADE on the parent).
-- =============================================================================
BEGIN;
SET search_path TO netgeo, public;

-- Dropping a partitioned parent drops all its partitions.
DROP TABLE IF EXISTS netgeo.rf_statistics        CASCADE;
DROP TABLE IF EXISTS netgeo.device_statistics    CASCADE;
DROP TABLE IF EXISTS netgeo.interface_statistics CASCADE;
DROP TABLE IF EXISTS netgeo.metrics              CASCADE;
DROP TABLE IF EXISTS netgeo.traffic_generators   CASCADE;
DROP TABLE IF EXISTS netgeo.packet_traces        CASCADE;
DROP TABLE IF EXISTS netgeo.simulation_events    CASCADE;
DROP TABLE IF EXISTS netgeo.simulation_runs      CASCADE;
DROP TABLE IF EXISTS netgeo.simulations          CASCADE;

DROP FUNCTION IF EXISTS netgeo.ensure_time_partitions(regclass, integer);
DROP FUNCTION IF EXISTS netgeo.create_time_partition(regclass, timestamptz, timestamptz);

DROP TYPE IF EXISTS netgeo.traffic_kind;
DROP TYPE IF EXISTS netgeo.event_severity;
DROP TYPE IF EXISTS netgeo.run_status;
DROP TYPE IF EXISTS netgeo.sim_kind;

DELETE FROM netgeo.schema_migrations WHERE version = '0005';

COMMIT;
