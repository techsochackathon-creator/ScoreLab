import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth";
import { homePathForRole } from "@/lib/roles";
import { ThemeToggle } from "@/components/ui/ThemeToggle";
import { SignOutButton } from "@/components/SignOutButton";

export default async function JudgeLayout({ children }: { children: React.ReactNode }) {
  const session = await getServerSession(authOptions);
  if (!session?.user) redirect("/login");
  if (session.user.role !== "JUDGE") redirect(homePathForRole(session.user.role) ?? "/login?error=forbidden");

  return (
    <div className="min-h-screen bg-bg">
      <header className="border-b border-[var(--glass-border)]">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-5 py-4">
          <div className="flex items-center gap-2.5">
            <span
              className="grid h-8 w-8 place-items-center rounded-lg text-[13px] font-extrabold"
              style={{ background: "var(--gradient-brand)", color: "var(--brand-fg)", boxShadow: "var(--glow-brand-sm)" }}
            >
              S
            </span>
            <span className="text-[15px] font-bold tracking-tight text-ink">
              Score<span style={{ color: "var(--brand)" }}>Lab</span>
            </span>
            <span className="chip ml-1">Judge</span>
          </div>
          <div className="flex items-center gap-3">
            <span className="hidden text-xs text-ink-3 sm:inline">{session.user.email}</span>
            <ThemeToggle />
            <SignOutButton />
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-5 py-8">{children}</main>
    </div>
  );
}
