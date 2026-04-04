# rewe-cli

A CLI tool for REWE grocery pickup ordering — designed for AI agent integration.

Search products, manage baskets, check timeslots, and place pickup orders from the terminal. All output is JSON, making it ideal for AI agents to parse and act on.

> **Disclaimer:** This is an **unofficial** project and is **not affiliated with, endorsed by, or connected to REWE Group or REWE digital** in any way. It interacts with REWE's public-facing web APIs, which are undocumented and may change at any time. **This tool may break without notice.** Use at your own risk.

## Requirements

- **Node.js** >= 18
- **Playwright** browsers (installed automatically)
- A **REWE account** with pickup enabled for your store
- A **2Captcha** account and API key (for solving Turnstile CAPTCHAs during login)
- **Linux** recommended (tested on Ubuntu). macOS should work but is untested.

## Installation

```bash
git clone https://github.com/Tobi4s1337/rewe-cli.git
cd rewe-cli
npm install
npx playwright install chromium
npm run build
```

### 2Captcha Browser Extension Setup

The login flow uses a Chromium browser extension from [2Captcha](https://2captcha.com/) to automatically solve Cloudflare Turnstile challenges on the REWE login page.

1. **Get a 2Captcha account** at [2captcha.com](https://2captcha.com/) and add funds (a few dollars lasts a long time — each solve costs ~$0.002).

2. **Download the 2Captcha browser extension** from their [GitHub releases](https://github.com/2captcha/solver_browser_extension/releases) or the Chrome Web Store.

3. **Place the extension** in the `2captcha-solver/` directory at the project root. It should contain a `manifest.json` file.

4. **Configure the extension** by editing `2captcha-solver/common/config.js` and setting your API key:
   ```js
   const defaultConfig = {
     apiKey: 'YOUR_2CAPTCHA_API_KEY',
     // ...
   };
   ```

   Alternatively, launch the browser manually once, open the extension popup, and enter your API key there — it persists in the Chrome profile stored in `.chrome-data/`.

### Environment Variables

Set these for fully autonomous login (no manual interaction needed):

```bash
export REWE_EMAIL="your@email.com"
export REWE_PASSWORD="your-password"
```

### TOTP Setup (Recommended)

For fully autonomous 2FA, store your REWE account's TOTP secret:

```bash
node dist/cli.js totp-setup YOUR_BASE32_TOTP_SECRET
```

To get the TOTP secret:
1. Go to your REWE account security settings
2. Set up an authenticator app for 2FA
3. When shown the QR code, look for the "manual entry" option — that gives you the base32 secret
4. Enter it both in your authenticator app AND via `totp-setup`

With TOTP configured, `rewe login` is fully hands-free: it fills credentials, solves the CAPTCHA, and auto-generates the 2FA code.

## Quick Start

```bash
# 1. Find your local REWE pickup store
node dist/cli.js store search 66113

# 2. Set your store
node dist/cli.js store set 840254 66113

# 3. Log in (opens browser, solves CAPTCHA, handles 2FA)
node dist/cli.js login

# 4. Search for products
node dist/cli.js search "Vollmilch" --sort PRICE_ASC --category milch

# 5. Add to basket
node dist/cli.js basket add "8-Y4PWBC9S-d1125764-996e-3535-8619-eff4f86b672f"

# 6. Check timeslots
node dist/cli.js timeslots
```

## Commands

### Store Management

```bash
rewe store show                    # Show current store
rewe store search <zip>            # Find pickup stores near ZIP code
rewe store set <wwIdent> <zip>     # Set active store
```

### Authentication

```bash
rewe login [--email X] [--password Y]   # Browser-based login
rewe verify <code>                       # Provide 2FA code (if TOTP not configured)
rewe login-status                        # Check login flow status
rewe import-cookies <file>               # Import cookies from Netscape file
rewe totp-setup <secret>                 # Store TOTP secret for auto-2FA
```

### Product Search

```bash
rewe search <query> [options]
```

| Option | Description |
|--------|-------------|
| `--sort <order>` | `RELEVANCE_DESC`, `PRICE_ASC`, `PRICE_DESC`, `NAME_ASC`, `NAME_DESC` |
| `--category <slug>` | Filter by category (e.g., `milch`, `nudeln`, `gefluegelfleisch`) |
| `--page <n>` | Page number (default: 1) |
| `--per-page <n>` | Results per page (default: 40) |
| `--offers` | Only discounted items |
| `--organic` | Organic/Bio products |
| `--regional` | Regional products |
| `--vegan` | Vegan products |
| `--vegetarian` | Vegetarian products |

**Category slugs** constrain results to the right product type. Without them, a search for "Milch" might return shower gel. Common slugs:

| Category | Slug |
|----------|------|
| Milk | `milch` |
| Eggs | `eier-ei-ersatz` |
| Cheese (hard) | `hartkaese` |
| Cheese (fresh) | `frischkaese` |
| Poultry | `gefluegelfleisch` |
| Pork | `schweinefleisch` |
| Beef | `rindfleisch` |
| Bacon/Ham | `roher-schinken-speck` |
| Pasta | `nudeln` |
| Rice | `reis` |
| Fresh fruit | `frisches-obst` |
| Fresh vegetables | `frisches-gemuese` |
| Spices | `gewuerze` |
| Butter | `butter` |
| Bread | `brot` |

Slugs are kebab-case German category names (ä→ae, ö→oe, ü→ue). If a slug returns 404, check `categoryPath` in any search result to discover the correct one.

### Basket

```bash
rewe basket show                      # Show current basket
rewe basket add <listingId> [--qty N] # Add item
rewe basket update <listingId> <qty>  # Update quantity
rewe basket remove <listingId>        # Remove item
rewe basket clear                     # Clear all items
rewe basket bulk-add '<json>'         # Add multiple: '[{"listingId":"x","qty":1}]'
```

### Timeslots

```bash
rewe timeslots                     # List available pickup timeslots
rewe timeslot-reserve <slotId>     # Reserve a timeslot
```

Time-sensitive commands include a `now` field with the current local date/time (Europe/Berlin).

### Orders

```bash
rewe orders show                   # List all orders
rewe orders get <orderId>          # Order details
rewe orders cancel <orderId>       # Cancel order
```

### Receipts

```bash
rewe receipts show                           # List digital receipts
rewe receipts download <receiptId> [--output] # Download PDF
```

### Suggestions

```bash
rewe suggestion <N>    # Suggest N items based on order history to reach free pickup
```

## Output Format

All commands output JSON. Add `-p` for pretty-printed output:

```bash
node dist/cli.js search "Banane" -p
```

Prices are in **cents** (e.g., `currentRetailPrice: 85` = €0.85).

## Session Management

Login creates a browser session stored in `~/.config/rewe-cli/session.json`. The session cookies (especially `rstp`) expire roughly every 10 minutes. When you get a 401/403 error, re-run `rewe login`.

All config is stored in `~/.config/rewe-cli/`:
- `session.json` — Browser cookies
- `selected_store` / `selected_zip` — Current store
- `basket-id` — Active basket ID
- `totp-secret` — TOTP secret for 2FA
- `login-state.json` — Login flow IPC

## How It Works

- **Search** is public — no authentication needed
- **Everything else** (basket, orders, timeslots) requires a valid session
- Login uses **Playwright** with stealth plugins to automate the REWE login page
- **Turnstile CAPTCHA** is solved by the 2Captcha browser extension running inside Chromium
- The login page sometimes shows a "continue with remembered account" prompt instead of the login form — both flows are handled automatically
- Cookies are extracted from the browser and reused for API calls via **axios**

## Known Limitations

- Session expires frequently (~10 min) — no automatic refresh yet
- The 2Captcha extension needs a few seconds to solve each CAPTCHA
- Checkout/payment is not yet implemented — you can build a basket and reserve a timeslot, but need to complete the order on rewe.de
- Only REWE Pickup is supported (not delivery)
- Category slugs may change if REWE reorganizes their product categories

## License

MIT
