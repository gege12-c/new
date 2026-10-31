/**
 * Agenda du téléphone : l'athlète crée son adresse d'abonnement, l'agenda y lit ses séances publiées
 * (format iCalendar, sans compte), puis l'adresse retirée ne donne plus rien.
 */
import { expect, test } from "@playwright/test";
import { accounts, isoDay, signedIn, takeHydrationErrors } from "./fixtures";

test.describe.configure({ mode: "serial" });
test.afterEach(() => expect(takeHydrationErrors()).toEqual([]));

test("l'agenda du téléphone reçoit les séances publiées, jusqu'au retrait de l'adresse", async ({ browser, request }) => {
  test.skip(!process.env.SUPABASE_SECRET_KEY && !process.env.SUPABASE_SERVICE_ROLE_KEY, "Clé de service absente.");
  const { athlete } = accounts();
  const serviceKey = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
  const title = `Agenda e2e ${Date.now()}`;
  const date = isoDay(4);
  const response = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/planned_sessions`, {
    method: "POST",
    headers: { apikey: serviceKey!, authorization: `Bearer ${serviceKey}`, "content-type": "application/json" },
    body: JSON.stringify({
      athlete_id: athlete.id,
      scheduled_date: date,
      start_time: "18:30",
      sport: "run",
      title,
      state: "published",
      planned_duration_s: 2700,
      content: { schemaVersion: 1, segments: [{ id: "r", sport: "run", steps: [{ kind: "step", id: "a", type: "active", length: { unit: "time", seconds: 2700 } }] }] },
    }),
  });
  expect(response.ok).toBe(true);

  const page = await signedIn(browser, "athlete");
  await page.goto("/athlete/profile#agenda");
  const panel = page.locator("#agenda");
  await expect(panel.getByRole("heading", { name: "Agenda du téléphone" })).toBeVisible();
  // Adresse laissée par un passage précédent : on la remplace.
  if (await panel.getByRole("button", { name: "Nouvelle adresse" }).isVisible()) {
    await panel.getByRole("button", { name: "Nouvelle adresse" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Remplacer" }).click();
  } else {
    await panel.getByRole("button", { name: "Créer l’adresse de mon agenda" }).click();
  }
  const address = panel.getByLabel("Adresse d’abonnement de l’agenda");
  await expect(address).toHaveValue(/\/api\/calendar\/[0-9a-f]{64}\.ics$/);
  const url = await address.inputValue();
  await expect(panel.getByRole("link", { name: /S’abonner/ })).toHaveAttribute("href", /^webcal:/);

  const ics = await request.get(url);
  expect(ics.status()).toBe(200);
  expect(ics.headers()["content-type"]).toContain("text/calendar");
  const body = (await ics.text()).replace(/\r\n /g, "");
  expect(body).toContain("BEGIN:VCALENDAR");
  expect(body).toContain(`SUMMARY:Course à pied : ${title}`);
  expect(body).toContain(`DTSTART:${date.replace(/-/g, "")}T`);

  await panel.getByRole("button", { name: "Retirer" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Retirer" }).click();
  await expect(panel.getByText(/Adresse retirée/)).toBeVisible();
  expect((await request.get(url)).status()).toBe(404);
  await page.context().close();
});
