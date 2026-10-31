/**
 * Forme du jour : l'athlète la saisit sur son accueil (échelles au doigt, mesures facultatives), son
 * coach en voit les signaux sur son tableau de bord, et la progression l'affiche sans rien tracer
 * sur trop peu de jours.
 */
import { expect, test } from "@playwright/test";
import { signedIn, takeHydrationErrors } from "./fixtures";

test.describe.configure({ mode: "serial" });
test.afterEach(() => expect(takeHydrationErrors()).toEqual([]));

test("l'athlète note sa forme du jour, son coach en voit les signaux", async ({ browser }) => {
  const page = await signedIn(browser, "athlete");
  await page.goto("/athlete");
  const card = page.locator("section", { has: page.getByRole("heading", { name: "Forme du jour" }) });
  await expect(card).toBeVisible();
  // Déjà saisie lors d'un passage précédent : on la modifie.
  if (await card.getByRole("button", { name: "Modifier" }).isVisible()) await card.getByRole("button", { name: "Modifier" }).click();

  await card.getByLabel("Fatigue : Fatigué").check({ force: true });
  await card.getByLabel("Motivation : Bonne").check({ force: true });
  await card.getByText("Mesures du matin (facultatif)").click();
  await card.getByLabel("Sommeil (h)").fill("5,5");
  await card.getByLabel("FC au repos (bpm)").fill("49");
  await card.getByLabel("Un mot pour votre coach").fill("Vol de nuit hier.");
  await card.getByRole("button", { name: "Enregistrer" }).click();

  await expect(card.getByText(/Fatigue : fatigué/)).toBeVisible();
  await expect(card.getByText(/Sommeil 5 h 30/)).toBeVisible();
  await expect(card.getByText("Vol de nuit hier.")).toBeVisible();

  // Une valeur impossible est refusée, la saisie reste en place.
  await card.getByRole("button", { name: "Modifier" }).click();
  await card.getByLabel("FC au repos (bpm)").fill("12");
  await card.getByRole("button", { name: "Enregistrer" }).click();
  await expect(card.getByText("FC au repos : 25 au moins.")).toBeVisible();
  await expect(card.getByLabel("FC au repos (bpm)")).toHaveValue("12");
  await card.getByLabel("FC au repos (bpm)").fill("49");
  await card.getByRole("button", { name: "Enregistrer" }).click();
  await expect(card.getByText(/FC au repos 49 bpm/)).toBeVisible();

  const coach = await signedIn(browser, "coach");
  await coach.goto("/coach");
  await expect(coach.getByText(/Forme du jour : fatigué, nuit de 5 h 30/)).toBeVisible();

  // Progression : un seul jour renseigné, aucune courbe tracée.
  await page.goto("/athlete/stats");
  await expect(page.getByRole("heading", { name: "Forme du jour" })).toBeVisible();
  await expect(page.getByText(/jours? renseignés? sur 28/)).toBeVisible();
  await page.context().close();
  await coach.context().close();
});
