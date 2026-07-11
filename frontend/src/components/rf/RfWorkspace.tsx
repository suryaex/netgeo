/**
 * RfWorkspace — the RF Planning full-bleed view (NG-RF-03, PtP slice).
 *
 * Reuses MapView (in `rfMode`) as the map surface — device placement, tiles, and
 * coverage all keep working — and layers the RF chrome over it: the Link Analysis
 * dock (right) and the endpoint/parameter bar (bottom). Endpoints are picked
 * either from the bottom-bar selectors or by clicking two placed AP/Tower sites
 * on the map (their existing selection drives `pickEndpoint`).
 */
import { useEffect } from 'react';
import { MapView } from '@/components/map/MapView';
import { useMapStore } from '@/store/mapStore';
import { useRfStore } from '@/store/rfStore';
import { RfAnalysisPanel } from './RfAnalysisPanel';
import { RfLinkBar } from './RfLinkBar';

export function RfWorkspace() {
  const loadModels = useRfStore((s) => s.loadModels);
  const pickEndpoint = useRfStore((s) => s.pickEndpoint);
  const selectedId = useMapStore((s) => s.selectedDeviceId);

  // Load the propagation-model registry once; keep the map in select mode so a
  // click picks an endpoint instead of placing a device.
  useEffect(() => {
    void loadModels();
    useMapStore.getState().setTool('select');
  }, [loadModels]);

  // A map click that selects an AP/Tower assigns it to the next endpoint slot.
  useEffect(() => {
    if (selectedId) pickEndpoint(selectedId);
  }, [selectedId, pickEndpoint]);

  return (
    <>
      <MapView rfMode />
      <RfAnalysisPanel />
      <RfLinkBar />
    </>
  );
}
