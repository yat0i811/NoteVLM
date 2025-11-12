import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx}",
    "./components/**/*.{js,ts,jsx,tsx}"
  ],
  theme: {
    extend: {
      colors: {
        canvas: "#f2f2f7",
        primary: "#0f172a",
        accent: "#0ea5e9"
      }
    }
  },
  plugins: []
};

export default config;
