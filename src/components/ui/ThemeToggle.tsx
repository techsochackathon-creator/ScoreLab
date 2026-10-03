"use client";

import { useEffect, useState } from "react";
import { Icon } from "@/components/ui/icons";

export function ThemeToggle() {
  const [theme, setTheme] = useState<"dark" | "light">("dark");

  useEffect(() => {
    const stored = (() => {
      try {
        return localStorage.getItem("scorelab-theme");
      } catch {
        return null;
      }
    })();
    setTheme(stored === "light" ? "light" : "dark");
  }, []);

  function toggle() {
    const next = theme === "dark" ? "light" : "dark";
    setTheme(next);
    try {
      localStorage.setItem("scorelab-theme", next);
    } catch {
      /* ignore */
    }
    if (next === "light") document.documentElement.setAttribute("data-theme", "light");
    else document.documentElement.removeAttribute("data-theme");
  }

  const Glyph = theme === "dark" ? Icon.sun : Icon.moon;
  return (
    <button
      onClick={toggle}
      className="grid h-9 w-9 place-items-center rounded-lg text-ink-3 transition-all hover:text-ink"
      style={{
        background: "var(--surface-2)",
        border: "1px solid var(--glass-border)",
      }}
      aria-label={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
      title={theme === "dark" ? "Light theme" : "Dark theme"}
    >
      <Glyph size={16} />
    </button>
  );
}
