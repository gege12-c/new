/**
 * Séances sur la montre par intervals.icu, de bout en bout, contre un faux intervals.icu (données
 * fictives) : l'athlète colle sa clé dans son profil (refusée, puis acceptée), une séance publiée
 * part dans son calendrier intervals.icu et la fiche de la séance le dit ; l'activité faite avec la
 * montre revient, rattachée à la séance de la veille, avec ses courbes et ses intervalles ; puis la
 * déliaison retire les séances déposées. L'envoi direct vers Suunto, lui, attend l'accès partenaire.
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
  return (await response.json()) as {
    events: { name: string; external_id: string; description: string; type: string }[];
    settings: { id: number; ftp: number | null; max_hr: number | null }[];
  };
}

async function publishSession(date: string, title: string, plannedSeconds?: number) {
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
      ...(plannedSeconds ? { planned_duration_s: plannedSeconds } : {}),
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

test("relier sa montre par intervals.icu : la séance publiée part, l'activité revient, la déliaison retire les séances", async ({ browser }) => {
  test.skip(!process.env.SUPABASE_SECRET_KEY && !process.env.SUPABASE_SERVICE_ROLE_KEY, "Clé de service absente.");
  const date = addDays(isoDay(0), 2);
  const title = `Sweet spot ${Date.now()}`;
  const sessionId = await publishSession(date, title);
  // Hier : une séance faite avec la montre, qu'intervals.icu a reçue de Suunto.
  const yesterday = addDays(isoDay(0), -1);
  const pastId = await publishSession(yesterday, `Endurance ${Date.now()}`, 1800);
  await control("activity", {
    athlete: intervalsAthlete,
    activity: {
      id: `i${Date.now()}`,
      start_date_local: `${yesterday}T07:00:00`,
      type: "Ride",
      name: "Sortie avec la montre",
      source: "SUUNTO",
      file_type: "fit",
      moving_time: 1790,
      elapsed_time: 1800,
      distance: 15_000,
      average_heartrate: 141,
      icu_average_watts: 201,
      _streams: [
        { type: "time", data: Array.from({ length: 1800 }, (_, t) => t) },
        { type: "watts", data: Array.from({ length: 1800 }, (_, t) => (t >= 600 && t < 1080 ? 260 : 180)) },
        { type: "heartrate", data: Array.from({ length: 1800 }, (_, t) => (t >= 600 && t < 1080 ? 158 : 138)) },
      ],
      _intervals: [{ type: "WORK", start_time: 600, end_time: 1080, elapsed_time: 480, average_watts: 260, average_heartrate: 158 }],
    },
  });

  const page = await signedIn(browser, "athlete");
  await page.goto("/athlete/profile#montre-auto");
  const panel = page.locator("#montre-auto");
  await expect(panel.getByRole("heading", { name: "Suunto, Garmin, COROS, Wahoo, par intervals.icu" })).toBeVisible();
  await expect(panel.getByText("Non relié", { exact: true })).toBeVisible();
  // Suunto en direct attend l'accès partenaire : rien à relier pour l'instant.
  await expect(panel.getByText("Bientôt", { exact: true })).toBeVisible();

  // « Relier intervals.icu » (Autoriser) en premier ; la clé API reste possible, repliée.
  await expect(panel.getByRole("link", { name: "Relier intervals.icu" })).toBeVisible();
  await panel.getByText("Ou avec une clé API").click();
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

  // Seuils côte à côte : TriCoach fait référence, intervals.icu s'aligne d'un geste (FTP 250 W contre 230 W).
  await panel.getByRole("button", { name: "Comparer avec intervals.icu" }).click();
  const ftpLine = panel.locator('[data-threshold-line="Ride.ftp"]');
  await expect(ftpLine).toContainText("250 W");
  await expect(ftpLine).toContainText("230 W");
  await panel.getByRole("button", { name: "Envoyer mes seuils à intervals.icu (1)" }).click();
  await expect(panel.getByText("intervals.icu a maintenant les mêmes seuils que TriCoach.")).toBeVisible();
  expect((await control("list", { athlete: intervalsAthlete })).settings.find((s) => s.id === 101)?.ftp).toBe(250);
  // Une valeur d'intervals.icu reprise dans TriCoach, à partir d'aujourd'hui (puis retirée : compte de test partagé).
  await panel.getByRole("button", { name: "FC max, course : reprendre la valeur d’intervals.icu dans TriCoach" }).click();
  await expect(panel.getByText("FC max, course : la valeur d’intervals.icu est reprise dans TriCoach, à partir d’aujourd’hui.")).toBeVisible();
  await expect(page.locator("#seuils")).toContainText("195 bpm");
  const serviceKey = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY!;
  const removed = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/athlete_thresholds?athlete_id=eq.${accounts().athlete.id}&metric=eq.max_hr_bpm`, {
    method: "DELETE",
    headers: { apikey: serviceKey, authorization: `Bearer ${serviceKey}` },
  });
  expect(removed.ok).toBe(true);
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

  // L'activité faite avec la montre est revenue, rattachée à la séance d'hier.
  await page.goto(`/athlete/calendar?view=day&date=${yesterday}&session=${pastId}`);
  await expect(page.getByText("Montre, via intervals.icu").first()).toBeVisible();
  await expect(page.getByRole("link", { name: /Voir sur intervals\.icu/ }).first()).toBeVisible();
  // Ses courbes, ses intervalles détectés et ses meilleures puissances.
  const curves = page.getByRole("group", { name: "Courbes affichées" });
  await expect(curves.getByRole("button", { name: "Puissance" })).toHaveAttribute("aria-pressed", "true");
  await curves.getByRole("button", { name: "Fréquence cardiaque" }).click();
  await expect(curves.getByRole("button", { name: "Fréquence cardiaque" })).toHaveAttribute("aria-pressed", "false");
  const reader = page.getByRole("slider", { name: /Courbes de l’activité/ });
  await reader.focus();
  await reader.press("End");
  await expect(reader).toHaveAttribute("aria-valuetext", /29:5\d : puissance 180 W/);
  await expect(page.getByText("Intervalles détectés par intervals.icu (1 effort)")).toBeVisible();
  // L'effort prévu (20 min à 88–92 % de la FTP, 220–230 W) retrouvé sur les courbes après les 10 min
  // d'échauffement : 8 min à 260 W puis 12 min à 180 W, soit 212 W de moyenne, en dessous.
  const efforts = page.getByRole("region", { name: "Prévu et réalisé, étape par étape" });
  await expect(efforts.getByText("0 étape sur 1 dans la cible, à 2 % près.")).toBeVisible();
  await expect(efforts.getByRole("row", { name: /Effort 1/ })).toContainText(/20 min, 220–230 W.*20 min, 212 W.*en dessous/);
  // L'intervalle détecté par intervals.icu reste listé tel quel.
  await expect(page.getByRole("row", { name: /^Effort 1 10:00/ })).toContainText("260 W");
  await expect(page.getByText("Meilleures puissances de la séance")).toBeVisible();

  // Déliaison : les séances à venir quittent le calendrier intervals.icu, la clé est effacée.
  await page.goto("/athlete/profile#montre-auto");
  await panel.getByRole("button", { name: "Délier intervals.icu" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Délier" }).click();
  // La page se met à jour : le compte relié laisse place au formulaire de clé.
  await expect(panel.getByText("Non relié", { exact: true })).toBeVisible();
  expect((await control("list", { athlete: intervalsAthlete })).events).toEqual([]);
  await page.reload();
  await expect(panel.getByText("Non relié", { exact: true })).toBeVisible();
  await page.context().close();
});

test("relier intervals.icu par « Autoriser » : retour sur le profil, relié, puis délié", async ({ browser }) => {
  const authorizedAthlete = `i${Math.floor(Math.random() * 1e7)}`;
  const page = await signedIn(browser, "athlete");
  await page.goto("/athlete/profile#montre-auto");
  const panel = page.locator("#montre-auto");

  // L'athlète refuse chez intervals.icu : rien n'est relié.
  await control("authorize", { athlete: null });
  await panel.getByRole("link", { name: "Relier intervals.icu" }).click();
  await expect(page).toHaveURL(/intervals=denied/);
  await expect(panel.getByText(/TriCoach n’a pas été autorisé chez intervals\.icu/)).toBeVisible();
  await expect(panel.getByText("Non relié", { exact: true })).toBeVisible();

  // Il autorise : retour sur le profil, compte relié par jeton.
  await control("authorize", { athlete: authorizedAthlete });
  await panel.getByRole("link", { name: "Relier intervals.icu" }).click();
  await expect(page).toHaveURL(/intervals=connected/);
  await expect(panel.getByText("intervals.icu est relié : vos séances publiées des 14 prochains jours y partent maintenant.")).toBeVisible();
  await expect(panel.getByText(`Relié au compte ${authorizedAthlete}`, { exact: false })).toBeVisible();

  // Délier : l'autorisation est retirée chez intervals.icu.
  await panel.getByRole("button", { name: "Délier intervals.icu" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Délier" }).click();
  await expect(panel.getByText("Non relié", { exact: true })).toBeVisible();
  await control("authorize", { athlete: null });
  await page.context().close();
});
