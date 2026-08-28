/**
 * Design tokens, pixel-aligned with the web app (main branch, src/index.css +
 * tailwind.config.ts). Dark theme is the default; light theme via
 * Theme.setMode(true). Tokens are exposed as static GETTERS so every call
 * site (Theme.background / Theme.colorBackground() / ...) resolves against
 * the active mode; switching mode requires a tree rebuild (Index remounts
 * appContent on themeFlag).
 */
export class Theme {
  // Dark tokens (CSS vars from index.css, primary from tailwind.config.ts)
  private static readonly backgroundDark: string = '#0d0d0d';
  private static readonly foregroundDark: string = '#f5f5f5';
  private static readonly surfaceDark: string = '#1a1a1a';
  private static readonly surfaceElevatedDark: string = '#262626';
  private static readonly borderDark: string = '#333333';
  private static readonly mutedDark: string = '#9ca3af';

  // Light tokens (index.css .light overrides; border darkened for contrast)
  private static readonly backgroundLight: string = '#f7f7f8';
  private static readonly foregroundLight: string = '#1a1a1a';
  private static readonly surfaceLight: string = '#ffffff';
  private static readonly surfaceElevatedLight: string = '#f0f0f2';
  private static readonly borderLight: string = '#c9c9ce';
  private static readonly mutedLight: string = '#6f6f78';

  /** true = light mode, false = dark mode (default). */
  static lightMode: boolean = false;

  static setMode(light: boolean): void {
    Theme.lightMode = light;
  }

  static get background(): string {
    return Theme.lightMode ? Theme.backgroundLight : Theme.backgroundDark;
  }
  static get foreground(): string {
    return Theme.lightMode ? Theme.foregroundLight : Theme.foregroundDark;
  }
  static get surface(): string {
    return Theme.lightMode ? Theme.surfaceLight : Theme.surfaceDark;
  }
  static get surfaceElevated(): string {
    return Theme.lightMode ? Theme.surfaceElevatedLight : Theme.surfaceElevatedDark;
  }
  static get borderColor(): string {
    return Theme.lightMode ? Theme.borderLight : Theme.borderDark;
  }
  static get muted(): string {
    return Theme.lightMode ? Theme.mutedLight : Theme.mutedDark;
  }

  static readonly primary: string = '#3b82f6';
  static readonly primaryDim: string = 'rgba(59, 130, 246, 0.2)';
  static readonly danger: string = '#ef4444';
  static readonly dangerDim: string = 'rgba(239, 68, 68, 0.2)';
  static readonly success: string = '#22c55e';
  static readonly warning: string = '#f59e0b';
  static readonly scrollbarTrack: string = '#1a1a1a';
  static readonly scrollbarThumb: string = '#4b5563';

  static colorBackground(): string {
    return Theme.background;
  }

  static colorForeground(): string {
    return Theme.foreground;
  }

  static colorSurface(): string {
    return Theme.surface;
  }

  static colorSurfaceElevated(): string {
    return Theme.surfaceElevated;
  }

  static colorBorder(): string {
    return Theme.borderColor;
  }

  static colorMuted(): string {
    return Theme.muted;
  }

  // Dimensions (Tailwind spacing: h-10=40, h-9=36, h-6=24, w-10=40, p-2=8, pb-16=64)
  static readonly titleBarHeight: number = 40;
  static readonly tabBarHeight: number = 36;
  static readonly statusBarHeight: number = 24;
  static readonly activityBarWidth: number = 40;
  static readonly panelHeaderHeight: number = 36;
  static readonly panelPadding: number = 8;
  static readonly resizeHandleWidth: number = 4;
  static readonly bottomReserve: number = 64;

  // Fonts
  static readonly fontFamily: string = 'HarmonyOS Sans';
}
