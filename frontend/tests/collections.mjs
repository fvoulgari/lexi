/** Real local API/database; only verified-provider identity is replaced by a test fixture. */
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { chromium } from "playwright";
const origin = process.env.COLLECTION_TEST_ORIGIN || "http://127.0.0.1:8137";
assert.equal(new URL(origin).hostname, "127.0.0.1");
const output = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../.scratch/collections",
);
await mkdir(output, { recursive: true });
const browser = await chromium.launch();
try {
  for (const width of [1280, 390, 320]) {
    const context = await browser.newContext({
      viewport: { width, height: 1000 },
    });
    await context.addCookies([
      {
        name: "collection_test_user",
        value: `browser-${randomUUID()}`,
        url: origin,
      },
    ]);
    await context.addInitScript(() =>
      localStorage.setItem("notebook-language", "en"),
    );
    const page = await context.newPage();
    const unitName = `Unit 1 ${width}-${randomUUID().slice(0, 4)}`;
    const greetingsName = `Greetings ${width}-${randomUUID().slice(0, 4)}`;
    await page.goto(`${origin}/collections`);
    await page
      .getByRole("heading", { name: "Collections", exact: true })
      .waitFor();
    const create = async (name) => {
      await page
        .getByRole("textbox", { name: "Collection name", exact: true })
        .fill(name);
      await page
        .getByRole("button", { name: "Create collection", exact: true })
        .click();
      await page
        .locator(".collection-box")
        .filter({ has: page.getByRole("heading", { name, exact: true }) })
        .last()
        .getByRole("button", { name: "Create card", exact: true })
        .waitFor();
    };
    await create(unitName);
    await page
      .getByRole("button", { name: "Create card", exact: true })
      .click();
    await page
      .getByRole("textbox", { name: "Greek", exact: true })
      .fill("γεια");
    await page
      .getByRole("textbox", { name: "Italian", exact: true })
      .fill("ciao");
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await page
      .getByRole("button", { name: "Remove reference", exact: true })
      .waitFor();
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({
      path: resolve(output, `create-${width}.png`),
      fullPage: true,
    });
    await create(greetingsName);
    await page
      .getByRole("button", { name: "Add existing card", exact: true })
      .click();
    await page
      .getByRole("textbox", { name: "Search accessible cards" })
      .fill("ciao");
    await page
      .locator(".collection-search li")
      .filter({ hasText: "Private" })
      .getByRole("button", { name: "Add", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Remove reference", exact: true })
      .waitFor();
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({
      path: resolve(output, `reuse-${width}.png`),
      fullPage: true,
    });
    await page
      .getByRole("button", { name: "Publish collection", exact: true })
      .click();
    await page.getByRole("region", { name: "Confirm publication" }).waitFor();
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({
      path: resolve(output, `publish-preview-${width}.png`),
      fullPage: true,
    });
    await page
      .getByRole("button", { name: "Confirm publication", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Unpublish collection", exact: true })
      .waitFor();
    await page.getByLabel(`Select for practice: ${unitName}`).check();
    await page.getByLabel(`Select for practice: ${greetingsName}`).check();
    await page
      .getByRole("combobox", { name: /^Practice direction/ })
      .selectOption("reverse");
    await page
      .getByRole("button", { name: "Practise selected collections" })
      .click();
    await page.getByRole("heading", { name: "ciao", exact: true }).waitFor();
    assert.match(await page.locator(".collection-box").innerText(), /1 \/ 1/);
    await page.getByRole("button", { name: "Show answer" }).click();
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({
      path: resolve(output, `practice-${width}.png`),
      fullPage: true,
    });
    await page.getByRole("button", { name: "Hard", exact: true }).click();
    await page.getByRole("heading", { name: "Practice complete" }).waitFor();
    await page.getByRole("button", { name: "Back to collections" }).click();
    await page.getByLabel(`Select for practice: ${unitName}`).uncheck();
    await page.getByLabel("Difficult cards only", { exact: true }).check();
    await page
      .getByRole("button", { name: "Practise selected collections" })
      .click();
    await page.getByRole("heading", { name: "ciao", exact: true }).waitFor();
    await page.getByRole("button", { name: "Back to collections" }).click();
    await page
      .getByRole("button", { name: "Shared library", exact: true })
      .click();
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({
      path: resolve(output, `discover-${width}.png`),
      fullPage: true,
    });
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      true,
    );
    const other = await browser.newContext({
      viewport: { width, height: 1000 },
    });
    await other.addCookies([
      {
        name: "collection_test_user",
        value: `browser-${randomUUID()}`,
        url: origin,
      },
    ]);
    await other.addInitScript(() =>
      localStorage.setItem("notebook-language", "en"),
    );
    const second = await other.newPage();
    await second.goto(`${origin}/collections`);
    await second
      .getByRole("button", { name: "Shared library", exact: true })
      .click();
    await second.getByLabel(`Select for practice: ${greetingsName}`).check();
    await second
      .getByRole("combobox", { name: /^Practice direction/ })
      .selectOption("reverse");
    await second.getByLabel("Difficult cards only", { exact: true }).check();
    await second
      .getByRole("button", { name: "Practise selected collections" })
      .click();
    await second.getByRole("alert").waitFor();
    await second.getByLabel("Difficult cards only", { exact: true }).uncheck();
    await second
      .getByRole("button", { name: "Practise selected collections" })
      .click();
    await second.getByRole("heading", { name: "ciao", exact: true }).waitFor();
    await other.close();
    await context.close();
    console.log(
      `PASS ${width}px: create, reuse, publication preview, discover, combined deduplication, shared difficulty and two-user isolation`,
    );
  }
} finally {
  await browser.close();
}
