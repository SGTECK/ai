import { test, expect } from "./fixtures/auth";

/**
 * Staff "login" = Bearer ADMIN_ACCESS_TOKEN against admin APIs.
 * UI stores token in memory only.
 */

test.describe("Admin auth journeys", () => {
  test("failure: admin API without token returns 401 or 503", async ({
    request,
  }) => {
    const res = await request.get("/api/admin/stats");
    expect([401, 503]).toContain(res.status());
  });

  test("happy path: admin stats with token (skipped if no E2E_ADMIN_TOKEN)", async ({
    request,
    adminToken,
  }) => {
    test.skip(!adminToken, "Set E2E_ADMIN_TOKEN to run authenticated admin tests");

    const res = await request.get("/api/admin/stats", {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty("knowledge");
  });

  test("admin page renders token field", async ({ page }) => {
    await page.goto("/admin");
    await expect(page.getByTestId("admin-token")).toBeVisible();
  });
});
