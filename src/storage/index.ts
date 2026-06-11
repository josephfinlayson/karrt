import { readFile, writeFile, mkdir, unlink, stat } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";

export interface CurrentStore {
  wwIdent: string;
  zipCode: string;
}

export interface CheckoutConfig {
  payment?: {
    method?: "DIRECT_DEBIT" | "INVOICE";
    accountOwner?: string;
    iban?: string;
    dateOfBirth?: string;
  };
}

const AUTH_COOKIE_NAMES = new Set(["KEYCLOAK_IDENTITY", "KEYCLOAK_SESSION"]);

function configDir(): string {
  return join(
    process.env.XDG_CONFIG_HOME || join(homedir(), ".config"),
    "karrt",
  );
}

async function ensureDir(dir: string): Promise<void> {
  await mkdir(dir, { recursive: true, mode: 0o700 });
}

// ── Store settings ──

export async function readSettings(): Promise<CurrentStore> {
  const dir = configDir();
  try {
    const [wwIdent, zipCode] = await Promise.all([
      readFile(join(dir, "selected_store"), "utf-8"),
      readFile(join(dir, "selected_zip"), "utf-8"),
    ]);
    return { wwIdent: wwIdent.trim(), zipCode: zipCode.trim() };
  } catch {
    throw new Error(
      "No store configured. Run: rewe store search <zip> then rewe store set <wwIdent> <zip>",
    );
  }
}

export async function writeSettings(
  wwIdent: string,
  zipCode: string,
): Promise<CurrentStore> {
  const dir = configDir();
  await ensureDir(dir);
  await Promise.all([
    writeFile(join(dir, "selected_store"), wwIdent, { mode: 0o600 }),
    writeFile(join(dir, "selected_zip"), zipCode, { mode: 0o600 }),
  ]);
  return { wwIdent, zipCode };
}

// ── Browser session persistence ──

function sessionPath(): string {
  return join(configDir(), "session.json");
}

/** Returns the session file path if it exists, null otherwise. */
export async function readSessionPath(): Promise<string | null> {
  const p = sessionPath();
  try {
    const s = await stat(p);
    if (s.size > 0) return p;
  } catch {}
  return null;
}

/** Save session state (cookies + optional userId) to disk. */
export async function writeSessionState(state: object): Promise<void> {
  const dir = configDir();
  await ensureDir(dir);
  await writeFile(sessionPath(), JSON.stringify(state), { mode: 0o600 });
}

/** Read user ID saved from login JWT. */
export async function readUserId(): Promise<string | null> {
  try {
    const data = JSON.parse(await readFile(sessionPath(), "utf-8"));
    return (data as Record<string, unknown>).userId as string ?? null;
  } catch {
    return null;
  }
}

/** Read session state from disk. */
export async function readSessionState(): Promise<{ userId?: string; cookies: import("./cookies.js").StoredCookie[] } | null> {
  const p = await readSessionPath();
  if (!p) return null;
  try {
    return JSON.parse(await readFile(p, "utf-8"));
  } catch {
    return null;
  }
}

/** Delete stored session. */
export async function clearSession(): Promise<void> {
  await unlink(sessionPath()).catch(() => {});
}

// ── Basket ID persistence ──

function basketIdPath(): string {
  return join(configDir(), "basket-id");
}

export async function readBasketId(): Promise<string | null> {
  try {
    const id = await readFile(basketIdPath(), "utf-8");
    return id.trim() || null;
  } catch {
    return null;
  }
}

export async function writeBasketId(id: string): Promise<void> {
  const dir = configDir();
  await ensureDir(dir);
  await writeFile(basketIdPath(), id, { mode: 0o600 });
}

export async function clearBasketId(): Promise<void> {
  await unlink(basketIdPath()).catch(() => {});
}

export async function readCheckoutConfig(): Promise<CheckoutConfig | null> {
  try {
    return JSON.parse(await readFile(join(configDir(), "checkout.json"), "utf-8")) as CheckoutConfig;
  } catch {
    return null;
  }
}

/** Check if a session file exists with non-expired cookies. */
export async function hasValidSession(): Promise<boolean> {
  const p = await readSessionPath();
  if (!p) return false;
  try {
    const data = JSON.parse(await readFile(p, "utf-8"));
    if (typeof data.userId !== "string" || data.userId.length === 0) return false;
    const cookies = data.cookies as { name?: string; expires?: number }[] | undefined;
    if (!cookies || cookies.length === 0) return false;
    const now = Date.now() / 1000;
    const hasValidAuthCookie = cookies.some(
      (c) => typeof c.name === "string"
        && AUTH_COOKIE_NAMES.has(c.name)
        && (!c.expires || c.expires === -1 || c.expires > now),
    );
    return hasValidAuthCookie;
  } catch {
    return false;
  }
}
