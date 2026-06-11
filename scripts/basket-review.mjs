#!/usr/bin/env node
import { ReweHttpClient } from "../dist/http/client.js";
import { readSettings } from "../dist/storage/index.js";
import { ReweApi } from "../dist/api/index.js";

const api = new ReweApi(new ReweHttpClient(), await readSettings());
const basket = await api.basket();

const lineItems = (basket.lineItems ?? []).map((item) => ({
  title: item.product?.title,
  qty: item.quantity,
  unitCents: item.price,
  totalCents: item.totalPrice,
  grammage: item.grammage,
  fullCategory: item.product?.fullCategory,
  listingId: item.product?.listing?.listingId,
}));

console.log(JSON.stringify({
  basketId: basket.id,
  version: basket.version,
  serviceSelection: basket.serviceSelection,
  summary: basket.summary,
  violations: basket.violations ?? [],
  timeSlotInformation: basket.timeSlotInformation,
  lineItems,
}, null, 2));
