/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        fraud: '#ef4444',
        review: '#f59e0b',
        safe: '#22c55e',
      },
    },
  },
  plugins: [],
}
