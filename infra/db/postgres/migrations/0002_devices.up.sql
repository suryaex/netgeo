-- =============================================================================
-- NetGeo — Enterprise (PostgreSQL) — Migration 0002: DEVICES
-- =============================================================================
-- Source of truth for the device library (global catalog) + per-project device
-- instances, interfaces, addressing and VLANs.
-- Spec: NetGeo/08_DATABASE_AND_ERD.md "Devices" + database_erd.mmd.
--
-- Catalog tables (vendors, operating_systems, device_models) are GLOBAL — they
-- back the downloadable "Device Library" (11_INSTALLATION.md). Instance tables
-- (device_instances, interfaces, ...) are PROJECT-scoped and cascade with it.
--
-- Depends on: 0001_core (netgeo schema, helpers, projects, users).
-- =============================================================================
BEGIN;
SET search_path TO netgeo, public;

-- -----------------------------------------------------------------------------
-- Enumerations (devices)
-- -----------------------------------------------------------------------------
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname='device_category') THEN
        CREATE TYPE netgeo.device_category AS ENUM
            ('router','switch','firewall','load_balancer','access_point',
             'olt','ont','server','host','wireless_controller','optical_node','other');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname='device_mode') THEN
        CREATE TYPE netgeo.device_mode AS ENUM ('sim','emul');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname='device_status') THEN
        CREATE TYPE netgeo.device_status AS ENUM
            ('stopped','booting','running','degraded','error');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname='interface_kind') THEN
        CREATE TYPE netgeo.interface_kind AS ENUM
            ('ethernet','sfp','sfp28','qsfp','qsfp28','gpon','xgs_pon','wifi',
             'loopback','vlan','tunnel','lag','mgmt','serial');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname='admin_status') THEN
        CREATE TYPE netgeo.admin_status AS ENUM ('up','down');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname='oper_status') THEN
        CREATE TYPE netgeo.oper_status AS ENUM ('up','down','testing','unknown','dormant');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname='config_format') THEN
        CREATE TYPE netgeo.config_format AS ENUM ('cli','netconf','restconf','yaml','json');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname='vlan_mode') THEN
        CREATE TYPE netgeo.vlan_mode AS ENUM ('access','trunk','native','tagged','untagged');
    END IF;
END$$;

-- =============================================================================
-- VENDORS  (global catalog)
-- =============================================================================
CREATE TABLE netgeo.vendors (
    id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    uuid         UUID   NOT NULL DEFAULT gen_random_uuid(),
    name         CITEXT NOT NULL,                 -- "Cisco", "Juniper", "MikroTik", "ForgeOS"
    display_name TEXT,
    website      TEXT,
    is_builtin   BOOLEAN NOT NULL DEFAULT FALSE,  -- shipped with the device library
    metadata     JSONB  NOT NULL DEFAULT '{}'::jsonb,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT vendors_uuid_uq UNIQUE (uuid),
    CONSTRAINT vendors_name_uq UNIQUE (name)
);

-- =============================================================================
-- OPERATING_SYSTEMS  (NOS catalog; 'forgeos' = native declarative NOS, §5)
-- =============================================================================
CREATE TABLE netgeo.operating_systems (
    id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    uuid         UUID   NOT NULL DEFAULT gen_random_uuid(),
    vendor_id    BIGINT REFERENCES netgeo.vendors(id) ON DELETE SET NULL,
    name         CITEXT NOT NULL,                 -- "IOS-XR","Junos","RouterOS","ForgeOS"
    family       TEXT,                            -- "ios","junos","frr",...
    version      TEXT   NOT NULL DEFAULT 'any',
    is_forgeos   BOOLEAN NOT NULL DEFAULT FALSE,
    cli_dialect  TEXT,                            -- hint for config renderer
    capabilities JSONB  NOT NULL DEFAULT '{}'::jsonb,  -- protocols/features supported
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT operating_systems_uuid_uq UNIQUE (uuid),
    CONSTRAINT operating_systems_nver_uq UNIQUE (vendor_id, name, version)
);
CREATE INDEX idx_os_vendor ON netgeo.operating_systems(vendor_id);
CREATE INDEX idx_os_caps   ON netgeo.operating_systems USING GIN (capabilities);

-- =============================================================================
-- DEVICE_MODELS  (hardware models in the catalog)
-- =============================================================================
CREATE TABLE netgeo.device_models (
    id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    uuid          UUID   NOT NULL DEFAULT gen_random_uuid(),
    vendor_id     BIGINT NOT NULL REFERENCES netgeo.vendors(id) ON DELETE CASCADE,
    default_os_id BIGINT REFERENCES netgeo.operating_systems(id) ON DELETE SET NULL,
    name          CITEXT NOT NULL,                -- "CCR2004","MX204","C9300-48"
    category      netgeo.device_category NOT NULL,
    port_layout   JSONB  NOT NULL DEFAULT '[]'::jsonb,  -- declarative port template
    specs         JSONB  NOT NULL DEFAULT '{}'::jsonb,  -- cpu/mem/throughput/power
    emul_image    TEXT,                           -- container image for mode 'emul'
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT device_models_uuid_uq UNIQUE (uuid),
    CONSTRAINT device_models_name_uq UNIQUE (vendor_id, name)
);
CREATE INDEX idx_device_models_vendor   ON netgeo.device_models(vendor_id);
CREATE INDEX idx_device_models_category ON netgeo.device_models(category);

-- =============================================================================
-- DEVICE_INSTANCES  (a device placed on a project canvas)
-- =============================================================================
CREATE TABLE netgeo.device_instances (
    id                BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    uuid              UUID   NOT NULL DEFAULT gen_random_uuid(),
    project_id        BIGINT NOT NULL REFERENCES netgeo.projects(id) ON DELETE CASCADE,
    device_model_id   BIGINT REFERENCES netgeo.device_models(id) ON DELETE SET NULL,
    operating_system_id BIGINT REFERENCES netgeo.operating_systems(id) ON DELETE SET NULL,
    name              TEXT   NOT NULL,
    hostname          TEXT,
    category          netgeo.device_category NOT NULL DEFAULT 'router',
    role              TEXT,                        -- core/distribution/access/edge/...
    mode              netgeo.device_mode   NOT NULL DEFAULT 'sim',
    status            netgeo.device_status NOT NULL DEFAULT 'stopped',
    mgmt_ip           INET,
    position_x        DOUBLE PRECISION NOT NULL DEFAULT 0,   -- canvas coords
    position_y        DOUBLE PRECISION NOT NULL DEFAULT 0,
    -- active_config_id closes a cyclic FK to device_configs (added below).
    active_config_id  BIGINT,
    attributes        JSONB  NOT NULL DEFAULT '{}'::jsonb,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at        TIMESTAMPTZ,
    CONSTRAINT device_instances_uuid_uq UNIQUE (uuid),
    CONSTRAINT device_instances_name_uq UNIQUE (project_id, name)
);
CREATE INDEX idx_device_instances_project ON netgeo.device_instances(project_id);
CREATE INDEX idx_device_instances_status  ON netgeo.device_instances(project_id, status);
CREATE INDEX idx_device_instances_model   ON netgeo.device_instances(device_model_id);
CREATE INDEX idx_device_instances_attrs   ON netgeo.device_instances USING GIN (attributes);

-- =============================================================================
-- DEVICE_CONFIGS  (append-only rendered config history; ForgeOS intent → NOS)
-- Extension beyond the bare ERD list: load-bearing for ForgeOS "one intent →
-- many target NOS" auditing (02/04 specs). Exactly one is_active per device.
-- =============================================================================
CREATE TABLE netgeo.device_configs (
    id                 BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    uuid               UUID   NOT NULL DEFAULT gen_random_uuid(),
    device_instance_id BIGINT NOT NULL REFERENCES netgeo.device_instances(id) ON DELETE CASCADE,
    operating_system_id BIGINT REFERENCES netgeo.operating_systems(id) ON DELETE SET NULL,
    format             netgeo.config_format NOT NULL DEFAULT 'cli',
    source_intent      JSONB,                       -- ForgeOS declarative source
    content            TEXT   NOT NULL,             -- rendered config
    version            INTEGER NOT NULL DEFAULT 1,  -- per-device revision
    is_active          BOOLEAN NOT NULL DEFAULT FALSE,
    generated_by       BIGINT REFERENCES netgeo.users(id) ON DELETE SET NULL,
    generated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT device_configs_uuid_uq UNIQUE (uuid),
    CONSTRAINT device_configs_version_pos CHECK (version >= 1)
);
CREATE INDEX idx_device_configs_device
    ON netgeo.device_configs(device_instance_id, generated_at DESC);
-- At most one active config per device.
CREATE UNIQUE INDEX uq_device_configs_active
    ON netgeo.device_configs(device_instance_id) WHERE is_active;

-- Close the cyclic FK device_instances.active_config_id -> device_configs.id.
ALTER TABLE netgeo.device_instances
    ADD CONSTRAINT device_instances_active_config_fk
    FOREIGN KEY (active_config_id)
    REFERENCES netgeo.device_configs(id) ON DELETE SET NULL;

-- =============================================================================
-- INTERFACES  (ports/logical interfaces on a device instance)
-- =============================================================================
CREATE TABLE netgeo.interfaces (
    id                   BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    uuid                 UUID   NOT NULL DEFAULT gen_random_uuid(),
    device_instance_id   BIGINT NOT NULL REFERENCES netgeo.device_instances(id) ON DELETE CASCADE,
    parent_interface_id  BIGINT REFERENCES netgeo.interfaces(id) ON DELETE CASCADE, -- subif/breakout/LAG member
    name                 TEXT   NOT NULL,           -- "GigabitEthernet0/1","eth0.100"
    kind                 netgeo.interface_kind NOT NULL DEFAULT 'ethernet',
    mac                  MACADDR,
    speed_mbps           BIGINT,
    mtu                  INTEGER NOT NULL DEFAULT 1500,
    admin                netgeo.admin_status NOT NULL DEFAULT 'up',
    oper                 netgeo.oper_status  NOT NULL DEFAULT 'down',
    description          TEXT,
    -- peer_link_id closes a cyclic FK to links (added in 0003).
    peer_link_id         BIGINT,
    attributes           JSONB  NOT NULL DEFAULT '{}'::jsonb,
    created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT interfaces_uuid_uq  UNIQUE (uuid),
    CONSTRAINT interfaces_name_uq  UNIQUE (device_instance_id, name),
    CONSTRAINT interfaces_mtu_chk  CHECK (mtu BETWEEN 64 AND 65535),
    CONSTRAINT interfaces_speed_chk CHECK (speed_mbps IS NULL OR speed_mbps > 0)
);
CREATE INDEX idx_interfaces_device ON netgeo.interfaces(device_instance_id);
CREATE INDEX idx_interfaces_parent ON netgeo.interfaces(parent_interface_id);
CREATE INDEX idx_interfaces_peer   ON netgeo.interfaces(peer_link_id);

-- =============================================================================
-- INTERFACE_ADDRESSES  (1:N — multiple v4/v6 addresses per interface)
-- =============================================================================
CREATE TABLE netgeo.interface_addresses (
    id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    uuid         UUID   NOT NULL DEFAULT gen_random_uuid(),
    interface_id BIGINT NOT NULL REFERENCES netgeo.interfaces(id) ON DELETE CASCADE,
    address      INET   NOT NULL,                   -- holds host + prefix len
    family       SMALLINT GENERATED ALWAYS AS (family(address)) STORED,  -- 4 or 6
    is_primary   BOOLEAN NOT NULL DEFAULT FALSE,
    vrf          TEXT   NOT NULL DEFAULT 'default',
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT interface_addresses_uuid_uq UNIQUE (uuid),
    CONSTRAINT interface_addresses_uq      UNIQUE (interface_id, address)
);
CREATE INDEX idx_iface_addr_iface  ON netgeo.interface_addresses(interface_id);
CREATE INDEX idx_iface_addr_addr   ON netgeo.interface_addresses USING GIST (address inet_ops);
-- Only one primary address per (interface, family).
CREATE UNIQUE INDEX uq_iface_addr_primary
    ON netgeo.interface_addresses(interface_id, family) WHERE is_primary;

-- =============================================================================
-- VLANS  (project-scoped L2 domains)
-- =============================================================================
CREATE TABLE netgeo.vlans (
    id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    uuid        UUID   NOT NULL DEFAULT gen_random_uuid(),
    project_id  BIGINT NOT NULL REFERENCES netgeo.projects(id) ON DELETE CASCADE,
    vlan_id     INTEGER NOT NULL,                   -- 1..4094
    name        TEXT,
    description TEXT,
    attributes  JSONB  NOT NULL DEFAULT '{}'::jsonb,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT vlans_uuid_uq  UNIQUE (uuid),
    CONSTRAINT vlans_vid_uq   UNIQUE (project_id, vlan_id),
    CONSTRAINT vlans_vid_chk  CHECK (vlan_id BETWEEN 1 AND 4094)
);
CREATE INDEX idx_vlans_project ON netgeo.vlans(project_id);

-- INTERFACE_VLANS  (bridge: which VLANs are on which interface, tagging mode)
CREATE TABLE netgeo.interface_vlans (
    interface_id BIGINT NOT NULL REFERENCES netgeo.interfaces(id) ON DELETE CASCADE,
    vlan_id      BIGINT NOT NULL REFERENCES netgeo.vlans(id) ON DELETE CASCADE,
    mode         netgeo.vlan_mode NOT NULL DEFAULT 'tagged',
    PRIMARY KEY (interface_id, vlan_id)
);
CREATE INDEX idx_interface_vlans_vlan ON netgeo.interface_vlans(vlan_id);

-- -----------------------------------------------------------------------------
-- updated_at triggers
-- -----------------------------------------------------------------------------
SELECT netgeo.attach_updated_at(ARRAY[
    'vendors','operating_systems','device_models','device_instances',
    'interfaces','interface_addresses','vlans'
]);

INSERT INTO netgeo.schema_migrations(version, description)
VALUES ('0002','devices: catalog, instances, interfaces, addressing, vlans')
ON CONFLICT DO NOTHING;

COMMIT;
