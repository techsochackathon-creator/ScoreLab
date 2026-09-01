import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import type { Session } from "next-auth";

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

/** Throws HttpError(401/403) unless the caller is a signed-in organizer. */
export async function requireOrganizer(): Promise<Session> {
  const session = await getServerSession(authOptions);
  if (!session?.user) throw new HttpError(401, "Not authenticated");
  if (session.user.role !== "ORGANIZER") {
    throw new HttpError(403, "Organizer access required");
  }
  return session;
}
