/**
 * Design tokens, pixel-aligned with the web app (main branch, src/index.css +
 * tailwind.config.ts). Dark theme is the default.
 */
export class Theme {
  // Colors (CSS vars from index.css, primary from tailwind.config.ts)
  static readonly background: string = '#0d0d0d';
  static readonly foreground: string = '#f5f5f5';
  static readonly surface: string = '#1a1a1a';
  static readonly surfaceElevated: string = '#262626';
  static readonly borderColor: string = '#333333';
  static readonly muted: string = '#9ca3af';
  static readonly primary: string = '#3b82f6';
  static readonly primaryDim: string = 'rgba(59, 130, 246, 0.2)';
  static readonly danger: string = '#ef4444';
  static readonly dangerDim: string = 'rgba(239, 68, 68, 0.2)';
  static readonly success: string = '#22c55e';
  static readonly warning: string = '#f59e0b';
  static readonly scrollbarTrack: string = '#1a1a1a';
  static readonly scrollbarThumb: string = '#4b5563';

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
