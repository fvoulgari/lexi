import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium } from "playwright";

const origin = process.env.COLLECTION_TEST_ORIGIN || "http://127.0.0.1:8137";
assert.equal(new URL(origin).hostname, "127.0.0.1");
const output = resolve(
  process.env.CSV_SCREENSHOTS || ".scratch/collection-csv",
);
await mkdir(output, { recursive: true });
const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH,
});
const fields = "italian,greek,word_type\n";
const lessons = [
  [
    "Lezione 01",
    "lezione.csv",
    [
      "ciao,γεια,expression",
      "buongiorno,καλημέρα,expression",
      "a presto,τα λέμε σύντομα,expression",
    ],
  ],
  ["Verbi", "verbi.csv", ["andare,πηγαίνω,verb", "capire,καταλαβαίνω,verb"]],
];

try {
  for (const width of [1280, 390, 320]) {
    const mobile = width < 540;
    const context = await browser.newContext({
      viewport: { width, height: mobile ? 844 : 900 },
      isMobile: mobile,
      hasTouch: mobile,
      acceptDownloads: true,
    });
    await context.addCookies([
      {
        name: "collection_test_user",
        value: `csv-${randomUUID()}`,
        url: origin,
      },
    ]);
    await context.addInitScript(() =>
      localStorage.setItem("notebook-language", "en"),
    );
    const page = await context.newPage();
    await page.goto(`${origin}/vocabulary`);
    const collection = page.getByRole("combobox", {
      name: "Collection",
      exact: true,
    });
    const openImport = page.getByRole("button", {
      name: "Import CSV",
      exact: true,
    });
    const openExport = page.getByRole("button", {
      name: "Export CSV",
      exact: true,
    });

    await collection.waitFor();
    if (!mobile) {
      await page
        .getByRole("button", { name: "New collection", exact: true })
        .click();
      await page
        .getByRole("textbox", { name: "Collection name" })
        .fill("Standalone");
      await page
        .getByRole("button", { name: "Create collection", exact: true })
        .click();
      await page
        .getByRole("heading", { name: "Standalone", exact: true })
        .waitFor();
      assert.equal(
        await collection.locator("option:checked").textContent(),
        "Standalone",
      );
      await openImport.click();
      await page.keyboard.press("Escape");
      assert.equal(await page.getByRole("dialog").count(), 0);
      assert.equal(
        await openImport.evaluate((el) => document.activeElement === el),
        true,
      );
    }

    for (const [name, filename, rows] of lessons) {
      await openImport.click();
      const dialog = page.getByRole("dialog", { name: "Import CSV" });
      const file = dialog.getByLabel("Choose CSV file");
      await file.setInputFiles({
        name: filename,
        mimeType: "text/csv",
        buffer: Buffer.from(fields + rows.join("\n")),
      });
      await dialog
        .getByRole("radio", { name: "New collection", exact: true })
        .check();
      await dialog.getByRole("textbox", { name: "Collection name" }).fill(name);
      await dialog.getByRole("button", { name: "Preview" }).click();
      const confirm = dialog.getByRole("button", {
        name: `Import ${rows.length} cards into ${name}`,
      });
      await confirm.waitFor();
      assert.equal(
        await dialog
          .getByRole("button", { name: `Valid (${rows.length})` })
          .count(),
        1,
      );
      assert.equal(await dialog.getByText(filename).count(), 1);
      assert.equal(
        await dialog.getByText("Private", { exact: true }).count(),
        1,
      );
      if (name === "Lezione 01" && width !== 320) {
        await page.screenshot({
          path: resolve(output, `csv-import-${width}.png`),
        });
      }
      await confirm.click();
      await page.getByRole("heading", { name, exact: true }).waitFor();
      assert.equal(
        await collection.locator("option:checked").textContent(),
        name,
      );
    }

    for (const [name, , rows] of lessons) {
      await collection.selectOption({ label: name });
      await page.getByRole("heading", { name, exact: true }).waitFor();
      await openExport.click();
      const dialog = page.getByRole("dialog", { name: "Export CSV" });
      await dialog.getByText(`${name} · ${rows.length} cards`).waitFor();
      const downloaded = page.waitForEvent("download");
      await dialog.getByRole("button", { name: "Export CSV" }).click();
      const download = await downloaded;
      assert.equal(download.suggestedFilename(), `${name}.csv`);
      const csv = await readFile(await download.path(), "utf8");
      const results = csv.trimEnd().split(/\r?\n/).slice(1);
      assert.equal(results.length, rows.length);
      for (const row of rows) {
        const [italian, greek] = row.split(",");
        assert.ok(
          results.some((line) => line.startsWith(`"${italian}","${greek}"`)),
          row,
        );
      }
      await dialog.waitFor({ state: "hidden" });
    }

    await collection.selectOption({ label: "Lezione 01" });
    await page
      .getByRole("heading", { name: "buongiorno", exact: true })
      .waitFor();
    await page
      .getByRole("status")
      .filter({ hasText: "CSV download started." })
      .waitFor({ state: "hidden" });
    if (width !== 320) {
      await page.screenshot({
        path: resolve(output, `collection-${width}.png`),
      });
    }

    await page.getByRole("searchbox").fill("buongiorno");
    await page
      .getByRole("heading", { name: "ciao", exact: true })
      .waitFor({ state: "hidden" });
    await openExport.click();
    const dialog = page.getByRole("dialog", { name: "Export CSV" });
    assert.equal(
      await dialog
        .getByRole("radio", { name: "Lezione 01 · 3 cards" })
        .isChecked(),
      true,
    );
    await dialog
      .getByRole("radio", { name: "Current filtered results · 1 card" })
      .waitFor();
    if (width !== 320) {
      await page.screenshot({
        path: resolve(output, `csv-export-${width}.png`),
      });
    }
    await dialog
      .getByRole("radio", { name: "Current filtered results · 1 card" })
      .check();
    const filteredDownload = page.waitForEvent("download");
    await dialog.getByRole("button", { name: "Export CSV" }).click();
    const filteredCsv = await readFile(
      await (await filteredDownload).path(),
      "utf8",
    );
    assert.match(filteredCsv, /"buongiorno","καλημέρα"/);
    assert.doesNotMatch(filteredCsv, /"ciao","γεια"/);
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      true,
    );
    await context.close();
    console.log(`CSV import/export verified at ${width}px`);
  }
} finally {
  await browser.close();
}
