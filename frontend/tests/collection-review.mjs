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
    const name = `Review ${width}-${randomUUID().slice(0, 6)}`;
    await page.goto(origin + "/collections");
    await page
      .getByRole("textbox", { name: "Collection name", exact: true })
      .fill(name);
    const creation = page.waitForResponse(
      (r) =>
        new URL(r.url()).pathname === "/api/collections" &&
        r.request().method() === "POST",
    );
    await page
      .getByRole("button", { name: "Create collection", exact: true })
      .click();
    const collection = await (await creation).json();
    await page
      .getByRole("button", { name: "Create card", exact: true })
      .click();
    await page
      .getByRole("textbox", { name: "Italian", exact: true })
      .fill("ciao");
    await page
      .getByRole("textbox", { name: "Greek", exact: true })
      .fill("γεια");
    const creationCard = page.waitForResponse(
      (r) =>
        new URL(r.url()).pathname.endsWith("/cards") &&
        r.request().method() === "POST",
    );
    await page.getByRole("button", { name: "Save", exact: true }).click();
    const entry = await (await creationCard).json();
    assert.equal(entry.source_language, "it");
    assert.equal(entry.source_text, "ciao");
    await page
      .getByRole("button", { name: "Publish collection", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Confirm publication", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Unpublish collection", exact: true })
      .waitFor();
    const another = await api(a, "/api/collections", {
      name: `Second ${name}`,
    });
    await api(a, `/api/collections/${another.id}/entries`, {
      entry_id: entry.id,
    });
    await publish(a, another.id);

    await page.goto(origin + "/vocabulary");
    await page.locator(".collection-panel summary").click();
    await page.locator(".collection-panel select").selectOption(collection.id);
    await page
      .locator('.entry-card h2[lang="it"]')
      .filter({ hasText: /^ciao$/ })
      .waitFor();
    assert.equal(
      await page.locator('.entry-card p[lang="el"]').innerText(),
      "γεια",
    );
    const csv = await a.request.get(origin + "/api/vocabulary/export.csv");
    assert.match(await csv.text(), /"ciao","γεια"/);
    await page
      .getByRole("button", { name: "Card actions: ciao", exact: true })
      .click();
    await page
      .getByRole("menuitem", { name: "Edit card: ciao", exact: true })
      .click();
    const save = page.waitForResponse(
      (r) =>
        new URL(r.url()).pathname === `/api/vocabulary/${entry.id}` &&
        r.request().method() === "PATCH",
    );
    await page.getByRole("button", { name: "Save card", exact: true }).click();
    assert.equal((await save).status(), 200);

    await page.goto(origin + "/practice?direction=italian_to_greek");
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
      ["italian_to_greek", "ciao", "γεια"],
      ["greek_to_italian", "γεια", "ciao"],
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

    await page.goto(origin + "/collections");
    await page
      .getByLabel(`Select for practice: ${name}`, { exact: true })
      .check();
    for (const [option, prompt, answer] of [
      ["forward", "γεια", "ciao"],
      ["reverse", "ciao", "γεια"],
    ]) {
      await page
        .getByRole("combobox", { name: /^Practice direction/ })
        .selectOption(option);
      await page
        .getByRole("button", {
          name: "Practise selected collections",
          exact: true,
        })
        .click();
      await page.getByRole("heading", { name: prompt, exact: true }).waitFor();
      await page
        .getByRole("button", { name: "Show answer", exact: true })
        .click();
      assert.equal(
        await page.locator(".collection-answer").innerText(),
        answer,
      );
      await page
        .getByRole("button", { name: "Back to collections", exact: true })
        .click();
    }

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
    const panel = page
      .locator("article.collection-box")
      .filter({ has: page.getByRole("heading", { name, exact: true }) });
    await panel.getByRole("button", { name: "Open", exact: true }).click();
    await page
      .getByRole("button", { name: "Unpublish collection", exact: true })
      .click();
    await page
      .getByRole("region", { name: "Confirm unpublishing", exact: true })
      .waitFor();
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({
      path: resolve(output, `unpublish-preview-${width}.png`),
      fullPage: true,
    });
    await page
      .getByRole("button", { name: "Confirm unpublishing", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Publish collection", exact: true })
      .waitFor();
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
      `PASS ${width}px: workspace → Vocabulary/CSV → both practice screens/directions; owner edit; grant withdrawal and restored difficulty`,
    );
  }
} finally {
  await browser.close();
}
