/** Review acceptance on the real loopback API; synthetic verified identities only. */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { mkdir } from "node:fs/promises";
import { chromium } from "playwright";
const origin = process.env.COLLECTION_TEST_ORIGIN || "http://127.0.0.1:8137";
assert.equal(new URL(origin).hostname, "127.0.0.1");
const output = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../.scratch/collections",
);
await mkdir(output, { recursive: true });
const browser = await chromium.launch();
async function chooseLanguage(dialog, index, language) {
  const picker = dialog.locator(".language-combobox").nth(index);
  await picker.getByRole("combobox").fill(language);
  await picker
    .getByRole("option", { name: new RegExp(`^${language}`) })
    .click();
}
async function api(context, path, body, method = "POST") {
  const r = await context.request.fetch(origin + path, {
    method,
    headers: { "X-CSRF-Token": "supertokens" },
    ...(body !== undefined ? { data: body } : {}),
  });
  assert.ok(r.ok(), `${method} ${path}: ${r.status()}`);
  return r.status() === 204 ? null : r.json();
}
async function publish(context, id) {
  const preview = await api(
    context,
    `/api/collections/${id}/publish-preview`,
    undefined,
    "GET",
  );
  return api(context, `/api/collections/${id}/publish`, {
    preview_token: preview.preview_token,
    confirm_private_ids: preview.private_cards.map((e) => e.id),
  });
}
async function user(width) {
  const c = await browser.newContext({ viewport: { width, height: 1000 } });
  await c.addCookies([
    {
      name: "collection_test_user",
      value: `review-${randomUUID()}`,
      url: origin,
    },
  ]);
  await c.addInitScript(() => localStorage.setItem("notebook-language", "en"));
  return c;
}
try {
  for (const width of [1280, 390]) {
    const a = await user(width),
      b = await user(width);
    const page = await a.newPage();
    const label = randomUUID().slice(0, 6);
    const name = `Review ${width}-${label}`;
    const source = `ciao-${label}`;
    const target = `γεια-${label}`;
    await page.goto(origin + "/collections");
    await page
      .getByRole("button", { name: "Create collection", exact: true })
      .click();
    const createDialog = page.getByRole("dialog", { name: "Import CSV" });
    await createDialog
      .getByRole("textbox", { name: "Collection name", exact: true })
      .fill(name);
    await chooseLanguage(createDialog, 0, "Greek");
    await chooseLanguage(createDialog, 1, "Italian");
    const creation = page.waitForResponse(
      (r) =>
        new URL(r.url()).pathname === "/api/collections" &&
        r.request().method() === "POST",
    );
    await createDialog
      .getByRole("button", { name: "Create collection", exact: true })
      .click();
    const collection = await (await creation).json();
    const entry = await api(a, `/api/collections/${collection.id}/cards`, {
      source_text: source,
      target_text: target,
      source_language: "it",
      target_language: "el",
    });
    assert.equal(entry.source_language, "it");
    assert.equal(entry.source_text, source);
    const panel = page
      .locator("article.collection-box")
      .filter({ has: page.getByRole("heading", { name, exact: true }) });
    const visibleAs = (value) =>
      panel.locator("p").first().filter({ hasText: value }).waitFor();
    await panel
      .getByRole("button", { name: "Edit collection", exact: true })
      .click();
    const editor = page.getByRole("dialog", {
      name: "Edit collection",
      exact: true,
    });
    await editor.getByRole("switch", { name: "Collection visibility" }).click();
    const publishDialog = page.getByRole("dialog", {
      name: "Publish collection",
      exact: true,
    });
    await publishDialog
      .getByRole("button", { name: "Publish", exact: true })
      .click();
    await publishDialog.waitFor({ state: "hidden" });
    await visibleAs("Public");
    const another = await api(a, "/api/collections", {
      name: `Second ${name}`,
    });
    await api(a, `/api/collections/${another.id}/entries`, {
      entry_id: entry.id,
    });
    await publish(a, another.id);

    await page.goto(origin + "/vocabulary");
    await page
      .getByRole("combobox", { name: "Collection", exact: true })
      .selectOption(collection.id);
    await page
      .locator('.entry-card h2[lang="it"]')
      .filter({ hasText: source })
      .waitFor();
    assert.equal(
      await page.locator('.entry-card p[lang="el"]').innerText(),
      target,
    );
    const csv = await a.request.get(origin + "/api/vocabulary/export.csv");
    assert.ok((await csv.text()).includes(`"${source}","${target}"`));
    await page
      .getByRole("combobox", { name: "Collection", exact: true })
      .selectOption("");
    await page
      .getByRole("button", { name: `Card actions: ${source}`, exact: true })
      .click();
    await page
      .getByRole("menuitem", { name: `Edit card: ${source}`, exact: true })
      .click();
    const save = page.waitForResponse(
      (r) =>
        new URL(r.url()).pathname === `/api/vocabulary/${entry.id}` &&
        r.request().method() === "PATCH",
    );
    await page.getByRole("button", { name: "Save card", exact: true }).click();
    assert.equal((await save).status(), 200);

    await page.goto(origin + "/practice?direction=italian_to_greek");
    await page
      .locator("label.setup-option")
      .filter({ hasText: "With filters" })
      .click();
    await page
      .getByRole("group", { name: "Collections", exact: true })
      .getByRole("checkbox", { name, exact: true })
      .check();
    const queued = page.waitForResponse(
      (r) =>
        new URL(r.url()).pathname === "/api/sessions" &&
        r.request().method() === "POST",
    );
    await page
      .getByRole("button", { name: "Start practice", exact: true })
      .click();
    const legacyQueue = await (await queued).json();
    assert.ok(legacyQueue.cards.some((c) => c.entry_id === entry.id));
    for (const [direction, prompt, answer] of [
      ["italian_to_greek", source, target],
      ["greek_to_italian", target, source],
    ]) {
      await page
        .getByLabel("Learning direction", { exact: true })
        .selectOption(direction);
      assert.equal(await page.locator(".card-prompt").innerText(), prompt);
      await page.getByRole("button", { name: /Reveal answer/ }).click();
      assert.equal(await page.locator(".card-answer h2").innerText(), answer);
    }
    await page.screenshot({
      path: resolve(output, `legacy-practice-${width}.png`),
      fullPage: true,
    });

    const accountB = (await api(b, "/api/auth/session", undefined, "GET"))
      .account;
    const reference = await api(b, "/api/collections", {
      name: `Foreign ${name}`,
    });
    await api(b, `/api/collections/${reference.id}/entries`, {
      entry_id: entry.id,
    });
    await publish(b, reference.id);
    const queue = await api(b, "/api/sessions", {
      profile_id: accountB.profile_id,
      collection_ids: [reference.id],
      direction: "italian_to_greek",
      size: null,
    });
    await api(b, `/api/sessions/${queue.id}/cards/0/reveal`, {
      direction: "italian_to_greek",
    });
    await api(b, `/api/sessions/${queue.id}/cards/0/reviews`, {
      direction: "italian_to_greek",
      rating: "hard",
    });
    await page.goto(origin + "/collections");
    await visibleAs("Public");
    await panel
      .getByRole("button", { name: "Edit collection", exact: true })
      .click();
    await editor.getByRole("switch", { name: "Collection visibility" }).click();
    const unpublishDialog = page.getByRole("dialog", {
      name: "Confirm unpublishing",
      exact: true,
    });
    await unpublishDialog.waitFor();
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({
      path: resolve(output, `unpublish-preview-${width}.png`),
      fullPage: true,
    });
    await unpublishDialog
      .getByRole("button", { name: "Confirm unpublishing", exact: true })
      .click();
    await unpublishDialog.waitFor({ state: "hidden" });
    await visibleAs("Private");
    assert.equal(
      (await b.request.get(origin + `/api/vocabulary/${entry.id}`)).status(),
      200,
    );
    await api(
      a,
      `/api/collections/${another.id}/entries/${entry.id}`,
      undefined,
      "DELETE",
    );
    assert.equal(
      (await b.request.get(origin + `/api/vocabulary/${entry.id}`)).status(),
      404,
    );
    const stale = await api(b, `/api/sessions/${queue.id}`, undefined, "GET");
    assert.equal(stale.cards[0].snapshot, null);
    await publish(a, collection.id);
    const difficult = await api(b, "/api/sessions", {
      profile_id: accountB.profile_id,
      collection_ids: [reference.id, collection.id],
      direction: "italian_to_greek",
      mode: "difficult",
      size: null,
    });
    assert.equal(difficult.available, 1);
    assert.equal(difficult.cards[0].entry_id, entry.id);
    await a.close();
    await b.close();
    console.log(
      `PASS ${width}px: workspace → Vocabulary/CSV → legacy practice/directions; owner edit; grant withdrawal and restored difficulty`,
    );
  }
} finally {
  await browser.close();
}
