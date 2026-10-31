/**
 * Vue saison : le coach et l'athlète voient les semaines passées et à venir, avec la compétition
 * et les semaines vides comprises.
 */
import { expect, test } from "@playwright/test";
import { accounts, signedIn, takeHydrationErrors } from "./fixtures";

test.afterEach(() => expect(takeHydrationErrors()).toEqual([]));

test("la saison de l'athlète, côté coach et côté athlète", async ({ browser }) => {
  const { athlete } = accounts();
  const coach = await signedIn(browser, "coach");
  await coach.goto(`/coach/athletes/${athlete.id}`);
  await coach.getByRole("link", { name: "Saison" }).click();
  await expect(coach).toHaveURL(/\/season$/);
  await expect(coach.getByRole("link", { name: "Saison" })).toHaveAttribute("aria-current", "page");
  // 8 semaines passées + 26 à venir.
  await expect(coach.locator("ol > li")).toHaveCount(34);
  await coach.context().close();

  const page = await signedIn(browser, "athlete");
  await page.goto("/athlete/calendar");
  await page.getByRole("link", { name: "Vue saison" }).click();
  await expect(page.getByRole("heading", { name: "Saison" })).toBeVisible();
  await expect(page.locator("ol > li")).toHaveCount(34);
  await page.context().close();
});
