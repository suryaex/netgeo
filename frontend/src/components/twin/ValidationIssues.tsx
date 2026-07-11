/**
 * ValidationIssues — bottom-right list of derived twin lint (NG-TW). Purely
 * client-side (deriveValidationIssues); graceful empty state when the twin is
 * clean. Sits above the reachability bar's right edge.
 */
import { useState } from 'react';
import { AlertTriangle, CheckCircle2, ChevronDown, ChevronUp } from 'lucide-react';
import type { ValidationIssue } from './twinLogic';
import { cn } from '@/lib/cn';
import { zc } from '@/theme/z';

export function ValidationIssues({ issues }: { issues: ValidationIssue[] }) {
  const [open, setOpen] = useState(true);
  const clean = issues.length === 0;

  return (
    <div className={cn('pointer-events-none absolute bottom-4 right-[376px] w-[300px] max-w-[85vw]', zc.workspace)}>
      <div className="glass pointer-events-auto rounded-lg border border-fg/10 shadow-glass">
        <button
          onClick={() => setOpen((o) => !o)}
          className="flex w-full items-center justify-between gap-2 px-3 py-2"
          aria-expanded={open}
        >
          <span className="flex items-center gap-1.5 text-xs font-semibold text-fg/80">
            {clean ? (
              <CheckCircle2 className="h-4 w-4 text-success" />
            ) : (
              <AlertTriangle className="h-4 w-4 text-warning" />
            )}
            Validation issues
            {!clean && (
              <span className="rounded-full bg-warning/20 px-1.5 py-0.5 text-[10px] text-warning">
                {issues.length}
              </span>
            )}
          </span>
          {open ? <ChevronDown className="h-4 w-4 text-fg/40" /> : <ChevronUp className="h-4 w-4 text-fg/40" />}
        </button>

        {open && (
          <div className="max-h-[240px] overflow-y-auto border-t border-fg/10 p-2">
            {clean ? (
              <p className="px-1 py-2 text-center text-[11px] text-fg/45">No issues detected.</p>
            ) : (
              <ul className="flex flex-col gap-1">
                {issues.map((issue) => (
                  <li
                    key={issue.id}
                    className="flex items-start gap-2 rounded-md bg-fg/5 px-2 py-1.5 text-[11px] text-fg/75"
                  >
                    <AlertTriangle
                      className={cn(
                        'mt-0.5 h-3.5 w-3.5 shrink-0',
                        issue.severity === 'error' ? 'text-danger' : 'text-warning',
                      )}
                    />
                    <span>{issue.message}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
