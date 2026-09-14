/** @type {import('tailwindcss').Config} */
export default {
  content: ['./src/renderer/**/*.{ts,tsx,html}'],
  darkMode: 'class',
  theme: {
    extend: {
      keyframes: {
        'page-in': {
          from: { opacity: '0', transform: 'translateY(10px)' },
          to: { opacity: '1', transform: 'translateY(0)' }
        },
        'fade-in': {
          from: { opacity: '0' },
          to: { opacity: '1' }
        },
        'fade-out': {
          from: { opacity: '1' },
          to: { opacity: '0' }
        },
        'slide-down': {
          from: { opacity: '0', transform: 'translateY(-100%)' },
          to: { opacity: '1', transform: 'translateY(0)' }
        },
        'zoom-in': {
          from: { opacity: '0', transform: 'scale(.96) translateY(8px)' },
          to: { opacity: '1', transform: 'scale(1) translateY(0)' }
        },
        'zoom-out': {
          from: { opacity: '1', transform: 'scale(1) translateY(0)' },
          to: { opacity: '0', transform: 'scale(.96) translateY(8px)' }
        },
        'menu-in': {
          from: { opacity: '0', transform: 'scale(.95) translateY(-4px)' },
          to: { opacity: '1', transform: 'scale(1) translateY(0)' }
        }
      },
      animation: {
        'page-in': 'page-in .25s ease-out both',
        'fade-in': 'fade-in .2s ease-out both',
        'fade-out': 'fade-out .18s ease-in both',
        'slide-down': 'slide-down .25s ease-out both',
        'zoom-in': 'zoom-in .22s cubic-bezier(.16,1,.3,1) both',
        'zoom-out': 'zoom-out .18s ease-in both',
        'menu-in': 'menu-in .15s ease-out both'
      }
    }
  },
  plugins: []
}
