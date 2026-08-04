import type { Config } from 'tailwindcss'

const config: Config = {
  darkMode: ["class"],
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    container: {
      center: true,
      padding: "2rem",
      screens: {
        "2xl": "1400px",
      },
    },
    extend: {
      colors: {
        gray: {
          200: '#f5f5f5',
          300: '#cdcdcf',
          400: '#999aa1',
          500: '#7d7e87',
          600: '#44454a',
          700: '#414248',
          800: '#393a41',
          900: '#2c2d32',
        },
        blue: {
          100: '#dee0fc',
          200: '#b9bdf8',
          300: '#949bf5',
          400: '#727cf3',
          500: '#5865f2',
          600: '#4752c4',
          700: '#3c45a5',
        },
        green: {
          200: '#a7e3bd',
          300: '#77d59d',
          400: '#23a55a',
          500: '#23a55a',
          600: '#1a7f46',
          700: '#176b3d',
        },
        emerald: {
          300: '#77d59d',
          400: '#23a55a',
          500: '#23a55a',
          600: '#1a7f46',
        },
        red: {
          100: '#f7d5d7',
          300: '#ee9296',
          400: '#da3e44',
          500: '#da3e44',
          600: '#b83238',
          700: '#8e282d',
        },
        yellow: {
          200: '#f8dea1',
          400: '#f0b232',
          500: '#d89b24',
          600: '#b57a16',
        },
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
        popover: {
          DEFAULT: "hsl(var(--popover))",
          foreground: "hsl(var(--popover-foreground))",
        },
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
      },
      keyframes: {
        "accordion-down": {
          from: { height: "0" },
          to: { height: "var(--radix-accordion-content-height)" },
        },
        "accordion-up": {
          from: { height: "var(--radix-accordion-content-height)" },
          to: { height: "0" },
        },
      },
      animation: {
        "accordion-down": "accordion-down 0.2s ease-out",
        "accordion-up": "accordion-up 0.2s ease-out",
      },
    },
  },
  plugins: [require("tailwindcss-animate")],
}
export default config