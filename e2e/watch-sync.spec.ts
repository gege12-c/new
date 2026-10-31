/**
 * Séances sur la montre par intervals.icu, de bout en bout, contre un faux intervals.icu (données
 * fictives) : l'athlète colle sa clé dans son profil (refusée, puis acceptée), une séance publiée
 * part dans son calendrier intervals.icu et la fiche de la séance le dit, puis la déliaison retire
 * les séances déposées. L'envoi direct vers Suunto, lui, attend l'accès partenaire.
 */
import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { accounts, addDays, isoDay, signedIn, takeHydrationErrors } from "./fixtures";
import { FAKE_INTERVALS_URL } from "./global-setup";

test.describe.configure({ mode: "serial" });
test.afterEach(() => expect(takeHydrationErrors()).toEqual([]));

const configured = process.env.INTERVALS_API_BASE_URL === FAKE_INTERVALS_URL;
test.skip(!configured, `Application non reliée au faux intervals.icu (INTERVALS_API_BASE_URL=${FAKE_INTERVALS_URL}, voir README).`);

const intervalsAthlete = `i${Math.floor(Math.random() * 1e7)}`;
const key = `e2e${randomUUID().replace(/-/g, "")}`;

async function control(name: string, payload: unknown) {
  const response = await fetch(`${FAKE_INTERVALS_URL}/__control/${name}`, { method: "POST", body: JSON.stringify(payload) });
  return (await response.json()) as { events: { name: string; external_id: string; description: string; type: string }[] };
}

async function publishSession(date: string, title: string) {
  const { athlete } = accounts();
  const serviceKey = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
  const response = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/planned_sessions`, {
    method: "POST",
    headers: { apikey: serviceKey!, authorization: `Bearer ${serviceKey}`, "content-type": "application/json", prefer: "return=representation" },
    body: JSON.stringify({
      athlete_id: athlete.id,
      scheduled_date: date,
      sport: "bike",
      title,
      state: "published",
      content: {
        schemaVersion: 1,
        segments: [
          {
            id: "bike",
            sport: "bike",
            steps: [
              { kind: "step", id: "wu", type: "warmup", length: { unit: "time", seconds: 600 } },
              { kind: "step", id: "on", type: "active", length: { unit: "time", seconds: 1200 }, targets: [{ metric: "power", unit: "percent_ftp", min: 88, max: 92 }] },
            ],
          },
        ],
      },
    }),
  });
  if (!response.ok) throw new Error(`séance de test : ${response.status} ${await response.text()}`);
  return (await response.json())[0].id as string;
}

test("relier sa montre par intervals.icu : la séance publiée part, la fiche le dit, la déliaison la retire", async ({ browser }) => {
  test.skip(!process.env.SUPABASE_SECRET_KEY && !process.env.SUPABASE_SERVICE_ROLE_KEY, "Clé de service absente.");
  const date = addDays(isoDay(0), 2);
  const title = `Sweet spot ${Date.now()}`;
  const sessionId = await publishSession(date, title);

  const page = await signedIn(browser, "athlete");
  await page.goto("/athlete/profile#montre-auto");
  const panel = page.locator("#montre-auto");
  await expect(panel.getByRole("heading", { name: "Suunto, Garmin, COROS, par intervals.icu" })).toBeVisible();
  await expect(panel.getByText("Non relié", { exact: true })).toBeVisible();
  // Suunto en direct attend l'accès partenaire : rien à relier pour l'instant.
  await expect(panel.getByText("Bientôt", { exact: true })).toBeVisible();

  // Clé refusée par intervals.icu : rien n'est enregistré.
  await panel.getByLabel("Clé API intervals.icu").fill("cle-inconnue-0000");
  await panel.getByRole("button", { name: "Relier intervals.icu" }).click();
  await expect(panel.getByText(/intervals\.icu refuse cette clé/)).toBeVisible();

  // Clé valable : vérifiée, gardée chiffrée, puis les séances à venir partent seules.
  await control("key", { key, athlete: intervalsAthlete });
  await panel.getByLabel("Clé API intervals.icu").fill(key);
  await panel.getByRole("button", { name: "Relier intervals.icu" }).click();
  // La page se met à jour : le formulaire laisse place au compte relié.
  await expect(panel.getByText(`Relié au compte ${intervalsAthlete}`, { exact: false })).toBeVisible();
  await expect
    .poll(async () => (await control("list", { athlete: intervalsAthlete })).events.map((e) => e.name), { timeout: 20_000 })
    .toContain(title);
  const sent = (await control("list", { athlete: intervalsAthlete })).events.find((e) => e.name === title)!;
  expect(sent).toMatchObject({ type: "Ride", external_id: `tricoach-${sessionId}-0` });
  // 88–92 % de la FTP enregistrée (250 W) : watts absolus.
  expect(sent.description).toContain("- Travail 20m 220-230w");

  // La fiche de la séance dit où elle en est.
  await page.goto(`/athlete/calendar?view=day&date=${date}&session=${sessionId}`);
  const watch = page.locator('[data-export-provider="watch"]');
  await expect(watch.getByText(/Déposée dans votre calendrier intervals\.icu/)).toBeVisible();
  await expect(watch.getByText(/séance complète, sans perte/i)).toBeVisible();

  // Déliaison : les séances à venir quittent le calendrier intervals.icu, la clé est effacée.
  await page.goto("/athlete/profile#montre-auto");
  await panel.getByRole("button", { name: "Délier intervals.icu" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Délier" }).click();
  await expect(panel.getByText(/intervals\.icu est délié/)).toBeVisible();
  expect((await control("list", { athlete: intervalsAthlete })).events).toEqual([]);
  await page.reload();
  await expect(panel.getByText("Non relié", { exact: true })).toBeVisible();
  await page.context().close();
});
