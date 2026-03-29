/**
 * Role-Based Permission Middleware
 *
 * Enforces the permission matrix based on the user's role in the current org.
 * Must be used after resolveOrg middleware (which sets req.teamRole).
 */

import type { Response, NextFunction } from "express";
import type { AuthenticatedRequest } from "./auth.js";

type TeamRole = "owner" | "admin" | "member" | "viewer";

const PERMISSION_MATRIX: Record<string, TeamRole[]> = {
  // Cloud accounts
  "cloud_accounts:read":    ["owner", "admin", "member", "viewer"],
  "cloud_accounts:write":   ["owner", "admin", "member"],
  "cloud_accounts:delete":  ["owner", "admin", "member"],

  // Rules
  "rules:read":             ["owner", "admin", "member", "viewer"],
  "rules:write":            ["owner", "admin", "member"],
  "rules:delete":           ["owner", "admin", "member"],

  // Kill switch
  "kill_switch:trigger":    ["owner", "admin", "member"],
  "kill_switch:read":       ["owner", "admin", "member", "viewer"],

  // Alerts
  "alerts:read":            ["owner", "admin", "member", "viewer"],
  "alerts:write":           ["owner", "admin"],

  // Team
  "team:read":              ["owner", "admin", "member", "viewer"],
  "team:manage":            ["owner", "admin"],

  // Settings
  "settings:read":          ["owner", "admin", "member", "viewer"],
  "settings:write":         ["owner", "admin"],

  // Billing
  "billing:read":           ["owner", "admin", "member", "viewer"],
  "billing:manage":         ["owner"],

  // API Keys (user's own keys within the org)
  "api_keys:manage":        ["owner", "admin", "member"],

  // Org management
  "org:manage":             ["owner"],
  "org:delete":             ["owner"],

  // Activity log
  "activity:read":          ["owner", "admin"],

  // Check trigger
  "check:trigger":          ["owner", "admin", "member"],
};

/**
 * Middleware factory: requires the user to have the specified permission
 * in their current org based on their role.
 */
export function requirePermission(permission: string) {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    const allowedRoles = PERMISSION_MATRIX[permission];
    if (!allowedRoles) {
      console.error(`[guardian] Unknown permission: ${permission}`);
      return res.status(500).json({ error: "Internal server error" });
    }

    const role = req.teamRole;
    if (!role || !allowedRoles.includes(role)) {
      return res.status(403).json({ error: "Insufficient permissions" });
    }

    next();
  };
}
