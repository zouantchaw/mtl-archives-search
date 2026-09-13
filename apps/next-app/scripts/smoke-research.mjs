import { chromium } from "playwright";
import fs from "node:fs";
import assert from "node:assert/strict";
const origin = process.argv[2] || "http://localhost:3001";
const dir = process.env.RESEARCH_REPORT_DIR || "/tmp/mtl-reading-room-browser";
fs.mkdirSync(dir, { recursive: true });
const browser = await chromium.launch({ headless: true });
const errors = [];
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
page.on("pageerror", (e) => errors.push(e.message));
async function settled() {
  await page
    .getByRole("button", { name: "Stop response", exact: true })
    .waitFor({ state: "hidden", timeout: 115000 });
  assert.equal(await page.locator("main [role=alert]").count(), 0);
}
try {
  await page.goto(`${origin}/research?lang=en`);
  await page
    .getByRole("button", { name: "Women beside helicopters", exact: true })
    .waitFor();
  await page.locator("main img").evaluateAll(images=>Promise.all(images.map(image=>image.decode())));
  await page.screenshot({ path: `${dir}/desktop-initial.png` });
  console.log("Public reading room loaded");
  await page
    .getByRole("button", { name: "Women beside helicopters", exact: true })
    .click();
  await page.locator("article").first().waitFor({ timeout: 115000 });
  await settled();
  assert.ok((await page.locator("article").count()) > 0);
  console.log(
    "Live search completed:",
    await page.locator("article").count(),
    "photos",
  );
  await page.locator("article img").evaluateAll(images=>Promise.all(images.slice(0,2).map(image=>image.decode())));
  await page.screenshot({ path: `${dir}/desktop-results.png` });
  const firstImage = await page
    .locator("article img")
    .first()
    .getAttribute("src");
  await page
    .getByRole("button", { name: "Pin photo", exact: true })
    .first()
    .click();
  await page.getByRole("button", { name: "Pinned 1", exact: true }).click();
  assert.equal(await page.locator("article").count(), 1);
  await page.reload();
  await page.getByRole("button", { name: "Pinned 1", exact: true }).waitFor();
  console.log("Pins and conversation restored");
  await page.getByRole("button", { name: "Pinned 1", exact: true }).click();
  assert.equal(
    await page.locator("article img").first().getAttribute("src"),
    firstImage,
  );
  await page
    .getByRole("button", { name: /^View photograph:/ })
    .first()
    .click();
  await page.getByRole("dialog").waitFor();
  assert.ok(
    await page
      .getByRole("link", { name: "Open archive page", exact: true })
      .getAttribute("href"),
  );
  await page.screenshot({ path: `${dir}/evidence.png` });
  await page.keyboard.press("Escape");
  assert.equal(await page.getByRole("dialog").count(), 0);
  await page.waitForFunction(()=>document.activeElement!==document.body,{},{timeout:1500});
  await page
    .getByRole("textbox", { name: "Ask the archive…" })
    .fill("Only the ones standing outside.");
  await page
    .getByRole("button", { name: "Send question", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Stop response", exact: true })
    .waitFor();
  await settled();
  const saved = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("mtl-reading-room-v1")),
  );
  const latest = saved.messages
    .flatMap((m) =>
      m.parts.filter(
        (p) =>
          p.type === "tool-searchArchive" && p.state === "output-available",
      ),
    )
    .at(-1).output;
  assert.match(latest.query + " " + latest.criteria, /women/i);
  assert.match(latest.query + " " + latest.criteria, /helicopter/i);
  console.log("Follow-up preserved women and helicopters");
  await page
    .getByRole("button", { name: /^View photograph:/ })
    .first()
    .click();
  await page
    .getByRole("button", {
      name: "What do we know about this photo?",
      exact: true,
    })
    .click();
  await page
    .getByRole("button", { name: "Stop response", exact: true })
    .waitFor();
  await settled();
  await page
    .getByRole("button", { name: /^Archival record ·/ })
    .last()
    .click();
  await page.getByRole("dialog").waitFor();
  assert.ok(
    await page
      .getByRole("heading", { name: "AI visual observation", exact: true })
      .count(),
  );
  await page.screenshot({ path: `${dir}/explained.png` });
  await page.keyboard.press("Escape");
  console.log("Fresh explanation and evidence drawer completed");
  fs.writeFileSync(
    `${dir}/conversation.txt`,
    await page.locator("body").innerText(),
  );
  // Deterministic failure state: a quota response must leave a usable composer.
  await page.route("**/api/research", (route) =>
    route.fulfill({
      status: 429,
      contentType: "application/json",
      body: JSON.stringify({
        error: "Daily limit reached. Please return tomorrow.",
      }),
    }),
  );
  await page
    .getByRole("textbox", { name: "Ask the archive…" })
    .fill("Another search");
  await page
    .getByRole("button", { name: "Send question", exact: true })
    .click();
  await page.locator("main [role=alert]").waitFor();
  await page.screenshot({ path: `${dir}/quota.png` });
  const mobile = await browser.newPage({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  mobile.on("pageerror", (e) => errors.push(e.message));
  await mobile.goto(`${origin}/research?lang=fr`);
  await mobile
    .getByRole("heading", { name: "Par où souhaitez-vous commencer ?" })
    .waitFor();
  assert.equal(
    await mobile.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
    false,
  );
  await mobile.screenshot({ path: `${dir}/mobile.png`, fullPage: true });
  await mobile
    .getByRole("button", { name: "Switch to English", exact: true })
    .click();
  await mobile
    .getByRole("heading", { name: "Where would you like to begin?" })
    .waitFor();
  assert.deepEqual(errors, []);
  console.log(
    "Mobile layout, language toggle, quota and browser error checks passed",
  );
  fs.writeFileSync(
    `${dir}/report.json`,
    JSON.stringify(
      { origin, firstImage, errors, completed: new Date().toISOString() },
      null,
      2,
    ),
  );
} catch (error) {
  fs.writeFileSync(
    `${dir}/failure.txt`,
    await page.locator("body").innerText(),
  );
  fs.writeFileSync(
    `${dir}/failure-state.json`,
    await page.evaluate(
      () => localStorage.getItem("mtl-reading-room-v1") || "{}",
    ),
  );
  await page.screenshot({ path: `${dir}/failure.png` });
  throw error;
} finally {
  await browser.close();
}
