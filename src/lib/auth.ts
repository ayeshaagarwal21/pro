export type PrioraUser = {
  id: string;
  name: string;
  email: string;
  createdAt: string;
};

export type RegisterInput = {
  name: string;
  email: string;
  password: string;
};

async function readJson<T>(response: Response): Promise<T> {
  const payload = (await response.json().catch(() => null)) as { error?: string } | T | null;
  if (!response.ok) {
    throw new Error((payload as { error?: string } | null)?.error ?? "Request failed.");
  }
  return payload as T;
}

export async function registerUser(input: RegisterInput): Promise<PrioraUser> {
  const response = await fetch("/api/auth/register", {
    method: "POST",
    headers: { "content-type": "application/json" },
    credentials: "include",
    body: JSON.stringify(input),
  });
  return readJson<PrioraUser>(response);
}

export async function loginUser(email: string, password: string): Promise<PrioraUser> {
  const response = await fetch("/api/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ email, password }),
  });
  return readJson<PrioraUser>(response);
}

export async function resetPassword(email: string, password: string): Promise<PrioraUser> {
  const response = await fetch("/api/auth/reset-password", {
    method: "POST",
    headers: { "content-type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ email, password }),
  });
  return readJson<PrioraUser>(response);
}

export async function getCurrentUser(): Promise<PrioraUser | null> {
  const response = await fetch("/api/auth/me", {
    credentials: "include",
  });
  if (response.status === 401) return null;
  return readJson<PrioraUser>(response);
}

export async function logoutUser(): Promise<void> {
  const response = await fetch("/api/auth/logout", {
    method: "POST",
    credentials: "include",
  });
  await readJson<{ ok: true }>(response);
}
