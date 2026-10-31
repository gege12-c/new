/**
 * Semaine de tous les athlètes du coach : séances du jour (publiée et brouillon), jour indisponible,
 * ouverture d'une séance dans le calendrier de l'athlète, semaine suivante.
 */
import { expect, test } from "@playwright/test";
import { accounts, isoDay, signedIn, takeHydrationErrors } from "./fixtures";

test.afterEach(() => expect(takeHydrationErrors()).toEqual([]));

type WithToken = { id: string; token: string; name: string };

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

const workout = (sport: "bike" | "run") => ({
  schemaVersion: 1,
  segments: [{ id: sport, sport, steps: [{ kind: "step", id: "a", type: "active", length: { unit: "time", seconds: 1800 } }] }],
});

test("le coach voit la semaine de tous ses athlètes, jour par jour", async ({ browser }) => {
  const { coach, athlete } = accounts() as unknown as { coach: WithToken; athlete: WithToken };
  const today = isoDay(0);
  const stamp = Date.now();
  const title = `Vue semaine ${stamp}`;
  const [session] = await rest(coach.token, "planned_sessions", {
    athlete_id: athlete.id,
    scheduled_date: today,
    sport: "bike",
    title,
    content: workout("bike"),
    state: "published",
    planned_duration_s: 1800,
  });
  await rest(coach.token, "planned_sessions", {
    athlete_id: athlete.id,
    scheduled_date: today,
    sport: "run",
    title: `Brouillon ${stamp}`,
    content: workout("run"),
    state: "draft",
    planned_duration_s: 1800,
  });
  await rest(athlete.token, "calendar_notes", { athlete_id: athlete.id, kind: "travel", start_date: today, end_date: today, title: `Rotation ${stamp}` });

  const page = await signedIn(browser, "coach");
  await page.goto("/coach");
  await page.getByRole("link", { name: "Semaine de mes athlètes" }).click();
  await expect(page).toHaveURL(/\/coach\/week$/);
  await expect(page.getByRole("heading", { level: 1, name: "Semaine de mes athlètes" })).toBeVisible();

  await expect(page.getByRole("rowheader", { name: athlete.name })).toBeVisible();
  await expect(page.getByRole("link", { name: `${title}, à faire` })).toBeVisible();
  await expect(page.getByRole("link", { name: `Brouillon ${stamp}, brouillon` })).toBeVisible();
  await expect(page.getByText(`Déplacement : Rotation ${stamp}`)).toBeVisible();
  await expect(page.getByText(/^\d+ brouillons?$/).first()).toBeVisible();

  // La séance s'ouvre dans le calendrier de l'athlète, sur le bon jour.
  await page.getByRole("link", { name: `${title}, à faire` }).click();
  await expect(page).toHaveURL(new RegExp(`/coach/athletes/${athlete.id}\\?view=week&date=${today}&session=${session.id}`));
  await expect(page.getByRole("complementary", { name: title })).toBeVisible();

  // Semaine suivante : la séance de cette semaine n'y est plus.
  await page.goto("/coach/week");
  await page.getByRole("link", { name: "Semaine suivante" }).click();
  await expect(page).toHaveURL(/\/coach\/week\?week=\d{4}-\d{2}-\d{2}$/);
  await expect(page.getByRole("rowheader", { name: athlete.name })).toBeVisible();
  await expect(page.getByRole("link", { name: new RegExp(`^${title}`) })).toHaveCount(0);
  await page.context().close();
});
