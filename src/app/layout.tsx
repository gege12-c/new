import type { Metadata, Viewport } from "next";
import { APP_NAME } from "@/lib/utils";
import { archivo } from "./fonts";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: APP_NAME, template: `%s – ${APP_NAME}` },
  description: "Planification et suivi de l’entraînement triathlon, entre l’athlète et son coach.",
  applicationName: APP_NAME,
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f3f5f8" },
    { media: "(prefers-color-scheme: dark)", color: "#0a1220" },
  ],
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="fr" className={`${archivo.variable} h-full antialiased`}>
      <body className="min-h-full">{children}</body>
    </html>
  );
}
