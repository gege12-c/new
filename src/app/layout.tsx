import type { Metadata, Viewport } from "next";
import { ServiceWorkerRegistration } from "@/components/pwa/service-worker";
import { ThemeSync } from "@/components/theme-sync";
import { THEME_COLORS, THEME_SCRIPT } from "@/lib/theme";
import { APP_NAME } from "@/lib/utils";
import { archivo } from "./fonts";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: APP_NAME, template: `%s – ${APP_NAME}` },
  description: "Planification et suivi de l’entraînement triathlon, entre l’athlète et son coach.",
  applicationName: APP_NAME,
  // Application installable : plein écran sur l'écran d'accueil d'un iPhone (le manifeste couvre Android).
  appleWebApp: { capable: true, title: APP_NAME, statusBarStyle: "default" },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: THEME_COLORS.light },
    { media: "(prefers-color-scheme: dark)", color: THEME_COLORS.dark },
  ],
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    // Le script de tête pose le thème avant le premier affichage : <html> diffère donc du rendu serveur.
    <html lang="fr" className={`${archivo.variable} h-full antialiased`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body className="min-h-full">
        {children}
        <ThemeSync />
        <ServiceWorkerRegistration />
      </body>
    </html>
  );
}
