import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium } from "playwright";
import { copy } from "../src/copy.js";
const language = process.env.AUTH_LANGUAGE || "en";
const text = copy[language];

const output = resolve(
  process.env.AUTH_SCREENSHOT_DIR || "../.scratch/auth-ui",
);
await mkdir(output, { recursive: true });
const root = resolve(process.env.AUTH_DIST || "dist");
const server = createServer(async (req, res) => {
  const path = new URL(req.url, "http://localhost").pathname;
  try {
    const file =
      path === "/" || !path.split("/").at(-1).includes(".")
        ? "/index.html"
        : path;
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
    let signedIn = false;
    await page.addInitScript(
      (language) => localStorage.setItem("notebook-language", language),
      language,
    );
    await page.route("**/api/**", async (route) => {
      const path = new URL(route.request().url()).pathname;
      let data = [];
      if (path === "/api/auth/session")
        data = {
          authenticated: signedIn,
          auth_available: true,
          csrf_token: "synthetic",
          account: signedIn
            ? {
                id: "synthetic",
                profile_id: "synthetic",
                display_name: "Synthetic Learner",
                role: "learner",
                legacy_access: false,
                interface_language: language,
              }
            : undefined,
        };
      else if (path.endsWith("/signin"))
        data = { status: "WRONG_CREDENTIALS_ERROR" };
      else if (path === "/api/profiles")
        data = [
          {
            id: "synthetic",
            display_name: "Synthetic Learner",
            preferred_direction: "greek_to_italian",
          },
        ];
      else if (path.endsWith("/progress"))
        data = {
          vocabulary_count: 0,
          total_reviews: 0,
          entries_practised: 0,
          difficult_entries: 0,
          counts: { again: 0, hard: 0, easy: 0 },
          directions: [],
          units: [],
          word_types: [],
          sessions: [],
          recent_sessions: [],
        };
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify(data),
      });
    });
    await page.goto(origin);
    await page.locator(".gate-card").waitFor();
    const geometry = await page.locator(".gate-intro").evaluate((el) => {
      const r = el.getBoundingClientRect();
      return {
        x: r.x,
        y: r.y,
        width: r.width,
        height: r.height,
        text: el.textContent,
      };
    });
    if (process.env.AUTH_COMPARE) {
      const original = JSON.parse(
        await readFile(
          `${process.env.AUTH_COMPARE}/geometry-${width}.json`,
          "utf8",
        ),
      );
      assert.deepEqual(
        geometry,
        original,
        `Original hero geometry/copy changed at ${width}`,
      );
    }
    await writeFile(
      `${output}/geometry-${width}.json`,
      JSON.stringify(geometry),
    );
    if (process.env.AUTH_BASELINE) {
      await page.evaluate(() => {
        document.activeElement?.blur();
        window.scrollTo(0, 0);
      });
      await page.screenshot({
        path: `${output}/original-${width}.png`,
        fullPage: true,
      });
      await page.close();
      continue;
    }
    await page
      .getByRole("button", { name: text.authAction_signin, exact: true })
      .waitFor();
    const capture = async (name) => {
      assert(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
        `${name}: horizontal overflow at ${width}`,
      );
      await page.evaluate(() => {
        document.activeElement?.blur();
        window.scrollTo(0, 0);
      });
      await page.screenshot({
        path: `${output}/${name}-${width}.png`,
        fullPage: true,
      });
    };
    await capture("signin");
    await page.getByLabel(text.authEmail).fill("synthetic@example.invalid");
    await page
      .getByLabel(text.authPassword, { exact: true })
      .fill("synthetic wrong password");
    await page
      .getByRole("button", { name: text.authAction_signin, exact: true })
      .click();
    await page
      .getByRole("alert")
      .filter({ hasText: text.authCredentials })
      .waitFor();
    await capture("error");
    await page
      .getByRole("button", { name: text.authAction_signup, exact: true })
      .click();
    await capture("registration");
    await page
      .getByRole("button", { name: text.authAction_signin, exact: true })
      .click();
    await page.getByRole("button", { name: text.authForgot }).click();
    await capture("recovery");
    signedIn = true;
    await page.goto(origin);
    const pill = page.locator(".profile-picker");
    await pill.waitFor();
    assert.equal(
      await pill.getByText("Synthetic Learner", { exact: true }).count(),
      1,
    );
    assert.equal(await pill.locator("select").count(), 0);
    await capture("profile");
    await pill.screenshot({ path: `${output}/profile-component-${width}.png` });
    await page.close();
  }
  console.log(
    `PASS: sign-in error and profile assertions; no overflow at 1280/390/320. Screenshots: ${output}`,
  );
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
