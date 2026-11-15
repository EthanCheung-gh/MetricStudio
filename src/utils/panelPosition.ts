/**
 * Viewport-aware placement for draggable floating panels (chart config dialog,
 * …). Pure math only — no DOM, no React: the caller measures the panel with
 * `getBoundingClientRect()` and passes the numbers in, because the panel's real
 * rendered size (not a hardcoded width constant or a pointer offset) decides
 * what "visible" means.
 */

export interface PanelPosition {
  x: number;
  y: number;
}

export interface PanelSize {
  width: number;
  height: number;
}

export interface PanelViewport {
  width: number;
  height: number;
}

/**
 * How much of a panel must stay on screen when the panel is larger than the
 * viewport (it cannot fit, but the header must stay grabbable).
 */
export const PANEL_EDGE_MARGIN = 80;

/** Default dock: right-aligned with this gutter… */
const DEFAULT_GAP = 60;
/** …but never closer than this to the left edge… */
const DEFAULT_INSET = 16;
/** …and this far from the top edge. */
const DEFAULT_TOP = 72;

function clampAxis(value: number, panelLength: number, viewportLength: number, margin: number): number {
  if (panelLength <= viewportLength) {
    // Panel fits: keep the whole thing inside [0, viewportLength - panelLength].
    return Math.min(Math.max(0, value), Math.max(0, viewportLength - panelLength));
  }
  // Panel is bigger than the viewport: keep at least `margin` px visible on the
  // leading edge (`0 … margin`) and on the trailing edge (`viewportLength … -margin`).
  const visibleMargin = Math.min(Math.max(0, margin), Math.max(0, viewportLength));
  const min = visibleMargin - panelLength;
  const max = viewportLength - visibleMargin;
  return Math.min(Math.max(min, value), max);
}

/**
 * Clamp `pos` so the panel of `size` stays visible in `viewport`:
 * fully inside when it fits, otherwise at least `margin` px of it visible on
 * both axes.
 */
export function clampPanelPosition(
  pos: PanelPosition,
  size: PanelSize,
  viewport: PanelViewport,
  margin: number = PANEL_EDGE_MARGIN,
): PanelPosition {
  return {
    x: clampAxis(pos.x, size.width, viewport.width, margin),
    y: clampAxis(pos.y, size.height, viewport.height, margin),
  };
}

/**
 * Centred-ish default dock for a panel of `panelWidth`: right-aligned with a
 * 60px gutter, never closer than 16px to the left edge, 72px from the top.
 */
export function defaultPanelPosition(panelWidth: number, viewport: PanelViewport): PanelPosition {
  return {
    x: Math.max(DEFAULT_INSET, viewport.width - panelWidth - DEFAULT_GAP),
    y: DEFAULT_TOP,
  };
}
