import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import {
  ArrowRight,
  CalendarCheck2,
  CheckCircle2,
  Eye,
  EyeOff,
  LockKeyhole,
  Mail,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { toast } from "sonner";

import { loginUser, registerUser, resetPassword } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export const Route = createFileRoute("/login")({
  head: () => ({
    meta: [
      { title: "Login | Priora" },
      {
        name: "description",
        content: "Sign in to Priora and get back to your intelligently organized day.",
      },
    ],
  }),
  component: LoginPage,
});

function LoginPage() {
  const navigate = useNavigate();
  const [mode, setMode] = useState<"login" | "register" | "reset">("login");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const initials = useMemo(() => {
    const [name] = email.split("@");
    return name?.slice(0, 2).toUpperCase() || "PR";
  }, [email]);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");

    if (mode === "register" && !name.trim()) {
      setError("Enter your name to create an account.");
      return;
    }

    if (!email.trim() || !password.trim()) {
      setError("Enter your email and password to continue.");
      return;
    }

    if (!/^\S+@\S+\.\S+$/.test(email)) {
      setError("Use a valid email address.");
      return;
    }

    if ((mode === "register" || mode === "reset") && password.length < 6) {
      setError("Use at least 6 characters for your password.");
      return;
    }

    if ((mode === "register" || mode === "reset") && password !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }

    setSubmitting(true);
    try {
      if (mode === "register") {
        await registerUser({ name, email, password });
        toast.success("Account created", {
          description: "Your private workspace is ready.",
        });
        void navigate({ to: "/" });
        return;
      }

      if (mode === "reset") {
        await resetPassword(email, password);
        toast.success("Password reset", {
          description: "You are signed in with your new password.",
        });
        void navigate({ to: "/" });
        return;
      }

      await loginUser(email, password);
      toast.success("Welcome back", {
        description: "Your focus flow is ready.",
      });
      void navigate({ to: "/" });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to continue. Try again.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className="relative min-h-screen overflow-hidden bg-background text-foreground">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_18%_18%,oklch(0.68_0.20_305_/_0.20),transparent_32%),radial-gradient(circle_at_88%_12%,oklch(0.74_0.14_175_/_0.16),transparent_28%),linear-gradient(135deg,oklch(0.16_0.018_280),oklch(0.20_0.025_282))]" />
      <div className="relative z-10 grid min-h-screen lg:grid-cols-[1.05fr_0.95fr]">
        <section className="hidden lg:flex flex-col justify-between px-12 py-10">
          <Link to="/" className="inline-flex w-fit items-center gap-3 text-sm font-semibold">
            <span className="grid size-10 place-items-center rounded-2xl bg-[image:var(--gradient-hero)] shadow-neon-violet">
              <Sparkles className="size-5" />
            </span>
            Priora
          </Link>

          <div className="max-w-xl">
            <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5 text-xs text-muted-foreground">
              <ShieldCheck className="size-3.5 text-rasa-jade" />
              Private workspace access
            </div>
            <h1 className="text-5xl font-bold leading-[1.02] tracking-normal">
              Pick up exactly where your day left off.
            </h1>
            <p className="mt-5 max-w-lg text-base leading-7 text-muted-foreground">
              Sign in to review priorities, schedule your next focus block, and let Priora keep the
              noise sorted.
            </p>

            <div className="mt-10 grid max-w-lg grid-cols-2 gap-3">
              {[
                ["Today", "4 focus blocks", CalendarCheck2],
                ["Momentum", "7 day streak", CheckCircle2],
              ].map(([label, value, Icon]) => (
                <div key={label as string} className="glass rounded-2xl p-4">
                  <Icon className="mb-4 size-5 text-rasa-gold" />
                  <div className="text-xs uppercase text-muted-foreground">{label as string}</div>
                  <div className="mt-1 text-lg font-semibold">{value as string}</div>
                </div>
              ))}
            </div>
          </div>

          <p className="text-xs text-muted-foreground">
            Priora syncs your tasks, drafts, and schedule preferences after login.
          </p>
        </section>

        <section className="flex min-h-screen items-center justify-center px-5 py-10 sm:px-8">
          <div className="w-full max-w-md">
            <div className="mb-8 flex items-center justify-between lg:hidden">
              <Link to="/" className="inline-flex items-center gap-3 text-sm font-semibold">
                <span className="grid size-10 place-items-center rounded-2xl bg-[image:var(--gradient-hero)]">
                  <Sparkles className="size-5" />
                </span>
                Priora
              </Link>
              <Link
                to="/"
                className="text-sm text-muted-foreground transition hover:text-foreground"
              >
                Home
              </Link>
            </div>

            <div className="glass-strong rounded-3xl p-6 shadow-glass sm:p-8">
              <div className="mb-7 flex items-center gap-4">
                <div className="grid size-12 place-items-center rounded-2xl bg-white/10 text-sm font-bold text-rasa-gold">
                  {initials}
                </div>
                <div>
                  <h1 className="text-2xl font-bold tracking-normal">
                    {mode === "login"
                      ? "Welcome back"
                      : mode === "reset"
                        ? "Reset password"
                        : "Create account"}
                  </h1>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {mode === "login"
                      ? "Login with your registered credentials."
                      : mode === "reset"
                        ? "Set a new password for your registered email."
                        : "Register first, then use these credentials every time."}
                  </p>
                </div>
              </div>

              <form onSubmit={handleSubmit} className="space-y-5">
                {mode === "register" && (
                  <div className="space-y-2">
                    <Label htmlFor="name">Full name</Label>
                    <Input
                      id="name"
                      type="text"
                      autoComplete="name"
                      value={name}
                      onChange={(event) => setName(event.target.value)}
                      placeholder="Aniket R."
                      className="h-11 rounded-xl border-white/10 bg-white/[0.04]"
                    />
                  </div>
                )}

                <div className="space-y-2">
                  <Label htmlFor="email">Email address</Label>
                  <div className="relative">
                    <Mail className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      id="email"
                      type="email"
                      autoComplete="email"
                      value={email}
                      onChange={(event) => setEmail(event.target.value)}
                      placeholder="you@example.com"
                      className="h-11 rounded-xl border-white/10 bg-white/[0.04] pl-10"
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <div className="flex items-center justify-between gap-3">
                    <Label htmlFor="password">Password</Label>
                    {mode === "login" && (
                      <button
                        type="button"
                        onClick={() => {
                          setMode("reset");
                          setError("");
                          setPassword("");
                          setConfirmPassword("");
                        }}
                        className="text-xs text-rasa-gold transition hover:text-rasa-amber"
                      >
                        Forgot password?
                      </button>
                    )}
                  </div>
                  <div className="relative">
                    <LockKeyhole className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      id="password"
                      type={showPassword ? "text" : "password"}
                      autoComplete="current-password"
                      value={password}
                      onChange={(event) => setPassword(event.target.value)}
                      placeholder="Enter password"
                      className="h-11 rounded-xl border-white/10 bg-white/[0.04] pl-10 pr-10"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword((value) => !value)}
                      className="absolute right-2 top-1/2 grid size-8 -translate-y-1/2 place-items-center rounded-lg text-muted-foreground transition hover:bg-white/10 hover:text-foreground"
                      aria-label={showPassword ? "Hide password" : "Show password"}
                    >
                      {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                    </button>
                  </div>
                </div>

                {(mode === "register" || mode === "reset") && (
                  <div className="space-y-2">
                    <Label htmlFor="confirm-password">Confirm password</Label>
                    <div className="relative">
                      <LockKeyhole className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                      <Input
                        id="confirm-password"
                        type={showPassword ? "text" : "password"}
                        autoComplete="new-password"
                        value={confirmPassword}
                        onChange={(event) => setConfirmPassword(event.target.value)}
                        placeholder="Repeat password"
                        className="h-11 rounded-xl border-white/10 bg-white/[0.04] pl-10"
                      />
                    </div>
                  </div>
                )}

                {error && (
                  <div className="rounded-xl border border-rasa-rose/25 bg-rasa-rose/10 px-3 py-2 text-sm text-rasa-rose">
                    {error}
                  </div>
                )}

                <Button
                  type="submit"
                  disabled={submitting}
                  className="h-11 w-full rounded-xl bg-[image:var(--gradient-violet)] font-semibold text-white shadow-neon-violet hover:opacity-90"
                >
                  {submitting
                    ? mode === "login"
                      ? "Signing in..."
                      : mode === "reset"
                        ? "Resetting..."
                        : "Creating account..."
                    : mode === "login"
                      ? "Sign in"
                      : mode === "reset"
                        ? "Reset password"
                        : "Register"}
                  <ArrowRight className="size-4" />
                </Button>
              </form>

              <div className="mt-6 text-center text-sm text-muted-foreground">
                {mode === "login" ? "New to Priora?" : "Already registered?"}{" "}
                <button
                  type="button"
                  onClick={() => {
                    setMode((value) => (value === "login" ? "register" : "login"));
                    setError("");
                    setPassword("");
                    setConfirmPassword("");
                  }}
                  className="font-medium text-rasa-gold transition hover:text-rasa-amber"
                >
                  {mode === "login" ? "Create an account" : "Login instead"}
                </button>
              </div>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
