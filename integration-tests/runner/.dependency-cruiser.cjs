/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: 'no-circular',
      severity: 'error',
      comment: 'Circular dependencies make overnight agent loops hard to reason about.',
      from: {},
      to: { circular: true },
    },
    {
      name: 'lib-not-to-scripts',
      severity: 'error',
      comment: 'Library modules must not import CLI/scripts (keeps harness reusable).',
      from: { path: '^lib/' },
      to: { path: '^scripts/' },
    },
    {
      name: 'lib-not-to-test',
      severity: 'error',
      comment: 'Production lib must not depend on tests.',
      from: { path: '^lib/' },
      to: { path: '^test/' },
    },
    {
      name: 'no-secrets-imports',
      severity: 'error',
      comment: 'Never import env/credential dumps into runner modules.',
      from: {},
      to: {
        path: '(^|/)(\\.env|credentials|secrets)(/|\\.|$)',
        pathNot: '\\.md$',
      },
    },
    {
      name: 'no-plugin-java-from-runner',
      severity: 'error',
      comment: 'Runner must not reach into Civs Java plugin source — RCON/capabilities only.',
      from: { path: '^(lib|scripts)/' },
      to: { path: '^\\.\\./\\.\\./src/' },
    },
  ],
  options: {
    doNotFollow: {
      path: 'node_modules',
    },
    exclude: {
      path: ['node_modules', 'reports', '\\.biome', 'coverage'],
    },
    tsPreCompilationDeps: false,
    enhancedResolveOptions: {
      exportsFields: [],
      conditionNames: ['require', 'node', 'default'],
    },
    reporterOptions: {
      text: { highlightFocused: true },
    },
  },
};
