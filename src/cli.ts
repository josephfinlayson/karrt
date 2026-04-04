#!/usr/bin/env node

import { Command } from "commander";
import { ReweHttpClient } from "./http/client.js";
import {
  readSettings,
  writeSettings,
  hasValidSession,
  writeSessionState,
} from "./storage/index.js";
import { login } from "./auth/index.js";
import { write2FACode, readLoginState } from "./auth/ipc.js";
import { saveTotpSecret, readTotpSecret } from "./auth/totp.js";
import { parseNetscapeCookies, cookiesToStorageState } from "./storage/cookies.js";
import { readFile } from "node:fs/promises";
import {
  ReweApi,
  searchStores,
  storeExists,
  searchProducts,
} from "./api/index.js";
import type { SearchAttribute, SearchOptions, SortOrder } from "./api/index.js";

const program = new Command();

function output(data: unknown, pretty: boolean): void {
  console.log(pretty ? JSON.stringify(data, null, 2) : JSON.stringify(data));
}

/** Wrap response with current local timestamp for time-sensitive commands */
function withTimestamp(data: unknown): { now: string; data: unknown } {
  return {
    now: new Date().toLocaleString("de-DE", { timeZone: "Europe/Berlin", dateStyle: "full", timeStyle: "short" }),
    data,
  };
}

function getPretty(): boolean {
  return !!program.opts().pretty;
}

function getClient(): ReweHttpClient {
  return new ReweHttpClient();
}

async function getApi(): Promise<ReweApi> {
  const client = getClient();
  const store = await readSettings();
  const valid = await hasValidSession();
  if (!valid) {
    throw new Error(
      "No valid session. Run `karrt login` or `karrt import-cookies <file>` first.",
    );
  }
  return new ReweApi(client, store);
}

async function run(fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(JSON.stringify({ error: msg }));
    process.exitCode = 1;
  }
}

program
  .name("karrt")
  .description("karrt — grocery ordering from the terminal")
  .version("0.2.0")
  .option("-p, --pretty", "Pretty-print JSON output");

// ── store ──

const storeCmd = program
  .command("store")
  .description("Show current store, or search/set stores");

storeCmd
  .command("show", { isDefault: true })
  .description("Show currently selected store")
  .action(() =>
    run(async () => {
      output(await readSettings(), getPretty());
    }),
  );

storeCmd
  .command("search <zip>")
  .description("Find pickup stores near ZIP code")
  .action((zip: string) =>
    run(async () => {
      const client = getClient();
      output(await searchStores(client, zip), getPretty());
    }),
  );

storeCmd
  .command("set <wwIdent> <zip>")
  .description("Set active store by market ID and ZIP")
  .action((wwIdent: string, zip: string) =>
    run(async () => {
      output(await writeSettings(wwIdent, zip), getPretty());
    }),
  );

// ── login ──

program
  .command("login")
  .description(
    "Authenticate with REWE account (browser-based). Uses TOTP if configured, otherwise waits for 2FA code.",
  )
  .option("--email <email>", "REWE account email (or REWE_EMAIL env)")
  .option("--password <password>", "REWE account password (or REWE_PASSWORD env)")
  .action((opts: { email?: string; password?: string }) =>
    run(async () => {
      const client = getClient();
      const msg = await login(client, opts.email, opts.password);
      output({ message: msg }, getPretty());
    }),
  );

program
  .command("verify <code>")
  .description("Provide the 2FA code sent to your email during `rewe login`")
  .action((code: string) =>
    run(async () => {
      await write2FACode(code);
      output(
        { message: `2FA code "${code}" delivered to login process.` },
        getPretty(),
      );
    }),
  );

program
  .command("login-status")
  .description("Check the current login flow status")
  .action(() =>
    run(async () => {
      const state = await readLoginState();
      output(state, getPretty());
    }),
  );

program
  .command("import-cookies <file>")
  .description("Import cookies from a Netscape cookie file (exported from browser)")
  .action((file: string) =>
    run(async () => {
      const text = await readFile(file, "utf-8");
      const cookies = parseNetscapeCookies(text);
      const reweCookies = cookies.filter((c) => c.domain.includes("rewe"));
      if (reweCookies.length === 0) {
        throw new Error("No rewe.de cookies found in the file.");
      }
      const state = cookiesToStorageState(reweCookies);
      await writeSessionState(state);
      output(
        {
          message: `Imported ${reweCookies.length} cookies.`,
          cookies: reweCookies.map((c) => `${c.name} (${c.domain})`),
        },
        getPretty(),
      );
    }),
  );

program
  .command("totp-setup <secret>")
  .description("Store TOTP secret for fully autonomous 2FA during login")
  .action((secret: string) =>
    run(async () => {
      await saveTotpSecret(secret);
      output({ message: "TOTP secret saved. Login will now auto-generate 2FA codes." }, getPretty());
    }),
  );

// ── search ──

program
  .command("search <query>")
  .description("Search products by name")
  .option("--page <n>", "Page number", "1")
  .option("--per-page <n>", "Results per page", "40")
  .option("--sort <order>", "Sort: RELEVANCE_DESC, PRICE_ASC, PRICE_DESC, NAME_ASC, NAME_DESC")
  .option("--category <slug>", "Filter by category slug (e.g. milch, gefluegelfleisch, eier)")
  .option("--offers", "Only discounted items")
  .option("--organic", "Filter organic products")
  .option("--regional", "Filter regional products")
  .option("--vegan", "Filter vegan products")
  .option("--vegetarian", "Filter vegetarian products")
  .action(
    (
      query: string,
      opts: {
        page: string;
        perPage: string;
        sort?: string;
        category?: string;
        offers?: boolean;
        organic?: boolean;
        regional?: boolean;
        vegan?: boolean;
        vegetarian?: boolean;
      },
    ) =>
      run(async () => {
        const attrs: SearchAttribute[] = [];
        if (opts.offers) attrs.push("discounted");
        if (opts.organic) attrs.push("organic");
        if (opts.regional) attrs.push("regional");
        if (opts.vegan) attrs.push("vegan");
        if (opts.vegetarian) attrs.push("vegetarian");

        const searchOpts: SearchOptions = {
          page: parseInt(opts.page, 10),
          perPage: parseInt(opts.perPage, 10),
          attributes: attrs.length > 0 ? attrs : undefined,
          sort: opts.sort as SortOrder | undefined,
          categorySlug: opts.category,
        };

        const client = getClient();
        const store = await readSettings();
        output(await searchProducts(client, store, query, searchOpts), getPretty());
      }),
  );

// ── favorites ──

const favsCmd = program
  .command("favorites")
  .description("Show favorites, or search/add/delete");

favsCmd
  .command("show", { isDefault: true })
  .description("Show all favorite products")
  .action(() =>
    run(async () => {
      const api = await getApi();
      output(await api.favorites(), getPretty());
    }),
  );

favsCmd
  .command("search <query>")
  .description("Filter favorites by name")
  .action((query: string) =>
    run(async () => {
      const api = await getApi();
      output(await api.favorites(query), getPretty());
    }),
  );

favsCmd
  .command("add <listingId> <productId>")
  .description("Add product to favorites")
  .action((listingId: string, productId: string) =>
    run(async () => {
      const api = await getApi();
      output(await api.favoritesAdd(listingId, productId), getPretty());
    }),
  );

favsCmd
  .command("delete <itemId>")
  .description("Remove item from favorites")
  .action((itemId: string) =>
    run(async () => {
      const api = await getApi();
      await api.favoritesDelete(itemId);
      output({ message: "Deleted" }, getPretty());
    }),
  );

// ── basket ──

const basketCmd = program
  .command("basket")
  .description("Show basket, or add/remove/clear items");

basketCmd
  .command("show", { isDefault: true })
  .description("Show current basket")
  .action(() =>
    run(async () => {
      const api = await getApi();
      output(await api.basket(), getPretty());
    }),
  );

basketCmd
  .command("add <listingId>")
  .description("Add item to basket")
  .option("--qty <n>", "Quantity (default 1)", "1")
  .action((listingId: string, opts: { qty: string }) =>
    run(async () => {
      const api = await getApi();
      output(
        await api.basketAdd(listingId, parseInt(opts.qty, 10)),
        getPretty(),
      );
    }),
  );

basketCmd
  .command("update <listingId> <qty>")
  .description("Update item quantity in basket")
  .action((listingId: string, qty: string) =>
    run(async () => {
      const api = await getApi();
      output(await api.basketUpdate(listingId, parseInt(qty, 10)), getPretty());
    }),
  );

basketCmd
  .command("remove <listingId>")
  .description("Remove item from basket")
  .option("--basket-id <id>", "Basket ID (auto-detected if not provided)")
  .action((listingId: string, opts: { basketId?: string }) =>
    run(async () => {
      const api = await getApi();
      const { readBasketId } = await import("./storage/index.js");
      const basketId = opts.basketId ?? await readBasketId();
      if (!basketId) throw new Error("No basket ID. Add an item first.");
      await api.basketRemove(basketId, listingId);
      output({ message: "Removed" }, getPretty());
    }),
  );

basketCmd
  .command("clear")
  .description("Remove all items from basket")
  .action(() =>
    run(async () => {
      const api = await getApi();
      await api.basketClear();
      output({ message: "Basket cleared" }, getPretty());
    }),
  );

basketCmd
  .command("bulk-add <json>")
  .description('Add multiple items: \'[{"listingId":"x","qty":1},...]\'')
  .action((json: string) =>
    run(async () => {
      const items = JSON.parse(json) as { listingId: string; qty?: number }[];
      const api = await getApi();
      output(await api.basketBulkAdd(items), getPretty());
    }),
  );

// ── timeslots ──

program
  .command("timeslots")
  .description("List available pickup timeslots")
  .action(() =>
    run(async () => {
      const api = await getApi();
      output(withTimestamp(await api.timeslots()), getPretty());
    }),
  );

program
  .command("timeslot-reserve <slotId>")
  .description("Reserve a pickup timeslot")
  .action((slotId: string) =>
    run(async () => {
      const api = await getApi();
      output(withTimestamp(await api.timeslotReserve(slotId)), getPretty());
    }),
  );

// ── orders ──

const ordersCmd = program
  .command("orders")
  .description("Show orders");

ordersCmd
  .command("show", { isDefault: true })
  .description("Show all orders")
  .action(() =>
    run(async () => {
      const api = await getApi();
      output(withTimestamp(await api.orders()), getPretty());
    }),
  );

ordersCmd
  .command("get <orderId>")
  .description("Get order details")
  .action((orderId: string) =>
    run(async () => {
      const api = await getApi();
      output(await api.orderDetail(orderId), getPretty());
    }),
  );

ordersCmd
  .command("cancel <orderId>")
  .description("Cancel an order")
  .action((orderId: string) =>
    run(async () => {
      const api = await getApi();
      output(await api.cancelOrder(orderId), getPretty());
    }),
  );

// ── receipts ──

const receiptsCmd = program
  .command("receipts")
  .description("List digital receipts, or download");

receiptsCmd
  .command("show", { isDefault: true })
  .description("List digital receipts")
  .action(() =>
    run(async () => {
      const api = await getApi();
      output(withTimestamp(await api.receipts()), getPretty());
    }),
  );

receiptsCmd
  .command("download <receiptId>")
  .description("Download receipt PDF")
  .option("--output <file>", "Output file path", "receipt.pdf")
  .action((receiptId: string, opts: { output: string }) =>
    run(async () => {
      const api = await getApi();
      output(
        { message: await api.receiptDownload(receiptId, opts.output) },
        getPretty(),
      );
    }),
  );

// ── suggestion ──

program
  .command("suggestion <num>")
  .description("Suggest N items to reach free pickup threshold")
  .action((num: string) =>
    run(async () => {
      const api = await getApi();
      output(await api.suggestion(parseInt(num, 10)), getPretty());
    }),
  );

program.parse();
