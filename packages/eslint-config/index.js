import babelParser from '@babel/eslint-parser';
import tsPlugin from '@typescript-eslint/eslint-plugin';
import tsParser from '@typescript-eslint/parser';
import importPlugin from 'eslint-plugin-import';
import jsdocPlugin from 'eslint-plugin-jsdoc';
import noNullPlugin from 'eslint-plugin-no-null';
import nodePlugin from 'eslint-plugin-node';
import prettierPlugin from 'eslint-plugin-prettier';
import promisePlugin from 'eslint-plugin-promise';
import globals from 'globals';

const sharedRules = {
  'id-denylist': [
    'error',
    'left',
    'paddingLeft',
    'marginLeft',
    'right',
    'paddingRight',
    'marginRight',
  ],
  'no-unused-vars': 'error',
  'no-param-reassign': ['error', { props: true }],
  'no-restricted-globals': ['error', 'isNaN'],
  'prefer-template': 'error',
};

export default [
  {
    ignores: ['**/src/index.html', '**/src/entry/index.d.ts'],
  },
  {
    // Base configuration for all JavaScript files
    files: ['**/*.{js,jsx,ts,tsx}'],
    languageOptions: {
      globals: {
        ...globals.browser,
      },
    },
    plugins: {
      jsdoc: jsdocPlugin,
      'no-null': noNullPlugin,
      prettier: prettierPlugin,
      node: nodePlugin,
      import: importPlugin,
      promise: promisePlugin,
    },
    rules: {
      ...sharedRules,
      'import/order': [
        'error',
        {
          groups: [
            'builtin',
            'external',
            'internal',
            'parent',
            'sibling',
            'index',
            'object',
            'type',
          ],
        },
      ],
      'no-null/no-null': 'error',
      'prettier/prettier': [
        'warn',
        {
          arrowParens: 'avoid',
          semi: false,
          singleQuote: true,
          tabWidth: 2,
          trailingComma: 'none',
        },
      ],
      'promise/prefer-await-to-then': 'error',
      'import/no-cycle': 'error',
    },
  },
  {
    // Configuration specific to JavaScript files
    files: ['**/*.{js,jsx}'],
    languageOptions: {
      parser: babelParser,
      parserOptions: {
        ecmaVersion: 2020,
        sourceType: 'module',
        ecmaFeatures: {
          jsx: true,
        },
        requireConfigFile: false,
      },
    },
  },
  {
    // Configuration specific to TypeScript files
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        project: './tsconfig.json',
      },
    },
    plugins: {
      '@typescript-eslint': tsPlugin,
    },
    rules: {
      '@typescript-eslint/no-non-null-assertion': 'error',
      '@typescript-eslint/no-unused-vars': 'error',
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-shadow': [
        'error',
        { builtinGlobals: true, allow: ['event'] },
      ],
      '@typescript-eslint/switch-exhaustiveness-check': 'error',
    },
  },
]; 