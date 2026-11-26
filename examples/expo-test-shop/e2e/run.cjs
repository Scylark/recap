const { chromium, devices } = require('playwright');
const BASE = 'http://localhost:8099';
(async () => {
  const browser = await chromium.launch();
  const out = [];
  async function user(name, { offlineFirst = false } = {}) {
    const ctx = await browser.newContext({ ...devices['iPhone 13'], deviceScaleFactor: 2 });
    await ctx.addInitScript(() => { window.__RECAP_E2E__ = { url: 'http://localhost:8099', anonKey: 'e2e-anon-key' }; });
    const page = await ctx.newPage();
    page.on('console', (m) => { if (m.text().includes('[Recap]')) out.push(`${name}: ${m.text()}`); });
    if (offlineFirst) await page.route('**/rest/v1/rpc/recap_ingest', (r) => r.abort('internetdisconnected'));
    await page.goto(BASE);
    await page.getByTestId('shop-now').waitFor();
    await page.waitForTimeout(500);
    await page.screenshot({ path: `e2e/screenshots/${name}-1-home.png` });
    await page.getByTestId('shop-now').tap();
    await page.getByTestId('product-scroll').waitFor();
    await page.waitForTimeout(400);
    // swipe-scroll the product page
    await page.getByTestId('product-scroll').evaluate((el) => { el.scrollTop = el.scrollHeight * 0.45; el.dispatchEvent(new Event('scroll')); });
    await page.waitForTimeout(300);
    await page.getByTestId('product-scroll').evaluate((el) => { el.scrollTop = el.scrollHeight; el.dispatchEvent(new Event('scroll')); });
    await page.waitForTimeout(300);
    await page.screenshot({ path: `e2e/screenshots/${name}-2-product.png` });
    await page.getByTestId('add').tap();
    await page.getByTestId('checkout').waitFor();
    await page.waitForTimeout(400);
    for (let i = 0; i < 3; i++) { await page.getByTestId('checkout').tap(); await page.waitForTimeout(150); }
    await page.screenshot({ path: `e2e/screenshots/${name}-3-basket.png` });
    if (offlineFirst) {
      await page.waitForTimeout(3000); // flush attempts fail while "offline"
      out.push(`${name}: going back online`);
      await page.unroute('**/rest/v1/rpc/recap_ingest');
    }
    await page.waitForTimeout(4500);
    await ctx.close();
  }
  await user('userA');
  await user('userB', { offlineFirst: true });
  await browser.close();
  console.log(out.join('\n'));
  const log = await (await fetch(BASE + '/__log')).json();
  console.log(JSON.stringify(log, null, 2));
})().catch((e) => { console.error(e); process.exit(1); });
