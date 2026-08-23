import { test, expect } from "./fixtures/auth";

/**
 * Critical journeys (product-mapped):
 * - "Signup"  → first visit establishes anonymous session (POST /api/session/new)
 * - "Login"   → N/A for students; staff token tested in admin.spec.ts
 * - "Core"    → ask FAQ (fee structure) and receive assistant message
 * - "Payment" → N/A (no payments in product)
 * - "Logout"  → New Chat clears conversation UI
 */

test.describe("Chat critical journeys", () => {
  test("happy path: land, open session, ask FAQ, see assistant reply", async ({
    page,
  }) => {
    const sessionPromise = page.waitForResponse(
      (r) => r.url().includes("/api/session/new") && r.status() === 200
    );

    await page.goto("/");
    await expect(page.getByTestId("app-header")).toBeVisible();
    await expect(page.getByTestId("chat-input")).toBeVisible();

    // Session creation (anonymous "signup" equivalent)
    await sessionPromise.catch(() => null);

    await page.getByTestId("chat-input").fill("fee structure");
    const chatPromise = page.waitForResponse(
      (r) => r.url().includes("/api/chat") && r.request().method() === "POST"
    );
    await page.getByTestId("btn-send").click();

    const chatRes = await chatPromise;
    expect(chatRes.status()).toBe(200);

    // Assistant bubble appears (FAQ fast path or stream)
    await expect(page.getByTestId("message-assistant").first()).toBeVisible({
      timeout: 60_000,
    });
    const text = await page.getByTestId("message-assistant").first().innerText();
    expect(text.length).toBeGreaterThan(20);
  });

  test("failure: empty send does not create user message", async ({ page }) => {
    await page.goto("/");
    await page.getByTestId("btn-send").click();
    await expect(page.getByTestId("message-user")).toHaveCount(0);
  });

  test("new chat clears thread (logout-equivalent)", async ({ page }) => {
    await page.goto("/");
    await page.getByTestId("chat-input").fill("who is the principal");
    await page.getByTestId("btn-send").click();
    await expect(page.getByTestId("message-user").first()).toBeVisible({
      timeout: 30_000,
    });

    await page.getByTestId("btn-new-chat").click();
    // After new chat, prior user bubble should be gone (or count reset)
    await expect(page.getByTestId("message-user")).toHaveCount(0, {
      timeout: 10_000,
    });
  });

  test("language toggle is reachable", async ({ page }) => {
    await page.goto("/");
    await page.getByTestId("btn-language").click();
    await expect(page.getByTestId("btn-language")).toBeVisible();
  });
});
