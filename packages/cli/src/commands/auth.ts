import { Command } from "commander";
import { saveConfig, deleteConfig, resolveApiKey, resolveApiUrl } from "../config.js";
import { apiRequest } from "../api-client.js";
import { outputJson, formatObject, outputError } from "../output.js";

export function registerAuthCommands(program: Command) {
  const auth = program.command("auth").description("Manage authentication");

  auth
    .command("login")
    .description("Authenticate with an API key")
    .requiredOption("--api-key <key>", "Personal API key (starts with ks_)")
    .action(async (opts) => {
      const json = program.opts().json;
      const key = opts.apiKey;

      if (!key.startsWith("ks_")) {
        outputError("API key must start with 'ks_'. Create one at app.kill-switch.net.", json);
        process.exit(1);
      }

      // Validate the key by calling the API
      try {
        const result = await apiRequest("/accounts/me", { apiKey: key });
        saveConfig({ apiKey: key, apiUrl: resolveApiUrl() });

        if (json) {
          outputJson({ authenticated: true, account: result.name || result._id });
        } else {
          console.log(`Authenticated as ${result.name || result._id}`);
          console.log("API key saved to ~/.kill-switch/config.json");
        }
      } catch (err: any) {
        outputError(`Authentication failed: ${err.message}`, json);
        process.exit(2);
      }
    });

  auth
    .command("logout")
    .description("Clear stored credentials")
    .action(() => {
      const json = program.opts().json;
      deleteConfig();
      if (json) {
        outputJson({ loggedOut: true });
      } else {
        console.log("Credentials cleared.");
      }
    });

  auth
    .command("status")
    .description("Show current auth status")
    .action(async () => {
      const json = program.opts().json;
      const key = resolveApiKey();

      if (!key) {
        if (json) {
          outputJson({ authenticated: false });
        } else {
          console.log("Not authenticated. Run: kill-switch auth login --api-key YOUR_KEY");
        }
        return;
      }

      try {
        const result = await apiRequest("/accounts/me");
        if (json) {
          outputJson({ authenticated: true, ...result });
        } else {
          formatObject({
            authenticated: "yes",
            account: result.name || result._id,
            tier: result.tier,
            keyPrefix: key.substring(0, 16) + "...",
          });
        }
      } catch {
        if (json) {
          outputJson({ authenticated: false, keyPresent: true, error: "Key is invalid or expired" });
        } else {
          console.log("API key present but invalid. Run: kill-switch auth login --api-key NEW_KEY");
        }
      }
    });
}
