import { GoogleGenerativeAI, SchemaType } from "@google/generative-ai";
import { toast } from "sonner";

export type AITask = {
  title: string;
  urgencyScore: number;
  estimatedMinutes: number;
  energyLevel: "High" | "Medium" | "Low";
  scheduledTime?: string;
};

const API_KEY_STORAGE = "priora:gemini-key";
const LEGACY_KEY_STORAGE = "nagrikos:gemini-key";

export function getApiKey(): string | null {
  if (typeof window === "undefined") return null;
  return (
    window.localStorage.getItem(API_KEY_STORAGE) ?? window.localStorage.getItem(LEGACY_KEY_STORAGE)
  );
}

export function setApiKey(key: string) {
  window.localStorage.setItem(API_KEY_STORAGE, key);
}

export function clearApiKey() {
  window.localStorage.removeItem(API_KEY_STORAGE);
  window.localStorage.removeItem(LEGACY_KEY_STORAGE);
}

const MOCK_FALLBACK: AITask[] = [
  {
    title: "Submit design campaign deliverables",
    urgencyScore: 10,
    estimatedMinutes: 90,
    energyLevel: "High",
  },
  {
    title: "Pay internet bill before midnight",
    urgencyScore: 9,
    estimatedMinutes: 10,
    energyLevel: "Low",
  },
  {
    title: "Email professor about quiz clarification",
    urgencyScore: 7,
    estimatedMinutes: 15,
    energyLevel: "Low",
  },
  {
    title: "Draft social post for product launch",
    urgencyScore: 6,
    estimatedMinutes: 30,
    energyLevel: "Medium",
  },
  {
    title: "Review college quiz material for Friday",
    urgencyScore: 5,
    estimatedMinutes: 60,
    energyLevel: "Medium",
  },
  {
    title: "Plan tomorrow's deep-work block",
    urgencyScore: 3,
    estimatedMinutes: 15,
    energyLevel: "Low",
  },
];

const schema = {
  type: SchemaType.ARRAY,
  items: {
    type: SchemaType.OBJECT,
    properties: {
      title: { type: SchemaType.STRING, description: "Cleaned-up task name" },
      urgencyScore: { type: SchemaType.NUMBER, description: "Urgency from 1-10" },
      estimatedMinutes: { type: SchemaType.NUMBER, description: "Estimated minutes to complete" },
      energyLevel: { type: SchemaType.STRING, description: "High, Medium, or Low" },
      scheduledTime: {
        type: SchemaType.STRING,
        description: "Explicit requested start time in 24-hour HH:MM format, or empty if none",
      },
    },
    required: ["title", "urgencyScore", "estimatedMinutes", "energyLevel"],
  },
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const GEMINI_MODELS = ["gemini-3.5-flash", "gemini-flash-latest", "gemini-2.5-flash"];

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
function is503(err: unknown): boolean {
  if (isStatus(err, 503)) return true;
  const msg = err instanceof Error ? err.message : String(err);
  return /UNAVAILABLE|overloaded|high demand/i.test(msg);
}

function parseLooseJson<T = unknown>(raw: string): T {
  const trimmed = raw
    .trim()
    .replace(/^```(?:json)?/i, "")
    .replace(/```$/i, "")
    .trim();
  try {
    return JSON.parse(trimmed) as T;
  } catch {
    // try to find a JSON block inside the text
    const match = trimmed.match(/(?:\[|\{)[\s\S]*(?:\]|\})/);
    if (match) return JSON.parse(match[0]) as T;
    throw new Error("Gemini returned unparseable output.");
  }
}

async function generateWithFallback(
  prompt: string,
  opts: { json?: boolean } = {},
): Promise<string> {
  const key = getApiKey();
  if (!key) throw new Error("Missing Gemini API key. Add it in Settings.");
  const genAI = new GoogleGenerativeAI(key);

  let lastError: unknown;
  for (const modelName of GEMINI_MODELS) {
    try {
      const model = genAI.getGenerativeModel({
        model: modelName,
        generationConfig: opts.json
          ? ({ responseMimeType: "application/json", responseSchema: schema } as never)
          : {},
      });
      const res = await model.generateContent(prompt);
      return res.response.text();
    } catch (err) {
      lastError = err;
      if (!isModelUnavailable(err)) throw err;
    }
  }

  throw new Error(
    "Gemini model access failed. Open Settings, confirm your API key is valid, then try again.",
    { cause: lastError },
  );
}

async function callGeminiTasks(brainDump: string): Promise<AITask[]> {
  const prompt = `You are an intelligent productivity assistant. Parse this messy brain-dump of tasks and return a JSON array.

For each task, extract:
- title: a clean, action-oriented task name (start with a verb)
- urgencyScore: integer 1-10 (10 = most urgent)
- estimatedMinutes: realistic time in minutes (5-240)
- energyLevel: "High", "Medium", or "Low"
- scheduledTime: if the user gave an exact time like "9pm", "21:00", or "at 6:30 AM", return it as HH:MM in 24-hour time. Otherwise return "".

Brain-dump:
"""
${brainDump}
"""

Return ONLY a JSON array of objects with keys: title, urgencyScore, estimatedMinutes, energyLevel, scheduledTime. No commentary, no markdown fences.`;

  const text = await generateWithFallback(prompt, { json: true });
  const parsed = parseLooseJson<AITask[]>(text);

  return parsed
    .filter((t) => t && t.title)
    .map((t) => ({
      title: String(t.title),
      urgencyScore: Math.max(1, Math.min(10, Number(t.urgencyScore) || 5)),
      estimatedMinutes: Math.max(1, Number(t.estimatedMinutes) || 15),
      energyLevel: (["High", "Medium", "Low"].includes(t.energyLevel)
        ? t.energyLevel
        : "Medium") as AITask["energyLevel"],
      scheduledTime: /^\d{2}:\d{2}$/.test(String(t.scheduledTime ?? ""))
        ? String(t.scheduledTime)
        : undefined,
    }))
    .sort((a, b) => b.urgencyScore - a.urgencyScore);
}

export async function prioritizeBrainDump(brainDump: string): Promise<AITask[]> {
  if (!getApiKey()) throw new Error("Missing Gemini API key. Add it in Settings.");
  try {
    return await callGeminiTasks(brainDump);
  } catch (err) {
    if (!is503(err)) throw err;
    toast("Priora is experiencing high cognitive load. Retrying...", {
      description: "Gemini is overloaded — trying once more in 2 seconds.",
    });
    await sleep(2000);
    try {
      return await callGeminiTasks(brainDump);
    } catch (retryErr) {
      if (!is503(retryErr)) throw retryErr;
      toast.warning("Showing demo priorities", {
        description:
          "Gemini is still overloaded. Loaded a sample prioritized list so you can keep exploring.",
      });
      return [...MOCK_FALLBACK].sort((a, b) => b.urgencyScore - a.urgencyScore);
    }
  }
}

/* ---------------- Auto-Execute ---------------- */

export async function autoExecuteTask(taskTitle: string): Promise<string> {
  const prompt = `Act as an expert assistant and instantly complete this task. Provide a structured outline, draft, or logic flow so the user can just copy-paste and be done.

Task: "${taskTitle}"

Respond in clean Markdown with:
- A short heading
- A ready-to-use draft (email body, post copy, code, or step-by-step plan as appropriate)
- Bullet lists or numbered steps where helpful
- Keep it under 350 words. No preamble, no apologies.`;

  try {
    return await generateWithFallback(prompt);
  } catch (err) {
    if (is503(err)) {
      await sleep(1500);
      try {
        return await generateWithFallback(prompt);
      } catch {
        /* fall through */
      }
    }
    return `## ${taskTitle}\n\n_Priora couldn't reach Gemini right now, so here's a fallback template:_\n\n1. Clarify the desired outcome in one sentence.\n2. Gather the 2–3 inputs you need before starting.\n3. Draft the first version in a single 25-minute focus block.\n4. Review, polish tone, and send / publish.\n5. Log completion in Priora and capture any follow-ups.`;
  }
}

/* ---------------- Auto-Reschedule ---------------- */

export async function suggestRescheduleSlot(
  taskTitle: string,
  occupiedSlots: string[],
): Promise<{ time: string; reason: string }> {
  const prompt = `You are a scheduling assistant. The user missed this task: "${taskTitle}".

These time slots are already taken today (HH:MM 24h): ${occupiedSlots.join(", ") || "none"}.

Find the next available 30-minute slot today between 09:00 and 21:00 that doesn't conflict.
If today is full, suggest tomorrow at 09:00.

Respond ONLY with JSON: { "time": "HH:MM", "reason": "one-line rationale" }`;

  try {
    const text = await generateWithFallback(prompt, { json: false });
    const parsed = parseLooseJson<{ time: string; reason: string }>(text);
    if (parsed?.time && /^\d{2}:\d{2}$/.test(parsed.time)) return parsed;
  } catch {
    /* swallow */
  }
  return { time: "09:00", reason: "Moved to tomorrow morning — today is full." };
}
