/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      fontFamily: {
        sans: ['"Plus Jakarta Sans"', 'system-ui', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'monospace'],
      },
      colors: {
        void:  '#0B0A08',
        pitch: '#141210',
        ink:   '#111009',
        warm:  '#F8F6F1',
        sand:  '#EDE9E1',
        stone: '#D4CFC6',
        mist:  '#9B9690',
        dim:   '#6B6760',
        brand: {
          DEFAULT: '#1B5C3C',
          light:   '#226B48',
          pale:    '#EBF5EE',
          mid:     '#14472D',
        },
        lime: '#A8E03A',
      },
      animation: {
        'float':      'float 6s ease-in-out infinite',
        'pulse-soft': 'pulseSoft 2.5s ease-in-out infinite',
        'fade-up':    'fadeUp 0.5s ease forwards',
        'slide-in':   'slideIn 0.3s ease forwards',
      },
      keyframes: {
        float:     { '0%,100%': { transform: 'translateY(0)' }, '50%': { transform: 'translateY(-10px)' } },
        pulseSoft: { '0%,100%': { opacity: '1' }, '50%': { opacity: '0.4' } },
        fadeUp:    { from: { opacity: '0', transform: 'translateY(16px)' }, to: { opacity: '1', transform: 'translateY(0)' } },
        slideIn:   { from: { opacity: '0', transform: 'translateX(-12px)' }, to: { opacity: '1', transform: 'translateX(0)' } },
      },
      boxShadow: {
        'card':    '0 1px 3px rgba(0,0,0,0.06),0 4px 16px rgba(0,0,0,0.04)',
        'card-md': '0 2px 8px rgba(0,0,0,0.08),0 12px 40px rgba(0,0,0,0.06)',
        'dark-sm': '0 2px 8px rgba(0,0,0,0.4),0 8px 24px rgba(0,0,0,0.25)',
      },
    },
  },
  plugins: [],
}
