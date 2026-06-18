import js from "@eslint/js";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";
import prettier from "eslint-config-prettier";

// ESLint 10 flat config para todo el repo: frontend React (src/) + sidecar (TS).
// El formato lo maneja Prettier; aquí solo van reglas de corrección.
export default tseslint.config(
  { ignores: ["**/dist", "src-tauri/target"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  // Reglas de hooks de React (solo frontend): las dos clásicas de alto valor.
  // (recommended-latest añade reglas opinadas de React-Compiler; se pueden
  // adoptar luego si se quiere.)
  {
    files: ["src/**/*.{ts,tsx}"],
    plugins: { "react-hooks": reactHooks },
    rules: {
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",
    },
  },
  // `any` es pragmático en el glue de providers/tools (json de fetch, campos no
  // estándar del SDK, workaround TS2589): visible como warning, no bloquea.
  { rules: { "@typescript-eslint/no-explicit-any": "warn" } },
  // Globals de Node para los pocos archivos JS sin TypeScript (smoke scripts).
  {
    files: ["**/*.{js,mjs}"],
    languageOptions: {
      globals: {
        process: "readonly",
        console: "readonly",
        setTimeout: "readonly",
        WebSocket: "readonly",
      },
    },
  },
  // Debe ir al final: apaga las reglas que chocan con Prettier.
  prettier,
);
