import type { Config } from "tailwindcss";

const config: Config = {
  // Scan BOTH app/ AND components/. Tailwind's JIT only emits CSS for
  // classes it finds in the scanned files; `next dev` is forgiving on
  // a narrow content path (regenerates on save) but `next build`
  // freezes CSS at build time. Without ./components/** here, classes
  // used in CatalogPhase, UrlPhase, ConfigurePhase, ProgressPhase,
  // DonePhase, PickVoiceDeploymentPhase, InstallVoicePhase, and
  // atoms.tsx silently disappear from the production bundle and every
  // component-level styling renders as browser defaults.
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: { extend: {} },
  plugins: [],
};

export default config;
