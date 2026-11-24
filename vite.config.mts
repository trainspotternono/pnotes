import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import fs from 'node:fs';
import path from 'node:path';

// pdf.js-Ressourcen (Schrift-Maps, Standardschriften, WASM-Decoder) lokal bereitstellen → public/pdfjs
const pdfjsAssets: Plugin = {
  name: 'papierwerk-pdfjs-assets',
  buildStart() {
    const src = path.resolve('node_modules/pdfjs-dist');
    const dst = path.resolve('public/pdfjs');
    for (const dir of ['cmaps', 'standard_fonts', 'wasm']) {
      const to = path.join(dst, dir);
      if (!fs.existsSync(to)) fs.cpSync(path.join(src, dir), to, { recursive: true });
    }
  },
};

// Strikte CSP nur im Produktions-Build (der Dev-Server braucht Inline-Skripte für React Refresh).
const csp: Plugin = {
  name: 'papierwerk-csp',
  apply: 'build',
  transformIndexHtml(html) {
    return html.replace(
      '<!--CSP-->',
      // wasm-unsafe-eval: pdf.js-Bilddecoder (JPEG2000/JBIG2) als WebAssembly; worker-src: pdf.js-Worker
      `<meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self' blob:; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self' data: blob:">`,
    );
  },
};

export default defineConfig({
  base: './',
  plugins: [react(), csp, pdfjsAssets],
  server: { host: '127.0.0.1', port: 5173, strictPort: true },
  build: { outDir: 'dist', emptyOutDir: true, sourcemap: true },
  test: { environment: 'node', include: ['src/**/*.test.ts', 'shared/**/*.test.ts', 'electron/**/*.test.ts'] },
} as never);
