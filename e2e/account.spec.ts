/**
 * Vos données : un compte neuf télécharge toutes ses données, puis supprime définitivement son
 * compte ; il ne peut plus se connecter et l'espace connecté le renvoie à la connexion.
 */
import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { accounts, takeHydrationErrors } from "./fixtures";

test.afterEach(() => expect(takeHydrationErrors()).toEqual([]));

test("télécharger ses données puis supprimer son compte", async ({ browser }) => {
  const { password } = accounts();
  const email = `depart-${Date.now()}@e2e.local`;
  const context = await browser.newContext({ acceptDownloads: true });
  const page = await context.newPage();

  await page.goto("/signup");
  await page.getByLabel("Nom affiché").fill("Athlète Départ");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Mot de passe").fill(password);
  await page.getByRole("button", { name: "Créer mon compte" }).click();
  await expect(page).not.toHaveURL(/\/signup/);

  await page.goto("/settings");
  const panel = page.locator("section", { has: page.getByRole("heading", { name: "Vos données" }) });
  const [download] = await Promise.all([page.waitForEvent("download"), panel.getByRole("link", { name: "Télécharger mes données" }).click()]);
  expect(download.suggestedFilename()).toMatch(/^tricoach-mes-donnees-\d{4}-\d{2}-\d{2}\.json$/);
  const exported = JSON.parse(readFileSync(await download.path(), "utf8"));
  expect(exported).toMatchObject({ format: "tricoach-personal-data", version: 1, email, unavailable: [] });
  expect(exported.data.account).toMatchObject({ display_name: "Athlète Départ", is_coach: false });
  expect(exported.data.sessions).toEqual([]);

  // Sans connexion, rien n'est servi.
  const anonymous = await browser.newContext();
  const refused = await anonymous.request.get("/api/me/export");
  expect(refused.status()).toBe(401);
  await anonymous.close();

  const button = panel.getByRole("button", { name: "Supprimer définitivement mon compte" });
  await expect(button).toBeDisabled();
  await panel.getByLabel("Pour confirmer, tapez SUPPRIMER").fill("supprimer");
  await button.click();
  await expect(page).toHaveURL(/\/login\?deleted=1/);
  await expect(page.getByText("Votre compte et toutes vos données ont été supprimés.")).toBeVisible();

  // Plus de session sur cet appareil, plus de compte.
  await page.goto("/settings");
  await expect(page).toHaveURL(/\/login/);
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Mot de passe").fill(password);
  await page.getByRole("button", { name: "Se connecter" }).click();
  await expect(page.getByText("Email ou mot de passe incorrect.")).toBeVisible();
  await context.close();
});
