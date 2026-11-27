/** Shared flashcard alignment across widths, reveal, direction and scripts. */
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium } from "playwright";
import { REGISTRY_PAYLOAD } from "../src/language-fixtures.js";

const profile = {
  id: "learner",
  display_name: "Learner",
  preferred_direction: "en_to_ar",
  default_session_size: null,
};
const arabicCard = {
  id: "card-one",
  source_language: "en",
  target_language: "ar",
  source_text:
    "a deliberately long expression that wraps across several lines inside the card",
  target_text: "عبارة طويلة عن قصد تتنفس على عدة أسطر داخل البطاقة",
  word_type: "expression",
};
const italianCard = {
  id: "card-two",
  source_language: "el",
  target_language: "it",
  source_text: "σπίτι",
  target_text: "casa",
  word_type: "noun",
  italian_gender: "feminine",
  italian_plural: "case",
  italian_example: "La casa è grande.",
  pronunciation: "KA-za",
};

function session(direction) {
  const snapshot = direction === "greek_to_italian" ? italianCard : arabicCard;
  return {
    id: `session-${direction}`,
    profile_id: profile.id,
    direction,
    requested_size: null,
    available: 1,
    active_count: 1,
    cards: [{ position: 0, entry_id: snapshot.id, snapshot, skipped: false }],
  };
}

const server = createServer(async (req, res) => {
  const path = new URL(req.url, "http://localhost").pathname;
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const payload = Buffer.concat(chunks).toString("utf8");
  res.setHeader("Cache-Control", "no-store");
  if (path.startsWith("/api/")) {
    let body = {};
    if (path === "/api/languages") body = REGISTRY_PAYLOAD;
    if (path === "/api/auth/session")
      body = {
        authenticated: true,
        csrf_token: "test",
        account: {
          id: "account",
          role: "learner",
          legacy_access: false,
          interface_language: "en",
          profile_id: profile.id,
          display_name: profile.display_name,
        },
      };
    if (path === "/api/profiles") body = [profile];
    if (path === "/api/collections") body = [];
    if (path === "/api/practice/available-pairs")
      body = {
        pairs: [
          {
            key: "ar-en",
            languages: ["ar", "en"],
            directions: ["en_to_ar", "ar_to_en"],
            card_count: 1,
          },
          {
            key: "el-it",
            languages: ["el", "it"],
            directions: ["greek_to_italian", "italian_to_greek"],
            card_count: 1,
          },
        ],
      };
    if (path === "/api/sessions" && req.method === "POST")
      body = session(JSON.parse(payload).direction);
    if (/^\/api\/sessions\/[^/]+\/cards\/\d+\/(reveal|reviews)$/.test(path))
      body = {};
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify(body));
    return;
  }
  const file =
    path === "/" || !path.split("/").at(-1).includes(".")
      ? "/index.html"
      : path;
  try {
    const bytes = await readFile(resolve("dist", `.${file}`));
    res.setHeader(
      "Content-Type",
      file.endsWith(".js")
        ? "text/javascript"
        : file.endsWith(".css")
          ? "text/css"
          : "text/html",
    );
    res.end(bytes);
  } catch {
    res.writeHead(404);
    res.end();
  }
});
await new Promise((done) => server.listen(0, "127.0.0.1", done));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH,
});

const near = (actual, expected, label) =>
  assert.ok(
    Math.abs(actual - expected) <= 0.5,
    `${label}: expected ${expected}, got ${actual}`,
  );

async function box(locator) {
  return locator.evaluate((el) => {
    const rect = el.getBoundingClientRect();
    const style = getComputedStyle(el);
    return {
      x: rect.x,
      width: rect.width,
      center: rect.x + rect.width / 2,
      textAlign: style.textAlign,
      direction: style.direction,
      fontFamily: style.fontFamily,
    };
  });
}

async function cardBox(page) {
  return page.locator(".flashcard").evaluate((el) => {
    const rect = el.getBoundingClientRect();
    const style = getComputedStyle(el);
    const left =
      rect.left +
      parseFloat(style.borderLeftWidth) +
      parseFloat(style.paddingLeft);
    const right =
      rect.right -
      parseFloat(style.borderRightWidth) -
      parseFloat(style.paddingRight);
    return {
      x: rect.x,
      width: rect.width,
      center: (left + right) / 2,
      contentLeft: left,
      contentWidth: right - left,
      background: style.backgroundImage,
    };
  });
}

async function centeredText(page, selector, card, label) {
  const text = await box(page.locator(selector));
  assert.equal(text.textAlign, "center", `${label} is not centered`);
  near(text.center, card.center, `${label} center`);
  near(text.x, card.contentLeft, `${label} left edge`);
  near(text.width, card.contentWidth, `${label} full width`);
  return text;
}

async function wrappedLinesCentered(page, selector, card, label) {
  const lines = await page.locator(selector).evaluate((el) => {
    const range = document.createRange();
    range.selectNodeContents(el);
    return [...range.getClientRects()]
      .filter((rect) => rect.width > 0)
      .map((rect) => rect.left + rect.width / 2);
  });
  assert.ok(lines.length > 1, `${label} did not wrap into multiple lines`);
  for (const [index, center] of lines.entries())
    near(center, card.center, `${label} wrapped line ${index}`);
}

async function startPractice(page, direction) {
  await page.goto(`${origin}/practice?direction=${direction}`);
  await page.getByRole("button", { name: "Start practice" }).click();
  await page.locator(".flashcard .card-prompt").waitFor();
}

try {
  for (const width of [390, 1280]) {
    const context = await browser.newContext({
      viewport: { width, height: 900 },
      isMobile: width < 540,
      hasTouch: width < 540,
      serviceWorkers: "block",
    });
    await context.addInitScript(() =>
      localStorage.setItem("notebook-language", "en"),
    );
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await startPractice(page, "en_to_ar");

    const beforeCard = await cardBox(page);
    assert.match(
      beforeCard.background,
      /repeating-linear-gradient/,
      `${width}px: notebook background changed`,
    );
    assert.equal(
      await page
        .locator(".card-metadata")
        .evaluate((el) => getComputedStyle(el).textAlign),
      "start",
      `${width}px: word type label is not start-aligned`,
    );
    const prompt = await centeredText(
      page,
      ".flashcard .card-prompt",
      beforeCard,
      `${width}px prompt`,
    );
    assert.equal(prompt.direction, "ltr");
    await wrappedLinesCentered(
      page,
      ".flashcard .card-prompt",
      beforeCard,
      `${width}px wrapped prompt`,
    );

    if (process.env.MOBILE_SCREENSHOT_DIR) {
      await mkdir(process.env.MOBILE_SCREENSHOT_DIR, { recursive: true });
      await page.screenshot({
        path: resolve(
          process.env.MOBILE_SCREENSHOT_DIR,
          `lexi-card-${width}-prompt.png`,
        ),
      });
    }

    await page.getByRole("button", { name: "Reveal answer" }).click();
    await page.locator(".flashcard .card-answer h2").waitFor();
    const revealedCard = await cardBox(page);
    near(revealedCard.x, beforeCard.x, `${width}px card x after reveal`);
    near(
      revealedCard.width,
      beforeCard.width,
      `${width}px card width after reveal`,
    );
    const promptAfter = await centeredText(
      page,
      ".flashcard .card-prompt",
      revealedCard,
      `${width}px prompt after reveal`,
    );
    near(promptAfter.x, prompt.x, `${width}px prompt x after reveal`);
    const answer = await centeredText(
      page,
      ".flashcard .card-answer h2",
      revealedCard,
      `${width}px answer`,
    );
    assert.equal(answer.direction, "rtl");
    assert.match(answer.fontFamily, /Noto Sans Arabic/);
    await wrappedLinesCentered(
      page,
      ".flashcard .card-answer h2",
      revealedCard,
      `${width}px wrapped Arabic answer`,
    );
    assert.equal(
      await page
        .locator(".card-answer")
        .evaluate((el) => getComputedStyle(el).borderTopWidth),
      "1px",
      `${width}px: answer separator changed`,
    );

    if (process.env.MOBILE_SCREENSHOT_DIR)
      await page.screenshot({
        path: resolve(
          process.env.MOBILE_SCREENSHOT_DIR,
          `lexi-card-${width}-revealed.png`,
        ),
      });

    await page.locator("#practice-direction").selectOption("ar_to_en");
    await page.locator(".flashcard .card-prompt").waitFor();
    const reversedCard = await cardBox(page);
    near(
      reversedCard.x,
      beforeCard.x,
      `${width}px card x after direction switch`,
    );
    near(
      reversedCard.width,
      beforeCard.width,
      `${width}px card width after direction switch`,
    );
    const reversedPrompt = await centeredText(
      page,
      ".flashcard .card-prompt",
      reversedCard,
      `${width}px reversed prompt`,
    );
    assert.equal(reversedPrompt.direction, "rtl");
    await wrappedLinesCentered(
      page,
      ".flashcard .card-prompt",
      reversedCard,
      `${width}px wrapped RTL prompt`,
    );
    await page.getByRole("button", { name: "Reveal answer" }).click();
    await page.locator(".flashcard .card-answer h2").waitFor();
    const reversedAnswer = await centeredText(
      page,
      ".flashcard .card-answer h2",
      reversedCard,
      `${width}px reversed answer`,
    );
    assert.equal(reversedAnswer.direction, "ltr");
    await wrappedLinesCentered(
      page,
      ".flashcard .card-answer h2",
      reversedCard,
      `${width}px wrapped reversed answer`,
    );

    await startPractice(page, "greek_to_italian");
    await page.getByRole("button", { name: "Reveal answer" }).click();
    await page.locator(".card-detail-groups").waitFor();
    const grammarCard = await cardBox(page);
    await centeredText(
      page,
      ".flashcard .card-answer h2",
      grammarCard,
      `${width}px Italian answer`,
    );
    for (const selector of [
      ".card-metadata",
      ".card-answer dl",
      ".card-answer dd[dir]",
    ]) {
      assert.equal(
        await page
          .locator(selector)
          .first()
          .evaluate((el) => getComputedStyle(el).textAlign),
        "start",
        `${width}px: ${selector} is not start-aligned`,
      );
    }
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      true,
      `${width}px: flashcard overflows horizontally`,
    );
    assert.deepEqual(errors, []);
    console.log(
      `${width}px: centered prompt/answer, start-aligned metadata, stable geometry and RTL scripts passed`,
    );
    await context.close();
  }
} finally {
  await browser.close();
  server.close();
}
