/**
 * AddressingWizard — the Auto-addressing wizard modal (v1.2.033, clay design).
 * Replaces the TopBar's one-shot auto-address button with a Scope → Preview →
 * Apply flow so the operator can see the dual-stack plan before committing.
 *
 * Backend: reuses POST /lab/{id}/auto-address with the new `dry_run` param.
 *  - Preview calls it with dryRun:true — the server computes + summarizes the
 *    plan and persists NOTHING (zero node writes, no lab invalidation).
 *  - Apply calls it with dryRun:false — the real assignment, then the topology
 *    cache is invalidated so the canvas reflects the new addressing.
 *
 * The preview tables come straight from the server `summary` (the component that
 * computes the plan owns the numbers) — the client never re-derives addressing.
 */
import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Cable, Network, GitCompareArrows, Play, Check, Loader2, AlertTriangle } from 'lucide-react';
import { labApi, type AutoAddressResult } from '@/api/client';
import { useUiStore } from '@/store/uiStore';
import { ModalScrim } from '@/components/shell/ModalScrim';
import { cn } from '@/lib/cn';

type Step = 'scope' | 'preview' | 'apply';
const STEPS: { id: Step; label: string }[] = [
  { id: 'scope', label: 'Scope' },
  { id: 'preview', label: 'Preview' },
  { id: 'apply', label: 'Apply' },
];

export function AddressingWizard() {
  const projectId = useUiStore((s) => s.projectId);
  const closeModal = useUiStore((s) => s.closeModal);
  const qc = useQueryClient();
  const [step, setStep] = useState<Step>('scope');
  const [applied, setApplied] = useState<AutoAddressResult | null>(null);

  const preview = useMutation({
    mutationFn: () => labApi.autoAddress(projectId!, { dryRun: true }),
  });
  const apply = useMutation({
    mutationFn: () => labApi.autoAddress(projectId!, { dryRun: false }),
    onSuccess: (res) => {
      setApplied(res);
      void qc.invalidateQueries({ queryKey: ['topology', projectId] });
      setStep('apply');
    },
  });

  const summary = preview.data?.summary;

  const goPreview = () => {
    setStep('preview');
    if (!preview.data && !preview.isPending) preview.mutate();
  };

  return (
    <ModalScrim label="Auto-addressing wizard" onClose={closeModal} className="max-w-[720px]">
      {/* Header + stepper */}
      <div className="flex flex-col gap-4 border-b border-fg/10 px-6 py-5">
        <h2 className="pr-8 font-display text-xl font-semibold text-fg">Auto-addressing wizard</h2>
        <ol className="flex items-center font-mono text-[12px]" aria-label="Steps">
          {STEPS.map((s, i) => {
            const active = s.id === step;
            const done = STEPS.findIndex((x) => x.id === step) > i;
            return (
              <li key={s.id} className="flex flex-1 items-center last:flex-none">
                <span className="flex items-center gap-2">
                  <span
                    className={cn(
                      'grid h-5 w-5 place-items-center rounded-full border text-[10px]',
                      active
                        ? 'border-accent bg-accent text-accent-fg'
                        : done
                          ? 'border-success bg-success/15 text-success'
                          : 'border-fg/25 text-fg/45',
                    )}
                  >
                    {done ? <Check className="h-3 w-3" aria-hidden /> : i + 1}
                  </span>
                  <span className={cn(active ? 'text-accent' : done ? 'text-fg/70' : 'text-fg/45')}>{s.label}</span>
                </span>
                {i < STEPS.length - 1 && <span className="mx-4 h-px flex-1 bg-fg/10" aria-hidden />}
              </li>
            );
          })}
        </ol>
      </div>

      {/* Body */}
      <div className="ng-scroll flex max-h-[60vh] min-h-[220px] flex-col gap-6 overflow-y-auto px-6 py-6">
        {step === 'scope' && (
          <div className="space-y-4">
            <p className="text-[13px] leading-relaxed text-fg/70">
              This assigns a deterministic dual-stack plan to the whole topology: a /30 + ULA /64 for each
              router-to-router link, a /24 + ULA /64 per switch broadcast domain, and default gateways pointed at the
              first router in each domain. Nothing is written until you Apply.
            </p>
            <div className="rounded-lg border border-warning/30 bg-warning/10 p-3">
              <div className="flex gap-2 text-[13px] text-fg/80">
                <AlertTriangle className="h-4 w-4 shrink-0 text-warning" aria-hidden />
                <span>Applying overwrites existing interface addressing across every device in this project.</span>
              </div>
            </div>
          </div>
        )}

        {step === 'preview' &&
          (preview.isPending ? (
            <div className="grid flex-1 place-items-center py-8 text-fg/40">
              <Loader2 className="h-6 w-6 animate-spin text-accent" aria-hidden />
            </div>
          ) : preview.error ? (
            <div className="grid flex-1 place-items-center py-8 text-center text-sm text-danger">
              {(preview.error as Error)?.message ?? 'Failed to compute the plan.'}
            </div>
          ) : summary && (summary.ipv4.length > 0 || summary.ipv6.length > 0) ? (
            <>
              <div className="flex flex-wrap gap-3">
                <Chip icon={Cable} label={`${summary.interfaces} interfaces`} />
                <Chip icon={Network} label={`${summary.lan_domains} LAN domains`} />
                <Chip icon={GitCompareArrows} label={`${summary.p2p_links} p2p links`} />
              </div>
              {summary.ipv4.length > 0 && (
                <Section dotClass="bg-accent" title="IPv4 domains">
                  <table className="w-full border-collapse text-left font-mono text-[12px]">
                    <thead>
                      <tr className="text-fg/50">
                        <Th>Segment</Th>
                        <Th>Subnet</Th>
                        <Th>Gateway</Th>
                        <Th>Hosts</Th>
                      </tr>
                    </thead>
                    <tbody className="text-fg/85">
                      {summary.ipv4.map((r) => (
                        <tr key={r.subnet} className="border-t border-fg/10">
                          <Td>{r.segment}</Td>
                          <Td>{r.subnet}</Td>
                          <Td>{r.gateway}</Td>
                          <Td className="text-fg/55 tabular-nums">{r.hosts}</Td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </Section>
              )}
              {summary.ipv6.length > 0 && (
                <Section dotClass="bg-success" title="IPv6 (ULA)">
                  <table className="w-full border-collapse text-left font-mono text-[12px]">
                    <thead>
                      <tr className="text-fg/50">
                        <Th>Segment</Th>
                        <Th>Prefix</Th>
                        <Th>Gateway</Th>
                      </tr>
                    </thead>
                    <tbody className="text-fg/85">
                      {summary.ipv6.map((r) => (
                        <tr key={r.prefix} className="border-t border-fg/10">
                          <Td>{r.segment}</Td>
                          <Td>{r.prefix}</Td>
                          <Td>{r.gateway}</Td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </Section>
              )}
            </>
          ) : (
            <div className="grid flex-1 place-items-center py-8 text-center text-fg/50">
              <p className="max-w-sm text-[13px] leading-relaxed">
                No addressable segments — add routers, switches and links to this topology, then re-run the wizard.
              </p>
            </div>
          ))}

        {step === 'apply' && (
          <div className="grid flex-1 place-items-center py-8 text-center">
            <div className="space-y-2">
              <Check className="mx-auto h-9 w-9 text-success" aria-hidden />
              <p className="text-sm text-fg/80">
                Addressing applied to {applied?.nodes_updated ?? 0} device{applied?.nodes_updated === 1 ? '' : 's'}.
              </p>
              <p className="text-xs text-fg/45">The topology now reflects the new dual-stack plan.</p>
            </div>
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between border-t border-fg/10 px-6 py-4">
        <button
          onClick={() => (step === 'preview' ? setStep('scope') : closeModal())}
          className="rounded-lg border border-fg/10 px-4 py-2 text-[13px] font-medium text-fg/85 transition-colors hover:bg-fg/5"
        >
          {step === 'scope' || step === 'apply' ? 'Close' : 'Back'}
        </button>
        {step === 'scope' && (
          <button
            onClick={goPreview}
            disabled={!projectId}
            className="rounded-lg bg-accent px-4 py-2 text-[13px] font-medium text-accent-fg transition-colors hover:bg-accent-soft disabled:opacity-40"
          >
            Preview plan
          </button>
        )}
        {step === 'preview' && (
          <button
            onClick={() => apply.mutate()}
            disabled={apply.isPending || preview.isPending || !summary || summary.ipv4.length + summary.ipv6.length === 0}
            className="flex items-center gap-2 rounded-lg bg-accent px-4 py-2 text-[13px] font-medium text-accent-fg transition-colors hover:bg-accent-soft disabled:opacity-40"
          >
            {apply.isPending ? (
              <Loader2 className="h-[18px] w-[18px] animate-spin" aria-hidden />
            ) : (
              <Play className="h-[18px] w-[18px]" aria-hidden />
            )}
            Apply addressing
          </button>
        )}
        {step === 'apply' && (
          <button
            onClick={closeModal}
            className="rounded-lg bg-accent px-4 py-2 text-[13px] font-medium text-accent-fg transition-colors hover:bg-accent-soft"
          >
            Done
          </button>
        )}
      </div>
    </ModalScrim>
  );
}

function Chip({ icon: Icon, label }: { icon: typeof Cable; label: string }) {
  return (
    <span className="flex items-center gap-2 rounded-md border border-fg/10 bg-recess/30 px-3 py-1.5 font-mono text-[12px] text-fg/80">
      <Icon className="h-4 w-4 text-fg/50" aria-hidden />
      {label}
    </span>
  );
}

function Section({ title, dotClass, children }: { title: string; dotClass: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-3">
      <h3 className="flex items-center gap-2 text-[15px] font-medium text-fg">
        <span className={cn('h-2 w-2 rounded-full', dotClass)} aria-hidden />
        {title}
      </h3>
      <div className="overflow-hidden rounded-lg border border-fg/10 bg-recess/30">{children}</div>
    </div>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return <th className="px-3 py-2 font-normal">{children}</th>;
}
function Td({ children, className }: { children: React.ReactNode; className?: string }) {
  return <td className={cn('px-3 py-2', className)}>{children}</td>;
}
