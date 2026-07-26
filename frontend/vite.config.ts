import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  // Where the built assets will be served from. Two consumers need different answers:
  // the desktop bridge serves this bundle at the site root ("/"), while a GitHub Pages
  // project site serves it under "/<repo>/". Hardcoding either one breaks the other —
  // a Pages-shaped base makes the desktop app request assets that do not exist, and a
  // root base makes Pages 404 every asset and render a blank page. So the deploy
  // workflow sets VITE_BASE_PATH and everything else keeps the root default.
  base: process.env.VITE_BASE_PATH ?? '/',
  plugins: [react()],
  build: {
    target: 'es2022',
    rollupOptions: {
      output: {
        // Split the big, rarely-changing libraries out of the main app bundle so a
        // first-time visitor downloads smaller parallel chunks and repeat visitors
        // keep them cached across deploys. three.js is left alone — it is already
        // code-split into the lazy 3D-viewer chunks and must stay that way.
        manualChunks(id: string) {
          if (!id.includes('node_modules')) return undefined;
          if (/[\\/]node_modules[\\/](react|react-dom|scheduler)[\\/]/.test(id)) return 'react-vendor';
          if (/[\\/]node_modules[\\/](framer-motion|motion-dom|motion-utils)[\\/]/.test(id)) return 'motion-vendor';
          return undefined;
        },
      },
    },
  },
});
