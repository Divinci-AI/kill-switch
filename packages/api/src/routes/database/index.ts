/**
 * Database Kill Switch Routes
 *
 * API for initiating, monitoring, and confirming database kill sequences.
 * Every destructive action requires a verified snapshot first.
 */

import { Router } from "express";
import {
  initiateKillSequence,
  advanceKillSequence,
  abortKillSequence,
  getKillSequence,
  listActiveSequences,
  type DatabaseCredential,
  type DatabaseKillAction,
} from "../../services/database-kill-switch.js";

export const databaseRouter = Router();

/**
 * POST /database/kill — Initiate a database kill sequence
 * Body: { credential, trigger, actions? }
 */
databaseRouter.post("/kill", (req, res) => {
  const { credential, trigger, actions } = req.body as {
    credential: DatabaseCredential;
    trigger: string;
    actions?: DatabaseKillAction[];
  };

  if (!credential?.provider || !trigger) {
    return res.status(400).json({ error: "Missing credential.provider or trigger" });
  }

  const sequence = initiateKillSequence(credential, trigger, actions);

  res.status(201).json({
    sequenceId: sequence.id,
    status: sequence.status,
    steps: sequence.steps.map(s => ({ action: s.action, status: s.status })),
    message: "Kill sequence initiated. Call POST /database/kill/:id/advance to execute each step.",
  });
});

/**
 * POST /database/kill/:id/advance — Execute the next step
 * Body: { credential, humanApproval? }
 */
databaseRouter.post("/kill/:id/advance", async (req, res, next) => {
  try {
    const { credential, humanApproval } = req.body;
    const sequence = await advanceKillSequence(req.params.id, credential, humanApproval);

    res.json({
      sequenceId: sequence.id,
      status: sequence.status,
      currentStep: sequence.currentStep,
      snapshotId: sequence.snapshotId,
      snapshotVerified: sequence.snapshotVerified,
      steps: sequence.steps.map(s => ({
        action: s.action,
        status: s.status,
        result: s.result,
        timestamp: s.timestamp,
      })),
    });
  } catch (e: any) {
    next(e);
  }
});

/**
 * POST /database/kill/:id/abort — Abort a kill sequence
 */
databaseRouter.post("/kill/:id/abort", (req, res) => {
  const sequence = abortKillSequence(req.params.id);
  if (!sequence) {
    return res.status(404).json({ error: "Kill sequence not found" });
  }
  res.json({ sequenceId: sequence.id, status: sequence.status, message: "Kill sequence aborted" });
});

/**
 * GET /database/kill/:id — Get status of a kill sequence
 */
databaseRouter.get("/kill/:id", (req, res) => {
  const sequence = getKillSequence(req.params.id);
  if (!sequence) {
    return res.status(404).json({ error: "Kill sequence not found" });
  }
  res.json(sequence);
});

/**
 * GET /database/kill — List active kill sequences
 */
databaseRouter.get("/kill", (_req, res) => {
  res.json({ sequences: listActiveSequences() });
});
