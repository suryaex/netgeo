/**
 * DeviceIcon — renders either a user-imported custom icon (img data URL)
 * or the default lucide KIND_ICON for the node's kind.
 * This is the single source of truth for the kind→icon map (moved here from
 * DeviceNode so both the canvas tile and the PropertiesPanel can import it).
 */
import {
  Router,
  Network,
  Monitor,
  Wifi,
  Cable,
  ShieldAlert,
  Server,
  Cloud,
} from 'lucide-react';
import type { NodeKind } from '@/api/types';
import { useIconStore } from '@/store/iconStore';
import { cn } from '@/lib/cn';

export const KIND_ICON: Record<NodeKind, typeof Router> = {
  router: Router,
  switch: Network,
  host: Monitor,
  ap: Wifi,
  cpe: Wifi,
  olt: Cable,
  firewall: ShieldAlert,
  server: Server,
  cloud: Cloud,
};

export function DeviceIcon({
  kind,
  iconId,
  className,
}: {
  kind: NodeKind;
  iconId?: string;
  className?: string;
}) {
  const icon = useIconStore((s) => (iconId ? s.icons.find((i) => i.id === iconId) : undefined));

  if (icon) {
    return (
      <img
        src={icon.dataUrl}
        alt=""
        className={cn('object-contain', className)}
      />
    );
  }

  const Icon = KIND_ICON[kind];
  return <Icon className={className} />;
}
