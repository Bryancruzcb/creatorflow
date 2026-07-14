import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
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
