import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth";
import { Shell } from "@/components/shell/Shell";
import { prisma } from "@/lib/prisma";
import { getActiveOrganizer } from "@/lib/organizers";

export default async function OrganizerLayout({ children }: { children: React.ReactNode }) {
  const session = await getServerSession(authOptions);
  if (!session?.user || session.user.role !== "ORGANIZER") redirect("/login?error=forbidden");
  // JWT sessions outlive a disable; re-check the account on every render.
  if (!(await getActiveOrganizer(prisma, session.user.id))) redirect("/login?error=disabled");
  return <Shell email={session.user.email}>{children}</Shell>;
}
