// Run against `pnpm dev --host 127.0.0.1`. Supply PLAYWRIGHT_MODULE when the
// optional browser test dependency is installed outside this package.
import assert from "node:assert/strict";
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
const browser = await chromium.launch({
  ...(process.env.BROWSER_EXECUTABLE ? { executablePath: process.env.BROWSER_EXECUTABLE } : {}),
  headless: true,
});
try {
  for (const mode of ["wide", "wide-delayed", "compact"]) {
    const page = await browser.newPage({ viewport: { width: mode === "compact" ? 390 : 1360, height: 900 } });
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.route("**/__menu-check*", route => route.fulfill({ contentType: "text/html", body: `
      <div id="root"></div><script type="module">
      import RefreshRuntime from '/@react-refresh';
      RefreshRuntime.injectIntoGlobalHook(window);
      window.$RefreshReg$ = () => {};
      window.$RefreshSig$ = () => type => type;
      window.__vite_plugin_react_preamble_installed__ = true;
      await import('/test/fixtures/menu-browser.tsx');</script>` }));
    await page.goto(`${process.env.TEST_BASE_URL || "http://127.0.0.1:1420"}/__menu-check?${mode}`);
    if (mode.includes("delayed")) await page.getByRole("button", { name: "Open settings", exact: true }).click();
    await page.getByRole("combobox").click();
    await page.getByRole("option", { name: "Chinese", exact: true }).click();
    assert.equal(await page.locator("output").innerText(), "b");
    await page.getByRole("combobox").click();
    await page.getByRole("option", { name: "English", exact: true }).waitFor({ state: "visible" });
    await page.keyboard.press("Escape");
    assert.ok(await page.getByRole("combobox").isVisible(), "Escape closes only the menu");
    await page.getByRole("button", { name: "Close settings", exact: true }).click();
    await page.getByRole("button", { name: "Open settings", exact: true }).click();
    await page.getByRole("combobox").click();
    await page.getByRole("option", { name: "English", exact: true }).click();
    assert.equal(await page.locator("output").innerText(), "a");
    assert.deepEqual(errors, []);
    console.log(`PASS ${mode}: selection, Escape, close and reopen`);
    await page.close();
  }
} finally { await browser.close(); }
