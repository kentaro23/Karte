/** Shared Tailwind preset — dense, professional hospital-EMR design language. */
const preset = {
  theme: {
    extend: {
      colors: {
        accent: {
          50: '#eaf5ee',
          100: '#d4ebdd',
          200: '#a9d7bb',
          300: '#7dc299',
          400: '#3f9466',
          500: '#0b5f37',
          600: '#0a5531',
          700: '#084428',
          800: '#063a22',
          900: '#042817',
        },
        ink: '#16201b',
        muted: '#5b6b63',
        line: '#dfe3e0',
        soft: '#f4f6f5',
        canvas: '#eef1f0',
        warn: '#8a5a00',
        alert: '#8a2b2b',
        info: '#174a7c',
        teal: '#0a6e6e',
      },
      fontFamily: {
        sans: [
          '-apple-system',
          'BlinkMacSystemFont',
          'Segoe UI',
          'Noto Sans JP',
          'Hiragino Sans',
          'Yu Gothic',
          'sans-serif',
        ],
        mono: ['SF Mono', 'Menlo', 'Consolas', 'monospace'],
      },
      fontSize: {
        '2xs': ['11px', '15px'],
        xs: ['12px', '16px'],
        sm: ['13px', '18px'],
        base: ['14px', '20px'],
      },
      borderRadius: { card: '8px' },
      boxShadow: {
        panel: '0 1px 2px rgba(0,0,0,0.04), 0 1px 3px rgba(0,0,0,0.06)',
        pop: '0 8px 28px rgba(0,0,0,0.16)',
      },
    },
  },
};

export default preset;
