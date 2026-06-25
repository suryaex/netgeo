/**
 * PropertiesPanel — inspector for the selected node (or empty state).
 * Edits name / NOS / mode and lists interfaces. Field commits patch the store
 * optimistically and PATCH the backend. NOS dropdown drives ForgeOS intent vs
 * concrete-vendor targets. Includes an empty state (no selection) per UX rules.
 */
import { useEffect, useState } from 'react';
import { Cpu, Plug, RefreshCw } from 'lucide-react';
import { useTopologyStore } from '@/store/topologyStore';
import { nodesApi, configsApi } from '@/api/client';
import { useWindowStore } from '@/store/windowStore';
import { CloudUplink } from '@/components/CloudUplink';
import type { NodeMode, Nos } from '@/api/types';

const NOS_OPTIONS: Nos[] = [
  'forgeos',
  'ios',
  'iosxr',
  'nxos',
  'junos',
  'eos',
  'routeros',
  'vyos',
  'sros',
  'frr',
  'vrp',
];

export function PropertiesPanel() {
  const node = useTopologyStore((s) => s.selectedNode());
  const upsertNode = useTopologyStore((s) => s.upsertNode);
  const openWindow = useWindowStore((s) => s.open);
  const [name, setName] = useState('');

  useEffect(() => setName(node?.name ?? ''), [node?.id, node?.name]);

  if (!node) {
    return (
      <div className="grid h-full place-items-center p-6 text-center">
        <div className="space-y-2 text-white/40">
          <Cpu className="mx-auto h-8 w-8" />
          <p className="text-sm">No device selected</p>
          <p className="text-xs">Select a node on the canvas to edit its properties.</p>
        </div>
      </div>
    );
  }

  const patch = (p: Partial<typeof node>) => {
    const updated = { ...node, ...p };
    upsertNode(updated);
    void nodesApi.update(node.id, p).catch(() => {});
  };

  return (
    <div className="nf-scroll h-full space-y-4 overflow-auto p-3">
      <Field label="Name">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={() => name !== node.name && patch({ name })}
          className="w-full rounded-md border border-white/10 bg-black/20 px-2 py-1.5 text-sm text-white/90 outline-none focus:border-accent"
        />
      </Field>

      <div className="grid grid-cols-2 gap-2">
        <Field label="NOS">
          <select
            value={node.nos}
            onChange={(e) => patch({ nos: e.target.value as Nos })}
            className="w-full rounded-md border border-white/10 bg-black/20 px-2 py-1.5 text-sm text-white/90 outline-none focus:border-accent"
          >
            {NOS_OPTIONS.map((n) => (
              <option key={n} value={n} className="bg-[#141A2E]">
                {n.toUpperCase()}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Mode">
          <div className="flex rounded-md border border-white/10 bg-black/20 p-0.5">
            {(['sim', 'emul'] as NodeMode[]).map((m) => (
              <button
                key={m}
                onClick={() => patch({ mode: m })}
                className={`flex-1 rounded px-2 py-1 text-xs uppercase ${
                  node.mode === m ? 'bg-accent text-white' : 'text-white/60'
                }`}
              >
                {m}
              </button>
            ))}
          </div>
        </Field>
      </div>

      <Field label="Status">
        <span className="inline-flex items-center gap-1.5 rounded-md bg-white/5 px-2 py-1 text-xs text-white/80">
          <span className="h-2 w-2 rounded-full bg-success" />
          {node.status}
        </span>
      </Field>

      {node.kind === 'cloud' && <CloudUplink node={node} patch={patch} />}

      <section>
        <h4 className="mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-white/50">
          <Plug className="h-3.5 w-3.5" /> Interfaces ({node.interfaces.length})
        </h4>
        {node.interfaces.length === 0 ? (
          <p className="rounded-md border border-dashed border-white/10 p-3 text-center text-xs text-white/40">
            No interfaces yet. Connect a link to provision one.
          </p>
        ) : (
          <ul className="space-y-1">
            {node.interfaces.map((i) => (
              <li
                key={i.id}
                className="flex items-center justify-between rounded-md bg-white/5 px-2 py-1.5 text-xs"
              >
                <span className="font-mono text-white/85">{i.name}</span>
                <span className="text-white/50">
                  {i.type} · {(i.speed / 1000).toFixed(0)}G
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <button
        onClick={() =>
          void configsApi.generate(node.id, node.nos).then(() =>
            openWindow('config', { title: `Config · ${node.name}`, context: { nodeId: node.id } }),
          )
        }
        className="flex w-full items-center justify-center gap-2 rounded-md bg-accent px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-accent-soft"
      >
        <RefreshCw className="h-4 w-4" /> Generate config
      </button>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1">
      <span className="text-[11px] font-medium uppercase tracking-wide text-white/45">{label}</span>
      {children}
    </label>
  );
}
