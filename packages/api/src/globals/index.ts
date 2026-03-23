/**
 * Database Connections
 *
 * Sets up MongoDB and PostgreSQL connections for the Guardian API.
 * Follows the same patterns as the main Divinci server-globals.
 */

import mongoose from "mongoose";

let mongoConnected = false;

export async function connectMongoDB(): Promise<void> {
  if (mongoConnected) return;

  const uri = process.env.GUARDIAN_MONGODB_URI || process.env.MONGO_CONNECTION_URL;
  if (!uri) {
    console.warn("[guardian] No MongoDB URI configured — using in-memory models only");
    return;
  }

  try {
    await mongoose.connect(uri, {
      maxPoolSize: 10,
      serverSelectionTimeoutMS: 5000,
      socketTimeoutMS: 45000,
    });
    mongoConnected = true;
    console.error("[guardian] Connected to MongoDB");
  } catch (error: any) {
    console.error("[guardian] MongoDB connection failed:", error.message);
    throw error;
  }
}

// PostgreSQL connection for time-series data
// Uses the pg library directly (same as NanoUSDWallet pattern)

import { Pool, type PoolClient } from "pg";

let pgPool: Pool | null = null;

export function getPostgresPool(): Pool {
  if (!pgPool) {
    const connectionString = process.env.GUARDIAN_POSTGRES_URL || process.env.POSTGRES_URL;
    if (!connectionString) {
      throw new Error("No PostgreSQL connection URL configured (GUARDIAN_POSTGRES_URL)");
    }

    pgPool = new Pool({
      connectionString,
      max: 10,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000,
    });

    pgPool.on("error", (err) => {
      console.error("[guardian] PostgreSQL pool error:", err.message);
    });
  }
  return pgPool;
}

/**
 * Initialize PostgreSQL tables for usage tracking
 */
export async function initPostgresTables(): Promise<void> {
  const pool = getPostgresPool();

  await pool.query(`
    CREATE TABLE IF NOT EXISTS guardian_usage_snapshots (
      id BIGSERIAL PRIMARY KEY,
      cloud_account_id TEXT NOT NULL,
      guardian_account_id TEXT NOT NULL,
      provider TEXT NOT NULL,
      checked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      metrics JSONB NOT NULL,
      violations TEXT[],
      actions_taken TEXT[],
      estimated_daily_cost_usd NUMERIC(10,2),
      total_services INTEGER
    );
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_usage_cloud_account
    ON guardian_usage_snapshots(cloud_account_id, checked_at DESC);
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_usage_guardian_account
    ON guardian_usage_snapshots(guardian_account_id, checked_at DESC);
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS guardian_alerts (
      id BIGSERIAL PRIMARY KEY,
      cloud_account_id TEXT NOT NULL,
      guardian_account_id TEXT NOT NULL,
      severity TEXT NOT NULL,
      summary TEXT NOT NULL,
      details JSONB,
      channels_sent TEXT[],
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_alerts_guardian_account
    ON guardian_alerts(guardian_account_id, created_at DESC);
  `);

  console.error("[guardian] PostgreSQL tables initialized");
}

/**
 * Record a usage snapshot after a monitoring check
 */
export async function recordUsageSnapshot(
  cloudAccountId: string,
  guardianAccountId: string,
  provider: string,
  metrics: Record<string, unknown>,
  violations: string[],
  actionsTaken: string[],
  estimatedDailyCostUSD: number,
  totalServices: number
): Promise<void> {
  const pool = getPostgresPool();
  await pool.query(
    `INSERT INTO guardian_usage_snapshots
     (cloud_account_id, guardian_account_id, provider, metrics, violations, actions_taken, estimated_daily_cost_usd, total_services)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [cloudAccountId, guardianAccountId, provider, JSON.stringify(metrics), violations, actionsTaken, estimatedDailyCostUSD, totalServices]
  );
}

/**
 * Record an alert for audit trail
 */
export async function recordAlert(
  cloudAccountId: string,
  guardianAccountId: string,
  severity: string,
  summary: string,
  details: Record<string, unknown>,
  channelsSent: string[]
): Promise<void> {
  const pool = getPostgresPool();
  await pool.query(
    `INSERT INTO guardian_alerts
     (cloud_account_id, guardian_account_id, severity, summary, details, channels_sent)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [cloudAccountId, guardianAccountId, severity, summary, JSON.stringify(details), channelsSent]
  );
}

/**
 * Get usage history for a cloud account (for dashboard charts)
 */
export async function getUsageHistory(
  cloudAccountId: string,
  days: number = 7
): Promise<any[]> {
  const pool = getPostgresPool();
  const result = await pool.query(
    `SELECT * FROM guardian_usage_snapshots
     WHERE cloud_account_id = $1
     AND checked_at >= NOW() - INTERVAL '1 day' * $2
     ORDER BY checked_at DESC
     LIMIT 500`,
    [cloudAccountId, days]
  );
  return result.rows;
}

/**
 * Get alert history for a guardian account
 */
export async function getAlertHistory(
  guardianAccountId: string,
  limit: number = 50
): Promise<any[]> {
  const pool = getPostgresPool();
  const result = await pool.query(
    `SELECT * FROM guardian_alerts
     WHERE guardian_account_id = $1
     ORDER BY created_at DESC
     LIMIT $2`,
    [guardianAccountId, limit]
  );
  return result.rows;
}
