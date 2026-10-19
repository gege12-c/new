/**
 * Phase 4, de bout en bout : une même séance produit un .zwo et un FIT valides, téléchargés depuis
 * la fiche de séance de l'athlète, relus avec le SDK FIT officiel, et inscrits à l'historique
 * que le coach consulte. Les cas impossibles sont annoncés, jamais simulés.
 */
import { readFileSync } from "node:fs";
import { Decoder, Stream } from "@garmin/fitsdk";
import { expect, test, type Page } from "@playwright/test";
import { accounts, isoDay, signedIn, takeHydrationErrors } from "./fixtures";

test.describe.configure({ mode: "serial" });
test.afterEach(() => expect(takeHydrationErrors()).toEqual([]));

const day = isoDay(2);
const title = `Enchaînement export ${Date.now()}`;
let sessionId = "";

/** Vélo en % FTP (Zwift et Garmin), puis course en allure absolue : sans allure seuil, Zwift ne peut pas la suivre. */
const brickContent = {
  schemaVersion: 1,
  segments: [
    {
      id: "bike",
      sport: "bike",
      steps: [
        { kind: "step", id: "wu", type: "warmup", length: { unit: "time", seconds: 600 }, targets: [{ metric: "power", unit: "percent_ftp", min: 55, max: 70 }] },
        {
          kind: "repeat",
          id: "main",
          count: 3,
          steps: [
            { kind: "step", id: "on", type: "active", length: { unit: "time", seconds: 300 }, targets: [{ metric: "power", unit: "percent_ftp", min: 105, max: 110 }] },
            { kind: "step", id: "off", type: "recovery", length: { unit: "time", seconds: 180 }, targets: [{ metric: "power", unit: "percent_ftp", min: 50, max: 55 }] },
          ],
        },
        { kind: "step", id: "cd", type: "cooldown", length: { unit: "time", seconds: 600 }, targets: [{ metric: "power", unit: "percent_ftp", min: 50, max: 60 }] },
      ],
    },
    {
      id: "run",
      sport: "run",
      steps: [
        { kind: "step", id: "t2", type: "transition", length: { unit: "time", seconds: 120 } },
        { kind: "step", id: "r", type: "active", length: { unit: "time", seconds: 1200 }, targets: [{ metric: "pace", unit: "sec_per_km", min: 270, max: 285 }] },
      ],
    },
  ],
};

test.beforeAll(async () => {
  // Le coach programme la séance par l'API, sous ses propres droits (RLS).
  const { coach, athlete } = accounts() as ReturnType<typeof accounts> & { coach: { token: string } };
  const response = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/planned_sessions`, {
    method: "POST",
    headers: {
      apikey: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
      authorization: `Bearer ${coach.token}`,
      "content-type": "application/json",
      prefer: "return=representation",
    },
    body: JSON.stringify({ athlete_id: athlete.id, scheduled_date: day, start_time: "09:00", sport: "brick", title, content: brickContent, state: "published", planned_duration_s: 4806 }),
  });
  if (!response.ok) throw new Error(`planned_sessions → ${response.status} ${await response.text()}`);
  sessionId = (await response.json())[0].id;
});

async function downloadFrom(page: Page, provider: "zwift" | "garmin", button: string) {
  const row = page.locator(`[data-export-provider="${provider}"]`);
  const [download] = await Promise.all([page.waitForEvent("download"), row.getByRole("button", { name: new RegExp(button) }).click()]);
  const file = await download.path();
  return { name: download.suggestedFilename(), bytes: readFileSync(file!) };
}

test("l'athlète télécharge un .zwo et un FIT valides de la même séance", async ({ browser }) => {
  const page = await signedIn(browser, "athlete");
  await page.goto(`/athlete/calendar?view=week&date=${day}&session=${sessionId}`);
  await expect(page.getByRole("heading", { name: "Exporter vers mes appareils" })).toBeVisible();

  const zwift = page.locator('[data-export-provider="zwift"]');
  // Contrôle de compatibilité affiché avant tout téléchargement.
  await expect(zwift.locator("[data-compatibility]")).toContainText("Course à pied : export impossible");
  await expect(zwift.getByRole("button", { name: /partie course à pied/ })).toBeDisabled();
  await zwift.locator("[data-compatibility] summary").click();
  await expect(zwift).toContainText("enregistrez l'allure seuil");

  const zwo = await downloadFrom(page, "zwift", "partie vélo");
  expect(zwo.name).toMatch(/^Enchainement-export-\d+-1-bike\.zwo$/);
  const xml = zwo.bytes.toString("utf8");
  expect(xml).toContain("<sportType>bike</sportType>");
  expect(xml).toMatch(/<IntervalsT Repeat="3" OnDuration="300" OffDuration="180" OnPower="1.075" OffPower="0.525"/);
  await expect(zwift.getByRole("status")).toContainText(`Fichier téléchargé (vélo) : ${zwo.name}`);

  const fit = await downloadFrom(page, "garmin", "partie course à pied");
  expect(fit.name).toMatch(/-2-run\.fit$/);
  const { messages, errors } = new Decoder(Stream.fromByteArray(Array.from(fit.bytes))).read();
  expect(errors).toEqual([]);
  expect(messages.fileIdMesgs?.[0].type).toBe("workout");
  expect(messages.workoutMesgs?.[0]).toMatchObject({ sport: "running", numValidSteps: 2 });
  // 4:30–4:45 /km : 3,51 à 3,70 m/s.
  expect(messages.workoutStepMesgs?.[1]).toMatchObject({ durationTime: 1200, targetType: "speed", customTargetSpeedLow: 3.509, customTargetSpeedHigh: 3.704 });

  await expect(page.getByText(/Exports précédents/)).toContainText("(2)");
});

test("le coach voit l'historique des exports de son athlète", async ({ browser }) => {
  const { athlete } = accounts();
  const page = await signedIn(browser, "coach");
  await page.goto(`/coach/athletes/${athlete.id}?view=week&date=${day}&session=${sessionId}`);
  await page.getByText(/Exports précédents/).click();
  await expect(page.getByText(/Garmin · partie 2 — .*, par Athlete E2E/)).toBeVisible();
  await expect(page.getByText(/Zwift · partie 1 — .*, par Athlete E2E/)).toBeVisible();
});

test("l'API d'export vérifie la session, la demande et les droits", async ({ browser, playwright }) => {
  const anonymous = await playwright.request.newContext({ baseURL: test.info().project.use.baseURL });
  expect((await anonymous.get(`/api/exports/${sessionId}?provider=garmin`)).status()).toBe(401);
  await anonymous.dispose();

  const page = await signedIn(browser, "athlete");
  expect((await page.request.get(`/api/exports/${sessionId}?provider=strava`)).status()).toBe(400);
  expect((await page.request.get(`/api/exports/00000000-0000-4000-8000-000000000000?provider=garmin`)).status()).toBe(404);
  const blocked = await page.request.get(`/api/exports/${sessionId}?provider=zwift&segment=1`);
  expect(blocked.status()).toBe(422);
  expect((await blocked.json()).error).toMatch(/allure seuil/);
});
