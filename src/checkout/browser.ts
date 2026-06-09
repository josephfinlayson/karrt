import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Page } from "playwright";
import { chromium } from "playwright-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";

chromium.use(StealthPlugin());

const __dirname = dirname(fileURLToPath(import.meta.url));
const CONFIRM_PHRASE = "PLACE REWE ORDER";

export interface CheckoutBrowserState {
  url: string;
  readyToPlaceOrder: boolean;
  placedOrder: boolean;
  textPreview: string;
}

function browserPaths(): { root: string; executablePath?: string } {
  const root = resolve(__dirname, "../..");
  const persistentBrowserPath = resolve(root, "../ms-playwright");
  const persistentChromiumPath = resolve(
    persistentBrowserPath,
    "chromium-1217/chrome-linux64/chrome",
  );
  if (!process.env.PLAYWRIGHT_BROWSERS_PATH && existsSync(persistentBrowserPath)) {
    process.env.PLAYWRIGHT_BROWSERS_PATH = persistentBrowserPath;
  }
  return {
    root,
    executablePath: existsSync(persistentChromiumPath)
      ? persistentChromiumPath
      : undefined,
  };
}

function shouldRunHeadless(): boolean {
  return !process.env.DISPLAY;
}

async function clickText(page: Page, text: string): Promise<boolean> {
  const clicked = await page.evaluate((needle: string) => {
    const nodes = Array.from(document.querySelectorAll("button,a,[role=button],span,div"));
    const el = nodes.find((node) => (node.textContent || "").trim().replace(/\s+/g, " ") === needle)
      || nodes.find((node) => (node.textContent || "").includes(needle));
    if (!el) return false;
    const clickable = el.closest("button,a,[role=button]") || el;
    clickable.scrollIntoView({ block: "center" });
    (clickable as HTMLElement).click();
    return true;
  }, text);
  if (clicked) await page.waitForTimeout(8000);
  return Boolean(clicked);
}

async function pageText(page: Page): Promise<string> {
  return page.evaluate(() => document.body.innerText);
}

async function driveToCheckoutConfirmation(page: Page): Promise<CheckoutBrowserState> {
  await page.goto("https://www.rewe.de/shop/checkout/basket", {
    waitUntil: "domcontentloaded",
    timeout: 60000,
  });
  await page.waitForTimeout(5000);

  for (let i = 0; i < 8; i++) {
    const text = await pageText(page);
    if (page.url().includes("/shop/checkout/confirmation")) {
      return {
        url: page.url(),
        readyToPlaceOrder: text.includes("Jetzt bestellen"),
        placedOrder: false,
        textPreview: text.slice(0, 2500),
      };
    }
    if (text.includes("Dein Warenkorb ist leer")) {
      return {
        url: page.url(),
        readyToPlaceOrder: false,
        placedOrder: false,
        textPreview: text.slice(0, 2500),
      };
    }
    if (text.includes("Weiter mit diesem REWE Konto")) {
      await clickText(page, "Weiter mit diesem REWE Konto");
      continue;
    }
    if (text.includes("Weiter zur Kasse")) {
      await clickText(page, "Weiter zur Kasse");
      continue;
    }
    if (
      page.url().includes("/shop/checkout/basket")
      && (text.includes("Zur Kasse") || text.includes("Gesamtsumme"))
    ) {
      await page.mouse.click(1090, 488);
      await page.waitForTimeout(8000);
      continue;
    }
    if (text.includes("Weiter")) {
      await clickText(page, "Weiter");
      continue;
    }
    break;
  }

  const text = await pageText(page);
  return {
    url: page.url(),
    readyToPlaceOrder: page.url().includes("/shop/checkout/confirmation")
      && text.includes("Jetzt bestellen"),
    placedOrder: false,
    textPreview: text.slice(0, 2500),
  };
}

export async function reachCheckoutConfirmation(): Promise<CheckoutBrowserState> {
  const { root, executablePath } = browserPaths();
  const context = await chromium.launchPersistentContext(resolve(root, ".chrome-data"), {
    headless: shouldRunHeadless(),
    executablePath,
    args: ["--no-sandbox", "--disable-blink-features=AutomationControlled"],
    viewport: { width: 1280, height: 1200 },
  });

  try {
    const page = context.pages()[0] ?? await context.newPage();
    return await driveToCheckoutConfirmation(page);
  } finally {
    await context.close().catch(() => {});
  }
}

export async function placeOrder(confirm: string): Promise<CheckoutBrowserState> {
  if (confirm !== CONFIRM_PHRASE) {
    throw new Error(
      `Refusing to place order. Re-run with --confirm "${CONFIRM_PHRASE}".`,
    );
  }

  const { root, executablePath } = browserPaths();
  const context = await chromium.launchPersistentContext(
    resolve(root, ".chrome-data"),
    {
      headless: shouldRunHeadless(),
      executablePath,
      args: ["--no-sandbox", "--disable-blink-features=AutomationControlled"],
      viewport: { width: 1280, height: 1200 },
    },
  );

  try {
    const page = context.pages()[0] ?? await context.newPage();
    const review = await driveToCheckoutConfirmation(page);
    if (!review.readyToPlaceOrder) {
      return review;
    }

    await page.goto(review.url, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForTimeout(5000);
    const clicked = await clickText(page, "Jetzt bestellen");
    if (!clicked) {
      throw new Error("Checkout confirmation page did not expose a `Jetzt bestellen` button.");
    }
    await page.waitForTimeout(15000);
    const text = await pageText(page);
    return {
      url: page.url(),
      readyToPlaceOrder: false,
      placedOrder: true,
      textPreview: text.slice(0, 2500),
    };
  } finally {
    await context.close().catch(() => {});
  }
}
