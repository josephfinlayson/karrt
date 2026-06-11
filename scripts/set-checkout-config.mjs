#!/usr/bin/env node
import { mkdir, writeFile, chmod } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

const method = process.env.KARRT_PAYMENT_METHOD;
if (method !== "DIRECT_DEBIT" && method !== "INVOICE") {
  console.error(JSON.stringify({ error: "Set KARRT_PAYMENT_METHOD to DIRECT_DEBIT or INVOICE." }));
  process.exit(1);
}

const payment = { method };

function isValidIban(iban) {
  const clean = iban.replace(/\s+/g, "").toUpperCase();
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]+$/.test(clean)) return false;
  const expanded = (clean.slice(4) + clean.slice(0, 4)).replace(/[A-Z]/g, (char) => String(char.charCodeAt(0) - 55));
  let remainder = 0;
  for (const digit of expanded) remainder = (remainder * 10 + Number(digit)) % 97;
  return remainder === 1;
}

if (method === "DIRECT_DEBIT") {
  const accountOwner = process.env.KARRT_ACCOUNT_OWNER;
  const iban = process.env.KARRT_IBAN;
  const dateOfBirth = process.env.KARRT_DOB;
  if (!accountOwner || !iban || !dateOfBirth) {
    console.error(JSON.stringify({ error: "DIRECT_DEBIT requires KARRT_ACCOUNT_OWNER, KARRT_IBAN, and KARRT_DOB=YYYY-MM-DD." }));
    process.exit(1);
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateOfBirth)) {
    console.error(JSON.stringify({ error: "KARRT_DOB must use YYYY-MM-DD." }));
    process.exit(1);
  }
  if (!isValidIban(iban)) {
    console.error(JSON.stringify({ error: "KARRT_IBAN failed IBAN checksum validation." }));
    process.exit(1);
  }
  Object.assign(payment, { accountOwner, iban, dateOfBirth });
}

const dir = join(homedir(), ".config", "karrt");
const path = join(dir, "checkout.json");
await mkdir(dir, { recursive: true, mode: 0o700 });
await writeFile(path, JSON.stringify({ payment }, null, 2), { mode: 0o600 });
await chmod(path, 0o600);
console.log(JSON.stringify({ saved: true, path, method }));
