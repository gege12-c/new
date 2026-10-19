/**
 * Pages d'état en français : une adresse inconnue ou une ressource inaccessible donne une page
 * claire (statut 404 quand il peut encore être envoyé), avec un chemin de retour.
 */
import { expect, test } from "@playwright/test";
import { accounts, signedIn, takeHydrationErrors } from "./fixtures";

test.afterEach(() => expect(takeHydrationErrors()).toEqual([]));

test("une adresse inconnue affiche « Page introuvable », statut 404", async ({ page }) => {
  const response = await page.goto("/cette-page-n-existe-pas");
  expect(response?.status()).toBe(404);
  await expect(page.getByRole("heading", { name: "Page introuvable" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Retour à l’accueil" })).toHaveAttribute("href", "/home");
  await expect(page).toHaveTitle("Page introuvable – TriCoach");
});

test("une séance inexistante donne la même page dans l'espace connecté", async ({ browser }) => {
  const { athlete } = accounts();
  const page = await signedIn(browser, "coach");
  await page.goto(`/coach/athletes/${athlete.id}/sessions/00000000-0000-4000-8000-000000000000`);
  await expect(page.getByRole("heading", { name: "Page introuvable" })).toBeVisible();
});
