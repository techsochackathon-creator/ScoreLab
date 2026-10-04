import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth";
import { homePathForRole } from "@/lib/roles";
import { prisma } from "@/lib/prisma";
import { getActiveJudge } from "@/lib/judges";
import { ThemeToggle } from "@/components/ui/ThemeToggle";
import { SignOutButton } from "@/components/SignOutButton";
import { Logo } from "@/components/ui/Logo";

export default async function JudgeLayout({ children }: { children: React.ReactNode }) {
  const session = await getServerSession(authOptions);
  if (!session?.user) redirect("/login");
  if (session.user.role !== "JUDGE") redirect(homePathForRole(session.user.role) ?? "/login?error=forbidden");
  // JWT sessions outlive a disable; re-check the account on every render.
  if (!(await getActiveJudge(prisma, session.user.id))) redirect("/login?error=disabled");

  return (
    <div className="min-h-screen bg-bg">
      <header className="sticky top-0 z-30 border-b border-hair bg-sidebar">
        <div className="mx-auto flex h-14 max-w-5xl items-center justify-between gap-3 px-4 sm:px-5">
          <div className="flex min-w-0 items-center gap-2.5">
            <Logo />
            <span className="status-pill status-brand">Judge</span>
          </div>
          <div className="flex items-center gap-2 sm:gap-3">
            <span className="hidden max-w-[16rem] truncate text-xs text-ink-3 sm:inline">{session.user.email}</span>
            <ThemeToggle />
            <SignOutButton />
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-4 py-6 sm:px-5">{children}</main>
    </div>
  );
}
