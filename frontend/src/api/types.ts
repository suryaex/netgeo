/**
 * NetForge shared data model — mirrors MASTER_SPEC §4 exactly.
 * These types are the contract between frontend and the FastAPI backend.
 * Keep field names in sync with the backend Pydantic schemas.
 */

export type NodeKind = 'router' | 'switch' | 'host' | 'ap' | 'olt' | 'firewall' | 'server';

export type Nos =
  | 'forgeos'
  | 'ios'
  | 'iosxr'
  | 'nxos'
  | 'junos'
  | 'eos'
  | 'routeros'
  | 'vyos'
  | 'sros'
  | 'frr'
  | 'vrp';

export type NodeMode = 'sim' | 'emul';
export type NodeStatus = 'stopped' | 'booting' | 'running' | 'error';

export type IfaceType = 'eth' | 'sfp' | 'sfp28' | 'qsfp' | 'gpon' | 'wifi';
export type LinkType = 'copper' | 'fiber' | 'wireless' | 'virtual';
export type LinkStatus = 'up' | 'down' | 'admin_down' | 'unknown';
export type ConfigFormat = 'cli' | 'netconf' | 'yaml';

export interface Interface {
  id: string;
  node_id: string;
  name: string;
  type: IfaceType;
  ip: string[];
  mac: string;
  speed: number; // Mbps
  mtu: number;
  peer_link_id: string | null;
}

export interface NodeModel {
  id: string;
  name: string;
  kind: NodeKind;
  nos: Nos;
  mode: NodeMode;
  x: number;
  y: number;
  interfaces: Interface[];
  config_ref: string | null;
  status: NodeStatus;
}

export interface LinkModel {
  id: string;
  a_iface: string;
  b_iface: string;
  type: LinkType;
  bandwidth: number; // Mbps
  delay: number; // ms
  loss: number; // percent 0..100
  mtu: number;
  status?: LinkStatus;
}

export interface Project {
  id: string;
  name: string;
  description: string;
  version: string;
  topology_ref: string;
  created_at: string;
}

export interface ScenarioStep {
  id: string;
  description: string;
  action: string;
}

export interface Scenario {
  id: string;
  project_id: string;
  name: string;
  steps: ScenarioStep[];
  expected_outcomes: string[];
}

export interface ConfigArtifact {
  id: string;
  node_id: string;
  vendor: string;
  format: ConfigFormat;
  content: string;
  generated_at: string;
}

/** Full graph payload from GET /api/projects/{id}/topology and /ws/topology. */
export interface Topology {
  nodes: NodeModel[];
  links: LinkModel[];
}

/** Realtime events pushed over /ws/topology. */
export type TopologyEvent =
  | { type: 'snapshot'; topology: Topology }
  | { type: 'node.updated'; node: NodeModel }
  | { type: 'node.status'; node_id: string; status: NodeStatus }
  | { type: 'link.updated'; link: LinkModel }
  | { type: 'link.status'; link_id: string; status: LinkStatus }
  | { type: 'sim.tick'; t: number; metrics?: Record<string, number> };

/** Console frames over /ws/console/{node_id}. */
export type ConsoleEvent =
  | { type: 'output'; node_id: string; data: string }
  | { type: 'prompt'; node_id: string; prompt: string }
  | { type: 'closed'; node_id: string; reason?: string };

/** Simulation lifecycle. */
export type SimState = 'idle' | 'running' | 'paused' | 'stepping';

export interface SimulateRequest {
  project_id: string;
  mode: 'realtime' | 'fast';
  speed?: number;
}
