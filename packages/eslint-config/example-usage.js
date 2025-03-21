// File: eslint.config.js (in your project root)
import eslintConfig from '@dialogue-foundry/eslint-config';

// Use the config as is
export default eslintConfig;

// Or with customizations:
/*
export default [
  ...eslintConfig,
  {
    // Project-specific overrides
    files: ['**\/components/**\/*.{ts,tsx}'],
    rules: {
      'react/prop-types': 'off',
      '@typescript-eslint/explicit-module-boundary-types': 'error'
    }
  },
  {
    // Environment-specific settings
    files: ['**\/tests/**\/*.{ts,tsx}'],
    languageOptions: {
      globals: {
        jest: true,
        describe: true,
        it: true,
        expect: true,
        beforeEach: true,
        afterEach: true
      }
    }
  }
];
*/ 