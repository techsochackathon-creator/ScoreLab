"use client";

import { Suspense, useState } from "react";
import { getSession, signIn } from "next-auth/react";
import { useRouter, useSearchParams } from "next/navigation";
import { ACCOUNT_DISABLED, homePathForRole } from "@/lib/roles";
import { Logo } from "@/components/ui/Logo";

function LoginInner() {
  const router = useRouter();
  const params = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(
    params.get("error") === "forbidden"
      ? "You don't have access to that page."
      : params.get("error") === "disabled"
        ? "This account has been disabled. Contact the organizer."
        : null,
  );
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const res = await signIn("credentials", { email, password, redirect: false });
    if (res?.error) {
      setLoading(false);
      return setError(
        res.error === ACCOUNT_DISABLED
          ? "This account has been disabled. Contact the organizer."
          : "Invalid email or password.",
      );
    }
    // Route by role; a role without its own area never falls through to /organizer.
    const session = await getSession();
    setLoading(false);
    const home = homePathForRole(session?.user?.role);
    if (!home) return setError("Your account has no assigned role.");
    router.push(home);
    router.refresh();
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-bg px-4 py-10">
      <div className="w-full max-w-sm fade-in-up">
        <div className="mb-6 flex justify-center">
          <Logo size="lg" />
        </div>

        <div className="card-raised p-6">
          <h1 className="text-lg font-semibold text-ink">Sign in</h1>
          <p className="mt-1 text-sm text-ink-3">Organizer and judge access to the evaluation platform.</p>
          <form onSubmit={onSubmit} className="mt-6 flex flex-col gap-4">
            <label>
              <span className="label">Email</span>
              <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} className="field" autoComplete="email" />
            </label>
            <label>
              <span className="label">Password</span>
              <input type="password" required value={password} onChange={(e) => setPassword(e.target.value)} className="field" autoComplete="current-password" />
            </label>
            {error && <p role="alert" className="notice notice-bad">{error}</p>}
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
