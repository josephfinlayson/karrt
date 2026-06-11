import { chromium } from "playwright-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";
import { mkdir, rm, stat } from "node:fs/promises";
import { homedir } from "node:os";
import type { Headers, QueryParams } from "./client.js";

chromium.use(StealthPlugin());

const __dirname = dirname(fileURLToPath(import.meta.url));
const API_BASE = "https://www.rewe.de/shop/api";
const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
const PROFILE_LOCK_TIMEOUT_MS = 30_000;
const PROFILE_LOCK_STALE_MS = 120_000;

export class BrowserApiError extends Error {
  constructor(
    public status: number,
    public method: string,
    public url: string,
    public body: string,
  ) {
    super(
      `Browser API error ${status} ${method} ${url}: ${body.slice(0, 500)}`,
    );
  }
}

function buildUrl(path: string, params?: QueryParams): string {
  const base = path.startsWith("http") ? path : `${API_BASE}${path}`;
  if (!params || Object.keys(params).length === 0) return base;
  const sp = new URLSearchParams();
  for (const [key, val] of Object.entries(params)) {
    if (Array.isArray(val)) {
      for (const v of val) sp.append(key, v);
    } else {
      sp.append(key, val);
    }
  }
  return `${base}?${sp.toString()}`;
}

function chromiumExecutablePath(root: string): string | undefined {
  const candidates = [
    process.env.KARRT_CHROMIUM_PATH,
    process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
    resolve(homedir(), ".openclaw/bin/chromium"),
    resolve(root, "../ms-playwright/chromium-1217/chrome-linux64/chrome"),
  ];
  return candidates.find((path): path is string => typeof path === "string" && existsSync(path));
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

export async function browserRequest<T>(
  method: string,
  path: string,
  headers: Headers = {},
  body?: unknown,
  params?: QueryParams,
): Promise<T> {
  const root = resolve(__dirname, "../..");
  const persistentBrowserPath = resolve(root, "../ms-playwright");
  if (!process.env.PLAYWRIGHT_BROWSERS_PATH && existsSync(persistentBrowserPath)) {
    process.env.PLAYWRIGHT_BROWSERS_PATH = persistentBrowserPath;
  }
  const executablePath = chromiumExecutablePath(root);
  const releaseLock = await acquireProfileLock(root);
  let context: Awaited<ReturnType<typeof chromium.launchPersistentContext>> | undefined;

  try {
    context = await chromium.launchPersistentContext(
      resolve(root, ".chrome-data"),
      {
        headless: true,
        executablePath,
        args: [
          "--no-sandbox",
          "--disable-blink-features=AutomationControlled",
        ],
        userAgent: USER_AGENT,
      },
    );
    const page = context.pages()[0] ?? await context.newPage();
    await page.goto("https://www.rewe.de/shop/checkout/basket", {
      waitUntil: "domcontentloaded",
      timeout: 60000,
    }).catch(() => {});

    const result = await page.evaluate(
      async ({ url, method, headers, body }) => {
        const response = await fetch(url, {
          method,
          headers,
          credentials: "include",
          body: body === undefined ? undefined : JSON.stringify(body),
        });
        return {
          status: response.status,
          text: await response.text(),
        };
      },
      { url: buildUrl(path, params), method, headers, body },
    );

    if (result.status >= 400) {
      throw new BrowserApiError(
        result.status,
        method,
        buildUrl(path, params),
        result.text,
      );
    }

    if (!result.text) return undefined as T;
    return JSON.parse(result.text) as T;
  } finally {
    await context?.close().catch(() => {});
    await releaseLock();
  }
}
