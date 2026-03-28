import { Command } from "commander";
import { apiRequest } from "../api-client.js";
import { outputJson, formatTable, outputError } from "../output.js";

export function registerCheckCommands(program: Command) {
  program
    .command("check")
    .description("Run monitoring check on all connected accounts")
    .action(async () => {
      const json = program.opts().json;
      try {
        const data = await apiRequest("/check", { method: "POST" });
        if (json) {
          outputJson(data);
        } else {
          const results = data.results || [];
          console.log(`Checked ${results.length} account(s)\n`);
          for (const r of results) {
            console.log(`${r.provider || "unknown"}: ${r.name || r.cloudAccountId}`);
            if (r.violations?.length) {
              formatTable(r.violations, [
                { key: "metric", header: "Metric" },
                { key: "value", header: "Value" },
                { key: "threshold", header: "Threshold" },
              ]);
            } else {
              console.log("  All clear\n");
            }
          }
        }
      } catch (err: any) {
        outputError(err.message, json);
        process.exit(1);
      }
    });
}
