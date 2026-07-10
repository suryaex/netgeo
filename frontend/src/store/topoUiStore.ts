/**
 * Topology-workspace UI state (Phase 1 UX foundation).
 * Holds the transient chrome state that the full-canvas topology needs but
 * that isn't graph data: the active tool, the floating device picker, the
 * context-inspector pin, and a handle to the canvas "fit view" action so the
 * global `F` shortcut can drive React Flow without prop-drilling the instance.
 */
import { create } from 'zustand';

export type TopoTool = 'select' | 'link' | 'group';

export interface FlowPos {
  x: number;
  y: number;
}

interface TopoUiState {
  tool: TopoTool;
  pickerOpen: boolean;
  /** Flow-coords where a picked device should land (double-click), else null. */
  pickerPos: FlowPos | null;
  inspectorPinned: boolean;
  /** Registered by TopologyCanvas.onInit; drives the `F` fit shortcut. */
  fit: (() => void) | null;

  setTool: (t: TopoTool) => void;
  openPicker: (pos?: FlowPos) => void;
  closePicker: () => void;
  togglePin: () => void;
  setFit: (fn: (() => void) | null) => void;
}

export const useTopoUiStore = create<TopoUiState>((set) => ({
  tool: 'select',
  pickerOpen: false,
  pickerPos: null,
  inspectorPinned: false,
  fit: null,

  setTool: (tool) => set({ tool }),
  openPicker: (pos) => set({ pickerOpen: true, pickerPos: pos ?? null }),
  closePicker: () => set({ pickerOpen: false, pickerPos: null }),
  togglePin: () => set((s) => ({ inspectorPinned: !s.inspectorPinned })),
  setFit: (fit) => set({ fit }),
}));
