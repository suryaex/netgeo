/**
 * Icon store — user-imported custom device icons.
 * Persisted to localStorage (same pattern as nosStore) so they survive reloads.
 * Icons are stored as data URLs (SVG/PNG/JPEG base64) and assigned to nodes via
 * node.intent.icon. No backend schema change required.
 */
import { create } from 'zustand';

const STORAGE_KEY = 'netgeo.customIcons';

export interface CustomIcon {
  id: string;
  name: string;
  dataUrl: string;
  createdAt: string;
}

interface IconState {
  icons: CustomIcon[];
  addIcon: (input: { name: string; dataUrl: string }) => string;
  removeIcon: (id: string) => void;
}

function load(): CustomIcon[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as CustomIcon[]) : [];
  } catch {
    return [];
  }
}

function save(icons: CustomIcon[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(icons));
}

export const useIconStore = create<IconState>((set) => ({
  icons: load(),

  addIcon: ({ name, dataUrl }) => {
    let newId = '';
    set((s) => {
      // ponytail: dup check by dataUrl — same image uploaded twice = no-op
      if (s.icons.some((i) => i.dataUrl === dataUrl)) {
        newId = s.icons.find((i) => i.dataUrl === dataUrl)!.id;
        return {};
      }
      newId = `icon-${Date.now()}`;
      const next: CustomIcon = { id: newId, name, dataUrl, createdAt: new Date().toISOString() };
      const updated = [...s.icons, next];
      save(updated);
      return { icons: updated };
    });
    return newId;
  },

  removeIcon: (id) =>
    set((s) => {
      const updated = s.icons.filter((i) => i.id !== id);
      save(updated);
      return { icons: updated };
    }),
}));
