import { existsSync } from "node:fs";
import { mkdir, rm, stat } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";
import type { Page } from "playwright";
import { chromium } from "playwright-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import { readCheckoutConfig } from "../storage/index.js";

chromium.use(StealthPlugin());

const __dirname = dirname(fileURLToPath(import.meta.url));
const CONFIRM_PHRASE = "PLACE REWE ORDER";
const PROFILE_LOCK_TIMEOUT_MS = 30_000;
const PROFILE_LOCK_STALE_MS = 120_000;

export interface CheckoutBrowserState {
  url: string;
  readyToPlaceOrder: boolean;
  placedOrder: boolean;
  textPreview: string;
}

function browserPaths(): { root: string; executablePath?: string } {
  const root = resolve(__dirname, "../..");
  const persistentBrowserPath = resolve(root, "../ms-playwright");
  if (!process.env.PLAYWRIGHT_BROWSERS_PATH && existsSync(persistentBrowserPath)) {
    process.env.PLAYWRIGHT_BROWSERS_PATH = persistentBrowserPath;
  }
  const candidates = [
    process.env.KARRT_CHROMIUM_PATH,
    process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
    resolve(homedir(), ".openclaw/bin/chromium"),
    resolve(persistentBrowserPath, "chromium-1217/chrome-linux64/chrome"),
  ];
  return {
    root,
    executablePath: candidates.find((path): path is string => typeof path === "string" && existsSync(path)),
  };
}

function shouldRunHeadless(): boolean {
  return !process.env.DISPLAY;
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
}

async function acquireProfileLock(root: string): Promise<() => Promise<void>> {
  const lockPath = resolve(root, ".chrome-data.lock");
  const started = Date.now();
  for (;;) {
    try {
      await mkdir(lockPath, { mode: 0o700 });
      return async () => {
        await rm(lockPath, { recursive: true, force: true });
      };
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code !== "EEXIST") throw err;
      try {
        const info = await stat(lockPath);
        if (Date.now() - info.mtimeMs > PROFILE_LOCK_STALE_MS) {
          await rm(lockPath, { recursive: true, force: true });
          continue;
        }
      } catch {}
      if (Date.now() - started > PROFILE_LOCK_TIMEOUT_MS) {
        throw new Error("Timed out waiting for Karrt Chromium profile lock.");
      }
      await sleep(250);
    }
  }
}

async function clickText(page: Page, text: string): Promise<boolean> {
  const clicked = await page.evaluate((needle: string) => {
    const nodes = Array.from(document.querySelectorAll("button,a,[role=button],rdc-button,input[type=submit],span,div"));
    const el = nodes.find((node) => {
      const text = (node.textContent || node.getAttribute("label") || node.getAttribute("aria-label") || node.getAttribute("value") || "").trim().replace(/\s+/g, " ");
      return text === needle;
    }) || nodes.find((node) => {
      const text = (node.textContent || node.getAttribute("label") || node.getAttribute("aria-label") || node.getAttribute("value") || "").trim().replace(/\s+/g, " ");
      return text.includes(needle);
    });
    if (!el) return false;
    const clickable = el.closest("button,a,[role=button],rdc-button") || el;
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

async function submitForm(page: Page, selector: string): Promise<boolean> {
  return page.evaluate((formSelector: string) => {
    const form = document.querySelector(formSelector) as HTMLFormElement | null;
    if (!form) return false;
    if (typeof form.requestSubmit === "function") form.requestSubmit();
    else form.submit();
    return true;
  }, selector);
}

async function visibleErrors(page: Page): Promise<string[]> {
  const text = await pageText(page);
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => /scheint nicht zu stimmen|bitte|fehler|ungültig|nicht möglich|mindestbestellwert|iban|zahlungsart/i.test(line))
    .slice(0, 20);
}

function normalizeIban(iban: string): string {
  return iban.replace(/\s+/g, "").toUpperCase();
}

function isValidIban(iban: string): boolean {
  const clean = normalizeIban(iban);
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]+$/.test(clean)) return false;
  const expanded = (clean.slice(4) + clean.slice(0, 4)).replace(/[A-Z]/g, (char) => String(char.charCodeAt(0) - 55));
  let remainder = 0;
  for (const digit of expanded) remainder = (remainder * 10 + Number(digit)) % 97;
  return remainder === 1;
}

async function fillPaymentFromConfig(page: Page): Promise<void> {
  const config = await readCheckoutConfig();
  const payment = config?.payment;
  if (!payment) {
    throw new Error("Missing checkout payment config at ~/.config/karrt/checkout.json.");
  }

  if (payment.method === "INVOICE") {
    await page.locator("#card__input-INVOICE").check({ force: true }).catch(() => {});
    await page.evaluate(() => {
      const hiddenPayment = document.querySelector('form[action*="payment-options/submit"] input[name="paymentOption"][type="hidden"]') as HTMLInputElement | null;
      if (hiddenPayment) hiddenPayment.value = "INVOICE";
    });
    return;
  }

  if (payment.method !== "DIRECT_DEBIT") {
    throw new Error(`Unsupported checkout payment method: ${String(payment.method)}`);
  }
  if (!payment.accountOwner || !payment.iban || !payment.dateOfBirth) {
    throw new Error("DIRECT_DEBIT checkout config requires accountOwner, iban, and dateOfBirth.");
  }
  const [year, month, day] = payment.dateOfBirth.split("-");
  if (!year || !month || !day) {
    throw new Error("DIRECT_DEBIT checkout dateOfBirth must use YYYY-MM-DD.");
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(payment.dateOfBirth) || !isValidIban(payment.iban)) {
    throw new Error("DIRECT_DEBIT checkout config has invalid dateOfBirth or IBAN checksum.");
  }

  await page.locator("#card__input-DIRECT_DEBIT").check({ force: true }).catch(() => {});
  await page.fill("#pof-date-of-birth_day", day);
  await page.fill("#pof-date-of-birth_month", month);
  await page.fill("#pof-date-of-birth_year", year);
  await page.fill("#direct-debit-account-owner", payment.accountOwner);
  await page.fill("#direct-debit-iban", normalizeIban(payment.iban).replace(/(.{4})/g, "$1 ").trim());
  await page.waitForTimeout(500);
}

async function hasFinalOrderButton(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const nodes = Array.from(document.querySelectorAll("button,a,[role=button],rdc-button,input[type=submit]"));
    return nodes.some((node) => {
      const text = (node.textContent || node.getAttribute("label") || node.getAttribute("aria-label") || node.getAttribute("value") || "").trim().replace(/\s+/g, " ");
      if (!/Jetzt bestellen|Kostenpflichtig bestellen|Zahlungspflichtig bestellen/i.test(text)) return false;
      const rect = node.getBoundingClientRect();
      const style = getComputedStyle(node);
      const disabled = (node as HTMLButtonElement).disabled || node.getAttribute("aria-disabled") === "true";
      return !disabled && rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden";
    });
  });
}

async function clickFinalOrder(page: Page): Promise<boolean> {
  const clicked = await page.evaluate(() => {
    const nodes = Array.from(document.querySelectorAll("button,a,[role=button],rdc-button,input[type=submit]"));
    const button = nodes.find((node) => {
      const text = (node.textContent || node.getAttribute("label") || node.getAttribute("aria-label") || node.getAttribute("value") || "").trim().replace(/\s+/g, " ");
      return /Jetzt bestellen|Kostenpflichtig bestellen|Zahlungspflichtig bestellen/i.test(text);
    });
    if (!button) return false;
    button.scrollIntoView({ block: "center" });
    (button as HTMLElement).click();
    return true;
  });
  if (clicked) await page.waitForTimeout(20000);
  return Boolean(clicked);
}

async function driveToCheckoutConfirmation(page: Page): Promise<CheckoutBrowserState> {
  await page.goto("https://www.rewe.de/shop/checkout/basket", {
    waitUntil: "domcontentloaded",
    timeout: 60000,
  });
  await page.waitForTimeout(5000);

  for (let i = 0; i < 12; i++) {
    const text = await pageText(page);
    if (page.url().includes("/shop/checkout/confirmation")) {
      return {
        url: page.url(),
        readyToPlaceOrder: await hasFinalOrderButton(page),
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
    if (page.url().includes("/shop/checkout/basket")) {
      if (await submitForm(page, 'form[action*="basket/submit"]')) {
        await page.waitForTimeout(8000);
        continue;
      }
      if (await clickText(page, "Zur Kasse")) continue;
    }
    if (page.url().includes("/shop/checkout/paymentoptions") || text.includes("Zahlungsart")) {
      await fillPaymentFromConfig(page);
      await submitForm(page, 'form[action*="payment-options/submit"]');
      await page.waitForTimeout(8000);
      if ((page.url().includes("/shop/checkout/paymentoptions") || (await pageText(page)).includes("Zahlungsart"))) {
        const errors = await visibleErrors(page);
        if (errors.length > 0) {
          const paymentText = await pageText(page);
          return {
            url: page.url(),
            readyToPlaceOrder: false,
            placedOrder: false,
            textPreview: [...errors, paymentText].join("\n").slice(0, 2500),
          };
        }
      }
      continue;
    }
    if (text.includes("Weiter")) {
      await clickText(page, "Weiter");
      continue;
    }
    break;
  }

  const text = await pageText(page);
  const errors = await visibleErrors(page);
  return {
    url: page.url(),
    readyToPlaceOrder: page.url().includes("/shop/checkout/confirmation")
      && await hasFinalOrderButton(page),
    placedOrder: false,
    textPreview: [...errors, text].join("\n").slice(0, 2500),
  };
}

export async function reachCheckoutConfirmation(): Promise<CheckoutBrowserState> {
  const { root, executablePath } = browserPaths();
  const releaseLock = await acquireProfileLock(root);
  let context: Awaited<ReturnType<typeof chromium.launchPersistentContext>> | undefined;

  try {
    context = await chromium.launchPersistentContext(resolve(root, ".chrome-data"), {
      headless: shouldRunHeadless(),
      executablePath,
      args: ["--no-sandbox", "--disable-blink-features=AutomationControlled"],
      viewport: { width: 1280, height: 1200 },
    });
    const page = context.pages()[0] ?? await context.newPage();
    return await driveToCheckoutConfirmation(page);
  } finally {
    await context?.close().catch(() => {});
    await releaseLock();
  }
}

export async function placeOrder(confirm: string): Promise<CheckoutBrowserState> {
  if (confirm !== CONFIRM_PHRASE) {
    throw new Error(
      `Refusing to place order. Re-run with --confirm "${CONFIRM_PHRASE}".`,
    );
  }

  const { root, executablePath } = browserPaths();
  const releaseLock = await acquireProfileLock(root);
  let context: Awaited<ReturnType<typeof chromium.launchPersistentContext>> | undefined;

  try {
    context = await chromium.launchPersistentContext(
      resolve(root, ".chrome-data"),
      {
        headless: shouldRunHeadless(),
        executablePath,
        args: ["--no-sandbox", "--disable-blink-features=AutomationControlled"],
        viewport: { width: 1280, height: 1200 },
      },
    );
    const page = context.pages()[0] ?? await context.newPage();
    const review = await driveToCheckoutConfirmation(page);
    if (!review.readyToPlaceOrder) {
      return review;
    }

    const clicked = await clickFinalOrder(page);
    if (!clicked) {
      throw new Error("Checkout confirmation page did not expose a `Jetzt bestellen` button.");
    }
    const text = await pageText(page);
    return {
      url: page.url(),
      readyToPlaceOrder: false,
      placedOrder: page.url().includes("/checkout/aftersale") || text.includes("Bestellbestätigung") || text.includes("Bestellnummer"),
      textPreview: text.slice(0, 2500),
    };
  } finally {
    await context?.close().catch(() => {});
    await releaseLock();
  }
}
