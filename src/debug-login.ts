import { chromium } from "playwright-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

chromium.use(StealthPlugin());
const __dirname = dirname(fileURLToPath(import.meta.url));
const EXTENSION_PATH = resolve(__dirname, "../../2captcha-solver");
const userDataDir = resolve(__dirname, "../../.chrome-data");

const context = await chromium.launchPersistentContext(userDataDir, {
  headless: false,
  args: [
    `--disable-extensions-except=${EXTENSION_PATH}`,
    `--load-extension=${EXTENSION_PATH}`,
    "--no-sandbox",
    "--disable-blink-features=AutomationControlled",
  ],
  ignoreDefaultArgs: ["--disable-extensions", "--disable-component-extensions-with-background-pages", "--enable-automation"],
});

const page = await context.newPage();
await page.goto("https://www.rewe.de/mydata/login", { waitUntil: "domcontentloaded", timeout: 60000 });
await page.waitForTimeout(12000);
console.log("URL:", page.url());
await page.screenshot({ path: "/tmp/login-debug.png", fullPage: true });
console.log("Screenshot saved");
const text = await page.evaluate(() => document.body?.innerText?.substring(0, 500) || "");
console.log("Text:", text);
await page.close();
await context.close();
