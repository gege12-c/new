import localFont from "next/font/local";

/** Archivo variable (graisse 100–900, chasse 62–125 %), hébergée avec l’application. */
export const archivo = localFont({
  src: "../../node_modules/@fontsource-variable/archivo/files/archivo-latin-wdth-normal.woff2",
  variable: "--font-archivo",
  weight: "100 900",
  display: "swap",
  declarations: [{ prop: "font-stretch", value: "62% 125%" }],
  fallback: ["ui-sans-serif", "system-ui", "sans-serif"],
});
