import type { ChartTypeSpec, ChannelKey } from '@/utils/chartTypeSpecs';
import type {
  CustomChartChannels,
  CustomChartManifest,
  CustomChartOption,
  CustomYFieldsMode,
} from '@/types/customChart';

/**
 * Projection of a declarative custom chart manifest onto the EncodingPanel's
 * vocabulary (`ChartTypeSpec`). The manifest stays authoritative for channels,
 * Y-field arity and options; this module only translates its wording into the
 * panel's and drops anything the panel cannot render.
 */

/** Channels the EncodingPanel can render; a manifest may name others. */
const KNOWN_CHANNELS: readonly string[] = [
  'x', 'color', 'size', 'facet', 'z', 'error', 'source', 'target',
];

/** `channels.yFields.mode` → the panel's y-field vocabulary. */
const Y_FIELDS_MODES: Record<CustomYFieldsMode, ChartTypeSpec['yFields']> = {
  none: 'none',
  one: 'first',
  range: 'multi',
  multi: 'multi',
};

/** Manifest label projected onto the spec (English side; UI copy uses chartTypeLabel). */
function specLabel(manifest: CustomChartManifest): string {
  const label = manifest.label;
  const text = label?.en || label?.zh;
  return typeof text === 'string' && text.trim() !== '' ? text : manifest.id;
}

/**
 * The channel rule as it arrives on the wire. Undeclared channels may be
 * serialized as an explicit `null` rather than omitted, so a key being present
 * says nothing about the manifest having declared it.
 */
function channelRule(channels: CustomChartChannels, key: string): unknown {
  return channels[key as keyof CustomChartChannels];
}

/**
 * Spec for a custom chart. Channel order is the manifest's own key order so the
 * panel lists controls the way the manifest author wrote them; unknown channel
 * ids and known ids without a declared rule are dropped instead of leaking into
 * the panel as pickers that would silently do nothing.
 */
export function customChartSpec(manifest: CustomChartManifest): ChartTypeSpec {
  const channels = manifest.channels ?? {};
  return {
    label: specLabel(manifest),
    yFields: Y_FIELDS_MODES[channels.yFields?.mode ?? 'none'] ?? 'none',
    channels: Object.keys(channels).filter(
      (key): key is ChannelKey => KNOWN_CHANNELS.includes(key) && channelRule(channels, key) != null,
    ),
  };
}

/** The manifest's option declarations, in manifest order. */
export function customOptionDefs(manifest: CustomChartManifest): CustomChartOption[] {
  return Array.isArray(manifest.options) ? manifest.options.filter((def) => !!def && typeof def.key === 'string') : [];
}

/** Whether a stored value survives the option's declared type. */
function matchesType(def: CustomChartOption, value: unknown): boolean {
  switch (def.type) {
    case 'number':
      return typeof value === 'number' && Number.isFinite(value);
    case 'text':
      return typeof value === 'string';
    case 'boolean':
      return typeof value === 'boolean';
    case 'select':
      // A value outside `choices` cannot be shown by the select, so treat it as
      // stale (e.g. the manifest's choices changed) and fall back to the default.
      return typeof value === 'string' && (!def.choices || def.choices.includes(value));
    default:
      return false;
  }
}

/**
 * Effective option values: the stored value when it is present and type-valid,
 * otherwise the manifest default. Keys the manifest does not declare are
 * dropped — they would only be noise in the preview request.
 */
export function resolveCustomOptions(
  manifest: CustomChartManifest,
  options: Record<string, unknown> | undefined,
): Record<string, unknown> {
  const stored = options ?? {};
  const resolved: Record<string, unknown> = {};
  for (const def of customOptionDefs(manifest)) {
    const present = Object.prototype.hasOwnProperty.call(stored, def.key);
    resolved[def.key] = present && matchesType(def, stored[def.key]) ? stored[def.key] : def.default;
  }
  return resolved;
}
