// Run against a local app backed by a disposable database after seeding it.
// Requires Playwright. SHARED_PASSWORD and PROGRESS_BASE_URL must be supplied.
const assert = require("node:assert/strict");
const { chromium } = require("playwright");

async function main() {
  const baseURL = process.env.PROGRESS_BASE_URL;
  assert(
    baseURL && ["localhost", "127.0.0.1"].includes(new URL(baseURL).hostname),
  );
  assert(process.env.SHARED_PASSWORD);
  const browser = await chromium.launch({
    headless: true,
    ...(process.env.PLAYWRIGHT_CHANNEL
      ? { channel: process.env.PLAYWRIGHT_CHANNEL }
      : {}),
  });
  try {
    const page = await browser.newPage({ baseURL });
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const session = await (await page.request.get("/api/auth/session")).json();
    const headers = { "X-CSRF-Token": session.csrf_token };
    assert.equal(
      (
        await page.request.post("/api/auth/login", {
          headers,
          data: { password: process.env.SHARED_PASSWORD },
        })
      ).status(),
      200,
    );
    const profiles = await (await page.request.get("/api/profiles")).json();
    const profile = profiles[0];
    await page.addInitScript((id) => {
      localStorage.setItem("notebook-profile", id);
      localStorage.setItem("notebook-language", "en");
    }, profile.id);
    await page.goto("/");
    await page.getByLabel("Learner profile").selectOption(profile.id);
    await page.getByText("Vocabulary entries", { exact: true }).waitFor();
    const labels = {
      en: ["Progress", "By learning direction", "Learner profile"],
      el: ["Πρόοδος", "Ανά κατεύθυνση μάθησης", "Προφίλ μαθητή"],
      it: ["Progressi", "Per direzione di apprendimento", "Profilo studente"],
    };
    for (const width of [320, 390, 1280]) {
      await page.setViewportSize({ width, height: 850 });
      for (const language of ["en", "el", "it"]) {
        await page.locator(".language-picker select").selectOption(language);
        await page.locator('.main-navigation a[href="/progress"]').click();
        await page
          .getByRole("heading", { name: labels[language][0], exact: true })
          .waitFor();
        await page.getByRole("region", { name: labels[language][1] }).waitFor();
        const overflow = await page.evaluate(
          () => document.documentElement.scrollWidth > window.innerWidth,
        );
        assert.equal(overflow, false, `${language} at ${width}px overflows`);
        const select = page.locator("#progress-profile");
        await select.focus();
        assert.equal(
          await select.evaluate((el) => el === document.activeElement),
          true,
        );
        await page.keyboard.press("Tab");
        const target = await page.evaluate(() => ({
          tag: document.activeElement.tagName,
          box: document.activeElement.getBoundingClientRect().toJSON(),
        }));
        assert.equal(target.tag, "A");
        assert(
          target.box.width >= 44 && target.box.height >= 44,
          "Practice action needs a touch-sized target",
        );
        await page.locator('.main-navigation a[href="/"]').click();
        await page.getByRole("heading", { level: 1 }).waitFor();
        assert.equal(
          await page.evaluate(
            () => document.documentElement.scrollWidth > window.innerWidth,
          ),
          false,
        );
      }
    }
    assert.deepEqual(errors, []);
    console.log(
      "Home and Progress: 320/390/1280px, Greek/English/Italian, keyboard focus, touch targets and no page errors passed.",
    );
  } finally {
    await browser.close();
  }
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
