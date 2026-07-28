import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * Separate root, deliberately. Keeping the harness out of the product build is the whole point —
 * it ships stub bridge data, and a stub that reaches production would render fabricated evidence.
 * Nothing in src/ imports it, and `npm run build` never sees this config.
 */
export default defineConfig({
  root: 'harness',
  plugins: [react()],
  server: { host: '127.0.0.1', port: 4176, strictPort: true },
  preview: { host: '127.0.0.1', port: 4176, strictPort: true },
});
