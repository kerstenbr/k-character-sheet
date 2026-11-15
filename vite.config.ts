import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { cpSync } from 'node:fs';
export default defineConfig({ plugins: [react(),{name:'offline-pdf-assets',closeBundle(){for(const folder of ['cmaps','standard_fonts','wasm'])cpSync(`node_modules/pdfjs-dist/${folder}`,`dist/pdfjs/${folder}`,{recursive:true});}}], build: { chunkSizeWarningLimit: 1800 } });
