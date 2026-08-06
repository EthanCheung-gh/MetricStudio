import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'node:path'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  define: {
    global: 'globalThis',
  },
  server: {
    host: '0.0.0.0',
    port: 5173,
    strictPort: false,
  },
  build: {
    target: 'es2022',
    outDir: 'dist',
    rollupOptions: {
      external: ['buffer', 'buffer/', 'stream', 'assert'],
    },
  },
  optimizeDeps: {
    exclude: ['buffer', 'stream', 'assert'],
  },
  // Tauri expects a fixed port by default; development proxy is handled separately.
  envPrefix: ['VITE_', 'TAURI_'],
})
