/** En-têtes de sécurité servis avec chaque page. */
import { expect, test } from "@playwright/test";

test("les pages refusent d'être intégrées dans un cadre et limitent le référent", async ({ request }) => {
  const response = await request.get("/login");
  const headers = response.headers();
  expect(headers["x-frame-options"]).toBe("DENY");
  expect(headers["x-content-type-options"]).toBe("nosniff");
  expect(headers["referrer-policy"]).toBe("strict-origin-when-cross-origin");
  expect(headers["permissions-policy"]).toContain("camera=()");
});
