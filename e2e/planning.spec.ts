import { expect, test, type Page } from "@playwright/test";
import { accounts, addDays, isoDay, mondayIn, signedIn, takeHydrationErrors } from "./fixtures";

test.describe.configure({ mode: "serial" });
test.afterEach(() => expect(takeHydrationErrors()).toEqual([]));

const realtime = process.env.E2E_REALTIME === "1";
const frenchDay = (iso: string) =>
  new Intl.DateTimeFormat("fr-FR", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" }).format(new Date(`${iso}T00:00:00Z`));

/** Crée une séance (brouillon) dans l'éditeur du coach et attend l'enregistrement automatique. */
async function createSession(coach: Page, date: string, title: string) {
  const { athlete } = accounts();
  await coach.goto(`/coach/athletes/${athlete.id}/sessions/new?date=${date}&sport=bike`);
  await coach.locator("[data-editor-ready]").waitFor();
  await coach.getByLabel("Titre de la séance").fill(title);
  await expect(coach.getByRole("status").filter({ hasText: /Enregistré à/ })).toBeVisible({ timeout: 15_000 });
  await expect(coach).toHaveURL(/\/sessions\/[0-9a-f-]{36}$/);
  return coach.url().split("/").pop()!;
}

test("une séance publiée par le coach apparaît chez l'athlète, jamais son brouillon", async ({ browser }) => {
  const date = isoDay(2);
  const title = `Seuil e2e ${Date.now()}`;
  const athletePage = await signedIn(browser, "athlete");
  await athletePage.goto(`/athlete/calendar?view=day&date=${date}`);
  if (realtime) await expect(athletePage.getByText("En direct")).toBeVisible({ timeout: 15_000 });

  const coach = await signedIn(browser, "coach");
  await createSession(coach, date, title);

  // Le brouillon reste invisible pour l'athlète.
  await athletePage.reload();
  await expect(athletePage.getByText(title)).toHaveCount(0);
  if (realtime) await expect(athletePage.getByText("En direct")).toBeVisible({ timeout: 15_000 });

  await coach.getByRole("button", { name: "Publier", exact: true }).click();
  await expect(coach.getByText(/Séance publiée/)).toBeVisible();

  if (realtime) {
    // Critère de la phase 2 : sans rechargement, en quelques secondes.
    await expect(athletePage.getByText(title)).toBeVisible({ timeout: 8_000 });
  } else {
    await athletePage.reload();
    await expect(athletePage.getByText(title)).toBeVisible();
  }
});

test("les modifications d'une séance publiée restent en attente jusqu'à leur publication", async ({ browser }) => {
  const date = isoDay(3);
  const title = `Endurance e2e ${Date.now()}`;
  const coach = await signedIn(browser, "coach");
  const id = await createSession(coach, date, title);
  await coach.getByRole("button", { name: "Publier", exact: true }).click();
  await expect(coach.getByText(/Séance publiée/)).toBeVisible();

  await coach.getByLabel("Titre de la séance").fill(`${title} (v2)`);
  await expect(coach.getByRole("status").filter({ hasText: /Brouillon de modifications enregistré/ })).toBeVisible({ timeout: 15_000 });

  const athletePage = await signedIn(browser, "athlete");
  await athletePage.goto(`/athlete/calendar?view=day&date=${date}&session=${id}`);
  await expect(athletePage.getByRole("heading", { name: title, exact: true })).toBeVisible();
  await expect(athletePage.getByText(`${title} (v2)`)).toHaveCount(0);

  await coach.getByRole("button", { name: "Publier les modifications" }).click();
  await expect(coach.getByText(/Modifications publiées/)).toBeVisible();
  if (!realtime) await athletePage.reload();
  await expect(athletePage.getByRole("heading", { name: `${title} (v2)` })).toBeVisible({ timeout: 10_000 });
});

test("deux éditions concurrentes ne s'écrasent jamais en silence", async ({ browser }) => {
  const title = `Conflit e2e ${Date.now()}`;
  const coach = await signedIn(browser, "coach");
  const id = await createSession(coach, isoDay(4), title);
  const { athlete } = accounts();
  const other = await coach.context().newPage();
  await other.goto(`/coach/athletes/${athlete.id}/sessions/${id}`);
  await other.locator("[data-editor-ready]").waitFor();
  await expect(other.getByLabel("Titre de la séance")).toHaveValue(title);

  await coach.getByLabel("Titre de la séance").fill(`${title} A`);
  await expect(coach.getByRole("status").filter({ hasText: /Enregistré à/ })).toBeVisible({ timeout: 15_000 });

  await other.getByLabel("Titre de la séance").fill(`${title} B`);
  await expect(other.getByRole("alert").filter({ hasText: "modifiée ailleurs" })).toBeVisible({ timeout: 15_000 });
  await other.getByRole("button", { name: "Reprendre la version enregistrée" }).click();
  await expect(other.getByLabel("Titre de la séance")).toHaveValue(`${title} A`);
});

test("deux onglets sur une séance publiée : les modifications en attente se fusionnent", async ({ browser }) => {
  const date = isoDay(6);
  const title = `Fusion e2e ${Date.now()}`;
  const coach = await signedIn(browser, "coach");
  const id = await createSession(coach, date, title);
  await coach.getByRole("button", { name: "Publier", exact: true }).click();
  await expect(coach.getByText(/Séance publiée/)).toBeVisible();

  const { athlete } = accounts();
  const other = await coach.context().newPage();
  await other.goto(`/coach/athletes/${athlete.id}/sessions/${id}`);
  await other.locator("[data-editor-ready]").waitFor();

  // Espace final : la base le retire, ce n’est pas une modification faite ailleurs.
  await coach.getByLabel("Titre de la séance").fill(`${title} (A) `);
  await expect(coach.getByRole("status").filter({ hasText: /Brouillon de modifications enregistré/ })).toBeVisible({ timeout: 15_000 });
  await expect(coach.getByText(/modifiée ailleurs/)).toHaveCount(0);
  await expect(coach.getByLabel("Titre de la séance")).toHaveValue(`${title} (A) `);

  await other.getByLabel("Consignes pour l’athlète").fill("Cadence haute sur les blocs");
  await expect(other.getByText(/ces changements ont été repris/)).toBeVisible({ timeout: 15_000 });
  await expect(other.getByLabel("Titre de la séance")).toHaveValue(`${title} (A)`);

  await other.getByRole("button", { name: "Publier les modifications" }).click();
  await expect(other.getByText(/Modifications publiées/)).toBeVisible();
  const athletePage = await signedIn(browser, "athlete");
  await athletePage.goto(`/athlete/calendar?view=day&date=${date}&session=${id}`);
  await expect(athletePage.getByRole("heading", { name: `${title} (A)` })).toBeVisible();
  await expect(athletePage.getByText("Cadence haute sur les blocs")).toBeVisible();
});

test("le coach déplace une séance par glisser-déposer et copie une semaine", async ({ browser }) => {
  // Mardi → mercredi d’une même semaine, dans deux semaines : toujours visibles ensemble en vue semaine.
  const date = addDays(mondayIn(2), 1);
  const target = addDays(date, 1);
  const title = `Déplacement e2e ${Date.now()}`;
  const coach = await signedIn(browser, "coach");
  await createSession(coach, date, title);
  const { athlete } = accounts();

  await coach.goto(`/coach/athletes/${athlete.id}?view=week&date=${date}`);
  const chip = coach.getByRole("link", { name: new RegExp(title) });
  await chip.dragTo(coach.getByRole("region", { name: frenchDay(target) }));
  await expect(coach.getByText(/Déplacée au/)).toBeVisible();
  await coach.reload();
  await expect(coach.getByRole("region", { name: frenchDay(target) }).getByRole("link", { name: new RegExp(title) })).toBeVisible();

  await coach.getByRole("button", { name: /Copier une semaine|Copier/ }).first().click();
  const dialog = coach.getByRole("dialog", { name: "Copier une semaine" });
  await dialog.getByRole("button", { name: "Copier", exact: true }).click();
  await expect(coach.getByText(/copiée.* vers la semaine du/)).toBeVisible();
});

test("commentaires partagés et notes privées du coach", async ({ browser }) => {
  const date = isoDay(5);
  const title = `Commentaires e2e ${Date.now()}`;
  const coach = await signedIn(browser, "coach");
  const id = await createSession(coach, date, title);
  await coach.getByRole("button", { name: "Publier", exact: true }).click();
  await expect(coach.getByText(/Séance publiée/)).toBeVisible();

  const athletePage = await signedIn(browser, "athlete");
  await athletePage.goto(`/athlete/calendar?view=day&date=${date}&session=${id}`);
  await athletePage.getByLabel("Votre commentaire").fill("Bonnes sensations sur le dernier bloc");
  await athletePage.getByRole("button", { name: "Commenter" }).click();
  await expect(athletePage.getByText("Bonnes sensations sur le dernier bloc")).toBeVisible();

  const { athlete } = accounts();
  await coach.goto(`/coach/athletes/${athlete.id}?view=week&date=${date}&session=${id}`);
  await expect(coach.getByText("Bonnes sensations sur le dernier bloc")).toBeVisible();
  await coach.getByLabel("Votre commentaire").fill("Note privée : augmenter le volume la semaine prochaine");
  await coach.getByLabel(/Note privée/).check();
  await coach.getByRole("button", { name: "Ajouter la note" }).click();
  await expect(coach.getByText("Note privée : augmenter le volume la semaine prochaine")).toBeVisible();

  await athletePage.reload();
  await expect(athletePage.getByText("Bonnes sensations sur le dernier bloc")).toBeVisible();
  await expect(athletePage.getByText("Note privée : augmenter le volume")).toHaveCount(0);
});
