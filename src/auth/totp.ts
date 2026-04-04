import { createHmac } from "node:crypto";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";

function configDir(): string {
  return join(
    process.env.XDG_CONFIG_HOME || join(homedir(), ".config"),
    "rewe-cli",
  );
}

function totpPath(): string {
  return join(configDir(), "totp-secret");
}

/** Store TOTP secret to disk. */
export async function saveTotpSecret(secret: string): Promise<void> {
  const dir = configDir();
  await mkdir(dir, { recursive: true, mode: 0o700 });
  await writeFile(totpPath(), secret.trim(), { mode: 0o600 });
}

/** Read stored TOTP secret, or null if not configured. */
export async function readTotpSecret(): Promise<string | null> {
  try {
    const s = await readFile(totpPath(), "utf-8");
    return s.trim() || null;
  } catch {
    return null;
  }
}

/** Base32 decode (RFC 4648). */
function base32Decode(input: string): Buffer {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const cleaned = input.replace(/[=\s]/g, "").toUpperCase();
  let bits = "";
  for (const ch of cleaned) {
    const val = alphabet.indexOf(ch);
    if (val === -1) throw new Error(`Invalid base32 character: ${ch}`);
    bits += val.toString(2).padStart(5, "0");
  }
  const bytes: number[] = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) {
    bytes.push(parseInt(bits.slice(i, i + 8), 2));
  }
  return Buffer.from(bytes);
}

/**
 * Generate a TOTP code (RFC 6238).
 * Default: SHA1, 6 digits, 30-second period.
 */
export function generateTOTP(
  secret: string,
  time: number = Date.now(),
): string {
  const period = 30;
  const digits = 6;

  const key = base32Decode(secret);
  const counter = Math.floor(time / 1000 / period);

  // Counter as 8-byte big-endian buffer
  const counterBuf = Buffer.alloc(8);
  counterBuf.writeUInt32BE(Math.floor(counter / 0x100000000), 0);
  counterBuf.writeUInt32BE(counter >>> 0, 4);

  const hmac = createHmac("sha1", key).update(counterBuf).digest();

  // Dynamic truncation
  const offset = hmac[hmac.length - 1] & 0x0f;
  const code =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);

  return (code % 10 ** digits).toString().padStart(digits, "0");
}
