/** @type {import('@stryker-mutator/api/core').PartialStrykerOptions} */
module.exports = {
  packageManager: 'npm',
  reporters: ['clear-text', 'html', 'json'],
  testRunner: 'command',
  commandRunner: {
    command: 'node --test test/dsl.test.js test/telemetry.test.js',
  },
  coverageAnalysis: 'off',
  mutate: [
    // Phase-1 agreed subset (#37): dsl has unit coverage. Expand harness/capabilities
    // once more offline unit tests exist (commandRunner cannot exercise Paper RCON).
    'lib/dsl.js',
  ],
  // Documented floor — measured ~46% on dsl with current unit tests (2026-08-11).
  thresholds: {
    high: 60,
    low: 40,
    break: 10,
  },
  timeoutMS: 60_000,
  concurrency: 2,
  htmlReporter: {
    fileName: 'reports/mutation/mutation.html',
  },
  jsonReporter: {
    fileName: 'reports/mutation/mutation.json',
  },
  ignorePatterns: ['reports/**', 'node_modules/**', 'scenarios/**', 'scripts/**'],
};
