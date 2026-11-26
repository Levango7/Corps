import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";
import {
  ManifestStore,
  SimulationClient,
  assertSafeAction,
  assertSafeEnvironment,
  cleanupSimulation,
  finalizeManifest,
  validateDatabaseUrl,
  runWithConcurrency,
  validateManifest,
  validateRunId,
} from "../../scripts/simulate-subagents";

const RUN_ID = "run-20261126-a1b2";
const DATABASE_NAME = `corps_sim_${RUN_ID}`;
const USER_A = "11111111-1111-4111-8111-111111111111";
const USER_B = "22222222-2222-4222-8222-222222222222";
const WORKSPACE_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const WORKSPACE_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const TASK_A = "33333333-3333-4333-8333-333333333333";
const COMMENT_A = "44444444-4444-4444-8444-444444444444";
const DECISION_A = "55555555-5555-4555-8555-555555555555";
const DOCUMENT_A = "66666666-6666-4666-8666-666666666666";
const ANNOUNCEMENT_A = "77777777-7777-4777-8777-777777777777";

function manifestFixture() {
  return {
    version: 1 as const,
    runId: RUN_ID,
    databaseName: DATABASE_NAME,
    apiUrl: "http://127.0.0.1:32123",
    createdAt: "2026-11-26T10:00:00.000Z",
    updatedAt: "2026-11-26T10:00:00.000Z",
    status: "completed" as const,
    expectedWorkers: 2,
    workers: [
      {
        index: 0,
        userId: USER_A,
        workspaceId: WORKSPACE_A,
        email: `sim-${RUN_ID}-0@example.invalid`,
        workspaceName: `Sim ${RUN_ID} worker 0`,
        taskIds: [TASK_A],
        commentIds: [COMMENT_A],
        decisionIds: [DECISION_A],
        documentIds: [DOCUMENT_A],
        announcementIds: [ANNOUNCEMENT_A],
        stats: { requests: 8, tasks: 1, comments: 1, decisions: 1, documents: 1, announcements: 1 },
      },
      {
        index: 1,
        userId: USER_B,
        workspaceId: WORKSPACE_B,
        email: `sim-${RUN_ID}-1@example.invalid`,
        workspaceName: `Sim ${RUN_ID} worker 1`,
        taskIds: [],
        commentIds: [],
        decisionIds: [],
        documentIds: [],
        announcementIds: [],
        stats: { requests: 2, tasks: 0, comments: 0, decisions: 0, documents: 0, announcements: 0 },
      },
    ],
    totals: { requests: 10, tasks: 1, comments: 1, decisions: 1, documents: 1, announcements: 1 },
  };
}

const servers: Array<{ close: () => Promise<void> }> = [];
const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()));
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

async function startServer(handler: (req: IncomingMessage, res: ServerResponse) => void) {
  const server = createServer(handler);
  servers.push({
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
        server.closeAllConnections();
      }),
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("test server did not bind loopback");
  return `http://127.0.0.1:${address.port}`;
}

function json(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

async function readBody(req: IncomingMessage) {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(Buffer.from(chunk));
  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown>;
}

describe("simulation target guards", () => {
  it("accepts only lowercase run ids that fit a dedicated database name", () => {
    expect(validateRunId(RUN_ID)).toBe(RUN_ID);
    expect(() => validateRunId("../corps")).toThrow(/runId/);
    expect(() => validateRunId("UPPER")).toThrow(/runId/);
    expect(() => validateRunId("a".repeat(41))).toThrow(/runId/);
  });

  it("rejects a non-loopback API origin and URL userinfo", () => {
    expect(() => new SimulationClient("https://corps.example.com")).toThrow(/loopback/);
    expect(() => new SimulationClient("http://user:pass@127.0.0.1:3000")).toThrow(/userinfo/);
    expect(() => new SimulationClient("ftp://127.0.0.1:3000")).toThrow(/HTTP/);
  });

  it("accepts a loopback PostgreSQL URL only for the exact run database", () => {
    expect(
      validateDatabaseUrl(
        `postgresql://postgres:test-only@127.0.0.1:55432/${DATABASE_NAME}`,
        RUN_ID,
      ),
    ).toBe(DATABASE_NAME);
    expect(() =>
      validateDatabaseUrl("postgresql://postgres:test-only@127.0.0.1:55432/corps", RUN_ID),
    ).toThrow(/corps_sim_/);
    expect(() =>
      validateDatabaseUrl(
        `postgresql://postgres:test-only@127.0.0.1:55432/corps_sim_other-run`,
        RUN_ID,
      ),
    ).toThrow(/corps_sim_/);
    expect(() =>
      validateDatabaseUrl(
        `postgresql://postgres:test-only@db.example.com:5432/${DATABASE_NAME}`,
        RUN_ID,
      ),
    ).toThrow(/loopback/);
    expect(() =>
      validateDatabaseUrl(`mysql://postgres:test-only@127.0.0.1:3306/${DATABASE_NAME}`, RUN_ID),
    ).toThrow(/PostgreSQL/);
  });

  it("fails closed when external side-effect services are configured", () => {
    expect(() => assertSafeEnvironment({ RATE_LIMIT_DISABLED: "1" })).not.toThrow();
    expect(() =>
      assertSafeEnvironment({ RATE_LIMIT_DISABLED: "1", RESEND_API_KEY: "secret" }),
    ).toThrow(/RESEND_API_KEY/);
    expect(() =>
      assertSafeEnvironment({ RATE_LIMIT_DISABLED: "1", STRIPE_SECRET_KEY: "secret" }),
    ).toThrow(/STRIPE_SECRET_KEY/);
    expect(() =>
      assertSafeEnvironment({ RATE_LIMIT_DISABLED: "1", OPENAI_API_KEY: "secret" }),
    ).toThrow(/OPENAI_API_KEY/);
    expect(() =>
      assertSafeEnvironment({ RATE_LIMIT_DISABLED: "1", DEEPSEEK_API_KEY: "secret" }),
    ).toThrow(/DEEPSEEK_API_KEY/);
    expect(() =>
      assertSafeEnvironment({ RATE_LIMIT_DISABLED: "1", ALIPAY_APP_ID: "secret" }),
    ).toThrow(/ALIPAY_APP_ID/);
    expect(() =>
      assertSafeEnvironment({ RATE_LIMIT_DISABLED: "1", WECHAT_APP_ID: "secret" }),
    ).toThrow(/WECHAT_APP_ID/);
    expect(() =>
      assertSafeEnvironment({ RATE_LIMIT_DISABLED: "1", FIREBASE_SERVER_KEY: "secret" }),
    ).toThrow(/FIREBASE_SERVER_KEY/);
  });
});

describe("simulation action whitelist", () => {
  it("rejects dangerous endpoints and side-effect fields before any HTTP request", async () => {
    let requests = 0;
    const apiUrl = await startServer((_req, res) => {
      requests += 1;
      json(res, 500, { code: 500, data: null });
    });
    const client = new SimulationClient(apiUrl);

    await expect(
      client.request({ kind: "ai.chat", workspaceId: WORKSPACE_A, prompt: "hello" } as never),
    ).rejects.toThrow(/action/);
    await expect(
      client.request({
        kind: "task.create",
        workspaceId: WORKSPACE_A,
        title: "safe",
        assigneeId: USER_B,
      } as never),
    ).rejects.toThrow(/assigneeId/);
    await expect(
      client.request({
        kind: "task.update",
        workspaceId: WORKSPACE_A,
        taskId: TASK_A,
        dueDate: "2026-11-27T00:00:00.000Z",
      } as never),
    ).rejects.toThrow(/dueDate/);
    await expect(
      client.request({
        kind: "comment.create",
        workspaceId: WORKSPACE_A,
        taskId: TASK_A,
        body: "hello",
        mentions: [USER_B],
      } as never),
    ).rejects.toThrow(/mentions/);

    expect(requests).toBe(0);
    expect(() => assertSafeAction({ kind: "billing.webhook" })).toThrow(/action/);
  });
});

describe("independent worker identities over real HTTP", () => {
  it("keeps cookies, tokens, users and workspaces separate and refreshes once on 401", async () => {
    const requests: Array<{
      method: string;
      url: string;
      authorization: string | undefined;
      cookie: string | undefined;
    }> = [];
    const refreshed = new Set<string>();
    let nextUser = 0;
    let nextTask = 0;

    const apiUrl = await startServer(async (req, res) => {
      const authorization = req.headers.authorization;
      const cookie = req.headers.cookie;
      requests.push({ method: req.method ?? "", url: req.url ?? "", authorization, cookie });
      const url = new URL(req.url ?? "/", "http://127.0.0.1");

      if (url.pathname === "/api/v1/auth/register" && req.method === "POST") {
        const body = await readBody(req);
        nextUser += 1;
        const userId = nextUser === 1 ? USER_A : USER_B;
        const workspaceId = nextUser === 1 ? WORKSPACE_A : WORKSPACE_B;
        res.setHeader("set-cookie", [
          `access_token=token-${userId}; Path=/; HttpOnly`,
          `better-auth.session_token=session-${userId}; Path=/; HttpOnly`,
        ]);
        json(res, 201, {
          code: 201,
          data: {
            user: { id: userId, email: body.email, name: body.name },
            workspace: { id: workspaceId, name: body.workspaceName, slug: `sim-${nextUser}` },
          },
        });
        return;
      }

      if (url.pathname === "/api/v1/auth/refresh" && req.method === "POST") {
        const match = cookie?.match(/better-auth\.session_token=session-([0-9a-f-]+)/);
        const userId = match?.[1];
        if (!userId) {
          json(res, 401, { code: 401, data: null });
          return;
        }
        refreshed.add(userId);
        res.setHeader("set-cookie", [
          `access_token=refreshed-${userId}; Path=/; HttpOnly`,
          `better-auth.session_token=session-${userId}-rotated; Path=/; HttpOnly`,
        ]);
        json(res, 200, {
          code: 200,
          data: {
            workspace: {
              id: userId === USER_A ? WORKSPACE_A : WORKSPACE_B,
              name: "workspace",
              role: "owner",
            },
          },
        });
        return;
      }

      if (url.pathname.endsWith("/tasks") && req.method === "POST") {
        if (!authorization?.startsWith("Bearer refreshed-")) {
          json(res, 401, { code: 401, data: null });
          return;
        }
        const userId = authorization.slice("Bearer refreshed-".length);
        const workspaceId = userId === USER_A ? WORKSPACE_A : WORKSPACE_B;
        const body = await readBody(req);
        nextTask += 1;
        json(res, 201, {
          code: 201,
          data: {
            id: nextTask === 1 ? TASK_A : "88888888-8888-4888-8888-888888888888",
            workspaceId,
            ...body,
          },
        });
        return;
      }

      json(res, 404, { code: 404, data: null });
    });

    const clientA = new SimulationClient(apiUrl);
    const clientB = new SimulationClient(apiUrl);
    const registeredA = await clientA.request({
      kind: "register",
      email: `sim-${RUN_ID}-0@example.invalid`,
      password: "simulation-only-password",
      name: "Simulation A",
      workspaceName: `Sim ${RUN_ID} worker 0`,
    });
    const registeredB = await clientB.request({
      kind: "register",
      email: `sim-${RUN_ID}-1@example.invalid`,
      password: "simulation-only-password",
      name: "Simulation B",
      workspaceName: `Sim ${RUN_ID} worker 1`,
    });
    const taskA = await clientA.request({
      kind: "task.create",
      workspaceId: WORKSPACE_A,
      title: "A task",
      description: RUN_ID,
      status: "todo",
      priority: "medium",
    });
    const taskB = await clientB.request({
      kind: "task.create",
      workspaceId: WORKSPACE_B,
      title: "B task",
      description: RUN_ID,
      status: "todo",
      priority: "medium",
    });

    expect(registeredA.status).toBe(201);
    expect(registeredB.status).toBe(201);
    expect(taskA.status).toBe(201);
    expect(taskB.status).toBe(201);
    expect(refreshed).toEqual(new Set([USER_A, USER_B]));
    expect(requests.filter((request) => request.url === "/api/v1/auth/refresh")).toHaveLength(2);
    const taskRequests = requests.filter(
      (request) => request.method === "POST" && request.url.endsWith("/tasks"),
    );
    expect(taskRequests).toHaveLength(4);
    expect(taskRequests[0]?.authorization).toBe(`Bearer token-${USER_A}`);
    expect(taskRequests[1]?.authorization).toBe(`Bearer refreshed-${USER_A}`);
    expect(taskRequests[1]?.cookie).toContain(`session-${USER_A}-rotated`);
    expect(taskRequests[1]?.cookie).not.toContain(USER_B);
    expect(taskRequests[3]?.authorization).toBe(`Bearer refreshed-${USER_B}`);
    expect(taskRequests[3]?.cookie).toContain(`session-${USER_B}-rotated`);
    expect(taskRequests[3]?.cookie).not.toContain(USER_A);
  });
});

describe("worker scheduling", () => {
  it("waits for every started worker to settle before surfacing a failure", async () => {
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const finished: number[] = [];
    let outcomeSettled = false;
    const outcome = runWithConcurrency(3, 3, async (index) => {
      if (index === 0) throw new Error("worker failed");
      await gate;
      finished.push(index);
    }).then(
      () => {
        outcomeSettled = true;
        return { ok: true as const };
      },
      (error: unknown) => {
        outcomeSettled = true;
        return { ok: false as const, error };
      },
    );

    await Promise.resolve();
    await Promise.resolve();
    expect(outcomeSettled).toBe(false);
    release?.();
    const result = await outcome;
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toEqual(new Error("worker failed"));
    expect(finished.sort()).toEqual([1, 2]);
  });
});

describe("manifest and cleanup guards", () => {
  it("writes the manifest atomically without leaving temporary files", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "corps-sim-manifest-"));
    tempDirs.push(dir);
    const manifestPath = path.join(dir, "run.json");
    const store = new ManifestStore(manifestPath, manifestFixture());
    await store.update((manifest) => {
      manifest.totals.requests = 11;
    });
    await store.flush();

    expect(JSON.parse(readFileSync(manifestPath, "utf8")).totals.requests).toBe(11);
    expect(readdirSync(dir)).toEqual(["run.json"]);
  });

  it("persists later mutations to a registered worker instead of a stale snapshot", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "corps-sim-worker-sync-"));
    tempDirs.push(dir);
    const manifestPath = path.join(dir, "run.json");
    const manifest = manifestFixture();
    const worker = manifest.workers[0];
    const store = new ManifestStore(manifestPath, manifest);
    await store.updateWorker(worker);

    worker.taskIds.push("99999999-9999-4999-8999-999999999999");
    worker.stats.tasks = 2;
    await store.updateWorker(worker);

    const saved = JSON.parse(readFileSync(manifestPath, "utf8"));
    expect(saved.workers[0].taskIds).toHaveLength(2);
    expect(saved.workers[0].stats.tasks).toBe(2);
    expect(saved.totals.tasks).toBe(2);
  });

  it("allows cleanup of a failed partial run using only its recorded identities", () => {
    const complete = manifestFixture();
    const partial = {
      ...complete,
      status: "failed" as const,
      expectedWorkers: 3,
      workers: [complete.workers[0]],
      totals: { ...complete.workers[0].stats },
    };
    expect(() => validateManifest(partial, RUN_ID)).toThrow(/incomplete/);
    expect(validateManifest(partial, RUN_ID, { allowPartial: true }).workers).toHaveLength(1);
  });

  it("finalizes a complete manifest without restoring its previous running status", () => {
    const manifest = { ...manifestFixture(), status: "running" as const };
    const finalized = finalizeManifest(manifest, RUN_ID);
    expect(finalized.status).toBe("completed");
    expect(finalized.totals.tasks).toBe(1);
  });

  it("rejects missing ids, duplicate identities, foreign ownership and embedded credentials", () => {
    const valid = manifestFixture();
    expect(validateManifest(valid, RUN_ID).workers).toHaveLength(2);

    const missingId = structuredClone(valid);
    delete (missingId.workers[0] as unknown as Record<string, unknown>).userId;
    expect(() => validateManifest(missingId, RUN_ID)).toThrow(/userId/);

    const duplicate = structuredClone(valid);
    duplicate.workers[1].userId = USER_A;
    expect(() => validateManifest(duplicate, RUN_ID)).toThrow(/unique|duplicate/i);

    const foreignOwnership = structuredClone(valid);
    foreignOwnership.workers[0].workspaceName = "Another team's workspace";
    expect(() => validateManifest(foreignOwnership, RUN_ID)).toThrow(/workspaceName/);

    const credentials = structuredClone(valid);
    (credentials.workers[0] as unknown as Record<string, unknown>).accessToken = "do-not-persist";
    expect(() => validateManifest(credentials, RUN_ID)).toThrow(/Unrecognized|accessToken/);
  });

  it("refuses cleanup before connecting when the manifest run id does not match", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "corps-sim-cleanup-"));
    tempDirs.push(dir);
    const manifestPath = path.join(dir, "run.json");
    const manifest = manifestFixture();
    manifest.runId = "run-other";
    writeFileSync(manifestPath, JSON.stringify(manifest));

    await expect(
      cleanupSimulation({
        manifestPath,
        runId: RUN_ID,
        ownerUrl: `postgresql://postgres:test-only@127.0.0.1:1/${DATABASE_NAME}`,
      }),
    ).rejects.toThrow(/runId/);
  });
});

describe("simulation CLI safety", () => {
  it("refuses to run when the inherited environment configures an external AI service", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "corps-sim-cli-ai-"));
    tempDirs.push(dir);
    const webDir = path.resolve(import.meta.dirname, "../..");
    const env = {
      ...process.env,
      CORPS_SIM_API_URL: "http://127.0.0.1:1",
      CORPS_SIM_DATABASE_URL: `postgresql://postgres:test-only@127.0.0.1:1/${DATABASE_NAME}`,
      OPENAI_API_KEY: "must-not-be-used",
    };
    const result = spawnSync(
      process.execPath,
      [
        "--import",
        pathToFileURL(path.join(webDir, "node_modules/tsx/dist/loader.mjs")).href,
        path.join(webDir, "scripts/simulate-subagents.ts"),
        "run",
        "--run-id",
        RUN_ID,
        "--workers",
        "1",
        "--iterations",
        "1",
      ],
      { cwd: dir, env, encoding: "utf8", timeout: 30_000 },
    );

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("OPENAI_API_KEY");
    expect(result.stderr).not.toContain("must-not-be-used");
  });

  it("does not fall back to .env or DATABASE_URL and exits nonzero without explicit targets", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "corps-sim-cli-"));
    tempDirs.push(dir);
    writeFileSync(
      path.join(dir, ".env"),
      "CORPS_SIM_API_URL=https://trap.invalid\nDATABASE_URL=postgresql://trap:trap@db.example.com/corps\n",
    );
    const webDir = path.resolve(import.meta.dirname, "../..");
    const env = { ...process.env };
    for (const key of Object.keys(env)) {
      if (/^(CORPS_SIM_|DATABASE_|TEST_BASE_URL$)/.test(key)) delete env[key];
    }
    const result = spawnSync(
      process.execPath,
      [
        "--import",
        pathToFileURL(path.join(webDir, "node_modules/tsx/dist/loader.mjs")).href,
        path.join(webDir, "scripts/simulate-subagents.ts"),
        "run",
        "--run-id",
        RUN_ID,
      ],
      { cwd: dir, env, encoding: "utf8", timeout: 30_000 },
    );

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("CORPS_SIM_API_URL");
    expect(`${result.stdout}${result.stderr}`).not.toContain("trap.invalid");
    expect(`${result.stdout}${result.stderr}`).not.toContain("trap:trap");
  });
});
