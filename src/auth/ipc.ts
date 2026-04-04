/**
 * File-based IPC for login flow.
 *
 * The login process writes status updates to a JSON file.
 * The verify command writes the 2FA code to the same directory.
 * The login process polls for the code file.
 *
 * Files:
 *   ~/.config/rewe-cli/login-state.json  — status: idle | awaiting_2fa | success | error
 *   ~/.config/rewe-cli/2fa-code          — plain text code written by `rewe verify`
 */

import { readFile, writeFile, mkdir, unlink } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";

function ipcDir(): string {
  return join(
    process.env.XDG_CONFIG_HOME || join(homedir(), ".config"),
    "rewe-cli",
  );
}

function statePath(): string {
  return join(ipcDir(), "login-state.json");
}

function codePath(): string {
  return join(ipcDir(), "2fa-code");
}

export interface LoginState {
  status: "idle" | "awaiting_2fa" | "success" | "error";
  email?: string;
  message?: string;
  timestamp?: number;
}

export async function writeLoginState(state: LoginState): Promise<void> {
  const dir = ipcDir();
  await mkdir(dir, { recursive: true });
  await writeFile(statePath(), JSON.stringify({ ...state, timestamp: Date.now() }));
}

export async function readLoginState(): Promise<LoginState> {
  try {
    const data = await readFile(statePath(), "utf-8");
    return JSON.parse(data) as LoginState;
  } catch {
    return { status: "idle" };
  }
}

export async function write2FACode(code: string): Promise<void> {
  const dir = ipcDir();
  await mkdir(dir, { recursive: true });
  await writeFile(codePath(), code.trim());
}

export async function poll2FACode(timeoutMs: number = 600_000): Promise<string> {
  // Clear any stale code file first
  await unlink(codePath()).catch(() => {});

  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const code = (await readFile(codePath(), "utf-8")).trim();
      if (code.length > 0) {
        await unlink(codePath()).catch(() => {});
        return code;
      }
    } catch {
      // File doesn't exist yet — keep polling
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error("Timed out waiting for 2FA code (10 min).");
}

export async function cleanup(): Promise<void> {
  await unlink(statePath()).catch(() => {});
  await unlink(codePath()).catch(() => {});
}
