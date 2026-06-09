import type { Config } from "tailwindcss";

const config: Config = {
  // Scan BOTH app/ AND components/. Tailwind's JIT only emits CSS for
  // classes it finds in the scanned files; `next dev` is forgiving on
  // a narrow content path (regenerates on save) but `next build`
  // freezes CSS at build time. Without ./components/** here, classes
  // used in the phase components and atoms.tsx silently disappear from
  // the production bundle and every component renders as browser defaults.
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        // Single brand accent used for every primary action + active state.
        // Mapped to Tailwind's violet so existing violet-* classes stay valid.
        brand: {
          50: "#f5f3ff",
          200: "#ddd6fe",
          300: "#c4b5fd",
          400: "#a78bfa",
          500: "#8b5cf6",
          600: "#7c3aed",
          700: "#6d28d9",
        },
      },
      keyframes: {
        "fade-in": {
          "0%": { opacity: "0", transform: "translateY(6px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        shimmer: {
          "0%": { backgroundPosition: "-200% 0" },
          "100%": { backgroundPosition: "200% 0" },
        },
      },
      animation: {
        // Phase content uses this on each transition for a soft entrance.
        "fade-in": "fade-in 0.35s cubic-bezier(0.22, 1, 0.36, 1) both",
        shimmer: "shimmer 2.5s linear infinite",
      },
    },
  },
  plugins: [],
};

export default config;
