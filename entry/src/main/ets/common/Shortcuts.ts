/**
 * Rebindable keyboard shortcuts (web: utils/shortcuts.ts + uiStore overrides).
 * key is an uppercase letter or '?'; mod = Ctrl, shift = Shift.
 * Overrides: {actionId: ShortcutKey | null} — null disables the binding.
 */

export interface ShortcutKey {
  key: string;
  mod: boolean;
  shift: boolean;
}

export interface ShortcutActionDef {
  id: string;
  titleZh: string;
  titleEn: string;
  def: ShortcutKey;
}

export const SHORTCUT_ACTIONS: ShortcutActionDef[] = [
  { id: 'commandPalette', titleZh: '命令面板', titleEn: 'Command palette',
    def: { key: 'K', mod: true, shift: false } },
  { id: 'saveProject', titleZh: '保存项目', titleEn: 'Save project',
    def: { key: 'S', mod: true, shift: false } },
  { id: 'globalUndo', titleZh: '全局撤销', titleEn: 'Global undo',
    def: { key: 'Z', mod: true, shift: false } },
  { id: 'globalRedo', titleZh: '全局重做', titleEn: 'Global redo',
    def: { key: 'Z', mod: true, shift: true } },
  { id: 'shortcutsPanel', titleZh: '快捷键面板', titleEn: 'Shortcuts panel',
    def: { key: '?', mod: false, shift: false } }
];

/** Resolve an override map into the effective binding for one action. */
export function effectiveShortcut(overrides: Record<string, ShortcutKey | null>, id: string): ShortcutKey {
  if (overrides !== null && overrides[id] !== undefined && overrides[id] !== null) {
    return overrides[id] as ShortcutKey;
  }
  for (let i = 0; i < SHORTCUT_ACTIONS.length; i++) {
    if (SHORTCUT_ACTIONS[i].id === id) {
      return SHORTCUT_ACTIONS[i].def;
    }
  }
  return { key: '', mod: false, shift: false };
}

/** 'Ctrl + Shift + K' display format (web formatKey). */
export function formatShortcut(k: ShortcutKey): string {
  if (k.key.length === 0) {
    return '—';
  }
  let out = '';
  if (k.mod) {
    out += 'Ctrl + ';
  }
  if (k.shift) {
    out += 'Shift + ';
  }
  return out + k.key;
}

/** Map a physical key event (keyCode/keyText) to a recordable binding, or null to keep waiting. */
export function bindingFromKeycode(keyCode: number, keyText: string): ShortcutKey | null {
  // pure modifiers keep the recording alive (web: control/meta/shift/alt wait)
  if ((keyCode >= 2045 && keyCode <= 2048) || keyCode === 2072 || keyCode === 2073) {
    return null;
  }
  if (keyCode === 2070) {
    return null; // Esc — caller treats it as cancel via keyCode check
  }
  const text = keyText.trim();
  if (text.length === 1) {
    const upper = text.toUpperCase();
    const code = upper.charCodeAt(0);
    if (code >= 65 && code <= 90) {
      return { key: upper, mod: false, shift: text !== upper };
    }
    if (text === '?') {
      return { key: '?', mod: false, shift: false };
    }
  }
  return null;
}

export const KEYCODE_ESC: number = 2070;
