import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    // La clé secrète Supabase contourne la RLS : jamais dans une page, une mise en page ou un composant.
    files: ["src/app/**/page.tsx", "src/app/**/layout.tsx", "src/components/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            { name: "@/lib/supabase/admin", message: "Client serveur (clé secrète) interdit ici : passez par la RLS." },
            { name: "@/lib/strava/deps", message: "Client serveur (clé secrète) interdit ici : passez par une action ou une route." },
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
