"use client";

import { Suspense, useState } from "react";
import { signIn } from "next-auth/react";
import { useRouter, useSearchParams } from "next/navigation";

function LoginInner() {
  const router = useRouter();
  const params = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(
    params.get("error") === "forbidden" ? "You don't have access to that page." : null,
  );
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const res = await signIn("credentials", { email, password, redirect: false });
    setLoading(false);
    if (res?.error) return setError("Invalid email or password.");
    router.push("/organizer/dashboard");
    router.refresh();
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-bg px-6 ambient-glow">
      <div className="relative z-10 w-full max-w-sm fade-in-up">
        <div className="mb-8 flex items-center gap-2.5">
          <span
            className="grid h-9 w-9 place-items-center rounded-lg text-sm font-extrabold"
            style={{ background: "var(--gradient-brand)", color: "var(--brand-fg)", boxShadow: "var(--glow-brand-sm)" }}
          >
            S
          </span>
          <span className="text-lg font-bold tracking-tight text-ink">
            Score<span style={{ color: "var(--brand)" }}>Lab</span>
          </span>
        </div>

        <div className="card-raised p-6">
          <h1 className="text-xl font-bold text-ink">Sign in</h1>
          <p className="mt-1 text-sm text-ink-3">Organizer access to the evaluation platform.</p>
          <form onSubmit={onSubmit} className="mt-6 flex flex-col gap-4">
            <label>
              <span className="label">Email</span>
              <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} className="field" autoComplete="email" />
            </label>
            <label>
              <span className="label">Password</span>
              <input type="password" required value={password} onChange={(e) => setPassword(e.target.value)} className="field" autoComplete="current-password" />
            </label>
            {error && <p className="text-sm text-bad">{error}</p>}
            <button type="submit" disabled={loading} className="btn-primary mt-1 w-full">
              {loading ? "Signing in…" : "Sign in"}
            </button>
          </form>
        </div>

        <p className="mt-6 text-center text-[11px] text-ink-3">
          AI-powered hackathon evaluation platform
        </p>
      </div>
    </main>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginInner />
    </Suspense>
  );
}
