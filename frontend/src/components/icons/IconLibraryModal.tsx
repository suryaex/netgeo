/**
 * IconLibraryModal — import custom device icons (SVG/PNG/JPEG) stored in
 * localStorage via iconStore. If a node is selected, allows assigning an icon
 * or clearing the existing one. Icons are rendered as <img> data URLs — no
 * raw SVG injection, no script execution risk.
 */
import { useRef, useState } from 'react';
import { Trash2, ImagePlus, CheckCircle2 } from 'lucide-react';
import { ModalScrim } from '@/components/shell/ModalScrim';
import { useIconStore } from '@/store/iconStore';
import { useTopologyStore } from '@/store/topologyStore';
import { useUiStore } from '@/store/uiStore';
import { nodesApi } from '@/api/client';
import { cn } from '@/lib/cn';

const MAX_BYTES = 256 * 1024; // 256 KB

export function IconLibraryModal() {
  const closeModal = useUiStore((s) => s.closeModal);
  const { icons, addIcon, removeIcon } = useIconStore();
  const node = useTopologyStore((s) => s.selectedNode());
  const upsertNode = useTopologyStore((s) => s.upsertNode);

  const fileRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);

  const assignedIconId =
    node?.intent && typeof node.intent.icon === 'string' ? node.intent.icon : undefined;

  function setNodeIcon(iconId?: string) {
    if (!node) return;
    const intent = { ...(node.intent ?? {}) };
    if (iconId) intent.icon = iconId;
    else delete intent.icon;
    const updated = { ...node, intent };
    upsertNode(updated);
    void nodesApi.update(node.id, { intent }).catch(() => {});
  }

  function onFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    setError(null);
    Array.from(files).forEach((file) => {
      if (file.size > MAX_BYTES) {
        setError(`"${file.name}" exceeds 256 KB limit — skipped.`);
        return;
      }
      const reader = new FileReader();
      reader.onload = () => {
        if (typeof reader.result === 'string') {
          addIcon({ name: file.name, dataUrl: reader.result });
        }
      };
      reader.readAsDataURL(file);
    });
    // Reset input so re-uploading the same file triggers onChange again.
    if (fileRef.current) fileRef.current.value = '';
  }

  return (
    <ModalScrim label="Icon Library" onClose={closeModal} className="max-w-lg">
      {/* Header */}
      <div className="flex items-center gap-2 border-b border-fg/10 px-4 py-3">
        <ImagePlus className="h-4 w-4 text-fg/50" />
        <h2 className="text-sm font-semibold text-fg/85">Icon Library</h2>
        <span className="ml-auto rounded-full bg-fg/8 px-2 py-0.5 text-[10px] text-fg/50">
          {icons.length}
        </span>
      </div>

      <div className="ng-scroll flex-1 overflow-auto p-4 space-y-4">
        {/* Upload zone */}
        <div>
          <label
            className={cn(
              'flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-fg/20 bg-fg/3 px-4 py-5',
              'transition-colors hover:border-accent/50 hover:bg-accent/5',
            )}
          >
            <ImagePlus className="h-5 w-5 text-fg/35" />
            <span className="text-xs text-fg/50">
              Click to import SVG, PNG, or JPEG &mdash; max 256 KB each
            </span>
            <input
              ref={fileRef}
              type="file"
              accept="image/svg+xml,image/png,image/jpeg"
              multiple
              className="sr-only"
              onChange={(e) => onFiles(e.target.files)}
            />
          </label>
          {error && (
            <p className="mt-2 text-[11px] text-danger">{error}</p>
          )}
        </div>

        {/* Icon grid */}
        {icons.length === 0 ? (
          <p className="rounded-md border border-dashed border-fg/10 p-4 text-center text-xs text-fg/35">
            No custom icons yet. Import an SVG or PNG above.
          </p>
        ) : (
          <div className="grid grid-cols-4 gap-2">
            {icons.map((icon) => {
              const isAssigned = assignedIconId === icon.id;
              return (
                <div
                  key={icon.id}
                  className={cn(
                    'group relative flex flex-col items-center gap-1.5 rounded-lg border p-2 transition-colors',
                    isAssigned
                      ? 'border-accent/60 bg-accent/8'
                      : 'border-fg/10 hover:border-fg/25 hover:bg-fg/4',
                  )}
                >
                  {/* Thumbnail */}
                  <button
                    onClick={() => node && setNodeIcon(isAssigned ? undefined : icon.id)}
                    title={node ? (isAssigned ? 'Clear icon' : 'Assign to selected node') : icon.name}
                    disabled={!node}
                    className="h-10 w-10 shrink-0 disabled:cursor-default"
                    aria-label={`${isAssigned ? 'Clear' : 'Assign'} icon ${icon.name}`}
                  >
                    <img
                      src={icon.dataUrl}
                      alt=""
                      className="h-full w-full object-contain"
                    />
                  </button>

                  {/* Name */}
                  <span
                    className="w-full truncate text-center text-[9px] text-fg/50"
                    title={icon.name}
                  >
                    {icon.name.replace(/\.[^.]+$/, '')}
                  </span>

                  {/* Assigned badge */}
                  {isAssigned && (
                    <CheckCircle2 className="absolute right-1 top-1 h-3 w-3 text-accent" aria-hidden />
                  )}

                  {/* Delete button */}
                  <button
                    onClick={() => {
                      if (isAssigned) setNodeIcon(undefined);
                      removeIcon(icon.id);
                    }}
                    aria-label={`Remove icon ${icon.name}`}
                    className="absolute left-1 top-1 grid h-5 w-5 place-items-center rounded text-fg/0 transition-colors group-hover:text-fg/40 hover:!text-danger"
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                </div>
              );
            })}
          </div>
        )}

        {/* Node assignment section */}
        {node && (
          <div className="rounded-lg border border-fg/10 bg-fg/4 px-3 py-2.5 space-y-2">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-fg/45">
              Selected node
            </p>
            <div className="flex items-center justify-between gap-2">
              <span className="truncate text-sm text-fg/85">{node.name}</span>
              {assignedIconId && (
                <button
                  onClick={() => setNodeIcon(undefined)}
                  className="shrink-0 rounded-md border border-fg/10 px-2 py-1 text-[11px] text-fg/50 transition-colors hover:border-danger/40 hover:text-danger"
                >
                  Clear icon
                </button>
              )}
            </div>
            {!assignedIconId && icons.length > 0 && (
              <p className="text-[11px] text-fg/40">
                Click an icon above to assign it to this node.
              </p>
            )}
          </div>
        )}
      </div>
    </ModalScrim>
  );
}
