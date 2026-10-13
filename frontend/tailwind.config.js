/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/**/*.{html,ts}'],
  theme: {
    extend: {
      colors: {
        canvas: '#f7f7f5',
        surface: '#ffffff',
        line: '#e2e2dd',
        ink: '#1c1c1a',
        muted: '#66665f',
        faint: '#9a9a92',
        accent: { DEFAULT: '#0f6e6e', strong: '#0a5555', soft: '#e4f1f0' },
        ok: '#2f7d4f',
        warn: '#9a6400',
        danger: { DEFAULT: '#b42318', soft: '#fdecea' },
      },
      fontFamily: {
        sans: ['-apple-system', 'BlinkMacSystemFont', '"Segoe UI"', 'Roboto', '"Helvetica Neue"', 'Arial', 'sans-serif'],
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'Consolas', 'monospace'],
      },
    },
  },
  plugins: [],
};
