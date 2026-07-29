// Registers @testing-library/jest-dom matchers (toBeInTheDocument, etc.) with
// Vitest's expect, and auto-cleans the DOM between tests. Referenced by
// vite.config.ts → test.setupFiles.
import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

afterEach(() => cleanup());
