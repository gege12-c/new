/**
 * Administration : comptes et rôles, sans aucune donnée sportive.
 */
import { expect, test } from "@playwright/test";
import { signedIn, takeHydrationErrors } from "./fixtures";

test.afterEach(() => expect(takeHydrationErrors()).toEqual([]));
// Le coach de test devient administrateur seulement avec la clé de service (voir global-setup).
test.skip(!(process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY), "Clé de service absente : pas d'administrateur de test.");

test("l'administrateur voit les comptes et leurs rôles", async ({ browser }) => {
  const page = await signedIn(browser, "coach");
  await page.goto("/admin");
  const panel = page.locator("section", { has: page.getByRole("heading", { name: "Comptes et rôles" }) });
  await expect(panel).toBeVisible();
  const coachRow = panel.getByRole("row", { name: /Coach E2E/ }).first();
  await expect(coachRow).toContainText("Admin");
  await expect(coachRow).toContainText("Coach");
  await expect(panel.getByRole("row", { name: /Athlete E2E/ }).first()).toContainText("Donner l’administration");
  // Aucune donnée sportive : ni séance, ni activité, ni seuil.
  await expect(panel).not.toContainText(/FTP|séance|activité/i);
});
