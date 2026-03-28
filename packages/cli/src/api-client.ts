/**
 * API Client — fetch wrapper with auth and error handling
 */

import { resolveApiKey, resolveApiUrl } from "./config.js";

export class ApiError extends Error {
  constructor(
    public status: number,
    public body: any,
    message: string
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export async function apiRequest<T = any>(
  path: string,
  opts: {
    method?: string;
    body?: any;
    apiKey?: string;
    apiUrl?: string;
    public?: boolean;
  } = {}
): Promise<T> {
  const apiKey = resolveApiKey(opts.apiKey);
  const apiUrl = resolveApiUrl(opts.apiUrl);

  if (!apiKey && !opts.public) {
    throw new ApiError(0, null, "Not authenticated. Run: kill-switch auth login --api-key YOUR_KEY");
  }

  const url = `${apiUrl}${path}`;
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (apiKey) headers["Authorization"] = `Bearer ${apiKey}`;

  const res = await fetch(url, {
    method: opts.method || "GET",
    headers,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });

  const text = await res.text();
  let data: any;
  try {
    data = JSON.parse(text);
  } catch {
    if (!res.ok) throw new ApiError(res.status, null, `API error ${res.status}: ${text.slice(0, 200)}`);
    return text as any;
  }

  if (!res.ok) {
    throw new ApiError(res.status, data, data.error || `API error: ${res.status}`);
  }

  return data as T;
}
