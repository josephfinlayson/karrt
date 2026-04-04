/**
 * CAPTCHA solving abstraction — supports 2Captcha and CapSolver.
 *
 * Env vars:
 *   CAPTCHA_PROVIDER=2captcha|capsolver  (default: 2captcha)
 *   CAPTCHA_API_KEY=<your key>
 *   CAPTCHA_PROXY=http://user:pass@host:port  (optional, for IP-bound Turnstile)
 */

interface SolveResult {
  token: string;
  provider: string;
}

async function jsonPost(url: string, body: unknown): Promise<unknown> {
  const resp = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return resp.json();
}

function parseProxy(proxyUrl: string): {
  type: string;
  address: string;
  port: number;
  login?: string;
  password?: string;
} {
  const u = new URL(proxyUrl);
  return {
    type: u.protocol.replace(":", "").toUpperCase(), // HTTP, HTTPS, SOCKS5
    address: u.hostname,
    port: parseInt(u.port, 10),
    login: u.username || undefined,
    password: u.password || undefined,
  };
}

// ── 2Captcha ──

async function solve2Captcha(
  apiKey: string,
  sitekey: string,
  pageurl: string,
  proxy?: string,
): Promise<string> {
  const task: Record<string, unknown> = {
    type: proxy ? "TurnstileTask" : "TurnstileTaskProxyless",
    websiteURL: pageurl,
    websiteKey: sitekey,
  };
  if (proxy) {
    const p = parseProxy(proxy);
    task.proxyType = p.type.toLowerCase();
    task.proxyAddress = p.address;
    task.proxyPort = p.port;
    if (p.login) task.proxyLogin = p.login;
    if (p.password) task.proxyPassword = p.password;
  }

  const submitResp = (await jsonPost("https://api.2captcha.com/createTask", {
    clientKey: apiKey,
    task,
  })) as { errorId: number; taskId?: number; errorCode?: string };

  if (submitResp.errorId !== 0) {
    throw new Error(`2Captcha submit: ${submitResp.errorCode}`);
  }

  const taskId = submitResp.taskId!;
  for (let i = 0; i < 60; i++) {
    await new Promise((r) => setTimeout(r, 5000));
    const result = (await jsonPost("https://api.2captcha.com/getTaskResult", {
      clientKey: apiKey,
      taskId,
    })) as {
      errorId: number;
      status: string;
      solution?: { token: string };
      errorCode?: string;
    };
    if (result.errorId !== 0) throw new Error(`2Captcha: ${result.errorCode}`);
    if (result.status === "ready" && result.solution?.token) {
      return result.solution.token;
    }
  }
  throw new Error("2Captcha: timeout");
}

// ── CapSolver ──

async function solveCapSolver(
  apiKey: string,
  sitekey: string,
  pageurl: string,
  proxy?: string,
): Promise<string> {
  const task: Record<string, unknown> = {
    type: proxy ? "AntiTurnstileTask" : "AntiTurnstileTaskProxyLess",
    websiteURL: pageurl,
    websiteKey: sitekey,
  };
  if (proxy) {
    // CapSolver wants proxy as a single string: "scheme://user:pass@host:port"
    task.proxy = proxy;
  }

  const submitResp = (await jsonPost("https://api.capsolver.com/createTask", {
    clientKey: apiKey,
    task,
  })) as {
    errorId: number;
    taskId?: string;
    errorCode?: string;
    errorDescription?: string;
  };

  if (submitResp.errorId !== 0) {
    throw new Error(
      `CapSolver: ${submitResp.errorCode} - ${submitResp.errorDescription}`,
    );
  }

  const taskId = submitResp.taskId!;
  for (let i = 0; i < 60; i++) {
    await new Promise((r) => setTimeout(r, 3000));
    const result = (await jsonPost("https://api.capsolver.com/getTaskResult", {
      clientKey: apiKey,
      taskId,
    })) as {
      errorId: number;
      status: string;
      solution?: { token: string };
      errorCode?: string;
    };
    if (result.errorId !== 0) throw new Error(`CapSolver: ${result.errorCode}`);
    if (result.status === "ready" && result.solution?.token) {
      return result.solution.token;
    }
  }
  throw new Error("CapSolver: timeout");
}

// ── Public API ──

export async function solveTurnstile(
  sitekey: string,
  pageurl: string,
): Promise<SolveResult> {
  const provider = process.env.CAPTCHA_PROVIDER || "2captcha";
  const apiKey =
    process.env.CAPTCHA_API_KEY || process.env.TWOCAPTCHA_API_KEY || "";
  const proxy = process.env.CAPTCHA_PROXY || undefined;

  if (!apiKey) {
    throw new Error(
      "Set CAPTCHA_API_KEY env var. " +
        "Set CAPTCHA_PROVIDER=capsolver for CapSolver (recommended). " +
        "Set CAPTCHA_PROXY=http://user:pass@host:port to route solver through your IP.",
    );
  }

  const solverFn =
    provider === "capsolver" ? solveCapSolver : solve2Captcha;

  const maxAttempts = 3;
  for (let attempt = 1; ; attempt++) {
    try {
      console.log(
        `Solving Turnstile via ${provider}${proxy ? " (with proxy)" : ""} ` +
          `(attempt ${attempt}/${maxAttempts})...`,
      );
      const token = await solverFn(apiKey, sitekey, pageurl, proxy);
      return { token, provider };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.log(`Attempt ${attempt} failed: ${msg}`);
      if (attempt >= maxAttempts) throw err;
      if (
        msg.includes("NO_SLOT") ||
        msg.includes("Queue exceeded") ||
        msg.includes("capacity") ||
        msg.includes("UNSOLVABLE") ||
        msg.includes("unsolvable") ||
        msg.includes("unable to be solved")
      ) {
        const wait = attempt * 5;
        console.log(`Retrying in ${wait}s...`);
        await new Promise((r) => setTimeout(r, wait * 1000));
      } else {
        throw err;
      }
    }
  }
}
