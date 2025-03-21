import reactConfig from '@dialogue-foundry/eslint-config/react';

// Additional frontend-specific configurations
const frontendConfig = [
  {
    // Configuration for component files
    files: ['**/components/**/*.{jsx,tsx}'],
    rules: {
      // Add any frontend component-specific rule overrides here
      'react/display-name': 'off',
      'react/prop-types': 'off', // TypeScript handles prop type checking
    },
  },
  {
    // Configuration for pages/routes
    files: ['**/pages/**/*.{jsx,tsx}', '**/routes/**/*.{jsx,tsx}'],
    rules: {
      // Rules specific to page components
      'react/jsx-no-duplicate-props': 'error',
    },
  },
  {
    // Configuration for test files
    files: ['**/__tests__/**/*.{jsx,tsx}', '**/*.test.{jsx,tsx}'],
    rules: {
      // Less restrictive rules for test files
      'react-hooks/rules-of-hooks': 'warn',
    },
  },
];

export default [...reactConfig, ...frontendConfig];
