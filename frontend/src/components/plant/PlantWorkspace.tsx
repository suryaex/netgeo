/**
 * PlantWorkspace — the Physical Plant full-bleed view (design 12-UI §2.2,
 * design §11). Re-homes the QA'd RackElevationPanel from a floating window into a
 * first-class workspace: rack elevation, site/rack creation, device placement,
 * and the over-length cable warnings, filling the whole workspace. Its own
 * no-racks empty state lives inside RackElevationPanel.
 */
import { RackElevationPanel } from '@/components/RackElevationPanel';

export function PlantWorkspace() {
  return (
    <div className="absolute inset-0">
      <RackElevationPanel />
    </div>
  );
}
