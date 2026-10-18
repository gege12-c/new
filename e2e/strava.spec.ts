/**
 * Phase 3, de bout en bout, contre un faux Strava (données fictives) : connexion OAuth, webhook,
 * dédoublonnage, rapprochement à la bonne séance, confidentialité vis-à-vis du coach, retour de
 * l'athlète et import d'un fichier FIT.
 */
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { buildActivityFit } from "../tests/fixtures/fit-files";
import { accounts, isoDay, signedIn, takeHydrationErrors } from "./fixtures";
import { FAKE_STRAVA_URL } from "./global-setup";

test.describe.configure({ mode: "serial" });
test.afterEach(() => expect(takeHydrationErrors()).toEqual([]));

const serviceKey = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
const configured = process.env.STRAVA_CLIENT_ID === "4242" && Boolean(serviceKey);
test.skip(!configured, "Application non reliée au faux Strava (STRAVA_CLIENT_ID=4242, voir README).");

const realtime = process.env.E2E_REALTIME === "1";
const stravaId = 600_000_000 + Math.floor(Math.random() * 99_999_999);
let subscriptionId = 0;

async function control(name: string, payload: unknown) {
  const response = await fetch(`${FAKE_STRAVA_URL}/__control/${name}`, { method: "POST", body: JSON.stringify(payload) });
  return (await response.json()) as { subscriptions: { id: number; callback_url: string }[] };
}

async function rest(pathName: string, init: RequestInit = {}) {
  const response = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/${pathName}`, {
    ...init,
    headers: { apikey: serviceKey!, authorization: `Bearer ${serviceKey}`, "content-type": "application/json", prefer: "return=representation", ...(init.headers ?? {}) },
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`${pathName} → ${response.status} ${text}`);
  return text ? JSON.parse(text) : null;
}

/** Décalage (en heures) de Paris par rapport à UTC à la date donnée. */
function parisOffset(iso: string): number {
  const name = new Intl.DateTimeFormat("en-US", { timeZone: "Europe/Paris", timeZoneName: "shortOffset" })
    .formatToParts(new Date(`${iso}T12:00:00Z`))
    .find((p) => p.type === "timeZoneName")?.value;
  return Number(name?.replace("GMT", "") || 0);
}

/** Course : 10 min d'échauffement, le corps de séance, 10 min de retour au calme (format interne complet). */
const runContent = (seconds: number) => ({
  schemaVersion: 1,
  segments: [
    {
      id: "seg-run",
      sport: "run",
      steps: [
        { kind: "step", id: "wu", type: "warmup", length: { unit: "time", seconds: 600 }, targets: [{ metric: "rpe", unit: "scale", min: 3, max: 4 }] },
        { kind: "step", id: "main", type: "active", length: { unit: "time", seconds: seconds - 1200 }, targets: [{ metric: "rpe", unit: "scale", min: 6, max: 7 }] },
        { kind: "step", id: "cd", type: "cooldown", length: { unit: "time", seconds: 600 }, targets: [] },
      ],
    },
  ],
});

async function insertRun(date: string, time: string, minutes: number, title: string): Promise<string> {
  const { athlete } = accounts();
  const [row] = await rest("planned_sessions", {
    method: "POST",
    body: JSON.stringify({ athlete_id: athlete.id, scheduled_date: date, start_time: time, sport: "run", title, content: runContent(minutes * 60), state: "published", planned_duration_s: minutes * 60 }),
  });
  return row.id;
}

/**
 * Attend le résultat d'un traitement en tâche de fond. Avec le temps réel, la page se met à jour
 * seule ; sinon (ou si le signal tarde), on recharge. Le temps réel est vérifié par planning.spec.
 */
async function eventually(page: Page, check: () => Promise<void>) {
  if (realtime) {
    const live = await check().then(
      () => true,
      () => false,
    );
    if (live) return;
  }
  await expect(async () => {
    await page.reload();
    await check();
  }).toPass({ timeout: 25_000, intervals: [1000, 2000] });
}

test("un administrateur active la réception des activités Strava", async ({ browser }) => {
  const coach = await signedIn(browser, "coach");
  await coach.goto("/admin");
  await expect(coach.getByRole("heading", { name: "Administration" })).toBeVisible();
  await expect(coach.getByText("(manquant)")).toHaveCount(0);
  // Selon l'état laissé par une exécution précédente, l'un ou l'autre bouton s'affiche.
  await expect(coach.getByRole("button", { name: /^(Activer la réception des activités|Désactiver la réception)$/ })).toBeVisible();
  const disable = coach.getByRole("button", { name: "Désactiver la réception" });
  if (await disable.isVisible()) {
    await disable.click();
    await expect(coach.getByText("Réception des activités désactivée.")).toBeVisible();
  }
  await coach.getByRole("button", { name: "Activer la réception des activités" }).click();
  await expect(coach.getByText(/Réception des activités activée/)).toBeVisible();
  const { subscriptions } = await control("authorize-as", { athleteId: stravaId });
  expect(subscriptions).toHaveLength(1);
  expect(subscriptions[0].callback_url).toMatch(/\/api\/strava\/webhook$/);
  subscriptionId = subscriptions[0].id;
});

test("une activité Strava arrive par webhook, sans doublon, rattachée à la bonne séance", async ({ browser, request }) => {
  expect(subscriptionId).toBeGreaterThan(0);
  const today = isoDay(0);
  const stamp = Date.now();
  await insertRun(today, "07:00", 45, `Footing matin ${stamp}`);
  const evening = await insertRun(today, "18:30", 60, `Seuil soir ${stamp}`);

  // Connexion OAuth (le faux Strava autorise aussitôt l'athlète désigné).
  const athlete = await signedIn(browser, "athlete");
  await athlete.goto("/athlete/profile");
  // Nouvel essai après un échec : l'athlète est peut-être déjà relié, on repart de zéro.
  await expect(athlete.getByRole("link", { name: "Connecter Strava" }).or(athlete.getByRole("button", { name: "Déconnecter Strava" }))).toBeVisible();
  if (await athlete.getByRole("button", { name: "Déconnecter Strava" }).isVisible()) {
    await athlete.getByRole("button", { name: "Déconnecter Strava" }).click();
    await athlete.getByRole("dialog").getByRole("button", { name: "Déconnecter" }).click();
    await expect(athlete.getByRole("link", { name: "Connecter Strava" })).toBeVisible();
  }
  await athlete.getByRole("link", { name: "Connecter Strava" }).click();
  await expect(athlete).toHaveURL(/strava=connected/);
  await expect(athlete.getByText(/Strava est connecté/)).toBeVisible();
  await expect(athlete.getByRole("button", { name: "Synchroniser maintenant" })).toBeVisible();

  await athlete.goto(`/athlete/calendar?view=day&date=${today}`);
  await expect(athlete.getByText(`Seuil soir ${stamp}`)).toBeVisible();
  if (realtime) await expect(athlete.getByText("En direct")).toBeVisible({ timeout: 15_000 });

  // Course de 58 minutes à 18 h 05, heure de Paris.
  const activityId = 17_000_000_000 + (stamp % 1_000_000_000);
  const offset = parisOffset(today);
  const start = new Date(`${today}T18:05:00Z`).getTime() - offset * 3600_000;
  const local = new Date(`${today}T18:05:00Z`).toISOString().replace(/\.\d{3}Z$/, "Z");
  await control("activity", {
    athleteId: stravaId,
    activity: {
      id: activityId,
      name: "Seuil au parc",
      sport_type: "Run",
      start_date: new Date(start).toISOString().replace(/\.\d{3}Z$/, "Z"),
      start_date_local: local,
      timezone: `(GMT+0${offset}:00) Europe/Paris`,
      elapsed_time: 3600,
      moving_time: 3480,
      distance: 11_400,
      average_heartrate: 152,
    },
  });
  const event = { object_type: "activity", object_id: activityId, aspect_type: "create", owner_id: stravaId, subscription_id: subscriptionId, event_time: Math.floor(stamp / 1000), updates: {} };
  // Strava renvoie l'évènement s'il n'a pas eu de réponse à temps : deux envois, une activité.
  expect((await request.post("/api/strava/webhook", { data: event })).status()).toBe(200);
  expect((await request.post("/api/strava/webhook", { data: event })).status()).toBe(200);

  // Rattachée à la séance du soir, pas à celle du matin.
  const chip = athlete.getByRole("link", { name: new RegExp(`Seuil soir ${stamp}, terminée`) });
  await eventually(athlete, () => expect(chip).toBeVisible({ timeout: realtime ? 8_000 : 2_000 }));
  await expect(chip).toContainText("Réalisé 58 min (97 %)");
  await expect(athlete.getByRole("link", { name: new RegExp(`Footing matin ${stamp}`) })).not.toContainText("Réalisé");

  const rows = await rest(`activities?external_id=eq.${activityId}&select=id`);
  expect(rows).toHaveLength(1);
  const [match] = await rest(`session_activity_matches?activity_id=eq.${rows[0].id}&select=session_id,status`);
  expect(match).toEqual({ session_id: evening, status: "auto" });

  await chip.click();
  const panel = athlete.getByRole("complementary", { name: `Seuil soir ${stamp}` });
  await expect(panel.getByRole("link", { name: /View on Strava/ })).toHaveCount(1);
  await expect(panel.getByText("Seuil au parc")).toBeVisible();
  await expect(panel.getByText(/Réalisé à/)).toContainText("97");

  // Le coach ne voit pas l'activité Strava : il attend le retour de l'athlète.
  const { athlete: who } = accounts();
  const coach = await signedIn(browser, "coach");
  await coach.goto(`/coach/athletes/${who.id}?view=day&date=${today}&session=${evening}`);
  const coachPanel = coach.getByRole("complementary", { name: `Seuil soir ${stamp}` });
  await expect(coachPanel.getByText("Pas encore de retour de l’athlète sur cette séance.")).toBeVisible();
  await expect(coach.getByText("Seuil au parc")).toHaveCount(0);
  await expect(coach.getByRole("link", { name: /View on Strava/ })).toHaveCount(0);

  // Retour de l'athlète : visible du coach.
  await panel.getByText("Faite", { exact: true }).click();
  await panel.getByText("6", { exact: true }).click();
  await panel.getByLabel(/Note pour votre coach/).fill("Bonnes jambes");
  await panel.getByRole("button", { name: "Enregistrer", exact: true }).click();
  await expect(panel.getByText("Enregistré : votre coach voit votre retour.")).toBeVisible();
  await coach.reload();
  await expect(coachPanel.getByText(/Retour de l’athlète : Faite/)).toContainText("RPE 6/10");
  await expect(coachPanel.getByText("Bonnes jambes")).toBeVisible();
});

test("un fichier FIT importé par l'athlète est visible de son coach", async ({ browser }) => {
  const day = isoDay(-1);
  const start = new Date(`${day}T08:00:00Z`);
  start.setUTCSeconds(Math.floor(Math.random() * 3000));
  const file = path.join(mkdtempSync(path.join(tmpdir(), "tricoach-fit-")), "sortie-e2e.fit");
  writeFileSync(file, buildActivityFit({ start, utcOffsetS: parisOffset(day) * 3600, sessions: [{ sport: "cycling", subSport: "road", durationS: 5400, distanceM: 45_000, avgPower: 190 }] }));

  const athlete = await signedIn(browser, "athlete");
  await athlete.goto("/athlete/profile#connexions");
  await expect(athlete.locator('input[type="file"]')).toBeEnabled();
  await athlete.locator('input[type="file"]').setInputFiles(file);
  // Le message affiché (succès ou erreur) apparaît dans l'échec éventuel du test.
  await expect(athlete.locator('ul[aria-live="polite"] li').first()).toContainText("1 activité importée", { timeout: 20_000 });

  const { athlete: who } = accounts();
  const coach = await signedIn(browser, "coach");
  await coach.goto(`/coach/athletes/${who.id}?view=day&date=${day}`);
  const chip = coach.getByRole("link", { name: /Sortie à vélo, activité réalisée/ }).first();
  await expect(chip).toBeVisible();
  await chip.click();
  await expect(coach.getByRole("complementary", { name: "Sortie à vélo" }).getByText("Fichier FIT")).toBeVisible();
  await expect(coach.getByRole("complementary", { name: "Sortie à vélo" }).getByText("190 W")).toBeVisible();
});
