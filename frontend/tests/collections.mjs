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
    const suffix = `${width}-${randomUUID().slice(0, 4)}`;
    const first = `Unit 1 ${suffix}`;
    const second = `Greetings ${suffix}`;
    const renamed = `Renamed ${suffix}`;
    const danish = `Danish ${suffix}`;
    await page.goto(`${origin}/collections`);
    await page
      .getByRole("heading", { name: "Collections", exact: true })
      .waitFor();
    const box = (name) =>
      page
        .locator(".collection-box")
        .filter({ has: page.getByRole("heading", { name, exact: true }) });
    const create = async (name, pair) => {
      await page
        .getByRole("button", { name: "Create collection", exact: true })
        .click();
      const dialog = page.getByRole("dialog", { name: "Import CSV" });
      const layout = await dialog.evaluate((element) => ({
        inWorkspace: Boolean(element.closest(".shared-collections")),
        labelDisplay: getComputedStyle(
          element.querySelector("label.collection-field"),
        ).display,
      }));
      // The modal must not inherit the collection page's form layout.
      assert.equal(layout.inWorkspace, false);
      assert.equal(layout.labelDisplay, "grid");
      await dialog
        .getByRole("textbox", { name: "Collection name", exact: true })
        .fill(name);
      const chooseLanguage = async (index, language) => {
        const picker = dialog.locator(".language-combobox").nth(index);
        await picker.getByRole("combobox").fill(language);
        await picker
          .getByRole("option", { name: new RegExp(`^${language}`) })
          .click();
      };
      const [base, learning] = pair
        ? pair.split(" ↔ ")
        : ["Greek", "Italian"];
      await chooseLanguage(0, base);
      await chooseLanguage(1, learning);
      const creation = page.waitForResponse(
        (response) =>
          new URL(response.url()).pathname === "/api/collections" &&
          response.request().method() === "POST",
      );
      await dialog
        .getByRole("button", { name: "Create collection", exact: true })
        .click();
      await creation;
      await box(name).waitFor();
    };
    const edit = async (name) => {
      const dialog = page.getByRole("dialog", {
        name: "Edit collection",
        exact: true,
      });
      if ((await dialog.count()) === 0)
        await box(name)
          .getByRole("button", { name: "Edit collection", exact: true })
          .click();
      await dialog.waitFor();
      return dialog;
    };
    const visibleAs = (name, value) =>
      box(name).locator("p").first().filter({ hasText: value }).waitFor();
    const changeVisibility = async (name) => {
      const panel = await edit(name);
      await panel
        .getByRole("switch", { name: "Collection visibility" })
        .click();
      const dialog = page.getByRole("dialog", {
        name: /^(Publish collection|Confirm unpublishing)$/,
      });
      await dialog.waitFor();
      return dialog;
    };

    await create(first);
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({
      path: resolve(output, `create-${width}.png`),
      fullPage: true,
    });
    await create(second);
    assert.equal(
      await page
        .getByRole("combobox", { name: "Language pair", exact: true })
        .inputValue(),
      "",
    );

    let panel = await edit(second);
    await panel
      .getByRole("textbox", { name: "Collection name", exact: true })
      .fill(renamed);
    await panel.getByRole("button", { name: "Save", exact: true }).click();
    await box(renamed).waitFor();
    await page.screenshot({
      path: resolve(output, `rename-${width}.png`),
      fullPage: true,
    });

    let dialog = await changeVisibility(renamed);
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({
      path: resolve(output, `publish-preview-${width}.png`),
      fullPage: true,
    });
    await dialog.getByRole("button", { name: "Publish", exact: true }).click();
    await dialog.waitFor({ state: "hidden" });
    await visibleAs(renamed, "Public");

    dialog = await changeVisibility(renamed);
    await dialog
      .getByRole("button", { name: "Confirm unpublishing", exact: true })
      .click();
    await dialog.waitFor({ state: "hidden" });
    await visibleAs(renamed, "Private");

    await create(danish, "Greek ↔ Danish");
    const filter = page.getByRole("combobox", {
      name: "Language pair",
      exact: true,
    });
    await filter.selectOption("da-el");
    await box(danish).waitFor();
    assert.equal(await box(first).count(), 0);
    await filter.selectOption("");
    await box(first).waitFor();

    dialog = await changeVisibility(renamed);
    await dialog.getByRole("button", { name: "Publish", exact: true }).click();
    await dialog.waitFor({ state: "hidden" });
    await visibleAs(renamed, "Public");
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
    const secondPage = await other.newPage();
    await secondPage.goto(`${origin}/collections`);
    await secondPage
      .getByRole("button", { name: "Shared library", exact: true })
      .click();
    const shared = secondPage
      .locator(".collection-box")
      .filter({ has: secondPage.getByRole("heading", { name: renamed }) });
    await shared.waitFor();
    assert.equal(
      await shared
        .getByRole("button", { name: "Add to my collections", exact: true })
        .count(),
      1,
    );
    assert.equal(
      await shared
        .getByRole("button", { name: "Edit collection", exact: true })
        .count(),
      0,
    );
    await other.close();

    await page
      .getByRole("button", { name: "My collections", exact: true })
      .click();
    panel = await edit(first);
    await panel
      .getByRole("button", { name: "Delete collection", exact: true })
      .click();
    const confirm = page.getByRole("dialog", {
      name: `Delete collection · ${first}`,
    });
    const deletion = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname.startsWith("/api/collections/") &&
        response.request().method() === "DELETE",
    );
    await confirm
      .getByRole("button", { name: "Yes, delete collection" })
      .click();
    await deletion;
    await box(first).waitFor({ state: "detached" });

    await context.close();
    console.log(
      `PASS ${width}px: create, rename, publish/unpublish, pair filter, discover, read-only isolation and confirmed delete`,
    );
  }
} finally {
  await browser.close();
}
