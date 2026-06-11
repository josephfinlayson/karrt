import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import { writeFileSync } from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

const chromium = require('./node_modules/playwright-extra').chromium;
const stealth = require('./node_modules/puppeteer-extra-plugin-stealth');
const { readTotpSecret, generateTOTP } = await import('./dist/auth/totp.js');

chromium.use(stealth());
const EXEC = '/home/jfinlays/.openclaw/bin/chromium';
const EXT  = resolve(__dirname, '2captcha-solver');
const EMAIL = process.env.REWE_EMAIL;
const PASS  = process.env.REWE_PASSWORD;

const ctx = await chromium.launchPersistentContext('.chrome-data', {
  headless: false, executablePath: EXEC,
  args: ['--no-sandbox','--disable-blink-features=AutomationControlled',
         '--disable-extensions-except='+EXT,'--load-extension='+EXT],
  userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  viewport: { width: 1280, height: 720 }
});

const page = ctx.pages()[0] || await ctx.newPage();

await page.goto(
  'https://account.rewe.de/realms/sso/protocol/openid-connect/auth?response_type=code&client_id=ecom&scope=openid%20profile&redirect_uri=https://www.rewe.de/login/oauth2/code/sso',
  { waitUntil: 'domcontentloaded', timeout: 20000 }
).catch(()=>{});
await page.waitForTimeout(3000);

// Wait for Turnstile to be solved by 2captcha extension
console.log('Waiting for Turnstile...');
let solved = false;
for (let i=0; i<30; i++) {
  const val = await page.evaluate(() => {
    const e = document.querySelector('input[name="cf-turnstile-response"]');
    return e ? e.value : '';
  });
  if (val && val.length > 10) { console.log('Turnstile solved at t+'+(i*2)+'s'); solved = true; break; }
  if (i % 5 === 0) console.log('  waiting... t+'+(i*2)+'s');
  await page.waitForTimeout(2000);
}
if (!solved) console.log('WARN: Turnstile not solved, trying anyway');

// Fill credentials
await page.fill('#username', EMAIL);
await page.fill('#password', PASS);
await page.screenshot({ path: '/tmp/login-filled.png' });
await page.click('button[type=submit]');
await page.waitForTimeout(7000);
console.log('After submit:', page.url().substring(0,80));

// 2FA flow
let txt = await page.evaluate(() => document.body?.innerText||'');
if (/Bestätige|Sicherheitsmethode|welche möchtest/i.test(txt)) {
  // Method selection screen — pick authenticator app
  console.log('2FA method selection — choosing authenticator app...');
  const clicked = await page.evaluate(() => {
    const items = Array.from(document.querySelectorAll('input[type=radio], label, div[role=radio], a, button, li'));
    const app = items.find(el => el.textContent?.includes('Authentifizierungs') || el.textContent?.includes('App') || el.textContent?.includes('TOTP'));
    if (app) { app.click(); return true; }
    return false;
  });
  console.log('  Clicked app option:', clicked);
  await page.waitForTimeout(1000);
  await page.click('button:has-text("Weiter"), button[type=submit]').catch(()=>{});
  await page.waitForTimeout(3000);
  txt = await page.evaluate(() => document.body?.innerText||'');
}

if (/Code|OTP|Authenticator|Verifizierung|2-Faktor|Einmalcode|Authentifizierungs/i.test(txt)) {
  console.log('TOTP needed...');
  const secret = await readTotpSecret().catch(()=>null);
  if (secret) {
    const code = generateTOTP(secret);
    console.log('TOTP code:', code);
    const filled = await page.fill('#otp, input[name=otp], input[autocomplete="one-time-code"]', code).then(()=>true).catch(()=>false);
    if (!filled) {
      const inputs = await page.$$('input[type=text]');
      if (inputs[0]) await inputs[0].fill(code);
    }
    await page.click('button[type=submit]').catch(()=>{});
    await page.waitForTimeout(5000);
  }
}

// SSO remember
txt = await page.evaluate(() => document.body?.innerText||'');
if (txt.includes('Weiter mit')) {
  await page.click('button[type=submit]').catch(()=>{});
  await page.waitForTimeout(4000);
}

const finalUrl = page.url();
console.log('Final URL:', finalUrl.substring(0,100));
await page.screenshot({ path: '/tmp/post-login.png' });

if (!finalUrl.includes('account.rewe.de')) {
  console.log('SUCCESS — logged in, going to timeslots...');
  await page.goto('https://www.rewe.de/shop/checkout/timeslot', { waitUntil: 'domcontentloaded', timeout: 20000 }).catch(()=>{});
  await page.waitForTimeout(10000);
  txt = await page.evaluate(() => document.body?.innerText||'');
  console.log('=== TIMESLOT PAGE ===');
  console.log(txt.substring(0, 1500));
  await page.screenshot({ path: '/tmp/rewe-timeslot.png' });
  writeFileSync('/tmp/timeslot-text.txt', txt);
} else {
  console.log('Still on Keycloak — login failed');
  txt = await page.evaluate(() => document.body?.innerText||'');
  console.log(txt.substring(0,300));
}

await ctx.close();
