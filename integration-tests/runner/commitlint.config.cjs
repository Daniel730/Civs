module.exports = {
  extends: ['@commitlint/config-conventional'],
  rules: {
    // Allow longer subjects for issue refs, e.g. "feat(runner): … (#35)"
    'header-max-length': [2, 'always', 120],
  },
};
