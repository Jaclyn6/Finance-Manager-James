import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Blueprint §7.4 invariant: score-engine MUST NOT import
  // `@/lib/data/prices`. `price_readings` is the visualization-only
  // table backing the dashboard chart overlay; the score engine
  // consumes ONLY `indicator_readings`. A convention-only contract
  // is one accidental autocomplete away from breaking silently, so
  // we promote it to a lint error scoped to the score-engine tree.
  {
    files: [
      "src/lib/score-engine/**/*.ts",
      "src/lib/score-engine/**/*.tsx",
    ],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "@/lib/data/prices",
              message:
                "Blueprint §7.4: price_readings is visualization-only — score-engine must not consume it.",
            },
          ],
        },
      ],
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
