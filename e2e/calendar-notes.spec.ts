/**
 * Jours indisponibles : l'athlète pose une indisponibilité sur son calendrier (une saisie refusée
 * reste en place) ; son coach la voit dans le calendrier de l'athlète, sur son tableau de bord et
 * en créant une séance ce jour-là ; l'athlète la retire.
 */
import { expect, test } from "@playwright/test";
import { accounts, addDays, isoDay, signedIn, takeHydrationErrors } from "./fixtures";

test.describe.configure({ mode: "serial" });
test.afterEach(() => expect(takeHydrationErrors()).toEqual([]));

test("une indisponibilité posée par l'athlète prévient son coach, puis disparaît une fois retirée", async ({ browser }) => {
  const { athlete } = accounts();
  const start = isoDay(5);
  const end = addDays(start, 2);
  const title = `Rotation Tokyo ${Date.now() % 100000}`;

  const page = await signedIn(browser, "athlete");
  await page.goto(`/athlete/calendar?view=week&date=${start}`);
  await page.getByRole("link", { name: /Indisponibilité|Note/ }).first().click();
  const panel = page.locator("aside[data-panel]");
  await expect(panel.getByRole("heading", { name: "Indisponibilité ou note" })).toBeVisible();
  await panel.getByLabel("Du", { exact: true }).fill(start);
  await panel.getByLabel("Au (inclus)").fill(end);
  await panel.getByLabel("Intitulé").fill(title);
  await panel.getByLabel("Précisions").fill("Retour le soir du troisième jour.");
  await panel.getByRole("button", { name: "Poser la note" }).click();
  await expect(panel).toHaveCount(0);
  // Trois jours couverts dans la semaine affichée (ou jusqu'à sa fin).
  await expect(page.locator('[data-note-kind="unavailable"]', { hasText: title }).first()).toBeVisible();

  const coach = await signedIn(browser, "coach");
  await coach.goto(`/coach/athletes/${athlete.id}?view=week&date=${start}`);
  const badge = coach.locator('[data-note-kind="unavailable"]', { hasText: title }).first();
  await expect(badge).toBeVisible();
  await badge.click();
  const coachPanel = coach.locator("aside[data-panel]");
  await expect(coachPanel.getByText("Retour le soir du troisième jour.")).toBeVisible();
  await expect(coachPanel.getByText(/posée par l’athlète/)).toBeVisible();
  // Le coach ne modifie pas la note de l'athlète.
  await expect(coachPanel.getByRole("button", { name: "Enregistrer" })).toHaveCount(0);

  // Créer une séance ce jour-là : l'éditeur le signale.
  await coach.goto(`/coach/athletes/${athlete.id}/sessions/new?date=${start}&sport=run`);
  await coach.locator("[data-editor-ready]").waitFor();
  await expect(coach.getByText(new RegExp(`a indiqué : Indisponible : ${title}`))).toBeVisible();

  // Tableau de bord du coach.
  await coach.goto("/coach");
  await expect(coach.getByText(new RegExp(`Indisponible : ${title}, dès le`))).toBeVisible();

  // L'athlète la retire.
  await page.locator('[data-note-kind="unavailable"]', { hasText: title }).first().click();
  await panel.getByRole("button", { name: "Retirer" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Retirer" }).click();
  await expect(page.locator('[data-note-kind="unavailable"]', { hasText: title })).toHaveCount(0);
  await coach.goto(`/coach/athletes/${athlete.id}?view=week&date=${start}`);
  await expect(coach.locator('[data-note-kind="unavailable"]', { hasText: title })).toHaveCount(0);
  await page.context().close();
  await coach.context().close();
});

test("une période à l'envers est refusée, et la saisie reste en place", async ({ browser }) => {
  const page = await signedIn(browser, "athlete");
  const start = isoDay(9);
  await page.goto(`/athlete/calendar?view=week&date=${start}&note=new`);
  const panel = page.locator("aside[data-panel]");
  await panel.getByLabel("Intitulé").fill("Déplacement mal saisi");
  await panel.getByLabel("Du", { exact: true }).fill(start);
  // Champ « Au » forcé avant le début (le navigateur le permettrait en le tapant).
  await panel.getByLabel("Au (inclus)").evaluate((input) => input.removeAttribute("min"));
  await panel.getByLabel("Au (inclus)").fill(addDays(start, -2));
  await panel.getByRole("button", { name: "Poser la note" }).click();
  await expect(panel.getByText("La fin ne peut pas précéder le début.")).toBeVisible();
  await expect(panel.getByLabel("Intitulé")).toHaveValue("Déplacement mal saisi");
  await page.context().close();
});
