import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    isolate: true,
    pool: "threads",
    poolOptions: {
      threads: {
        maxThreads: 2,
        minThreads: 1,
        memoryLimit: "512MB",
      },
    },
    testTimeout: 10000,
  },
});
