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
function parseCsv(text) {
  return text
    .replace(/^\uFEFF/, "")
    .trimEnd()
    .split(/\r?\n/)
    .map((line) => {
      const cells = [];
      let cell = "";
      let quoted = false;
      for (let index = 0; index < line.length; index += 1) {
        const character = line[index];
        if (quoted) {
          if (character === '"' && line[index + 1] === '"') {
            cell += '"';
            index += 1;
          } else if (character === '"') quoted = false;
          else cell += character;
        } else if (character === '"') quoted = true;
        else if (character === ",") {
          cells.push(cell);
          cell = "";
        } else cell += character;
      }
      cells.push(cell);
      return cells;
    });
}

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
      const createDialog = page.getByRole("dialog", { name: "Import CSV" });
      await createDialog
        .getByRole("textbox", { name: "Collection name" })
        .fill("Standalone");
      await createDialog
        .getByRole("combobox", { name: "Collection languages" })
        .selectOption("el-it");
      const creation = page.waitForResponse(
        (response) =>
          new URL(response.url()).pathname === "/api/collections" &&
          response.request().method() === "POST",
      );
      await createDialog
        .getByRole("button", { name: "Create collection", exact: true })
        .click();
      await creation;
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
      await dialog
        .getByRole("combobox", { name: "Collection languages" })
        .selectOption("el-it");
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
        await dialog.getByText("Only you", { exact: true }).count(),
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
      const [header, ...results] = parseCsv(
        await readFile(await download.path(), "utf8"),
      );
      assert.equal(header[header.indexOf("csv_format")], "csv_format");
      assert.ok(header.includes("text_it"));
      assert.ok(header.includes("text_el"));
      assert.equal(results.length, rows.length);
      for (const row of rows) {
        const [italian, greek] = row.split(",");
        assert.ok(
          results.some(
            (cells) =>
              cells[header.indexOf("text_it")] === italian &&
              cells[header.indexOf("text_el")] === greek,
          ),
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
    const [filteredHeader, ...filteredRows] = parseCsv(
      await readFile(await (await filteredDownload).path(), "utf8"),
    );
    assert.equal(filteredRows.length, 1);
    assert.equal(
      filteredRows[0][filteredHeader.indexOf("text_it")],
      "buongiorno",
    );
    assert.equal(
      filteredRows[0][filteredHeader.indexOf("text_el")],
      "καλημέρα",
    );
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      true,
    );

    // CSV v2 round trip in a non-legacy Collection, including formula escaping
    // and Unicode text, through the Collections workspace.
    const workspace = (name) =>
      page
        .locator(".collection-box")
        .filter({ has: page.getByRole("heading", { name, exact: true }) });
    const createAndImport = async (name, pair) => {
      await page.goto(`${origin}/collections`);
      await page
        .getByRole("button", { name: "Create collection", exact: true })
        .click();
      const createDialog = page.getByRole("dialog", { name: "Import CSV" });
      await createDialog
        .getByRole("textbox", { name: "Collection name", exact: true })
        .fill(name);
      await createDialog
        .getByRole("combobox", { name: "Collection languages", exact: true })
        .selectOption({ label: pair });
      const creation = page.waitForResponse(
        (response) =>
          new URL(response.url()).pathname === "/api/collections" &&
          response.request().method() === "POST",
      );
      await createDialog
        .getByRole("button", { name: "Create collection", exact: true })
        .click();
      await creation;
      await workspace(name).waitFor();
      await workspace(name)
        .getByRole("button", { name: "Edit collection", exact: true })
        .click();
      await page
        .getByRole("button", { name: "Import CSV", exact: true })
        .click();
    };
    const confirmImport = async (dialog, name) => {
      const imported = page.waitForResponse(
        (response) =>
          new URL(response.url()).pathname === "/api/imports/confirm" &&
          response.request().method() === "POST",
      );
      await dialog.getByRole("button", { name }).click();
      assert.ok((await imported).ok());
      await dialog.waitFor({ state: "hidden" });
    };
    const openInVocabulary = async (name) => {
      await page.goto(`${origin}/vocabulary`);
      await page
        .getByRole("combobox", { name: "Collection", exact: true })
        .selectOption({ label: name });
    };
    await createAndImport("V2 Roundtrip", "English ↔ Danish");
    const v2Dialog = page.getByRole("dialog", { name: "Import CSV" });
    const v2Fields =
      "csv_format,source_language,target_language," +
      "card_source_language,card_target_language,text_en,text_da,word_type\n";
    await v2Dialog.getByLabel("Choose CSV file").setInputFiles({
      name: "v2.csv",
      mimeType: "text/csv",
      buffer: Buffer.from(
        v2Fields +
          'italian-notebook-v2,en,da,en,da,"\'=1+1","hej — καλημέρα",expression\n',
      ),
    });
    await v2Dialog.getByRole("button", { name: "Preview" }).click();
    const v2Confirm = v2Dialog.getByRole("button", {
      name: "Import 1 card into V2 Roundtrip",
    });
    await v2Confirm.waitFor();
    assert.equal(await v2Dialog.getByText("=1+1", { exact: true }).count(), 1);
    assert.equal(
      await v2Dialog.getByText("hej — καλημέρα", { exact: true }).count(),
      1,
    );
    await confirmImport(v2Dialog, "Import 1 card into V2 Roundtrip");
    await openInVocabulary("V2 Roundtrip");
    await page.getByText("=1+1", { exact: true }).waitFor();
    await page.getByText("hej — καλημέρα", { exact: true }).waitFor();
    await page.getByRole("button", { name: "Export CSV", exact: true }).click();
    const v2DownloadPromise = page.waitForEvent("download");
    await page
      .getByRole("dialog", { name: "Export CSV" })
      .getByRole("button", { name: "Export CSV" })
      .click();
    const v2Csv = await readFile(
      await (await v2DownloadPromise).path(),
      "utf8",
    );
    const [v2Header, ...v2Exported] = parseCsv(v2Csv);
    assert.equal(v2Exported.length, 1);
    assert.equal(v2Header[v2Header.indexOf("csv_format")], "csv_format");
    assert.ok(v2Exported[0][v2Header.indexOf("entry_id")]);
    assert.equal(v2Exported[0][v2Header.indexOf("text_en")], "'=1+1");
    assert.equal(v2Exported[0][v2Header.indexOf("text_da")], "hej — καλημέρα");
    assert.match(v2Csv, /"'=1\+1"/);

    await page.goto(`${origin}/collections`);
    await workspace("V2 Roundtrip")
      .getByRole("button", { name: "Edit collection", exact: true })
      .click();
    await page.getByRole("button", { name: "Import CSV", exact: true }).click();
    const repeatDialog = page.getByRole("dialog", { name: "Import CSV" });
    await repeatDialog.getByLabel("Choose CSV file").setInputFiles({
      name: "roundtrip.csv",
      mimeType: "text/csv",
      buffer: Buffer.from(v2Csv),
    });
    await repeatDialog.getByRole("button", { name: "Preview" }).click();
    await repeatDialog
      .getByRole("button", { name: "Duplicates (1)" })
      .waitFor();
    await page.keyboard.press("Escape");

    // The same v2 contract round-trips a non-legacy English–Greek Collection.
    await createAndImport("V2 Greek", "English ↔ Greek");
    const greekDialog = page.getByRole("dialog", { name: "Import CSV" });
    await greekDialog.getByLabel("Choose CSV file").setInputFiles({
      name: "v2-el.csv",
      mimeType: "text/csv",
      buffer: Buffer.from(
        "csv_format,source_language,target_language," +
          "card_source_language,card_target_language,text_en,text_el,word_type\n" +
          "italian-notebook-v2,en,el,en,el,welcome,καλωσορίσατε,expression\n",
      ),
    });
    await greekDialog.getByRole("button", { name: "Preview" }).click();
    await confirmImport(greekDialog, "Import 1 card into V2 Greek");
    await openInVocabulary("V2 Greek");
    await page.getByText("καλωσορίσατε", { exact: true }).waitFor();
    await page.getByRole("button", { name: "Export CSV", exact: true }).click();
    const greekDownloadPromise = page.waitForEvent("download");
    await page
      .getByRole("dialog", { name: "Export CSV" })
      .getByRole("button", { name: "Export CSV" })
      .click();
    const [greekHeader, ...greekExported] = parseCsv(
      await readFile(await (await greekDownloadPromise).path(), "utf8"),
    );
    assert.equal(greekExported.length, 1);
    assert.equal(greekExported[0][greekHeader.indexOf("text_en")], "welcome");
    assert.equal(
      greekExported[0][greekHeader.indexOf("text_el")],
      "καλωσορίσατε",
    );

    await context.close();
    console.log(`CSV import/export verified at ${width}px`);
  }
} finally {
  await browser.close();
}
