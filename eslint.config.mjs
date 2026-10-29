import next from 'eslint-config-next';

const customOverrides = {
  rules: {
    'react-hooks/set-state-in-effect': 'off',
    'react-hooks/purity': 'off',
    'react-hooks/preserve-manual-memoization': 'off',
    'react/no-unescaped-entities': 'off',
    '@next/next/no-page-custom-font': 'off'
  }
};

// Server-only code (src/server: route wrapper, repositories, job runner, AI
// harness, config service) and Genkit flows must never be imported from
// client-side locations. See docs/architecture/target/foundations.md.
const clientImportGuard = {
  files: [
    'src/components/**/*.{ts,tsx}',
    'src/hooks/**/*.{ts,tsx}',
    'src/contexts/**/*.{ts,tsx}',
    'src/app/**/page.tsx',
    'src/app/**/layout.tsx'
  ],
  rules: {
    'no-restricted-imports': ['error', {
      patterns: [
        {
          group: ['@/server', '@/server/**'],
          message: 'src/server is server-only. Call an API route instead.'
        },
        {
          group: ['@/ai/flows', '@/ai/flows/**'],
          message: 'AI flows are server-only. Call an API route instead.'
        }
      ]
    }]
  }
};

export default [...next, customOverrides, clientImportGuard];
