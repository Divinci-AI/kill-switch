import type { CloudProvider, ProviderId } from "./types.js";
import { cloudflareProvider } from "./cloudflare/checker.js";
import { gcpProvider } from "./gcp/checker.js";
import { awsProvider } from "./aws/checker.js";
import { runpodProvider } from "./runpod/checker.js";

const providers: Record<string, CloudProvider> = {
  cloudflare: cloudflareProvider,
  gcp: gcpProvider,
  aws: awsProvider,
  runpod: runpodProvider,
};

export function getProvider(id: ProviderId): CloudProvider | undefined {
  return providers[id];
}

export function getAllProviders(): CloudProvider[] {
  return Object.values(providers);
}
