import { Command } from "commander";
import { apiRequest } from "../api-client.js";
import { outputJson, formatTable, outputError } from "../output.js";

export function registerAnalyticsCommands(program: Command) {
  program
    .command("analytics")
    .description("FinOps analytics overview")
    .option("--days <n>", "Days to analyze", "30")
    .action(async (opts) => {
      const json = program.opts().json;
      try {
        const data = await apiRequest(`/analytics/overview?days=${opts.days}`);
        if (json) {
          outputJson(data);
        } else {
          console.log(`Analytics (last ${opts.days} days)\n`);
          if (data.dailyCosts) {
            formatTable(data.dailyCosts.slice(-7), [
              { key: "date", header: "Date" },
              { key: "totalUsd", header: "Cost (USD)" },
              { key: "violations", header: "Violations" },
              { key: "actions", header: "Actions" },
            ]);
          }
          if (data.totalSavingsUsd !== undefined) {
            console.log(`\nEstimated savings: $${data.totalSavingsUsd}`);
          }
        }
      } catch (err: any) {
        outputError(err.message, json);
        process.exit(1);
      }
    });
}
