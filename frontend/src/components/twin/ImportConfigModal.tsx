/**
 * ImportConfigModal — paste or drop a device config to bring it into the twin
 * (NG-TW-01). Each import is one POST /projects/{id}/import-config, which
 * creates a real node; the modal stays open so several devices can be imported
 * in a row, then Inferring links wires them up.
 */
import { useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { X, FileUp, Loader2, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { twinApi, type ApiError, type ConfigVendor } from '@/api/client';
import { useUiStore } from '@/store/uiStore';
import { cn } from '@/lib/cn';

const VENDORS: { id: ConfigVendor; label: string; hint: string }[] = [
  { id: 'ios', label: 'Cisco IOS', hint: 'IOS / IOS-XR / NX-OS style' },
  { id: 'routeros', label: 'MikroTik', hint: 'RouterOS export' },
];

export function ImportConfigModal({ onClose }: { onClose: () => void }) {
  const projectId = useUiStore((s) => s.projectId);
  const queryClient = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [vendor, setVendor] = useState<ConfigVendor>('ios');
  const [text, setText] = useState('');
  const [imported, setImported] = useState<string[]>([]);

  const m = useMutation({
    mutationFn: () => twinApi.importConfig(projectId!, vendor, text),
    onSuccess: (node) => {
      setImported((xs) => [...xs, node.name]);
      setText('');
      void queryClient.invalidateQueries({ queryKey: ['topology', projectId] });
    },
  });

  const err = m.error as ApiError | null;

  const pickFile = async (file: File) => {
    setText(await file.text());
    if (/\.rsc$/i.test(file.name)) setVendor('routeros');
  };

  return (
    <div
      className="fixed inset-0 z-[600] grid place-items-center bg-recess/50 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label="Import device config"
      onClick={onClose}
    >
      <div
        className="glass-strong flex max-h-[85vh] w-[560px] max-w-full flex-col rounded-lg border border-fg/10 shadow-glass-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-fg/10 px-4 py-3">
          <div>
            <h2 className="text-sm font-semibold text-fg/90">Import Device Config</h2>
            <p className="text-[11px] text-fg/50">Paste running-config or drop a file to add it to the twin</p>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="grid h-7 w-7 place-items-center rounded text-fg/50 transition-colors hover:bg-fg/10 hover:text-fg/80"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-4">
          {/* Vendor select */}
          <div className="flex items-center gap-2" role="group" aria-label="Vendor">
            {VENDORS.map((v) => (
              <button
                key={v.id}
                onClick={() => setVendor(v.id)}
                aria-pressed={vendor === v.id}
                title={v.hint}
                className={cn(
                  'flex-1 rounded-md border px-3 py-2 text-left text-xs transition-colors',
                  vendor === v.id
                    ? 'border-accent bg-accent/15 text-fg/90'
                    : 'border-fg/10 bg-fg/5 text-fg/60 hover:border-fg/25',
                )}
              >
                <div className="font-semibold">{v.label}</div>
                <div className="text-[10px] text-fg/45">{v.hint}</div>
              </button>
            ))}
          </div>

          {/* Config text */}
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            spellCheck={false}
            placeholder={'hostname R1\ninterface Gig0/0\n ip address 10.0.0.1 255.255.255.252\n...'}
            className="h-56 w-full resize-none rounded-md border border-fg/10 bg-recess/20 p-3 font-mono text-[12px] leading-relaxed text-fg/85 outline-none placeholder:text-fg/30 focus:border-accent/60"
          />

          {err && (
            <div className="flex items-start gap-2 rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-xs text-danger">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{err.message || 'Import failed — check the vendor and config text.'}</span>
            </div>
          )}
          {imported.length > 0 && (
            <div className="flex items-center gap-2 rounded-md border border-success/30 bg-success/10 px-3 py-2 text-xs text-success">
              <CheckCircle2 className="h-4 w-4 shrink-0" />
              <span>
                Imported {imported.length}: <span className="font-mono">{imported.join(', ')}</span>
              </span>
            </div>
          )}
        </div>

        <div className="flex items-center justify-between gap-2 border-t border-fg/10 px-4 py-3">
          <button
            onClick={() => fileRef.current?.click()}
            className="flex items-center gap-1.5 rounded-md border border-fg/10 bg-fg/5 px-3 py-2 text-xs text-fg/70 transition-colors hover:border-fg/25 hover:text-fg/90"
          >
            <FileUp className="h-4 w-4" /> Load file
          </button>
          <input
            ref={fileRef}
            type="file"
            accept=".txt,.cfg,.conf,.rsc,text/plain"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void pickFile(f);
              e.target.value = '';
            }}
          />
          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              className="rounded-md px-3 py-2 text-xs text-fg/60 transition-colors hover:bg-fg/10 hover:text-fg/85"
            >
              Done
            </button>
            <button
              onClick={() => m.mutate()}
              disabled={!text.trim() || !projectId || m.isPending}
              className="flex items-center gap-1.5 rounded-md bg-accent px-3 py-2 text-xs font-semibold text-fg transition-colors hover:bg-accent-soft disabled:opacity-40"
            >
              {m.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
              Import
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
