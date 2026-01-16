// @ts-check

import eslint from '@eslint/js';
import { defineConfig } from 'eslint/config';
import tseslint from 'typescript-eslint';

export default defineConfig(
  // ESLint recommended rules
  eslint.configs.recommended,
  
  // TypeScript ESLint recommended + type-checked rules
  tseslint.configs.recommendedTypeChecked,
  
  // TypeScript ESLint stylistic + type-checked rules
  tseslint.configs.stylisticTypeChecked,
  
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  
  {
    // Ignore patterns
    ignores: [
      'dist/**',
      'node_modules/**',
      'coverage/**',
      'tests/**',
      '**/*.config.js',
      '**/*.config.mjs',
      '**/*.config.ts',
      '.history/**',
    ],
  },
  
  {
    // Custom rules
    rules: {
      'semi': ['error', 'always'],
      'no-console': 'off',

      // TypeScript specific
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
        },
      ],
      
      // Allow explicit any when necessary (warn only)
      '@typescript-eslint/no-explicit-any': 'warn',
      
      // Disable some overly strict type-checked rules
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
      
      // Prefer nullish coalescing
      '@typescript-eslint/prefer-nullish-coalescing': 'warn',
      
      // Prefer optional chaining
      '@typescript-eslint/prefer-optional-chain': 'warn',
      
      // Array type consistency
      '@typescript-eslint/array-type': ['error', { default: 'array' }],
      
      // Prefer record over index signature
      '@typescript-eslint/consistent-indexed-object-style': ['error', 'record'],
    },
  },
);
