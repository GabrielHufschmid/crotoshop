import { defineConfig } from 'vite'
import type { Plugin } from 'vite'
import react from '@vitejs/plugin-react'

// Misma política que public/.htaccess (sin frame-ancestors, que no aplica en
// meta). Inyectada solo en build: el dev server de Vite necesita scripts
// inline para HMR y la meta lo rompería.
const CSP = [
  "default-src 'self'",
  "script-src 'self' 'wasm-unsafe-eval'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com",
  "img-src 'self' data: blob:",
  "connect-src 'self' https://fonts.googleapis.com https://fonts.gstatic.com",
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join('; ')

function injectCsp(): Plugin {
  return {
    name: 'inject-csp-meta',
    apply: 'build',
    transformIndexHtml(html) {
      return {
        html,
        tags: [{
          tag: 'meta',
          attrs: { 'http-equiv': 'Content-Security-Policy', content: CSP },
          injectTo: 'head-prepend',
        }],
      }
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  base: '/crotoshop/',
  plugins: [react(), injectCsp()],
  build: {
    // Flat output: some shared-hosting file managers flatten nested folders
    // on upload, which 404s everything under assets/. Keep all build output
    // alongside index.html so there's no subfolder to lose.
    assetsDir: '.',
    rollupOptions: {
      output: {
        // Some shared-host nginx configs have no MIME mapping for .mjs
        // (unlike .js/.wasm), which makes browsers refuse to load it as a
        // worker/module. Force plain .js for raw-copied assets like the
        // pdf.js worker so it always gets served as application/javascript.
        assetFileNames: (asset) => {
          const name = asset.names?.[0] ?? asset.name ?? 'asset'
          return name.endsWith('.mjs') ? '[name]-[hash].js' : '[name]-[hash][extname]'
        },
      },
    },
  },
})
