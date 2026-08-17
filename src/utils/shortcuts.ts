import { useCommandPaletteStore } from '@/stores/commandPaletteStore';
import { useUIStore, type ShortcutKey } from '@/stores/uiStore';
import { globalUndo, globalRedo } from '@/utils/globalHistory';

export interface ShortcutActionDef {
  id: string;
  descKey: string;
  defaultKey: ShortcutKey;
  /** Trigger even while an input/textarea is focused. */
  allowTyping?: boolean;
  run: () => void;
}

/**
 * Central registry of global shortcuts. Each action has one rebindable default
 * key; users can override it (or disable with null) via uiStore.shortcutOverrides.
 */
export const SHORTCUT_ACTIONS: ShortcutActionDef[] = [
  {
    id: 'commandPalette',
    descKey: 'shortcut.commandPalette',
    defaultKey: { key: 'k', mod: true },
    allowTyping: true,
    run: () => useCommandPaletteStore.getState().toggle(),
  },
  {
    id: 'saveProject',
    descKey: 'shortcut.saveProject',
    defaultKey: { key: 's', mod: true },
    run: () => useUIStore.getState().setSaveProjectModalOpen(true),
  },
  {
    id: 'globalUndo',
    descKey: 'shortcut.globalUndo',
    defaultKey: { key: 'z', mod: true, shift: false },
    run: () => globalUndo(),
  },
  {
    id: 'globalRedo',
    descKey: 'shortcut.globalRedo',
    defaultKey: { key: 'z', mod: true, shift: true },
    run: () => globalRedo(),
  },
  {
    id: 'shortcutsPanel',
    descKey: 'shortcut.shortcutsPanel',
    defaultKey: { key: '?', mod: false },
    run: () => useUIStore.getState().setShortcutsOpen(true),
  },
];

// Fixed secondary aliases (not rebindable) kept for muscle memory.
const EXTRA_BINDINGS: { key: ShortcutKey; allowTyping?: boolean; run: () => void }[] = [
  { key: { key: 'p', mod: true }, allowTyping: true, run: () => useCommandPaletteStore.getState().toggle() },
  { key: { key: 'y', mod: true }, run: () => globalRedo() },
];

export interface EffectiveBinding {
  key: ShortcutKey;
  allowTyping?: boolean;
  run: () => void;
}

export function matchShortcut(e: KeyboardEvent, k: ShortcutKey): boolean {
  const mod = e.metaKey || e.ctrlKey;
  if (k.mod !== mod) return false;
  if (k.shift !== undefined && k.shift !== e.shiftKey) return false;
  return e.key.toLowerCase() === k.key;
}

export function getEffectiveBindings(overrides: Record<string, ShortcutKey | null>): EffectiveBinding[] {
  const out: EffectiveBinding[] = [];
  for (const action of SHORTCUT_ACTIONS) {
    const override = overrides[action.id];
    if (override === null) continue; // disabled by user
    out.push({ key: override ?? action.defaultKey, allowTyping: action.allowTyping, run: action.run });
  }
  return [...out, ...EXTRA_BINDINGS];
}

/** The key a given action is currently bound to (override if set, else default). */
export function effectiveKey(actionId: string, overrides: Record<string, ShortcutKey | null>): ShortcutKey | null {
  const action = SHORTCUT_ACTIONS.find((a) => a.id === actionId);
  if (!action) return null;
  const override = overrides[actionId];
  if (override === null) return null;
  return override ?? action.defaultKey;
}

export function formatKey(k: ShortcutKey | null): string {
  if (!k) return '—';
  const parts: string[] = [];
  if (k.mod) parts.push('Ctrl/Cmd');
  if (k.shift) parts.push('Shift');
  parts.push(k.key.length === 1 ? k.key.toUpperCase() : k.key);
  return parts.join(' + ');
}
