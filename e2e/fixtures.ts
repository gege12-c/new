import { readFileSync } from "node:fs";
import { expect, type Browser, type Page } from "@playwright/test";
import { ACCOUNTS_FILE } from "./global-setup";

interface Account {
  id: string;
  email: string;
  name: string;
}

export function accounts(): { coach: Account; athlete: Account; password: string } {
  return JSON.parse(readFileSync(ACCOUNTS_FILE, "utf8"));
}

/**
 * Erreurs d’hydratation relevées dans les pages ouvertes par signedIn : un écart entre le rendu
 * serveur et le navigateur (fuseau horaire, date courante…) fait échouer le test en cours.
 */
const hydrationErrors: string[] = [];
const HYDRATION_ERROR = /hydrat|Minified React error #(418|423|425)/i;

export function takeHydrationErrors(): string[] {
  return hydrationErrors.splice(0);
}

/** Ouvre une session dans un nouveau contexte de navigateur, par le formulaire de connexion. */
export async function signedIn(browser: Browser, who: "coach" | "athlete", options: Parameters<Browser["newContext"]>[0] = {}): Promise<Page> {
  const { password, ...users } = accounts();
  const context = await browser.newContext(options);
  context.on("console", (message) => {
    if (message.type() === "error" && HYDRATION_ERROR.test(message.text())) {
      hydrationErrors.push(`${message.page()?.url() ?? "?"} : ${message.text().slice(0, 400)}`);
    }
  });
  const page = await context.newPage();
  await page.goto("/login");
  await page.getByLabel("Email").fill(users[who].email);
  await page.getByLabel("Mot de passe").fill(password);
  await page.getByRole("button", { name: "Se connecter" }).click();
  await expect(page).not.toHaveURL(/\/login/);
  return page;
}

/** Date locale (Europe/Paris) décalée de n jours, au format AAAA-MM-JJ. */
export function isoDay(offset = 0): string {
  const date = new Date(Date.now() + offset * 86_400_000);
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Paris" }).format(date);
}

/** Décale une date AAAA-MM-JJ de n jours. */
export function addDays(iso: string, days: number): string {
  const date = new Date(`${iso}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/** Lundi de la semaine située `weeks` semaines après la semaine en cours (Europe/Paris). */
export function mondayIn(weeks: number): string {
  const today = isoDay(0);
  const weekday = (new Date(`${today}T12:00:00Z`).getUTCDay() + 6) % 7; // 0 = lundi
  return addDays(today, weeks * 7 - weekday);
}
