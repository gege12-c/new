/**
 * Création d'une séance par l'athlète, sur téléphone : le titre proposé suit la discipline, changer
 * de discipline garde une séance cohérente (cibles de la nouvelle discipline, rien de retiré), une
 * cible ajoutée ou changée d'unité reçoit une intensité adaptée au type d'étape, et la séance publiée
 * arrive dans le calendrier sous le bon nom.
 */
import { devices, expect, test } from "@playwright/test";
import { addDays, isoDay, signedIn, takeHydrationErrors } from "./fixtures";

test.afterEach(() => expect(takeHydrationErrors()).toEqual([]));

test("créer une séance de vélo sur téléphone, sans incohérence", async ({ browser }) => {
  const page = await signedIn(browser, "athlete", { ...devices["Pixel 7"] });
  const day = addDays(isoDay(0), 9);
  await page.goto(`/athlete/sessions/new?date=${day}`);
  await expect(page.locator("[data-editor-ready]")).toBeVisible();
  const title = page.locator("#session-title");
  await expect(title).toHaveValue("Course à pied");
  // Sans allure seuil (le compte de test n'a qu'une FTP) : effort ressenti, aucun seuil réclamé.
  await expect(page.getByText("allure seuil manquante")).toHaveCount(0);
  await expect(page.locator("select[id^='metric-']").first()).toHaveValue("rpe.scale");

  await page.getByRole("button", { name: "Vélo", exact: true }).click();
  await expect(title).toHaveValue("Vélo");
  await expect(page.getByText(/cibles? retirée/)).toHaveCount(0);
  const metrics = page.locator("select[id^='metric-']");
  await expect(metrics).toHaveCount(4);
  await expect(metrics.nth(1)).toHaveValue("power.percent_ftp");
  // FTP de 250 W : la plage du travail est convertie pour l'athlète.
  await expect(page.getByText("≈ 220–238 W")).toBeVisible();

  // Même mesure, autre unité : W, avec l'intensité de l'étape (travail, puis récupération).
  await metrics.nth(1).selectOption("power.watts");
  await metrics.nth(2).selectOption("power.watts");
  const lows = page.getByLabel("Borne basse");
  const highs = page.getByLabel("Borne haute");
  await expect(lows.nth(1)).toHaveValue("220");
  await expect(highs.nth(1)).toHaveValue("238");
  await expect(lows.nth(2)).toHaveValue("113");
  await expect(highs.nth(2)).toHaveValue("138");

  // Un titre choisi n'est plus remplacé.
  await title.fill("Seuil 4 × 10 min");
  await page.getByRole("button", { name: "Publier" }).click();
  await expect(page.getByText("Séance publiée : elle est dans votre calendrier.")).toBeVisible();

  await page.goto(`/athlete/calendar?view=week&date=${day}`);
  const card = page.getByRole("link", { name: /Seuil 4 × 10 min/ });
  await expect(card).toBeVisible();
  await card.click();
  const panel = page.locator("aside[data-panel]");
  await expect(panel.getByRole("heading", { name: "Seuil 4 × 10 min" })).toBeVisible();
  await expect(panel.getByText("220–238 W")).toBeVisible();
  await expect(panel.getByText("113–138 W")).toBeVisible();
  // Pas de défilement horizontal de l'éditeur ni du panneau sur téléphone.
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
});
