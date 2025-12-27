/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./App.{js,jsx,ts,tsx}",
    "./src/**/*.{js,jsx,ts,tsx}"
  ],
  theme: {
    extend: {
      colors: {
        background: "hsl(70, 15%, 10%)",
        foreground: "hsl(60, 10%, 98%)",
        card: {
          DEFAULT: "hsl(70, 15%, 12%)",
          foreground: "hsl(60, 10%, 98%)",
        },
        popover: {
          DEFAULT: "hsl(70, 15%, 12%)",
          foreground: "hsl(60, 10%, 98%)",
        },
        primary: {
          DEFAULT: "hsl(70, 18%, 33%)",
          foreground: "hsl(60, 10%, 98%)",
        },
        secondary: {
          DEFAULT: "hsl(70, 12%, 22%)",
          foreground: "hsl(60, 10%, 98%)",
        },
        muted: {
          DEFAULT: "hsl(70, 10%, 15%)",
          foreground: "hsl(60, 5%, 65%)",
        },
        accent: {
          DEFAULT: "hsl(70, 25%, 35%)",
          foreground: "hsl(60, 10%, 98%)",
        },
        destructive: {
          DEFAULT: "hsl(0, 70%, 50%)",
          foreground: "hsl(60, 10%, 98%)",
        },
        border: "hsl(70, 15%, 25%)",
        input: "hsl(70, 15%, 25%)",
        ring: "hsl(70, 15%, 25%)",
      },
    },
  },
  plugins: [],
}
