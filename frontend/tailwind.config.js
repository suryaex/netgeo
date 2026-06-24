/**
 * NetForge — desktop-class glassmorphism design system.
 * Cohesive with secureops (Luminous Security) & storagehub: Apple-blue accent,
 * Inter type, backdrop-blur glass surfaces, class-based dark mode.
 * @type {import('tailwindcss').Config}
 */
export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', '-apple-system', 'BlinkMacSystemFont', 'SF Pro Display', 'Segoe UI', 'sans-serif'],
        mono: ['JetBrains Mono', 'SF Mono', 'ui-monospace', 'Menlo', 'monospace'],
      },
      colors: {
        // Apple-blue accent shared across the author's projects.
        accent: {
          DEFAULT: '#007AFF',
          soft: '#3A93FF',
          dark: '#0058BC',
        },
        success: { DEFAULT: '#34C759', dark: '#15803D' },
        warning: { DEFAULT: '#FF9F0A', dark: '#9E3D00' },
        danger: { DEFAULT: '#FF453A', dark: '#93000A' },
        info: { DEFAULT: '#0891B2', dark: '#0E7490' },
        ink: {
          DEFAULT: '#111827',
          soft: '#6B7280',
          muted: '#9CA3AF',
        },
        // Node-kind palette (also exported as CSS vars in theme/tokens.ts).
        node: {
          router: '#007AFF',
          switch: '#34C759',
          host: '#8E8E93',
          ap: '#5856D6',
          olt: '#FF9F0A',
          firewall: '#FF453A',
          server: '#0891B2',
        },
      },
      borderRadius: {
        sm: '10px',
        md: '16px',
        lg: '22px',
        xl: '28px',
      },
      backdropBlur: {
        12: '12px',
        20: '20px',
        30: '30px',
      },
      boxShadow: {
        glass: '0 8px 32px rgba(0,0,0,0.12)',
        'glass-lg': '0 20px 60px rgba(0,0,0,0.22)',
        soft: '0 2px 10px rgba(0,0,0,0.06)',
        'window': '0 24px 70px rgba(0,0,0,0.28), 0 2px 8px rgba(0,0,0,0.12)',
        'dock': '0 12px 40px rgba(0,0,0,0.25)',
      },
      transitionDuration: {
        fast: '120ms',
        std: '180ms',
        slow: '240ms',
      },
      keyframes: {
        'fade-in': {
          from: { opacity: '0', transform: 'translateY(6px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
        'scale-in': {
          from: { opacity: '0', transform: 'scale(0.96)' },
          to: { opacity: '1', transform: 'scale(1)' },
        },
        'dock-bounce': {
          '0%,100%': { transform: 'translateY(0)' },
          '50%': { transform: 'translateY(-8px)' },
        },
      },
      animation: {
        'fade-in': 'fade-in 180ms ease-out',
        'scale-in': 'scale-in 180ms ease-out',
        'dock-bounce': 'dock-bounce 600ms ease-in-out',
      },
    },
  },
  plugins: [],
};
