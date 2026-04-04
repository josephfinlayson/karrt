import axios, { type AxiosInstance, type AxiosResponse } from "axios";
import {
  readSessionState,
  writeSessionState,
} from "../storage/index.js";
import { cookiesToHeader, mergeSetCookies } from "../storage/cookies.js";

export type Headers = Record<string, string>;
export type QueryParams = Record<string, string | string[]>;

const API_BASE = "https://www.rewe.de/shop/api";

const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

function buildUrl(path: string, params?: QueryParams): string {
  const base = path.startsWith("http") ? path : `${API_BASE}${path}`;
  if (!params || Object.keys(params).length === 0) return base;
  const sp = new URLSearchParams();
  for (const [key, val] of Object.entries(params)) {
    if (Array.isArray(val)) {
      for (const v of val) sp.append(key, v);
    } else {
      sp.append(key, val);
    }
  }
  return `${base}?${sp.toString()}`;
}

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

/**
 * HTTP client for REWE API using axios.
 *
 * Reads cookies from session.json and injects them as Cookie header.
 * Updates stored cookies when Set-Cookie headers are received.
 */
export class ReweHttpClient {
  private ax: AxiosInstance;
  private cookies: StoredCookie[] = [];
  private loaded = false;

  constructor() {
    this.ax = axios.create({
      baseURL: API_BASE,
      timeout: 30000,
      headers: {
        "User-Agent": USER_AGENT,
        "Accept-Language": "de-DE,de;q=0.9,en-US;q=0.8,en;q=0.7",
      },
      // Don't follow redirects automatically — we need to handle cookies
      maxRedirects: 5,
      // Don't throw on non-2xx so we can handle errors ourselves
      validateStatus: () => true,
    });
  }

  /** Load cookies from disk on first use. */
  private async ensureCookies(): Promise<void> {
    if (this.loaded) return;
    const state = await readSessionState();
    if (state?.cookies) {
      this.cookies = state.cookies;
    }
    this.loaded = true;
  }

  /** Persist current cookies to disk. */
  async saveSession(): Promise<void> {
    await writeSessionState({ cookies: this.cookies, origins: [] });
  }

  /** Update cookies from Set-Cookie response headers. */
  private handleSetCookies(response: AxiosResponse): void {
    const setCookie = response.headers["set-cookie"];
    if (!setCookie) return;
    this.cookies = mergeSetCookies(this.cookies, setCookie);
  }

  private async request<T>(
    method: string,
    path: string,
    headers: Headers,
    params?: QueryParams,
    body?: unknown,
  ): Promise<T> {
    await this.ensureCookies();

    const url = buildUrl(path, params);
    const cookieHeader = cookiesToHeader(this.cookies, url);

    const reqHeaders: Record<string, string> = {
      ...headers,
      ...(cookieHeader ? { Cookie: cookieHeader } : {}),
    };

    if (body && !reqHeaders["Content-Type"] && !reqHeaders["content-type"]) {
      reqHeaders["Content-Type"] = "application/json";
    }

    const response = await this.ax.request({
      method,
      url,
      headers: reqHeaders,
      data: body,
    });

    this.handleSetCookies(response);

    const status = response.status;
    if (status >= 400) {
      const text =
        typeof response.data === "string"
          ? response.data.slice(0, 500)
          : JSON.stringify(response.data).slice(0, 500);
      if (status === 401 || status === 403) {
        throw new Error(
          `Auth error ${status} ${method} ${url}. Session may be expired — run \`rewe login\` or \`rewe import-cookies\`.`,
        );
      }
      throw new Error(`API error ${status} ${method} ${url}: ${text}`);
    }

    // Save cookies after successful requests
    await this.saveSession();

    return response.data as T;
  }

  async get<T>(
    path: string,
    headers: Headers = {},
    params?: QueryParams,
  ): Promise<T> {
    return this.request<T>("GET", path, headers, params);
  }

  async post<T>(
    path: string,
    headers: Headers = {},
    body?: unknown,
    params?: QueryParams,
  ): Promise<T> {
    return this.request<T>("POST", path, headers, params, body);
  }

  async patch<T>(
    path: string,
    headers: Headers = {},
    body?: unknown,
    params?: QueryParams,
  ): Promise<T> {
    return this.request<T>("PATCH", path, headers, params, body);
  }

  async delete<T>(
    path: string,
    headers: Headers = {},
    params?: QueryParams,
  ): Promise<T> {
    return this.request<T>("DELETE", path, headers, params);
  }

  async getBytes(
    path: string,
    headers: Headers = {},
    params?: QueryParams,
  ): Promise<Buffer> {
    await this.ensureCookies();
    const url = buildUrl(path, params);
    const cookieHeader = cookiesToHeader(this.cookies, url);

    const response = await this.ax.request({
      method: "GET",
      url,
      headers: { ...headers, ...(cookieHeader ? { Cookie: cookieHeader } : {}) },
      responseType: "arraybuffer",
    });

    this.handleSetCookies(response);

    if (response.status >= 400) {
      throw new Error(`API error ${response.status} GET ${url}`);
    }
    return Buffer.from(response.data);
  }

  /** No-op close for API compatibility. */
  async close(): Promise<void> {
    await this.saveSession();
  }
}
