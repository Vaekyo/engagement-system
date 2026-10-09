import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Integration tests run against a real PostgreSQL database.
//   TEST_DATABASE_URL=postgresql://... npm run test:integration
// The global setup applies migrations and the tests truncate all tables.
const url = process.env.TEST_DATABASE_URL;
if (!url) throw new Error("Set TEST_DATABASE_URL to a disposable PostgreSQL database.");

export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  test: {
    include: ["tests/integration/**/*.int.test.ts"],
    environment: "node",
    globalSetup: ["tests/integration/global-setup.ts"],
    fileParallelism: false,
    env: {
      DATABASE_URL: url,
      SESSION_SECRET: "integration-test-session-secret-0123456789",
      TOKEN_ENCRYPTION_KEY: Buffer.alloc(32, 9).toString("base64"),
      MOCK_MODE: "false",
      ENABLE_LIVE_PUBLISHING: "true",
    },
  },
});
