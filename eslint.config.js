// The core, engine, SDK and API layers must never import a country module:
// country-specific logic lives only in packages/countries/* (spec: no hard-coded Cyprus logic).
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["**/node_modules/**", "apps/app/**", "supabase/**", "**/dist/**", "deploy/dist-web/**", "deploy/netlify/**", "dist-web/**"] },
  ...tseslint.configs.recommended,
  {
    files: ["packages/core/src/**", "packages/engine/src/**", "packages/country-sdk/src/**", "packages/api/src/**"],
    rules: {
      "no-restricted-imports": ["error", { patterns: [{ group: ["@plotcheck/country-*", "!@plotcheck/country-sdk", "**/countries/**"], message: "Country-agnostic packages must not import country modules." }] }],
    },
  },
  {
    files: ["packages/core/src/**", "packages/engine/src/**"],
    rules: { "no-restricted-globals": ["error", { name: "fetch", message: "core/engine are pure: no I/O." }] },
  },
);
