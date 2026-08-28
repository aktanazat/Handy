import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

const migrations = await readD1Migrations("./migrations");

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: "./wrangler.jsonc" },
      miniflare: {
        bindings: {
          BOOTSTRAP_SECRET: "test-bootstrap-secret-only",
          TEST_MIGRATIONS: migrations,
        },
      },
    }),
  ],
  test: {
    pool: "@cloudflare/vitest-pool-workers",
    include: ["test/**/*.worker.spec.ts"],
    setupFiles: ["./test/setup.worker.ts"],
    coverage: {
      provider: "istanbul",
      include: ["src/**/*.ts"],
      reporter: ["text", "json-summary"],
      reportsDirectory: "coverage/worker",
    },
  },
});
