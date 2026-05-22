import tseslint from 'typescript-eslint';
import eslint from '@eslint/js';

export default tseslint.config(
    eslint.configs.recommended,
    ...tseslint.configs.recommended,
    {
        ignores: ['dist/**', 'out/**', 'node_modules/**', 'code-functions/**', 'bin/**']
    },
    {
        rules: {
            '@typescript-eslint/no-explicit-any': 'off',
            '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
            'curly': 'warn',
            'semi': ['warn', 'always'],
            'eqeqeq': 'warn'
        }
    }
);
