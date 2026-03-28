/**
 * Output formatting — tables for humans, JSON for machines
 */

export interface Column {
  key: string;
  header: string;
  width?: number;
}

export function formatTable(rows: any[], columns: Column[]): void {
  if (rows.length === 0) {
    console.log("No results.");
    return;
  }

  // Calculate column widths
  const widths = columns.map((col) => {
    const headerLen = col.header.length;
    const maxData = rows.reduce((max, row) => {
      const val = String(row[col.key] ?? "");
      return Math.max(max, val.length);
    }, 0);
    return col.width || Math.min(Math.max(headerLen, maxData) + 2, 40);
  });

  // Header
  const headerLine = columns
    .map((col, i) => col.header.padEnd(widths[i]))
    .join("  ");
  console.log(headerLine);
  console.log(widths.map((w) => "-".repeat(w)).join("  "));

  // Rows
  for (const row of rows) {
    const line = columns
      .map((col, i) => String(row[col.key] ?? "").padEnd(widths[i]).slice(0, widths[i]))
      .join("  ");
    console.log(line);
  }
}

export function formatObject(obj: any, fields?: string[]): void {
  const keys = fields || Object.keys(obj);
  const maxKeyLen = keys.reduce((max, k) => Math.max(max, k.length), 0);
  for (const key of keys) {
    const val = obj[key];
    const display = typeof val === "object" ? JSON.stringify(val) : String(val ?? "");
    console.log(`${key.padEnd(maxKeyLen + 2)}${display}`);
  }
}

export function outputJson(data: any): void {
  console.log(JSON.stringify(data, null, 2));
}

export function outputError(message: string, json: boolean): void {
  if (json) {
    console.error(JSON.stringify({ error: message }));
  } else {
    console.error(`Error: ${message}`);
  }
}

/**
 * Wrap a command handler with JSON/error handling.
 */
export function withOutput(
  fn: (opts: any) => Promise<any>,
  opts: { json: boolean }
) {
  return fn(opts).catch((err: any) => {
    outputError(err.message || String(err), opts.json);
    process.exit(err.status === 401 || err.status === 403 ? 2 : 1);
  });
}
