import type { Role } from "@prisma/client";
import type { DefaultSession } from "next-auth";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      role: Role;
      teamId?: string;
    } & DefaultSession["user"];
  }

  interface User {
    role: Role;
    teamId?: string;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    uid: string;
    role: Role;
    teamId?: string;
  }
}
