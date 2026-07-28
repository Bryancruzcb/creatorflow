import { defineConfig } from 'vitest/config';

/**
 * `src/bridge/wire.test.ts` drives the client through a real EventSource, which Node exposes only
 * under `--experimental-eventsource` (22.3+). Set here rather than in the npm script so it survives
 * a bare `vitest` run and needs no cross-platform env-var shim on Windows.
 *
 * Guarded, because Node aborts on an unknown flag: the day EventSource stabilises and the flag is
 * retired, passing it unconditionally would take down the entire suite rather than the one file
 * that needs it. When the flag is gone, EventSource is global anyway and nothing is lost — and if
 * it is somehow neither, wire.test.ts says so in a sentence instead of failing cryptically.
 */
const eventSourceFlag = process.allowedNodeEnvironmentFlags.has('--experimental-eventsource')
  ? ['--experimental-eventsource']
  : [];

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    exclude: ['e2e/**'],
    execArgv: eventSourceFlag,
  },
});
