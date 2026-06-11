import type { ReweHttpClient, Headers } from "../http/client.js";
import { BrowserApiError, browserRequest } from "../http/browser.js";
import type { CurrentStore } from "../storage/index.js";
import { clearBasketId, readBasketId, writeBasketId } from "../storage/index.js";
import type {
  Product,
  Basket,
  LineItem,
  OrderHistoryEntry,
  OrderDetail,
  EbonEntry,
  Suggestion,
  SuggestionResponse,
  DeliveryMarket,
  ListingId,
  ProductId,
  ItemId,
  TimeslotId,
  OrderId,
  EbonId,
  FavoriteList,
  TimeslotReservation,
} from "../types/rewe.js";
import { getListingId } from "../types/rewe.js";
import { writeFile } from "node:fs/promises";

const SERVICE_TYPE = "DELIVERY";

// ── Search attributes ──

export type SearchAttribute =
  | "organic"
  | "regional"
  | "vegan"
  | "vegetarian"
  | "discounted";

export type SortOrder =
  | "RELEVANCE_DESC"
  | "PRICE_ASC"
  | "PRICE_DESC"
  | "NAME_ASC"
  | "NAME_DESC";

export interface SearchOptions {
  page?: number;
  perPage?: number;
  sort?: SortOrder;
  attributes?: SearchAttribute[];
  categorySlug?: string;
}

export interface CheckoutStatus {
  ready: boolean;
  basketId?: string;
  serviceSelection?: unknown;
  summary?: unknown;
  lineItems: Array<{
    title?: string;
    quantity?: number;
    totalPrice?: number;
    listingId?: string;
  }>;
  violations: unknown[];
  minimumOrderReached: boolean;
  selectedTimeslot?: unknown;
  availableTimeslots: number;
  firstAvailableTimeslot?: unknown;
  nextActions: string[];
}

// ── Headers ──

function storeHeaders(store: CurrentStore): Headers {
  return {
    "rd-market-id": store.wwIdent,
    "rd-customer-zip": store.zipCode,
    "rd-postcode": store.zipCode,
    "rd-service-types": SERVICE_TYPE,
  };
}

const BASKET_HEADERS: Headers = {
  "x-application-id": "rewe-basket",
  "x-origin": "AddToBasketV2",
  "cache-control": "no-cache",
  "pragma": "no-cache",
  "Content-Type": "application/json",
  "Accept": "application/vnd.com.rewe.digital.basket-v2+json",
};

const BASKET_OVERVIEW_HEADERS: Headers = {
  ...BASKET_HEADERS,
  "x-origin": "BASKET_OVERVIEW",
};

const PRODUCT_ACCEPT: Headers = {
  Accept: "application/vnd.rewe.productlist+json",
};

// ── API class ──

export class ReweApi {
  constructor(
    private client: ReweHttpClient,
    private store: CurrentStore,
  ) {}

  private get headers(): Headers {
    return storeHeaders(this.store);
  }

  // ── Search ──

  async search(
    query: string,
    opts: SearchOptions = {},
  ): Promise<Product[]> {
    const params: Record<string, string | string[]> = {
      search: query,
      serviceTypes: SERVICE_TYPE,
      objectsPerPage: String(opts.perPage ?? 40),
      page: String(opts.page ?? 1),
      debug: "false",
      autocorrect: "true",
    };
    if (opts.sort) {
      params.sorting = opts.sort;
    }
    if (opts.categorySlug) {
      params.categorySlug = opts.categorySlug;
    }
    if (opts.attributes && opts.attributes.length > 0) {
      params.attribute = opts.attributes;
    }

    const res = await this.client.get<Record<string, unknown>>(
      "/products",
      PRODUCT_ACCEPT,
      params,
    );
    return extractProducts(res);
  }

  // ── Favorites ──

  async favorites(query?: string): Promise<Product[]> {
    const res = await this.client.get<Record<string, unknown>>(
      "/favorites",
      this.headers,
    );
    const items = extractFavoriteItems(res);
    if (!query) return items;
    const q = query.toLowerCase();
    return items.filter((p) => p.productName.toLowerCase().includes(q));
  }

  private async defaultFavoriteListId(): Promise<string> {
    const res = await this.client.get<Record<string, unknown>>(
      "/favorites",
      this.headers,
    );
    const data = res as Record<string, unknown>;
    const favLists = (data.favoriteLists as Record<string, unknown>)
      ?.favorites as FavoriteList[] | undefined;
    if (!favLists || favLists.length === 0)
      throw new Error("No favorite list found");
    return favLists[0].id;
  }

  async favoritesAdd(
    listingId: ListingId,
    productId: ProductId,
  ): Promise<Product> {
    const listId = await this.defaultFavoriteListId();
    const res = await this.client.post<Record<string, unknown>>(
      `/favorites/${listId}/lineitems`,
      this.headers,
      { listingId, quantity: null, productId },
    );
    const list = (res as Record<string, unknown>)
      .addLineItemToFavoriteList as FavoriteList | undefined;
    const product = list?.items.find((p) => p.id === productId);
    if (!product) throw new Error("Item was not added to favourites");
    return product;
  }

  async favoritesDelete(itemId: ItemId): Promise<void> {
    const listId = await this.defaultFavoriteListId();
    await this.client.delete(
      `/favorites/${listId}/lineitems/${itemId}`,
      this.headers,
    );
  }

  // ── Basket ──

  /** Get current basket. Requires a stored basket ID (set after first add). */
  async basket(): Promise<unknown> {
    const basketId = await readBasketId();
    if (!basketId) {
      return { message: "No basket yet. Add an item first with `karrt basket add`." };
    }
    const basket = await this.basketById(basketId);
    if (typeof basket.id === "string") {
      await writeBasketId(basket.id);
    }
    return basket;
  }

  private async basketById(basketId: string): Promise<Record<string, unknown>> {
    try {
      return await browserRequest<Record<string, unknown>>(
        "GET",
        `/baskets/${basketId}`,
        BASKET_HEADERS,
      );
    } catch (err) {
      if (err instanceof BrowserApiError && err.status === 404) {
        await clearBasketId();
        return {
          message: "Saved basket expired. Add an item to create a fresh delivery basket.",
          staleBasketId: basketId,
        };
      }
      throw err;
    }
  }

  async basketAdd(
    listingId: ListingId,
    qty: number = 1,
    context: string = "product-list-category",
  ): Promise<unknown> {
    const basket = await browserRequest<Record<string, unknown>>(
      "POST",
      `/baskets/listings/${listingId}`,
      BASKET_HEADERS,
      { quantity: qty, includeTimeslot: false, context },
    );
    if (typeof basket.id === "string") {
      await writeBasketId(basket.id);
    }
    return basket;
  }

  async basketUpdate(
    listingId: ListingId,
    qty: number,
  ): Promise<unknown> {
    const basket = await browserRequest<Record<string, unknown>>(
      "POST",
      `/baskets/listings/${listingId}`,
      BASKET_OVERVIEW_HEADERS,
      { quantity: qty, includeTimeslot: true, context: "OVERVIEW" },
    );
    if (typeof basket.id === "string") {
      await writeBasketId(basket.id);
    }
    return basket;
  }

  async basketRemove(
    basketId: string,
    listingId: ListingId,
  ): Promise<void> {
    await browserRequest(
      "DELETE",
      `/baskets/${basketId}/listings/${listingId}`,
      BASKET_OVERVIEW_HEADERS,
      undefined,
      { includeTimeslot: "true" },
    );
  }

  async basketClear(): Promise<void> {
    const basketId = await readBasketId();
    if (!basketId) return;
    const b = await this.basketById(basketId);
    if (typeof b.staleBasketId === "string") return;
    const lineItems = (b.lineItems ?? []) as Array<{ product: { listing: { listingId: string } } }>;
    for (const item of lineItems) {
      await this.basketRemove(basketId, item.product.listing.listingId);
    }
  }

  async basketBulkAdd(
    items: { listingId: string; qty?: number }[],
  ): Promise<{ added: string[]; errors: string[] }> {
    const added: string[] = [];
    const errors: string[] = [];
    for (const item of items) {
      try {
        await this.basketAdd(item.listingId, item.qty ?? 1);
        added.push(item.listingId);
      } catch (err) {
        errors.push(
          `${item.listingId}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
    return { added, errors };
  }

  // ── Timeslots ──

  async timeslots(): Promise<unknown> {
    const { readUserId } = await import("../storage/index.js");
    const userId = await readUserId();
    const headers = userId
      ? { ...this.headers, "auth-info-user-id": userId }
      : this.headers;
    const res = await this.client.get<unknown>(
      "/timeslots/delivery/overview",
      headers,
    );
    return res;
  }

  async timeslotReserve(slotId: TimeslotId): Promise<TimeslotReservation> {
    const res = await this.client.post<TimeslotReservation>(
      "/timeslot-reservations",
      { ...this.headers, "Content-Type": "application/json" },
      {
        slotId,
        customerId: "", // Will be populated from session
        wwIdent: this.store.wwIdent,
        zipCode: this.store.zipCode,
        serviceType: SERVICE_TYPE,
      },
    );
    return res;
  }

  // ── Checkout ──

  async checkoutStatus(): Promise<CheckoutStatus> {
    const basket = await this.basket() as Record<string, unknown>;
    if (typeof basket.staleBasketId === "string" || !basket.id) {
      return {
        ready: false,
        lineItems: [],
        violations: [],
        minimumOrderReached: false,
        availableTimeslots: 0,
        nextActions: [
          "Add an item to create a fresh authenticated delivery basket.",
        ],
      };
    }

    const lineItems = ((basket.lineItems ?? []) as Array<Record<string, unknown>>)
      .map((item) => {
        const product = item.product as Record<string, unknown> | undefined;
        const listing = product?.listing as Record<string, unknown> | undefined;
        return {
          title: product?.title as string | undefined,
          quantity: item.quantity as number | undefined,
          totalPrice: item.totalPrice as number | undefined,
          listingId: listing?.listingId as string | undefined,
        };
      });
    const violations = (basket.violations ?? []) as unknown[];
    const minimumOrderReached = !violations.some((violation) => {
      const v = violation as Record<string, unknown>;
      return typeof v.id === "string" && v.id.includes("minimum.delivery");
    });
    const timeslots = await this.timeslots() as unknown[];
    const selectedTimeslot = Array.isArray(timeslots)
      ? timeslots.find((slot) => (slot as Record<string, unknown>).selected === true)
      : undefined;

    const nextActions: string[] = [];
    if (lineItems.length === 0) {
      nextActions.push("Add delivery items to the basket.");
    }
    if (!minimumOrderReached) {
      nextActions.push("Add more items to reach the REWE delivery minimum.");
    }
    if (minimumOrderReached && Array.isArray(timeslots) && timeslots.length > 0 && !selectedTimeslot) {
      nextActions.push("Choose a delivery slot, then reserve it with `karrt timeslot-reserve <slotId>`.");
    }
    if (selectedTimeslot) {
      nextActions.push("Review the basket and payment state on rewe.de before placing the order.");
    }

    return {
      ready: lineItems.length > 0 && minimumOrderReached && Boolean(selectedTimeslot),
      basketId: basket.id as string,
      serviceSelection: basket.serviceSelection,
      summary: basket.summary,
      lineItems,
      violations,
      minimumOrderReached,
      selectedTimeslot,
      availableTimeslots: Array.isArray(timeslots) ? timeslots.length : 0,
      firstAvailableTimeslot: Array.isArray(timeslots) ? timeslots[0] : undefined,
      nextActions,
    };
  }

  // ── Orders ──

  async orders(): Promise<unknown> {
    return this.client.get<unknown>("/orders", this.headers);
  }

  async orderDetail(orderId: OrderId): Promise<OrderDetail> {
    const res = await this.client.get<Record<string, unknown>>(
      `/orders/${orderId}`,
      this.headers,
    );
    return (res.orderDetails ?? res) as OrderDetail;
  }

  async cancelOrder(orderId: OrderId): Promise<unknown> {
    return this.client.delete(`/orders/${orderId}`, this.headers);
  }

  // ── Receipts ──

  async receipts(): Promise<unknown> {
    return this.client.get<unknown>("/receipts", this.headers);
  }

  async receiptDownload(receiptId: EbonId, outputPath: string): Promise<string> {
    const pdfBytes = await this.client.getBytes(
      `/receipts/${receiptId}/pdf`,
      this.headers,
    );
    await writeFile(outputPath, pdfBytes);
    return `Stored receipt to: ${outputPath}`;
  }

  // ── Suggestions ──

  async suggestion(numSuggestions: number): Promise<SuggestionResponse> {
    // Get recently ordered products
    const ordersRes = await this.orders() as Record<string, unknown>;
    const orderEntries = (ordersRes.orders ?? []) as OrderHistoryEntry[];

    const orderedProductIds: ProductId[] = [];
    for (const entry of orderEntries.slice(0, 10)) {
      try {
        const detail = await this.orderDetail(entry.orderId);
        for (const sub of detail.subOrders) {
          for (const li of sub.lineItems) {
            if (li.productId) orderedProductIds.push(li.productId);
          }
        }
      } catch {
        // Skip orders that can't be fetched
      }
    }

    const currentBasket = (await this.basket()) as Record<string, unknown>;
    const lineItems = (currentBasket.lineItems ?? []) as Array<{ product: { productId?: string; id?: string } }>;
    const basketProductIds = new Set(
      lineItems.map((li) => li.product.productId ?? li.product.id ?? ""),
    );

    const freqMap = new Map<ProductId, number>();
    for (const pid of orderedProductIds) {
      freqMap.set(pid, (freqMap.get(pid) || 0) + 1);
    }

    // Find products that were ordered before but aren't in basket
    // For now, return frequency data — full product details would need search
    const suggestions: Suggestion[] = Array.from(freqMap.entries())
      .filter(([pid]) => !basketProductIds.has(pid))
      .sort((a, b) => b[1] - a[1])
      .slice(0, numSuggestions)
      .map(([productId, freq]) => ({
        product: { productId, title: productId } as unknown as Product,
        freq,
      }));

    const staggerings = currentBasket.staggerings as Record<string, unknown> | undefined;
    const nextStaggering = staggerings?.nextStaggering as Record<string, unknown> | undefined;
    const remainingArticlePriceCents =
      (nextStaggering?.remainingArticlePrice as number) ?? 0;

    return { suggestions, remainingArticlePriceCents };
  }
}

// ── Response extractors ──

function extractProducts(res: Record<string, unknown>): Product[] {
  // www.rewe.de format: { _embedded: { products: [...] } }
  const embedded = res._embedded as Record<string, unknown> | undefined;
  if (embedded && Array.isArray(embedded.products)) {
    return embedded.products as Product[];
  }
  // Fallback: direct products array
  if (Array.isArray(res.products)) return res.products as Product[];
  return [];
}

function extractFavoriteItems(res: Record<string, unknown>): Product[] {
  const data = (res.data ?? res) as Record<string, unknown>;
  const favLists = (data.favoriteLists as Record<string, unknown>)
    ?.favorites as FavoriteList[] | undefined;
  return favLists?.flatMap((f) => f.items) ?? [];
}

function extractBasket(res: Record<string, unknown>): Basket {
  return (res.basket ?? res) as Basket;
}

// ── Public helpers (no auth needed) ──

export async function searchProducts(
  client: ReweHttpClient,
  store: CurrentStore,
  query: string,
  opts: SearchOptions = {},
): Promise<Product[]> {
  const api = new ReweApi(client, store);
  return api.search(query, opts);
}

export async function searchStores(
  client: ReweHttpClient,
  zipCode: string,
): Promise<DeliveryMarket[]> {
  const res = await client.get<Record<string, unknown>>(
    "/products",
    PRODUCT_ACCEPT,
    {
      search: "wasser",
      serviceTypes: SERVICE_TYPE,
      market: zipCode,
      objectsPerPage: "5",
    },
  );
  const products = extractProducts(res);

  const markets = new Set<string>();
  for (const p of products) {
    const lid = getListingId(p);
    if (lid) {
      const match = lid.match(/-(\d{6})$/);
      if (match) markets.add(match[1]);
    }
  }

  if (markets.size === 0) {
    return [
      {
        wwIdent: zipCode,
        displayName: `REWE area ${zipCode} — use ZIP as market ID or find your market on rewe.de/marktsuche`,
        city: "",
        zipCode,
        serviceType: SERVICE_TYPE,
      },
    ];
  }

  return Array.from(markets).map((wwIdent) => ({
    wwIdent,
    displayName: `REWE Market ${wwIdent}`,
    city: "",
    zipCode,
    serviceType: SERVICE_TYPE,
  }));
}

export async function storeExists(
  _client: ReweHttpClient,
  _wwIdent: string,
  _zipCode: string,
): Promise<boolean> {
  return true;
}
