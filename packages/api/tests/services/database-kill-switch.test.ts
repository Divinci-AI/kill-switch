import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  initiateKillSequence,
  advanceKillSequence,
  abortKillSequence,
  getKillSequence,
  listActiveSequences,
  type DatabaseCredential,
} from "../../src/services/database-kill-switch.js";

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

const mongoCredential: DatabaseCredential = {
  provider: "mongodb-atlas",
  atlasPublicKey: "test-public",
  atlasPrivateKey: "test-private",
  atlasProjectId: "project-123",
  clusterName: "production-cluster",
};

const cloudSqlCredential: DatabaseCredential = {
  provider: "cloud-sql-postgres",
  gcpAccessToken: "fake-token",
  gcpProjectId: "my-project",
  instanceName: "prod-postgres",
};

describe("Database Kill Switch", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("Kill Sequence Lifecycle", () => {
    it("creates a kill sequence with default steps", () => {
      const seq = initiateKillSequence(mongoCredential, "database-compromise");

      expect(seq.id).toMatch(/^dbkill-/);
      expect(seq.status).toBe("running");
      expect(seq.provider).toBe("mongodb-atlas");
      expect(seq.target).toBe("production-cluster");
      expect(seq.trigger).toBe("database-compromise");
      expect(seq.steps).toHaveLength(4);
      expect(seq.steps.map(s => s.action)).toEqual(["snapshot", "verify-snapshot", "isolate", "nuke"]);
      expect(seq.snapshotVerified).toBe(false);
    });

    it("creates a sequence with custom steps", () => {
      const seq = initiateKillSequence(mongoCredential, "test", ["snapshot", "isolate"]);
      expect(seq.steps).toHaveLength(2);
      expect(seq.steps.map(s => s.action)).toEqual(["snapshot", "isolate"]);
    });

    it("can retrieve a sequence by ID", () => {
      const seq = initiateKillSequence(mongoCredential, "test");
      const found = getKillSequence(seq.id);
      expect(found).toBeTruthy();
      expect(found!.id).toBe(seq.id);
    });

    it("lists active sequences", () => {
      const seq1 = initiateKillSequence(mongoCredential, "test1");
      const seq2 = initiateKillSequence(cloudSqlCredential, "test2");
      const active = listActiveSequences();
      expect(active.length).toBeGreaterThanOrEqual(2);
    });

    it("can abort a sequence", () => {
      const seq = initiateKillSequence(mongoCredential, "test");
      const aborted = abortKillSequence(seq.id);
      expect(aborted!.status).toBe("aborted");
    });
  });

  describe("SAFETY: Nuke requires verified snapshot", () => {
    it("BLOCKS nuke when snapshot is not verified", async () => {
      // Skip directly to nuke without snapshot
      const seq = initiateKillSequence(mongoCredential, "compromise", ["nuke"]);

      const result = await advanceKillSequence(seq.id, mongoCredential, true);

      expect(result.status).toBe("failed");
      expect(result.steps[0].status).toBe("failed");
      expect(result.steps[0].result).toContain("SAFETY BLOCK");
      expect(result.steps[0].result).toContain("Cannot nuke without verified snapshot");
    });

    it("BLOCKS nuke even with human approval if snapshot not verified", async () => {
      const seq = initiateKillSequence(mongoCredential, "test", ["nuke"]);
      const result = await advanceKillSequence(seq.id, mongoCredential, true); // Has approval but no snapshot

      expect(result.status).toBe("failed");
      expect(result.steps[0].result).toContain("SAFETY BLOCK");
    });
  });

  describe("SAFETY: Nuke requires human approval", () => {
    it("pauses for confirmation before nuke", async () => {
      // Simulate snapshot + verify succeeded
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          text: async () => JSON.stringify({ id: "snap-123" }),
        })
        .mockResolvedValueOnce({
          ok: true,
          text: async () => JSON.stringify({ status: "completed", storageSizeBytes: 1024 }),
        })
        .mockResolvedValueOnce({
          ok: true,
          text: async () => JSON.stringify({ results: [] }), // accessList
        });

      const seq = initiateKillSequence(mongoCredential, "compromise");

      // Step 1: Snapshot
      await advanceKillSequence(seq.id, mongoCredential);
      // Step 2: Verify
      await advanceKillSequence(seq.id, mongoCredential);
      // Step 3: Isolate
      await advanceKillSequence(seq.id, mongoCredential);

      // Step 4: Nuke — should pause for approval
      const result = await advanceKillSequence(seq.id, mongoCredential); // No humanApproval
      expect(result.status).toBe("awaiting-confirmation");
      expect(result.snapshotVerified).toBe(true);
    });

    it("proceeds with nuke after human approval", async () => {
      mockFetch
        .mockResolvedValueOnce({ ok: true, text: async () => JSON.stringify({ id: "snap-456" }) })
        .mockResolvedValueOnce({ ok: true, text: async () => JSON.stringify({ status: "completed", storageSizeBytes: 2048 }) })
        .mockResolvedValueOnce({ ok: true, text: async () => JSON.stringify({ results: [] }) })
        .mockResolvedValueOnce({ ok: true, text: async () => "{}" }); // pause cluster

      const seq = initiateKillSequence(mongoCredential, "compromise");

      await advanceKillSequence(seq.id, mongoCredential); // snapshot
      await advanceKillSequence(seq.id, mongoCredential); // verify
      await advanceKillSequence(seq.id, mongoCredential); // isolate
      await advanceKillSequence(seq.id, mongoCredential); // nuke pauses

      // Now approve
      const result = await advanceKillSequence(seq.id, mongoCredential, true);
      expect(result.status).toBe("completed");
      expect(result.snapshotId).toBe("snap-456");
    });
  });

  describe("MongoDB Atlas Steps", () => {
    it("initiates a snapshot via Atlas API", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        text: async () => JSON.stringify({ id: "atlas-snap-789" }),
      });

      const seq = initiateKillSequence(mongoCredential, "test", ["snapshot"]);
      const result = await advanceKillSequence(seq.id, mongoCredential);

      expect(result.snapshotId).toBe("atlas-snap-789");
      expect(result.steps[0].status).toBe("completed");
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining("/backup/snapshots"),
        expect.objectContaining({ method: "POST" })
      );
    });

    it("isolates cluster by removing IP whitelist", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        text: async () => JSON.stringify({ results: [
          { cidrBlock: "0.0.0.0/0" },
          { ipAddress: "1.2.3.4" },
        ]}),
      });
      mockFetch.mockResolvedValue({ ok: true }); // DELETE calls

      const seq = initiateKillSequence(mongoCredential, "test", ["isolate"]);
      const result = await advanceKillSequence(seq.id, mongoCredential);

      expect(result.steps[0].status).toBe("completed");
      expect(result.steps[0].result).toContain("Removed 2 IP whitelist entries");
    });
  });

  describe("Cloud SQL PostgreSQL Steps", () => {
    it("initiates a backup via Cloud SQL API", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        text: async () => JSON.stringify({ id: "backup-001" }),
      });

      const seq = initiateKillSequence(cloudSqlCredential, "test", ["snapshot"]);
      const result = await advanceKillSequence(seq.id, cloudSqlCredential);

      expect(result.snapshotId).toBe("backup-001");
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining("/backupRuns"),
        expect.objectContaining({ method: "POST" })
      );
    });

    it("isolates by removing authorized networks", async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          text: async () => JSON.stringify({ settings: { ipConfiguration: { authorizedNetworks: [{ value: "0.0.0.0/0" }] } } }),
        })
        .mockResolvedValueOnce({ ok: true, text: async () => "{}" }); // PATCH

      const seq = initiateKillSequence(cloudSqlCredential, "test", ["isolate"]);
      const result = await advanceKillSequence(seq.id, cloudSqlCredential);

      expect(result.steps[0].status).toBe("completed");
      expect(result.steps[0].result).toContain("database isolated");
    });
  });

  describe("Error Handling", () => {
    it("handles unknown sequence ID", async () => {
      await expect(advanceKillSequence("nonexistent", mongoCredential)).rejects.toThrow("not found");
    });

    it("does not advance completed sequences", async () => {
      mockFetch.mockResolvedValue({ ok: true, text: async () => JSON.stringify({ id: "s1" }) });
      const seq = initiateKillSequence(mongoCredential, "test", ["snapshot"]);
      await advanceKillSequence(seq.id, mongoCredential); // completes

      const result = await advanceKillSequence(seq.id, mongoCredential); // no-op
      expect(result.status).toBe("completed");
    });

    it("marks sequence as failed on API error", async () => {
      mockFetch.mockResolvedValueOnce({ ok: false, text: async () => "Internal Server Error" });

      const seq = initiateKillSequence(mongoCredential, "test", ["snapshot"]);
      const result = await advanceKillSequence(seq.id, mongoCredential);

      expect(result.status).toBe("failed");
      expect(result.steps[0].result).toContain("Snapshot failed");
    });

    it("handles missing credentials gracefully", async () => {
      const badCred: DatabaseCredential = { provider: "mongodb-atlas" };
      const seq = initiateKillSequence(badCred, "test", ["snapshot"]);
      const result = await advanceKillSequence(seq.id, badCred);

      expect(result.status).toBe("failed");
      expect(result.steps[0].result).toContain("Missing Atlas credentials");
    });
  });
});
