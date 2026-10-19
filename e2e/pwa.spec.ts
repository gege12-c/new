/**
 * Phase 5 : l'application s'installe sur un téléphone (manifeste, icônes, service worker) et
 * affiche une page claire hors connexion, sans jamais conserver de données sur l'appareil.
 */
import { expect, test } from "@playwright/test";
import { signedIn, takeHydrationErrors } from "./fixtures";

test.afterEach(() => expect(takeHydrationErrors()).toEqual([]));

test("le manifeste et les icônes d'installation sont servis", async ({ page, request }) => {
  await page.goto("/login");
  const href = await page.locator('link[rel="manifest"]').getAttribute("href");
  expect(href).toBeTruthy();
  const response = await request.get(href!);
  expect(response.ok()).toBe(true);
  const manifest = await response.json();
  expect(manifest).toMatchObject({ name: "TriCoach", display: "standalone", start_url: "/home" });
  for (const icon of manifest.icons as { src: string }[]) {
    const file = await request.get(icon.src);
    expect(file.ok(), icon.src).toBe(true);
    expect(file.headers()["content-type"]).toBe("image/png");
  }
  await expect(page.locator('link[rel="apple-touch-icon"]')).toHaveCount(1);
  await expect(page.locator('meta[name="mobile-web-app-capable"], meta[name="apple-mobile-web-app-capable"]').first()).toHaveAttribute("content", "yes");
});

test("Chrome considère l'application comme installable", async ({ page }) => {
  await page.goto("/login");
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  const cdp = await page.context().newCDPSession(page);
  const { installabilityErrors } = await cdp.send("Page.getInstallabilityErrors");
  // Seule réserve attendue : le contexte de test est une fenêtre privée, jamais installable.
  expect(installabilityErrors.filter((e) => e.errorId !== "in-incognito")).toEqual([]);
  const { errors } = await cdp.send("Page.getAppManifest");
  expect(errors).toEqual([]);
});

test("hors connexion, une page claire remplace l'erreur du navigateur", async ({ browser }) => {
  const page = await signedIn(browser, "athlete");
  await page.goto("/athlete");
  const script = await page.evaluate(async () => (await navigator.serviceWorker.ready).active?.scriptURL ?? null);
  expect(script).toMatch(/\/sw\.js$/);
  // Le service worker doit contrôler la page avant la coupure réseau.
  await page.reload();
  await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);

  await page.context().setOffline(true);
  await page.goto("/athlete/calendar").catch(() => undefined);
  await expect(page.getByRole("heading", { name: "Pas de connexion" })).toBeVisible();
  await page.context().setOffline(false);
  await page.getByRole("button", { name: "Réessayer" }).click();
  await expect(page.getByRole("heading", { name: "Pas de connexion" })).toBeHidden();
});

test("les réglages expliquent l'installation sur iPhone et Android", async ({ browser }) => {
  const page = await signedIn(browser, "athlete");
  await page.goto("/settings");
  const panel = page.locator("section", { has: page.getByRole("heading", { name: "Application sur téléphone" }) });
  await expect(panel).toContainText("Sur l’écran d’accueil");
  await expect(panel).toContainText("Installer l’application");
});
