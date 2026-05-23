import type { Config } from 'tailwindcss';

/**
 * Brand tokens mirror src/ui-mock/_shared/shell.css :root block — keep
 * in sync until the vanilla mock retires. Each value matches the public
 * marketing page's tokens (chenz16/Holon).
 */
const config: Config = {
  content: ['./app/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        bg: '#F8F6EF',
        'bg-alt': '#EFEBDD',
        'bg-dark': '#111111',
        ink: '#1A1A18',
        'ink-soft': '#4A4A45',
        'ink-mute': '#6E6A60',
        line: '#E2DCC8',
        gold: '#C69A35',
        green: '#2E7D52',
        blue: '#1F6F9E',
        purple: '#7B4FAB',
        red: '#C0392B',
      },
      borderRadius: {
        DEFAULT: '16px',
      },
      fontFamily: {
        sans: ['Inter', 'ui-sans-serif', 'system-ui', '-apple-system', 'sans-serif'],
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
      },
      maxWidth: {
        page: '1120px',
      },
    },
  },
  plugins: [],
};

export default config;
