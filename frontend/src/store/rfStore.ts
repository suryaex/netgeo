/**
 * RF store — state for the RF Planning (PtP) workspace. The two endpoints are
 * references into the map store's placed devices (AP/Tower); link parameters and
 * the last `/api/rf/ptp` result live here. All physics is server-side — this
 * store only orchestrates the request and holds the response.
 *
 * ponytail: PtP only (this slice). PtMP sector planning and product-select share
 * the same backend endpoints but are deferred; add sibling actions here when
 * their UI lands.
 */
import { create } from 'zustand';
import { rfApi, type PropagationModelInfo, type PtpResult } from '@/api/client';
import { useMapStore } from '@/store/mapStore';

/** Fixed dish gain applied to both ends of the link budget (dBi). The map
 *  device model carries no antenna-gain field, so PtP uses one sensible default
 *  (a typical 5 GHz dish) for TX and RX. Surfaced in the panel as "2× N dBi". */
export const RF_ANT_GAIN_DBI = 23;

/** RX sensitivity floor used for fade margin (matches PtpRequest default). */
const RF_RX_SENSITIVITY_DBM = -85;

export type RfTab = 'summary' | 'budget' | 'terrain' | 'fresnel';

interface RfState {
  aId: string | null;
  bId: string | null;
  freqGhz: number;
  bwMhz: number;
  modelId: string;
  models: PropagationModelInfo[];
  result: PtpResult | null;
  loading: boolean;
  error: string | null;
  tab: RfTab;

  /** Assign a device (from a map click) to the next free endpoint slot. */
  pickEndpoint: (id: string) => void;
  setA: (id: string | null) => void;
  setB: (id: string | null) => void;
  swap: () => void;
  clear: () => void;
  setFreq: (ghz: number) => void;
  setBw: (mhz: number) => void;
  setModel: (id: string) => void;
  setTab: (tab: RfTab) => void;
  loadModels: () => Promise<void>;
  calculate: () => Promise<void>;
}

const RF_KINDS = new Set(['ap', 'tower']);

export const useRfStore = create<RfState>((set, get) => ({
  aId: null,
  bId: null,
  freqGhz: 5.8,
  bwMhz: 40,
  modelId: 'fspl',
  models: [],
  result: null,
  loading: false,
  error: null,
  tab: 'summary',

  pickEndpoint: (id) => {
    const dev = useMapStore.getState().devices.get(id);
    if (!dev || !RF_KINDS.has(dev.kind)) return; // only AP/Tower are RF endpoints
    const { aId, bId } = get();
    if (!aId) set({ aId: id, result: null, error: null });
    else if (aId === id) return;
    else if (!bId) set({ bId: id, result: null, error: null });
    else set({ aId: id, bId: null, result: null, error: null }); // full → restart
  },

  setA: (aId) => set({ aId, result: null, error: null }),
  setB: (bId) => set({ bId, result: null, error: null }),
  swap: () => set((s) => ({ aId: s.bId, bId: s.aId, result: null, error: null })),
  clear: () => set({ aId: null, bId: null, result: null, error: null }),
  setFreq: (freqGhz) => set({ freqGhz, result: null }),
  setBw: (bwMhz) => set({ bwMhz }), // capacity-only — recomputed live, no refetch
  setModel: (modelId) => set({ modelId, result: null }),
  setTab: (tab) => set({ tab }),

  loadModels: async () => {
    if (get().models.length) return;
    try {
      const models = await rfApi.models();
      set({ models });
      if (models[0] && !models.some((m) => m.id === get().modelId)) {
        set({ modelId: models[0].id });
      }
    } catch {
      /* keep the 'fspl' default if the registry can't be reached */
    }
  },

  calculate: async () => {
    const { aId, bId, freqGhz, modelId } = get();
    const devices = useMapStore.getState().devices;
    const a = aId ? devices.get(aId) : null;
    const b = bId ? devices.get(bId) : null;
    if (!a || !b) return;
    set({ loading: true, error: null });
    try {
      const result = await rfApi.ptp({
        a_lat: a.lat, a_lon: a.lng,
        b_lat: b.lat, b_lon: b.lng,
        freq_mhz: freqGhz * 1000,
        tx_power_dbm: a.txPower,
        tx_gain_dbi: RF_ANT_GAIN_DBI,
        rx_gain_dbi: RF_ANT_GAIN_DBI,
        rx_sensitivity_dbm: RF_RX_SENSITIVITY_DBM,
        tx_height_m: Math.max(a.antennaHeight, 0.1), // schema requires > 0
        rx_height_m: Math.max(b.antennaHeight, 0.1),
        model_id: modelId,
      });
      set({ result, loading: false });
    } catch (err) {
      const status = (err as { status?: number })?.status;
      const msg =
        status === 503
          ? 'Elevation provider unavailable — try again shortly.'
          : (err as { message?: string })?.message ?? 'Link calculation failed.';
      set({ loading: false, error: msg, result: null });
    }
  },
}));
