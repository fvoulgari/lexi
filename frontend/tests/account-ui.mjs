import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium } from "playwright";
import { copy } from "../src/copy.js";
const language = process.env.AUTH_LANGUAGE || "en";
const text = copy[language];
const before = !!process.env.AUTH_BEFORE;
const output = resolve(
  process.env.AUTH_SCREENSHOT_DIR || "../.scratch/account-ui/after",
);
const root = resolve(process.env.AUTH_DIST || "dist");
await mkdir(output, { recursive: true });
const server = createServer(async (req, res) => {
  const path = new URL(req.url, "http://localhost").pathname;
  const file =
    path === "/" || !path.split("/").at(-1).includes(".")
      ? "/index.html"
      : path;
  try {
    const data = await readFile(resolve(root, `.${file}`));
    res.setHeader(
      "Content-Type",
      file.endsWith(".js")
        ? "text/javascript"
        : file.endsWith(".css")
          ? "text/css"
          : "text/html",
    );
    res.end(data);
  } catch {
    res.writeHead(404).end();
  }
});
await new Promise((resolve, reject) => {
  server.once("error", reject);
  server.listen(0, "127.0.0.1", resolve);
});
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ headless: true });
try {
  for (const width of [1280, 390, 320]) {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    let authenticated = true,
      google = false;
    await page.addInitScript(
      (language) => localStorage.setItem("notebook-language", language),
      language,
    );
    await page.route("**/api/**", async (route) => {
      const path = new URL(route.request().url()).pathname;
      let data = [];
      if (path === "/api/auth/session")
        data = {
          authenticated,
          auth_available: true,
          csrf_token: "synthetic",
          account: authenticated
            ? {
                id: "synthetic",
                profile_id: "synthetic",
                display_name: "Synthetic learner",
                role: "learner",
                interface_language: language,
              }
            : undefined,
        };
      else if (path === "/api/account/credentials")
        data = {
          display_name: "Synthetic learner",
          email: "synthetic@example.invalid",
          sign_in_methods: google ? ["google"] : ["password"],
          can_change_password: !google,
        };
      else if (path === "/api/profiles")
        data = [
          {
            id: "synthetic",
            display_name: "Synthetic learner",
            preferred_direction: "greek_to_italian",
            default_session_size: 25,
          },
        ];
      else if (path.endsWith("/user/password/reset/token"))
        data = { status: "OK" };
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify(data),
      });
    });
    const screenshot = async (name, locator = page) => {
      await page.evaluate(() => {
        document.activeElement?.blur();
        window.scrollTo(0, 0);
      });
      assert(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
        `${name}: overflow ${width}`,
      );
      await locator.screenshot({
        path: `${output}/${name}-${width}.png`,
        ...(locator === page ? { fullPage: true } : {}),
      });
    };
    await page.goto(origin + "/settings");
    const card = page
      .getByRole("heading", { name: text.account, exact: true })
      .locator("..");
    await card.waitFor();
    await page.getByLabel(text.settingsName, { exact: true }).waitFor();
    if (!before) {
      await card.getByText("synthetic@example.invalid").waitFor();
      const identity = await card.locator(".account-identity").boundingBox();
      const actions = await card.locator(".account-actions").boundingBox();
      assert(
        actions.y >= identity.y + identity.height + 16,
        "Account actions touch identity",
      );
    }
    await screenshot("account", card);
    if (!before) {
      await card
        .getByRole("button", { name: text.changePassword, exact: true })
        .click();
      assert(
        await page
          .getByLabel(text.currentPassword, { exact: true })
          .evaluate((el) => document.activeElement === el),
        "Password form focus missing",
      );
      await screenshot("change-password", card);
      google = true;
      await page.reload();
      await page.getByText(text.accountGoogle, { exact: true }).waitFor();
      assert.equal(
        await page
          .getByRole("button", { name: text.changePassword, exact: true })
          .count(),
        0,
      );
      await screenshot(
        "account-google",
        page
          .getByRole("heading", { name: text.account, exact: true })
          .locator(".."),
      );
    }
    authenticated = false;
    await page.goto(origin);
    await page
      .getByRole("button", { name: text.authForgot, exact: true })
      .click();
    const gate = page.locator(".gate-card");
    await screenshot("reset-request", gate);
    await page.getByLabel(text.authEmail).fill("synthetic@example.invalid");
    await page
      .getByRole("button", { name: text.authAction_forgot, exact: true })
      .click();
    await page.getByRole("status").waitFor();
    if (!before) {
      assert.equal(await page.getByLabel(text.authEmail).count(), 0);
      assert.equal(
        await gate
          .getByText("synthetic@example.invalid", { exact: true })
          .count(),
        1,
      );
    }
    await screenshot("reset-accepted", gate);
    await page.close();
  }
  console.log(
    `PASS: ${before ? "before screenshots" : "account spacing, credential availability, password focus and accepted recovery"}; ${language}; 1280/390/320. ${output}`,
  );
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
