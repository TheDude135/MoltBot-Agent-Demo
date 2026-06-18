// ESLint 9 flat config. Next 16 removed the `next lint` command, so we run
// ESLint directly (`eslint .`). eslint-config-next ships a native flat config;
// "core-web-vitals" bundles Next's recommended + React + a11y rules.
import next from "eslint-config-next/core-web-vitals";

const eslintConfig = [
  { ignores: [".next/**", "node_modules/**", "next-env.d.ts"] },
  ...next,
];

export default eslintConfig;
