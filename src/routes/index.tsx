import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Sparkles,
  Flame,
  Clock,
  Mail,
  FileText,
  CreditCard,
  Calendar,
  CalendarPlus,
  CheckCircle2,
  ChevronRight,
  Mic,
  Send,
  Menu,
  X,
  Search,
  LayoutDashboard,
  BarChart3,
  Settings,
  Brain,
  Wand2,
  Bell,
  Target,
  ArrowUpRight,
  Loader2,
  AlertCircle,
  AlarmClock,
  Copy,
  Check,
  Download,
  RefreshCw,
  LogIn,
} from "lucide-react";

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  prioritizeBrainDump,
  autoExecuteTask,
  suggestRescheduleSlot,
  type AITask,
} from "@/lib/gemini";
import { getCurrentUser, logoutUser, type PrioraUser } from "@/lib/auth";
import {
  createTasks,
  listTasks,
  updateTask,
  type CreateTaskInput,
  type StoredTaskRecord,
} from "@/lib/tasks";
import { toast } from "sonner";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Priora — Your day, intelligently organized." },
      {
        name: "description",
        content:
          "Your day, intelligently organized. A proactive AI companion that prioritizes, schedules, and auto-executes your tasks.",
      },
      { property: "og:title", content: "Priora — Your day, intelligently organized." },
      { property: "og:description", content: "Your day, intelligently organized." },
    ],
  }),
  component: Index,
});

type Energy = "Low" | "Medium" | "High";
type Task = {
  id: string;
  title: string;
  context: string;
  score: number;
  minutes: number;
  energy: Energy;
  due: string;
  accent: "rose" | "gold" | "jade" | "violet" | "amber";
  executable?: { kind: "email" | "post" | "plan"; subject?: string; body: string };
  icon: typeof Mail;
  iconKey: StoredTaskRecord["iconKey"];
  scheduledAt: Date;
  createdAt: Date;
  completedAt?: Date;
  completed?: boolean;
  notified10?: boolean;
};

type TaskDraft = Omit<Task, "scheduledAt" | "createdAt" | "completedAt"> & {
  preferredTime?: string;
};

type TimelineSlot = {
  id: string;
  time: string;
  label: string;
  duration: number;
  accent: Task["accent"];
  live: boolean;
  taskId?: string;
  start: Date;
  end: Date;
};

type AvailabilityBlock = {
  start: string;
  end: string;
};

/* Removed the old demo seed tasks so every account starts from saved user data.
  {
    id: "t1",
    title: "Submit B.Tech Project Logic",
    context: "CS-7B • Prof. Iyer • Module 4 deliverable",
    score: 96,
    minutes: 75,
    energy: "High",
    due: "Today, 6:00 PM",
    accent: "rose",
    icon: FileText,
    executable: {
      kind: "plan",
      body: `1. Pull final commit from /capstone/main\n2. Generate flowchart for inference module\n3. Run unit tests (12/12 currently passing)\n4. Compile PDF via LaTeX template\n5. Upload to college portal & email Prof. Iyer`,
    },
  },
  {
    id: "t2",
    title: "Email Prof. Iyer about viva slot",
    context: "Reply pending • 2 days overdue",
    score: 88,
    minutes: 6,
    energy: "Low",
    due: "Today, 11:30 AM",
    accent: "gold",
    icon: Mail,
    executable: {
      kind: "email",
      subject: "Request: Viva slot reschedule — Capstone Module 4",
      body: `Dear Professor Iyer,\n\nI hope you're doing well. I'd like to request a viva slot for my capstone Module 4 review between Thursday and Friday afternoon, if your calendar allows. I've completed the inference module and all 12 unit tests are passing.\n\nGrateful for your guidance throughout the semester.\n\nWarm regards,\nAniket`,
    },
  },
  {
    id: "t3",
    title: "Approve Fest Campaign Designs",
    context: "Spectra '26 • 4 carousels from design lead",
    score: 81,
    minutes: 20,
    energy: "Medium",
    due: "Today, 2:00 PM",
    accent: "violet",
    icon: Wand2,
  },
  {
    id: "t4",
    title: "Draft launch post for new portfolio",
    context: "LinkedIn + Instagram cross-post",
    score: 74,
    minutes: 15,
    energy: "Medium",
    due: "Today, 4:30 PM",
    accent: "jade",
    icon: FileText,
    executable: {
      kind: "post",
      body: `Three months. One late-night idea. A portfolio that finally feels like me.\n\nBuilt with motion, restraint, and a stubborn belief that craft still matters. Huge thanks to everyone who reviewed early drafts — you shaped the edges.\n\nLink in bio. Feedback always welcome. ↗`,
    },
  },
  {
    id: "t5",
    title: "Pay Hosting Bill",
    context: "Vercel Pro • auto-renew failed",
    score: 68,
    minutes: 4,
    energy: "Low",
    due: "Today, 9:00 PM",
    accent: "amber",
    icon: CreditCard,
  },
  {
    id: "t6",
    title: "Review club budget spreadsheet",
    context: "Treasurer handover • Q2 closing",
    score: 55,
    minutes: 30,
    energy: "Medium",
    due: "Tomorrow",
    accent: "violet",
    icon: BarChart3,
  },
*/
function fmt(d: Date): string {
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

/** Auto-schedule tasks across today's free blocks (9:00 → 21:00) with 15-min buffers. */
function autoSchedule<T extends { id: string; minutes: number; score: number }>(
  items: T[],
  startFrom: Date,
  occupied: Date[] = [],
): Map<string, Date> {
  const sorted = [...items].sort((a, b) => b.score - a.score);
  const ordered = [...sorted];
  const map = new Map<string, Date>();

  // Cursor: next top of hour from startFrom, clamped to 9am.
  const cursor = new Date(startFrom);
  cursor.setMinutes(0, 0, 0);
  cursor.setHours(cursor.getHours() + 1);
  if (cursor.getHours() < 9) cursor.setHours(9, 0, 0, 0);

  const dayEnd = new Date(startFrom);
  dayEnd.setHours(21, 0, 0, 0);

  const occupiedTimes = new Set(occupied.map((d) => fmt(d)));

  for (const t of ordered) {
    while (occupiedTimes.has(fmt(cursor)) && cursor < dayEnd) {
      cursor.setHours(cursor.getHours() + 1);
    }
    if (new Date(cursor.getTime() + t.minutes * 60_000) > dayEnd) {
      // Park overflow at tomorrow morning, staggered hourly.
      const tomorrow = new Date(startFrom);
      tomorrow.setDate(tomorrow.getDate() + 1);
      tomorrow.setHours(9 + (map.size % 6), 0, 0, 0);
      map.set(t.id, tomorrow);
      continue;
    }
    map.set(t.id, new Date(cursor));
    // advance: round up by full hour from end of task + 15 min buffer
    const next = new Date(cursor.getTime() + (t.minutes + 15) * 60_000);
    next.setMinutes(0, 0, 0);
    next.setHours(next.getHours() + 1);
    cursor.setTime(Math.max(cursor.getTime() + 60 * 60_000, next.getTime()));
  }
  return map;
}

const accentMap = {
  rose: {
    bg: "bg-rasa-rose/15",
    text: "text-rasa-rose",
    ring: "ring-rasa-rose/30",
    dot: "bg-rasa-rose",
  },
  gold: {
    bg: "bg-rasa-gold/15",
    text: "text-rasa-gold",
    ring: "ring-rasa-gold/30",
    dot: "bg-rasa-gold",
  },
  jade: {
    bg: "bg-rasa-jade/15",
    text: "text-rasa-jade",
    ring: "ring-rasa-jade/30",
    dot: "bg-rasa-jade",
  },
  violet: {
    bg: "bg-rasa-violet/15",
    text: "text-rasa-violet",
    ring: "ring-rasa-violet/30",
    dot: "bg-rasa-violet",
  },
  amber: {
    bg: "bg-rasa-amber/15",
    text: "text-rasa-amber",
    ring: "ring-rasa-amber/30",
    dot: "bg-rasa-amber",
  },
};

const ACCENTS: Task["accent"][] = ["rose", "gold", "jade", "violet", "amber"];
const ICONS = [FileText, Mail, Wand2, CreditCard, BarChart3, Calendar];
const ICON_BY_KEY: Record<StoredTaskRecord["iconKey"], typeof Mail> = {
  file: FileText,
  mail: Mail,
  wand: Wand2,
  card: CreditCard,
  chart: BarChart3,
  calendar: Calendar,
};
const ICON_KEY_BY_COMPONENT = new Map<typeof Mail, StoredTaskRecord["iconKey"]>([
  [FileText, "file"],
  [Mail, "mail"],
  [Wand2, "wand"],
  [CreditCard, "card"],
  [BarChart3, "chart"],
  [Calendar, "calendar"],
]);

function parseTimeHint(text: string): string | null {
  const amPm = /\b(?:at\s*)?(\d{1,2})(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?)\b/i.exec(text);
  if (amPm) {
    let hour = Number(amPm[1]);
    const minute = Number(amPm[2] ?? "0");
    const meridian = amPm[3].toLowerCase();
    if (meridian.startsWith("p") && hour < 12) hour += 12;
    if (meridian.startsWith("a") && hour === 12) hour = 0;
    if (hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59) {
      return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
    }
  }

  const clock = /\b(?:at\s*)?([01]?\d|2[0-3]):([0-5]\d)\b/i.exec(text);
  if (clock) return `${String(Number(clock[1])).padStart(2, "0")}:${clock[2]}`;

  return null;
}

function timeLabel(time: string): string {
  const [h, m] = time.split(":").map(Number);
  const suffix = h >= 12 ? "PM" : "AM";
  const hour = h % 12 || 12;
  return `${hour}:${String(m).padStart(2, "0")} ${suffix}`;
}

function dateForPreferredTime(time: string, startFrom: Date, minutes: number): Date {
  const [h, m] = time.split(":").map(Number);
  const d = new Date(startFrom);
  d.setHours(h, m, 0, 0);
  if (d.getTime() + minutes * 60_000 <= startFrom.getTime()) {
    d.setDate(d.getDate() + 1);
  }
  return d;
}

function minutesOfDay(date: Date): number {
  return date.getHours() * 60 + date.getMinutes();
}

function timeToMinutes(time: string): number {
  const [h, m] = time.split(":").map(Number);
  return h * 60 + m;
}

function formatBlock(block: AvailabilityBlock): string {
  return `${timeLabel(block.start)}-${timeLabel(block.end)}`;
}

function overlapsUnavailable(start: Date, minutes: number, blocks: AvailabilityBlock[]): boolean {
  const slotStart = minutesOfDay(start);
  const slotEnd = slotStart + minutes;
  return blocks.some((block) => {
    const blockStart = timeToMinutes(block.start);
    const blockEnd = timeToMinutes(block.end);
    if (blockEnd <= blockStart) return false;
    return slotStart < blockEnd && slotEnd > blockStart;
  });
}

function overlapsOccupied(start: Date, minutes: number, occupied: Date[]): boolean {
  const slotEnd = start.getTime() + minutes * 60_000;
  return occupied.some((occupiedStart) => {
    const occupiedEnd = occupiedStart.getTime() + 60 * 60_000;
    return start.getTime() < occupiedEnd && slotEnd > occupiedStart.getTime();
  });
}

function findNextAvailableSlot(
  startFrom: Date,
  minutes: number,
  occupied: Date[],
  unavailable: AvailabilityBlock[],
): Date {
  const candidate = new Date(startFrom);
  candidate.setSeconds(0, 0);
  const rounded = Math.ceil(candidate.getMinutes() / 15) * 15;
  candidate.setMinutes(rounded);

  for (let attempts = 0; attempts < 7 * 24 * 4; attempts++) {
    const hour = candidate.getHours();
    const dayEnd = new Date(candidate);
    dayEnd.setHours(21, 0, 0, 0);
    if (hour < 9) candidate.setHours(9, 0, 0, 0);
    if (candidate.getTime() + minutes * 60_000 > dayEnd.getTime()) {
      candidate.setDate(candidate.getDate() + 1);
      candidate.setHours(9, 0, 0, 0);
      continue;
    }
    if (
      !overlapsOccupied(candidate, minutes, occupied) &&
      !overlapsUnavailable(candidate, minutes, unavailable)
    ) {
      return new Date(candidate);
    }
    candidate.setMinutes(candidate.getMinutes() + 15);
  }

  const tomorrow = new Date(startFrom);
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(9, 0, 0, 0);
  return tomorrow;
}

function aiTaskToTask(t: AITask, i: number, sourceText?: string): TaskDraft {
  const lower = t.title.toLowerCase();
  const isEmail = /email|reply|respond|message/.test(lower);
  const isPost = /post|tweet|caption|draft|write|publish/.test(lower);
  const preferredTime = t.scheduledTime ?? parseTimeHint(`${t.title} ${sourceText ?? ""}`);

  return {
    id: `ai-${i}-${Date.now()}`,
    title: t.title,
    context: `${t.estimatedMinutes} min focus · ${t.energyLevel.toLowerCase()} energy required`,
    score: t.urgencyScore * 10,
    minutes: t.estimatedMinutes,
    energy: t.energyLevel,
    due: preferredTime
      ? `Today, ${timeLabel(preferredTime)}`
      : t.urgencyScore >= 8
        ? "Today"
        : t.urgencyScore >= 5
          ? "This week"
          : "Soon",
    accent: ACCENTS[i % ACCENTS.length],
    icon: isEmail ? Mail : isPost ? FileText : ICONS[i % ICONS.length],
    iconKey: isEmail
      ? "mail"
      : isPost
        ? "file"
        : (ICON_KEY_BY_COMPONENT.get(ICONS[i % ICONS.length]) ?? "file"),
    preferredTime,
    executable: isEmail
      ? {
          kind: "email",
          subject: t.title,
          body: `Hi,\n\nQuick note regarding: ${t.title}.\n\nI'll follow up shortly with details and next steps.\n\nBest,\nAniket`,
        }
      : isPost
        ? { kind: "post", body: `${t.title}\n\nSharing a quick update — more soon. ↗` }
        : {
            kind: "plan",
            body: `1. Define the desired outcome for "${t.title}"\n2. Block ${t.estimatedMinutes} minutes on the calendar\n3. Gather required context & tools\n4. Execute the core action\n5. Confirm completion and log the result`,
          },
  };
}

function withSchedule(raw: TaskDraft[], startFrom: Date, occupied: Date[] = []): Task[] {
  const explicit = new Map<string, Date>();
  const flexible: TaskDraft[] = [];

  for (const t of raw) {
    if (t.preferredTime) {
      explicit.set(t.id, dateForPreferredTime(t.preferredTime, startFrom, t.minutes));
    } else {
      flexible.push(t);
    }
  }

  const scheduled = autoSchedule(flexible, startFrom, [...occupied, ...explicit.values()]);
  return raw.map(({ preferredTime, ...t }) => ({
    ...t,
    scheduledAt: explicit.get(t.id) ?? scheduled.get(t.id) ?? startFrom,
    createdAt: new Date(),
  }));
}

function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function toCreateTask(task: Task): CreateTaskInput {
  return {
    title: task.title,
    description: task.context,
    status: task.completed ? "completed" : "active",
    priority: task.score,
    dueDate: task.scheduledAt.toISOString(),
    score: task.score,
    minutes: task.minutes,
    energy: task.energy,
    due: task.due,
    accent: task.accent,
    executable: task.executable,
    iconKey: task.iconKey,
    scheduledAt: task.scheduledAt.toISOString(),
    notified10: task.notified10,
    completedAt: task.completedAt?.toISOString(),
  };
}

function fromStoredTask(record: StoredTaskRecord): Task {
  return {
    id: record.id,
    title: record.title,
    context: record.description,
    score: record.score,
    minutes: record.minutes,
    energy: record.energy,
    due: record.due,
    accent: record.accent,
    executable: record.executable,
    iconKey: record.iconKey,
    icon: ICON_BY_KEY[record.iconKey] ?? FileText,
    scheduledAt: new Date(record.scheduledAt),
    createdAt: new Date(record.createdAt),
    completedAt: record.completedAt ? new Date(record.completedAt) : undefined,
    completed: record.status === "completed",
    notified10: record.notified10,
  };
}

/* ---------------- ICS export ---------------- */
function toIcsDate(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    d.getUTCFullYear().toString() +
    pad(d.getUTCMonth() + 1) +
    pad(d.getUTCDate()) +
    "T" +
    pad(d.getUTCHours()) +
    pad(d.getUTCMinutes()) +
    pad(d.getUTCSeconds()) +
    "Z"
  );
}

function buildIcs(tasks: Task[]): string {
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Priora//Schedule//EN",
    "CALSCALE:GREGORIAN",
  ];
  const stamp = toIcsDate(new Date());
  for (const t of tasks) {
    const end = new Date(t.scheduledAt.getTime() + t.minutes * 60_000);
    lines.push(
      "BEGIN:VEVENT",
      `UID:${t.id}@priora.app`,
      `DTSTAMP:${stamp}`,
      `DTSTART:${toIcsDate(t.scheduledAt)}`,
      `DTEND:${toIcsDate(end)}`,
      `SUMMARY:${t.title.replace(/[,;]/g, " ")}`,
      `DESCRIPTION:${t.context.replace(/\n/g, "\\n")} | Energy: ${t.energy} | Priora score ${t.score}`,
      "END:VEVENT",
    );
  }
  lines.push("END:VCALENDAR");
  return lines.join("\r\n");
}

function downloadIcs(tasks: Task[]) {
  const blob = new Blob([buildIcs(tasks)], { type: "text/calendar;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "Priora_Schedule.ics";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/* ---------------- Notifications + chime ---------------- */
function playChime() {
  try {
    const Ctx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new Ctx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.type = "sine";
    osc.frequency.setValueAtTime(880, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(1320, ctx.currentTime + 0.18);
    gain.gain.setValueAtTime(0.0001, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.18, ctx.currentTime + 0.04);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.45);
    osc.start();
    osc.stop(ctx.currentTime + 0.5);
  } catch {
    /* silent */
  }
}

/* ---------------- Tiny Markdown renderer ---------------- */
function MarkdownView({ text }: { text: string }) {
  const blocks = useMemo(() => {
    const lines = text.replace(/\r\n/g, "\n").split("\n");
    type Block =
      | { type: "h"; level: number; content: string }
      | { type: "ul"; items: string[] }
      | { type: "ol"; items: string[] }
      | { type: "code"; content: string }
      | { type: "p"; content: string }
      | { type: "hr" };
    const out: Block[] = [];
    let i = 0;
    while (i < lines.length) {
      const ln = lines[i];
      if (/^```/.test(ln)) {
        const buf: string[] = [];
        i++;
        while (i < lines.length && !/^```/.test(lines[i])) {
          buf.push(lines[i]);
          i++;
        }
        i++;
        out.push({ type: "code", content: buf.join("\n") });
        continue;
      }
      const h = /^(#{1,4})\s+(.*)/.exec(ln);
      if (h) {
        out.push({ type: "h", level: h[1].length, content: h[2] });
        i++;
        continue;
      }
      if (/^---+$/.test(ln.trim())) {
        out.push({ type: "hr" });
        i++;
        continue;
      }
      if (/^\s*[-*]\s+/.test(ln)) {
        const items: string[] = [];
        while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) {
          items.push(lines[i].replace(/^\s*[-*]\s+/, ""));
          i++;
        }
        out.push({ type: "ul", items });
        continue;
      }
      if (/^\s*\d+\.\s+/.test(ln)) {
        const items: string[] = [];
        while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) {
          items.push(lines[i].replace(/^\s*\d+\.\s+/, ""));
          i++;
        }
        out.push({ type: "ol", items });
        continue;
      }
      if (!ln.trim()) {
        i++;
        continue;
      }
      const buf: string[] = [];
      while (
        i < lines.length &&
        lines[i].trim() &&
        !/^(#{1,4}\s|\s*[-*]\s|\s*\d+\.\s|```|---+$)/.test(lines[i])
      ) {
        buf.push(lines[i]);
        i++;
      }
      out.push({ type: "p", content: buf.join(" ") });
    }
    return out;
  }, [text]);

  const inline = (s: string) =>
    s
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/\*\*([^*]+)\*\*/g, '<strong class="text-foreground">$1</strong>')
      .replace(/\*([^*]+)\*/g, "<em>$1</em>")
      .replace(
        /`([^`]+)`/g,
        '<code class="px-1 py-0.5 rounded bg-white/10 text-rasa-gold text-[0.85em]">$1</code>',
      );

  return (
    <div className="space-y-3 text-sm leading-relaxed text-foreground/90">
      {blocks.map((b, idx) => {
        if (b.type === "h") {
          const cls =
            b.level === 1
              ? "text-xl font-bold"
              : b.level === 2
                ? "text-lg font-bold"
                : "text-base font-semibold";
          return (
            <div
              key={idx}
              className={`${cls} text-foreground`}
              dangerouslySetInnerHTML={{ __html: inline(b.content) }}
            />
          );
        }
        if (b.type === "ul")
          return (
            <ul key={idx} className="space-y-1.5 list-disc pl-5 marker:text-rasa-violet">
              {b.items.map((it, j) => (
                <li key={j} dangerouslySetInnerHTML={{ __html: inline(it) }} />
              ))}
            </ul>
          );
        if (b.type === "ol")
          return (
            <ol
              key={idx}
              className="space-y-1.5 list-decimal pl-5 marker:text-rasa-gold marker:font-semibold"
            >
              {b.items.map((it, j) => (
                <li key={j} dangerouslySetInnerHTML={{ __html: inline(it) }} />
              ))}
            </ol>
          );
        if (b.type === "code")
          return (
            <pre
              key={idx}
              className="rounded-xl bg-black/40 border border-white/5 p-3 overflow-x-auto text-xs"
            >
              <code>{b.content}</code>
            </pre>
          );
        if (b.type === "hr") return <hr key={idx} className="border-white/5" />;
        return <p key={idx} dangerouslySetInnerHTML={{ __html: inline(b.content) }} />;
      })}
    </div>
  );
}

/* =====================================================
   ROOT COMPONENT
===================================================== */
function Index() {
  const navigate = useNavigate();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [activeView, setActiveView] = useState<
    "Dashboard" | "Priorities" | "Timeline" | "Insights"
  >("Dashboard");
  const [activeTask, setActiveTask] = useState<Task | null>(null);
  const [brainOpen, setBrainOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [highlightedId, setHighlightedId] = useState<string | null>(null);
  const [completingId, setCompletingId] = useState<string | null>(null);
  const [now, setNow] = useState(new Date());
  const [notifOpen, setNotifOpen] = useState(false);
  const [availabilityTaskId, setAvailabilityTaskId] = useState<string | null>(null);
  const [availabilityPromptedIds, setAvailabilityPromptedIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [notifications, setNotifications] = useState<
    { id: string; title: string; body: string; unread: boolean }[]
  >([
    {
      id: "n1",
      title: "Welcome to Priora",
      body: "Your day, intelligently organized. Drop a brain dump to begin.",
      unread: true,
    },
    {
      id: "n2",
      title: "Voice input ready",
      body: "Tap the mic in the Brain Dump to speak your tasks.",
      unread: true,
    },
  ]);
  const unreadCount = notifications.filter((n) => n.unread).length;

  const [tasks, setTasks] = useState<Task[]>([]);
  const [tasksLoaded, setTasksLoaded] = useState(false);
  const [aiPowered, setAiPowered] = useState(false);
  const [currentUser, setCurrentUser] = useState<PrioraUser | null>(null);
  const reminderInFlightRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    let cancelled = false;
    setTasksLoaded(false);
    getCurrentUser()
      .then(async (user) => {
        if (cancelled) return;
        if (!user) {
          setCurrentUser(null);
          setTasks([]);
          void navigate({ to: "/login" });
          return;
        }
        setCurrentUser(user);
        const records = await listTasks();
        if (cancelled) return;
        const savedTasks = records.map(fromStoredTask);
        setTasks(savedTasks);
        setAiPowered(savedTasks.length > 0);
      })
      .catch((error) => {
        console.error(error);
        toast.error("Couldn't restore your session", {
          description: "Please log in again.",
        });
        void navigate({ to: "/login" });
      })
      .finally(() => {
        if (!cancelled) setTasksLoaded(true);
      });

    return () => {
      cancelled = true;
    };
  }, [navigate]);

  const displayName = currentUser?.name || "User";
  const firstName = displayName.split(" ")[0] || "User";
  const initials =
    displayName
      .split(" ")
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase())
      .join("") || "P";

  /* 60s heartbeat — drives overdue + 10-min notifications */
  useEffect(() => {
    const tick = () => setNow(new Date());
    const id = setInterval(tick, 60_000);
    return () => clearInterval(id);
  }, []);

  /* Reminder scan: ping once inside the final 10 minutes before a scheduled task. */
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!tasksLoaded) return;

    const dueSoon = tasks.filter((task) => {
      if (task.completed || task.notified10 || reminderInFlightRef.current.has(task.id)) {
        return false;
      }
      const diff = (task.scheduledAt.getTime() - now.getTime()) / 60_000;
      return diff > 0 && diff <= 10;
    });

    for (const task of dueSoon) {
      reminderInFlightRef.current.add(task.id);
      setTasks((prev) =>
        prev.map((item) => (item.id === task.id ? { ...item, notified10: true } : item)),
      );
      setNotifications((prev) => [
        {
          id: `reminder-${task.id}-${Date.now()}`,
          title: `${task.title} starts soon`,
          body: `${task.minutes} min · ${task.energy} energy · ${task.scheduledAt.toLocaleTimeString(
            undefined,
            {
              hour: "2-digit",
              minute: "2-digit",
            },
          )}`,
          unread: true,
        },
        ...prev,
      ]);
      toast("Task starts soon", {
        description: `${task.title} starts within 10 minutes.`,
      });
      playChime();

      if ("Notification" in window && Notification.permission === "granted") {
        try {
          new Notification(`Priora reminder: ${task.title}`, {
            body: `Starts within 10 minutes · ${task.energy} energy · ${task.minutes} min`,
            icon: "/favicon.ico",
            tag: task.id,
          });
        } catch {
          /* ignore */
        }
      }

      updateTask(task.id, { notified10: true }).catch((error) => {
        reminderInFlightRef.current.delete(task.id);
        setTasks((prev) =>
          prev.map((item) => (item.id === task.id ? { ...item, notified10: false } : item)),
        );
        toast.error("Couldn't save reminder state", {
          description: error instanceof Error ? error.message : "Database update failed.",
        });
      });
    }
  }, [now, tasks, tasksLoaded]);

  const overdueTasks = useMemo(
    () =>
      tasks.filter(
        (t) => !t.completed && t.scheduledAt.getTime() + t.minutes * 60_000 < now.getTime(),
      ),
    [tasks, now],
  );

  useEffect(() => {
    if (!tasksLoaded || availabilityTaskId || !overdueTasks.length) return;
    const next = overdueTasks.find((task) => !availabilityPromptedIds.has(task.id));
    if (!next) return;

    setAvailabilityPromptedIds((prev) => new Set(prev).add(next.id));
    setAvailabilityTaskId(next.id);
    toast("Task time is up", {
      description: "Tell Priora when you are unavailable before it reschedules.",
    });
  }, [availabilityPromptedIds, availabilityTaskId, overdueTasks, tasksLoaded]);

  const activeTasks = useMemo(
    () =>
      tasks
        .filter((t) => !t.completed && !overdueTasks.includes(t))
        .sort((a, b) => b.score - a.score),
    [tasks, overdueTasks],
  );
  const todayTaskCount = tasks.filter(
    (task) => task.createdAt.toDateString() === now.toDateString(),
  ).length;
  const completedTodayCount = tasks.filter(
    (task) => task.completedAt?.toDateString() === now.toDateString(),
  ).length;
  const totalCompletedCount = tasks.filter((task) => task.completed).length;
  const aiConfidence = activeTasks.length
    ? Math.round(activeTasks.reduce((sum, task) => sum + task.score, 0) / activeTasks.length)
    : 0;
  const scheduledMinutes = activeTasks.reduce((sum, task) => sum + task.minutes, 0);
  const calmScore = Math.max(
    1,
    Math.min(
      10,
      10 - overdueTasks.length * 1.5 - activeTasks.filter((task) => task.score >= 85).length * 0.4,
    ),
  );

  const focus = activeTasks[0];
  const availabilityTask = tasks.find((task) => task.id === availabilityTaskId) ?? null;

  const timeline = useMemo<TimelineSlot[]>(
    () =>
      [...activeTasks]
        .sort((a, b) => a.scheduledAt.getTime() - b.scheduledAt.getTime())
        .map((t) => {
          const start = t.scheduledAt;
          const end = new Date(start.getTime() + t.minutes * 60_000);
          const isLive = now >= start && now < end;
          return {
            id: `slot-${t.id}`,
            time: fmt(start),
            label: t.title,
            duration: t.minutes,
            accent: t.accent,
            live: isLive,
            taskId: t.id,
            start,
            end,
          };
        }),
    [activeTasks, now],
  );

  const greeting = useMemo(() => {
    const h = now.getHours();
    if (h < 12) return "Good morning";
    if (h < 17) return "Good afternoon";
    return "Good evening";
  }, [now]);

  const handlePrioritized = async (results: AITask[], sourceText?: string) => {
    const now = new Date();
    const existingTitles = new Set(
      tasks.filter((task) => !task.completed).map((task) => normalizeTitle(task.title)),
    );
    const raw = results
      .map((task, index) =>
        aiTaskToTask(task, index, results.length === 1 ? sourceText : undefined),
      )
      .filter((task) => {
        const key = normalizeTitle(task.title);
        if (!key || existingTitles.has(key)) return false;
        existingTitles.add(key);
        return true;
      });
    if (!raw.length) {
      setBrainOpen(false);
      toast("No duplicate tasks added", {
        description: "Those tasks are already in your active plan.",
      });
      return;
    }
    const scheduled = withSchedule(
      raw,
      now,
      tasks.filter((task) => !task.completed).map((task) => task.scheduledAt),
    );
    try {
      const saved = await createTasks(scheduled.map(toCreateTask));
      setTasks((prev) => [...prev, ...saved.map(fromStoredTask)]);
    } catch (error) {
      toast.error("Couldn't save tasks", {
        description: error instanceof Error ? error.message : "Database write failed.",
      });
      return;
    }
    setAiPowered(true);
    setBrainOpen(false);
    setHighlightedId(null);
    toast.success("Priora prioritized your day", {
      description: `${raw.length} new ${raw.length === 1 ? "task" : "tasks"} saved to your database.`,
    });
  };

  const handleSelectSlot = (taskId?: string) => {
    if (!taskId) return;
    setHighlightedId(taskId);
    if (typeof document !== "undefined") {
      const el = document.getElementById(`task-${taskId}`);
      el?.scrollIntoView({ behavior: "smooth", block: "center" });
    }
    window.setTimeout(() => setHighlightedId((id) => (id === taskId ? null : id)), 2400);
  };

  const handleComplete = useCallback((id: string) => {
    setCompletingId(id);
    window.setTimeout(() => {
      const completedAt = new Date();
      updateTask(id, {
        status: "completed",
        completedAt: completedAt.toISOString(),
      })
        .then((saved) => {
          setTasks((prev) => prev.map((t) => (t.id === id ? fromStoredTask(saved) : t)));
          toast.success("Task completed! +10 XP", {
            description: "Nice momentum - Priora updated your streak.",
          });
        })
        .catch((error) => {
          toast.error("Couldn't mark task complete", {
            description: error instanceof Error ? error.message : "Database update failed.",
          });
        })
        .finally(() => setCompletingId(null));
    }, 450);
  }, []);

  const handleReschedule = useCallback(
    async (id: string, unavailable: AvailabilityBlock[] = []) => {
      const t = tasks.find((x) => x.id === id);
      if (!t) return;
      toast("Asking Gemini for the next open slot…", { description: t.title });
      const occupiedTasks = activeTasks.filter((x) => x.id !== id);
      const occupiedDates = occupiedTasks.map((x) => x.scheduledAt);
      const occupied = [
        ...occupiedTasks.map((x) => fmt(x.scheduledAt)),
        ...unavailable.map(formatBlock),
      ];

      let newDate: Date | null = null;
      try {
        const { time } = await suggestRescheduleSlot(t.title, occupied);
        const [hh, mm] = time.split(":").map(Number);
        const d = new Date();
        if (d.getHours() * 60 + d.getMinutes() >= hh * 60 + mm) d.setDate(d.getDate() + 1);
        d.setHours(hh, mm, 0, 0);
        newDate = d;
      } catch {
        /* fall through */
      }
      if (
        !newDate ||
        overlapsUnavailable(newDate, t.minutes, unavailable) ||
        overlapsOccupied(newDate, t.minutes, occupiedDates)
      ) {
        newDate = findNextAvailableSlot(new Date(), t.minutes, occupiedDates, unavailable);
      }
      try {
        const saved = await updateTask(id, {
          dueDate: newDate.toISOString(),
          scheduledAt: newDate.toISOString(),
          notified10: false,
        });
        setTasks((prev) => prev.map((x) => (x.id === id ? fromStoredTask(saved) : x)));
      } catch (error) {
        toast.error("Couldn't reschedule task", {
          description: error instanceof Error ? error.message : "Database update failed.",
        });
        return;
      }
      toast.success("Rescheduled", {
        description: `${t.title} → ${newDate.toLocaleString(undefined, { weekday: "short", hour: "2-digit", minute: "2-digit" })}`,
      });
    },
    [tasks, activeTasks],
  );

  const handleAvailabilitySubmit = async (blocks: AvailabilityBlock[]) => {
    if (!availabilityTaskId) return;
    await handleReschedule(availabilityTaskId, blocks);
    setAvailabilityTaskId(null);
  };

  const handleExportIcs = () => {
    const list = activeTasks.length ? activeTasks : tasks.filter((t) => !t.completed);
    if (!list.length) {
      toast.error("Nothing to export yet — add tasks first.");
      return;
    }
    downloadIcs(list);
    toast.success("Schedule synchronized flawlessly with Google Calendar!", {
      description: `Priora_Schedule.ics with ${list.length} events downloaded.`,
    });
  };

  const handleOpenNotifications = () => {
    setNotifOpen((open) => {
      const next = !open;
      if (next) {
        setNotifications((prev) =>
          prev.map((notification) => ({ ...notification, unread: false })),
        );
      }
      return next;
    });
  };

  const handleLogout = async () => {
    try {
      await logoutUser();
    } finally {
      setCurrentUser(null);
      setTasks([]);
      toast("Signed out", { description: "Login again with your registered credentials." });
      void navigate({ to: "/login" });
    }
  };

  const handleRequestNotifications = async () => {
    if (typeof window === "undefined" || !("Notification" in window)) {
      toast.error("Notifications aren't supported in this browser.");
      return;
    }
    if (Notification.permission === "granted") {
      toast("Notifications already enabled", {
        description: "Priora will ping you 10 min before each task.",
      });
      return;
    }
    const res = await Notification.requestPermission();
    if (res === "granted") {
      toast.success("Notifications enabled", {
        description: "We'll chime 10 min before each task.",
      });
      try {
        new Notification("Priora is now proactive", {
          body: "Heads-up alerts armed for your schedule.",
        });
      } catch {
        /* ignore */
      }
    } else {
      toast.error("Permission denied", {
        description: "Enable notifications in your browser to receive alerts.",
      });
    }
  };

  if (!tasksLoaded) {
    return (
      <div className="min-h-screen grid place-items-center text-foreground">
        <div className="glass-strong rounded-2xl px-5 py-4 text-sm text-muted-foreground">
          Loading your private workspace...
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen text-foreground">
      <MobileTopBar onMenu={() => setSidebarOpen(true)} initials={initials} />

      <div className="flex">
        <Sidebar
          open={sidebarOpen}
          onClose={() => setSidebarOpen(false)}
          activeNav={activeView}
          user={currentUser}
          onLogout={handleLogout}
          completedToday={completedTodayCount}
          todayTotal={todayTaskCount}
          xp={totalCompletedCount * 10}
          onNav={(label) => {
            if (
              label === "Dashboard" ||
              label === "Priorities" ||
              label === "Timeline" ||
              label === "Insights"
            ) {
              setActiveView(label);
            }
            setSidebarOpen(false);
          }}
        />

        <main className="flex-1 min-w-0 px-5 lg:px-10 pb-44 pt-6 lg:pt-10">
          {/* Header */}
          <header className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4 sm:flex sm:flex-wrap sm:justify-between mb-8">
            <div className="min-w-0">
              <div className="flex items-center gap-2 text-xs uppercase tracking-[0.18em] text-muted-foreground">
                <span className="size-1.5 rounded-full bg-rasa-jade animate-pulse" />
                <span className="tabular-nums">
                  {now.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}
                </span>
                <span className="opacity-60">·</span>
                {now.toLocaleDateString(undefined, {
                  weekday: "long",
                  month: "long",
                  day: "numeric",
                })}
              </div>
              <h1 className="mt-2 truncate text-2xl sm:text-3xl lg:text-4xl font-bold">
                {greeting}, {firstName}.
              </h1>
              <p className="mt-1 text-sm text-muted-foreground">
                Your day, intelligently organized —{" "}
                <span className="text-foreground font-medium">{activeTasks.length}</span> moves
                queued
                {overdueTasks.length > 0 && (
                  <>
                    {" "}
                    ·{" "}
                    <span className="text-rasa-amber font-medium">
                      {overdueTasks.length} need rescheduling
                    </span>
                  </>
                )}
                .
              </p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <div className="relative">
                <button
                  onClick={handleOpenNotifications}
                  className="glass rounded-xl p-2.5 hover:bg-white/10 transition relative"
                  aria-label="Notifications"
                >
                  <Bell className="size-4" />
                  {unreadCount > 0 && (
                    <span className="absolute -top-1 -right-1 min-w-4 h-4 px-1 rounded-full bg-rasa-rose text-[10px] font-bold leading-4 text-white text-center">
                      {unreadCount}
                    </span>
                  )}
                </button>
                {notifOpen && (
                  <NotificationsDropdown
                    items={notifications}
                    onClose={() => setNotifOpen(false)}
                    onMarkAllRead={() => {
                      setNotifications((p) => p.map((n) => ({ ...n, unread: false })));
                      setNotifOpen(false);
                    }}
                    onRequestPush={handleRequestNotifications}
                  />
                )}
              </div>
              <button
                onClick={() => setSettingsOpen(true)}
                className="glass rounded-xl p-2.5 hover:bg-white/10 transition"
                aria-label="Settings"
              >
                <Settings className="size-4" />
              </button>
              {currentUser ? (
                <button
                  onClick={handleLogout}
                  className="glass rounded-xl p-2.5 hover:bg-white/10 transition"
                  aria-label="Logout"
                >
                  <LogIn className="size-4 rotate-180" />
                </button>
              ) : (
                <Link
                  to="/login"
                  className="glass rounded-xl p-2.5 hover:bg-white/10 transition"
                  aria-label="Login"
                >
                  <LogIn className="size-4" />
                </Link>
              )}
              <button
                className="glass rounded-xl p-2.5 hover:bg-white/10 transition"
                aria-label="Search"
              >
                <Search className="size-4" />
              </button>
              <div className="glass rounded-xl pl-1 pr-3 py-1 flex items-center gap-2">
                <div className="size-8 rounded-lg bg-[image:var(--gradient-violet)] grid place-items-center text-sm font-bold">
                  {initials}
                </div>
                <div className="hidden sm:block">
                  <div className="text-sm font-medium leading-none">{displayName}</div>
                  <div className="text-[10px] text-muted-foreground mt-0.5">Pro · Priora</div>
                </div>
              </div>
            </div>
          </header>

          {overdueTasks.length > 0 && activeView !== "Insights" && (
            <RescueSection
              tasks={overdueTasks}
              onReschedule={(id) => setAvailabilityTaskId(id)}
              onComplete={handleComplete}
              completingId={completingId}
            />
          )}

          {activeView === "Dashboard" && (
            <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_360px] gap-6">
              <section className="space-y-6 min-w-0">
                {focus ? (
                  <FocusHero
                    task={focus}
                    onExecute={() => setActiveTask(focus)}
                    onComplete={() => handleComplete(focus.id)}
                    highlighted={highlightedId === focus.id}
                    completing={completingId === focus.id}
                  />
                ) : (
                  <EmptyHero onBrainDump={() => setBrainOpen(true)} />
                )}
                <StatStrip
                  activeTasks={activeTasks}
                  completedToday={completedTodayCount}
                  scheduledMinutes={scheduledMinutes}
                  aiConfidence={aiConfidence}
                  calmScore={calmScore}
                />
                <PriorityList
                  tasks={activeTasks.slice(1)}
                  onExecute={(t) => setActiveTask(t)}
                  onComplete={handleComplete}
                  onBrainDump={() => setBrainOpen(true)}
                  aiPowered={aiPowered}
                  highlightedId={highlightedId}
                  completingId={completingId}
                />
              </section>

              <aside className="space-y-6 min-w-0">
                <TimelineWidget
                  slots={timeline}
                  onSelect={handleSelectSlot}
                  highlightedId={highlightedId}
                  now={now}
                  onExport={handleExportIcs}
                />
              </aside>
            </div>
          )}

          {activeView === "Priorities" && (
            <PriorityList
              tasks={activeTasks}
              onExecute={(t) => setActiveTask(t)}
              onComplete={handleComplete}
              onBrainDump={() => setBrainOpen(true)}
              aiPowered={aiPowered}
              highlightedId={highlightedId}
              completingId={completingId}
            />
          )}

          {activeView === "Timeline" && (
            <TimelineWidget
              slots={timeline}
              onSelect={handleSelectSlot}
              highlightedId={highlightedId}
              now={now}
              onExport={handleExportIcs}
              expanded
            />
          )}

          {activeView === "Insights" && <InsightsView tasks={tasks} now={now} />}
        </main>
      </div>

      <AIBar onBrainDump={() => setBrainOpen(true)} />
      <SiteFooter activeView={activeView} onNav={setActiveView} />
      <ExecuteModal
        task={activeTask}
        onClose={() => setActiveTask(null)}
        onComplete={(id) => {
          setActiveTask(null);
          handleComplete(id);
        }}
      />
      <BrainDumpModal
        open={brainOpen}
        onClose={() => setBrainOpen(false)}
        onResult={handlePrioritized}
        onNeedKey={() => {
          toast.error("Gemini is not configured yet", {
            description: "Add GEMINI_API_KEY in the backend environment and restart the app.",
          });
        }}
      />
      <SettingsModal
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        onRequestNotifications={handleRequestNotifications}
      />
      <AvailabilityModal
        task={availabilityTask}
        onClose={() => setAvailabilityTaskId(null)}
        onSubmit={handleAvailabilitySubmit}
      />
    </div>
  );
}

/* ---------- Sidebar ---------- */
function Sidebar({
  open,
  onClose,
  activeNav,
  user,
  onLogout,
  completedToday,
  todayTotal,
  xp,
  onNav,
}: {
  open: boolean;
  onClose: () => void;
  activeNav: string;
  user: PrioraUser | null;
  onLogout: () => void;
  completedToday: number;
  todayTotal: number;
  xp: number;
  onNav: (label: string) => void;
}) {
  const items = [
    { icon: LayoutDashboard, label: "Dashboard" },
    { icon: Target, label: "Priorities" },
    { icon: Calendar, label: "Timeline" },
    { icon: BarChart3, label: "Insights" },
  ];
  return (
    <>
      {open && (
        <button
          aria-label="Close menu"
          onClick={onClose}
          className="lg:hidden fixed inset-0 z-40 bg-black/60 backdrop-blur-sm"
        />
      )}
      <aside
        className={`fixed lg:sticky top-0 left-0 z-50 lg:z-auto h-screen w-72 shrink-0
          glass-strong border-r border-white/5
          transform transition-transform duration-300
          ${open ? "translate-x-0" : "-translate-x-full"} lg:translate-x-0
          flex flex-col`}
      >
        <div className="flex items-center justify-between px-5 py-5">
          <div className="flex items-center gap-2.5">
            <div className="size-9 rounded-xl bg-[image:var(--gradient-hero)] grid place-items-center shadow-neon-violet">
              <Sparkles className="size-4.5" strokeWidth={2.5} />
            </div>
            <div>
              <div className="text-base font-bold tracking-tight">Priora</div>
              <div className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                Proactive AI
              </div>
            </div>
          </div>
          <button onClick={onClose} className="lg:hidden p-1.5 rounded-lg hover:bg-white/5">
            <X className="size-5" />
          </button>
        </div>

        <nav className="px-3 flex-1 overflow-y-auto">
          <div className="px-2 pb-2 text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
            Workspace
          </div>
          <ul className="space-y-1">
            {items.map((it) => {
              const isActive = activeNav === it.label;
              return (
                <li key={it.label}>
                  <button
                    type="button"
                    onClick={() => onNav(it.label)}
                    className={`group w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm transition
                      ${
                        isActive
                          ? "bg-gradient-to-r from-rasa-violet/25 via-rasa-rose/15 to-transparent text-foreground shadow-neon-violet border border-rasa-violet/30"
                          : "text-muted-foreground hover:text-foreground hover:bg-white/[0.04] border border-transparent"
                      }`}
                  >
                    <it.icon className={`size-4 ${isActive ? "text-rasa-violet" : ""}`} />
                    <span className="flex-1 text-left">{it.label}</span>
                    {it.badge && (
                      <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-md bg-rasa-rose/20 text-rasa-rose">
                        {it.badge}
                      </span>
                    )}
                    {isActive && <ChevronRight className="size-3.5 opacity-60" />}
                  </button>
                </li>
              );
            })}
          </ul>

          <div className="px-2 pt-6 pb-2 text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
            Today
          </div>
          <div className="glass rounded-2xl p-4">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Flame className="size-3.5 text-rasa-rose" /> Streak
            </div>
            <div className="mt-1 text-2xl font-bold">{completedToday > 0 ? "1 day" : "0 days"}</div>
            <div className="mt-3 h-1.5 rounded-full bg-white/5 overflow-hidden">
              <div
                className="h-full bg-[image:var(--gradient-gold)]"
                style={{
                  width: `${todayTotal ? Math.round((completedToday / todayTotal) * 100) : 0}%`,
                }}
              />
            </div>
            <div className="mt-2 flex justify-between text-[11px] text-muted-foreground">
              <span>
                {completedToday} / {todayTotal} done
              </span>
              <span className="text-rasa-gold">+{xp} XP</span>
            </div>
          </div>
        </nav>

        <div className="p-3">
          {user ? (
            <button
              onClick={onLogout}
              className="mb-1 w-full flex items-center gap-2 px-3 py-2.5 rounded-xl text-sm text-muted-foreground hover:text-foreground hover:bg-white/[0.04] transition"
            >
              <LogIn className="size-4 rotate-180" /> Logout
            </button>
          ) : (
            <Link
              to="/login"
              onClick={onClose}
              className="mb-1 w-full flex items-center gap-2 px-3 py-2.5 rounded-xl text-sm text-muted-foreground hover:text-foreground hover:bg-white/[0.04] transition"
            >
              <LogIn className="size-4" /> Login
            </Link>
          )}
        </div>
      </aside>
    </>
  );
}

function MobileTopBar({ onMenu, initials }: { onMenu: () => void; initials: string }) {
  return (
    <div className="lg:hidden sticky top-0 z-30 glass-strong border-b border-white/5 px-4 py-3 flex items-center justify-between">
      <button onClick={onMenu} className="p-2 -ml-2 rounded-lg hover:bg-white/5">
        <Menu className="size-5" />
      </button>
      <div className="flex items-center gap-2">
        <div className="size-7 rounded-lg bg-[image:var(--gradient-hero)] grid place-items-center">
          <Sparkles className="size-3.5" />
        </div>
        <span className="font-bold">Priora</span>
      </div>
      <div className="size-8 rounded-lg bg-[image:var(--gradient-violet)] grid place-items-center text-sm font-bold">
        {initials}
      </div>
    </div>
  );
}

/* ---------- Rescue Section ---------- */
function RescueSection({
  tasks,
  onReschedule,
  onComplete,
  completingId,
}: {
  tasks: Task[];
  onReschedule: (id: string) => void;
  onComplete: (id: string) => void;
  completingId: string | null;
}) {
  return (
    <div className="mb-6 rounded-3xl border border-rasa-amber/30 bg-rasa-amber/[0.06] p-5 sm:p-6 backdrop-blur-md">
      <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.18em] text-rasa-amber">
        <AlarmClock className="size-3.5" /> Needs rescheduling · {tasks.length}
      </div>
      <h3 className="mt-1.5 text-lg sm:text-xl font-bold">
        Priora caught these slipping past their slot.
      </h3>
      <p className="text-xs text-muted-foreground mt-1">
        Tap Reschedule to tell Priora when you are unavailable before it moves the task.
      </p>
      <ul className="mt-4 space-y-2.5">
        {tasks.map((t) => (
          <li
            key={t.id}
            className={`rounded-2xl border border-rasa-amber/20 bg-black/20 p-4 flex flex-wrap items-center gap-3 transition ${completingId === t.id ? "scale-[0.98] opacity-50" : ""}`}
          >
            <div className="size-10 shrink-0 rounded-xl bg-rasa-amber/20 text-rasa-amber grid place-items-center">
              <t.icon className="size-5" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="font-semibold truncate">{t.title}</div>
              <div className="text-[11px] text-muted-foreground mt-0.5">
                Was due{" "}
                {t.scheduledAt.toLocaleTimeString(undefined, {
                  hour: "2-digit",
                  minute: "2-digit",
                })}{" "}
                · {t.minutes} min · {t.energy} energy
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => onReschedule(t.id)}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold bg-rasa-amber text-black hover:opacity-90 transition disabled:opacity-60"
              >
                <RefreshCw className="size-3.5" />
                Reschedule
              </button>
              <button
                onClick={() => onComplete(t.id)}
                className="size-9 rounded-lg glass hover:bg-white/10 transition grid place-items-center"
                aria-label="Mark complete"
              >
                <CheckCircle2 className="size-4" />
              </button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

function AvailabilityModal({
  task,
  onClose,
  onSubmit,
}: {
  task: Task | null;
  onClose: () => void;
  onSubmit: (blocks: AvailabilityBlock[]) => Promise<void>;
}) {
  const [start, setStart] = useState(() => fmt(new Date()));
  const [end, setEnd] = useState(() => {
    const d = new Date();
    d.setHours(d.getHours() + 1);
    return fmt(d);
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const nextStart = new Date();
    const nextEnd = new Date();
    nextEnd.setHours(nextEnd.getHours() + 1);
    setStart(fmt(nextStart));
    setEnd(fmt(nextEnd));
    setError(null);
  }, [task?.id]);

  const submit = async (blocks: AvailabilityBlock[]) => {
    setSaving(true);
    setError(null);
    try {
      await onSubmit(blocks);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not reschedule this task.");
    } finally {
      setSaving(false);
    }
  };

  const submitUnavailable = () => {
    if (timeToMinutes(end) <= timeToMinutes(start)) {
      setError("End time must be after start time.");
      return;
    }
    void submit([{ start, end }]);
  };

  return (
    <Dialog open={!!task} onOpenChange={(open) => !open && !saving && onClose()}>
      <DialogContent className="glass-strong border-white/10 sm:max-w-md p-0 overflow-hidden">
        <div className="relative p-6 pb-4 border-b border-white/5">
          <div
            aria-hidden
            className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-rasa-amber to-transparent"
          />
          <DialogHeader>
            <div className="flex items-center gap-2 text-[10px] uppercase tracking-[0.18em] text-rasa-amber">
              <AlarmClock className="size-3" /> Time is up
            </div>
            <DialogTitle className="text-2xl font-bold mt-2">When are you unavailable?</DialogTitle>
            <DialogDescription className="text-muted-foreground">
              Priora will move {task?.title ? `"${task.title}"` : "this task"} outside that time.
            </DialogDescription>
          </DialogHeader>
        </div>

        <div className="p-6 space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <label className="space-y-2 text-sm font-medium">
              From
              <input
                type="time"
                value={start}
                onChange={(event) => setStart(event.target.value)}
                className="w-full rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2.5 text-sm outline-none focus:border-rasa-amber/60"
              />
            </label>
            <label className="space-y-2 text-sm font-medium">
              Until
              <input
                type="time"
                value={end}
                onChange={(event) => setEnd(event.target.value)}
                className="w-full rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2.5 text-sm outline-none focus:border-rasa-amber/60"
              />
            </label>
          </div>

          {error && (
            <div className="rounded-xl border border-rasa-rose/30 bg-rasa-rose/10 px-3 py-2 text-xs text-rasa-rose">
              {error}
            </div>
          )}

          <div className="flex flex-wrap justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={() => void submit([])}
              disabled={saving}
              className="px-4 py-2.5 rounded-xl text-sm bg-white/10 hover:bg-white/15 transition disabled:opacity-60"
            >
              I am available now
            </button>
            <button
              type="button"
              onClick={submitUnavailable}
              disabled={saving}
              className="px-5 py-2.5 rounded-xl text-sm font-semibold bg-rasa-amber text-black hover:opacity-90 transition inline-flex items-center gap-2 disabled:opacity-60"
            >
              {saving && <Loader2 className="size-4 animate-spin" />}
              Reschedule
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/* ---------- Focus Hero ---------- */
function FocusHero({
  task,
  onExecute,
  onComplete,
  highlighted,
  completing,
}: {
  task: Task;
  onExecute: () => void;
  onComplete: () => void;
  highlighted?: boolean;
  completing?: boolean;
}) {
  return (
    <div
      id={`task-${task.id}`}
      className={`relative overflow-hidden rounded-3xl glass-strong shadow-neon-violet transition duration-500
        ${highlighted ? "ring-2 ring-rasa-gold ring-offset-2 ring-offset-background" : ""}
        ${completing ? "scale-[0.985] opacity-60" : ""}`}
    >
      <div
        aria-hidden
        className="absolute inset-0 opacity-80"
        style={{ background: "var(--gradient-hero)" }}
      />
      <div
        aria-hidden
        className="absolute inset-0 mix-blend-overlay opacity-40"
        style={{
          background:
            "radial-gradient(80% 60% at 100% 0%, oklch(0.95 0.18 90 / 0.5), transparent 60%)",
        }}
      />
      <div className="relative p-6 sm:p-8 lg:p-10">
        <div className="flex flex-wrap items-center gap-2 text-[11px] uppercase tracking-[0.2em]">
          <span className="px-2.5 py-1 rounded-full bg-black/40 backdrop-blur-md flex items-center gap-1.5">
            <Flame className="size-3" /> Focus mode
          </span>
          <span className="px-2.5 py-1 rounded-full bg-white/15 backdrop-blur-md">
            Most urgent · Now
          </span>
        </div>
        <h2 className="mt-5 text-3xl sm:text-4xl lg:text-5xl font-bold leading-[1.05] max-w-3xl">
          {task.title}
        </h2>
        <p className="mt-3 text-sm sm:text-base text-white/80 max-w-2xl">{task.context}</p>

        <div className="mt-6 flex flex-wrap items-center gap-2.5">
          <Chip icon={Brain} label={`Priority ${task.score}`} tone="dark" />
          <Chip icon={Clock} label={`${task.minutes} min`} tone="dark" />
          <Chip icon={Flame} label={`${task.energy} energy`} tone="dark" />
          <Chip
            icon={Calendar}
            label={task.scheduledAt.toLocaleTimeString(undefined, {
              hour: "2-digit",
              minute: "2-digit",
            })}
            tone="dark"
          />
        </div>

        <div className="mt-7 flex flex-wrap gap-3">
          <button
            onClick={onExecute}
            className="group inline-flex items-center gap-2 px-5 py-3 rounded-xl bg-black text-white font-semibold hover:bg-neutral-900 transition shadow-lg"
          >
            <Wand2 className="size-4" /> Auto-Execute plan
            <ArrowUpRight className="size-4 transition group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
          </button>
          <button
            onClick={onComplete}
            className="inline-flex items-center gap-2 px-5 py-3 rounded-xl bg-white/15 backdrop-blur-md text-white hover:bg-white/25 transition"
          >
            <CheckCircle2 className="size-4" /> Mark complete
          </button>
        </div>
      </div>
    </div>
  );
}

function EmptyHero({ onBrainDump }: { onBrainDump: () => void }) {
  return (
    <div className="rounded-3xl glass-strong p-10 text-center">
      <Sparkles className="mx-auto size-8 text-rasa-violet" />
      <h2 className="mt-3 text-2xl font-bold">All clear — beautifully done.</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Drop a brain-dump and Priora will organize the next move.
      </p>
      <button
        onClick={onBrainDump}
        className="mt-5 inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-[image:var(--gradient-violet)] text-white font-semibold shadow-neon-violet hover:opacity-90 transition"
      >
        <Brain className="size-4" /> Open brain dump
      </button>
    </div>
  );
}

function Chip({
  icon: Icon,
  label,
  tone = "glass",
}: {
  icon: typeof Mail;
  label: string;
  tone?: "glass" | "dark";
}) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium
      ${tone === "dark" ? "bg-black/40 backdrop-blur-md text-white/90" : "glass text-foreground"}`}
    >
      <Icon className="size-3.5" /> {label}
    </span>
  );
}

/* ---------- Stat strip ---------- */
function formatMinutes(total: number): string {
  const hours = Math.floor(total / 60);
  const minutes = total % 60;
  if (!hours) return `${minutes}m`;
  if (!minutes) return `${hours}h`;
  return `${hours}h ${minutes}m`;
}

function StatStrip({
  activeTasks,
  completedToday,
  scheduledMinutes,
  aiConfidence,
  calmScore,
}: {
  activeTasks: Task[];
  completedToday: number;
  scheduledMinutes: number;
  aiConfidence: number;
  calmScore: number;
}) {
  const stats = [
    {
      label: "AI confidence",
      value: `${aiConfidence}%`,
      hint: activeTasks.length ? "Average active priority" : "Add tasks to calculate",
      accent: "violet" as const,
    },
    {
      label: "Deep work",
      value: formatMinutes(scheduledMinutes),
      hint: `${activeTasks.length} active ${activeTasks.length === 1 ? "block" : "blocks"}`,
      accent: "rose" as const,
    },
    {
      label: "Focus blocks",
      value: `${completedToday} / ${completedToday + activeTasks.length}`,
      hint: activeTasks.length ? `${activeTasks.length} still queued` : "Clear for now",
      accent: "gold" as const,
    },
    {
      label: "Calm score",
      value: calmScore.toFixed(1),
      hint: calmScore >= 8 ? "Steady all day" : "Reschedule pressure rising",
      accent: "jade" as const,
    },
  ];
  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
      {stats.map((s) => {
        const a = accentMap[s.accent];
        return (
          <div key={s.label} className="glass rounded-2xl p-4 hover:bg-white/[0.06] transition">
            <div className="flex items-center gap-2">
              <span className={`size-1.5 rounded-full ${a.dot}`} />
              <span className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
                {s.label}
              </span>
            </div>
            <div className="mt-2 text-2xl font-bold">{s.value}</div>
            <div className="text-[11px] text-muted-foreground mt-1">{s.hint}</div>
          </div>
        );
      })}
    </div>
  );
}

/* ---------- Priority list ---------- */
function PriorityList({
  tasks,
  onExecute,
  onComplete,
  onBrainDump,
  aiPowered,
  highlightedId,
  completingId,
}: {
  tasks: Task[];
  onExecute: (t: Task) => void;
  onComplete: (id: string) => void;
  onBrainDump: () => void;
  aiPowered: boolean;
  highlightedId: string | null;
  completingId: string | null;
}) {
  return (
    <div className="glass-strong rounded-3xl p-5 sm:p-6">
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 sm:flex sm:justify-between">
        <div className="min-w-0">
          <h3 className="text-lg font-bold flex items-center gap-2">
            Intelligent prioritization
            {aiPowered && (
              <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-md bg-rasa-violet/20 text-rasa-violet uppercase tracking-wider">
                Gemini
              </span>
            )}
          </h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            Ranked by deadline, energy fit & semantic weight.
          </p>
        </div>
        <button
          onClick={onBrainDump}
          className="shrink-0 inline-flex items-center gap-1.5 text-xs px-3 py-2 rounded-lg bg-[image:var(--gradient-violet)] text-white hover:opacity-90 transition shadow-neon-violet"
        >
          <Brain className="size-3.5" /> Brain dump
        </button>
      </div>

      <ul className="mt-5 space-y-2.5">
        {tasks.map((t) => {
          const a = accentMap[t.accent];
          const isHi = highlightedId === t.id;
          const isCompleting = completingId === t.id;
          return (
            <li
              id={`task-${t.id}`}
              key={t.id}
              className={`group relative rounded-2xl border bg-white/[0.02] hover:bg-white/[0.05]
                p-4 sm:p-5 transition duration-500 hover:ring-1 ${a.ring}
                ${isHi ? "border-rasa-gold/60 ring-2 ring-rasa-gold/60 bg-rasa-gold/5" : "border-white/5"}
                ${isCompleting ? "scale-[0.97] opacity-40" : ""}`}
            >
              <div className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-4">
                <div
                  className={`size-11 shrink-0 rounded-xl grid place-items-center ${a.bg} ${a.text}`}
                >
                  <t.icon className="size-5" />
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-2 min-w-0">
                    <h4 className="truncate font-semibold text-[15px]">{t.title}</h4>
                  </div>
                  <p className="text-xs text-muted-foreground truncate mt-0.5">{t.context}</p>
                  <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
                    <Tag tone={t.accent} icon={Brain}>
                      AI · {t.score}
                    </Tag>
                    <Tag icon={Clock}>{t.minutes} min</Tag>
                    <Tag icon={Flame}>{t.energy}</Tag>
                    <Tag icon={Calendar}>
                      {t.scheduledAt.toLocaleTimeString(undefined, {
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </Tag>
                  </div>
                </div>
                <div className="shrink-0 flex items-center gap-2">
                  <button
                    onClick={() => onExecute(t)}
                    className="hidden sm:inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold
                      bg-[image:var(--gradient-violet)] text-white hover:opacity-90 transition shadow-neon-violet"
                  >
                    <Wand2 className="size-3.5" /> Auto-Execute
                  </button>
                  <button
                    onClick={() => onComplete(t.id)}
                    className="size-9 rounded-lg glass hover:bg-white/10 hover:text-rasa-jade transition grid place-items-center"
                    aria-label="Mark complete"
                  >
                    <CheckCircle2 className="size-4" />
                  </button>
                </div>
              </div>
              <button
                onClick={() => onExecute(t)}
                className="sm:hidden mt-3 w-full inline-flex justify-center items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold
                  bg-[image:var(--gradient-violet)] text-white"
              >
                <Wand2 className="size-3.5" /> Auto-Execute
              </button>
            </li>
          );
        })}
        {!tasks.length && (
          <li className="text-center text-sm text-muted-foreground py-6">
            No more queued tasks — you're flying. ✨
          </li>
        )}
      </ul>
    </div>
  );
}

function Tag({
  children,
  icon: Icon,
  tone,
}: {
  children: React.ReactNode;
  icon: typeof Mail;
  tone?: keyof typeof accentMap;
}) {
  const a = tone ? accentMap[tone] : null;
  return (
    <span
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10.5px] font-medium
      ${a ? `${a.bg} ${a.text}` : "bg-white/[0.04] text-muted-foreground"}`}
    >
      <Icon className="size-3" /> {children}
    </span>
  );
}

/* ---------- Timeline ---------- */
function formatHour12(d: Date): string {
  return d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit", hour12: true });
}
function toIcsUtc(d: Date): string {
  // YYYYMMDDTHHmmssZ
  const iso = d.toISOString(); // 2025-06-25T14:00:00.000Z
  return iso.replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}
function googleCalUrl(title: string, start: Date, end: Date): string {
  const dates = `${toIcsUtc(start)}/${toIcsUtc(end)}`;
  return `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${encodeURIComponent(title)}&dates=${dates}`;
}

function TimelineWidget({
  slots,
  onSelect,
  highlightedId,
  now,
  onExport,
  expanded,
}: {
  slots: TimelineSlot[];
  onSelect: (taskId?: string) => void;
  highlightedId: string | null;
  now: Date;
  onExport: () => void;
  expanded?: boolean;
}) {
  const nowIndex = useMemo(() => {
    const i = slots.findIndex((s) => s.start.getTime() >= now.getTime());
    if (i === -1) return slots.length;
    return i;
  }, [slots, now]);

  const dateLabel = `Today — ${now.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })}`;

  return (
    <div className={`glass-strong rounded-3xl ${expanded ? "p-7" : "p-5 sticky top-6"}`}>
      <div className="sticky top-0 z-10 -mx-1 px-1 pb-3 mb-2 backdrop-blur-sm bg-background/40 rounded-t-2xl">
        <div className="flex items-center justify-between gap-2">
          <div>
            <h3 className={`${expanded ? "text-xl" : "text-base"} font-bold`}>{dateLabel}</h3>
            <p className="text-[11px] text-muted-foreground mt-0.5">
              Auto-scheduled · 15-min buffers ·{" "}
              <span className="tabular-nums">{formatHour12(now)}</span>
            </p>
          </div>
          <button
            onClick={onExport}
            className="shrink-0 inline-flex items-center gap-1.5 text-[11px] px-2.5 py-1.5 rounded-lg bg-[image:var(--gradient-gold)] text-black font-semibold hover:opacity-90 transition"
          >
            <Download className="size-3" /> Download .ics
          </button>
        </div>
      </div>

      <div className={`mt-2 relative pl-16 ${expanded ? "max-w-3xl mx-auto" : ""}`}>
        <div className="absolute left-11 top-1 bottom-1 w-px bg-gradient-to-b from-white/0 via-white/15 to-white/0" />
        <ul className="space-y-3">
          {slots.map((b, idx) => {
            const a = accentMap[b.accent];
            const isHi = !!b.taskId && b.taskId === highlightedId;
            const calUrl = b.taskId ? googleCalUrl(b.label, b.start, b.end) : null;
            return (
              <div key={b.id}>
                {idx === nowIndex && <NowMarker time={now} />}
                <li className="relative">
                  <span className="absolute -left-16 top-2 text-[11px] tabular-nums text-muted-foreground w-12 text-right">
                    {formatHour12(b.start)}
                  </span>
                  <span
                    className={`absolute -left-[18px] top-2.5 size-2.5 rounded-full ${a.dot} ${b.live ? "ring-4 ring-rasa-gold/20 animate-pulse-glow" : "ring-2 ring-background"}`}
                  />
                  <div
                    className={`group w-full rounded-xl p-3 border transition
                      ${
                        isHi
                          ? "border-rasa-gold/70 bg-rasa-gold/10 ring-2 ring-rasa-gold/40"
                          : b.live
                            ? "border-rasa-gold/40 bg-rasa-gold/5 hover:bg-rasa-gold/10"
                            : "border-white/5 bg-white/[0.02] hover:bg-white/[0.06]"
                      }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <button
                        type="button"
                        onClick={() => onSelect(b.taskId)}
                        className="text-left flex-1 min-w-0 cursor-pointer"
                      >
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium truncate">{b.label}</span>
                          {b.live && (
                            <span className="text-[9px] uppercase tracking-wider font-bold text-rasa-gold">
                              Now
                            </span>
                          )}
                        </div>
                        <div className="text-[11px] text-muted-foreground mt-0.5">
                          {formatHour12(b.start)} – {formatHour12(b.end)} · {b.duration} min
                        </div>
                      </button>
                      {calUrl && (
                        <a
                          href={calUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={(e) => e.stopPropagation()}
                          className="shrink-0 inline-flex items-center gap-1 text-[10px] px-2 py-1 rounded-md glass hover:bg-white/10 transition opacity-0 group-hover:opacity-100"
                          title="Add to Google Calendar"
                        >
                          <CalendarPlus className="size-3" /> Google
                        </a>
                      )}
                    </div>
                  </div>
                </li>
              </div>
            );
          })}
          {nowIndex === slots.length && <NowMarker time={now} />}
          {!slots.length && (
            <li className="text-center text-xs text-muted-foreground py-6">Schedule is clear.</li>
          )}
        </ul>
      </div>
    </div>
  );
}

function NowMarker({ time }: { time: Date }) {
  return (
    <div className="relative my-2">
      <div className="absolute -left-16 top-1/2 -translate-y-1/2 text-[10px] tabular-nums font-bold text-rasa-rose w-12 text-right">
        {formatHour12(time)}
      </div>
      <div className="absolute -left-[22px] top-1/2 -translate-y-1/2 size-3 rounded-full bg-rasa-rose shadow-[0_0_0_4px_rgba(255,90,120,0.18)] animate-pulse" />
      <div className="h-px bg-gradient-to-r from-rasa-rose via-rasa-rose/40 to-transparent" />
      <div className="absolute right-0 top-1/2 -translate-y-1/2 text-[9px] font-bold tracking-[0.18em] uppercase text-rasa-rose">
        Now
      </div>
    </div>
  );
}

/* ---------- Notifications dropdown ---------- */
function NotificationsDropdown({
  items,
  onClose,
  onMarkAllRead,
  onRequestPush,
}: {
  items: { id: string; title: string; body: string; unread: boolean }[];
  onClose: () => void;
  onMarkAllRead: () => void;
  onRequestPush: () => void;
}) {
  return (
    <>
      <div className="fixed inset-0 z-40" onClick={onClose} />
      <div className="absolute right-0 mt-2 w-80 glass-strong rounded-2xl p-3 shadow-2xl z-50">
        <div className="flex items-center justify-between px-1 pb-2">
          <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground">
            Notifications
          </div>
          <button onClick={onMarkAllRead} className="text-[10px] text-rasa-jade hover:underline">
            Mark all read
          </button>
        </div>
        <ul className="space-y-1.5 max-h-80 overflow-auto">
          {items.map((n) => (
            <li
              key={n.id}
              className="rounded-xl p-2.5 bg-white/[0.03] hover:bg-white/[0.06] transition"
            >
              <div className="flex items-start gap-2">
                {n.unread && (
                  <span className="mt-1.5 size-1.5 rounded-full bg-rasa-rose shrink-0" />
                )}
                <div className="min-w-0">
                  <div className="text-sm font-medium truncate">{n.title}</div>
                  <div className="text-[11px] text-muted-foreground">{n.body}</div>
                </div>
              </div>
            </li>
          ))}
        </ul>
        <button
          onClick={onRequestPush}
          className="mt-2 w-full text-[11px] px-2.5 py-2 rounded-lg bg-white/5 hover:bg-white/10 transition"
        >
          Enable system push notifications
        </button>
      </div>
    </>
  );
}

/* ---------- Insights view ---------- */
function InsightsView({ tasks, now }: { tasks: Task[]; now: Date }) {
  const completed = tasks.filter((task) => task.completed).length;
  const queued = tasks.filter((task) => !task.completed).length;
  const activeScores = tasks.filter((task) => !task.completed).map((task) => task.score);
  const focusScore = activeScores.length
    ? Math.round(activeScores.reduce((sum, score) => sum + score, 0) / activeScores.length)
    : 0;
  const completedToday = tasks.filter(
    (task) => task.completedAt?.toDateString() === now.toDateString(),
  ).length;
  return (
    <section className="space-y-6 max-w-4xl">
      <div>
        <h2 className="text-2xl font-bold">Weekly insights</h2>
        <p className="text-sm text-muted-foreground mt-1">
          A snapshot of how Priora has shaped your week.
        </p>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="glass-strong rounded-3xl p-6">
          <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground">
            Tasks completed
          </div>
          <div className="mt-2 text-4xl font-bold tabular-nums">{completed}</div>
          <div className="text-[11px] text-rasa-jade mt-1">{completedToday} completed today</div>
        </div>
        <div className="glass-strong rounded-3xl p-6">
          <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground">
            Focus score
          </div>
          <div className="mt-2 text-4xl font-bold tabular-nums">{focusScore}%</div>
          <div className="text-[11px] text-rasa-gold mt-1">Based on active priorities</div>
        </div>
        <div className="glass-strong rounded-3xl p-6">
          <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground">
            Currently queued
          </div>
          <div className="mt-2 text-4xl font-bold tabular-nums">{queued}</div>
          <div className="text-[11px] text-muted-foreground mt-1">Across today's schedule</div>
        </div>
      </div>
      <div className="glass rounded-3xl p-6">
        <div className="text-sm font-semibold mb-3">Energy peaks</div>
        <div className="flex items-end gap-1.5 h-24">
          {[40, 55, 72, 88, 80, 65, 70, 58, 45, 38].map((v, i) => (
            <div
              key={i}
              className="flex-1 rounded-md bg-[image:var(--gradient-violet)] opacity-90"
              style={{ height: `${v}%` }}
            />
          ))}
        </div>
      </div>
    </section>
  );
}

/* ---------- Site footer ---------- */
function SiteFooter({
  activeView,
  onNav,
}: {
  activeView: string;
  onNav: (v: "Dashboard" | "Priorities" | "Timeline" | "Insights") => void;
}) {
  const links: ("Dashboard" | "Priorities" | "Timeline" | "Insights")[] = [
    "Dashboard",
    "Priorities",
    "Timeline",
    "Insights",
  ];
  return (
    <footer className="fixed bottom-0 inset-x-0 z-20 border-t border-white/5 bg-background/85 backdrop-blur-md">
      <div className="px-5 lg:px-10 py-2.5 flex flex-wrap items-center justify-between gap-3 text-[11px] text-muted-foreground">
        <div className="flex items-center gap-2">
          <span className="size-1.5 rounded-full bg-rasa-jade" />
          <span>Priora · Your day, intelligently organized.</span>
        </div>
        <nav className="flex items-center gap-4">
          {links.map((l) => (
            <button
              key={l}
              onClick={() => onNav(l)}
              className={`transition hover:text-foreground ${activeView === l ? "text-foreground font-semibold" : ""}`}
            >
              {l}
            </button>
          ))}
        </nav>
      </div>
    </footer>
  );
}

function AIBar({ onBrainDump }: { onBrainDump: () => void }) {
  const [value, setValue] = useState("");
  return (
    <div className="fixed bottom-4 inset-x-4 lg:left-[304px] lg:right-8 z-30">
      <div className="glass-strong rounded-2xl shadow-neon-violet px-3 py-2.5 flex items-center gap-2">
        <div className="size-8 shrink-0 rounded-xl bg-[image:var(--gradient-hero)] grid place-items-center">
          <Sparkles className="size-4" />
        </div>
        <input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="Ask Priora — “Reschedule my afternoon around the viva”…"
          className="flex-1 bg-transparent outline-none text-sm placeholder:text-muted-foreground"
        />
        <button
          onClick={onBrainDump}
          className="hidden sm:flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] glass hover:bg-white/10 transition text-muted-foreground"
        >
          <Brain className="size-3" /> Brain dump
        </button>
        <button
          onClick={onBrainDump}
          className="size-9 grid place-items-center rounded-xl bg-white/5 hover:bg-white/10 transition"
          aria-label="Voice — opens brain dump with mic"
        >
          <Mic className="size-4 text-rasa-rose" />
        </button>
        <button
          className="size-9 grid place-items-center rounded-xl bg-[image:var(--gradient-violet)] hover:opacity-90 transition"
          aria-label="Send"
        >
          <Send className="size-4" />
        </button>
      </div>
    </div>
  );
}

/* ---------- Auto-Execute Gemini modal ---------- */
function ExecuteModal({
  task,
  onClose,
  onComplete,
}: {
  task: Task | null;
  onClose: () => void;
  onComplete: (id: string) => void;
}) {
  const open = !!task;
  const [loading, setLoading] = useState(false);
  const [content, setContent] = useState<string>("");
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const reqRef = useRef(0);

  useEffect(() => {
    if (!task) {
      setContent("");
      setCopied(false);
      setError(null);
      return;
    }
    const reqId = ++reqRef.current;
    setLoading(true);
    setError(null);
    setContent("");
    autoExecuteTask(task.title)
      .then((md) => {
        if (reqRef.current === reqId) setContent(md);
      })
      .catch((e) => {
        if (reqRef.current === reqId) setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (reqRef.current === reqId) setLoading(false);
      });
  }, [task]);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(content);
      setCopied(true);
      toast.success("Copied to clipboard");
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error("Couldn't access clipboard");
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="glass-strong border-white/10 sm:max-w-2xl p-0 overflow-hidden">
        <div className="relative p-6 pb-4 border-b border-white/5">
          <div
            aria-hidden
            className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-rasa-violet to-transparent"
          />
          <DialogHeader>
            <div className="flex items-center gap-2 text-[10px] uppercase tracking-[0.18em] text-rasa-violet">
              <Wand2 className="size-3" /> Auto-Execute · Gemini drafted
            </div>
            <DialogTitle className="text-2xl font-bold mt-2">{task?.title}</DialogTitle>
            <DialogDescription className="text-muted-foreground">
              Priora pulled this together so you can just review, copy, and ship.
            </DialogDescription>
          </DialogHeader>
        </div>

        <div className="p-6 max-h-[60vh] overflow-y-auto">
          {loading && (
            <div className="relative rounded-2xl p-8 border border-rasa-violet/30 bg-rasa-violet/[0.06] overflow-hidden">
              <div
                aria-hidden
                className="absolute inset-0 animate-pulse"
                style={{
                  background:
                    "radial-gradient(80% 60% at 30% 30%, oklch(0.7 0.18 300 / 0.25), transparent 60%)",
                }}
              />
              <div className="relative flex flex-col items-center justify-center gap-3 text-center">
                <Loader2 className="size-7 animate-spin text-rasa-violet" />
                <div className="text-sm font-medium">Gemini is composing your draft…</div>
                <div className="text-[11px] text-muted-foreground">Streaming structured output</div>
              </div>
            </div>
          )}
          {!loading && error && (
            <div className="flex items-start gap-2 text-xs text-rasa-rose bg-rasa-rose/10 border border-rasa-rose/20 rounded-lg p-3">
              <AlertCircle className="size-4 shrink-0 mt-0.5" /> <span>{error}</span>
            </div>
          )}
          {!loading && !error && (
            <div className="rounded-2xl bg-white/[0.03] border border-white/5 p-5">
              <MarkdownView text={content} />
            </div>
          )}
        </div>

        <div className="p-5 border-t border-white/5 flex flex-col-reverse sm:flex-row sm:justify-between gap-2">
          <button
            onClick={onClose}
            className="px-4 py-2.5 rounded-xl text-sm bg-white/5 hover:bg-white/10 transition"
          >
            Close
          </button>
          <div className="flex flex-col-reverse sm:flex-row gap-2">
            <button
              onClick={handleCopy}
              disabled={loading || !content}
              className="px-4 py-2.5 rounded-xl text-sm bg-white/10 hover:bg-white/15 transition inline-flex items-center justify-center gap-2 disabled:opacity-50"
            >
              {copied ? <Check className="size-4 text-rasa-jade" /> : <Copy className="size-4" />}
              {copied ? "Copied" : "Copy to clipboard"}
            </button>
            <button
              onClick={() => task && onComplete(task.id)}
              disabled={loading}
              className="px-5 py-2.5 rounded-xl text-sm font-semibold bg-[image:var(--gradient-violet)] hover:opacity-90 transition shadow-neon-violet inline-flex items-center justify-center gap-2 disabled:opacity-60"
            >
              <CheckCircle2 className="size-4" /> Mark as done
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/* ---------- Brain Dump Modal w/ voice ---------- */
function BrainDumpModal({
  open,
  onClose,
  onResult,
  onNeedKey,
}: {
  open: boolean;
  onClose: () => void;
  onResult: (tasks: AITask[], sourceText: string) => void;
  onNeedKey: () => void;
}) {
  const [text, setText] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [listening, setListening] = useState(false);
  const recRef = useRef<{ stop: () => void; abort: () => void } | null>(null);
  const finalRef = useRef("");

  const submit = useCallback(
    async (raw?: string) => {
      const payload = (raw ?? text).trim();
      setError(null);
      if (!payload) {
        setError("Type or speak a few tasks first.");
        return;
      }
      setLoading(true);
      try {
        const tasks = await prioritizeBrainDump(payload);
        if (!tasks.length) {
          setError("Gemini returned no tasks. Try rephrasing.");
          return;
        }
        onResult(tasks, payload);
        setText("");
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Something went wrong.";
        if (msg.includes("GEMINI_API_KEY") || msg.includes("not configured")) {
          onNeedKey();
          setError("Gemini is not configured on the backend yet.");
        } else {
          setError(msg);
        }
      } finally {
        setLoading(false);
      }
    },
    [text, onResult, onNeedKey],
  );

  const startListening = () => {
    if (typeof window === "undefined") return;
    const SR =
      (
        window as unknown as {
          SpeechRecognition?: new () => unknown;
          webkitSpeechRecognition?: new () => unknown;
        }
      ).SpeechRecognition ??
      (window as unknown as { webkitSpeechRecognition?: new () => unknown })
        .webkitSpeechRecognition;
    if (!SR) {
      toast.error("Voice input isn't supported in this browser.");
      return;
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rec: any = new (SR as new () => unknown)();
    rec.continuous = true;
    rec.interimResults = true;
    rec.lang = "en-US";

    finalRef.current = text ? text.trim() + " " : "";

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    rec.onresult = (e: any) => {
      let interim = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const transcript = e.results[i][0].transcript;
        if (e.results[i].isFinal) finalRef.current += transcript + " ";
        else interim += transcript;
      }
      setText((finalRef.current + interim).replace(/\s+/g, " ").trimStart());
    };
    rec.onerror = () => {
      setListening(false);
    };
    rec.onend = () => {
      setListening(false);
      const final = finalRef.current.trim();
      if (final) {
        // auto-submit when user stops speaking
        setTimeout(() => submit(final), 350);
      }
    };
    rec.start();
    recRef.current = rec;
    setListening(true);
    toast("Listening…", { description: "Speak naturally — Priora will parse when you pause." });
  };

  const stopListening = () => {
    recRef.current?.stop();
    setListening(false);
  };

  // Cleanup if modal closes
  useEffect(() => {
    if (!open && recRef.current) {
      recRef.current.abort();
      recRef.current = null;
      setListening(false);
    }
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={(o) => !o && !loading && onClose()}>
      <DialogContent className="glass-strong border-white/10 sm:max-w-2xl p-0 overflow-hidden">
        <div className="relative p-6 pb-4 border-b border-white/5">
          <div
            aria-hidden
            className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-rasa-violet to-transparent"
          />
          <DialogHeader>
            <div className="flex items-center gap-2 text-[10px] uppercase tracking-[0.18em] text-rasa-violet">
              <Brain className="size-3" /> Brain dump · Gemini Flash
            </div>
            <DialogTitle className="text-2xl font-bold mt-2">
              Drop everything on your mind
            </DialogTitle>
            <DialogDescription className="text-muted-foreground">
              Type or speak a messy list of tasks. Priora will parse, score and rank them.
            </DialogDescription>
          </DialogHeader>
        </div>

        <div className="p-6 space-y-4">
          <div className="relative">
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              disabled={loading}
              rows={7}
              placeholder={`e.g. I need to pay the hosting bill by Friday, finish B.Tech project logic tonight, and call the design client tomorrow afternoon...`}
              className="w-full rounded-2xl bg-white/[0.03] border border-white/10 focus:border-rasa-violet/60 focus:ring-2 focus:ring-rasa-violet/20 outline-none p-4 pr-14 text-sm leading-relaxed resize-none transition"
            />
            <button
              type="button"
              onClick={listening ? stopListening : startListening}
              disabled={loading}
              aria-label={listening ? "Stop listening" : "Start voice input"}
              className={`absolute bottom-3 right-3 size-10 grid place-items-center rounded-xl transition
                ${
                  listening
                    ? "bg-rasa-rose text-white shadow-[0_0_0_6px_rgba(255,90,120,0.18)] animate-pulse"
                    : "bg-white/10 hover:bg-white/20 text-rasa-rose"
                }`}
            >
              <Mic className="size-4" />
            </button>
          </div>
          {listening && (
            <div className="flex items-center gap-2 text-xs text-rasa-rose">
              <span className="relative flex size-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-rasa-rose/60" />
                <span className="relative inline-flex size-2 rounded-full bg-rasa-rose" />
              </span>
              Listening — pause when done and Priora will auto-prioritize.
            </div>
          )}
          {error && (
            <div className="flex items-start gap-2 text-xs text-rasa-rose bg-rasa-rose/10 border border-rasa-rose/20 rounded-lg p-3">
              <AlertCircle className="size-4 shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}
          <div className="text-[11px] text-muted-foreground">
            Tip: include deadlines and rough context — Gemini uses them to compute urgency.
          </div>
        </div>

        <div className="p-5 border-t border-white/5 flex flex-col-reverse sm:flex-row sm:justify-end gap-2">
          <button
            onClick={onClose}
            disabled={loading}
            className="px-4 py-2.5 rounded-xl text-sm bg-white/5 hover:bg-white/10 transition disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={() => submit()}
            disabled={loading}
            className="px-5 py-2.5 rounded-xl text-sm font-semibold bg-[image:var(--gradient-violet)] hover:opacity-90 transition shadow-neon-violet inline-flex items-center justify-center gap-2 disabled:opacity-60"
          >
            {loading ? (
              <>
                <Loader2 className="size-4 animate-spin" /> Prioritizing…
              </>
            ) : (
              <>
                <Sparkles className="size-4" /> Prioritize with Gemini
              </>
            )}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/* ---------- Settings Modal ---------- */
function SettingsModal({
  open,
  onClose,
  onRequestNotifications,
}: {
  open: boolean;
  onClose: () => void;
  onRequestNotifications: () => void;
}) {
  const permission =
    typeof window !== "undefined" && "Notification" in window ? Notification.permission : "default";

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="glass-strong border-white/10 sm:max-w-md p-0 overflow-hidden">
        <div className="relative p-6 pb-4 border-b border-white/5">
          <div
            aria-hidden
            className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-rasa-gold to-transparent"
          />
          <DialogHeader>
            <div className="flex items-center gap-2 text-[10px] uppercase tracking-[0.18em] text-rasa-gold">
              <Settings className="size-3" /> Settings
            </div>
            <DialogTitle className="text-2xl font-bold mt-2">Workspace settings</DialogTitle>
            <DialogDescription className="text-muted-foreground">
              Gemini runs from the backend. Add GEMINI_API_KEY to the server environment.
            </DialogDescription>
          </DialogHeader>
        </div>

        <div className="p-6 space-y-4">
          <div className="pt-2 border-t border-white/5">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-sm font-semibold flex items-center gap-2">
                  <Bell className="size-3.5 text-rasa-rose" /> Proactive notifications
                </div>
                <div className="text-[11px] text-muted-foreground mt-0.5">
                  {permission === "granted"
                    ? "Enabled — Priora will alert 10 min before each task."
                    : permission === "denied"
                      ? "Blocked in browser settings."
                      : "Allow Priora to ping you 10 minutes before each scheduled task."}
                </div>
              </div>
              <button
                onClick={onRequestNotifications}
                className="shrink-0 px-3 py-2 rounded-lg text-xs font-semibold bg-rasa-rose/15 text-rasa-rose hover:bg-rasa-rose/25 transition"
              >
                {permission === "granted" ? "On" : "Enable"}
              </button>
            </div>
          </div>
        </div>

        <div className="p-5 border-t border-white/5 flex justify-end gap-2">
          <button
            onClick={onClose}
            className="px-4 py-2.5 rounded-xl text-sm bg-white/5 hover:bg-white/10 transition"
          >
            Close
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
