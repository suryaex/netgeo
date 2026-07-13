/**
 * AddressingWizard — the auto-addressing modal (v1.2.33, clay design
 * `docs/design/stitch-html/clay/wizard-{dark,light}.html`). A 3-step exclusive
 * modal on the uiStore.activeModal slot: Scope (confirm the whole active
 * topology) -> Preview (dry-run plan, dual-stack v4+v6 tables) -> Apply (persist
 * + refresh topology). Backend: POST /lab/{id}/auto-address with `dry_run` for
 * the honest preview.
 */
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, ArrowRightLeft, Cable, Check, Loader2, Network, Play } from 'lucide-react';
import { labApi } from '@/api/client';
import type { AddressingPlan } from '@/api/types';
import { ModalScrim } from '@/components/shell/ModalScrim';
import { useUiStore } from '@/store/uiStore';
import { useTopologyStore } from '@/store/topologyStore';
import { cn } from '@/lib/cn';

type Step = 'scope' | 'preview' | 'apply';

interface Segment {
  label: string;
  subnet: string; // IPv4 network CIDR
  prefix: string; // IPv6 /64 network
  hosts: number; // usable host capacity
  gwV4: string | null;
  gwV6: string | null;
  p2p: boolean;
}

interface PlanView {
  segments: Segment[];
  interfaces: number;
  lanDomains: number;
  p2pLinks: number;
}

function networkV4(cidr: string): { subnet: string; prefix: number } {
  const [ip = '', p = '32'] = cidr.split('/');
  const prefix = Number(p);
  const o = ip.split('.').map(Number);
  const int = (((o[0] ?? 0) << 24) | ((o[1] ?? 0) << 16) | ((o[2] ?? 0) << 8) | (o[3] ?? 0)) >>> 0;
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
  const net = (int & mask) >>> 0;
  return { subnet: `${(net >>> 24) & 255}.${(net >>> 16) & 255}.${(net >>> 8) & 255}.${net & 255}/${prefix}`, prefix };
}

// ponytail: the planner emits ULA host bits only in the final group, so the /64
// network is everything up to "::". True for auto-address output, not arbitrary v6.
function networkV6(cidr: string): string {
  const addr = cidr.split('/')[0] ?? '';
  return addr.includes('::') ? `${addr.split('::')[0] ?? ''}::/64` : `${addr}/64`;
}

function hostCapacity(prefix: number): number {
  const size = 2 ** (32 - prefix);
  return prefix >= 31 ? size : size - 2;
}

/** Fold the flat per-interface plan into broadcast-domain segments for the tables. */
function planToView(plan: AddressingPlan): PlanView {
  const byNet = new Map<string, Segment & { key: string }>();
  let interfaces = 0;

  for (const [nodeId, ifaces] of Object.entries(plan.assignments)) {
    for (const [ifaceId, cidr] of Object.entries(ifaces)) {
      interfaces += 1;
      const { subnet, prefix } = networkV4(cidr);
      let seg = byNet.get(subnet);
      if (!seg) {
        const v6 = plan.assignments6[nodeId]?.[ifaceId];
        seg = { key: subnet, label: '', subnet, prefix: v6 ? networkV6(v6) : '—', hosts: hostCapacity(prefix), gwV4: null, gwV6: null, p2p: prefix >= 30 };
        byNet.set(subnet, seg);
      }
      // Gateways are per-host-node; the host's iface sits in this segment.
      if (plan.gateways[nodeId] && !seg.gwV4) {
        seg.gwV4 = plan.gateways[nodeId];
        seg.gwV6 = plan.gateways6[nodeId] ?? null;
      }
    }
  }

  const segments = [...byNet.values()].sort((a, b) => Number(a.p2p) - Number(b.p2p) || a.subnet.localeCompare(b.subnet));
  let lan = 0;
  let p2p = 0;
  for (const s of segments) s.label = s.p2p ? `P2P-${++p2p}` : `LAN-${++lan}`;

  return { segments, interfaces, lanDomains: lan, p2pLinks: p2p };
}

function Stepper({ step }: { step: Step }) {
  const steps: { id: Step; label: string }[] = [
    { id: 'scope', label: 'Scope' },
    { id: 'preview', label: 'Preview' },
    { id: 'apply', label: 'Apply' },
  ];
  const activeIdx = steps.findIndex((s) => s.id === step);
  return (
    <div className="mt-2 flex items-center font-mono text-[11px]">
      {steps.map((s, i) => (
        <div key={s.id} className="flex flex-1 items-center last:flex-none">
          <div className={cn('flex items-center', i === activeIdx ? 'text-accent' : i < activeIdx ? 'text-fg/70' : 'text-fg/40')}>
            <span
              className={cn(
                'mr-2 grid h-5 w-5 place-items-center rounded-full text-[10px]',
                i === activeIdx ? 'bg-accent text-accent-fg' : i < activeIdx ? 'bg-fg/15 text-fg' : 'border border-current',
              )}
            >
              {i < activeIdx ? <Check className="h-3 w-3" /> : i + 1}
            </span>
            {s.label}
          </div>
          {i < steps.length - 1 && <div className="mx-3 h-px flex-1 bg-fg/10" />}
        </div>
      ))}
    </div>
  );
}

function Chip({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-1.5 rounded-md border border-fg/10 bg-fg/5 px-2.5 py-1.5 font-mono text-[11px] text-fg/75">
      <span className="text-fg/40">{icon}</span>
      {children}
    </div>
  );
}

export function AddressingWizard({ onClose }: { onClose: () => void }) {
  const projectId = useUiStore((s) => s.projectId);
  const nodes = useTopologyStore((s) => s.nodes);
  const queryClient = useQueryClient();
  const [step, setStep] = useState<Step>('scope');

  const nodeCount = nodes.size;
  const ifaceCount = [...nodes.values()].reduce((n, node) => n + node.interfaces.length, 0);

  const preview = useQuery({
    queryKey: ['addressing-preview', projectId],
    queryFn: () => labApi.autoAddress(projectId!, true),
    enabled: !!projectId && (step === 'preview' || step === 'apply'),
    select: (d) => planToView(d.plan),
    staleTime: 30_000,
  });

  const apply = useMutation({
    mutationFn: () => labApi.autoAddress(projectId!, false),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['topology', projectId] }),
  });

  const view = preview.data;

  return (
    <ModalScrim label="Auto-addressing wizard" onClose={onClose} className="max-w-[720px]">
      {/* Header + stepper */}
      <div className="flex flex-col gap-3 border-b border-fg/10 px-6 py-5">
        <h2 className="font-display text-lg font-semibold text-fg">Auto-addressing wizard</h2>
        <Stepper step={step} />
      </div>

      {/* Body */}
      <div className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto px-6 py-6">
        {step === 'scope' && (
          <div className="flex flex-col gap-4 text-sm text-fg/70">
            <p>
              This assigns dual-stack addressing to <strong className="text-fg/90">the entire active project</strong>: IPv4 /30 + IPv6
              ULA /64 for router-to-router links, and /24 + /64 per switch domain with host default gateways.
            </p>
            <div className="flex gap-3">
              <Chip icon={<Network className="h-4 w-4" />}>{nodeCount} devices</Chip>
              <Chip icon={<Cable className="h-4 w-4" />}>{ifaceCount} interfaces</Chip>
            </div>
            <p className="text-xs text-fg/45">
              There are no options to configure — the plan is derived from the current topology. Continue to preview the exact addresses
              before anything is written.
            </p>
          </div>
        )}

        {step === 'preview' && (
          <>
            {preview.isPending && (
              <div className="flex items-center gap-2 py-10 text-sm text-fg/50">
                <Loader2 className="h-4 w-4 animate-spin" /> Computing addressing plan…
              </div>
            )}
            {preview.isError && (
              <div className="flex flex-col items-start gap-3 py-8 text-sm text-danger">
                <span>Could not compute the plan.</span>
                <button onClick={() => preview.refetch()} className="rounded-md border border-fg/15 px-3 py-1.5 text-xs text-fg/80 hover:bg-fg/10">
                  Retry
                </button>
              </div>
            )}
            {view && view.segments.length === 0 && (
              <div className="py-10 text-center text-sm text-fg/50">No addressable interfaces in this topology yet.</div>
            )}
            {view && view.segments.length > 0 && (
              <>
                <div className="flex flex-wrap gap-3">
                  <Chip icon={<Cable className="h-4 w-4" />}>{view.interfaces} interfaces</Chip>
                  <Chip icon={<Network className="h-4 w-4" />}>{view.lanDomains} LAN domains</Chip>
                  <Chip icon={<ArrowRightLeft className="h-4 w-4" />}>{view.p2pLinks} p2p links</Chip>
                </div>

                <Section title="IPv4 domains" dot="bg-info">
                  <table className="w-full border-collapse text-left font-mono text-xs">
                    <thead>
                      <tr className="text-[11px] text-fg/50">
                        <Th>Segment</Th>
                        <Th>Subnet</Th>
                        <Th>Gateway</Th>
                        <Th>Hosts</Th>
                      </tr>
                    </thead>
                    <tbody className="text-fg/80">
                      {view.segments.map((s) => (
                        <tr key={s.subnet} className="hover:bg-fg/5">
                          <Td className="text-fg/90">{s.label}</Td>
                          <Td>{s.subnet}</Td>
                          <Td>{s.gwV4 ?? '—'}</Td>
                          <Td className="text-fg/50">{s.hosts}</Td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </Section>

                <Section title="IPv6 (ULA)" dot="bg-accent">
                  <table className="w-full border-collapse text-left font-mono text-xs">
                    <thead>
                      <tr className="text-[11px] text-fg/50">
                        <Th>Segment</Th>
                        <Th>Prefix</Th>
                        <Th>Gateway</Th>
                      </tr>
                    </thead>
                    <tbody className="text-fg/80">
                      {view.segments.map((s) => (
                        <tr key={s.subnet} className="hover:bg-fg/5">
                          <Td className="text-fg/90">{s.label}</Td>
                          <Td>{s.prefix}</Td>
                          <Td>{s.gwV6 ?? '—'}</Td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </Section>
              </>
            )}
          </>
        )}

        {step === 'apply' && (
          <div className="flex flex-col items-center justify-center gap-3 py-10 text-center">
            {apply.isPending && (
              <>
                <Loader2 className="h-6 w-6 animate-spin text-accent" />
                <p className="text-sm text-fg/60">Applying addressing…</p>
              </>
            )}
            {apply.isSuccess && (
              <>
                <span className="grid h-12 w-12 place-items-center rounded-full bg-success/15 text-success">
                  <Check className="h-6 w-6" />
                </span>
                <p className="text-sm text-fg/80">
                  Addressing applied to <strong className="text-fg">{apply.data.nodes_updated ?? 0}</strong> devices.
                </p>
                <p className="text-xs text-fg/45">The topology now shows the new IPs.</p>
              </>
            )}
            {apply.isError && (
              <>
                <p className="text-sm text-danger">Apply failed. No changes were made.</p>
                <button onClick={() => apply.mutate()} className="rounded-md border border-fg/15 px-3 py-1.5 text-xs text-fg/80 hover:bg-fg/10">
                  Retry
                </button>
              </>
            )}
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between border-t border-fg/10 bg-fg/[0.03] px-6 py-4">
        {step === 'scope' && (
          <>
            <button onClick={onClose} className="rounded-lg border border-fg/10 px-4 py-2 text-sm font-medium text-fg/80 hover:bg-fg/5">
              Cancel
            </button>
            <button
              onClick={() => setStep('preview')}
              autoFocus
              className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-accent-fg shadow-sm hover:bg-accent-soft"
            >
              Preview
            </button>
          </>
        )}
        {step === 'preview' && (
          <>
            <button
              onClick={() => setStep('scope')}
              className="flex items-center gap-1.5 rounded-lg border border-fg/10 px-4 py-2 text-sm font-medium text-fg/80 hover:bg-fg/5"
            >
              <ArrowLeft className="h-4 w-4" /> Back
            </button>
            <button
              onClick={() => {
                setStep('apply');
                apply.mutate();
              }}
              disabled={!view || view.segments.length === 0}
              className="flex items-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-accent-fg shadow-sm hover:bg-accent-soft disabled:opacity-40"
            >
              <Play className="h-4 w-4" /> Apply addressing
            </button>
          </>
        )}
        {step === 'apply' && (
          <button
            onClick={onClose}
            disabled={apply.isPending}
            className="ml-auto rounded-lg bg-accent px-4 py-2 text-sm font-medium text-accent-fg shadow-sm hover:bg-accent-soft disabled:opacity-40"
          >
            Close
          </button>
        )}
      </div>
    </ModalScrim>
  );
}

function Section({ title, dot, children }: { title: string; dot: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-2.5">
      <h3 className="flex items-center gap-2 text-sm font-medium text-fg/90">
        <span className={cn('h-2 w-2 rounded-full', dot)} /> {title}
      </h3>
      <div className="overflow-hidden rounded-lg border border-fg/10 bg-fg/[0.02]">{children}</div>
    </div>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return <th className="border-b border-fg/10 px-3 py-2 font-medium">{children}</th>;
}

function Td({ children, className }: { children: React.ReactNode; className?: string }) {
  return <td className={cn('border-b border-fg/5 px-3 py-2', className)}>{children}</td>;
}
