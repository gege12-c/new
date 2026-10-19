/**
 * Accessibilité : les pages clés du coach (ordinateur) et de l'athlète (téléphone), en clair et en
 * sombre, passent l'audit axe-core (WCAG 2.1 niveaux A et AA : contrastes, noms accessibles,
 * structure des titres et des listes, attributs ARIA, cibles des liens).
 */
import AxeBuilder from "@axe-core/playwright";
import { devices, expect, test, type Page } from "@playwright/test";
import { accounts, isoDay, signedIn, takeHydrationErrors } from "./fixtures";

test.describe.configure({ mode: "serial" });
test.afterEach(() => expect(takeHydrationErrors()).toEqual([]));

let sessionId = "";

test.beforeAll(async () => {
  // Une séance publiée aujourd'hui, pour auditer aussi le calendrier rempli, le panneau et l'éditeur.
  const { coach, athlete } = accounts() as ReturnType<typeof accounts> & { coach: { token: string } };
  const content = {
    schemaVersion: 1,
    segments: [
      {
        id: "bike",
        sport: "bike",
        steps: [
          { kind: "step", id: "wu", type: "warmup", length: { unit: "time", seconds: 900 }, targets: [{ metric: "power", unit: "percent_ftp", min: 55, max: 70 }] },
          {
            kind: "repeat",
            id: "main",
            count: 4,
            steps: [
              { kind: "step", id: "on", type: "active", length: { unit: "time", seconds: 480 }, targets: [{ metric: "power", unit: "percent_ftp", min: 95, max: 100 }] },
              { kind: "step", id: "off", type: "recovery", length: { unit: "time", seconds: 180 }, targets: [{ metric: "power", unit: "percent_ftp", min: 50, max: 55 }] },
            ],
          },
          { kind: "step", id: "cd", type: "cooldown", length: { unit: "time", seconds: 600 } },
        ],
      },
    ],
  };
  const response = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/planned_sessions`, {
    method: "POST",
    headers: {
      apikey: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
      authorization: `Bearer ${coach.token}`,
      "content-type": "application/json",
      prefer: "return=representation",
    },
    body: JSON.stringify({
      athlete_id: athlete.id,
      scheduled_date: isoDay(0),
      start_time: "18:00",
      sport: "bike",
      title: "Seuil 4 × 8 min (audit)",
      objective: "threshold",
      description: "Rester assis, cadence 90.",
      nutrition_notes: "Un bidon par heure.",
      content,
      state: "published",
      planned_duration_s: 4200,
    }),
  });
  if (!response.ok) throw new Error(`planned_sessions → ${response.status} ${await response.text()}`);
  sessionId = (await response.json())[0].id;
});

const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];

async function audit(page: Page, path: string, label: string) {
  await page.goto(path);
  await page.waitForLoadState("networkidle");
  // Les squelettes de chargement ne comptent pas : on attend le contenu réel.
  await expect(page.locator('[aria-busy="true"]')).toHaveCount(0);
  const results = await new AxeBuilder({ page }).withTags(TAGS).analyze();
  return results.violations.map(
    (v) =>
      `${label} ${path} · ${v.id} (${v.impact}) : ${v.help}\n` +
      v.nodes
        .slice(0, 4)
        .map((n) => `    ${n.target.join(" ")} : ${(n.failureSummary ?? "").split("\n").slice(1).join(" ").trim()}`)
        .join("\n"),
  );
}

for (const colorScheme of ["light", "dark"] as const) {
  test(`pages du coach, thème ${colorScheme === "light" ? "clair" : "sombre"}`, async ({ browser }) => {
    const { athlete } = accounts();
    const page = await signedIn(browser, "coach", { colorScheme });
    const problems: string[] = [];
    for (const path of [
      "/coach",
      `/coach/athletes/${athlete.id}`,
      `/coach/athletes/${athlete.id}?view=month`,
      `/coach/athletes/${athlete.id}?session=${sessionId}`,
      `/coach/athletes/${athlete.id}/sessions/${sessionId}`,
      `/coach/athletes/${athlete.id}/sessions/new`,
      `/coach/athletes/${athlete.id}/stats`,
      `/coach/athletes/${athlete.id}/profile`,
      "/coach/library",
      "/notifications",
      "/settings",
    ]) {
      problems.push(...(await audit(page, path, colorScheme)));
    }
    expect(problems, problems.join("\n")).toEqual([]);
  });

  test(`pages de l'athlète sur téléphone, thème ${colorScheme === "light" ? "clair" : "sombre"}`, async ({ browser }) => {
    const page = await signedIn(browser, "athlete", { ...devices["Pixel 7"], colorScheme });
    const problems: string[] = [];
    for (const path of ["/athlete", "/athlete/calendar", `/athlete/calendar?session=${sessionId}`, "/athlete/sessions/new", "/athlete/stats", "/athlete/profile", "/settings"]) {
      problems.push(...(await audit(page, path, colorScheme)));
    }
    expect(problems, problems.join("\n")).toEqual([]);
  });
}

test("au clavier : aller au contenu, ouvrir une séance puis la refermer sans perdre sa place", async ({ browser }) => {
  const page = await signedIn(browser, "athlete");
  await page.goto("/athlete/calendar");
  await page.keyboard.press("Tab");
  const skip = page.getByRole("link", { name: "Aller au contenu" });
  await expect(skip).toBeFocused();
  await expect(skip).toBeVisible();
  await page.keyboard.press("Enter");
  await expect(page.locator("main#contenu")).toBeFocused();

  const card = page.locator(`a[href*="session=${sessionId}"]`).first();
  await card.focus();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(new RegExp(`session=${sessionId}`));
  const panel = page.locator("aside[data-panel]");
  await expect(panel.getByRole("heading", { name: /Seuil 4 × 8 min/ })).toBeVisible();
  await expect(panel.locator(":focus")).toHaveCount(1);
  await page.keyboard.press("Escape");
  await expect(page).not.toHaveURL(/session=/);
  await expect(panel).toHaveCount(0);
  await expect(page.locator(`a[href*="session=${sessionId}"]`).first()).toBeFocused();
});

test("pages publiques", async ({ page }) => {
  const problems: string[] = [];
  for (const path of ["/login", "/signup", "/forgot-password"]) problems.push(...(await audit(page, path, "public")));
  expect(problems, problems.join("\n")).toEqual([]);
});
