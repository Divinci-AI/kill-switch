import { Command } from "commander";
import { apiRequest } from "../api-client.js";
import { outputJson, formatTable, outputError } from "../output.js";

const PRESETS = [
  "ddos", "brute-force", "cost-runaway", "error-storm",
  "exfiltration", "gpu-runaway", "lambda-loop", "aws-cost-runaway",
];

export function registerShieldCommands(program: Command) {
  const shield = program
    .command("shield [preset]")
    .description("Quick-apply a protection preset (e.g., kill-switch shield cost-runaway)")
    .option("--list", "List available shields")
    .action(async (preset, opts) => {
      const json = program.opts().json;

      if (opts.list || !preset) {
        try {
          const data = await apiRequest("/rules/presets", { public: true });
          const presets = data.presets || data;
          if (json) {
            outputJson(presets);
          } else {
            console.log("Available shields:\n");
            formatTable(presets, [
              { key: "id", header: "Shield", width: 20 },
              { key: "name", header: "Name", width: 30 },
              { key: "description", header: "Description", width: 50 },
            ]);
            console.log("\nUsage: kill-switch shield <preset-id>");
          }
        } catch (err: any) {
          outputError(err.message, json);
          process.exit(1);
        }
        return;
      }

      if (!PRESETS.includes(preset)) {
        outputError(`Unknown preset "${preset}". Run: kill-switch shield --list`, json);
        process.exit(1);
      }

      try {
        const data = await apiRequest(`/rules/presets/${preset}`, { method: "POST" });
        if (json) {
          outputJson(data);
        } else {
          console.log(`Shield activated: ${data.name || preset}`);
          if (data.id) console.log(`Rule ID: ${data.id}`);
        }
      } catch (err: any) {
        outputError(err.message, json);
        process.exit(1);
      }
    });
}
