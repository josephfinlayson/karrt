import { chromium } from "playwright-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import { writeLoginState, poll2FACode, cleanup } from "./ipc.js";
import { readTotpSecret, generateTOTP } from "./totp.js";
import { clearSession, writeSessionState } from "../storage/index.js";
import type { ReweHttpClient } from "../http/client.js";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";

chromium.use(StealthPlugin());

const __dirname = dirname(fileURLToPath(import.meta.url));
const EXTENSION_PATH = resolve(__dirname, "../../2captcha-solver");

const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

/**
 * Browser-based login flow.
 *
 * Uses Playwright with stealth + 2Captcha extension to bypass Turnstile.
 * After login, extracts all cookies and saves them for the axios-based client.
 * If TOTP is configured, auto-generates 2FA codes (no human needed).
 */
export async function login(
  _client: ReweHttpClient,
  email?: string,
  password?: string,
): Promise<string> {
  const userEmail = email || process.env.REWE_EMAIL;
  const userPassword = password || process.env.REWE_PASSWORD;

  if (!userEmail || !userPassword) {
    throw new Error(
      "Email and password required. Use --email/--password or REWE_EMAIL/REWE_PASSWORD env vars.",
    );
  }

  if (!existsSync(EXTENSION_PATH) || !existsSync(resolve(EXTENSION_PATH, "manifest.json"))) {
    throw new Error(
      "2Captcha browser extension not found at 2captcha-solver/. " +
      "Download it from https://github.com/2captcha/solver_browser_extension/releases " +
      "and place it in the project root. See README for details.",
    );
  }

  await clearSession();
  await writeLoginState({ status: "idle" });

  const totpSecret = await readTotpSecret();

  const userDataDir = resolve(__dirname, "../../.chrome-data");
  const persistentBrowserPath = resolve(__dirname, "../../../ms-playwright");
  const persistentChromiumPath = resolve(
    persistentBrowserPath,
    "chromium-1217/chrome-linux64/chrome",
  );
  if (!process.env.PLAYWRIGHT_BROWSERS_PATH && existsSync(persistentBrowserPath)) {
    process.env.PLAYWRIGHT_BROWSERS_PATH = persistentBrowserPath;
  }

  const context = await chromium.launchPersistentContext(userDataDir, {
    headless: false as const,
    executablePath: existsSync(persistentChromiumPath)
      ? persistentChromiumPath
      : undefined,
    args: [
      `--disable-extensions-except=${EXTENSION_PATH}`,
      `--load-extension=${EXTENSION_PATH}`,
      "--no-sandbox",
      "--disable-blink-features=AutomationControlled",
    ],
    ignoreDefaultArgs: [
      "--disable-extensions",
      "--disable-component-extensions-with-background-pages",
      "--enable-automation",
    ],
    userAgent: USER_AGENT,
  });

  const page = await context.newPage();

  try {
    // ── Step 1: Navigate to login ──
    console.log("[1/5] Loading REWE login page...");
    await page.goto("https://www.rewe.de/mydata/login", {
      waitUntil: "domcontentloaded",
      timeout: 60000,
    });
    await page.waitForTimeout(10000);

    if (!page.url().includes("account.rewe.de")) {
      console.log("  Waiting for CF challenge to clear...");
      try {
        await page.waitForURL("**/account.rewe.de/**", { timeout: 60000 });
      } catch {
        console.log("  Current URL:", page.url());
      }
    }

    // ── Dismiss cookie consent if present ──
    try {
      const consentBtn = page.locator('button:has-text("Alle erlauben"), button:has-text("Alle akzeptieren"), button:has-text("Accept All")');
      if (await consentBtn.isVisible({ timeout: 3000 })) {
        console.log("  Dismissing cookie consent...");
        await consentBtn.click();
        await page.waitForTimeout(1000);
      }
    } catch {
      // No consent dialog, continue
    }

    // ── Step 2: Fill credentials ──
    console.log("[2/5] Filling credentials...");
    console.log("  Current URL:", page.url());

    // Check if Keycloak shows "continue with this account" prompt (remembered session)
    const continueBtn = page.locator('button:has-text("Weiter mit diesem REWE Konto"), a:has-text("Weiter mit diesem REWE Konto")');
    const usernameField = page.locator("#username");

    const which = await Promise.race([
      continueBtn.waitFor({ state: "visible", timeout: 20000 }).then(() => "continue" as const),
      usernameField.waitFor({ state: "visible", timeout: 20000 }).then(() => "login" as const),
    ]).catch(() => "timeout" as const);

    if (which === "continue") {
      console.log("  Account remembered — clicking 'Weiter mit diesem REWE Konto'...");
      await continueBtn.click();
    } else if (which === "login") {
      await page.fill("#username", userEmail);
      await page.fill("#password", userPassword);

      // ── Step 3: Wait for Turnstile to be solved by extension ──
      console.log("[3/5] Waiting for Turnstile to be solved...");
      try {
        await page.waitForFunction(
          () => {
            const btn = document.querySelector(
              '#login-form button[type="submit"], #login-form input[type="submit"]',
            ) as HTMLButtonElement | null;
            if (btn && !btn.disabled) return true;
            const input = document.querySelector(
              'input[name="cf-turnstile-response"]',
            ) as HTMLInputElement | null;
            return input && input.value.length > 10;
          },
          { timeout: 120000 },
        );
      } catch {
        console.log("  Turnstile timeout — force-enabling submit...");
        await page.evaluate(() => {
          document.querySelectorAll("button[disabled]").forEach((b) => {
            (b as HTMLButtonElement).disabled = false;
            b.removeAttribute("disabled");
          });
        });
      }

      console.log("  Submitting login...");
      await page.evaluate(() => {
        const form = document.querySelector("#login-form") as HTMLFormElement | null;
        if (form) form.submit();
      });
    } else {
      throw new Error("Timeout: neither login form nor continue button appeared.");
    }

    await page.waitForTimeout(8000);

    // ── Step 4: Handle 2FA if needed ──
    const postLoginUrl = page.url();
    if (postLoginUrl.includes("account.rewe.de")) {
      // Dismiss cookie consent if it appeared on Keycloak
      try {
        const consentBtn = page.locator('button:has-text("Alle erlauben"), button:has-text("Alle akzeptieren")');
        if (await consentBtn.isVisible({ timeout: 2000 })) {
          console.log("  Dismissing cookie consent on Keycloak...");
          await consentBtn.click();
          await page.waitForTimeout(1000);
        }
      } catch {}

      const pageText = await page
        .evaluate(() => document.body?.innerText?.substring(0, 500) || "")
        .catch(() => "");

      if (pageText.includes("Bestätig") || pageText.includes("Sicherheitsmethoden")) {
        console.log("[4/5] 2FA required...");

        // ── Step 4a: Select authenticator app method if method selection is shown ──
        const hasMethodChoice = await page
          .locator('text="Code mit Authentifizierungs-App erstellen"')
          .isVisible({ timeout: 1000 })
          .catch(() => false);

        if (
          hasMethodChoice ||
          pageText.includes("Sicherheitsmethoden") ||
          pageText.includes("Authentifizierungs-App")
        ) {
          console.log("      Selecting authenticator app method...");

          const authenticatorOption = page
            .locator(
              'label:has-text("Authentifizierungs-App"), button:has-text("Authentifizierungs-App"), div:has-text("Authentifizierungs-App")',
            )
            .last();

          const selected = await authenticatorOption
            .click({ timeout: 5000, force: true })
            .then(() => "clicked authenticator option")
            .catch(async () => {
              return page.evaluate(() => {
                const controls = Array.from(
                  document.querySelectorAll('input[type="radio"], input[type="checkbox"], [role="radio"]'),
                );
                const option = controls.find((control) => {
                  const text =
                    control.closest("label")?.textContent ||
                    control.parentElement?.textContent ||
                    "";
                  return text.includes("Authentifizierungs-App");
                }) as HTMLElement | undefined;
                if (!option) return "authenticator option not found";
                option.click();
                option.dispatchEvent(new Event("input", { bubbles: true }));
                option.dispatchEvent(new Event("change", { bubbles: true }));
                return "clicked authenticator input fallback";
              });
            });
          console.log("      Selection result:", selected);

          await page.waitForTimeout(500);

          // Click "Weiter" button
          console.log("      Clicking Weiter...");
          await page
            .click('button:has-text("Weiter")', { timeout: 5000 })
            .catch(async () => {
              await page.evaluate(() => {
                const form = document.querySelector("form") as HTMLFormElement | null;
                if (form) form.submit();
              });
            });
          await page.waitForTimeout(2000);

          console.log("      After selection URL:", page.url());
          const newText = await page.evaluate(() => document.body?.innerText?.substring(0, 200) || "").catch(() => "");
          console.log("      Page text:", newText.substring(0, 150));

          const otpInput = page.locator(
            'input[name="otp"], input[autocomplete="one-time-code"], input[inputmode="numeric"]',
          );
          if (!(await otpInput.first().isVisible({ timeout: 10000 }).catch(() => false))) {
            const methodText = await page
              .evaluate(() => document.body?.innerText?.substring(0, 300) || "")
              .catch(() => "");
            throw new Error(
              "Authenticator app method was selected, but the OTP form did not appear. Page: " +
                methodText,
            );
          }
        }

        // ── Step 4b: Generate or get OTP code ──
        const otpInput = page.locator(
          'input[name="otp"], input[autocomplete="one-time-code"], input[inputmode="numeric"]',
        );
        if (!(await otpInput.first().isVisible({ timeout: 5000 }).catch(() => false))) {
          const currentText = await page
            .evaluate(() => document.body?.innerText?.substring(0, 300) || "")
            .catch(() => "");
          if (currentText.includes("Bestätigungscode per E-Mail")) {
            console.log("      Email-code verification page shown — continuing...");
            await page
              .click('button:has-text("Weiter"), input[type="submit"]', { timeout: 5000 })
              .catch(async () => {
                await page.evaluate(() => {
                  const form = document.querySelector("form") as HTMLFormElement | null;
                  if (form) form.submit();
                });
              });
            await page.waitForTimeout(5000);
          }
        }

        if (!(await otpInput.first().isVisible({ timeout: 1000 }).catch(() => false))) {
          const methodText = await page
            .evaluate(() => document.body?.innerText?.substring(0, 500) || "")
            .catch(() => "");
          if (methodText.includes("Code per E-Mail") && methodText.includes("Authentifizierungs-App")) {
            const methodLabel = totpSecret
              ? "Code mit Authentifizierungs-App erstellen"
              : "Code per E-Mail bekommen";
            console.log(`      Selecting 2FA method: ${methodLabel}`);
            await page.locator(`text="${methodLabel}"`).click({ timeout: 5000, force: true });
            await page
              .click('button:has-text("Weiter"), input[type="submit"]', { timeout: 5000 })
              .catch(async () => {
                await page.evaluate(() => {
                  const form = document.querySelector("form") as HTMLFormElement | null;
                  if (form) form.submit();
                });
              });
            await page.waitForTimeout(5000);
          }
        }

        if (!(await otpInput.first().isVisible({ timeout: 5000 }).catch(() => false))) {
          const currentText = await page
            .evaluate(() => document.body?.innerText?.substring(0, 300) || "")
            .catch(() => "");
          throw new Error("2FA was required, but no OTP input was visible. Page: " + currentText);
        }

        let otp: string;
        const otpPageText = await page
          .evaluate(() => document.body?.innerText?.substring(0, 500) || "")
          .catch(() => "");
        const isEmailCode = otpPageText.includes("E-Mail");

        if (totpSecret && !isEmailCode) {
          otp = generateTOTP(totpSecret);
          console.log("      Generated TOTP code.");
        } else {
          await writeLoginState({
            status: "awaiting_2fa",
            email: userEmail,
            message: "2FA code sent to email. Provide via: rewe verify <code>",
          });
          console.log("      2FA code sent to " + userEmail);
          console.log("      Provide the code:  rewe verify <code>");
          otp = await poll2FACode();
          console.log("      Got 2FA code.");
        }

        // ── Step 4c: Fill OTP and submit via form navigation ──
        // Extract form action URL
        const formAction = await page.evaluate(() => {
          const form = document.querySelector("form") as HTMLFormElement | null;
          return form?.action || "";
        });

        console.log("      Submitting OTP to:", formAction.substring(0, 80) + "...");

        // Fill the OTP input field
        await page
          .fill('input[name="otp"]', otp, { timeout: 3000 })
          .catch(async () => {
            await page
              .fill('input[autocomplete="one-time-code"]', otp, { timeout: 3000 })
              .catch(async () => {
                const inputs = await page.$$(
                  'input[type="text"], input[type="tel"], input[inputmode="numeric"]',
                );
                for (const inp of inputs) {
                  if (await inp.isVisible()) {
                    await inp.fill(otp);
                    break;
                  }
                }
              });
          });

        // Submit by setting form fields and submitting directly
        // IMPORTANT: Remove cf-turnstile-response field entirely — the real browser
        // submits without it (body is just "otp=CODE&login=")
        await page.evaluate((otpCode) => {
          const form = document.querySelector("form") as HTMLFormElement | null;
          if (!form) return;
          // Ensure otp field has the value
          const otpInput = form.querySelector('input[name="otp"]') as HTMLInputElement | null;
          if (otpInput) otpInput.value = otpCode;
          // Ensure login field exists
          let loginInput = form.querySelector('input[name="login"]') as HTMLInputElement | null;
          if (!loginInput) {
            loginInput = document.createElement("input");
            loginInput.type = "hidden";
            loginInput.name = "login";
            loginInput.value = "";
            form.appendChild(loginInput);
          }
          // REMOVE all Turnstile-related fields so they are not included in the POST
          form.querySelectorAll('[name="cf-turnstile-response"], [name="cf-chl-widget"]').forEach((el) => el.remove());
          // Also remove any Turnstile iframes/containers that might interfere
          form.querySelectorAll(".cf-turnstile, .turnstile-wrapper").forEach((el) => el.remove());
          // Submit the clean form
          form.submit();
        }, otp);

        // Wait for redirect
        console.log("      Waiting for redirect...");
        try {
          await page.waitForURL((url) => !url.toString().includes("account.rewe.de"), {
            timeout: 15000,
          });
        } catch {
          // Check if we're still on Keycloak
          console.log("      Current URL:", page.url());
          await page.waitForTimeout(5000);
        }
      } else if (pageText.includes("Ungültig") || pageText.includes("Captcha")) {
        throw new Error("Login rejected (invalid captcha). Try again.");
      } else {
        throw new Error(
          "Unexpected page after login: " + pageText.substring(0, 200),
        );
      }
    }

    // ── Step 5: Verify success and save cookies ──
    const finalUrl = page.url();
    console.log("[5/5] Final URL:", finalUrl);

    if (finalUrl.includes("rewe.de") && !finalUrl.includes("account.rewe.de")) {
      // Navigate to www.rewe.de to get rstp cookie
      await page.goto("https://www.rewe.de", {
        waitUntil: "domcontentloaded",
        timeout: 30000,
      }).catch(() => {});
      await page.waitForTimeout(3000);

      // Extract all cookies from the browser context
      const cookies = await context.cookies();
      const reweCookies = cookies.filter((c) => c.domain.includes("rewe"));

      // Save cookies in our session format
      await writeSessionState({
        cookies: reweCookies.map((c) => ({
          name: c.name,
          value: c.value,
          domain: c.domain,
          path: c.path,
          expires: c.expires,
          httpOnly: c.httpOnly,
          secure: c.secure,
          sameSite: c.sameSite,
        })),
        origins: [],
      });

      await writeLoginState({ status: "success" });
      console.log(`  Saved ${reweCookies.length} cookies to session.`);

      return "Login successful! Session cookies saved.";
    }

    const errorText = await page
      .evaluate(() => document.body?.innerText?.substring(0, 300) || "")
      .catch(() => "");
    await writeLoginState({ status: "error", message: errorText });
    throw new Error("Login did not complete. Page: " + errorText);
  } finally {
    await page.close();
    await context.close();
    await cleanup();
  }
}
