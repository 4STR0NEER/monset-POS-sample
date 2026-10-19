import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  optimizeDeps: { exclude: ['@electric-sql/pglite'] }, // loads its own wasm and data files
  // The front desk PC is on old Windows, stuck on Chrome 109.
  build: { target: ['chrome109', 'edge109', 'firefox115', 'safari15'] },
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'prompt',
      includeManifestIcons: false, // already matched by globPatterns
      manifest: {
        name: 'Sample POS',
        short_name: 'Sample POS',
        start_url: '/',
        display: 'standalone',
        background_color: '#19171B',
        theme_color: '#19171B',
        icons: [
          { src: '/assets/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/assets/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: '/assets/icon-512-maskable.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // App shell only. The database engine (PGlite wasm + data, ~10 MB) loads from the network once and the browser caches it.
        globPatterns: ['**/*.{js,css,html,png,svg,ico,woff2}'],
        globIgnores: ['**/pglite*', '**/postgres*'],
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
        navigateFallbackDenylist: [/^\/helper\//], // helper/: receipt helper downloads
      },
    }),
  ],
})
