import { defineConfig } from 'vite';
import type { Plugin } from 'vite';
// @ts-ignore plain JS helper, no types
import { ICONS, iconPng } from './scripts/icons.mjs';

// App icons are drawn in code (scripts/icons.mjs) and added to the build, so the repo needs no image files.
function appIcons(): Plugin {
  return {
    name: 'kingdom-icons',
    // dev server: serve the icons too
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const file = (req.url ?? '').split('?')[0].split('/').pop() ?? '';
        const size = (ICONS as Record<string, number>)[file];
        if (!size) return next();
        res.setHeader('Content-Type', 'image/png');
        res.end(iconPng(size));
      });
    },
    generateBundle() {
      for (const [fileName, size] of Object.entries(ICONS as Record<string, number>)) {
        this.emitFile({ type: 'asset', fileName, source: iconPng(size) });
      }
    },
  };
}

// https://vite.dev/config/
export default defineConfig({
  base: './',
  plugins: [appIcons()],
});
