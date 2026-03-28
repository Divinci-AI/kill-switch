import { Command } from "commander";
import { apiRequest } from "../api-client.js";
import { outputJson, formatTable, outputError } from "../output.js";

export function registerRuleCommands(program: Command) {
  const rules = program.command("rules").description("Manage kill switch rules");

  rules
    .command("list")
    .alias("ls")
    .description("List active rules")
    .action(async () => {
      const json = program.opts().json;
      try {
        const data = await apiRequest("/rules");
        const list = data.rules || data;
        if (json) {
          outputJson(list);
        } else {
          formatTable(Array.isArray(list) ? list : [], [
            { key: "id", header: "ID" },
            { key: "name", header: "Name" },
            { key: "trigger", header: "Trigger" },
            { key: "enabled", header: "Enabled" },
          ]);
        }
      } catch (err: any) {
        outputError(err.message, json);
        process.exit(1);
      }
    });

  rules
    .command("presets")
    .description("List available preset templates")
    .action(async () => {
      const json = program.opts().json;
      try {
        const data = await apiRequest("/rules/presets", { public: true });
        const presets = data.presets || data;
        if (json) {
          outputJson(presets);
        } else {
          formatTable(presets, [
            { key: "id", header: "ID", width: 20 },
            { key: "name", header: "Name", width: 30 },
            { key: "description", header: "Description", width: 50 },
          ]);
        }
      } catch (err: any) {
        outputError(err.message, json);
        process.exit(1);
      }
    });

  rules
    .command("create <name>")
    .description("Create a custom rule")
    .requiredOption("--trigger <type>", "Trigger type (cost, security, api)")
    .option("--condition <json>", "Condition JSON")
    .option("--action <json>", "Action JSON")
    .action(async (name, opts) => {
      const json = program.opts().json;
      try {
        const body: any = { name, trigger: opts.trigger };
        if (opts.condition) body.conditions = JSON.parse(opts.condition);
        if (opts.action) body.actions = JSON.parse(opts.action);
        const data = await apiRequest("/rules", { method: "POST", body });
        if (json) {
          outputJson(data);
        } else {
          console.log(`Rule created: ${data.id || data._id}`);
        }
      } catch (err: any) {
        outputError(err.message, json);
        process.exit(1);
      }
    });

  rules
    .command("delete <id>")
    .alias("rm")
    .description("Delete a rule")
    .action(async (id) => {
      const json = program.opts().json;
      try {
        await apiRequest(`/rules/${id}`, { method: "DELETE" });
        if (json) {
          outputJson({ deleted: true, id });
        } else {
          console.log(`Rule ${id} deleted.`);
        }
      } catch (err: any) {
        outputError(err.message, json);
        process.exit(1);
      }
    });

  rules
    .command("toggle <id>")
    .description("Enable/disable a rule")
    .action(async (id) => {
      const json = program.opts().json;
      try {
        const data = await apiRequest(`/rules/${id}/toggle`, { method: "POST" });
        if (json) {
          outputJson(data);
        } else {
          console.log(`Rule ${id} is now ${data.enabled ? "enabled" : "disabled"}.`);
        }
      } catch (err: any) {
        outputError(err.message, json);
        process.exit(1);
      }
    });
}
