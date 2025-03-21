# ESLint Config

A shared ESLint configuration for Dialogue Foundry projects using ESLint v9.

## Features

- Support for JavaScript and TypeScript
- Prettier integration
- Import ordering and cycle detection
- Promise best practices
- TypeScript-specific rules
- JSDoc validation
- React and React Hooks linting (via separate config)
- React Compiler support

## Usage

### Base Configuration

1. Install the package

```bash
pnpm add -D @dialogue-foundry/eslint-config
```

2. Create an `eslint.config.js` file in your project root:

```javascript
import config from '@dialogue-foundry/eslint-config';

export default config;
```

3. Add your own customizations as needed:

```javascript
import config from '@dialogue-foundry/eslint-config';

export default [
  ...config,
  {
    files: ['**/*.ts'],
    rules: {
      // Override rules for TypeScript files
      '@typescript-eslint/no-explicit-any': 'warn',
    },
  },
];
```

### React Configuration

For React projects, use the React-specific configuration:

```javascript
import reactConfig from '@dialogue-foundry/eslint-config/react';

export default reactConfig;
```

This includes:
- React and React Hooks recommended configs
- React Compiler plugin support
- Optimized settings for JSX

## ESLint v9 Flat Config

This package uses the new ESLint v9 flat config format. Key differences from ESLint 8:

- Uses ES modules instead of CommonJS
- Configuration is an array of objects instead of a single object
- Plugins are imported directly rather than referenced by string
- No `extends` property; configurations are composed by spreading arrays
- Parser and parserOptions are now under `languageOptions`
- File patterns are specified with `files` property
- Ignores are specified with `ignores` property

## Included Rules

The configuration includes rules for:

- Code style and formatting (via Prettier)
- Import ordering and cycle detection
- Promise handling
- TypeScript best practices
- Accessibility concerns
- Prevention of common errors
- React and React Hooks best practices (in React config) 