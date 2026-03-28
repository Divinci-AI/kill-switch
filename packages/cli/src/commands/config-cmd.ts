import { Command } from "commander";
import { loadConfig, saveConfig, CONFIG_FILE, DEFAULT_API_URL } from "../config.js";
import { outputJson, outputError } from "../output.js";

export function registerConfigCommands(program: Command) {
  const config = program.command("config").description("Manage CLI configuration");

  config
    .command("init")
    .description("Create config file with defaults")
    .action(() => {
      const json = program.opts().json;
      const existing = loadConfig();
      saveConfig({ apiUrl: DEFAULT_API_URL, ...existing });
      if (json) {
        outputJson({ configFile: CONFIG_FILE, created: true });
      } else {
        console.log(`Config saved to ${CONFIG_FILE}`);
      }
    });

  config
    .command("get <key>")
    .description("Get a config value")
    .action((key) => {
      const json = program.opts().json;
      const cfg = loadConfig();
      const value = (cfg as any)[key];
      if (json) {
        outputJson({ [key]: value ?? null });
      } else {
        console.log(value ?? "(not set)");
      }
    });

  config
    .command("set <key> <value>")
    .description("Set a config value")
    .action((key, value) => {
      const json = program.opts().json;
      const cfg = loadConfig();
      (cfg as any)[key] = value;
      saveConfig(cfg);
      if (json) {
        outputJson({ [key]: value });
      } else {
        console.log(`${key} = ${value}`);
      }
    });

  config
    .command("list")
    .alias("ls")
    .description("Show all config values")
    .action(() => {
      const json = program.opts().json;
      const cfg = loadConfig();
      if (json) {
        outputJson(cfg);
      } else {
        const entries = Object.entries(cfg);
        if (entries.length === 0) {
          console.log("No config set. Run: kill-switch config init");
        } else {
          for (const [k, v] of entries) {
            const display = k === "apiKey" ? String(v).substring(0, 16) + "..." : String(v);
            console.log(`${k.padEnd(12)} ${display}`);
          }
        }
        console.log(`\nConfig file: ${CONFIG_FILE}`);
      }
    });
}
