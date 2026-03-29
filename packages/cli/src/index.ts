#!/usr/bin/env node
/**
 * Kill Switch CLI
 *
 * Monitor cloud spending, kill runaway services from the terminal.
 *
 * Usage:
 *   kill-switch auth login --api-key ks_live_abc123
 *   kill-switch shield cost-runaway
 *   kill-switch check
 *   kill-switch accounts list --json
 */

import { Command } from "commander";
import { registerAuthCommands } from "./commands/auth.js";
import { registerAccountCommands } from "./commands/accounts.js";
import { registerRuleCommands } from "./commands/rules.js";
import { registerShieldCommands } from "./commands/shield.js";
import { registerCheckCommands } from "./commands/check.js";
import { registerAlertCommands } from "./commands/alerts.js";
import { registerKillCommands } from "./commands/kill.js";
import { registerAnalyticsCommands } from "./commands/analytics.js";
import { registerConfigCommands } from "./commands/config-cmd.js";
import { registerOnboardCommands } from "./commands/onboard.js";

const program = new Command();

program
  .name("kill-switch")
  .description("Monitor cloud spending, kill runaway services, protect your infrastructure")
  .version("0.1.0")
  .option("--json", "Output as JSON (for automation/scripting)")
  .option("--api-key <key>", "API key (overrides config and env)")
  .option("--api-url <url>", "API URL (overrides config and env)");

registerAuthCommands(program);
registerAccountCommands(program);
registerRuleCommands(program);
registerShieldCommands(program);
registerCheckCommands(program);
registerAlertCommands(program);
registerKillCommands(program);
registerAnalyticsCommands(program);
registerConfigCommands(program);
registerOnboardCommands(program);

program.parse();
