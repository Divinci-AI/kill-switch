/**
 * Auth Routes — Personal API Key Management
 *
 * Allows users to create, list, and revoke API keys for CLI access.
 * All endpoints require Auth0 JWT authentication (you need to be logged
 * in via the web dashboard to manage API keys).
 */

import { Router } from "express";
import { createApiKey, listApiKeys, deleteApiKey } from "../../models/api-key/schema.js";

export const authRouter = Router();

/**
 * POST /auth/api-keys — Create a new personal API key
 * Body: { name: string }
 * Returns: { id, key, name } — key is shown ONLY once
 */
authRouter.post("/api-keys", async (req: any, res, next) => {
  try {
    const { name } = req.body;
    if (!name) return res.status(400).json({ error: "Missing name" });

    const result = await createApiKey(req.guardianAccountId, req.userId, name);

    res.status(201).json({
      id: result.id,
      key: result.key,
      name,
      message: "Save this key — it will not be shown again.",
    });
  } catch (e) { next(e); }
});

/**
 * GET /auth/api-keys — List API keys (metadata only)
 */
authRouter.get("/api-keys", async (req: any, res, next) => {
  try {
    const keys = await listApiKeys(req.guardianAccountId);
    res.json({ keys });
  } catch (e) { next(e); }
});

/**
 * DELETE /auth/api-keys/:id — Revoke an API key
 */
authRouter.delete("/api-keys/:id", async (req: any, res, next) => {
  try {
    const deleted = await deleteApiKey(req.params.id, req.guardianAccountId);
    if (!deleted) return res.status(404).json({ error: "API key not found" });
    res.json({ deleted: true });
  } catch (e) { next(e); }
});
