import type { LocalizedText } from '@/types/customChart';
import { getChartTypeSpec } from '@/utils/chartTypeSpecs';
import { useCustomChartStore } from '@/stores/customChartStore';

/**
 * One label for any chart id — built-in or custom.
 *
 * Chart ids come from three places: the generated registry (built-ins), the
 * backend's custom chart folder, and whatever a project file happens to hold.
 * The pickers and the config dialog must render all three without ever leaking
 * a raw i18n key ("chart.type.<id>") or throwing.
 */

/** Minimal translate signature (i18next's `t` satisfies it). */
export type ChartTypeLabelT = (key: string, options?: { defaultValue?: string }) => string;

/** Pick the localized half of a manifest text, falling back to the other language. */
export function localizedCustomText(text: LocalizedText | undefined, lang: string): string {
  if (!text) return '';
  const preferred = lang === 'en' ? text.en : text.zh;
  const fallback = lang === 'en' ? text.zh : text.en;
  if (typeof preferred === 'string' && preferred.trim() !== '') return preferred;
  return typeof fallback === 'string' ? fallback : '';
}

/** Registry label for built-ins; the bare id for anything the registry lacks. */
function builtInLabel(id: string): string {
  try {
    return getChartTypeSpec(id).label || id;
  } catch {
    return id;
  }
}

/**
 * Resolution order: a loaded custom manifest's localized label → the i18n copy
 * for the id (falling back to the registry label) → the bare id.
 * Never throws: a broken manifest or a failing `t` degrades to the id.
 */
export function chartTypeLabel(id: string, lang: string, t: ChartTypeLabelT): string {
  try {
    const custom = useCustomChartStore.getState().byId(id);
    if (custom) {
      const localized = localizedCustomText(custom.label, lang);
      if (localized) return localized;
    }
    const key = `chart.type.${id}`;
    const translated = t(key, { defaultValue: builtInLabel(id) });
    if (typeof translated === 'string' && translated !== '' && translated !== key) return translated;
  } catch {
    // A label lookup must never break a picker render.
  }
  return id;
}
