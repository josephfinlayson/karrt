#!/usr/bin/env node
import { ReweHttpClient } from "../dist/http/client.js";
import { readSettings } from "../dist/storage/index.js";
import { ReweApi } from "../dist/api/index.js";

const [date, time] = process.argv.slice(2);
if (!date || !time) {
  console.error(JSON.stringify({ error: "Usage: node scripts/reserve-slot.mjs YYYY-MM-DD HH:MM" }));
  process.exit(1);
}

const api = new ReweApi(new ReweHttpClient(), await readSettings());
const slots = await api.timeslots();
if (!Array.isArray(slots)) {
  console.error(JSON.stringify({ error: "Timeslots response was not an array." }));
  process.exit(1);
}

const dayFmt = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Europe/Berlin",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});
const timeFmt = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/Berlin",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

const exact = slots.find((slot) => (
  dayFmt.format(new Date(slot.startTime)) === date
  && timeFmt.format(new Date(slot.startTime)) === time
));

if (!exact) {
  const sameDay = slots
    .filter((slot) => dayFmt.format(new Date(slot.startTime)) === date)
    .map((slot) => ({
      id: slot.id,
      startLocal: timeFmt.format(new Date(slot.startTime)),
      startTime: slot.startTime,
      endTime: slot.endTime,
      serviceFee: slot.serviceFee,
      labels: slot.labels ?? [],
    }));
  console.error(JSON.stringify({ error: "Requested slot unavailable.", requested: { date, time }, sameDay }, null, 2));
  process.exit(1);
}

const reservation = await api.timeslotReserve(exact.id);
const status = await api.checkoutStatus();
console.log(JSON.stringify({ reservation, ready: status.ready, selectedTimeslot: status.selectedTimeslot, summary: status.summary, violations: status.violations }, null, 2));
