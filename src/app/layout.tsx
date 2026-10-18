import type { Metadata, Viewport } from "next";
import { GeistSans } from "geist/font/sans";
import { APP_NAME } from "@/lib/utils";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: APP_NAME, template: `%s – ${APP_NAME}` },
  description: "Planification et suivi de l'entraînement triathlon, entre l'athlète et son coach.",
  applicationName: APP_NAME,
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f5f7f8" },
    { media: "(prefers-color-scheme: dark)", color: "#0e171d" },
  ],
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="fr" className={`${GeistSans.variable} h-full antialiased`}>
      <body className="min-h-full">{children}</body>
    </html>
  );
}
