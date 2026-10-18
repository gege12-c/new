import { expect, test } from "@playwright/test";
import { signedIn, takeHydrationErrors } from "./fixtures";

test.afterEach(() => expect(takeHydrationErrors()).toEqual([]));

test("l'athlète consulte son entraînement sur téléphone", async ({ browser }) => {
  const page = await signedIn(browser, "athlete", { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  await page.goto("/athlete");
  await expect(page.getByRole("heading", { name: "Aujourd’hui" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Cette semaine" })).toBeVisible();

  const nav = page.getByRole("navigation", { name: "Navigation principale" }).last();
  await nav.getByRole("link", { name: "Calendrier" }).click();
  await expect(page).toHaveURL(/\/athlete\/calendar/);
  await expect(page.getByRole("heading", { name: "Calendrier" })).toBeVisible();
  // Pas de défilement horizontal de la page sur téléphone.
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
});
