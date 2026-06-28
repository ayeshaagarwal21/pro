import { toast } from "sonner";

export type AITask = {
  title: string;
  urgencyScore: number;
  estimatedMinutes: number;
  energyLevel: "High" | "Medium" | "Low";
  scheduledTime?: string;
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

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

function parseTimeHint(text: string): string | undefined {
  const amPm = /\b(?:at\s*)?(\d{1,2})(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?)\b/i.exec(text);
  if (amPm) {
    let hour = Number(amPm[1]);
    const minute = Number(amPm[2] ?? "0");
    const meridian = amPm[3].toLowerCase();
    if (meridian.startsWith("p") && hour < 12) hour += 12;
    if (meridian.startsWith("a") && hour === 12) hour = 0;
    return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
  }

  const clock = /\b(?:at\s*)?([01]?\d|2[0-3]):([0-5]\d)\b/i.exec(text);
  return clock ? `${String(Number(clock[1])).padStart(2, "0")}:${clock[2]}` : undefined;
}

function localPrioritizeBrainDump(brainDump: string): AITask[] {
  const parts = brainDump
    .split(
      /\n|;|,(?=\s*(?:and\s+)?(?:call|email|finish|submit|pay|schedule|meet|write|draft|review|send|book|buy|prepare|complete|update|create|fix|open|connect)\b)/i,
    )
    .map((part) => part.replace(/^\s*(?:and|then|also|plus)\s+/i, "").trim())
    .filter(Boolean);

  const chunks = parts.length ? parts : [brainDump.trim()];
  return chunks
    .map((chunk, index) => {
      const lower = chunk.toLowerCase();
      const urgent =
        /\btoday|tonight|now|urgent|asap|deadline|due|tomorrow|meeting|submit|pay\b/.test(lower);
      const light = /\bcall|email|message|pay|book|send\b/.test(lower);
      const long = /\bproject|report|deck|presentation|research|build|prepare|review\b/.test(
        lower,
      );
      const estimatedMinutes = light ? 15 : long ? 60 : 30;
      const energyLevel = long ? "High" : light ? "Low" : "Medium";
      const cleaned = chunk.replace(/\s+/g, " ").replace(/[.?!]+$/g, "").trim();
      const title = cleaned
        ? cleaned[0].toUpperCase() + cleaned.slice(1)
        : `Task ${index + 1}`;
      return {
        title,
        urgencyScore: Math.max(1, Math.min(10, urgent ? 9 - index : 6 - index)),
        estimatedMinutes,
        energyLevel: energyLevel as AITask["energyLevel"],
        scheduledTime: parseTimeHint(chunk),
      };
    })
    .sort((a, b) => b.urgencyScore - a.urgencyScore);
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
  const response = await fetch("/api/gemini", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ prompt, json: !!opts.json }),
  });

  const payload = (await response.json().catch(() => null)) as {
    text?: string;
    error?: string;
  } | null;
  if (!response.ok) {
    throw new Error(payload?.error ?? "Gemini request failed.");
  }
  if (!payload?.text) throw new Error("Gemini returned an empty response.");
  return payload.text;
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
  try {
    return await callGeminiTasks(brainDump);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/not configured|GEMINI_API_KEY|Gemini request failed/i.test(msg)) {
      toast("Using local prioritization", {
        description: "Gemini is not configured, so Priora parsed this on-device.",
      });
      return localPrioritizeBrainDump(brainDump);
    }
    if (!is503(err)) throw err;
    toast("Priora is experiencing high cognitive load. Retrying...", {
      description: "Gemini is overloaded — trying once more in 2 seconds.",
    });
    await sleep(2000);
    try {
      return await callGeminiTasks(brainDump);
    } catch (retryErr) {
      if (!is503(retryErr)) throw retryErr;
      throw retryErr;
    }
  }
}

/* ---------------- Auto-Execute ---------------- */

function localAutoExecuteTask(taskTitle: string): string {
  const title = taskTitle.trim();
  const lower = title.toLowerCase();
  if (/\b(email|mail|message|write to|reply)\b/.test(lower)) {
    const recipientMatch = /\b(?:to|for)\s+([^,.;]+?)(?:\s+about|\s+regarding|\s+that|\s+at|$)/i.exec(
      title,
    );
    const subject = title
      .replace(/\b(write|draft|send)?\s*(an?\s*)?(email|mail|message)\s*(to)?\b/gi, "")
      .replace(/\s+/g, " ")
      .trim();
    const recipient = recipientMatch?.[1]?.trim() || "there";
    return `## ${title}

**Subject:** ${subject || title}

Hi ${recipient},

I wanted to let you know about ${subject || "the update we discussed"}.

Here is the current plan:

1. I will handle the immediate next step today.
2. I will keep the timing practical and avoid creating extra confusion.
3. I will follow up if anything changes or needs your confirmation.

Please let me know if you want me to adjust anything.

Best,`;
  }

  if (/\b(post|caption|linkedin|instagram|announcement)\b/.test(lower)) {
    return `## ${title}

Here is a ready-to-post draft:

${title}

Quick update: I am moving this forward with a clear plan, a tighter timeline, and the next action already blocked.

What changes now:

1. The priority is clear.
2. The next step is scheduled.
3. Follow-up will happen after the first focused block.

More soon.`;
  }

  return `## ${title}

Here is a ready-to-use execution plan:

1. Define the outcome: what must be true when "${title}" is done.
2. Gather the inputs: notes, links, contacts, files, and deadline.
3. Start with the smallest irreversible action.
4. Block one focused work session and finish the core draft.
5. Review, send or submit, then log the follow-up.`;
}

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
    return localAutoExecuteTask(taskTitle);
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
