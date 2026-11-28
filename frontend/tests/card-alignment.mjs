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

const adjective = {
  ...italianCard,
  id: "card-three",
  word_type: "adjective",
  source_text: "ψηλός",
  target_text: "alto",
  italian_feminine_singular: "alta",
  italian_masculine_plural: "alti",
  italian_feminine_plural: "alte",
  italian_example: Array.from(
    { length: 20 },
    () => "Gli alberi sono alti.",
  ).join("\n"),
};
const reviews = [];
let loseReview = false;

function session(direction) {
  const snapshot = direction === "greek_to_italian" ? italianCard : arabicCard;
  return {
    id: `session-${direction}`,
    profile_id: profile.id,
    direction,
    requested_size: null,
    available: 1,
    active_count: 1,
    cards: [
      snapshot,
      direction === "greek_to_italian" ? adjective : arabicCard,
    ].map((entry, position) => ({
      position,
      entry_id: entry.id,
      snapshot: entry,
      skipped: false,
    })),
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
    if (path.endsWith("/summary"))
      body = {
        total: 2,
        counts: { easy: 0, hard: 1, again: 1 },
        remembered: 50,
        needs_practice: [],
      };
    if (path.endsWith("/reviews")) {
      reviews.push(JSON.parse(payload));
      if (loseReview) {
        loseReview = false;
        res.statusCode = 503;
        body = { detail: "Review response unavailable" };
      }
    }
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

async function verifyGestures(context, page, mobile) {
  const cdp = mobile ? await context.newCDPSession(page) : null;
  const touch = (type, x, y) =>
    cdp.send("Input.dispatchTouchEvent", {
      type,
      touchPoints: /End|Cancel/.test(type) ? [] : [{ x, y }],
    });
  const card = page.locator(".flashcard");
  const answer = page.locator(".card-answer h2");
  const reveal = page.getByRole("button", { name: "Tap to reveal answer" });
  const drag = async (surface, dx, dy) => {
    await surface.scrollIntoViewIfNeeded();
    const box = await surface.boundingBox();
    const x = box.x + box.width / 2;
    const y = box.y + Math.min(box.height / 2, 60);
    if (mobile) {
      await touch("touchStart", x, y);
      await touch("touchMove", x + dx, y + dy);
    } else {
      await page.mouse.move(x, y);
      await page.mouse.down();
      await page.mouse.move(x + dx, y + dy, { steps: 4 });
    }
  };
  const release = () => (mobile ? touch("touchEnd") : page.mouse.up());
  const screenshot = async (name) => {
    if (process.env.MOBILE_SCREENSHOT_DIR)
      await page.screenshot({
        fullPage: name === "adjective",
        path: resolve(
          process.env.MOBILE_SCREENSHOT_DIR,
          `lexi-gesture-${mobile ? "mobile" : "desktop"}-${name}.png`,
        ),
      });
  };
  const base = reviews.length;
  await startPractice(page, "greek_to_italian");
  await screenshot("unrevealed");
  await drag(reveal, 110, 0);
  await release();
  assert.equal(await answer.count(), 0, "Unrevealed drag must not reveal");
  assert.equal(reviews.length, base);

  const promptBox = await card.locator(".card-prompt").boundingBox();
  const x = promptBox.x + promptBox.width / 2;
  const y = promptBox.y + promptBox.height / 2;
  if (mobile) await page.touchscreen.tap(x, y);
  else await page.mouse.click(x, y);
  await answer.waitFor();
  await screenshot("revealed");
  await drag(answer, 26, 0);
  await screenshot("short-drag");
  await release();
  await page.waitForFunction(
    () =>
      getComputedStyle(document.querySelector(".flashcard")).transform ===
      "matrix(1, 0, 0, 1, 0, 0)",
  );
  await screenshot("returned");
  await drag(answer, 100, -100);
  await release();
  assert.equal(reviews.length, base, "Short and diagonal drags must not rate");

  for (const [rating, dx, dy] of [
    ["hard", -130, 0],
    ["easy", 130, 0],
    ["again", 0, -125],
  ]) {
    await drag(answer, dx, dy);
    await page.locator(`.flashcard[data-drag-rating="${rating}"]`).waitFor();
    await screenshot(rating);
    if (mobile) await touch("touchCancel");
    else {
      await answer.evaluate((el) =>
        el.dispatchEvent(
          new PointerEvent("pointercancel", {
            pointerId: 1,
            bubbles: true,
          }),
        ),
      );
      await release();
    }
    await card.locator("xpath=self::*[not(@data-dragging)]").waitFor();
  }
  assert.equal(reviews.length, base, "Cancelled gestures must not rate");

  loseReview = true;
  await drag(answer, 130, 0);
  await release();
  // A competing input during the request must not add a second review.
  await page.getByRole("button", { name: "Hard" }).dispatchEvent("click");
  await page.getByRole("alert").waitFor();
  assert.equal(await answer.textContent(), "casa");
  assert.deepEqual(reviews.slice(base), [
    { direction: "greek_to_italian", rating: "easy" },
  ]);
  await page.getByRole("button", { name: "Retry", exact: true }).click();
  await reveal.waitFor();
  assert.deepEqual(
    reviews.slice(base),
    Array(2).fill({ direction: "greek_to_italian", rating: "easy" }),
  );
  assert.equal(await card.locator(".card-prompt").textContent(), "ψηλός");
  await screenshot("next");

  await reveal.click();
  await page.getByText("alte", { exact: false }).first().waitFor();
  await screenshot("adjective");
  if (mobile) {
    const example = page.getByText("Gli alberi sono alti.", { exact: false });
    await example.scrollIntoViewIfNeeded();
    const before = await page.evaluate(() => scrollY);
    await drag(example, 0, -125);
    await release();
    await page.waitForFunction((y) => scrollY > y, before);
    assert.equal(reviews.length, base + 2, "Scrolling grammar must not rate");
  }

  await page.emulateMedia({ reducedMotion: "reduce" });
  await startPractice(page, "en_to_ar");
  await page.locator("#practice-direction").selectOption("ar_to_en");
  await reveal.click();
  await answer.waitFor();
  assert.equal(
    await card.evaluate((el) => getComputedStyle(el).transitionDuration),
    "0s",
  );
  assert.equal(
    await answer.evaluate(
      (el) => getComputedStyle(el.parentElement).animationName,
    ),
    "none",
  );
  if (mobile) {
    await drag(answer, 0, -125);
    await release();
  } else {
    await answer.press("ArrowUp");
  }
  await reveal.waitFor();
  assert.deepEqual(reviews.at(-1), { direction: "ar_to_en", rating: "again" });
  await reveal.click();
  await answer.waitFor();
  await drag(answer, -130, 0);
  await release();
  await page.getByRole("heading", { name: "Session summary" }).waitFor();
  assert.deepEqual(reviews.at(-1), { direction: "ar_to_en", rating: "hard" });
  assert.equal(reviews.length, base + 4);
  await cdp?.detach();
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

    await page.getByRole("button", { name: "Tap to reveal answer" }).click();
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
    await page.getByRole("button", { name: "Tap to reveal answer" }).click();
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
    await page.getByRole("button", { name: "Tap to reveal answer" }).click();
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
    await verifyGestures(context, page, width < 540);
    assert.deepEqual(errors, []);
    console.log(
      `${width}px: centered prompt/answer, start-aligned metadata, stable geometry, RTL scripts and practice gestures passed`,
    );
    await context.close();
  }
} finally {
  await browser.close();
  server.close();
}
