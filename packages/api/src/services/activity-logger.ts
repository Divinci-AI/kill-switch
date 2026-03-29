/**
 * Activity Logger
 *
 * Tracks security-relevant and mutation operations for audit trail.
 * Writes to the activity_log PostgreSQL table.
 * All calls are fire-and-forget to avoid blocking API responses.
 *
 * When PostgreSQL is unavailable, entries are buffered in memory
 * (up to a cap) and flushed on the next successful write.
 */

import { getPostgresPool } from "../globals/index.js";

export interface ActivityLogEntry {
  orgId: string;
  actorUserId: string;
  actorEmail?: string;
  action: string;
  resourceType: string;
  resourceId?: string;
  details?: Record<string, unknown>;
  ipAddress?: string;
}

const BUFFER_CAP = 500;
const buffer: ActivityLogEntry[] = [];
let consecutiveFailures = 0;

/**
 * Log an activity entry. Fire-and-forget — errors are logged but don't
 * propagate to the caller. Failed writes are buffered in memory and
 * retried on the next successful write.
 */
export function logActivity(entry: ActivityLogEntry): void {
  let pool;
  try {
    pool = getPostgresPool();
  } catch {
    // PostgreSQL not configured — buffer the entry
    bufferEntry(entry);
    return;
  }

  insertEntry(pool, entry).then(() => {
    consecutiveFailures = 0;
    // Flush buffered entries on success
    flushBuffer(pool);
  }).catch((err) => {
    consecutiveFailures++;
    bufferEntry(entry);
    if (consecutiveFailures <= 3 || consecutiveFailures % 100 === 0) {
      console.error(`[guardian] Failed to log activity (${consecutiveFailures} consecutive failures):`, err.message);
    }
  });
}

function bufferEntry(entry: ActivityLogEntry): void {
  if (buffer.length >= BUFFER_CAP) {
    // Drop oldest entry to make room
    buffer.shift();
  }
  buffer.push(entry);
}

function flushBuffer(pool: any): void {
  if (buffer.length === 0) return;

  // Drain the buffer into a local copy
  const toFlush = buffer.splice(0, buffer.length);

  // Insert buffered entries one at a time (best-effort)
  for (const entry of toFlush) {
    insertEntry(pool, entry).catch((err) => {
      // If still failing, re-buffer it (if there's room)
      if (buffer.length < BUFFER_CAP) {
        buffer.push(entry);
      }
      console.error("[guardian] Failed to flush buffered activity entry:", err.message);
    });
  }
}

function insertEntry(pool: any, entry: ActivityLogEntry): Promise<any> {
  return pool.query(
    `INSERT INTO activity_log (org_id, actor_user_id, actor_email, action, resource_type, resource_id, details, ip_address)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      entry.orgId,
      entry.actorUserId,
      entry.actorEmail || null,
      entry.action,
      entry.resourceType,
      entry.resourceId || null,
      JSON.stringify(entry.details || {}),
      entry.ipAddress || null,
    ]
  );
}

/** Returns the current buffer size (for monitoring/tests) */
export function getBufferSize(): number {
  return buffer.length;
}

/** Returns consecutive failure count (for monitoring/tests) */
export function getConsecutiveFailures(): number {
  return consecutiveFailures;
}

/**
 * Query activity log entries with pagination and filtering.
 */
export async function queryActivityLog(
  orgId: string,
  options: {
    page?: number;
    limit?: number;
    action?: string;
    resourceType?: string;
    resourceId?: string;
    actorUserId?: string;
    from?: string;
    to?: string;
  } = {}
): Promise<{ entries: any[]; total: number; page: number; limit: number }> {
  const pool = getPostgresPool();
  const page = Math.max(1, options.page || 1);
  const limit = Math.min(100, Math.max(1, options.limit || 50));
  const offset = (page - 1) * limit;

  const conditions: string[] = ["org_id = $1"];
  const params: any[] = [orgId];
  let paramIdx = 2;

  if (options.action) {
    conditions.push(`action LIKE $${paramIdx}`);
    params.push(`${options.action}%`);
    paramIdx++;
  }
  if (options.resourceType) {
    conditions.push(`resource_type = $${paramIdx}`);
    params.push(options.resourceType);
    paramIdx++;
  }
  if (options.resourceId) {
    conditions.push(`resource_id = $${paramIdx}`);
    params.push(options.resourceId);
    paramIdx++;
  }
  if (options.actorUserId) {
    conditions.push(`actor_user_id = $${paramIdx}`);
    params.push(options.actorUserId);
    paramIdx++;
  }
  if (options.from) {
    conditions.push(`created_at >= $${paramIdx}`);
    params.push(options.from);
    paramIdx++;
  }
  if (options.to) {
    conditions.push(`created_at <= $${paramIdx}`);
    params.push(options.to);
    paramIdx++;
  }

  const where = conditions.join(" AND ");

  const [countResult, dataResult] = await Promise.all([
    pool.query(`SELECT COUNT(*) FROM activity_log WHERE ${where}`, params),
    pool.query(
      `SELECT * FROM activity_log WHERE ${where} ORDER BY created_at DESC LIMIT $${paramIdx} OFFSET $${paramIdx + 1}`,
      [...params, limit, offset]
    ),
  ]);

  return {
    entries: dataResult.rows,
    total: parseInt(countResult.rows[0].count),
    page,
    limit,
  };
}
