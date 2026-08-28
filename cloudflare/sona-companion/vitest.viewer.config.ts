import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "jsdom",
    include: ["test/**/*.viewer.spec.ts"],
    coverage: {
      provider: "istanbul",
      include: ["public/viewer.js"],
      reporter: ["text", "json-summary"],
      reportsDirectory: "coverage/viewer",
    },
  },
});
