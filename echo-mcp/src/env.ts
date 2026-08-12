import { config } from "dotenv";
import { fileURLToPath } from "node:url";

// packages/echo-mcp/src/env.ts → ../../../echo-server/.env
const envPath = fileURLToPath(
  new URL("../../echo-server/.env", import.meta.url),
);
config({ path: envPath });

export const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  throw new Error(`DATABASE_URL is not set (looked in ${envPath})`);
}
