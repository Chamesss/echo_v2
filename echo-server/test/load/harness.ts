import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { attachRealtimeServer } from "../../src/infrastructure/realtime/server.js";
import { backplane } from "../../src/infrastructure/realtime/backplane.js";
import { pool } from "../../src/infrastructure/database/pool.js";
import { openOrCreateDm } from "../../src/modules/channels/dm.service.js";
import {
  addMember,
  createUser,
  createWorkspace,
  destroyWorkspace,
  type TestWorkspace,
} from "../factories.js";

/**
 * Shared setup + measurement for the load files.
 *
 * The server runs in-process so a run needs nothing but a database: no ports to
 * coordinate, no separate process to babysit, and `process.memoryUsage()` reads
 * the same heap the sockets live on — which is the point, since flat memory
 * across a run is the pass condition that catches socket, timer and LISTEN leaks.
 */

export const ORIGIN = "http://localhost:3000"; // matches CORS_ORIGINS

export interface LoadEnv {
  server: Server;
  port: number;
  workspace: TestWorkspace;
  channelId: string;
  authorId: string;
  readerId: string;
  wsUrl: (workspaceId?: string) => string;
}

/** Provision a workspace + DM and start a realtime server in front of it. */
export async function setupLoadEnv(): Promise<LoadEnv> {
  const author = await createUser();
  const reader = await createUser();
  const workspace = await createWorkspace(author.id);
  await addMember(workspace.workspaceId, reader.id, "member");
  const channel = await openOrCreateDm(workspace.workspaceId, author.id, [reader.id]);

  const server = createServer();
  attachRealtimeServer(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as AddressInfo).port;

  return {
    server,
    port,
    workspace,
    channelId: channel.id,
    authorId: author.id,
    readerId: reader.id,
    wsUrl: (workspaceId = workspace.workspaceId) =>
      `ws://127.0.0.1:${port}/ws?workspaceId=${workspaceId}`,
  };
}

export async function teardownLoadEnv(env: LoadEnv | undefined): Promise<void> {
  if (env) {
    await new Promise<void>((resolve) => env.server.close(() => resolve()));
    await destroyWorkspace(env.workspace);
  }
  await backplane.close();
  await pool.end();
}

/** Read `name` from env as an integer, falling back to `fallback`. */
export function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  const parsed = raw ? Number.parseInt(raw, 10) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[idx]!;
}

/** Samples RSS over time so a run can be checked for drift, not just a peak. */
export class MemorySampler {
  private readonly samples: number[] = [];
  private timer: ReturnType<typeof setInterval> | null = null;

  start(everyMs = 1_000): void {
    this.sample();
    this.timer = setInterval(() => this.sample(), everyMs);
  }

  sample(): void {
    this.samples.push(process.memoryUsage().rss);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.sample();
  }

  get mb(): number[] {
    return this.samples.map((b) => Math.round(b / 1024 / 1024));
  }

  /**
   * Growth from the first quarter of the run to the last, as a ratio.
   *
   * Compared as averages over spans rather than first-vs-last samples: GC
   * timing makes any single pair meaningless. A steady climb here is the shape
   * a leak makes; a flat or sawtooth profile is healthy.
   */
  get growthRatio(): number {
    const s = this.samples;
    if (s.length < 4) return 1;
    const span = Math.max(1, Math.floor(s.length / 4));
    const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
    const early = avg(s.slice(0, span));
    const late = avg(s.slice(-span));
    return late / early;
  }
}

/** One line per run, easy to diff across runs. */
export function report(name: string, fields: Record<string, unknown>): void {
  const body = Object.entries(fields)
    .map(([k, v]) => `${k}=${typeof v === "number" ? Math.round(v * 100) / 100 : v}`)
    .join(" ");
  console.log(`[load:${name}] ${body}`);
}

export const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));
