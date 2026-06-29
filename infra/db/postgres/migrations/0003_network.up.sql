-- =============================================================================
-- NetGeo — Enterprise (PostgreSQL) — Migration 0003: NETWORK / WIRELESS / OPTICAL
-- =============================================================================
-- Links + L3 control plane (routing/BGP/OSPF/ISIS/NAT/firewall/QoS),
-- wireless (sites/radios/antennas/RF), and optical (OLT/ONT/splitter/fiber).
-- Spec: NetGeo/08_DATABASE_AND_ERD.md "Network","Wireless","Optical".
--
-- Depends on: 0001_core, 0002_devices (interfaces, device_instances).
-- =============================================================================
BEGIN;
SET search_path TO netgeo, public;

-- -----------------------------------------------------------------------------
-- Enumerations (network/wireless/optical)
-- -----------------------------------------------------------------------------
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname='link_medium') THEN
        CREATE TYPE netgeo.link_medium AS ENUM ('copper','fiber','wireless','virtual','serial');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname='link_status') THEN
        CREATE TYPE netgeo.link_status AS ENUM ('up','down','admin_down','planned');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname='ospf_area_type') THEN
        CREATE TYPE netgeo.ospf_area_type AS ENUM ('standard','stub','totally_stub','nssa');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname='isis_level') THEN
        CREATE TYPE netgeo.isis_level AS ENUM ('level_1','level_2','level_1_2');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname='nat_kind') THEN
        CREATE TYPE netgeo.nat_kind AS ENUM ('source','destination','static','masquerade');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname='fw_action') THEN
        CREATE TYPE netgeo.fw_action AS ENUM ('permit','deny','reject','log');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname='fw_direction') THEN
        CREATE TYPE netgeo.fw_direction AS ENUM ('inbound','outbound','forward');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname='rf_band') THEN
        CREATE TYPE netgeo.rf_band AS ENUM ('band_2_4ghz','band_5ghz','band_6ghz','band_60ghz','licensed','other');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname='radio_tech') THEN
        CREATE TYPE netgeo.radio_tech AS ENUM ('wifi','lte','nr_5g','microwave','p2p','p2mp');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname='antenna_kind') THEN
        CREATE TYPE netgeo.antenna_kind AS ENUM ('omni','sector','yagi','dish','panel','patch');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname='pon_tech') THEN
        CREATE TYPE netgeo.pon_tech AS ENUM ('gpon','xgpon','xgs_pon','ngpon2','epon');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname='fiber_kind') THEN
        CREATE TYPE netgeo.fiber_kind AS ENUM ('single_mode','multi_mode');
    END IF;
END$$;

-- =============================================================================
-- LINK_PROFILES  (reusable medium templates — workspace catalog)
-- =============================================================================
CREATE TABLE netgeo.link_profiles (
    id             BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    uuid           UUID   NOT NULL DEFAULT gen_random_uuid(),
    workspace_id   BIGINT NOT NULL REFERENCES netgeo.workspaces(id) ON DELETE CASCADE,
    name           TEXT   NOT NULL,
    medium         netgeo.link_medium NOT NULL DEFAULT 'fiber',
    bandwidth_mbps BIGINT,
    delay_ms       DOUBLE PRECISION NOT NULL DEFAULT 0,
    jitter_ms      DOUBLE PRECISION NOT NULL DEFAULT 0,
    loss_pct       DOUBLE PRECISION NOT NULL DEFAULT 0,
    cost           INTEGER NOT NULL DEFAULT 1,
    attributes     JSONB  NOT NULL DEFAULT '{}'::jsonb,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT link_profiles_uuid_uq UNIQUE (uuid),
    CONSTRAINT link_profiles_name_uq UNIQUE (workspace_id, name),
    CONSTRAINT link_profiles_loss_chk CHECK (loss_pct BETWEEN 0 AND 100)
);
CREATE INDEX idx_link_profiles_ws ON netgeo.link_profiles(workspace_id);

-- =============================================================================
-- LINKS  (point-to-point between two interfaces)
-- =============================================================================
CREATE TABLE netgeo.links (
    id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    uuid            UUID   NOT NULL DEFAULT gen_random_uuid(),
    project_id      BIGINT NOT NULL REFERENCES netgeo.projects(id) ON DELETE CASCADE,
    a_interface_id  BIGINT NOT NULL REFERENCES netgeo.interfaces(id) ON DELETE CASCADE,
    b_interface_id  BIGINT NOT NULL REFERENCES netgeo.interfaces(id) ON DELETE CASCADE,
    link_profile_id BIGINT REFERENCES netgeo.link_profiles(id) ON DELETE SET NULL,
    medium          netgeo.link_medium NOT NULL DEFAULT 'fiber',
    status          netgeo.link_status NOT NULL DEFAULT 'up',
    bandwidth_mbps  BIGINT,
    delay_ms        DOUBLE PRECISION NOT NULL DEFAULT 0,
    jitter_ms       DOUBLE PRECISION NOT NULL DEFAULT 0,
    loss_pct        DOUBLE PRECISION NOT NULL DEFAULT 0,
    mtu             INTEGER NOT NULL DEFAULT 1500,
    length_m        DOUBLE PRECISION,            -- physical span (fiber/wireless)
    attributes      JSONB  NOT NULL DEFAULT '{}'::jsonb,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT links_uuid_uq        UNIQUE (uuid),
    CONSTRAINT links_distinct_iface CHECK (a_interface_id <> b_interface_id),
    CONSTRAINT links_loss_chk       CHECK (loss_pct BETWEEN 0 AND 100),
    CONSTRAINT links_delay_chk      CHECK (delay_ms >= 0),
    CONSTRAINT links_mtu_chk        CHECK (mtu BETWEEN 64 AND 65535),
    CONSTRAINT links_bw_chk         CHECK (bandwidth_mbps IS NULL OR bandwidth_mbps > 0)
);
CREATE INDEX idx_links_project ON netgeo.links(project_id);
CREATE INDEX idx_links_a       ON netgeo.links(a_interface_id);
CREATE INDEX idx_links_b       ON netgeo.links(b_interface_id);
-- Normalize (A,B)==(B,A): forbid duplicate links regardless of endpoint order.
CREATE UNIQUE INDEX uq_links_pair ON netgeo.links
    (LEAST(a_interface_id, b_interface_id), GREATEST(a_interface_id, b_interface_id));

-- Close the cyclic FK from 0002: interfaces.peer_link_id -> links.id.
ALTER TABLE netgeo.interfaces
    ADD CONSTRAINT interfaces_peer_link_fk
    FOREIGN KEY (peer_link_id) REFERENCES netgeo.links(id) ON DELETE SET NULL;

-- =============================================================================
-- L3 CONTROL PLANE
-- =============================================================================
-- ROUTING_TABLES (RIB container per device + VRF)
CREATE TABLE netgeo.routing_tables (
    id                 BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    uuid               UUID   NOT NULL DEFAULT gen_random_uuid(),
    device_instance_id BIGINT NOT NULL REFERENCES netgeo.device_instances(id) ON DELETE CASCADE,
    vrf                TEXT   NOT NULL DEFAULT 'default',
    description        TEXT,
    attributes         JSONB  NOT NULL DEFAULT '{}'::jsonb,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT routing_tables_uuid_uq UNIQUE (uuid),
    CONSTRAINT routing_tables_vrf_uq  UNIQUE (device_instance_id, vrf)
);
CREATE INDEX idx_routing_tables_device ON netgeo.routing_tables(device_instance_id);

-- STATIC_ROUTES
CREATE TABLE netgeo.static_routes (
    id                 BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    uuid               UUID   NOT NULL DEFAULT gen_random_uuid(),
    device_instance_id BIGINT NOT NULL REFERENCES netgeo.device_instances(id) ON DELETE CASCADE,
    routing_table_id   BIGINT REFERENCES netgeo.routing_tables(id) ON DELETE CASCADE,
    dest_prefix        CIDR   NOT NULL,
    next_hop           INET,
    next_hop_interface_id BIGINT REFERENCES netgeo.interfaces(id) ON DELETE SET NULL,
    distance           INTEGER NOT NULL DEFAULT 1,
    metric             INTEGER NOT NULL DEFAULT 0,
    vrf                TEXT   NOT NULL DEFAULT 'default',
    attributes         JSONB  NOT NULL DEFAULT '{}'::jsonb,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT static_routes_uuid_uq  UNIQUE (uuid),
    CONSTRAINT static_routes_dist_chk CHECK (distance BETWEEN 0 AND 255),
    CONSTRAINT static_routes_nh_chk   CHECK (next_hop IS NOT NULL OR next_hop_interface_id IS NOT NULL)
);
CREATE INDEX idx_static_routes_device ON netgeo.static_routes(device_instance_id);
CREATE INDEX idx_static_routes_dest   ON netgeo.static_routes USING GIST (dest_prefix inet_ops);

-- BGP_NEIGHBORS
CREATE TABLE netgeo.bgp_neighbors (
    id                 BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    uuid               UUID   NOT NULL DEFAULT gen_random_uuid(),
    device_instance_id BIGINT NOT NULL REFERENCES netgeo.device_instances(id) ON DELETE CASCADE,
    local_asn          BIGINT NOT NULL,
    peer_asn           BIGINT NOT NULL,
    peer_address       INET   NOT NULL,
    local_address      INET,
    description        TEXT,
    has_password       BOOLEAN NOT NULL DEFAULT FALSE,
    address_families   JSONB  NOT NULL DEFAULT '["ipv4-unicast"]'::jsonb,
    attributes         JSONB  NOT NULL DEFAULT '{}'::jsonb,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT bgp_neighbors_uuid_uq UNIQUE (uuid),
    CONSTRAINT bgp_neighbors_peer_uq UNIQUE (device_instance_id, peer_address),
    CONSTRAINT bgp_local_asn_chk CHECK (local_asn BETWEEN 1 AND 4294967295),
    CONSTRAINT bgp_peer_asn_chk  CHECK (peer_asn  BETWEEN 1 AND 4294967295)
);
CREATE INDEX idx_bgp_neighbors_device ON netgeo.bgp_neighbors(device_instance_id);

-- OSPF_AREAS
CREATE TABLE netgeo.ospf_areas (
    id                 BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    uuid               UUID   NOT NULL DEFAULT gen_random_uuid(),
    device_instance_id BIGINT NOT NULL REFERENCES netgeo.device_instances(id) ON DELETE CASCADE,
    process_id         INTEGER NOT NULL DEFAULT 1,
    area_id            TEXT   NOT NULL DEFAULT '0',  -- "0" or dotted "0.0.0.0"
    area_type          netgeo.ospf_area_type NOT NULL DEFAULT 'standard',
    networks           JSONB  NOT NULL DEFAULT '[]'::jsonb,
    attributes         JSONB  NOT NULL DEFAULT '{}'::jsonb,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT ospf_areas_uuid_uq UNIQUE (uuid),
    CONSTRAINT ospf_areas_uq      UNIQUE (device_instance_id, process_id, area_id)
);
CREATE INDEX idx_ospf_areas_device ON netgeo.ospf_areas(device_instance_id);

-- ISIS_INSTANCES
CREATE TABLE netgeo.isis_instances (
    id                 BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    uuid               UUID   NOT NULL DEFAULT gen_random_uuid(),
    device_instance_id BIGINT NOT NULL REFERENCES netgeo.device_instances(id) ON DELETE CASCADE,
    instance_tag       TEXT   NOT NULL DEFAULT '1',
    net_address        TEXT,                         -- ISO NET, e.g. 49.0001.0010...00
    level              netgeo.isis_level NOT NULL DEFAULT 'level_2',
    attributes         JSONB  NOT NULL DEFAULT '{}'::jsonb,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT isis_instances_uuid_uq UNIQUE (uuid),
    CONSTRAINT isis_instances_uq      UNIQUE (device_instance_id, instance_tag)
);
CREATE INDEX idx_isis_instances_device ON netgeo.isis_instances(device_instance_id);

-- NAT_RULES
CREATE TABLE netgeo.nat_rules (
    id                 BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    uuid               UUID   NOT NULL DEFAULT gen_random_uuid(),
    device_instance_id BIGINT NOT NULL REFERENCES netgeo.device_instances(id) ON DELETE CASCADE,
    kind               netgeo.nat_kind NOT NULL DEFAULT 'source',
    original_prefix    CIDR,
    translated_prefix  CIDR,
    in_interface_id    BIGINT REFERENCES netgeo.interfaces(id) ON DELETE SET NULL,
    out_interface_id   BIGINT REFERENCES netgeo.interfaces(id) ON DELETE SET NULL,
    priority           INTEGER NOT NULL DEFAULT 100,
    enabled            BOOLEAN NOT NULL DEFAULT TRUE,
    attributes         JSONB  NOT NULL DEFAULT '{}'::jsonb,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT nat_rules_uuid_uq UNIQUE (uuid)
);
CREATE INDEX idx_nat_rules_device ON netgeo.nat_rules(device_instance_id, priority);

-- FIREWALL_RULES
CREATE TABLE netgeo.firewall_rules (
    id                 BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    uuid               UUID   NOT NULL DEFAULT gen_random_uuid(),
    device_instance_id BIGINT NOT NULL REFERENCES netgeo.device_instances(id) ON DELETE CASCADE,
    direction          netgeo.fw_direction NOT NULL DEFAULT 'inbound',
    action             netgeo.fw_action    NOT NULL DEFAULT 'permit',
    protocol           TEXT,                          -- tcp/udp/icmp/any
    src_prefix         CIDR,
    dst_prefix         CIDR,
    src_port_range     INT4RANGE,
    dst_port_range     INT4RANGE,
    priority           INTEGER NOT NULL DEFAULT 100,
    enabled            BOOLEAN NOT NULL DEFAULT TRUE,
    attributes         JSONB  NOT NULL DEFAULT '{}'::jsonb,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT firewall_rules_uuid_uq UNIQUE (uuid)
);
CREATE INDEX idx_firewall_rules_device ON netgeo.firewall_rules(device_instance_id, priority);

-- QOS_PROFILES (workspace catalog)
CREATE TABLE netgeo.qos_profiles (
    id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    uuid         UUID   NOT NULL DEFAULT gen_random_uuid(),
    workspace_id BIGINT NOT NULL REFERENCES netgeo.workspaces(id) ON DELETE CASCADE,
    name         TEXT   NOT NULL,
    classes      JSONB  NOT NULL DEFAULT '[]'::jsonb,  -- traffic classes & policers
    attributes   JSONB  NOT NULL DEFAULT '{}'::jsonb,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT qos_profiles_uuid_uq UNIQUE (uuid),
    CONSTRAINT qos_profiles_name_uq UNIQUE (workspace_id, name)
);
CREATE INDEX idx_qos_profiles_ws ON netgeo.qos_profiles(workspace_id);

-- =============================================================================
-- WIRELESS
-- =============================================================================
-- ANTENNAS (catalog, vendor-linked)
CREATE TABLE netgeo.antennas (
    id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    uuid        UUID   NOT NULL DEFAULT gen_random_uuid(),
    vendor_id   BIGINT REFERENCES netgeo.vendors(id) ON DELETE SET NULL,
    name        CITEXT NOT NULL,
    kind        netgeo.antenna_kind NOT NULL DEFAULT 'omni',
    gain_dbi    NUMERIC(5,2),
    beamwidth_h NUMERIC(5,2),
    beamwidth_v NUMERIC(5,2),
    polarization TEXT,
    attributes  JSONB  NOT NULL DEFAULT '{}'::jsonb,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT antennas_uuid_uq UNIQUE (uuid),
    CONSTRAINT antennas_name_uq UNIQUE (vendor_id, name)
);

-- CHANNELS (catalog of RF channels)
CREATE TABLE netgeo.channels (
    id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    uuid            UUID   NOT NULL DEFAULT gen_random_uuid(),
    band            netgeo.rf_band NOT NULL,
    channel_number  INTEGER NOT NULL,
    center_freq_mhz NUMERIC(10,3) NOT NULL,
    width_mhz       INTEGER NOT NULL DEFAULT 20,
    CONSTRAINT channels_uuid_uq UNIQUE (uuid),
    CONSTRAINT channels_uq      UNIQUE (band, channel_number, width_mhz)
);

-- RF_PROFILES (workspace catalog)
CREATE TABLE netgeo.rf_profiles (
    id                BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    uuid              UUID   NOT NULL DEFAULT gen_random_uuid(),
    workspace_id      BIGINT NOT NULL REFERENCES netgeo.workspaces(id) ON DELETE CASCADE,
    name              TEXT   NOT NULL,
    band              netgeo.rf_band NOT NULL DEFAULT 'band_5ghz',
    channel_width_mhz INTEGER NOT NULL DEFAULT 20,
    modulation        TEXT,
    min_rssi_dbm      INTEGER,
    attributes        JSONB  NOT NULL DEFAULT '{}'::jsonb,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT rf_profiles_uuid_uq UNIQUE (uuid),
    CONSTRAINT rf_profiles_name_uq UNIQUE (workspace_id, name)
);
CREATE INDEX idx_rf_profiles_ws ON netgeo.rf_profiles(workspace_id);

-- WIRELESS_SITES (project-scoped geographic sites)
CREATE TABLE netgeo.wireless_sites (
    id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    uuid        UUID   NOT NULL DEFAULT gen_random_uuid(),
    project_id  BIGINT NOT NULL REFERENCES netgeo.projects(id) ON DELETE CASCADE,
    name        TEXT   NOT NULL,
    latitude    DOUBLE PRECISION,
    longitude   DOUBLE PRECISION,
    elevation_m DOUBLE PRECISION,
    height_m    DOUBLE PRECISION,                  -- tower/mast height
    attributes  JSONB  NOT NULL DEFAULT '{}'::jsonb,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT wireless_sites_uuid_uq UNIQUE (uuid),
    CONSTRAINT wireless_sites_name_uq UNIQUE (project_id, name),
    CONSTRAINT wireless_sites_lat_chk CHECK (latitude  IS NULL OR latitude  BETWEEN -90  AND 90),
    CONSTRAINT wireless_sites_lon_chk CHECK (longitude IS NULL OR longitude BETWEEN -180 AND 180)
);
CREATE INDEX idx_wireless_sites_project ON netgeo.wireless_sites(project_id);

-- RADIOS (a radio on a device, mounted at a site)
CREATE TABLE netgeo.radios (
    id                 BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    uuid               UUID   NOT NULL DEFAULT gen_random_uuid(),
    wireless_site_id   BIGINT NOT NULL REFERENCES netgeo.wireless_sites(id) ON DELETE CASCADE,
    device_instance_id BIGINT REFERENCES netgeo.device_instances(id) ON DELETE SET NULL,
    antenna_id         BIGINT REFERENCES netgeo.antennas(id) ON DELETE SET NULL,
    channel_id         BIGINT REFERENCES netgeo.channels(id) ON DELETE SET NULL,
    rf_profile_id      BIGINT REFERENCES netgeo.rf_profiles(id) ON DELETE SET NULL,
    name               TEXT   NOT NULL,
    band               netgeo.rf_band   NOT NULL DEFAULT 'band_5ghz',
    technology         netgeo.radio_tech NOT NULL DEFAULT 'wifi',
    tx_power_dbm       NUMERIC(5,2),
    azimuth_deg        NUMERIC(5,2),
    tilt_deg           NUMERIC(5,2),
    attributes         JSONB  NOT NULL DEFAULT '{}'::jsonb,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT radios_uuid_uq UNIQUE (uuid)
);
CREATE INDEX idx_radios_site   ON netgeo.radios(wireless_site_id);
CREATE INDEX idx_radios_device ON netgeo.radios(device_instance_id);

-- =============================================================================
-- OPTICAL (PON / fiber plant)
-- =============================================================================
-- OLTS
CREATE TABLE netgeo.olts (
    id                 BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    uuid               UUID   NOT NULL DEFAULT gen_random_uuid(),
    project_id         BIGINT NOT NULL REFERENCES netgeo.projects(id) ON DELETE CASCADE,
    device_instance_id BIGINT REFERENCES netgeo.device_instances(id) ON DELETE SET NULL,
    name               TEXT   NOT NULL,
    technology         netgeo.pon_tech NOT NULL DEFAULT 'gpon',
    pon_ports          INTEGER NOT NULL DEFAULT 16,
    attributes         JSONB  NOT NULL DEFAULT '{}'::jsonb,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT olts_uuid_uq UNIQUE (uuid),
    CONSTRAINT olts_name_uq UNIQUE (project_id, name)
);
CREATE INDEX idx_olts_project ON netgeo.olts(project_id);

-- SPLITTERS
CREATE TABLE netgeo.splitters (
    id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    uuid        UUID   NOT NULL DEFAULT gen_random_uuid(),
    project_id  BIGINT NOT NULL REFERENCES netgeo.projects(id) ON DELETE CASCADE,
    name        TEXT   NOT NULL,
    ratio       TEXT   NOT NULL DEFAULT '1:8',     -- 1:2 .. 1:64
    insertion_loss_db NUMERIC(5,2),
    latitude    DOUBLE PRECISION,
    longitude   DOUBLE PRECISION,
    attributes  JSONB  NOT NULL DEFAULT '{}'::jsonb,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT splitters_uuid_uq UNIQUE (uuid),
    CONSTRAINT splitters_name_uq UNIQUE (project_id, name)
);
CREATE INDEX idx_splitters_project ON netgeo.splitters(project_id);

-- ONTS
CREATE TABLE netgeo.onts (
    id                 BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    uuid               UUID   NOT NULL DEFAULT gen_random_uuid(),
    olt_id             BIGINT NOT NULL REFERENCES netgeo.olts(id) ON DELETE CASCADE,
    splitter_id        BIGINT REFERENCES netgeo.splitters(id) ON DELETE SET NULL,
    device_instance_id BIGINT REFERENCES netgeo.device_instances(id) ON DELETE SET NULL,
    serial             TEXT,
    pon_port           INTEGER,
    distance_m         DOUBLE PRECISION,
    rx_power_dbm       NUMERIC(6,2),
    attributes         JSONB  NOT NULL DEFAULT '{}'::jsonb,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT onts_uuid_uq   UNIQUE (uuid),
    CONSTRAINT onts_serial_uq UNIQUE (olt_id, serial)
);
CREATE INDEX idx_onts_olt      ON netgeo.onts(olt_id);
CREATE INDEX idx_onts_splitter ON netgeo.onts(splitter_id);

-- FIBER_LINKS (physical fiber segments, optionally bound to a logical link)
CREATE TABLE netgeo.fiber_links (
    id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    uuid            UUID   NOT NULL DEFAULT gen_random_uuid(),
    project_id      BIGINT NOT NULL REFERENCES netgeo.projects(id) ON DELETE CASCADE,
    link_id         BIGINT REFERENCES netgeo.links(id) ON DELETE SET NULL,
    olt_id          BIGINT REFERENCES netgeo.olts(id) ON DELETE SET NULL,
    splitter_id     BIGINT REFERENCES netgeo.splitters(id) ON DELETE SET NULL,
    ont_id          BIGINT REFERENCES netgeo.onts(id) ON DELETE SET NULL,
    fiber_kind      netgeo.fiber_kind NOT NULL DEFAULT 'single_mode',
    length_m        DOUBLE PRECISION,
    attenuation_db  NUMERIC(6,2),
    attributes      JSONB  NOT NULL DEFAULT '{}'::jsonb,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT fiber_links_uuid_uq UNIQUE (uuid)
);
CREATE INDEX idx_fiber_links_project ON netgeo.fiber_links(project_id);
CREATE INDEX idx_fiber_links_link    ON netgeo.fiber_links(link_id);

-- -----------------------------------------------------------------------------
-- updated_at triggers
-- -----------------------------------------------------------------------------
SELECT netgeo.attach_updated_at(ARRAY[
    'link_profiles','links','routing_tables','static_routes','bgp_neighbors',
    'ospf_areas','isis_instances','nat_rules','firewall_rules','qos_profiles',
    'antennas','rf_profiles','wireless_sites','radios',
    'olts','splitters','onts','fiber_links'
]);

INSERT INTO netgeo.schema_migrations(version, description)
VALUES ('0003','network: links, l3 control plane, wireless, optical')
ON CONFLICT DO NOTHING;

COMMIT;
