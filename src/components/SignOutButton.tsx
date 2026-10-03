"use client";

import { signOut } from "next-auth/react";
import { Icon } from "@/components/ui/icons";

export function SignOutButton({ full = false }: { full?: boolean }) {
  return (
    <button
      onClick={() => signOut({ callbackUrl: "/login" })}
      className={full ? "nav-item w-full" : "btn-quiet text-[13px]"}
    >
      {full && <span className="nav-icon"><Icon.logout size={16} /></span>}
      Sign out
    </button>
  );
}
