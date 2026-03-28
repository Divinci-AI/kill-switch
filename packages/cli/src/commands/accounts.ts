import { Command } from "commander";
import { apiRequest } from "../api-client.js";
import { outputJson, formatTable, formatObject, outputError } from "../output.js";

export function registerAccountCommands(program: Command) {
  const accounts = program.command("accounts").description("Manage cloud accounts");

  accounts
    .command("list")
    .alias("ls")
    .description("List connected cloud accounts")
    .action(async () => {
      const json = program.opts().json;
      try {
        const data = await apiRequest("/cloud-accounts");
        const list = data.accounts || data;
        if (json) {
          outputJson(list);
        } else {
          formatTable(Array.isArray(list) ? list : [], [
            { key: "_id", header: "ID" },
            { key: "provider", header: "Provider" },
            { key: "name", header: "Name" },
            { key: "status", header: "Status" },
          ]);
        }
      } catch (err: any) {
        outputError(err.message, json);
        process.exit(1);
      }
    });

  accounts
    .command("get <id>")
    .description("Get cloud account details")
    .action(async (id) => {
      const json = program.opts().json;
      try {
        const data = await apiRequest(`/cloud-accounts/${id}`);
        if (json) {
          outputJson(data);
        } else {
          formatObject(data);
        }
      } catch (err: any) {
        outputError(err.message, json);
        process.exit(1);
      }
    });

  accounts
    .command("add <provider>")
    .description("Connect a cloud provider (cloudflare, gcp, aws)")
    .requiredOption("--name <name>", "Account name")
    .option("--token <token>", "API token (Cloudflare)")
    .option("--account-id <id>", "Account ID (Cloudflare)")
    .option("--project-id <id>", "Project ID (GCP)")
    .option("--service-account <json>", "Service Account JSON (GCP)")
    .action(async (provider, opts) => {
      const json = program.opts().json;
      const credential: Record<string, string> = {};
      if (opts.token) credential.apiToken = opts.token;
      if (opts.accountId) credential.accountId = opts.accountId;
      if (opts.projectId) credential.projectId = opts.projectId;
      if (opts.serviceAccount) credential.serviceAccountJson = opts.serviceAccount;

      try {
        const data = await apiRequest("/cloud-accounts", {
          method: "POST",
          body: { provider, name: opts.name, credential },
        });
        if (json) {
          outputJson(data);
        } else {
          console.log(`Connected ${provider} account: ${data.name || data._id}`);
        }
      } catch (err: any) {
        outputError(err.message, json);
        process.exit(1);
      }
    });

  accounts
    .command("delete <id>")
    .alias("rm")
    .description("Disconnect and delete a cloud account")
    .action(async (id) => {
      const json = program.opts().json;
      try {
        await apiRequest(`/cloud-accounts/${id}`, { method: "DELETE" });
        if (json) {
          outputJson({ deleted: true, id });
        } else {
          console.log(`Account ${id} disconnected.`);
        }
      } catch (err: any) {
        outputError(err.message, json);
        process.exit(1);
      }
    });

  accounts
    .command("check <id>")
    .description("Run manual monitoring check on an account")
    .action(async (id) => {
      const json = program.opts().json;
      try {
        const data = await apiRequest(`/cloud-accounts/${id}/check`, { method: "POST" });
        if (json) {
          outputJson(data);
        } else {
          console.log(`Check complete: ${data.violations?.length || 0} violations`);
          if (data.violations?.length) {
            formatTable(data.violations, [
              { key: "metric", header: "Metric" },
              { key: "value", header: "Value" },
              { key: "threshold", header: "Threshold" },
              { key: "action", header: "Action" },
            ]);
          }
        }
      } catch (err: any) {
        outputError(err.message, json);
        process.exit(1);
      }
    });
}
