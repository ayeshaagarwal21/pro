export type PrioraUser = {
  name: string;
  email: string;
  passwordHash: string;
  salt: string;
};

export type RegisterInput = {
  name: string;
  email: string;
  password: string;
};

const USERS_STORAGE = "priora:users";
const SESSION_STORAGE = "priora:session-email";

function readUsers(): PrioraUser[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(USERS_STORAGE);
    return raw ? (JSON.parse(raw) as PrioraUser[]) : [];
  } catch {
    return [];
  }
}

function writeUsers(users: PrioraUser[]) {
  window.localStorage.setItem(USERS_STORAGE, JSON.stringify(users));
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return window.btoa(binary);
}

function base64ToBytes(value: string): Uint8Array {
  const binary = window.atob(value);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

async function hashPassword(password: string, salt: Uint8Array): Promise<string> {
  if (!window.crypto?.subtle) {
    throw new Error("Secure credential storage is not supported in this browser.");
  }

  const encoder = new TextEncoder();
  const keyMaterial = await window.crypto.subtle.importKey(
    "raw",
    encoder.encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = await window.crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      salt,
      iterations: 120000,
      hash: "SHA-256",
    },
    keyMaterial,
    256,
  );

  return bytesToBase64(new Uint8Array(bits));
}

export async function registerUser(input: RegisterInput): Promise<PrioraUser> {
  const users = readUsers();
  const email = input.email.trim().toLowerCase();
  if (users.some((saved) => saved.email.toLowerCase() === email)) {
    throw new Error("An account already exists for this email.");
  }

  const salt = window.crypto.getRandomValues(new Uint8Array(16));
  const user: PrioraUser = {
    name: input.name.trim(),
    email,
    salt: bytesToBase64(salt),
    passwordHash: await hashPassword(input.password, salt),
  };

  writeUsers([...users, user]);
  return user;
}

export async function loginUser(email: string, password: string): Promise<PrioraUser> {
  const normalizedEmail = email.trim().toLowerCase();
  const user = readUsers().find((saved) => saved.email.toLowerCase() === normalizedEmail);
  if (!user) throw new Error("Email or password is incorrect.");

  const passwordHash = await hashPassword(password, base64ToBytes(user.salt));
  if (passwordHash !== user.passwordHash) {
    throw new Error("Email or password is incorrect.");
  }

  window.localStorage.setItem(SESSION_STORAGE, user.email);
  return user;
}

export function getCurrentUser(): PrioraUser | null {
  if (typeof window === "undefined") return null;
  const email = window.localStorage.getItem(SESSION_STORAGE);
  if (!email) return null;
  return readUsers().find((user) => user.email.toLowerCase() === email.toLowerCase()) ?? null;
}

export function logoutUser() {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(SESSION_STORAGE);
}
