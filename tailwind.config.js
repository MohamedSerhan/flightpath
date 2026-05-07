/** @type {import('tailwindcss').Config} */
export default {
  content: ["./src/web/**/*.{html,ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: ["Inter", "system-ui", "sans-serif"],
      },
      colors: {
        ink: {
          50: "#f5f7fa",
          100: "#e8ecf3",
          200: "#cfd6e3",
          400: "#7a869a",
          600: "#3b4a63",
          800: "#1c2434",
          900: "#0d1320",
        },
        sky: {
          500: "#1e88e5",
          600: "#1976d2",
        },
      },
    },
  },
  plugins: [],
};
