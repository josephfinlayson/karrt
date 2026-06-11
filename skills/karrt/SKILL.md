---
name: karrt
description: Manage REWE grocery shopping — search products, build baskets, find cheapest options, check timeslots, manage orders. Use this skill whenever the user mentions groceries, shopping, food, cooking ingredients, recipes, meal planning, REWE, supermarket, delivery, or wants to buy/order any food or household items. Also use when the user asks about product prices, availability, organic/bio/vegan options, or delivery slots.
---

# REWE Grocery Shopping

You manage grocery shopping on rewe.de via the `karrt` CLI at `/home/jfinlays/.openclaw/karrt`. The CLI outputs JSON. All commands are run from this directory using `node dist/cli.js` (or just `karrt` if linked).

The user communicates via Telegram. They ask for things in natural language ("get me stuff for a pasta dish, keep it cheap"). Your job is to translate that into CLI calls, make smart product choices, and report back concisely.

## First-Time Setup

If the CLI is not installed yet (no `/home/jfinlays/.openclaw/karrt/dist/` directory), or you encounter setup errors like "No store configured", "2Captcha browser extension not found", or "Email and password required" — read `references/setup.md` for the full setup guide and walk the user through the missing steps.

The setup covers: CLI installation, 2Captcha extension, store selection, TOTP for autonomous 2FA (critical for hands-free operation), credentials, and login.

## Quick Reference

```
karrt search <query> [--sort PRICE_ASC|PRICE_DESC|NAME_ASC] [--category <slug>] [--offers] [--organic] [--vegan] [--vegetarian] [--regional] [--page N] [--per-page N]
karrt basket show
karrt basket add <listingId> [--qty N]
karrt basket update <listingId> <qty>
karrt basket remove <listingId> [--basket-id <id>]
karrt basket clear
karrt basket bulk-add '<json>'
karrt timeslots
karrt timeslot-reserve <slotId>
karrt checkout status
karrt checkout review
karrt checkout place-order
karrt checkout place-order --confirm "PLACE REWE ORDER"
karrt favorites show
karrt favorites search <query>
karrt orders show
karrt orders get <orderId>
karrt receipts show
karrt receipts download <receiptId> [--output file.pdf]
karrt suggestion <N>
karrt store show
karrt store search <zip>
karrt store set <wwIdent> <zip>
karrt login [--email X] [--password Y]
karrt import-cookies <file>
karrt totp-setup <secret>
```

Add `-p` to any command for pretty-printed JSON.

## How to Run Commands

```bash
cd /home/jfinlays/.openclaw/karrt && node dist/cli.js <command>
```

If you get an error about missing dist/, build first: `npm run build`

## Date & Time Handling

Time-sensitive commands (`timeslots`, `orders`, `receipts`, `timeslot-reserve`) include a `now` field showing the current date and time in German locale (Europe/Berlin). Use this to:

- Convert "tomorrow" / "next Tuesday" / "this weekend" into actual dates
- Present timeslots as human-readable day names ("Tuesday 08:00–09:00") relative to now
- All API timestamps are UTC — convert to Europe/Berlin (UTC+1 winter, UTC+2 summer) when presenting to the user
- REWE typically does not offer Sunday delivery

## Authentication

The CLI uses browser-based login (Playwright + stealth + 2Captcha extension). Basket commands use the persistent Chromium profile because REWE rejects the same basket request with `400 Bad Request` from plain Node/curl.

Product search can run anonymously, but anonymous search may return catalog-only products with empty `_embedded.articles`, which means no listing IDs and nothing addable. If search results have empty articles, run `karrt login` and retry the same search before selecting products.

**If you get a 401/403 error**, the API session has expired. Re-authenticate:
```bash
cd /home/jfinlays/.openclaw/karrt && node dist/cli.js login
```

Login is fully autonomous when TOTP is configured — no human interaction needed. Credentials come from `REWE_EMAIL` and `REWE_PASSWORD` environment variables.

**Do not ask the user about authentication.** Just re-login silently and retry the failed command. Only tell the user if login itself fails.

## Operational Scripts

Run these from `/home/jfinlays/.openclaw/karrt` after `npm run build`:

```bash
node scripts/basket-review.mjs
node scripts/reserve-slot.mjs 2026-06-12 10:00
node scripts/checkout-with-config.mjs
node scripts/checkout-with-config.mjs --confirm
```

Use `basket-review.mjs` for the latest authoritative basket summary. Use `reserve-slot.mjs` with Europe/Berlin local date/time. Use `checkout-with-config.mjs` without `--confirm` to reach the final order page and inspect errors; use `--confirm` only when the user explicitly authorizes placing the order.

Checkout fails closed: if `~/.config/karrt/checkout.json` is missing, malformed, or rejected by REWE payment validation, the checkout command stops on the payment page and reports the visible error instead of placing an order.

## Checkout Config

Checkout payment details live in `~/.config/karrt/checkout.json` with mode `0600`. Do not put account details in the skill or repo. The expected shape is:

```json
{
  "payment": {
    "method": "DIRECT_DEBIT",
    "accountOwner": "Name",
    "iban": "DE...",
    "dateOfBirth": "YYYY-MM-DD"
  }
}
```

For invoice checkout, use:

```json
{ "payment": { "method": "INVOICE" } }
```

The helper `node scripts/set-checkout-config.mjs` can write this file from environment variables. For direct debit, set `KARRT_PAYMENT_METHOD=DIRECT_DEBIT`, `KARRT_ACCOUNT_OWNER`, `KARRT_IBAN`, and `KARRT_DOB=YYYY-MM-DD`. For invoice, set `KARRT_PAYMENT_METHOD=INVOICE`.

## Searching for Products

### The Category Filter (Important!)

REWE's search is fuzzy — searching "Milch" returns shower gel and cat food alongside actual milk, and "Eier" returns Kinder Surprise eggs. **Always use `--category <slug>`** to constrain results to the right product type.

```bash
karrt search "Milch" --sort PRICE_ASC --category milch
karrt search "Eier" --sort PRICE_ASC --category eier-ei-ersatz
karrt search "Hähnchenbrust" --sort PRICE_ASC --category gefluegelfleisch
karrt search "Parmesan" --sort PRICE_ASC --category hartkaese
```

**Heads-up on "eier-ei-ersatz"**: This category includes both real eggs AND vegan egg substitutes. The substitute (REWE Bio + vegan Eiersatz, 0.69€) sorts cheapest but is NOT eggs — skip it when the user wants actual eggs. Real eggs start around 1.89€ (Bodenhaltung) / 2.29€ (Freiland).

### Category Slug Reference

The `--category` flag accepts URL-style slugs derived from REWE's category tree. Here are the most commonly needed ones:

**Dairy & Eggs:**
| Slug | Products |
|------|----------|
| `milch` | All milk (H-Milch, Frischmilch, etc.) |
| `eier-ei-ersatz` | Eggs (Freiland, Bio, Bodenhaltung) + egg substitutes |
| `butter` | Butter |
| `joghurt-alternativen` | Yogurt |
| `hartkaese` | Hard cheese (Parmesan, Grana Padano, Pecorino) |
| `frischkaese` | Fresh cheese (Mozzarella, Ricotta, cream cheese) |
| `kaese-kaeseersatz` | All cheese |

**Meat & Fish:**
| Slug | Products |
|------|----------|
| `gefluegelfleisch` | Poultry (chicken breast, turkey, etc.) |
| `schweinefleisch` | Pork |
| `rindfleisch` | Beef |
| `roher-schinken-speck` | Raw ham, bacon, Speck, Pancetta |
| `wurst-aufschnitt` | Cold cuts and sausages |
| `frischer-fisch` | Fresh fish |

**Staples & Pantry:**
| Slug | Products |
|------|----------|
| `nudeln` | Pasta (Spaghetti, Penne, etc.) |
| `reis` | Rice |
| `mehl` | Flour |
| `zucker-suessungsmittel` | Sugar & sweeteners |
| `oele` | Cooking oils |
| `essig` | Vinegar |
| `gewuerze` | Spices & seasonings |

**Fresh Produce:**
| Slug | Products |
|------|----------|
| `frisches-obst` | Fresh fruit |
| `frisches-gemuese` | Fresh vegetables |
| `salat` | Salad & lettuce |
| `kraeuter` | Fresh herbs |

**Bakery & Bread:**
| Slug | Products |
|------|----------|
| `brot` | Bread |
| `broetchen-laugengebaeck` | Rolls & pretzels |

**Beverages:**
| Slug | Products |
|------|----------|
| `wasser` | Water |
| `saefte` | Juices |
| `bier` | Beer |
| `wein` | Wine |
| `kaffee` | Coffee |
| `tee` | Tea |

**Frozen & Convenience:**
| Slug | Products |
|------|----------|
| `tiefkuehlkost` | Frozen food |
| `pizza-baguettes` | Frozen pizza |

**Snacks & Sweets:**
| Slug | Products |
|------|----------|
| `chips-knabbereien` | Chips & snacks |
| `schokolade` | Chocolate |

**Deriving new slugs:** Category slugs are kebab-case versions of the German category name with umlauts converted (ä→ae, ö→oe, ü→ue, ß→ss). If a slug returns 404, try the parent category or a broader term. Check `categoryPath` in any search result to discover the exact hierarchy.

Some documented slugs can go stale. If a search fails with `Category not found`, rerun without `--category`, inspect `categoryPath`, and choose an addable product whose name/category actually matches the user intent. Do not blindly take the cheapest result; fuzzy search can return seasoning mixes for vegetables or vegan substitutes for eggs.

### Search Strategy

**Always use `--category` when you know what type of product the user wants.** Only omit it for genuinely open-ended searches (e.g., "what's on offer this week?").

When the category slug is unknown or returns 404:
1. Do a quick search without `--category` first
2. Check the `categoryPath` field in the results to discover the right slug
3. Re-search with `--category` for clean results

### Finding the Cheapest Option

Always use `--sort PRICE_ASC` when the user wants cheap/cheapest. Use `--per-page 5` to keep output small when you only need the top few:
```bash
karrt search "Mozzarella" --sort PRICE_ASC --category frischkaese --per-page 5
```
The first result is the cheapest. Compare by **grammage** (price per kg/L) when products have different sizes — a larger pack at a higher total price may be cheaper per unit.

### Search Strategy for Recipes / Meal Planning

When shopping for a recipe, search each ingredient individually with the appropriate category:
```bash
karrt search "Spaghetti" --sort PRICE_ASC --category nudeln
karrt search "Speck" --sort PRICE_ASC --category roher-schinken-speck
karrt search "Eier" --sort PRICE_ASC --category eier-ei-ersatz
karrt search "Parmesan" --sort PRICE_ASC --category hartkaese
karrt search "Pfeffer" --sort PRICE_ASC --category gewuerze
```

Use German terms for searches. If a search returns no results, try shorter/simpler terms.

### Attribute Filters

| Flag | What it does | When to use |
|------|-------------|-------------|
| `--offers` | Only discounted items | User wants deals/Angebote |
| `--organic` | Organic/Bio products | User asks for bio, organic, ökologisch |
| `--vegan` | Vegan products | User asks for vegan, plant-based |
| `--vegetarian` | Vegetarian products | User asks for vegetarian |
| `--regional` | Regional products | User asks for local/regional |

These can be combined with each other and with `--category`:
```bash
karrt search "Milch" --organic --category milch
karrt search "Hähnchen" --organic --regional --category gefluegelfleisch
```

### Understanding Product Quality Labels

**Bio/Organic**: Use `--organic` flag. Brands: "REWE Bio", "ja! Natürlich", "Demeter", "Bioland".

**Haltungsform (animal welfare tiers)**: NOT a search filter — check product names:
- **Haltungsform 1** (Stallhaltung) — basic factory farming, cheapest
- **Haltungsform 2** (StallhaltungPlus) — slightly better conditions
- **Haltungsform 3** (Außenklima) — outdoor access
- **Haltungsform 4** (Premium) — highest welfare, most expensive
- Bio/organic meat is typically Haltungsform 4

**REWE Brand Tiers** (cheapest → most expensive):
- **"ja!"** — Budget brand, cheapest for most staples
- **"REWE Beste Wahl"** — Mid-tier quality
- **"REWE Bio"** — Organic line
- **"REWE Feine Welt"** — Premium/gourmet

## Understanding Search Results

Each product in results has this structure (key fields):

```
productName: "ja! Mozzarella"
brand.name: "ja!"
_embedded.articles[0]._embedded.listing.id: "8-1234567-890123"  ← listingId for basket
_embedded.articles[0]._embedded.listing.pricing:
  currentRetailPrice: 85        ← price in CENTS (85 = 0.85€)
  grammage: "125 g (1 kg = 6,80 €)"
_embedded.categoryPath: "Käse, Eier & Molkerei/Käse & Käseersatz/Frischkäse/"  ← verify product type
```

**Prices are in cents.** Divide by 100 to get euros.

**The listingId** is what you need for basket operations. Extract it from `_embedded.articles[0]._embedded.listing.id`.

**The categoryPath** tells you whether the product is actually what you searched for. Use it to verify results and to discover new category slugs.

## Basket Management

### Adding Items
```bash
karrt basket add "8-1234567-890123" --qty 2
```

### Building a Shopping List
When the user asks you to shop for a recipe or meal:

1. **Clear the basket first** (if they want a fresh start): `karrt basket clear`
2. **Search each ingredient** with `--sort PRICE_ASC --category <slug>` for budget-conscious shopping
3. **Pick the best match** — consider: price, brand (ja! = cheapest), size, and whether it matches
4. **Add each item** to the basket
5. **Show a summary** with item names, quantities, and total cost
6. **Check checkout status** with `karrt checkout status` before discussing delivery slots or checkout

### Bulk Add
For adding many items at once (faster than individual adds):
```bash
karrt basket bulk-add '[{"listingId":"8-123-456","qty":1},{"listingId":"8-789-012","qty":2}]'
```

### Viewing the Basket
```bash
karrt basket show
```
The response includes:
- `lineItems`: each item with name, quantity, price, totalPrice
- `summary.totalPrice`: basket total in cents
- `staggerings`: free delivery thresholds (usually 50€ for free delivery)

### Free Delivery Threshold

REWE charges a delivery fee (usually 2€) for baskets under 50€. The basket response includes `staggerings` info:
- `reachedStaggering.displayText` — current fee tier
- `nextStaggering.remainingArticlePrice` — cents needed to reach the next (cheaper/free) tier

When the user is close to 50€, suggest adding a few more items. Use `karrt suggestion 5` to find frequently-ordered items that could fill the gap.

### Clearing the Basket
```bash
karrt basket clear
```
This removes all items one by one. It's not instant for large baskets.

## Timeslots & Delivery

```bash
karrt timeslots
karrt timeslot-reserve <slotId>
```

The response includes a `now` field with the current date/time. Use this to present slots as readable days.

- REWE delivery is available most days, typically 08:00–18:00 hourly slots
- Timeslot IDs look like UUIDs — pass them to `karrt timeslot-reserve <slotId>`
- Reservations expire (usually ~30 min) — reserve close to when the user wants to finalize
- The `serviceFee` in the response is in cents (0 = free delivery, usually when basket > 50€)
- `timeslot-reserve` must use the basket `customerUuid`, not the auth JWT user id. The CLI has been patched for this; if you see 401 on reservation after successful `timeslots`, rebuild and retry.

## Checkout Safety

Use checkout commands to inspect readiness first:
```bash
karrt checkout status
karrt checkout review
karrt checkout place-order
```

The checkout flow is:
1. Build the basket.
2. Run `karrt checkout status`.
3. If the basket is below the delivery minimum, add more items or ask the user what to add.
4. Show the user a few readable delivery slots from `karrt timeslots`.
5. Ask the user to choose or confirm a slot before running `karrt timeslot-reserve <slotId>`.
6. Run `karrt checkout review` after reserving a slot.
7. Run `karrt checkout place-order` or `node scripts/checkout-with-config.mjs` without confirmation to dry-run the final review page.
8. Summarize the basket total, delivery slot, address, and payment method shown by the dry run.
9. Ask the user for a final explicit confirmation before placing the order.

Only place the final order when the user explicitly confirms they want to place the REWE order now. After that confirmation, run:
```bash
karrt checkout place-order --confirm "PLACE REWE ORDER"
```
This clicks the real `Jetzt bestellen` button on rewe.de. Do not run it speculatively, during planning, or merely because the basket is ready.

If direct debit fails, surface REWE's exact visible error text. A common error is `Deine IBAN scheint nicht zu stimmen. Bitte überprüfe diese nochmals.` If the user switches payment method, update `~/.config/karrt/checkout.json`, reserve the slot again if it expired, then rerun the dry-run checkout.

## Smart Shopping Patterns

### "Find me the cheapest X"
```bash
karrt search "X" --sort PRICE_ASC --category <appropriate-slug>
```
Report the top 1-3 results with name, price, and grammage.

### "Get me ingredients for [dish]"
1. Think through what ingredients the dish needs
2. Search each one with `--sort PRICE_ASC --category <slug>`
3. Pick one product per ingredient (prefer ja! brand for budget, REWE Bio for organic)
4. Add all to basket
5. Report: what you picked, individual prices, total

### "What's on offer?"
```bash
karrt search "Obst" --offers --category frisches-obst
```

### "Show me organic/bio options for X"
```bash
karrt search "X" --organic --category <slug>
```

### "Suggest items to fill my cart for free delivery"
```bash
karrt suggestion 5
```
This analyzes past orders and suggests frequently-bought items not in the current basket, plus shows how much more is needed for the free delivery threshold.

## Error Handling

| Error | Meaning | Action |
|-------|---------|--------|
| `"No valid session"` | API cookies expired | Run `karrt login`, retry |
| `"Auth error (401/403)"` | Session expired mid-use | Run `karrt login`, retry |
| `"Browser API error 400"` | Browser profile/store state is stale or incomplete | Run `karrt login`, then retry |
| `"Category not found" (404)` | Wrong category slug | Search without `--category`, check `categoryPath` in results, retry with correct slug |
| `"No basket yet"` | No items added yet | Add an item first |
| `"No basket ID"` | Same as above | Add an item first |
| Search results with empty `_embedded.articles` | Anonymous/stale search context | Run `karrt login`, retry search |
| `timeslot-reserve` 401 after `timeslots` works | Wrong customer id or stale build | Rebuild; reservation must use basket `customerUuid` |
| Checkout remains on payment page | Payment validation failed | Report visible error text and update checkout config |

When a session error occurs, re-login automatically and retry the command. Don't burden the user with auth details.

## Presenting Results to the User

- **Prices**: Always in euros with 2 decimal places (e.g., "0.85€")
- **Products**: Name + brand + price + grammage on one line
- **Basket summaries**: Table or list format with total at the bottom
- **Timeslots**: Group by day, show as "Tuesday 08:00–09:00" not raw ISO timestamps
- **Keep it concise**: The user is on Telegram — short messages, no walls of JSON
- **Use German product names**: Don't translate "Hähnchenbrustfilet" to "chicken breast fillet" in the summary — keep the original name so the user recognizes it in the delivery order
