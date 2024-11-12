// @ts-check
import { defineConfig } from 'astro/config';
 import netlify from '@astrojs/netlify';
import svelte from '@astrojs/svelte';
import tailwind from '@astrojs/tailwind';

import db from '@astrojs/db';

const corsHeaders = {
  'Cross-Origin-Embedder-Policy': 'require-corp',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Resource-Policy': 'same-origin'
}
// https://astro.build/config
export default defineConfig({
  integrations: [svelte(), tailwind(), db()],
  output: 'server',
  adapter: netlify(),
  vite: {
    worker: {
      format: 'es',
      rollupOptions: {
        output: {
          entryFileNames: '[name]-[hash].js',
        },
      },
    },
    server: {
      headers: corsHeaders,
    },
    preview: {
      headers: corsHeaders,
    },
    // build: {
    //   rollupOptions: {
    //     output: {
    //       entryFileNames: '[name]-[hash].js',
    //     },
    //   },
    // },
  },
  security: {
    checkOrigin: false
  }
});