import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';
import eslintConfigPrettier from 'eslint-config-prettier';

export default tseslint.config(
  eslint.configs.recommended,
  ...tseslint.configs.strict,
  eslintConfigPrettier,
  {
    rules: {
      'no-console': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/consistent-type-imports': 'error',
    },
  },
  {
    files: ['src/config/env.ts'],
    rules: {
      'no-console': 'off', // Logger isn't available yet during env validation
    },
  },
  {
    ignores: ['dist/', 'node_modules/', 'coverage/', 'prisma/', 'src/generated/'],
  },
);
