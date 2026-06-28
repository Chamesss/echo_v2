/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "node:path";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // Vitest config lives here so tests inherit the `@`/`@server` aliases and the
  // React plugin. jsdom is the default DOM for the component tests that land in
  // Sprint 5 (React Testing Library); pure-logic tests run fine in it too.
  test: {
    environment: "jsdom",
    include: ["src/**/*.test.{ts,tsx}"],
    setupFiles: ["./src/test-setup.ts"],
    css: false,
  },
  // Don't wipe the terminal on startup/reload. When `pnpm dev` runs the
  // frontend and backend in one shared terminal (pnpm -r --parallel), Vite's
  // default screen-clearing erases the server's interleaved log lines, making
  // it look like the backend produces no output. Keeping the screen lets both
  // streams coexist.
  clearScreen: false,
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      // chat-server source is referenced only via `import type` from
      // `auth-client.ts`. The alias keeps Vite + IDEs happy on resolution
      // even though no chat-server code ever ships in the frontend bundle.
      "@server": path.resolve(__dirname, "../chat-server/src"),
    },
  },
  server: {
    port: 3000,
  },
});
