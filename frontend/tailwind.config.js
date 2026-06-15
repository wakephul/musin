/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./src/**/*.{html,ts}"],
  theme: {
    extend: {
      colors: {
        // Palette medica/professionale
        "med-blue": "#0055b3",
        "med-slate": "#f8fafc",
      },
    },
  },
  plugins: [],
};
