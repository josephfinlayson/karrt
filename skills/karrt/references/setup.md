# REWE CLI Setup Guide

Walk the user through each step below. Check off items as you go — if a step is already done (e.g., `dist/cli.js` exists), skip it.

## 1. Install the CLI

```bash
git clone https://github.com/Tobi4s1337/karrt.git /home/jfinlays/.openclaw/karrt
cd /home/jfinlays/.openclaw/karrt
npm install
npx playwright install chromium
npm run build
```

Requires **Node.js >= 18**. Verify with `node --version`.

## 2. Install the 2Captcha browser extension

The login flow needs the [2Captcha](https://2captcha.com/) Chromium extension to solve Cloudflare Turnstile CAPTCHAs on REWE's login page. Each solve costs ~$0.002, so a few dollars lasts a long time.

1. User needs a 2Captcha account with funds at [2captcha.com](https://2captcha.com/)
2. Download the extension from the [2captcha/solver_browser_extension releases](https://github.com/2captcha/solver_browser_extension/releases) — get the Chrome/Chromium `.zip` and extract it
3. Place the extracted folder at `/home/jfinlays/.openclaw/karrt/2captcha-solver/` (must contain a `manifest.json` file)
4. Configure the API key in `2captcha-solver/common/config.js`:
   ```js
   const defaultConfig = { apiKey: 'YOUR_2CAPTCHA_API_KEY', ... };
   ```

**How to verify:** `ls /home/jfinlays/.openclaw/karrt/2captcha-solver/manifest.json` should succeed.

## 3. Choose a pickup store

```bash
cd /home/jfinlays/.openclaw/karrt && node dist/cli.js store search <ZIP_CODE>
```

This returns available stores near the ZIP. Then set the store:

```bash
cd /home/jfinlays/.openclaw/karrt && node dist/cli.js store set <wwIdent> <ZIP_CODE>
```

**How to verify:** `cd /home/jfinlays/.openclaw/karrt && node dist/cli.js store show` returns the store info.

## 4. Set up TOTP for fully autonomous login

This is the most important step for autonomous operation. Without TOTP, every login pauses and waits for the user to manually provide a 2FA code from their email — completely breaking hands-free operation.

Tell the user:

> To enable fully autonomous login, you need to set up an Authenticator App for 2FA on your REWE account:
>
> 1. Go to your REWE account security settings at [rewe.de](https://www.rewe.de) (Profile > Security / Sicherheit)
> 2. Under **Two-Factor Authentication** ("Zwei-Faktor-Authentifizierung"), choose **Authenticator App** ("Authentifizierungs-App")
> 3. REWE will show a QR code. Look for the **"Manual entry"** / **"Schluessel manuell eingeben"** option — this reveals a **base32 secret** (a string like `JBSWY3DPEHPK3PXP`)
> 4. Enter this secret into your authenticator app (Google Authenticator, Authy, etc.) as you normally would
> 5. **Also** give me the secret so I can store it for autonomous login

Once the user provides the secret:

```bash
cd /home/jfinlays/.openclaw/karrt && node dist/cli.js totp-setup <BASE32_SECRET>
```

With TOTP configured, `karrt login` auto-generates the 6-digit 2FA code — no human interaction needed.

**How to verify:** The file `~/.config/karrt/totp-secret` should exist.

## 5. Set credentials and log in

The user needs to provide their REWE email and password. These are passed as environment variables:

```bash
export REWE_EMAIL="user@example.com"
export REWE_PASSWORD="their-password"
```

On a **headless server** (VPS without a display), prefix login with `xvfb-run`:

```bash
apt install xvfb  # if not already installed
cd /home/jfinlays/.openclaw/karrt && xvfb-run node dist/cli.js login
```

On a **desktop with a display**:

```bash
cd /home/jfinlays/.openclaw/karrt && node dist/cli.js login
```

The login opens a Chromium browser, fills credentials, solves the CAPTCHA via 2Captcha, enters the TOTP code, and saves session cookies. The whole process takes 15-30 seconds.

**How to verify:** `cd /home/jfinlays/.openclaw/karrt && node dist/cli.js basket show` should return basket data (not a 401/403 error).

## Setup Checklist

Before the user can shop, all of these must be done:

- [ ] CLI cloned, installed, built (`/home/jfinlays/.openclaw/karrt/dist/cli.js` exists)
- [ ] 2Captcha extension in `2captcha-solver/` with API key configured
- [ ] Store set (`karrt store show` returns store info)
- [ ] TOTP secret stored (`~/.config/karrt/totp-secret` exists)
- [ ] `REWE_EMAIL` and `REWE_PASSWORD` env vars set
- [ ] Login successful (`karrt login` completes, `basket show` works)

## Detecting Missing Setup

When you encounter these errors, point the user to the relevant step:

| Error | Missing step |
|-------|-------------|
| `"No store configured"` | Step 3 — store not set |
| `"2Captcha browser extension not found"` | Step 2 — extension not installed |
| `"Email and password required"` | Step 5 — env vars not set |
| `"Missing X server"` | Step 5 — need `xvfb-run` on headless servers |
| `"awaiting_2fa"` during login | Step 4 — TOTP not configured (login is waiting for manual 2FA) |
| 401/403 on any command | Step 5 — session expired, re-run login |
