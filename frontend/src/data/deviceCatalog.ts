/**
 * Device palette catalog — the draggable device templates grouped by category.
 * Each entry seeds a new node (kind + default NOS + default interfaces).
 * This is UI seed data; the backend assigns real ids on create.
 */
import type { IfaceType, NodeKind, Nos } from '@/api/types';

export interface DeviceTemplate {
  key: string;
  label: string;
  kind: NodeKind;
  defaultNos: Nos;
  /** Interface bay: how many of each type the device ships with. */
  ports: { type: IfaceType; count: number; speed: number }[];
  description: string;
}

export interface DeviceGroup {
  category: string;
  devices: DeviceTemplate[];
}

export const deviceCatalog: DeviceGroup[] = [
  {
    category: 'Routing',
    devices: [
      {
        key: 'edge-router',
        label: 'Edge Router',
        kind: 'router',
        defaultNos: 'forgeos',
        ports: [{ type: 'sfp28', count: 4, speed: 25_000 }, { type: 'eth', count: 8, speed: 1_000 }],
        description: 'BGP/MPLS edge — multi-NOS target (IOS-XR/Junos/SR-OS).',
      },
      {
        key: 'core-router',
        label: 'Core Router',
        kind: 'router',
        defaultNos: 'frr',
        ports: [{ type: 'qsfp', count: 8, speed: 100_000 }],
        description: 'High-capacity backbone core, 100G/400G uplinks.',
      },
    ],
  },
  {
    category: 'Switching',
    devices: [
      {
        key: 'access-switch',
        label: 'Access Switch',
        kind: 'switch',
        defaultNos: 'eos',
        ports: [{ type: 'eth', count: 24, speed: 1_000 }, { type: 'sfp', count: 4, speed: 10_000 }],
        description: 'L2/L3 access, VLAN trunking, EVPN-VXLAN capable.',
      },
      {
        key: 'spine-switch',
        label: 'Spine Switch',
        kind: 'switch',
        defaultNos: 'nxos',
        ports: [{ type: 'qsfp', count: 32, speed: 100_000 }],
        description: 'Datacenter spine for spine-leaf fabrics.',
      },
    ],
  },
  {
    category: 'Wireless & Access',
    devices: [
      {
        key: 'wifi-ap',
        label: 'Wi-Fi 7 AP',
        kind: 'ap',
        defaultNos: 'forgeos',
        ports: [{ type: 'wifi', count: 3, speed: 5_800 }, { type: 'eth', count: 1, speed: 2_500 }],
        description: 'Tri-band Wi-Fi 7 access point with 2.5G uplink.',
      },
      {
        key: 'gpon-olt',
        label: 'GPON OLT',
        kind: 'olt',
        defaultNos: 'vrp',
        ports: [{ type: 'gpon', count: 16, speed: 2_488 }, { type: 'qsfp', count: 2, speed: 100_000 }],
        description: 'FTTH optical line terminal, 1:64 split per PON.',
      },
    ],
  },
  {
    category: 'Security & Compute',
    devices: [
      {
        key: 'firewall',
        label: 'Firewall',
        kind: 'firewall',
        defaultNos: 'junos',
        ports: [{ type: 'sfp28', count: 6, speed: 25_000 }],
        description: 'Zone-based NGFW for security-lab scenarios.',
      },
      {
        key: 'host',
        label: 'Host / PC',
        kind: 'host',
        defaultNos: 'forgeos',
        ports: [{ type: 'eth', count: 1, speed: 1_000 }],
        description: 'Generic endpoint for connectivity & traffic tests.',
      },
      {
        key: 'server',
        label: 'Server',
        kind: 'server',
        defaultNos: 'forgeos',
        ports: [{ type: 'sfp', count: 2, speed: 10_000 }],
        description: 'Application/DHCP/DNS server endpoint.',
      },
    ],
  },
];

/** Flat lookup by template key. */
export const deviceByKey: Record<string, DeviceTemplate> = Object.fromEntries(
  deviceCatalog.flatMap((g) => g.devices.map((d) => [d.key, d])),
);
