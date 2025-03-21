// File: eslint.config.js (in your React project root)
import reactConfig from '@dialogue-foundry/eslint-config/react';

// Use the React config as is
export default reactConfig;

// Or with customizations:
/*
export default [
  ...reactConfig,
  {
    // Project-specific React overrides
    files: ['**\/components/**\/*.{jsx,tsx}'],
    rules: {
      // Disable specific rules for component files
      'react/display-name': 'off',
      
      // Or enable additional rules
      'react/jsx-key': 'error',
      'react/jsx-curly-brace-presence': ['error', 'never'],
    },
  },
  {
    // Test-specific settings for React components
    files: ['**\/__tests__/**\/*.{jsx,tsx}'],
    rules: {
      // Less strict rules for test files
      'react/prop-types': 'off',
      'react-hooks/rules-of-hooks': 'warn',
    },
  },
];
*/ 