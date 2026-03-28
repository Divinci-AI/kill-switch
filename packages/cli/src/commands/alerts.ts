import { Command } from "commander";
import { apiRequest } from "../api-client.js";
import { outputJson, formatTable, outputError } from "../output.js";

export function registerAlertCommands(program: Command) {
  const alerts = program.command("alerts").description("Manage alert channels");

  alerts
    .command("list")
    .alias("ls")
    .description("List configured alert channels")
    .action(async () => {
      const json = program.opts().json;
      try {
        const data = await apiRequest("/alerts/channels");
        const channels = data.channels || data;
        if (json) {
          outputJson(channels);
        } else {
          formatTable(Array.isArray(channels) ? channels : [], [
            { key: "type", header: "Type" },
            { key: "name", header: "Name" },
            { key: "enabled", header: "Enabled" },
          ]);
        }
      } catch (err: any) {
        outputError(err.message, json);
        process.exit(1);
      }
    });

  alerts
    .command("test")
    .description("Send a test alert to all channels")
    .action(async () => {
      const json = program.opts().json;
      try {
        const data = await apiRequest("/alerts/test", { method: "POST" });
        if (json) {
          outputJson(data);
        } else {
          console.log("Test alert sent to all configured channels.");
        }
      } catch (err: any) {
        outputError(err.message, json);
        process.exit(1);
      }
    });
}
