import type { Config } from 'tailwindcss';
const config: Config = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Repurposed paper-and-ink tokens for the dark/space theme.
        // ink/paper kept as names so existing class usages reflow automatically.
        ink: '#e6e9f2',       // primary text (was the dark ink)
        paper: '#070a14',     // base background (was the warm paper)
        muted: '#9aa1b8',
        accent: '#7c9cff',    // electric periwinkle — futuristic accent
        // New surface tokens for chrome.
        panel: '#0e1322',     // panels, modals, asides
        elev: '#141a2e',      // raised surfaces (form inputs, buttons)
        line: '#1f2638',      // subtle border
        glow: '#a78bfa',      // secondary glow / nebula tint
      },
      fontFamily: {
        sans: ['var(--font-sans)', 'system-ui', 'sans-serif'],
        display: ['var(--font-display)', 'system-ui', 'sans-serif'],
        serif: ['var(--font-serif)', 'Georgia', 'serif'],
        mono: ['var(--font-mono)', 'ui-monospace', 'monospace'],
      },
    },
  },
  plugins: [],
};
export default config;
