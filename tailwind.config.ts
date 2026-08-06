import type { Config } from 'tailwindcss'
import { heroui } from '@heroui/theme'

export default {
  content: [
    './src/**/*.{js,ts,jsx,tsx}',
    './node_modules/@heroui/theme/dist/**/*.{js,ts,jsx,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        background: '#0d0d0d',
        foreground: '#f5f5f5',
        surface: '#1a1a1a',
        'surface-elevated': '#262626',
        border: '#333333',
        primary: {
          DEFAULT: '#3b82f6',
          foreground: '#ffffff',
        },
      },
    },
  },
  darkMode: 'class',
  plugins: [heroui()],
} satisfies Config
