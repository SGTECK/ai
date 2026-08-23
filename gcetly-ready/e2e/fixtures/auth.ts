import { test as base, expect } from "@playwright/test";

/**
 * Auth fixture — college chat is anonymous.
 * "Staff auth" = optional ADMIN_ACCESS_TOKEN for /admin APIs.
 */
type Fixtures = {
  adminToken: string;
};

export const test = base.extend<Fixtures>({
  adminToken: async ({}, use) => {
    await use(process.env.E2E_ADMIN_TOKEN || process.env.ADMIN_ACCESS_TOKEN || "");
  },
});

export { expect };
