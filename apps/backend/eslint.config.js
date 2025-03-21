import config from '@dialogue-foundry/eslint-config';

// Additional backend-specific configurations
const backendConfig = [
  {
    files: ['**/*.js', '**/*.ts'],
    rules: {
      // Add any backend-specific rule overrides here
      'no-console': ['warn', { allow: ['warn', 'error', 'info'] }],
    },
  },
  {
    // Configuration for API routes
    files: ['**/api/**/*.ts'],
    rules: {
      // Rules specific to API endpoints
      'promise/prefer-await-to-then': 'error',
    },
  },
];

export default [...config, ...backendConfig]; 