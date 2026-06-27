export type StoredTaskRecord = {
  id: string;
  userId: string;
  title: string;
  description: string;
  status: "active" | "completed";
  priority: number;
  dueDate: string | null;
  score: number;
  minutes: number;
  energy: "Low" | "Medium" | "High";
  due: string;
  accent: "rose" | "gold" | "jade" | "violet" | "amber";
  executable?: { kind: "email" | "post" | "plan"; subject?: string; body: string };
  iconKey: "file" | "mail" | "wand" | "card" | "chart" | "calendar";
  scheduledAt: string;
  notified10?: boolean;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
};

export type CreateTaskInput = Omit<
  StoredTaskRecord,
  "id" | "userId" | "createdAt" | "updatedAt" | "completedAt"
> & {
  completedAt?: string;
};

export type UpdateTaskInput = Partial<
  Pick<
    StoredTaskRecord,
    | "title"
    | "description"
    | "status"
    | "priority"
    | "dueDate"
    | "score"
    | "minutes"
    | "energy"
    | "due"
    | "accent"
    | "executable"
    | "iconKey"
    | "scheduledAt"
    | "notified10"
    | "completedAt"
  >
>;

async function readJson<T>(response: Response): Promise<T> {
  const payload = (await response.json().catch(() => null)) as { error?: string } | T | null;
  if (!response.ok) {
    throw new Error((payload as { error?: string } | null)?.error ?? "Request failed.");
  }
  return payload as T;
}

export async function listTasks(): Promise<StoredTaskRecord[]> {
  const response = await fetch("/api/tasks", { credentials: "include" });
  return readJson<StoredTaskRecord[]>(response);
}

export async function createTasks(tasks: CreateTaskInput[]): Promise<StoredTaskRecord[]> {
  const response = await fetch("/api/tasks", {
    method: "POST",
    headers: { "content-type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ tasks }),
  });
  return readJson<StoredTaskRecord[]>(response);
}

export async function updateTask(id: string, patch: UpdateTaskInput): Promise<StoredTaskRecord> {
  const response = await fetch(`/api/tasks/${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    credentials: "include",
    body: JSON.stringify(patch),
  });
  return readJson<StoredTaskRecord>(response);
}

export async function deleteTask(id: string): Promise<{ ok: true }> {
  const response = await fetch(`/api/tasks/${encodeURIComponent(id)}`, {
    method: "DELETE",
    credentials: "include",
  });
  return readJson<{ ok: true }>(response);
}
