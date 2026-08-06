import { create } from 'zustand';

interface CommandPaletteState {
  open: boolean;
  query: string;
  activeIndex: number;
  toggle: () => void;
  openPalette: () => void;
  closePalette: () => void;
  setQuery: (query: string) => void;
  setActiveIndex: (index: number) => void;
}

export const useCommandPaletteStore = create<CommandPaletteState>((set) => ({
  open: false,
  query: '',
  activeIndex: 0,
  toggle: () => set((s) => ({ open: !s.open, query: '', activeIndex: 0 })),
  openPalette: () => set({ open: true, query: '', activeIndex: 0 }),
  closePalette: () => set({ open: false }),
  setQuery: (query) => set({ query, activeIndex: 0 }),
  setActiveIndex: (activeIndex) => set({ activeIndex }),
}));
