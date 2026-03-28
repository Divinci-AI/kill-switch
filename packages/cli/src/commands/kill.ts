import { Command } from "commander";
import { apiRequest } from "../api-client.js";
import { outputJson, formatTable, formatObject, outputError } from "../output.js";

export function registerKillCommands(program: Command) {
  const kill = program.command("kill").description("Database kill switch sequences");

  kill
    .command("init")
    .description("Initiate a database kill sequence")
    .requiredOption("--credential-id <id>", "Stored credential ID")
    .requiredOption("--trigger <reason>", "Kill trigger reason")
    .action(async (opts) => {
      const json = program.opts().json;
      try {
        const data = await apiRequest("/database/kill", {
          method: "POST",
          body: { credentialId: opts.credentialId, trigger: opts.trigger },
        });
        if (json) {
          outputJson(data);
        } else {
          console.log(`Kill sequence initiated: ${data.sequenceId}`);
          console.log(`Status: ${data.status}`);
          console.log(`Steps: ${data.steps?.map((s: any) => s.action).join(" -> ")}`);
          console.log(`\nAdvance: kill-switch kill advance ${data.sequenceId} --credential-id ${opts.credentialId}`);
        }
      } catch (err: any) {
        outputError(err.message, json);
        process.exit(1);
      }
    });

  kill
    .command("status [id]")
    .description("Get kill sequence status (or list all active)")
    .action(async (id) => {
      const json = program.opts().json;
      try {
        if (id) {
          const data = await apiRequest(`/database/kill/${id}`);
          if (json) {
            outputJson(data);
          } else {
            formatObject(data, ["id", "status", "currentStep", "snapshotVerified"]);
            if (data.steps) {
              console.log("\nSteps:");
              formatTable(data.steps, [
                { key: "action", header: "Action" },
                { key: "status", header: "Status" },
                { key: "timestamp", header: "Timestamp" },
              ]);
            }
          }
        } else {
          const data = await apiRequest("/database/kill");
          const sequences = data.sequences || data;
          if (json) {
            outputJson(sequences);
          } else {
            formatTable(Array.isArray(sequences) ? sequences : [], [
              { key: "id", header: "Sequence ID" },
              { key: "status", header: "Status" },
              { key: "currentStep", header: "Step" },
            ]);
          }
        }
      } catch (err: any) {
        outputError(err.message, json);
        process.exit(1);
      }
    });

  kill
    .command("advance <id>")
    .description("Execute the next step in a kill sequence")
    .requiredOption("--credential-id <credId>", "Stored credential ID")
    .option("--human-approval", "Confirm human approval (required for nuke step)")
    .action(async (id, opts) => {
      const json = program.opts().json;
      try {
        const data = await apiRequest(`/database/kill/${id}/advance`, {
          method: "POST",
          body: {
            credentialId: opts.credentialId,
            humanApproval: opts.humanApproval || false,
          },
        });
        if (json) {
          outputJson(data);
        } else {
          console.log(`Step executed: ${data.steps?.[data.currentStep - 1]?.action || "?"}`);
          console.log(`Status: ${data.status}`);
          if (data.status !== "completed") {
            console.log(`Next: kill-switch kill advance ${id} --credential-id ${opts.credentialId}`);
          }
        }
      } catch (err: any) {
        outputError(err.message, json);
        process.exit(1);
      }
    });

  kill
    .command("abort <id>")
    .description("Abort a kill sequence")
    .action(async (id) => {
      const json = program.opts().json;
      try {
        const data = await apiRequest(`/database/kill/${id}/abort`, { method: "POST" });
        if (json) {
          outputJson(data);
        } else {
          console.log(`Kill sequence ${id} aborted.`);
        }
      } catch (err: any) {
        outputError(err.message, json);
        process.exit(1);
      }
    });
}
