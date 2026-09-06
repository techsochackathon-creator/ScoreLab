import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth";
import { Shell } from "@/components/shell/Shell";

export default async function OrganizerLayout({ children }: { children: React.ReactNode }) {
  const session = await getServerSession(authOptions);
  if (!session?.user || session.user.role !== "ORGANIZER") redirect("/login?error=forbidden");
  return <Shell email={session.user.email}>{children}</Shell>;
}
