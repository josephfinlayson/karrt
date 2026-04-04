import { readFile, writeFile, mkdir, unlink, stat } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";

export interface CurrentStore {
  wwIdent: string;
  zipCode: string;
}

function configDir(): string {
  return join(
    process.env.XDG_CONFIG_HOME || join(homedir(), ".config"),
    "rewe-cli",
  );
}

async function ensureDir(dir: string): Promise<void> {
  await mkdir(dir, { recursive: true, mode: 0o700 });
}

// ── Store settings ──

export async function readSettings(): Promise<CurrentStore> {
  const dir = configDir();
  const [wwIdent, zipCode] = await Promise.all([
    readFile(join(dir, "selected_store"), "utf-8"),
    readFile(join(dir, "selected_zip"), "utf-8"),
  ]);
  return { wwIdent: wwIdent.trim(), zipCode: zipCode.trim() };
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

/** Save session state (cookies) to disk. */
export async function writeSessionState(state: object): Promise<void> {
  const dir = configDir();
  await ensureDir(dir);
  await writeFile(sessionPath(), JSON.stringify(state), { mode: 0o600 });
}

/** Read session state from disk. */
export async function readSessionState(): Promise<{ cookies: import("./cookies.js").StoredCookie[] } | null> {
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

/** Check if a session file exists with non-expired cookies. */
export async function hasValidSession(): Promise<boolean> {
  const p = await readSessionPath();
  if (!p) return false;
  try {
    const data = JSON.parse(await readFile(p, "utf-8"));
    const cookies = data.cookies as { expires?: number }[] | undefined;
    if (!cookies || cookies.length === 0) return false;
    // Check if any auth-related cookies have expired
    const now = Date.now() / 1000;
    const hasValid = cookies.some(
      (c) => !c.expires || c.expires === -1 || c.expires > now,
    );
    return hasValid;
  } catch {
    return false;
  }
}
