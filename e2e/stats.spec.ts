/**
 * Phase 5 : statistiques calculées sur les données que TriCoach peut agréger (séances prévues,
 * retours de séance, fichiers FIT, seuils), visibles de l'athlète et de son coach.
 */
import { expect, test } from "@playwright/test";
import { accounts, isoDay, signedIn, takeHydrationErrors } from "./fixtures";

test.describe.configure({ mode: "serial" });
test.afterEach(() => expect(takeHydrationErrors()).toEqual([]));

type WithToken = { id: string; token: string };
const yesterday = isoDay(-1);
const stamp = Date.now();

async function rest(token: string, path: string, body: unknown) {
  const response = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/${path}`, {
    method: "POST",
    headers: {
      apikey: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      prefer: "return=representation",
    },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`${path} → ${response.status} ${await response.text()}`);
  return response.json();
}

const pct = (min: number, max: number) => [{ metric: "power", unit: "percent_ftp", min, max }];

test.beforeAll(async () => {
  const { coach, athlete } = accounts() as unknown as { coach: WithToken; athlete: WithToken };
  // Hier : une séance de vélo d'1 h 05, faite (retour de l'athlète) et enregistrée par un fichier FIT.
  const content = {
    schemaVersion: 1,
    segments: [
      {
        id: "bike",
        sport: "bike",
        steps: [
          { kind: "step", id: "wu", type: "warmup", length: { unit: "time", seconds: 900 }, targets: pct(55, 65) },
          { kind: "step", id: "main", type: "active", length: { unit: "time", seconds: 2400 }, targets: pct(88, 92) },
          { kind: "step", id: "cd", type: "cooldown", length: { unit: "time", seconds: 600 }, targets: pct(50, 55) },
        ],
      },
    ],
  };
  const [session] = await rest(coach.token, "planned_sessions", {
    athlete_id: athlete.id,
    scheduled_date: yesterday,
    start_time: "07:00",
    sport: "bike",
    title: `Tempo stats ${stamp}`,
    content,
    state: "published",
    planned_duration_s: 3900,
  });
  await rest(athlete.token, "session_completions", { session_id: session.id, status: "done", rpe: 6 });
  await rest(athlete.token, "activities", {
    source: "fit_upload",
    external_id: `e2e-stats-${stamp}:0`,
    sport: "bike",
    start_time: `${yesterday}T05:05:00Z`,
    local_date: yesterday,
    local_start_time: "07:05",
    elapsed_s: 4000,
    moving_s: 3800,
    distance_m: 31000,
    avg_power: 203,
  });
});

test("l'athlète voit sa progression, sans aucune donnée Strava", async ({ browser }) => {
  const page = await signedIn(browser, "athlete");
  await page.getByRole("link", { name: "Progression" }).first().click();
  await expect(page).toHaveURL(/\/athlete\/stats/);
  await expect(page.getByRole("heading", { name: "Volume par semaine" })).toBeVisible();
  await expect(page.getByText(/Les activités Strava n’entrent dans aucune statistique/)).toBeVisible();

  // Réalisé d'après le fichier FIT (1 h 03 au moins) et suivi : la séance d'hier est « faite ».
  const realized = page.locator("dt", { hasText: "Réalisé (fichiers FIT)" }).locator("..");
  await expect(realized).not.toContainText("aucun fichier FIT");
  const done = page.locator("dl div", { has: page.locator("dt", { hasText: /^Faites$/ }) });
  await expect(done.locator("dd").first()).not.toHaveText("0");

  // Records tirés du fichier FIT, seuil de 20 minutes respecté.
  await expect(page.getByText("Meilleure puissance moyenne (sortie de 20 min ou plus)")).toBeVisible();
  await expect(page.getByText(/\b2\d\d W\b/).first()).toBeVisible();

  // Le tableau donne les valeurs sans survol.
  await page.getByText("Voir le tableau").click();
  await expect(page.getByRole("table").first()).toContainText("Total prévu");

  // Condition physique : le fichier FIT d'hier compte, Strava jamais ; la prévision suit le plan.
  const fitness = page.locator("section", { has: page.getByRole("heading", { name: "Condition physique" }) });
  await expect(fitness).toContainText(/Compté : \d+ fichiers? FIT/);
  await expect(fitness).toContainText("Les activités Strava ne sont pas comptées (règles de Strava).");
  await expect(fitness.locator("dt", { hasText: /^Condition$/ }).locator("+ dd")).toHaveText(/^\d+$/);
  await expect(fitness).toContainText(/Transition|Fraîcheur|Zone grise|Zone optimale|Risque élevé/);
  const slider = fitness.getByRole("slider", { name: "Condition physique jour par jour" });
  await slider.focus();
  await page.keyboard.press("End");
  await expect(slider).toHaveAttribute("aria-valuetext", /prévision/);
  await fitness.getByText("Comment c’est calculé").click();
  await expect(fitness).toContainText("Une heure au seuil vaut 100.");
});

test("le coach consulte la progression de son athlète", async ({ browser }) => {
  const { athlete } = accounts();
  const page = await signedIn(browser, "coach");
  await page.goto(`/coach/athletes/${athlete.id}`);
  await page.locator(`a[href="/coach/athletes/${athlete.id}/stats"]`).click();
  await expect(page).toHaveURL(new RegExp(`/coach/athletes/${athlete.id}/stats`));
  await expect(page.getByRole("heading", { name: "Volume par semaine" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Seuils" })).toBeVisible();
  await expect(page.getByText("FTP").first()).toBeVisible();
  await expect(page.getByRole("heading", { name: "Condition physique" })).toBeVisible();
});
