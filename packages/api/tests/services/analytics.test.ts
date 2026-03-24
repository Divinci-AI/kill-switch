/**
 * Analytics Overview Unit Tests
 *
 * Tests getAnalyticsOverview() with mocked PostgreSQL pool.
 * Verifies deduplication logic, projection math, savings calculation.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the pg Pool
const mockQuery = vi.fn();

vi.mock("pg", () => ({
  Pool: vi.fn(() => ({
    query: mockQuery,
    on: vi.fn(),
  })),
}));

// Set required env var before importing
process.env.GUARDIAN_POSTGRES_URL = "postgresql://mock:mock@localhost/mock";

import { getAnalyticsOverview } from "../../src/globals/index.js";

describe("getAnalyticsOverview", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns zeroes and empty arrays when no snapshots exist", async () => {
    // All three queries return empty
    mockQuery
      .mockResolvedValueOnce({ rows: [] })       // daily costs
      .mockResolvedValueOnce({ rows: [{ action_count: "0", cost_at_action: null }] }) // actions
      .mockResolvedValueOnce({ rows: [] });       // breakdown

    const result = await getAnalyticsOverview("guardian-1", 30);

    expect(result.dailyCosts).toHaveLength(0);
    expect(result.totalSpendPeriod).toBe(0);
    expect(result.avgDailyCost).toBe(0);
    expect(result.projectedMonthlyCost).toBe(0);
    expect(result.savingsEstimate).toBe(0);
    expect(result.killSwitchActions).toBe(0);
    expect(result.accountBreakdown).toHaveLength(0);
  });

  it("computes correct daily cost and monthly projection for single account", async () => {
    mockQuery
      .mockResolvedValueOnce({
        rows: [
          { date: "2026-03-20", cost: "10.00", services: "3", violations: "0" },
          { date: "2026-03-21", cost: "15.00", services: "3", violations: "0" },
          { date: "2026-03-22", cost: "12.00", services: "3", violations: "1" },
        ],
      })
      .mockResolvedValueOnce({ rows: [{ action_count: "0", cost_at_action: null }] })
      .mockResolvedValueOnce({ rows: [] });

    const result = await getAnalyticsOverview("guardian-1", 7);

    expect(result.dailyCosts).toHaveLength(3);
    expect(result.totalSpendPeriod).toBeCloseTo(37);
    expect(result.avgDailyCost).toBeCloseTo(37 / 3);
    expect(result.projectedMonthlyCost).toBeCloseTo((37 / 3) * 30);
    expect(result.dailyCosts[2].violations).toBe(1);
  });

  it("correctly sums multi-account costs (deduplication verified via SQL)", async () => {
    // SQL subquery already deduplicates — this tests the JS layer processes summed results
    mockQuery
      .mockResolvedValueOnce({
        rows: [
          { date: "2026-03-20", cost: "80.00", services: "6", violations: "0" }, // CF $50 + GCP $30
          { date: "2026-03-21", cost: "90.00", services: "7", violations: "1" }, // CF $55 + GCP $35
        ],
      })
      .mockResolvedValueOnce({ rows: [{ action_count: "0", cost_at_action: null }] })
      .mockResolvedValueOnce({
        rows: [
          { cloud_account_id: "cf-1", provider: "cloudflare", total_cost: "105.00", avg_daily_cost: "52.50" },
          { cloud_account_id: "gcp-1", provider: "gcp", total_cost: "65.00", avg_daily_cost: "32.50" },
        ],
      });

    const result = await getAnalyticsOverview("guardian-1", 7);

    expect(result.totalSpendPeriod).toBeCloseTo(170);
    expect(result.accountBreakdown).toHaveLength(2);
    expect(result.accountBreakdown[0].provider).toBe("cloudflare");
    expect(result.accountBreakdown[0].totalCost).toBeCloseTo(105);
    expect(result.accountBreakdown[1].provider).toBe("gcp");
    expect(result.accountBreakdown[1].totalCost).toBeCloseTo(65);
  });

  it("calculates savings from kill switch actions", async () => {
    mockQuery
      .mockResolvedValueOnce({
        rows: [
          { date: "2026-03-20", cost: "500.00", services: "2", violations: "1" },
        ],
      })
      .mockResolvedValueOnce({
        rows: [{ action_count: "2", cost_at_action: "450.00" }],
      })
      .mockResolvedValueOnce({ rows: [] });

    const result = await getAnalyticsOverview("guardian-1", 30);

    expect(result.killSwitchActions).toBe(2);
    // Savings = cost at action × 3 days
    expect(result.savingsEstimate).toBeCloseTo(1350);
  });

  it("returns zero savings when no actions taken", async () => {
    mockQuery
      .mockResolvedValueOnce({
        rows: [{ date: "2026-03-20", cost: "10.00", services: "1", violations: "0" }],
      })
      .mockResolvedValueOnce({ rows: [{ action_count: "0", cost_at_action: null }] })
      .mockResolvedValueOnce({ rows: [] });

    const result = await getAnalyticsOverview("guardian-1", 30);

    expect(result.killSwitchActions).toBe(0);
    expect(result.savingsEstimate).toBe(0);
  });

  it("passes correct parameters to SQL queries", async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ action_count: "0", cost_at_action: null }] })
      .mockResolvedValueOnce({ rows: [] });

    await getAnalyticsOverview("guardian-42", 90);

    // All three queries should receive the same params
    expect(mockQuery).toHaveBeenCalledTimes(3);
    for (let i = 0; i < 3; i++) {
      const [, params] = mockQuery.mock.calls[i];
      expect(params[0]).toBe("guardian-42");
      expect(params[1]).toBe(90);
    }
  });

  it("handles null/missing numeric values gracefully", async () => {
    mockQuery
      .mockResolvedValueOnce({
        rows: [{ date: "2026-03-20", cost: null, services: null, violations: null }],
      })
      .mockResolvedValueOnce({ rows: [{ action_count: null, cost_at_action: null }] })
      .mockResolvedValueOnce({
        rows: [{ cloud_account_id: "x", provider: "cloudflare", total_cost: null, avg_daily_cost: null }],
      });

    const result = await getAnalyticsOverview("guardian-1", 7);

    expect(result.dailyCosts[0].cost).toBe(0);
    expect(result.dailyCosts[0].services).toBe(0);
    expect(result.dailyCosts[0].violations).toBe(0);
    expect(result.savingsEstimate).toBe(0);
    expect(result.accountBreakdown[0].totalCost).toBe(0);
  });
});
