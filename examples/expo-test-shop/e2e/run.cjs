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
    // Tries to add without a size (blocked), then picks one from the dropdown.
    await page.getByTestId('add').tap();
    await page.waitForTimeout(300);
    await page.getByTestId('size').tap();
    await page.getByTestId('size-UK 9').tap();
    await page.waitForTimeout(300);
    await page.getByTestId('add').tap();
    await page.getByTestId('checkout').waitFor();
    await page.waitForTimeout(1500);
    // A promo code that never works, tapped in frustration.
    await page.getByTestId('promo').fill('WINTER10');
    for (let i = 0; i < 3; i++) { await page.getByTestId('apply-promo').tap(); await page.waitForTimeout(150); }
    await page.screenshot({ path: `e2e/screenshots/${name}-3-basket.png` });
    await page.getByTestId('checkout').tap();
    await page.getByTestId('pay').waitFor();
    await page.waitForTimeout(1500);
    await page.getByTestId('pay').tap(); // empty form: errors
    await page.getByTestId('name').fill('Test Person');
    await page.getByTestId('email').fill('test@example.com');
    await page.getByTestId('postcode').fill('SW1A 1AA');
    await page.getByTestId('delivery').tap();
    await page.getByTestId('delivery-next').tap();
    await page.getByTestId('news').tap();
    await page.screenshot({ path: `e2e/screenshots/${name}-4-checkout.png` });
    await page.getByTestId('pay').tap();
    await page.getByTestId('star-4').waitFor();
    await page.getByTestId('star-4').tap();
    await page.waitForTimeout(1500);
    await page.screenshot({ path: `e2e/screenshots/${name}-5-done.png` });
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
