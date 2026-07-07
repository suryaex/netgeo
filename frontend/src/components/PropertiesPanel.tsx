/**
 * PropertiesPanel — inspector for the selected node (or empty state).
 * Edits name / NOS / mode and lists interfaces. Field commits patch the store
 * optimistically and PATCH the backend. Includes custom NOS entries from
 * nosStore so user-defined images are selectable alongside built-ins.
 */
import { useEffect, useState } from 'react';
import { Cpu, Plug, RefreshCw, Settings2 } from 'lucide-react';
import { useTopologyStore } from '@/store/topologyStore';
import { useNosStore } from '@/store/nosStore';
import { useUiStore } from '@/store/uiStore';
import { nodesApi, configsApi } from '@/api/client';
import { useWindowStore } from '@/store/windowStore';
import { CloudUplink } from '@/components/CloudUplink';
import type { NodeMode, Nos } from '@/api/types';

const BUILTIN_NOS: { value: string; label: string }[] = [
  { value: 'forgeos', label: 'NetGeo OS' },
  { value: 'ios', label: 'Cisco IOS' },
  { value: 'iosxr', label: 'Cisco IOS-XR' },
  { value: 'nxos', label: 'Cisco NX-OS' },
  { value: 'junos', label: 'Juniper JunOS' },
  { value: 'eos', label: 'Arista EOS' },
  { value: 'routeros', label: 'MikroTik RouterOS' },
  { value: 'vyos', label: 'VyOS' },
  { value: 'sros', label: 'Nokia SR-OS' },
  { value: 'frr', label: 'FRRouting' },
  { value: 'vrp', label: 'Huawei VRP' },
];

/** Status color mapping */
const STATUS_COLORS: Record<string, string> = {
  running: '#34C759',
  booting: '#FF9F0A',
  stopped: '#8E8E93',
  error: '#FF453A',
};

export function PropertiesPanel() {
  const node = useTopologyStore((s) => s.selectedNode());
  const upsertNode = useTopologyStore((s) => s.upsertNode);
  const openWindow = useWindowStore((s) => s.open);
  const { customNos } = useNosStore();
  const simState = useUiStore((s) => s.simState);
  const [name, setName] = useState('');

  useEffect(() => setName(node?.name ?? ''), [node?.id, node?.name]);

  if (!node) {
    return (
      <div className="grid h-full place-items-center p-6 text-center">
        <div className="space-y-3 text-fg/40">
          <Cpu className="mx-auto h-9 w-9 opacity-60" />
          <p className="text-sm font-medium">No device selected</p>
          <p className="text-xs leading-relaxed">
            Click a node on the canvas to inspect and edit its properties.
          </p>
        </div>
      </div>
    );
  }

  const patch = (p: Partial<typeof node>) => {
    const updated = { ...node, ...p };
    upsertNode(updated);
    void nodesApi.update(node.id, p).catch(() => {});
  };

  // During a live sim run the engine is stepping every node; reflect that in the
  // status indicator rather than showing the stored topology state ("stopped").
  // The backend only publishes sim.tick events during a run — it does not emit
  // per-node node.status events — so we derive the effective status here.
  const effectiveStatus =
    simState === 'running' || simState === 'paused' ? 'running' : node.status;
  const statusColor = STATUS_COLORS[effectiveStatus] ?? '#8E8E93';

  // Combine built-in + custom NOS options.
  const nosOptions = [
    ...BUILTIN_NOS,
    ...(customNos.length > 0
      ? [
          { value: '__sep__', label: '— Custom NOS —', disabled: true } as {
            value: string;
            label: string;
            disabled?: boolean;
          },
          ...customNos.map((n) => ({ value: n.key, label: n.label })),
        ]
      : []),
  ];

  return (
    <div className="ng-scroll h-full space-y-4 overflow-auto p-3">
      {/* Node summary header */}
      <div className="flex items-center gap-2.5 rounded-lg border border-fg/8 bg-fg/4 px-3 py-2">
        <div
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-xs font-bold uppercase"
          style={{ background: `${statusColor}20`, color: statusColor }}
        >
          {node.kind[0]?.toUpperCase()}
        </div>
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-fg/90">{node.name}</p>
          <p className="text-[10px] text-fg/40">
            {node.kind} &middot; {node.nos}
          </p>
        </div>
      </div>

      <Field label="Name">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={() => name !== node.name && patch({ name })}
          className="w-full rounded-md border border-fg/10 bg-recess/20 px-2 py-1.5 text-sm text-fg/90 outline-none transition-colors focus:border-accent"
        />
      </Field>

      <div className="grid grid-cols-2 gap-2">
        <Field label="NOS">
          <select
            value={node.nos}
            onChange={(e) => patch({ nos: e.target.value as Nos })}
            className="w-full rounded-md border border-fg/10 bg-recess/20 px-2 py-1.5 text-sm text-fg/90 outline-none transition-colors focus:border-accent"
          >
            {nosOptions.map((n) =>
              'disabled' in n && n.disabled ? (
                <option key={n.value} value={n.value} disabled className="bg-[#141A2E] text-fg/40">
                  {n.label}
                </option>
              ) : (
                <option key={n.value} value={n.value} className="bg-[#141A2E]">
                  {n.label}
                </option>
              ),
            )}
          </select>
        </Field>
        <Field label="Mode">
          <div className="flex rounded-md border border-fg/10 bg-recess/20 p-0.5">
            {(['sim', 'emul'] as NodeMode[]).map((m) => (
              <button
                key={m}
                onClick={() => patch({ mode: m })}
                className={`flex-1 rounded px-2 py-1 text-xs uppercase transition-colors ${
                  node.mode === m
                    ? 'bg-accent text-fg'
                    : 'text-fg/50 hover:text-fg/80'
                }`}
              >
                {m}
              </button>
            ))}
          </div>
        </Field>
      </div>

      <Field label="Status">
        <span className="inline-flex items-center gap-1.5 rounded-md bg-fg/5 px-2.5 py-1 text-xs text-fg/80">
          <span className="h-1.5 w-1.5 rounded-full" style={{ background: statusColor }} />
          {effectiveStatus}
        </span>
      </Field>

      {node.kind === 'cloud' && <CloudUplink node={node} patch={patch} />}

      <section>
        <h4 className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-fg/45">
          <Plug className="h-3.5 w-3.5" />
          Interfaces
          <span className="ml-auto rounded-full bg-fg/8 px-1.5 py-0.5 text-[10px] font-normal">
            {node.interfaces.length}
          </span>
        </h4>
        {node.interfaces.length === 0 ? (
          <p className="rounded-md border border-dashed border-fg/10 p-3 text-center text-xs text-fg/35">
            No interfaces yet. Connect a link to provision one.
          </p>
        ) : (
          <ul className="space-y-1">
            {node.interfaces.map((i) => (
              <li
                key={i.id}
                className="flex items-center justify-between rounded-md bg-fg/4 px-2.5 py-1.5 text-xs"
              >
                <span className="font-mono text-fg/80">{i.name}</span>
                <span className="text-fg/40">
                  {i.type} &middot; {i.speed >= 1000 ? `${(i.speed / 1000).toFixed(0)}G` : `${i.speed}M`}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <div className="flex gap-2">
        <button
          onClick={() =>
            void configsApi.generate(node.id, node.nos).then(() =>
              openWindow('config', {
                title: `Config · ${node.name}`,
                context: { nodeId: node.id },
              }),
            )
          }
          className="flex flex-1 items-center justify-center gap-2 rounded-md bg-accent px-3 py-2 text-sm font-medium text-fg transition-colors hover:bg-accent-soft"
        >
          <RefreshCw className="h-4 w-4" />
          Generate config
        </button>

        {customNos.length > 0 && (
          <button
            onClick={() => openWindow('settings', { title: 'Settings' })}
            title="Manage custom NOS in Settings"
            className="flex items-center justify-center rounded-md border border-fg/10 bg-fg/5 px-2.5 py-2 text-fg/50 transition-colors hover:border-accent/40 hover:text-accent"
          >
            <Settings2 className="h-4 w-4" />
          </button>
        )}
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1">
      <span className="text-[11px] font-medium uppercase tracking-wide text-fg/40">{label}</span>
      {children}
    </label>
  );
}
