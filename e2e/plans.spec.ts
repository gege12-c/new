/**
 * Plans d'entraînement : le coach enregistre une semaine du calendrier d'un athlète en plan, le
 * retrouve dans sa bibliothèque et l'applique quelques semaines plus tard, en brouillon.
 */
import { expect, test } from "@playwright/test";
import { accounts, addDays, mondayIn, signedIn, takeHydrationErrors } from "./fixtures";

test.describe.configure({ mode: "serial" });
test.afterEach(() => expect(takeHydrationErrors()).toEqual([]));

test("une semaine enregistrée en plan, puis appliquée plus tard en brouillon", async ({ browser }) => {
  test.skip(!process.env.SUPABASE_SECRET_KEY && !process.env.SUPABASE_SERVICE_ROLE_KEY, "Clé de service absente.");
  const { athlete } = accounts();
  const serviceKey = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
  const source = mondayIn(6);
  const stamp = Date.now() % 100000;
  const title = `Bloc plan ${stamp}`;
  const insert = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/planned_sessions`, {
    method: "POST",
    headers: { apikey: serviceKey!, authorization: `Bearer ${serviceKey}`, "content-type": "application/json" },
    body: JSON.stringify({
      athlete_id: athlete.id,
      scheduled_date: addDays(source, 2),
      sport: "bike",
      title,
      state: "published",
      planned_duration_s: 3600,
      content: { schemaVersion: 1, segments: [{ id: "b", sport: "bike", steps: [{ kind: "step", id: "a", type: "active", length: { unit: "time", seconds: 3600 } }] }] },
    }),
  });
  expect(insert.ok).toBe(true);

  const coach = await signedIn(browser, "coach");
  await coach.goto(`/coach/athletes/${athlete.id}?view=week&date=${source}`);
  await coach.getByRole("button", { name: "Enregistrer en plan" }).click();
  const dialog = coach.getByRole("dialog");
  await dialog.getByLabel("Nom du plan").fill(`Plan ${stamp}`);
  await dialog.getByLabel("Nombre de semaines").selectOption("1");
  await dialog.getByRole("button", { name: "Enregistrer" }).click();
  await expect(dialog.getByText(`Plan « Plan ${stamp} » enregistré dans la bibliothèque.`)).toBeVisible();

  await coach.goto("/coach/library");
  const card = coach.locator("li", { hasText: `Plan ${stamp}` });
  await expect(card).toContainText("1 semaine, 1 séance");
  await card.getByRole("button", { name: "Appliquer à un athlète" }).click();
  const apply = coach.getByRole("dialog", { name: `Appliquer « Plan ${stamp} »` });
  const target = mondayIn(10);
  await apply.getByLabel("Premier lundi").fill(target);
  await apply.getByRole("button", { name: "Appliquer" }).click();
  await expect(apply.getByText(/1 séance ajoutée en brouillon pour/)).toBeVisible();

  await coach.goto(`/coach/athletes/${athlete.id}?view=week&date=${target}`);
  await expect(coach.getByText(title)).toBeVisible();
  await coach.context().close();
});
