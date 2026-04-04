/**
 * Cookie utilities: Netscape parsing, header formatting, Set-Cookie merging.
 */

export interface StoredCookie {
  name: string;
  value: string;
  domain: string;
  path: string;
  expires: number;
  httpOnly: boolean;
  secure: boolean;
  sameSite: "Strict" | "Lax" | "None";
}

// ── Netscape cookie file parsing ──

export function parseNetscapeCookies(text: string): StoredCookie[] {
  const cookies: StoredCookie[] = [];

  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const parts = trimmed.split("\t");
    if (parts.length < 7) continue;

    const [domain, , path, secure, expires, name, ...valueParts] = parts;
    const value = valueParts.join("\t");

    let expiresNum = parseFloat(expires);
    if (expiresNum === 0) expiresNum = -1;

    cookies.push({
      name,
      value,
      domain,
      path,
      expires: expiresNum,
      httpOnly: false,
      secure: secure.toUpperCase() === "TRUE",
      sameSite: "Lax",
    });
  }

  return cookies;
}

export function cookiesToStorageState(cookies: StoredCookie[]): object {
  return { cookies, origins: [] };
}

// ── Cookie header formatting ──

/** Check if a cookie's domain matches a URL. */
function domainMatches(cookieDomain: string, urlHost: string): boolean {
  const d = cookieDomain.startsWith(".") ? cookieDomain.slice(1) : cookieDomain;
  return urlHost === d || urlHost.endsWith("." + d);
}

/** Format matching cookies as a Cookie header value for a given URL. */
export function cookiesToHeader(cookies: StoredCookie[], url: string): string {
  let host: string;
  try {
    host = new URL(url).hostname;
  } catch {
    return "";
  }

  const now = Date.now() / 1000;
  const matching = cookies.filter((c) => {
    if (!domainMatches(c.domain, host)) return false;
    // Skip expired cookies (but keep session cookies with expires=-1 or 0)
    if (c.expires > 0 && c.expires < now) return false;
    return true;
  });

  if (matching.length === 0) return "";
  return matching.map((c) => `${c.name}=${c.value}`).join("; ");
}

// ── Set-Cookie response header parsing ──

/** Parse a single Set-Cookie header string into a StoredCookie. */
function parseOneCookie(setCookie: string): StoredCookie | null {
  const parts = setCookie.split(";").map((p) => p.trim());
  if (parts.length === 0) return null;

  const [first, ...attrs] = parts;
  const eqIdx = first.indexOf("=");
  if (eqIdx === -1) return null;

  const name = first.slice(0, eqIdx).trim();
  const value = first.slice(eqIdx + 1).trim();

  const cookie: StoredCookie = {
    name,
    value,
    domain: "",
    path: "/",
    expires: -1,
    httpOnly: false,
    secure: false,
    sameSite: "Lax",
  };

  for (const attr of attrs) {
    const [key, ...valParts] = attr.split("=");
    const k = key.trim().toLowerCase();
    const v = valParts.join("=").trim();

    switch (k) {
      case "domain":
        cookie.domain = v;
        break;
      case "path":
        cookie.path = v;
        break;
      case "expires": {
        const d = Date.parse(v);
        if (!isNaN(d)) cookie.expires = d / 1000;
        break;
      }
      case "max-age": {
        const ma = parseInt(v, 10);
        if (!isNaN(ma)) cookie.expires = Date.now() / 1000 + ma;
        break;
      }
      case "secure":
        cookie.secure = true;
        break;
      case "httponly":
        cookie.httpOnly = true;
        break;
      case "samesite":
        if (v.toLowerCase() === "strict") cookie.sameSite = "Strict";
        else if (v.toLowerCase() === "none") cookie.sameSite = "None";
        else cookie.sameSite = "Lax";
        break;
    }
  }

  return cookie;
}

/** Merge new Set-Cookie headers into existing cookie list. */
export function mergeSetCookies(
  existing: StoredCookie[],
  setCookieHeaders: string[],
): StoredCookie[] {
  const result = [...existing];

  for (const header of setCookieHeaders) {
    const newCookie = parseOneCookie(header);
    if (!newCookie) continue;

    // Replace existing cookie with same name+domain, or add new
    const idx = result.findIndex(
      (c) => c.name === newCookie.name && c.domain === newCookie.domain,
    );
    if (idx >= 0) {
      result[idx] = newCookie;
    } else {
      result.push(newCookie);
    }
  }

  return result;
}
