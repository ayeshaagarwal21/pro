import "./lib/error-capture";

import { consumeLastCapturedError } from "./lib/error-capture";
import { renderErrorPage } from "./lib/error-page";

type ServerEntry = {
  fetch: (request: Request, env: unknown, ctx: unknown) => Promise<Response> | Response;
};

let serverEntryPromise: Promise<ServerEntry> | undefined;

type D1Result<T = unknown> = {
  results?: T[];
  success: boolean;
  meta?: unknown;
};

type D1PreparedStatement = {
  bind: (...values: unknown[]) => D1PreparedStatement;
  first: <T = unknown>(column?: string) => Promise<T | null>;
  all: <T = unknown>() => Promise<D1Result<T>>;
  run: () => Promise<D1Result>;
};

type D1Database = {
  prepare: (query: string) => D1PreparedStatement;
  exec: (query: string) => Promise<D1Result>;
};

type Env = {
  GEMINI_API_KEY?: string;
  SESSION_SECRET?: string;
  PRIORA_DB?: D1Database;
  priora_db?: D1Database;
  DB?: D1Database;
};

type LocalStore = {
  users: Map<string, DbUser>;
  tasks: Map<string, DbTask>;
};

type DbUser = {
  id: string;
  name: string;
  email: string;
  password_hash: string;
  created_at: string;
};

type DbTask = {
  id: string;
  user_id: string;
  title: string;
  description: string;
  status: "active" | "completed";
  priority: number;
  due_date: string | null;
  score: number;
  minutes: number;
  energy: "Low" | "Medium" | "High";
  due: string;
  accent: "rose" | "gold" | "jade" | "violet" | "amber";
  executable_json: string | null;
  icon_key: "file" | "mail" | "wand" | "card" | "chart" | "calendar";
  scheduled_at: string;
  notified10: number;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
};

const SESSION_COOKIE = "priora_session";
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30;
let schemaReady = false;
let warnedAboutLocalDb = false;

function asEnv(env: unknown): Env {
  if (env && typeof env === "object") return env as Env;
  const globalEnv = (globalThis as { __env__?: unknown }).__env__;
  return (globalEnv && typeof globalEnv === "object" ? globalEnv : {}) as Env;
}

function json(data: unknown, init?: ResponseInit): Response {
  return Response.json(data, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
}

function getDb(env: unknown): D1Database | null {
  const bindings = asEnv(env);
  return bindings.PRIORA_DB ?? bindings.priora_db ?? bindings.DB ?? getLocalDb();
}

function hasConfiguredDb(env: unknown): boolean {
  const bindings = asEnv(env);
  return !!(bindings.PRIORA_DB ?? bindings.priora_db ?? bindings.DB);
}

function displayNameFromEmail(email: string): string {
  const local = email.split("@")[0] || "Priora User";
  return local
    .replace(/[._-]+/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase())
    .trim();
}

function getLocalStore(): LocalStore {
  const global = globalThis as { __prioraLocalStore?: LocalStore };
  if (!global.__prioraLocalStore) {
    global.__prioraLocalStore = {
      users: new Map(),
      tasks: new Map(),
    };
  }
  return global.__prioraLocalStore;
}

function getLocalDb(): D1Database {
  if (!warnedAboutLocalDb) {
    console.warn("Cloudflare D1 binding not found. Using Priora's local in-memory database.");
    warnedAboutLocalDb = true;
  }

  return {
    prepare: (query) => createLocalStatement(query, []),
    exec: async () => ({ success: true }),
  };
}

function createLocalStatement(query: string, values: unknown[]): D1PreparedStatement {
  return {
    bind: (...nextValues) => createLocalStatement(query, nextValues),
    first: async <T = unknown>(column?: string) => {
      const rows = await runLocalSelect<T>(query, values);
      const first = rows[0] ?? null;
      if (first && column) return (first as Record<string, unknown>)[column] as T;
      return first;
    },
    all: async <T = unknown>() => ({ success: true, results: await runLocalSelect<T>(query, values) }),
    run: async () => {
      runLocalMutation(query, values);
      return { success: true };
    },
  };
}

function normalizedQuery(query: string): string {
  return query.replace(/\s+/g, " ").trim().toLowerCase();
}

async function runLocalSelect<T>(query: string, values: unknown[]): Promise<T[]> {
  const store = getLocalStore();
  const sql = normalizedQuery(query);

  if (sql === "select id from users where email = ?") {
    const email = String(values[0]);
    const user = [...store.users.values()].find((row) => row.email === email);
    return (user ? [{ id: user.id }] : []) as T[];
  }

  if (sql === "select * from users where email = ?") {
    const email = String(values[0]);
    const user = [...store.users.values()].find((row) => row.email === email);
    return (user ? [user] : []) as T[];
  }

  if (sql === "select * from users where id = ?") {
    const user = store.users.get(String(values[0]));
    return (user ? [user] : []) as T[];
  }

  if (sql === "select * from tasks where user_id = ? order by created_at asc") {
    const userId = String(values[0]);
    return [...store.tasks.values()]
      .filter((row) => row.user_id === userId)
      .sort((a, b) => a.created_at.localeCompare(b.created_at)) as T[];
  }

  if (sql === "select * from tasks where id = ? and user_id = ?") {
    const task = store.tasks.get(String(values[0]));
    return (task && task.user_id === String(values[1]) ? [task] : []) as T[];
  }

  return [];
}

function runLocalMutation(query: string, values: unknown[]): void {
  const store = getLocalStore();
  const sql = normalizedQuery(query);
  if (sql.startsWith("create table") || sql.startsWith("create index")) return;

  if (sql.startsWith("insert into users")) {
    const [id, name, email, passwordHash, createdAt] = values.map(String);
    store.users.set(id, {
      id,
      name,
      email,
      password_hash: passwordHash,
      created_at: createdAt,
    });
    return;
  }

  if (sql.startsWith("insert into tasks")) {
    const [
      id,
      userId,
      title,
      description,
      status,
      priority,
      dueDate,
      score,
      minutes,
      energy,
      due,
      accent,
      executableJson,
      iconKey,
      scheduledAt,
      notified10,
      createdAt,
      updatedAt,
      completedAt,
    ] = values;
    store.tasks.set(String(id), {
      id: String(id),
      user_id: String(userId),
      title: String(title),
      description: String(description),
      status: taskStatus(status),
      priority: Number(priority),
      due_date: dueDate === null ? null : String(dueDate),
      score: Number(score),
      minutes: Number(minutes),
      energy: taskEnergy(energy),
      due: String(due),
      accent: taskAccent(accent),
      executable_json: executableJson === null ? null : String(executableJson),
      icon_key: taskIcon(iconKey),
      scheduled_at: String(scheduledAt),
      notified10: Number(notified10),
      created_at: String(createdAt),
      updated_at: String(updatedAt),
      completed_at: completedAt === null ? null : String(completedAt),
    });
    return;
  }

  if (sql.startsWith("update tasks set")) {
    const taskId = String(values[16]);
    const userId = String(values[17]);
    const existing = store.tasks.get(taskId);
    if (!existing || existing.user_id !== userId) return;

    const [
      title,
      description,
      status,
      priority,
      dueDate,
      score,
      minutes,
      energy,
      due,
      accent,
      executableJson,
      iconKey,
      scheduledAt,
      notified10,
      updatedAt,
      completedAt,
    ] = values;
    store.tasks.set(taskId, {
      ...existing,
      title: String(title),
      description: String(description),
      status: taskStatus(status),
      priority: Number(priority),
      due_date: dueDate === null ? null : String(dueDate),
      score: Number(score),
      minutes: Number(minutes),
      energy: taskEnergy(energy),
      due: String(due),
      accent: taskAccent(accent),
      executable_json: executableJson === null ? null : String(executableJson),
      icon_key: taskIcon(iconKey),
      scheduled_at: String(scheduledAt),
      notified10: Number(notified10),
      updated_at: String(updatedAt),
      completed_at: completedAt === null ? null : String(completedAt),
    });
    return;
  }

  if (sql === "update users set password_hash = ? where email = ?") {
    const passwordHash = String(values[0]);
    const email = String(values[1]);
    const user = [...store.users.values()].find((row) => row.email === email);
    if (user) {
      store.users.set(user.id, { ...user, password_hash: passwordHash });
    }
    return;
  }

  if (sql === "delete from tasks where id = ? and user_id = ?") {
    const task = store.tasks.get(String(values[0]));
    if (task?.user_id === String(values[1])) store.tasks.delete(String(values[0]));
  }
}

async function ensureSchema(db: D1Database): Promise<void> {
  if (schemaReady) return;
  const statements = [
    `CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      created_at TEXT NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'active',
      priority INTEGER NOT NULL DEFAULT 0,
      due_date TEXT,
      score INTEGER NOT NULL DEFAULT 0,
      minutes INTEGER NOT NULL DEFAULT 15,
      energy TEXT NOT NULL DEFAULT 'Medium',
      due TEXT NOT NULL DEFAULT 'Soon',
      accent TEXT NOT NULL DEFAULT 'violet',
      executable_json TEXT,
      icon_key TEXT NOT NULL DEFAULT 'file',
      scheduled_at TEXT NOT NULL,
      notified10 INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      completed_at TEXT,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )`,
    "CREATE INDEX IF NOT EXISTS idx_tasks_user_id ON tasks(user_id)",
    "CREATE INDEX IF NOT EXISTS idx_tasks_user_status ON tasks(user_id, status)",
    "CREATE INDEX IF NOT EXISTS idx_tasks_user_updated ON tasks(user_id, updated_at)",
  ];
  for (const statement of statements) {
    await db.prepare(statement).run();
  }
  schemaReady = true;
}

async function withDb(env: unknown): Promise<D1Database | Response> {
  const db = getDb(env);
  if (!db) {
    return json(
      { error: "Database is not configured. Add a Cloudflare D1 binding named priora_db." },
      { status: 503 },
    );
  }
  await ensureSchema(db);
  return db;
}

function publicUser(user: DbUser) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    createdAt: user.created_at,
  };
}

function mapTask(row: DbTask) {
  return {
    id: row.id,
    userId: row.user_id,
    title: row.title,
    description: row.description,
    status: row.status,
    priority: row.priority,
    dueDate: row.due_date,
    score: row.score,
    minutes: row.minutes,
    energy: row.energy,
    due: row.due,
    accent: row.accent,
    executable: row.executable_json ? JSON.parse(row.executable_json) : undefined,
    iconKey: row.icon_key,
    scheduledAt: row.scheduled_at,
    notified10: row.notified10 === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    completedAt: row.completed_at ?? undefined,
  };
}

function base64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function base64UrlToBytes(value: string): Uint8Array {
  const padded = value
    .replace(/-/g, "+")
    .replace(/_/g, "/")
    .padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = atob(padded);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

async function hmac(secret: string, value: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, encoder.encode(value));
  return base64Url(new Uint8Array(sig));
}

function sessionSecret(env: unknown): string {
  return asEnv(env).SESSION_SECRET || asEnv(env).GEMINI_API_KEY || "priora-local-dev-secret";
}

async function createSession(userId: string, env: unknown): Promise<string> {
  const payload = base64Url(
    new TextEncoder().encode(
      JSON.stringify({ sub: userId, exp: Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS }),
    ),
  );
  return `${payload}.${await hmac(sessionSecret(env), payload)}`;
}

async function verifySession(token: string | null, env: unknown): Promise<string | null> {
  if (!token) return null;
  const [payload, signature] = token.split(".");
  if (!payload || !signature) return null;
  if ((await hmac(sessionSecret(env), payload)) !== signature) return null;

  try {
    const data = JSON.parse(new TextDecoder().decode(base64UrlToBytes(payload))) as {
      sub?: string;
      exp?: number;
    };
    if (!data.sub || !data.exp || data.exp < Math.floor(Date.now() / 1000)) return null;
    return data.sub;
  } catch {
    return null;
  }
}

function parseCookies(request: Request): Record<string, string> {
  const header = request.headers.get("cookie") ?? "";
  return Object.fromEntries(
    header
      .split(";")
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => {
        const idx = part.indexOf("=");
        return [part.slice(0, idx), decodeURIComponent(part.slice(idx + 1))];
      }),
  );
}

function sessionCookie(request: Request, token: string): string {
  const secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";
  return `${SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; Max-Age=${SESSION_TTL_SECONDS}; HttpOnly; SameSite=Lax${secure}`;
}

function clearSessionCookie(): string {
  return `${SESSION_COOKIE}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax`;
}

async function hashPassword(password: string, salt = crypto.getRandomValues(new Uint8Array(16))) {
  const encoder = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    encoder.encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const iterations = 120000;
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt, iterations, hash: "SHA-256" },
    keyMaterial,
    256,
  );
  return `pbkdf2$${iterations}$${base64Url(salt)}$${base64Url(new Uint8Array(bits))}`;
}

async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [, iterationsRaw, saltRaw, hashRaw] = stored.split("$");
  const salt = base64UrlToBytes(saltRaw);
  const candidate = await hashPassword(password, salt);
  return candidate === `pbkdf2$${iterationsRaw}$${saltRaw}$${hashRaw}`;
}

async function currentUser(request: Request, env: unknown, db: D1Database): Promise<DbUser | null> {
  const userId = await verifySession(parseCookies(request)[SESSION_COOKIE] ?? null, env);
  if (!userId) return null;
  return db.prepare("SELECT * FROM users WHERE id = ?").bind(userId).first<DbUser>();
}

async function requireUser(
  request: Request,
  env: unknown,
  db: D1Database,
): Promise<DbUser | Response> {
  const user = await currentUser(request, env, db);
  return user ?? json({ error: "Authentication required." }, { status: 401 });
}

async function handleAuthApi(request: Request, env: unknown, pathname: string): Promise<Response> {
  const dbOrResponse = await withDb(env);
  if (dbOrResponse instanceof Response) return dbOrResponse;
  const db = dbOrResponse;

  if (pathname === "/api/auth/register" && request.method === "POST") {
    const body = (await request.json().catch(() => null)) as {
      name?: string;
      email?: string;
      password?: string;
    } | null;
    const name = body?.name?.trim();
    const email = body?.email?.trim().toLowerCase();
    const password = body?.password ?? "";
    if (!name || !email || !/^\S+@\S+\.\S+$/.test(email) || password.length < 6) {
      return json(
        { error: "Enter a valid name, email, and 6+ character password." },
        { status: 400 },
      );
    }

    const existing = await db.prepare("SELECT id FROM users WHERE email = ?").bind(email).first();
    if (existing) {
      return json({ error: "An account already exists for this email." }, { status: 409 });
    }

    const now = new Date().toISOString();
    const user: DbUser = {
      id: crypto.randomUUID(),
      name,
      email,
      password_hash: await hashPassword(password),
      created_at: now,
    };
    await db
      .prepare(
        "INSERT INTO users (id, name, email, password_hash, created_at) VALUES (?, ?, ?, ?, ?)",
      )
      .bind(user.id, user.name, user.email, user.password_hash, user.created_at)
      .run();

    const token = await createSession(user.id, env);
    return json(publicUser(user), {
      status: 201,
      headers: { "set-cookie": sessionCookie(request, token) },
    });
  }

  if (pathname === "/api/auth/login" && request.method === "POST") {
    const body = (await request.json().catch(() => null)) as {
      email?: string;
      password?: string;
    } | null;
    const email = body?.email?.trim().toLowerCase();
    const password = body?.password ?? "";
    if (!email || !password) {
      return json({ error: "Email or password is incorrect." }, { status: 401 });
    }

    const user = await db
      .prepare("SELECT * FROM users WHERE email = ?")
      .bind(email)
      .first<DbUser>();
    const usingLocalRecovery = !hasConfiguredDb(env);
    if (!user && usingLocalRecovery) {
      const now = new Date().toISOString();
      const recoveredUser: DbUser = {
        id: crypto.randomUUID(),
        name: displayNameFromEmail(email),
        email,
        password_hash: await hashPassword(password),
        created_at: now,
      };
      await db
        .prepare(
          "INSERT INTO users (id, name, email, password_hash, created_at) VALUES (?, ?, ?, ?, ?)",
        )
        .bind(
          recoveredUser.id,
          recoveredUser.name,
          recoveredUser.email,
          recoveredUser.password_hash,
          recoveredUser.created_at,
        )
        .run();
      const token = await createSession(recoveredUser.id, env);
      return json(publicUser(recoveredUser), {
        status: 201,
        headers: { "set-cookie": sessionCookie(request, token) },
      });
    }
    if (!user) {
      return json({ error: "Email or password is incorrect." }, { status: 401 });
    }
    const passwordOk = await verifyPassword(password, user.password_hash);
    if (!passwordOk && usingLocalRecovery) {
      const passwordHash = await hashPassword(password);
      await db
        .prepare("UPDATE users SET password_hash = ? WHERE email = ?")
        .bind(passwordHash, email)
        .run();
      const token = await createSession(user.id, env);
      return json(publicUser({ ...user, password_hash: passwordHash }), {
        headers: { "set-cookie": sessionCookie(request, token) },
      });
    }
    if (!passwordOk) return json({ error: "Email or password is incorrect." }, { status: 401 });

    const token = await createSession(user.id, env);
    return json(publicUser(user), { headers: { "set-cookie": sessionCookie(request, token) } });
  }

  if (pathname === "/api/auth/reset-password" && request.method === "POST") {
    const body = (await request.json().catch(() => null)) as {
      email?: string;
      password?: string;
    } | null;
    const email = body?.email?.trim().toLowerCase();
    const password = body?.password ?? "";
    if (!email || !/^\S+@\S+\.\S+$/.test(email) || password.length < 6) {
      return json({ error: "Enter your registered email and a 6+ character password." }, { status: 400 });
    }

    const user = await db.prepare("SELECT * FROM users WHERE email = ?").bind(email).first<DbUser>();
    if (!user) {
      if (hasConfiguredDb(env)) {
        return json({ error: "No account exists for this email." }, { status: 404 });
      }
      const now = new Date().toISOString();
      const recoveredUser: DbUser = {
        id: crypto.randomUUID(),
        name: displayNameFromEmail(email),
        email,
        password_hash: await hashPassword(password),
        created_at: now,
      };
      await db
        .prepare(
          "INSERT INTO users (id, name, email, password_hash, created_at) VALUES (?, ?, ?, ?, ?)",
        )
        .bind(
          recoveredUser.id,
          recoveredUser.name,
          recoveredUser.email,
          recoveredUser.password_hash,
          recoveredUser.created_at,
        )
        .run();
      const token = await createSession(recoveredUser.id, env);
      return json(publicUser(recoveredUser), {
        status: 201,
        headers: { "set-cookie": sessionCookie(request, token) },
      });
    }

    const passwordHash = await hashPassword(password);
    await db.prepare("UPDATE users SET password_hash = ? WHERE email = ?").bind(passwordHash, email).run();
    const token = await createSession(user.id, env);
    return json(publicUser({ ...user, password_hash: passwordHash }), {
      headers: { "set-cookie": sessionCookie(request, token) },
    });
  }

  if (pathname === "/api/auth/me" && request.method === "GET") {
    const user = await requireUser(request, env, db);
    if (user instanceof Response) return user;
    return json(publicUser(user));
  }

  if (pathname === "/api/auth/logout" && request.method === "POST") {
    return json({ ok: true }, { headers: { "set-cookie": clearSessionCookie() } });
  }

  return json({ error: "Not found." }, { status: 404 });
}

function taskStatus(value: unknown): "active" | "completed" {
  return value === "completed" ? "completed" : "active";
}

function taskEnergy(value: unknown): DbTask["energy"] {
  return value === "High" || value === "Low" ? value : "Medium";
}

function taskAccent(value: unknown): DbTask["accent"] {
  return value === "rose" || value === "gold" || value === "jade" || value === "amber"
    ? value
    : "violet";
}

function taskIcon(value: unknown): DbTask["icon_key"] {
  return value === "mail" ||
    value === "wand" ||
    value === "card" ||
    value === "chart" ||
    value === "calendar"
    ? value
    : "file";
}

async function handleTasksApi(request: Request, env: unknown, pathname: string): Promise<Response> {
  const dbOrResponse = await withDb(env);
  if (dbOrResponse instanceof Response) return dbOrResponse;
  const db = dbOrResponse;

  const user = await requireUser(request, env, db);
  if (user instanceof Response) return user;

  if (pathname === "/api/tasks" && request.method === "GET") {
    const rows = await db
      .prepare("SELECT * FROM tasks WHERE user_id = ? ORDER BY created_at ASC")
      .bind(user.id)
      .all<DbTask>();
    return json((rows.results ?? []).map(mapTask));
  }

  if (pathname === "/api/tasks" && request.method === "POST") {
    const body = (await request.json().catch(() => null)) as {
      tasks?: Record<string, unknown>[];
    } | null;
    const inputs = body?.tasks;
    if (!Array.isArray(inputs) || !inputs.length) {
      return json({ error: "No tasks provided." }, { status: 400 });
    }

    const created: DbTask[] = [];
    for (const input of inputs) {
      const now = new Date().toISOString();
      const status = taskStatus(input.status);
      const row: DbTask = {
        id: crypto.randomUUID(),
        user_id: user.id,
        title: String(input.title ?? "").trim(),
        description: String(input.description ?? "").trim(),
        status,
        priority: Number(input.priority ?? input.score ?? 0),
        due_date: typeof input.dueDate === "string" ? input.dueDate : null,
        score: Number(input.score ?? input.priority ?? 0),
        minutes: Number(input.minutes ?? 15),
        energy: taskEnergy(input.energy),
        due: String(input.due ?? "Soon"),
        accent: taskAccent(input.accent),
        executable_json: input.executable ? JSON.stringify(input.executable) : null,
        icon_key: taskIcon(input.iconKey),
        scheduled_at:
          typeof input.scheduledAt === "string" ? input.scheduledAt : new Date().toISOString(),
        notified10: input.notified10 ? 1 : 0,
        created_at: now,
        updated_at: now,
        completed_at: status === "completed" ? now : null,
      };
      if (!row.title) return json({ error: "Task title is required." }, { status: 400 });

      await db
        .prepare(
          `INSERT INTO tasks (
            id, user_id, title, description, status, priority, due_date, score, minutes, energy,
            due, accent, executable_json, icon_key, scheduled_at, notified10, created_at, updated_at, completed_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          row.id,
          row.user_id,
          row.title,
          row.description,
          row.status,
          row.priority,
          row.due_date,
          row.score,
          row.minutes,
          row.energy,
          row.due,
          row.accent,
          row.executable_json,
          row.icon_key,
          row.scheduled_at,
          row.notified10,
          row.created_at,
          row.updated_at,
          row.completed_at,
        )
        .run();
      created.push(row);
    }
    return json(created.map(mapTask), { status: 201 });
  }

  const taskIdMatch = /^\/api\/tasks\/([^/]+)$/.exec(pathname);
  if (taskIdMatch && request.method === "PATCH") {
    const taskId = decodeURIComponent(taskIdMatch[1]);
    const existing = await db
      .prepare("SELECT * FROM tasks WHERE id = ? AND user_id = ?")
      .bind(taskId, user.id)
      .first<DbTask>();
    if (!existing) return json({ error: "Task not found." }, { status: 404 });

    const patch = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    if (!patch) return json({ error: "Invalid task update." }, { status: 400 });

    const next: DbTask = {
      ...existing,
      title: patch.title === undefined ? existing.title : String(patch.title).trim(),
      description:
        patch.description === undefined ? existing.description : String(patch.description).trim(),
      status: patch.status === undefined ? existing.status : taskStatus(patch.status),
      priority: patch.priority === undefined ? existing.priority : Number(patch.priority),
      due_date:
        patch.dueDate === undefined
          ? existing.due_date
          : typeof patch.dueDate === "string"
            ? patch.dueDate
            : null,
      score: patch.score === undefined ? existing.score : Number(patch.score),
      minutes: patch.minutes === undefined ? existing.minutes : Number(patch.minutes),
      energy: patch.energy === undefined ? existing.energy : taskEnergy(patch.energy),
      due: patch.due === undefined ? existing.due : String(patch.due),
      accent: patch.accent === undefined ? existing.accent : taskAccent(patch.accent),
      executable_json:
        patch.executable === undefined
          ? existing.executable_json
          : patch.executable
            ? JSON.stringify(patch.executable)
            : null,
      icon_key: patch.iconKey === undefined ? existing.icon_key : taskIcon(patch.iconKey),
      scheduled_at:
        patch.scheduledAt === undefined ? existing.scheduled_at : String(patch.scheduledAt),
      notified10: patch.notified10 === undefined ? existing.notified10 : patch.notified10 ? 1 : 0,
      completed_at:
        patch.completedAt === undefined
          ? patch.status === "completed" && !existing.completed_at
            ? new Date().toISOString()
            : existing.completed_at
          : typeof patch.completedAt === "string"
            ? patch.completedAt
            : null,
      updated_at: new Date().toISOString(),
    };
    if (!next.title) return json({ error: "Task title is required." }, { status: 400 });

    await db
      .prepare(
        `UPDATE tasks SET
          title = ?, description = ?, status = ?, priority = ?, due_date = ?, score = ?,
          minutes = ?, energy = ?, due = ?, accent = ?, executable_json = ?, icon_key = ?,
          scheduled_at = ?, notified10 = ?, updated_at = ?, completed_at = ?
        WHERE id = ? AND user_id = ?`,
      )
      .bind(
        next.title,
        next.description,
        next.status,
        next.priority,
        next.due_date,
        next.score,
        next.minutes,
        next.energy,
        next.due,
        next.accent,
        next.executable_json,
        next.icon_key,
        next.scheduled_at,
        next.notified10,
        next.updated_at,
        next.completed_at,
        taskId,
        user.id,
      )
      .run();

    return json(next ? mapTask(next) : null);
  }

  if (taskIdMatch && request.method === "DELETE") {
    const taskId = decodeURIComponent(taskIdMatch[1]);
    await db.prepare("DELETE FROM tasks WHERE id = ? AND user_id = ?").bind(taskId, user.id).run();
    return json({ ok: true });
  }

  return json({ error: "Not found." }, { status: 404 });
}

const GEMINI_MODELS = ["gemini-2.5-flash", "gemini-2.0-flash", "gemini-flash-latest"];

const taskSchema = {
  type: "ARRAY",
  items: {
    type: "OBJECT",
    properties: {
      title: { type: "STRING", description: "Cleaned-up task name" },
      urgencyScore: { type: "NUMBER", description: "Urgency from 1-10" },
      estimatedMinutes: { type: "NUMBER", description: "Estimated minutes to complete" },
      energyLevel: { type: "STRING", description: "High, Medium, or Low" },
      scheduledTime: {
        type: "STRING",
        description: "Explicit requested start time in 24-hour HH:MM format, or empty if none",
      },
    },
    required: ["title", "urgencyScore", "estimatedMinutes", "energyLevel"],
  },
};

function readGeminiKey(env: unknown): string | null {
  if (env && typeof env === "object") {
    const vars = env as Record<string, unknown>;
    const value = vars.GEMINI_API_KEY ?? vars.VITE_GEMINI_API_KEY;
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  const value = process.env.GEMINI_API_KEY ?? process.env.VITE_GEMINI_API_KEY;
  return value?.trim() || null;
}

function isStatus(err: unknown, code: number): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return new RegExp(`\\b${code}\\b`).test(msg);
}

function isModelUnavailable(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return (
    isStatus(err, 404) || /not found|not supported.*generateContent|model.*unavailable/i.test(msg)
  );
}

async function handleGeminiApi(request: Request, env: unknown): Promise<Response> {
  const key = readGeminiKey(env);
  if (!key) {
    return Response.json(
      {
        error:
          "Gemini is not configured on the server. Add GEMINI_API_KEY or VITE_GEMINI_API_KEY in the backend.",
      },
      { status: 503 },
    );
  }

  const body = (await request.json().catch(() => null)) as {
    prompt?: string;
    json?: boolean;
  } | null;
  if (!body?.prompt?.trim()) {
    return Response.json({ error: "Missing prompt." }, { status: 400 });
  }

  const { GoogleGenAI } = await import("@google/genai");
  const genAI = new GoogleGenAI({ apiKey: key });
  let lastError: unknown;

  for (const modelName of GEMINI_MODELS) {
    try {
      const result = await genAI.models.generateContent({
        model: modelName,
        contents: body.prompt,
        config: body.json
          ? ({
              responseMimeType: "application/json",
              responseSchema: taskSchema,
            } as {
              responseMimeType: "application/json";
              responseSchema: unknown;
            })
          : undefined,
      });
      return Response.json({ text: result.text ?? "" });
    } catch (error) {
      lastError = error;
      if (!isModelUnavailable(error)) {
        const message = error instanceof Error ? error.message : "Gemini request failed.";
        return Response.json({ error: message }, { status: isStatus(error, 503) ? 503 : 502 });
      }
    }
  }

  console.error(lastError);
  return Response.json({ error: "Gemini model access failed on the server." }, { status: 502 });
}

async function getServerEntry(): Promise<ServerEntry> {
  if (!serverEntryPromise) {
    serverEntryPromise = import("@tanstack/react-start/server-entry").then(
      (m) => (m.default ?? m) as ServerEntry,
    );
  }
  return serverEntryPromise;
}

// h3 swallows in-handler throws into a normal 500 Response with body
// {"unhandled":true,"message":"HTTPError"} — try/catch alone never fires for those.
async function normalizeCatastrophicSsrResponse(response: Response): Promise<Response> {
  if (response.status < 500) return response;
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) return response;

  const body = await response.clone().text();
  if (!body.includes('"unhandled":true') || !body.includes('"message":"HTTPError"')) {
    return response;
  }

  console.error(consumeLastCapturedError() ?? new Error(`h3 swallowed SSR error: ${body}`));
  return new Response(renderErrorPage(), {
    status: 500,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

export default {
  async fetch(request: Request, env: unknown, ctx: unknown) {
    try {
      const url = new URL(request.url);
      if (url.pathname.startsWith("/api/auth/")) {
        return await handleAuthApi(request, env, url.pathname);
      }
      if (url.pathname === "/api/tasks" || url.pathname.startsWith("/api/tasks/")) {
        return await handleTasksApi(request, env, url.pathname);
      }
      if (url.pathname === "/api/gemini" && request.method === "POST") {
        return await handleGeminiApi(request, env);
      }

      const handler = await getServerEntry();
      const response = await handler.fetch(request, env, ctx);
      return await normalizeCatastrophicSsrResponse(response);
    } catch (error) {
      console.error(error);
      return new Response(renderErrorPage(), {
        status: 500,
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    }
  },
};
