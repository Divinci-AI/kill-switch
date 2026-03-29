/**
 * Migration 001: Add Organization Fields
 *
 * - Backfills `type: "personal"` and auto-generated `slug` on existing GuardianAccounts
 * - Creates UserProfile documents for all existing users
 * - Sets activeOrgId to their current GuardianAccount
 *
 * Safe to run multiple times (idempotent).
 *
 * Usage: npx tsx src/migrations/001-add-org-fields.ts
 */

import mongoose from "mongoose";
import crypto from "crypto";
import { connectMongoDB } from "../globals/index.js";

async function migrate() {
  await connectMongoDB();

  const { GuardianAccountModel } = await import("../models/guardian-account/schema.js");
  const { UserProfileModel } = await import("../models/user-profile/schema.js");
  const { TeamMemberModel } = await import("../models/team/schema.js");

  // --- Step 1: Backfill GuardianAccount type and slug ---
  const accounts = await GuardianAccountModel.find({
    $or: [{ type: { $exists: false } }, { slug: { $exists: false } }],
  });

  console.log(`[migration] Found ${accounts.length} accounts to backfill`);

  for (const account of accounts) {
    if (!account.type) account.type = "personal";
    if (!account.slug) {
      const base = account.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "workspace";
      account.slug = `${base}-${crypto.randomBytes(6).toString("hex")}`;
    }
    await account.save();
    console.log(`[migration] Backfilled account ${account._id}: type=${account.type}, slug=${account.slug}`);
  }

  // --- Step 2: Drop the old unique index on ownerUserId if it exists ---
  try {
    const collection = GuardianAccountModel.collection;
    const indexes = await collection.indexes();
    const uniqueOwnerIndex = indexes.find(
      (idx: any) => idx.key?.ownerUserId && idx.unique
    );
    if (uniqueOwnerIndex && uniqueOwnerIndex.name) {
      await collection.dropIndex(uniqueOwnerIndex.name);
      console.log(`[migration] Dropped unique index on ownerUserId: ${uniqueOwnerIndex.name}`);
    } else {
      console.log("[migration] No unique ownerUserId index found (already migrated or never existed)");
    }
  } catch (err: any) {
    console.warn(`[migration] Could not drop ownerUserId unique index: ${err.message}`);
  }

  // --- Step 3: Create UserProfile for all existing users ---
  const allAccounts = await GuardianAccountModel.find({});
  const allMembers = await TeamMemberModel.find({});

  // Collect all unique userIds
  const userMap = new Map<string, { email: string; name: string; accountId: string }>();

  for (const account of allAccounts) {
    if (!userMap.has(account.ownerUserId)) {
      userMap.set(account.ownerUserId, {
        email: account.name, // Best we have — name is often set to email during auto-provision
        name: account.name,
        accountId: account._id.toString(),
      });
    }
  }

  for (const member of allMembers) {
    if (!userMap.has(member.userId)) {
      userMap.set(member.userId, {
        email: member.email,
        name: member.email,
        accountId: member.guardianAccountId,
      });
    }
  }

  let profilesCreated = 0;
  for (const [userId, info] of userMap) {
    const existing = await UserProfileModel.findOne({ userId });
    if (!existing) {
      await UserProfileModel.create({
        userId,
        email: info.email,
        name: info.name,
        activeOrgId: info.accountId,
      });
      profilesCreated++;
    }
  }

  console.log(`[migration] Created ${profilesCreated} UserProfile documents (${userMap.size} total users)`);
  console.log("[migration] Done!");

  await mongoose.disconnect();
}

migrate().catch((err) => {
  console.error("[migration] Failed:", err);
  process.exit(1);
});
