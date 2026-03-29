import type { Config } from 'tailwindcss';

const config: Config = {
  darkMode: 'class',
  content: ['./src/client/**/*.{ts,tsx}', './index.html'],
  theme: {
    extend: {
      colors: {
        steel: {
          950: '#070d14',
          900: '#0d1b2a',
          800: '#132639',
          700: '#1e3a52',
          600: '#243d54',
          400: '#4a7a9b',
          300: '#93c5e0',
          100: '#e8f4fd',
        },
      },
      fontFamily: {
        sans: ['Inter Variable', 'Inter', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'Fira Code', 'monospace'],
      },
      backgroundImage: {
        'app-gradient': 'linear-gradient(160deg, #070d14 0%, #0a1628 100%)',
      },
      boxShadow: {
        panel: '0 4px 24px 0 rgba(7,13,20,0.7), 0 1px 0 0 rgba(30,58,82,0.5)',
        'bit-on': '0 0 8px 1px rgba(56,189,248,0.3)',
        connected: '0 0 12px 2px rgba(52,211,153,0.2)',
        error: '0 0 12px 2px rgba(248,113,113,0.25)',
      },
      animation: {
        'pulse-slow': 'pulse 2s cubic-bezier(0.4,0,0.6,1) infinite',
        'spin-slow': 'spin 1.5s linear infinite',
      },
      gridTemplateColumns: {
        '16': 'repeat(16, minmax(0, 1fr))',
      },
    },
  },
  plugins: [],
};

export default config;
