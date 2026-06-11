# Karrt operational scripts

These scripts are intended for OpenClaw/agent use from `/home/jfinlays/.openclaw/karrt`.
Run them with the same Node binary used by OpenClaw, for example:

```bash
node scripts/basket-review.mjs
node scripts/reserve-slot.mjs 2026-06-12 10:00
node scripts/checkout-with-config.mjs
node scripts/checkout-with-config.mjs --confirm
```

Checkout payment details are stored locally in `~/.config/karrt/checkout.json` with mode `0600`.
Do not commit that file. Create or update it with:

```bash
KARRT_PAYMENT_METHOD=DIRECT_DEBIT \
KARRT_ACCOUNT_OWNER="Account Owner" \
KARRT_IBAN="DE..." \
KARRT_DOB="YYYY-MM-DD" \
node scripts/set-checkout-config.mjs
```

Use `KARRT_PAYMENT_METHOD=INVOICE` to select invoice checkout.
