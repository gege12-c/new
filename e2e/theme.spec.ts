/**
 * Apparence : l'application suit le thème de l'appareil, ou le choix fait dans les réglages
 * (« Clair », « Sombre »), gardé sur l'appareil et appliqué dès l'ouverture d'une page.
 */
import { expect, test } from "@playwright/test";
import { signedIn, takeHydrationErrors } from "./fixtures";

test.afterEach(() => expect(takeHydrationErrors()).toEqual([]));

test("mode clair choisi sur un appareil en sombre, gardé d'une page à l'autre, puis retour à l'appareil", async ({ browser }) => {
  const page = await signedIn(browser, "athlete", { colorScheme: "dark" });
  const html = page.locator("html");
  const canvas = () => page.evaluate(() => getComputedStyle(document.body).backgroundColor);

  await page.goto("/settings");
  await expect(html).toHaveAttribute("data-theme", "dark");
  const panel = page.locator("#apparence");
  await expect(panel.getByRole("radio", { name: "Comme l’appareil" })).toBeChecked();

  await panel.getByText("Clair", { exact: true }).click();
  await expect(html).toHaveAttribute("data-theme", "light");
  await expect(panel.getByRole("radio", { name: "Clair" })).toBeChecked();
  expect(await canvas()).toBe("rgb(243, 245, 248)");

  // Nouvelle page chargée : le choix s'applique avant l'affichage.
  await page.goto("/athlete");
  await expect(html).toHaveAttribute("data-theme", "light");
  expect(await canvas()).toBe("rgb(243, 245, 248)");

  await page.goto("/settings");
  await expect(panel.getByRole("radio", { name: "Clair" })).toBeChecked();
  await panel.getByText("Comme l’appareil", { exact: true }).click();
  await expect(html).toHaveAttribute("data-theme", "dark");
  expect(await canvas()).toBe("rgb(10, 18, 32)");
  await page.context().close();
});
