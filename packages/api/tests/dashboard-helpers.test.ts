/**
 * Dashboard Helper Function Tests
 *
 * Tests the pure logic functions used in the FinOps dashboard.
 * These are duplicated from DashboardPage.tsx since the web package
 * has no test infrastructure. They have no React dependencies.
 */

import { describe, it, expect } from "vitest";

// ─── Functions under test (copied from DashboardPage.tsx) ───────────────────

interface DailyCost {
  date: string;
  cost: number;
  services: number;
  violations: number;
}

const fmt = (n: number) =>
  n >= 1000 ? `$${(n / 1000).toFixed(1)}k` : `$${n.toFixed(2)}`;

const fmtFull = (n: number) =>
  `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const shortDate = (d: string) => {
  const dt = new Date(d);
  return `${dt.getMonth() + 1}/${dt.getDate()}`;
};

function detectAnomalies(dailyCosts: DailyCost[]): Set<string> {
  const anomalies = new Set<string>();
  for (let i = 5; i < dailyCosts.length; i++) {
    const window = dailyCosts.slice(i - 5, i);
    const avg = window.reduce((s, d) => s + d.cost, 0) / window.length;
    if (avg > 0 && dailyCosts[i].cost > avg * 2) {
      anomalies.add(dailyCosts[i].date);
    }
  }
  return anomalies;
}

function buildForecastData(dailyCosts: DailyCost[]) {
  const chartData: any[] = dailyCosts.map(d => ({
    ...d,
    dateLabel: shortDate(d.date),
  }));

  if (dailyCosts.length >= 3) {
    const recent = dailyCosts.slice(-7);
    const avgRecent = recent.reduce((s, d) => s + d.cost, 0) / recent.length;

    if (chartData.length > 0) {
      chartData[chartData.length - 1].forecast = chartData[chartData.length - 1].cost;
    }

    const lastDate = new Date(dailyCosts[dailyCosts.length - 1].date);
    for (let i = 1; i <= 7; i++) {
      const d = new Date(lastDate);
      d.setDate(d.getDate() + i);
      chartData.push({
        date: d.toISOString().split("T")[0],
        services: 0,
        violations: 0,
        dateLabel: shortDate(d.toISOString()),
        isForecast: true,
        forecast: avgRecent,
      });
    }
  }

  return chartData;
}

// ─── Helper to generate daily cost entries ──────────────────────────────────

function makeDays(costs: number[], startDate = "2026-03-01"): DailyCost[] {
  return costs.map((cost, i) => {
    const d = new Date(startDate);
    d.setDate(d.getDate() + i);
    return {
      date: d.toISOString().split("T")[0],
      cost,
      services: 2,
      violations: 0,
    };
  });
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("fmt", () => {
  it("formats small amounts with dollar sign and 2 decimals", () => {
    expect(fmt(0)).toBe("$0.00");
    expect(fmt(5.5)).toBe("$5.50");
    expect(fmt(999.99)).toBe("$999.99");
  });

  it("formats thousands with k suffix", () => {
    expect(fmt(1000)).toBe("$1.0k");
    expect(fmt(1500)).toBe("$1.5k");
    expect(fmt(25000)).toBe("$25.0k");
  });
});

describe("fmtFull", () => {
  it("formats with full precision and commas", () => {
    expect(fmtFull(0)).toBe("$0.00");
    expect(fmtFull(1234.56)).toMatch(/1.*234\.56/); // locale-dependent comma
    expect(fmtFull(91316)).toMatch(/91.*316\.00/);
  });
});

describe("shortDate", () => {
  it("converts ISO date to M/D format", () => {
    // Note: new Date("YYYY-MM-DD") parses as UTC midnight,
    // so in UTC+ timezones the day is correct, in UTC- it may be off by 1.
    // We test the function's behavior, not timezone correctness.
    const result = shortDate("2026-06-15");
    // Should contain month 6 and day 15 (or 14 in US timezones)
    expect(result).toMatch(/^6\/1[45]$/);
  });

  it("handles single-digit months and days", () => {
    const result = shortDate("2026-01-05");
    expect(result).toMatch(/^1\/[45]$/);
  });
});

describe("detectAnomalies", () => {
  it("returns empty set for flat data", () => {
    const data = makeDays([10, 10, 10, 10, 10, 10, 10, 10]);
    const anomalies = detectAnomalies(data);
    expect(anomalies.size).toBe(0);
  });

  it("ignores first 5 days (needs window for comparison)", () => {
    // Even a spike on day 3 shouldn't be detected — not enough history
    const data = makeDays([1, 1, 100, 1, 1, 1, 1]);
    const anomalies = detectAnomalies(data);
    // Day index 2 (100) is before index 5, so not checked
    expect(anomalies.size).toBe(0);
  });

  it("detects a cost spike > 2x rolling average", () => {
    // 5 days at $10, then a spike to $25 (> $10 * 2)
    const data = makeDays([10, 10, 10, 10, 10, 25]);
    const anomalies = detectAnomalies(data);
    expect(anomalies.size).toBe(1);
    expect(anomalies.has(data[5].date)).toBe(true);
  });

  it("does not flag a cost that is exactly 2x (must exceed)", () => {
    const data = makeDays([10, 10, 10, 10, 10, 20]);
    const anomalies = detectAnomalies(data);
    expect(anomalies.size).toBe(0);
  });

  it("does not flag when previous average is zero", () => {
    const data = makeDays([0, 0, 0, 0, 0, 100]);
    const anomalies = detectAnomalies(data);
    // avg is 0, and the guard `avg > 0` prevents division issues
    expect(anomalies.size).toBe(0);
  });

  it("detects multiple anomalies", () => {
    const data = makeDays([10, 10, 10, 10, 10, 50, 10, 10, 10, 10, 10, 60]);
    const anomalies = detectAnomalies(data);
    expect(anomalies.size).toBe(2);
  });

  it("returns empty set for empty input", () => {
    expect(detectAnomalies([]).size).toBe(0);
  });

  it("returns empty set for fewer than 6 data points", () => {
    const data = makeDays([10, 10, 10, 10, 10]);
    expect(detectAnomalies(data).size).toBe(0);
  });
});

describe("buildForecastData", () => {
  it("does not add forecast for fewer than 3 data points", () => {
    const data = makeDays([10, 20]);
    const result = buildForecastData(data);
    expect(result).toHaveLength(2);
    expect(result.every((d: any) => !d.isForecast)).toBe(true);
  });

  it("adds 7 forecast days when sufficient data exists", () => {
    const data = makeDays([10, 20, 30, 40, 50]);
    const result = buildForecastData(data);
    // 5 actual + 7 forecast = 12
    expect(result).toHaveLength(12);
    const forecastPoints = result.filter((d: any) => d.isForecast);
    expect(forecastPoints).toHaveLength(7);
  });

  it("bridges forecast to last actual point", () => {
    const data = makeDays([10, 20, 30]);
    const result = buildForecastData(data);
    // Last actual point should have forecast equal to its cost
    const lastActual = result[2];
    expect(lastActual.forecast).toBe(30); // cost of last actual day
    expect(lastActual.isForecast).toBeUndefined(); // not a forecast point
  });

  it("forecast points have no cost field (avoids chart cliff)", () => {
    const data = makeDays([10, 20, 30]);
    const result = buildForecastData(data);
    const forecastPoints = result.filter((d: any) => d.isForecast);
    for (const fp of forecastPoints) {
      expect(fp.cost).toBeUndefined();
    }
  });

  it("forecast value equals average of last 7 days (or fewer)", () => {
    const data = makeDays([10, 20, 30, 40, 50]);
    const result = buildForecastData(data);
    const avg = (10 + 20 + 30 + 40 + 50) / 5; // only 5 days, all used
    const forecastPoints = result.filter((d: any) => d.isForecast);
    for (const fp of forecastPoints) {
      expect(fp.forecast).toBeCloseTo(avg);
    }
  });

  it("forecast dates are sequential after last actual date", () => {
    const data = makeDays([10, 20, 30], "2026-03-20");
    const result = buildForecastData(data);
    const forecastPoints = result.filter((d: any) => d.isForecast);
    expect(forecastPoints[0].date).toBe("2026-03-23");
    expect(forecastPoints[6].date).toBe("2026-03-29");
  });
});
