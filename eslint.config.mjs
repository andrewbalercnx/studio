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

export default [...next, customOverrides];
