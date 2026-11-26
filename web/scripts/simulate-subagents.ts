import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { Client, Pool } from "pg";
import { z } from "zod";

const MAX_WORKERS = 50;
const MAX_ITERATIONS = 100;
const FREE_DECISION_LIMIT = 10;
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]"]);

const uuidSchema = z.string().uuid();
const statsSchema = z.object({
  requests: z.number().int().nonnegative(),
  tasks: z.number().int().nonnegative(),
  comments: z.number().int().nonnegative(),
  decisions: z.number().int().nonnegative(),
  documents: z.number().int().nonnegative(),
  announcements: z.number().int().nonnegative(),
});

const workerSchema = z
  .object({
    index: z
      .number()
      .int()
      .min(0)
      .max(MAX_WORKERS - 1),
    userId: uuidSchema,
    workspaceId: uuidSchema,
    email: z.string().email(),
    workspaceName: z.string().min(2).max(100),
    taskIds: z.array(uuidSchema),
    commentIds: z.array(uuidSchema),
    decisionIds: z.array(uuidSchema),
    documentIds: z.array(uuidSchema),
    announcementIds: z.array(uuidSchema),
    stats: statsSchema,
  })
  .strict();

const manifestSchema = z
  .object({
    version: z.literal(1),
    runId: z.string(),
    databaseName: z.string(),
    apiUrl: z.string(),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
    status: z.enum(["running", "completed", "failed"]),
    expectedWorkers: z.number().int().min(1).max(MAX_WORKERS),
    workers: z.array(workerSchema),
    totals: statsSchema,
    cleanup: z
      .object({
        deletedUsers: z.number().int().positive(),
        verifiedAt: z.string().datetime(),
      })
      .strict()
      .optional(),
  })
  .strict();

type SimulationStats = z.infer<typeof statsSchema>;
type SimulationWorker = z.infer<typeof workerSchema>;
type SimulationManifest = z.infer<typeof manifestSchema>;

const taskStatusSchema = z.enum(["todo", "in_progress", "review", "done"]);
const prioritySchema = z.enum(["low", "medium", "high", "urgent"]);
const workspaceFields = { workspaceId: uuidSchema };

const actionSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("register"),
      email: z.string().email(),
      password: z.string().min(8).max(128),
      name: z.string().min(2).max(100),
      workspaceName: z.string().min(2).max(100),
    })
    .strict(),
  z
    .object({
      kind: z.literal("refresh"),
      workspaceId: uuidSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal("task.create"),
      ...workspaceFields,
      title: z.string().min(1).max(255),
      description: z.string().max(5000),
      status: taskStatusSchema,
      priority: prioritySchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal("task.update"),
      ...workspaceFields,
      taskId: uuidSchema,
      title: z.string().min(1).max(255).optional(),
      description: z.string().max(5000).optional(),
      status: taskStatusSchema.optional(),
      priority: prioritySchema.optional(),
    })
    .strict()
    .refine(
      (value) =>
        value.title !== undefined ||
        value.description !== undefined ||
        value.status !== undefined ||
        value.priority !== undefined,
      { message: "task.update requires a safe field" },
    ),
  z
    .object({
      kind: z.literal("comment.create"),
      ...workspaceFields,
      taskId: uuidSchema,
      body: z.string().min(1).max(10000),
    })
    .strict(),
  z
    .object({
      kind: z.literal("decision.create"),
      ...workspaceFields,
      taskId: uuidSchema,
      markdown: z.string().min(1).max(50000),
    })
    .strict(),
  z
    .object({
      kind: z.literal("document.create"),
      ...workspaceFields,
      title: z.string().min(1).max(255),
      markdown: z.string(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("announcement.create"),
      ...workspaceFields,
      title: z.string().min(1).max(200),
      content: z.string().min(1),
      type: z.enum(["info", "warning", "urgent"]),
    })
    .strict(),
  z
    .object({
      kind: z.literal("tasks.list"),
      ...workspaceFields,
    })
    .strict(),
]);

type SimulationAction = z.infer<typeof actionSchema>;

type ApiEnvelope<T> = {
  code: number;
  data: T;
  message?: string;
};

type ApiResponse<T> = {
  status: number;
  body: ApiEnvelope<T>;
};

type RunOptions = {
  runId: string;
  workers: number;
  iterations: number;
  concurrency: number;
  apiUrl: string;
  databaseUrl: string;
  manifestPath: string;
};

const registerResponseSchema = z.object({
  user: z.object({ id: uuidSchema, email: z.string().email() }),
  workspace: z.object({ id: uuidSchema, name: z.string() }),
});

const entityResponseSchema = z.object({ id: uuidSchema });

export function validateRunId(value: string): string {
  if (!/^[a-z0-9][a-z0-9-]{2,39}$/.test(value)) {
    throw new Error("Invalid runId: use 3-40 lowercase letters, digits or hyphens");
  }
  return value;
}

function validateLoopbackUrl(value: string, protocol: "HTTP" | "PostgreSQL"): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`Invalid ${protocol} URL`);
  }
  const allowedProtocols = protocol === "HTTP" ? ["http:", "https:"] : ["postgres:", "postgresql:"];
  if (!allowedProtocols.includes(url.protocol))
    throw new Error(`${protocol} URL has an invalid protocol`);
  if (!LOOPBACK_HOSTS.has(url.hostname.toLowerCase()))
    throw new Error(`${protocol} URL must use loopback`);
  if (protocol === "HTTP" && (url.username || url.password))
    throw new Error("HTTP URL must not contain userinfo");
  if (protocol === "HTTP" && (url.pathname !== "/" || url.search || url.hash)) {
    throw new Error("HTTP URL must be an origin without a path, query or fragment");
  }
  return url;
}

export function validateDatabaseUrl(value: string, runId: string): string {
  validateRunId(runId);
  const url = validateLoopbackUrl(value, "PostgreSQL");
  const expected = `corps_sim_${runId}`;
  const actual = decodeURIComponent(url.pathname.slice(1));
  if (actual !== expected) throw new Error(`PostgreSQL database must be exactly ${expected}`);
  return expected;
}

export function assertSafeEnvironment(env: Record<string, string | undefined>) {
  const forbidden = new Set([
    "EMAIL_HOST",
    "EMAIL_USER",
    "EMAIL_PASSWORD",
    "EMAIL_FROM",
    "MAIL_FROM",
    "PAYMENT_PROVIDER",
    "AI_GATEWAY_API_KEY",
    "GOOGLE_GENERATIVE_AI_API_KEY",
    "ERROR_WEBHOOK_URL",
    "GOOGLE_CLIENT_ID",
    "GOOGLE_CLIENT_SECRET",
    "MICROSOFT_CLIENT_ID",
    "MICROSOFT_CLIENT_SECRET",
    "AZURE_CLIENT_SECRET",
    "REDIS_URL",
  ]);
  const forbiddenPrefixes = [
    "SMTP_",
    "RESEND_",
    "STRIPE_",
    "ALIPAY_",
    "WECHAT_",
    "DEEPSEEK_",
    "OPENAI_",
    "ANTHROPIC_",
    "LIVEKIT_",
    "VAPID_",
    "SENTRY_",
    "NEXT_PUBLIC_SENTRY_",
    "FIREBASE_",
    "APNS_",
    "HUAWEI_",
    "NEXUSLOOM_",
  ];
  const configured = Object.keys(env).filter(
    (key) =>
      Boolean(env[key]?.trim()) &&
      (forbidden.has(key) || forbiddenPrefixes.some((prefix) => key.startsWith(prefix))),
  );
  if (configured.length > 0) {
    throw new Error(`External side-effect configuration is forbidden: ${configured.join(", ")}`);
  }
}

export function assertSafeAction(value: unknown): asserts value is SimulationAction {
  const parsed = actionSchema.safeParse(value);
  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => `${issue.path.join(".") || "kind"}: ${issue.message}`)
      .join("; ");
    throw new Error(`Unsafe simulation action: ${details}`);
  }
}

function endpointFor(action: SimulationAction): {
  url: string;
  method: "GET" | "POST" | "PATCH";
  body?: unknown;
} {
  if (action.kind === "register") {
    return { url: "/api/v1/auth/register", method: "POST", body: action };
  }
  if (action.kind === "refresh") {
    return {
      url: "/api/v1/auth/refresh",
      method: "POST",
      body: { workspaceId: action.workspaceId },
    };
  }
  const base = `/api/v1/workspaces/${action.workspaceId}`;
  switch (action.kind) {
    case "task.create":
      return { url: `${base}/tasks`, method: "POST", body: action };
    case "task.update":
      return { url: `${base}/tasks/${action.taskId}`, method: "PATCH", body: action };
    case "comment.create":
      return { url: `${base}/tasks/${action.taskId}/comments`, method: "POST", body: action };
    case "decision.create":
      return { url: `${base}/tasks/${action.taskId}/decisions`, method: "POST", body: action };
    case "document.create":
      return { url: `${base}/documents`, method: "POST", body: action };
    case "announcement.create":
      return { url: `${base}/announcements`, method: "POST", body: action };
    case "tasks.list":
      return { url: `${base}/tasks?page=1&limit=100`, method: "GET" };
  }
}

function parseCookies(response: Response, jar: Map<string, string>) {
  for (const header of response.headers.getSetCookie()) {
    const pair = header.split(";", 1)[0];
    const separator = pair?.indexOf("=") ?? -1;
    if (separator <= 0) continue;
    const name = pair.slice(0, separator).trim();
    const value = pair.slice(separator + 1).trim();
    if (value) jar.set(name, value);
    else jar.delete(name);
  }
}

async function parseEnvelope(response: Response): Promise<ApiEnvelope<unknown>> {
  try {
    return (await response.json()) as ApiEnvelope<unknown>;
  } catch {
    return { code: response.status, data: null, message: "Invalid JSON response" };
  }
}

export class SimulationClient {
  private readonly origin: string;
  private readonly jar = new Map<string, string>();
  private requestCount = 0;

  constructor(apiUrl: string) {
    const url = validateLoopbackUrl(apiUrl, "HTTP");
    this.origin = url.origin;
  }

  get requests() {
    return this.requestCount;
  }

  async request<T = unknown>(value: unknown): Promise<ApiResponse<T>> {
    assertSafeAction(value);
    return this.send<T>(value, false);
  }

  private async send<T>(action: SimulationAction, retried: boolean): Promise<ApiResponse<T>> {
    const endpoint = endpointFor(action);
    const headers: Record<string, string> = { accept: "application/json" };
    if (endpoint.body !== undefined) headers["content-type"] = "application/json";
    if (this.jar.size > 0)
      headers.cookie = [...this.jar].map(([name, value]) => `${name}=${value}`).join("; ");
    const accessToken = this.jar.get("access_token");
    if (accessToken && action.kind !== "register" && action.kind !== "refresh") {
      headers.authorization = `Bearer ${accessToken}`;
    }

    this.requestCount += 1;
    const response = await fetch(`${this.origin}${endpoint.url}`, {
      method: endpoint.method,
      headers,
      body: endpoint.body === undefined ? undefined : JSON.stringify(endpoint.body),
      redirect: "error",
      signal: AbortSignal.timeout(30_000),
    });
    parseCookies(response, this.jar);
    const body = await parseEnvelope(response);

    if (
      response.status === 401 &&
      !retried &&
      action.kind !== "register" &&
      action.kind !== "refresh"
    ) {
      await this.send<unknown>({ kind: "refresh", workspaceId: action.workspaceId }, true);
      return this.send<T>(action, true);
    }
    if (response.status < 200 || response.status >= 300) {
      throw new Error(
        `Simulation ${action.kind} failed with HTTP ${response.status} (code ${body.code})`,
      );
    }
    return { status: response.status, body: body as ApiEnvelope<T> };
  }
}

function parseManifest(value: unknown): SimulationManifest {
  const parsed = manifestSchema.safeParse(value);
  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => `${issue.path.join(".") || "manifest"}: ${issue.message}`)
      .join("; ");
    throw new Error(`Invalid simulation manifest: ${details}`);
  }
  return parsed.data;
}

export function validateManifest(
  value: unknown,
  runId: string,
  options: { allowPartial?: boolean } = {},
): SimulationManifest {
  validateRunId(runId);
  const manifest = parseManifest(value);
  if (manifest.runId !== runId)
    throw new Error("Simulation manifest runId does not match the requested runId");
  if (manifest.databaseName !== `corps_sim_${runId}`) {
    throw new Error("Simulation manifest databaseName does not match the runId");
  }
  validateLoopbackUrl(manifest.apiUrl, "HTTP");
  if (!options.allowPartial && manifest.workers.length !== manifest.expectedWorkers) {
    throw new Error("Simulation manifest worker count is incomplete");
  }
  if (manifest.workers.length > manifest.expectedWorkers) {
    throw new Error("Simulation manifest worker count exceeds expectedWorkers");
  }

  const userIds = new Set<string>();
  const workspaceIds = new Set<string>();
  const emails = new Set<string>();
  const indexes = new Set<number>();
  for (const [position, worker] of manifest.workers.entries()) {
    if (worker.index >= manifest.expectedWorkers || indexes.has(worker.index)) {
      throw new Error(
        "Simulation manifest worker indexes must be unique and within expectedWorkers",
      );
    }
    indexes.add(worker.index);
    if (!options.allowPartial && worker.index !== position) {
      throw new Error("Simulation manifest worker indexes must be contiguous");
    }
    if (userIds.has(worker.userId))
      throw new Error("Simulation manifest userId values must be unique");
    if (workspaceIds.has(worker.workspaceId))
      throw new Error("Simulation manifest workspaceId values must be unique");
    if (emails.has(worker.email)) throw new Error("Simulation manifest emails must be unique");
    userIds.add(worker.userId);
    workspaceIds.add(worker.workspaceId);
    emails.add(worker.email);
    if (worker.email !== `sim-${runId}-${worker.index}@example.invalid`) {
      throw new Error("Simulation manifest email ownership does not match the runId");
    }
    if (worker.workspaceName !== `Sim ${runId} worker ${worker.index}`) {
      throw new Error("Simulation manifest workspaceName ownership does not match the runId");
    }
    for (const ids of [
      worker.taskIds,
      worker.commentIds,
      worker.decisionIds,
      worker.documentIds,
      worker.announcementIds,
    ]) {
      if (new Set(ids).size !== ids.length)
        throw new Error("Simulation manifest entity IDs must be unique per worker");
    }
    if (
      worker.stats.tasks !== worker.taskIds.length ||
      worker.stats.comments !== worker.commentIds.length ||
      worker.stats.decisions !== worker.decisionIds.length ||
      worker.stats.documents !== worker.documentIds.length ||
      worker.stats.announcements !== worker.announcementIds.length
    ) {
      throw new Error("Simulation manifest entity counts do not match recorded IDs");
    }
    if (worker.stats.decisions > FREE_DECISION_LIMIT) {
      throw new Error("Simulation manifest exceeds the free decision limit");
    }
  }

  const totals = emptyStats();
  for (const worker of manifest.workers) {
    totals.requests += worker.stats.requests;
    totals.tasks += worker.stats.tasks;
    totals.comments += worker.stats.comments;
    totals.decisions += worker.stats.decisions;
    totals.documents += worker.stats.documents;
    totals.announcements += worker.stats.announcements;
  }
  if (JSON.stringify(totals) !== JSON.stringify(manifest.totals)) {
    throw new Error("Simulation manifest totals do not match worker stats");
  }
  return manifest;
}

function emptyStats(): SimulationStats {
  return { requests: 0, tasks: 0, comments: 0, decisions: 0, documents: 0, announcements: 0 };
}

function emptyWorker(index: number, runId: string): SimulationWorker {
  return {
    index,
    userId: "",
    workspaceId: "",
    email: `sim-${runId}-${index}@example.invalid`,
    workspaceName: `Sim ${runId} worker ${index}`,
    taskIds: [],
    commentIds: [],
    decisionIds: [],
    documentIds: [],
    announcementIds: [],
    stats: emptyStats(),
  };
}

export class ManifestStore {
  private data: SimulationManifest;
  private chain: Promise<void> = Promise.resolve();

  constructor(
    private readonly manifestPath: string,
    initial: SimulationManifest,
  ) {
    this.data = parseManifest(initial);
  }

  update(mutate: (manifest: SimulationManifest) => void): Promise<void> {
    this.chain = this.chain.then(async () => {
      const next = structuredClone(this.data);
      mutate(next);
      next.updatedAt = new Date().toISOString();
      const validated = parseManifest(next);
      await this.write(validated);
      this.data = validated;
    });
    return this.chain;
  }

  updateWorker(worker: SimulationWorker): Promise<void> {
    return this.update((manifest) => {
      const index = manifest.workers.findIndex((candidate) => candidate.index === worker.index);
      if (index < 0) throw new Error(`Worker ${worker.index} is not registered in the manifest`);
      manifest.workers[index] = structuredClone(worker);
      recalculateTotals(manifest);
    });
  }

  flush(): Promise<void> {
    return this.chain;
  }

  private async write(manifest: SimulationManifest) {
    await mkdir(path.dirname(this.manifestPath), { recursive: true });
    const temporary = `${this.manifestPath}.${randomUUID()}.tmp`;
    await writeFile(temporary, `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });
    await rename(temporary, this.manifestPath);
  }
}

function requireOk<T>(response: ApiResponse<T>, expected: number): T {
  if (response.status !== expected || response.body.code !== expected) {
    throw new Error(`Unexpected API response: HTTP ${response.status}, code ${response.body.code}`);
  }
  return response.body.data;
}

function requireEntityId(data: unknown): string {
  const parsed = entityResponseSchema.safeParse(data);
  if (!parsed.success) throw new Error("API response did not contain a valid entity ID");
  return parsed.data.id;
}

async function withClient<T>(client: Client, action: () => Promise<T>): Promise<T> {
  await client.query("BEGIN");
  try {
    const result = await action();
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}

async function setWorkerContext(client: Client, worker: SimulationWorker) {
  await client.query(
    "SELECT set_config('app.user_id', $1, true), set_config('app.workspace_id', $2, true)",
    [worker.userId, worker.workspaceId],
  );
}

async function verifyWorkerIdentity(pool: Pool, worker: SimulationWorker) {
  const client = await pool.connect();
  try {
    await withClient(client, async () => {
      await setWorkerContext(client, worker);
      const user = await client.query("SELECT id, email FROM users WHERE id = $1", [worker.userId]);
      const workspace = await client.query(
        'SELECT id, name, "owner_id" FROM workspaces WHERE id = $1',
        [worker.workspaceId],
      );
      if (user.rowCount !== 1 || user.rows[0]?.email !== worker.email) {
        throw new Error(`Worker ${worker.index} user was not found in the dedicated database`);
      }
      if (
        workspace.rowCount !== 1 ||
        workspace.rows[0]?.name !== worker.workspaceName ||
        workspace.rows[0]?.owner_id !== worker.userId
      ) {
        throw new Error(
          `Worker ${worker.index} workspace ownership was not found in the dedicated database`,
        );
      }
    });
  } finally {
    client.release();
  }
}

async function verifyWorkerCounts(pool: Pool, worker: SimulationWorker) {
  const client = await pool.connect();
  try {
    await withClient(client, async () => {
      await setWorkerContext(client, worker);
      const result = await client.query(
        `SELECT
          (SELECT count(*) FROM tasks WHERE "workspace_id" = $1) AS tasks,
          (SELECT count(*) FROM comments WHERE "workspace_id" = $1) AS comments,
          (SELECT count(*) FROM decisions WHERE "workspace_id" = $1) AS decisions,
          (SELECT count(*) FROM decision_versions WHERE "workspace_id" = $1) AS decision_versions,
          (SELECT count(*) FROM documents WHERE "workspace_id" = $1) AS documents,
          (SELECT count(*) FROM announcements WHERE "workspace_id" = $1) AS announcements`,
        [worker.workspaceId],
      );
      const counts = result.rows[0] as Record<string, string>;
      const expected = {
        tasks: worker.taskIds.length,
        comments: worker.commentIds.length,
        decisions: worker.decisionIds.length,
        decision_versions: worker.decisionIds.length,
        documents: worker.documentIds.length,
        announcements: worker.announcementIds.length,
      };
      for (const [table, count] of Object.entries(expected)) {
        if (Number(counts[table]) !== count) {
          throw new Error(`Worker ${worker.index} ${table} count does not match the manifest`);
        }
      }
    });
  } finally {
    client.release();
  }
}

async function assertDatabaseRole(
  client: Client,
  connectionString: string,
  runId: string,
  mode: "application" | "owner",
) {
  validateDatabaseUrl(connectionString, runId);
  const result = await client.query(
    "SELECT current_database() AS database_name, rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user",
  );
  const role = result.rows[0] as
    { database_name: string; rolsuper: boolean; rolbypassrls: boolean } | undefined;
  if (!role || role.database_name !== `corps_sim_${runId}`) {
    throw new Error("Connected PostgreSQL database does not match the dedicated run database");
  }
  if (mode === "application" && (role.rolsuper || role.rolbypassrls)) {
    throw new Error("Simulation application role must be NOSUPERUSER and NOBYPASSRLS");
  }
  if (mode === "owner" && !role.rolsuper && !role.rolbypassrls) {
    throw new Error("Cleanup role must be SUPERUSER or BYPASSRLS");
  }
}

function recalculateTotals(manifest: SimulationManifest) {
  manifest.totals = emptyStats();
  for (const worker of manifest.workers) {
    manifest.totals.requests += worker.stats.requests;
    manifest.totals.tasks += worker.stats.tasks;
    manifest.totals.comments += worker.stats.comments;
    manifest.totals.decisions += worker.stats.decisions;
    manifest.totals.documents += worker.stats.documents;
    manifest.totals.announcements += worker.stats.announcements;
  }
  manifest.workers.sort((a, b) => a.index - b.index);
}

export function finalizeManifest(manifest: SimulationManifest, runId: string): SimulationManifest {
  const next = structuredClone(manifest);
  recalculateTotals(next);
  next.status = "completed";
  return validateManifest(next, runId);
}

async function runWorker(
  options: RunOptions,
  store: ManifestStore,
  pool: Pool,
  index: number,
): Promise<void> {
  const client = new SimulationClient(options.apiUrl);
  const email = `sim-${options.runId}-${index}@example.invalid`;
  const workspaceName = `Sim ${options.runId} worker ${index}`;
  const registered = requireOk(
    await client.request<unknown>({
      kind: "register",
      email,
      password: randomUUID(),
      name: `Simulation ${index}`,
      workspaceName,
    }),
    201,
  );
  const identity = registerResponseSchema.safeParse(registered);
  if (
    !identity.success ||
    identity.data.user.email !== email ||
    identity.data.workspace.name !== workspaceName
  ) {
    throw new Error(
      `Worker ${index} registration identity did not match the requested isolated identity`,
    );
  }
  const worker: SimulationWorker = {
    ...emptyWorker(index, options.runId),
    userId: identity.data.user.id,
    workspaceId: identity.data.workspace.id,
    stats: { ...emptyStats(), requests: client.requests },
  };
  await store.update((manifest) => {
    manifest.workers.push(structuredClone(worker));
    recalculateTotals(manifest);
  });
  await verifyWorkerIdentity(pool, worker);
  requireOk(await client.request({ kind: "refresh", workspaceId: worker.workspaceId }), 200);

  for (let iteration = 1; iteration <= options.iterations; iteration += 1) {
    const task = requireOk(
      await client.request<unknown>({
        kind: "task.create",
        workspaceId: worker.workspaceId,
        title: `[${options.runId}] worker ${index} task ${iteration}`,
        description: `API-only simulation ${options.runId} / worker ${index} / iteration ${iteration}`,
        status: "todo",
        priority: iteration % 3 === 0 ? "high" : "medium",
      }),
      201,
    );
    const taskId = requireEntityId(task);
    worker.taskIds.push(taskId);
    worker.stats.tasks += 1;
    await store.updateWorker(worker);

    requireOk(
      await client.request({
        kind: "task.update",
        workspaceId: worker.workspaceId,
        taskId,
        status: iteration % 2 === 0 ? "done" : "in_progress",
        description: `Updated by API simulation ${options.runId} / iteration ${iteration}`,
      }),
      200,
    );

    const comment = requireOk(
      await client.request<unknown>({
        kind: "comment.create",
        workspaceId: worker.workspaceId,
        taskId,
        body: `Simulation comment ${options.runId} / worker ${index} / iteration ${iteration}`,
      }),
      201,
    );
    worker.commentIds.push(requireEntityId(comment));
    worker.stats.comments += 1;
    await store.updateWorker(worker);

    if (iteration <= FREE_DECISION_LIMIT) {
      const decision = requireOk(
        await client.request<unknown>({
          kind: "decision.create",
          workspaceId: worker.workspaceId,
          taskId,
          markdown: `# Decision ${iteration}\n\nRun ${options.runId}, worker ${index}. Outcome: proceed with local simulation.`,
        }),
        201,
      );
      worker.decisionIds.push(requireEntityId(decision));
      worker.stats.decisions += 1;
      await store.updateWorker(worker);
    }

    const document = requireOk(
      await client.request<unknown>({
        kind: "document.create",
        workspaceId: worker.workspaceId,
        title: `[${options.runId}] document ${index}-${iteration}`,
        markdown: `Local simulation document for worker ${index}, iteration ${iteration}.`,
      }),
      201,
    );
    worker.documentIds.push(requireEntityId(document));
    worker.stats.documents += 1;
    await store.updateWorker(worker);

    const announcement = requireOk(
      await client.request<unknown>({
        kind: "announcement.create",
        workspaceId: worker.workspaceId,
        title: `[${options.runId}] announcement ${index}-${iteration}`,
        content: `Local simulation announcement for worker ${index}, iteration ${iteration}.`,
        type: iteration % 2 === 0 ? "warning" : "info",
      }),
      201,
    );
    worker.announcementIds.push(requireEntityId(announcement));
    worker.stats.announcements += 1;
    await store.updateWorker(worker);

    requireOk(await client.request({ kind: "tasks.list", workspaceId: worker.workspaceId }), 200);
    worker.stats.requests = client.requests;
    await store.updateWorker(worker);
  }

  await verifyWorkerCounts(pool, worker);
  worker.stats.requests = client.requests;
  await store.updateWorker(worker);
}

export async function runWithConcurrency(
  count: number,
  concurrency: number,
  worker: (index: number) => Promise<void>,
): Promise<void> {
  let nextIndex = 0;
  const results = await Promise.allSettled(
    Array.from({ length: concurrency }, async () => {
      while (nextIndex < count) {
        const index = nextIndex;
        nextIndex += 1;
        await worker(index);
      }
    }),
  );
  const failure = results.find((result) => result.status === "rejected");
  if (failure?.status === "rejected") throw failure.reason;
}

export async function runSimulation(options: RunOptions): Promise<SimulationManifest> {
  validateRunId(options.runId);
  validateDatabaseUrl(options.databaseUrl, options.runId);
  new SimulationClient(options.apiUrl);
  if (!Number.isInteger(options.workers) || options.workers < 1 || options.workers > MAX_WORKERS) {
    throw new Error(`workers must be between 1 and ${MAX_WORKERS}`);
  }
  if (
    !Number.isInteger(options.iterations) ||
    options.iterations < 1 ||
    options.iterations > MAX_ITERATIONS
  ) {
    throw new Error(`iterations must be between 1 and ${MAX_ITERATIONS}`);
  }
  if (
    !Number.isInteger(options.concurrency) ||
    options.concurrency < 1 ||
    options.concurrency > options.workers
  ) {
    throw new Error("concurrency must be between 1 and workers");
  }

  const now = new Date().toISOString();
  const store = new ManifestStore(options.manifestPath, {
    version: 1,
    runId: options.runId,
    databaseName: `corps_sim_${options.runId}`,
    apiUrl: new URL(options.apiUrl).origin,
    createdAt: now,
    updatedAt: now,
    status: "running",
    expectedWorkers: options.workers,
    workers: [],
    totals: emptyStats(),
  });
  await store.update(() => undefined);

  const pool = new Pool({
    connectionString: options.databaseUrl,
    max: options.concurrency,
    connectionTimeoutMillis: 5_000,
    query_timeout: 30_000,
  });
  try {
    const roleClient = await pool.connect();
    try {
      await assertDatabaseRole(roleClient, options.databaseUrl, options.runId, "application");
    } finally {
      roleClient.release();
    }

    await runWithConcurrency(options.workers, options.concurrency, async (index) => {
      await runWorker(options, store, pool, index);
    });
    await store.update((manifest) => {
      Object.assign(manifest, finalizeManifest(manifest, options.runId));
    });
  } catch (error) {
    await store.update((manifest) => {
      manifest.status = "failed";
      recalculateTotals(manifest);
    });
    throw error;
  } finally {
    await pool.end();
  }
  return validateManifest(JSON.parse(await readFile(options.manifestPath, "utf8")), options.runId);
}

export async function cleanupSimulation(options: {
  manifestPath: string;
  runId: string;
  ownerUrl: string;
}): Promise<{ runId: string; deletedUsers: number }> {
  validateRunId(options.runId);
  validateDatabaseUrl(options.ownerUrl, options.runId);
  const manifest = validateManifest(
    JSON.parse(await readFile(options.manifestPath, "utf8")),
    options.runId,
    { allowPartial: true },
  );
  if (manifest.cleanup) {
    throw new Error("Simulation manifest already records a completed cleanup");
  }

  const client = new Client({
    connectionString: options.ownerUrl,
    connectionTimeoutMillis: 5_000,
    query_timeout: 30_000,
  });
  await client.connect();
  try {
    await assertDatabaseRole(client, options.ownerUrl, options.runId, "owner");
    const userIds = manifest.workers.map((worker) => worker.userId);
    const workspaceIds = manifest.workers.map((worker) => worker.workspaceId);
    await withClient(client, async () => {
      const locked = await client.query(
        "SELECT id FROM users WHERE id = ANY($1::uuid[]) FOR UPDATE",
        [userIds],
      );
      if (locked.rowCount !== userIds.length)
        throw new Error("Cleanup refused: one or more exact user IDs are missing");

      const owned = await client.query(
        `SELECT u.id AS user_id, u.email, w.id AS workspace_id, w.name AS workspace_name,
          w."owner_id" AS owner_id, m.role
        FROM users u
        JOIN workspaces w ON w."owner_id" = u.id
        JOIN members m ON m."workspace_id" = w.id AND m."user_id" = u.id
        WHERE u.id = ANY($1::uuid[])`,
        [userIds],
      );
      if (owned.rowCount !== manifest.workers.length) {
        throw new Error(
          "Cleanup refused: exact IDs own unexpected or missing workspaces/memberships",
        );
      }
      const byUser = new Map(owned.rows.map((row) => [row.user_id as string, row]));
      for (const worker of manifest.workers) {
        const row = byUser.get(worker.userId);
        if (
          !row ||
          row.email !== worker.email ||
          row.workspace_id !== worker.workspaceId ||
          row.workspace_name !== worker.workspaceName ||
          row.owner_id !== worker.userId ||
          row.role !== "owner"
        ) {
          throw new Error(
            `Cleanup refused: worker ${worker.index} ID ownership does not match the manifest`,
          );
        }
      }

      const deleted = await client.query("DELETE FROM users WHERE id = ANY($1::uuid[])", [userIds]);
      if (deleted.rowCount !== userIds.length)
        throw new Error("Cleanup deleted an unexpected number of users");
      const remaining = await client.query(
        `SELECT
          (SELECT count(*) FROM users WHERE id = ANY($1::uuid[])) AS users,
          (SELECT count(*) FROM workspaces WHERE id = ANY($2::uuid[])) AS workspaces,
          (SELECT count(*) FROM members WHERE "workspace_id" = ANY($2::uuid[]) OR "user_id" = ANY($1::uuid[])) AS members,
          (SELECT count(*) FROM sessions WHERE "user_id" = ANY($1::uuid[])) AS sessions,
          (SELECT count(*) FROM accounts WHERE "user_id" = ANY($1::uuid[])) AS accounts,
          (SELECT count(*) FROM tasks WHERE "workspace_id" = ANY($2::uuid[])) AS tasks,
          (SELECT count(*) FROM comments WHERE "workspace_id" = ANY($2::uuid[])) AS comments,
          (SELECT count(*) FROM decisions WHERE "workspace_id" = ANY($2::uuid[])) AS decisions,
          (SELECT count(*) FROM decision_versions WHERE "workspace_id" = ANY($2::uuid[])) AS decision_versions,
          (SELECT count(*) FROM documents WHERE "workspace_id" = ANY($2::uuid[])) AS documents,
          (SELECT count(*) FROM announcements WHERE "workspace_id" = ANY($2::uuid[])) AS announcements,
          (SELECT count(*) FROM notifications WHERE "workspace_id" = ANY($2::uuid[])) AS notifications,
          (SELECT count(*) FROM analytics_events WHERE "workspace_id" = ANY($2::uuid[])) AS analytics_events`,
        [userIds, workspaceIds],
      );
      for (const [table, count] of Object.entries(remaining.rows[0] as Record<string, string>)) {
        if (Number(count) !== 0)
          throw new Error(`Cleanup verification failed: ${table} still has ${count} rows`);
      }
    });

    const store = new ManifestStore(options.manifestPath, manifest);
    await store.update((next) => {
      next.cleanup = { deletedUsers: userIds.length, verifiedAt: new Date().toISOString() };
    });
    return { runId: options.runId, deletedUsers: userIds.length };
  } finally {
    await client.end();
  }
}

function positiveInteger(value: string, label: string, maximum: number): number {
  if (!/^\d+$/.test(value)) throw new Error(`${label} must be an integer`);
  const parsed = Number(value);
  if (parsed < 1 || parsed > maximum) throw new Error(`${label} must be between 1 and ${maximum}`);
  return parsed;
}

function requiredEnvironment(name: string): string {
  const value = process.env[name]?.trim();
  if (!value)
    throw new Error(`${name} is required; no .env or generic environment fallback is used`);
  return value;
}

function parseOptions(argv: string[]) {
  const command = argv[0];
  if (command === "--help" || command === "-h" || !command) return { help: true as const };
  if (command !== "run" && command !== "cleanup") throw new Error("Command must be run or cleanup");
  const values = new Map<string, string>();
  for (let index = 1; index < argv.length; index += 1) {
    const flag = argv[index];
    if (!flag?.startsWith("--")) throw new Error(`Unexpected argument: ${flag ?? ""}`);
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`${flag} requires a value`);
    values.set(flag, value);
    index += 1;
  }
  const allowed =
    command === "run"
      ? new Set(["--run-id", "--workers", "--iterations", "--concurrency", "--manifest"])
      : new Set(["--run-id", "--manifest"]);
  for (const flag of values.keys())
    if (!allowed.has(flag)) throw new Error(`Unsupported option for ${command}: ${flag}`);
  return { help: false as const, command, values };
}

function printHelp() {
  console.info(`Corps API-only subagent simulation

Usage:
  pnpm simulate:subagents run --run-id <id> [--workers 8] [--iterations 12] [--concurrency 4] [--manifest <path>]
  pnpm simulate:subagents cleanup --run-id <id> [--manifest <path>]

Required explicit environment:
  run:     CORPS_SIM_API_URL, CORPS_SIM_DATABASE_URL
  cleanup: CORPS_SIM_OWNER_URL

Safety:
  API and PostgreSQL must be loopback. Database must be corps_sim_<run-id>.
  The server must use RATE_LIMIT_DISABLED=1 and REQUIRE_EMAIL_VERIFICATION=0,
  with no mail, AI, payment, calendar, LiveKit, VAPID or error-webhook configuration.
  Manifests contain IDs and counts only; cleanup deletes only exact manifest user IDs.
  No .env, DATABASE_URL, DATABASE_OWNER_URL or TEST_BASE_URL fallback is used.`);
}

async function main() {
  const parsed = parseOptions(process.argv.slice(2));
  if (parsed.help) {
    printHelp();
    return;
  }
  const runId = validateRunId(
    parsed.values.get("--run-id") ??
      `${new Date().toISOString().slice(0, 19).replace(/[-:T]/g, "").toLowerCase()}-${randomUUID().slice(0, 6)}`,
  );
  const manifestPath = path.resolve(
    parsed.values.get("--manifest") ?? path.join(".simulation-runs", `${runId}.json`),
  );
  if (parsed.command === "cleanup") {
    const result = await cleanupSimulation({
      manifestPath,
      runId,
      ownerUrl: requiredEnvironment("CORPS_SIM_OWNER_URL"),
    });
    console.info(JSON.stringify(result));
    return;
  }

  const workers = positiveInteger(parsed.values.get("--workers") ?? "8", "workers", MAX_WORKERS);
  const iterations = positiveInteger(
    parsed.values.get("--iterations") ?? "12",
    "iterations",
    MAX_ITERATIONS,
  );
  const concurrency = positiveInteger(
    parsed.values.get("--concurrency") ?? String(Math.min(4, workers)),
    "concurrency",
    workers,
  );
  const apiUrl = requiredEnvironment("CORPS_SIM_API_URL");
  const databaseUrl = requiredEnvironment("CORPS_SIM_DATABASE_URL");
  assertSafeEnvironment(process.env);
  const result = await runSimulation({
    runId,
    workers,
    iterations,
    concurrency,
    apiUrl,
    databaseUrl,
    manifestPath,
  });
  console.info(
    JSON.stringify({ runId, manifestPath, workers: result.workers.length, totals: result.totals }),
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : "Simulation failed");
    process.exitCode = 1;
  });
}
