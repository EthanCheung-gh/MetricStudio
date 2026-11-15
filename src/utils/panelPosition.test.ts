import { describe, expect, it } from 'vitest';
import {
  PANEL_EDGE_MARGIN,
  clampPanelPosition,
  defaultPanelPosition,
  type PanelSize,
  type PanelViewport,
} from './panelPosition';

const VIEWPORT: PanelViewport = { width: 1440, height: 900 };
/** A normal chart-config-sized panel: 680 wide, ~520 tall. */
const PANEL: PanelSize = { width: 680, height: 520 };
/** Bigger than the viewport on both axes — it can never fit. */
const OVERSIZED: PanelSize = { width: 2000, height: 1200 };
const MARGIN = 80;

/** Pixels of the panel actually sitting inside the viewport. */
function visibleX(x: number, size: PanelSize, viewport: PanelViewport): number {
  return Math.min(x + size.width, viewport.width) - Math.max(x, 0);
}

function visibleY(y: number, size: PanelSize, viewport: PanelViewport): number {
  return Math.min(y + size.height, viewport.height) - Math.max(y, 0);
}

describe('clampPanelPosition', () => {
  it('leaves a position that is fully inside the viewport unchanged', () => {
    const pos = { x: 120, y: 72 };

    expect(clampPanelPosition(pos, PANEL, VIEWPORT)).toEqual(pos);
  });

  it('pulls a position off the right/bottom edge back until the panel is fully visible', () => {
    // The chart-config bug: x was saved as innerWidth - 120 (a pointer padding
    // constant) so a 680px panel started 120px from the right edge and hung
    // almost entirely off-screen.
    const clamped = clampPanelPosition(
      { x: VIEWPORT.width - 120, y: VIEWPORT.height - 60 },
      PANEL,
      VIEWPORT,
    );

    expect(clamped).toEqual({
      x: VIEWPORT.width - PANEL.width,
      y: VIEWPORT.height - PANEL.height,
    });
    expect(clamped.x + PANEL.width).toBeLessThanOrEqual(VIEWPORT.width);
    expect(clamped.y + PANEL.height).toBeLessThanOrEqual(VIEWPORT.height);
  });

  it('pulls a negative position to 0', () => {
    expect(clampPanelPosition({ x: -400, y: -260 }, PANEL, VIEWPORT)).toEqual({ x: 0, y: 0 });
  });

  it('keeps the margin of a panel larger than the viewport visible', () => {
    const pulledBack = clampPanelPosition({ x: -5000, y: -3000 }, OVERSIZED, VIEWPORT, MARGIN);

    // Clamped to the far left/top: only the margin still overlaps the viewport.
    expect(visibleX(pulledBack.x, OVERSIZED, VIEWPORT)).toBe(MARGIN);
    expect(visibleY(pulledBack.y, OVERSIZED, VIEWPORT)).toBe(MARGIN);

    // Clamped to the far right/bottom: `margin` px of the leading edge remains.
    const pushedOut = clampPanelPosition({ x: 5000, y: 5000 }, OVERSIZED, VIEWPORT, MARGIN);
    expect(pushedOut).toEqual({ x: VIEWPORT.width - MARGIN, y: VIEWPORT.height - MARGIN });
    expect(visibleX(pushedOut.x, OVERSIZED, VIEWPORT)).toBe(MARGIN);
    expect(visibleY(pushedOut.y, OVERSIZED, VIEWPORT)).toBe(MARGIN);
  });

  it('respects the margin on all four sides', () => {
    const corners = [
      { x: -10000, y: -10000 }, // dragged past the top-left
      { x: 10000, y: 10000 }, // dragged past the bottom-right
      { x: -10000, y: 10000 }, // bottom-left
      { x: 10000, y: -10000 }, // top-right
    ];

    for (const size of [PANEL, OVERSIZED]) {
      for (const pos of corners) {
        const clamped = clampPanelPosition(pos, size, VIEWPORT, MARGIN);

        expect(visibleX(clamped.x, size, VIEWPORT)).toBeGreaterThanOrEqual(MARGIN);
        expect(visibleY(clamped.y, size, VIEWPORT)).toBeGreaterThanOrEqual(MARGIN);
      }
    }
  });

  it('defaults the margin to PANEL_EDGE_MARGIN', () => {
    const withDefault = clampPanelPosition({ x: 5000, y: 5000 }, OVERSIZED, VIEWPORT);
    const explicit = clampPanelPosition({ x: 5000, y: 5000 }, OVERSIZED, VIEWPORT, PANEL_EDGE_MARGIN);

    expect(withDefault).toEqual(explicit);
    expect(visibleX(withDefault.x, OVERSIZED, VIEWPORT)).toBe(PANEL_EDGE_MARGIN);
  });

  it('is idempotent, so re-clamping a saved position is safe', () => {
    const once = clampPanelPosition({ x: 9999, y: -9999 }, PANEL, VIEWPORT);

    expect(clampPanelPosition(once, PANEL, VIEWPORT)).toEqual(once);
  });

  it('keeps the whole panel on screen when it exactly fills the viewport', () => {
    const exactly: PanelSize = { width: VIEWPORT.width, height: VIEWPORT.height };

    expect(clampPanelPosition({ x: 40, y: 40 }, exactly, VIEWPORT)).toEqual({ x: 0, y: 0 });
  });
});

describe('defaultPanelPosition', () => {
  it('docks the panel near the right edge with a gutter, and stays inside after clamping', () => {
    const pos = defaultPanelPosition(PANEL.width, VIEWPORT);

    expect(pos).toEqual({ x: VIEWPORT.width - PANEL.width - 60, y: 72 });
    // The default dock is already valid, so clamping must not move it.
    expect(clampPanelPosition(pos, PANEL, VIEWPORT)).toEqual(pos);
    expect(visibleX(pos.x, PANEL, VIEWPORT)).toBe(PANEL.width);
  });

  it('falls back to the left inset when the panel is wider than the viewport', () => {
    const narrow: PanelViewport = { width: 400, height: 900 };

    const pos = defaultPanelPosition(PANEL.width, narrow);

    expect(pos.x).toBe(16);
    // Too wide to fit: clamping keeps the inset instead of pushing it away.
    expect(clampPanelPosition(pos, PANEL, narrow).x).toBe(16);
    expect(visibleX(pos.x, PANEL, narrow)).toBeGreaterThanOrEqual(PANEL_EDGE_MARGIN);
  });
});
