import eslintReactPlugin from 'eslint-plugin-react';
import eslintReactHooksPlugin from 'eslint-plugin-react-hooks';
import eslintReactCompilerPlugin from 'eslint-plugin-react-compiler';
import babelPluginSyntaxJSX from '@babel/plugin-syntax-jsx';
import baseConfig from './index.js';

// React-specific configuration
const reactConfig = [
  {
    files: ['**/*.{jsx,tsx}'],
    plugins: {
      react: eslintReactPlugin,
      'react-hooks': eslintReactHooksPlugin,
      // TODO: Update this dep when stable version is released
      'react-compiler': eslintReactCompilerPlugin,
    },
    languageOptions: {
      parserOptions: {
        babelOptions: {
          plugins: [babelPluginSyntaxJSX]
        }
      }
    },
    settings: {
      react: {
        version: 'detect',
      },
    },
    rules: {
      'react-hooks/exhaustive-deps': 'error',
      'react/react-in-jsx-scope': 'off',
      'react-compiler/react-compiler': 'warn',
    },
  },
];

// Combine base config with React-specific config
export default [...baseConfig, ...reactConfig]; 