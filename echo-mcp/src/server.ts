import { McpServer } from "@modelcontextprotocol/server";
import { StdioServerTransport } from "@modelcontextprotocol/server/stdio";

import { pool } from "./db.js";
import { registerSignupTools } from "./tools/signup.js";
import { registerWorkspaceTools } from "./tools/workspaces.js";
import { registerActivityTools } from "./tools/activity.js";

const server = new McpServer({ name: "echo-metrics", version: "0.1.0" });

// Register BEFORE connect: the client asks for tools/list right after the
// handshake, and anything registered later won't be in that first answer.
registerSignupTools(server);
registerWorkspaceTools(server);
registerActivityTools(server);

async function main() {
  await server.connect(new StdioServerTransport());
  console.error("[echo-mcp] ready on stdio"); // stderr — stdout is the protocol
}

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    void pool.end().finally(() => process.exit(0));
  });
}

main().catch((err) => {
  console.error("[echo-mcp] fatal:", err);
  process.exit(1);
});
