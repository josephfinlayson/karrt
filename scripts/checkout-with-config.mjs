#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { placeOrder, reachCheckoutConfirmation } from "../dist/checkout/browser.js";

function findXvfbRun() {
  const candidates = [
    process.env.XVFB_RUN_PATH,
    "/run/current-system/sw/bin/xvfb-run",
    "/usr/bin/xvfb-run",
  ];
  for (const path of candidates) {
    if (typeof path === "string" && existsSync(path)) return path;
  }
  try {
    for (const entry of readdirSync("/nix/store").sort()) {
      const path = `/nix/store/${entry}/bin/xvfb-run`;
      if (entry.includes("xvfb-run") && existsSync(path)) return path;
    }
  } catch {}
  return "xvfb-run";
}

if (!process.env.DISPLAY && !process.env.KARRT_XVFB) {
  const result = spawnSync(findXvfbRun(), ["-a", process.execPath, ...process.argv.slice(1)], {
    stdio: "inherit",
    env: { ...process.env, KARRT_XVFB: "1" },
  });
  if (result.error) throw result.error;
  process.exit(result.status ?? 1);
}

const confirm = process.argv.includes("--confirm");
const result = confirm
  ? await placeOrder("PLACE REWE ORDER")
  : await reachCheckoutConfirmation();

console.log(JSON.stringify(result, null, 2));
