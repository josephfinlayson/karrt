// ── Shared primitives ──

export type CentPrice = number;
export type ListingId = string;
export type ProductId = string;
export type ItemId = string;
export type BasketId = string;
export type OrderId = string;
export type TimeslotId = string;
export type EbonId = string;
export type FavoriteListId = string;
export type CheckoutId = string;

// ── Product (www.rewe.de/shop/api format) ──

export interface ProductPricing {
  currentRetailPrice: CentPrice;
  currency: string;
  basePrice?: CentPrice;
  baseUnit?: Record<string, number>;
  grammage?: string;
}

export interface ProductListing {
  id: ListingId;
  version: number;
  pricing: ProductPricing;
  limitations?: { orderLimit?: number };
}

export interface ProductArticle {
  id: string;
  version: number;
  gtin: string;
  _embedded: {
    listing: ProductListing;
    store?: { id: string; version: number };
    merchant?: { id: string; name: string; type: string };
  };
}

export interface ProductAttributes {
  isOrganic?: boolean;
  isRegional?: boolean;
  isBio?: boolean;
  isVegan?: boolean;
  isVegetarian?: boolean;
}

export interface Product {
  id: ProductId;
  nan: string;
  version: number;
  productName: string;
  attributes: ProductAttributes;
  brand?: { name: string };
  media?: {
    images?: { _links: { self: { href: string } } }[];
  };
  _embedded: {
    articles: ProductArticle[];
    categories?: { id: string; primary: boolean }[];
    categoryPath?: string;
  };
  hasVariants: boolean;
  freeShipping: boolean;
  _links?: { detail?: { href: string } };
}

// Convenience accessors
export function getListingId(p: Product): ListingId {
  return p._embedded.articles[0]?._embedded.listing.id ?? "";
}

export function getPrice(p: Product): CentPrice {
  return p._embedded.articles[0]?._embedded.listing.pricing.currentRetailPrice ?? 0;
}

export function getGrammage(p: Product): string {
  return p._embedded.articles[0]?._embedded.listing.pricing.grammage ?? "";
}

export function getImageUrl(p: Product): string {
  return p.media?.images?.[0]?._links.self.href ?? "";
}

// ── Search ──

export type SearchAttribute = "organic" | "regional" | "vegan" | "vegetarian" | "discounted";

export interface SearchResponse {
  type: string;
  search: { term: string };
  pagination: { totalCount: number; page: number; objectsPerPage: number; pageCount: number };
  _embedded: { products: Product[] };
}

// ── Favorites ──

export interface FavoriteList {
  id: FavoriteListId;
  name: string;
  items: Product[];
}

export interface FavoriteLists {
  favorites: FavoriteList[];
}

// ── Basket ──

export interface Change {
  id: string;
  message: string;
}

export interface LineItem {
  quantity: number;
  price: CentPrice;
  totalPrice: CentPrice;
  grammage?: string;
  product: Product;
  changes?: Change[];
}

export interface BasketSummary {
  articleCount: number;
  articlePrice: CentPrice;
  totalPrice: CentPrice;
}

export interface Staggering {
  articlePriceThreshold: CentPrice;
  displayText: string;
}

export interface NextStaggering {
  remainingArticlePrice: CentPrice;
  articlePriceThreshold: CentPrice;
  displayText: string;
}

export interface Staggerings {
  reachedStaggering: Staggering;
  nextStaggering?: NextStaggering;
}

export interface TimeSlotInformation {
  startTime?: string;
  endTime?: string;
  timeSlotText: string;
}

export interface ServiceSelection {
  wwIdent: string;
  serviceType: string;
  zipCode: string;
}

export interface Basket {
  id: BasketId;
  version: number;
  serviceSelection: ServiceSelection;
  lineItems: LineItem[];
  summary: BasketSummary;
  staggerings: Staggerings;
  timeSlotInformation: TimeSlotInformation;
  changes?: Change[];
}

export interface BasketResponse {
  basket: Basket;
}

// ── Checkout ──

export interface CheckoutPayment {
  paymentMethod: string;
}

export interface CheckoutInfo {
  id: CheckoutId;
  basketId: BasketId;
  marketId: string;
  zipCode: string;
  serviceType: string;
  isFreeOrder: boolean;
  paymentType: string;
  timeslot?: Timeslot;
  payment?: CheckoutPayment;
}

export interface CheckoutBasketSummary {
  id: BasketId;
  version: number;
  summary: BasketSummary;
}

export interface CheckoutResponse {
  checkout: CheckoutInfo;
  basket: CheckoutBasketSummary;
}

export interface OrderResponse {
  order: { orderId: OrderId };
}

export interface OrderCancelResponse {
  orderCancel: string;
}

// ── Timeslots ──

export interface Timeslot {
  id: TimeslotId;
  startTime: string;
  endTime: string;
  serviceFee: CentPrice;
}

export interface TimeslotReservation {
  slotId: TimeslotId;
  expireTime: string;
  slotStartTime: string;
  slotEndTime: string;
  slotCutoffTime?: string;
  fee?: CentPrice | null;
  discountReason?: string | null;
  modifiedOrderId?: string | null;
}

// ── Orders ──

export interface OrderTimeSlot {
  firstSlotDate: string;
  lastSlotDate: string;
}

export interface SubOrder {
  isOpen: boolean;
  status: string;
  timeSlot: OrderTimeSlot;
  orderActions: string[];
}

export interface OrderHistoryEntry {
  orderId: OrderId;
  orderValue: CentPrice;
  orderDate: string;
  subOrders: SubOrder[];
}

export interface OrderDetailLineItem {
  lineItemType: string;
  totalPrice: CentPrice;
  productId?: ProductId;
  title?: string;
  quantity?: number;
  price?: CentPrice;
}

export interface OrderDetailSubOrder {
  timeSlot: OrderTimeSlot;
  status: string;
  lineItems: OrderDetailLineItem[];
}

export interface OrderDetail {
  orderId: OrderId;
  orderDate: string;
  orderValue: CentPrice;
  status: string;
  articlesPrice: CentPrice;
  subOrders: OrderDetailSubOrder[];
}

// ── Receipts ──

export interface EbonMarket {
  name: string;
  city: string;
  wwIdent: string;
  street: string;
  zipCode: string;
}

export interface EbonEntry {
  receiptId: EbonId;
  receiptTimestamp: string;
  receiptTotalPrice: CentPrice;
  market: EbonMarket;
  cancelled: boolean;
}

// ── Store search ──

export interface PickupMarket {
  wwIdent: string;
  displayName: string;
  city: string;
  zipCode: string;
  pickupType: string;
}

// ── Suggestion ──

export interface Suggestion {
  product: Product;
  freq: number;
}

export interface SuggestionResponse {
  suggestions: Suggestion[];
  remainingArticlePriceCents: CentPrice;
}
