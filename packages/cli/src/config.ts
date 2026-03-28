/**
 * Config file management — ~/.kill-switch/config.json
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync, chmodSync } from "fs";
import { join } from "path";
import { homedir } from "os";

export interface KillSwitchConfig {
  apiKey?: string;
  apiUrl?: string;
}

const CONFIG_DIR = join(homedir(), ".kill-switch");
const CONFIG_FILE = join(CONFIG_DIR, "config.json");
const DEFAULT_API_URL = "https://api.kill-switch.net";

export function loadConfig(): KillSwitchConfig {
  try {
    const raw = readFileSync(CONFIG_FILE, "utf-8");
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

export function saveConfig(config: KillSwitchConfig): void {
  if (!existsSync(CONFIG_DIR)) {
    mkdirSync(CONFIG_DIR, { recursive: true });
  }
  writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2) + "\n");
  chmodSync(CONFIG_FILE, 0o600); // owner read/write only
}

export function deleteConfig(): void {
  try {
    writeFileSync(CONFIG_FILE, "{}\n");
  } catch {
    // ignore
  }
}

/**
 * Resolve the API key from (in priority order):
 * 1. KILL_SWITCH_API_KEY env var
 * 2. --api-key flag (passed at call site)
 * 3. Config file
 */
export function resolveApiKey(flagKey?: string): string | undefined {
  return process.env.KILL_SWITCH_API_KEY || flagKey || loadConfig().apiKey;
}

/**
 * Resolve the API URL.
 */
export function resolveApiUrl(flagUrl?: string): string {
  return process.env.KILL_SWITCH_API_URL || flagUrl || loadConfig().apiUrl || DEFAULT_API_URL;
}

export { CONFIG_DIR, CONFIG_FILE, DEFAULT_API_URL };
