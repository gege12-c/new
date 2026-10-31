/**
 * Déroulé écrit en texte (à la manière d'intervals.icu) : l'aperçu dit ce qui est compris et ce qui
 * pose problème, puis le déroulé est remplacé et enregistré comme une séance construite à la main.
 */
import { expect, test } from "@playwright/test";
import { accounts, isoDay, signedIn, takeHydrationErrors } from "./fixtures";

test.afterEach(() => expect(takeHydrationErrors()).toEqual([]));

test("le coach écrit une séance en texte", async ({ browser }) => {
  const { athlete } = accounts();
  const coach = await signedIn(browser, "coach");
  await coach.goto(`/coach/athletes/${athlete.id}/sessions/new?date=${isoDay(6)}&sport=bike`);
  await coach.locator("[data-editor-ready]").waitFor();
  await coach.getByRole("button", { name: "Écrire en texte" }).click();
  const dialog = coach.getByRole("dialog", { name: "Écrire le déroulé en texte" });
  const text = dialog.getByLabel("Déroulé en texte");

  await text.fill("- Z2 sans durée");
  await expect(dialog.getByText(/Ligne 1 : Durée ou distance manquante/)).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Remplacer le déroulé" })).toBeDisabled();

  await text.fill("Échauffement\n- 15m 55-70%\n\n5x Seuil texte\n- 6m 95-100% 90rpm\n- 2m Z1 récup\n\n- 10m 60% Retour au calme");
  await expect(dialog.getByText(/Compris :.*5 ×/)).toBeVisible();
  await dialog.getByRole("button", { name: "Remplacer le déroulé" }).click();
  await expect(dialog).toBeHidden();

  await expect(coach.getByLabel("Nombre de répétitions").first()).toHaveValue("5");
  await expect(coach.getByLabel("Intitulé de la répétition").first()).toHaveValue("Seuil texte");
  await coach.getByLabel("Titre de la séance").fill(`Séance en texte ${Date.now()}`);
  await expect(coach.getByRole("status").filter({ hasText: /Enregistré à/ })).toBeVisible({ timeout: 15_000 });
  await coach.context().close();
});
