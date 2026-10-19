/**
 * Phase 5 : notifications sobres et réglables. Le coach publie une séance : l'athlète est prévenu
 * (cloche), ouvre la séance depuis la notification ; un commentaire prévient le coach ; un type
 * coupé dans les réglages ne prévient plus.
 */
import { expect, test, type Page } from "@playwright/test";
import { accounts, isoDay, signedIn, takeHydrationErrors } from "./fixtures";

test.describe.configure({ mode: "serial" });
test.afterEach(() => expect(takeHydrationErrors()).toEqual([]));

type WithToken = { id: string; token: string };
const day = isoDay(3);
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

async function publish(title: string) {
  const { coach, athlete } = accounts() as unknown as { coach: WithToken; athlete: WithToken };
  const content = {
    schemaVersion: 1,
    segments: [{ id: "run", sport: "run", steps: [{ kind: "step", id: "a", type: "active", length: { unit: "time", seconds: 2400 }, targets: [{ metric: "rpe", unit: "scale", min: 3, max: 4 }] }] }],
  };
  const [row] = await rest(coach.token, "planned_sessions", { athlete_id: athlete.id, scheduled_date: day, sport: "run", title, content, state: "published", planned_duration_s: 2400 });
  return row.id as string;
}

async function markAllRead(page: Page) {
  await page.goto("/notifications");
  // Attendre la liste (rendue en flux) avant de savoir s'il reste des non lues.
  await expect(page.getByText(/^\d+ non lues?$|^Tout est lu\.$|^Aucune notification$/).first()).toBeVisible();
  const button = page.getByRole("button", { name: "Tout marquer comme lu" });
  if (await button.isVisible()) {
    await button.click();
    await expect(page.getByText("Tout est lu.")).toBeVisible();
  }
}

test("l'athlète est prévenu d'une nouvelle séance et l'ouvre depuis la notification", async ({ browser }) => {
  const page = await signedIn(browser, "athlete");
  await markAllRead(page);
  const title = `Footing notif ${stamp}`;
  await publish(title);

  await page.goto("/athlete");
  const bell = page.getByRole("link", { name: /Notifications : 1 non lue/ }).first();
  await expect(bell).toBeVisible();
  await bell.click();
  const item = page.getByRole("link", { name: new RegExp(`Nouvelle séance : «\\s${title}\\s»`) });
  await expect(item).toBeVisible();
  await item.click();
  await expect(page).toHaveURL(/\/athlete\/calendar\?view=day/);
  await expect(page.getByRole("heading", { name: title, level: 2 })).toBeVisible();

  await page.goto("/notifications");
  await expect(page.getByText("Tout est lu.")).toBeVisible();
  await expect(page.getByRole("link", { name: "Notifications", exact: true }).first()).toBeVisible();
});

test("un commentaire de l'athlète prévient son coach", async ({ browser }) => {
  const { athlete } = accounts() as unknown as { athlete: WithToken };
  const coach = await signedIn(browser, "coach");
  await markAllRead(coach);
  const sessionId = await publish(`Séance commentée ${stamp}`);
  await rest(athlete.token, "session_comments", { session_id: sessionId, body: "Jambes lourdes aujourd’hui" });

  await coach.goto("/notifications");
  await expect(coach.getByRole("link", { name: /Athlete E2E a commenté «\sSéance commentée .*\s» : Jambes lourdes aujourd’hui/ })).toBeVisible();
});

test("un type coupé dans les réglages ne prévient plus", async ({ browser }) => {
  const page = await signedIn(browser, "athlete");
  await markAllRead(page);
  await page.goto("/settings");
  const box = page.getByRole("checkbox", { name: /Nouvelle séance publiée/ });
  await box.uncheck();
  const panel = page.locator("#notifications");
  await panel.getByRole("button", { name: "Enregistrer" }).click();
  await expect(panel.getByText("Réglages des notifications enregistrés.")).toBeVisible();

  await publish(`Silencieuse ${stamp}`);
  await page.goto("/notifications");
  await expect(page.getByRole("heading", { name: "Notifications", level: 1 })).toBeVisible();
  await expect(page.getByText(/Silencieuse/)).toHaveCount(0);
  await expect(page.getByRole("link", { name: /non lue/ })).toHaveCount(0);

  // Remise en état pour les autres parcours.
  await page.goto("/settings");
  await page.getByRole("checkbox", { name: /Nouvelle séance publiée/ }).check();
  await page.locator("#notifications").getByRole("button", { name: "Enregistrer" }).click();
  await expect(page.locator("#notifications").getByText("Réglages des notifications enregistrés.")).toBeVisible();
});

test("la tâche quotidienne envoie les rappels de séance sans retour, et seulement avec son secret", async ({ request }) => {
  expect((await request.get("/api/cron/daily")).status()).toBe(401);
  const secret = process.env.CRON_SECRET;
  test.skip(!secret, "CRON_SECRET absent de l'environnement de test.");
  const response = await request.get("/api/cron/daily", { headers: { authorization: `Bearer ${secret}` } });
  expect(response.status()).toBe(200);
  const body = await response.json();
  expect(body.status).toBe("ok");
  expect(typeof body.reminders).toBe("number");
});
