import { Language } from '../model/WorkspaceState';

/** Minimal i18n helper for the shell (web: src/i18n). Full locale tables come later. */
export function l10n(lang: Language, zh: string, en: string): string {
  return lang === Language.Zh ? zh : en;
}
