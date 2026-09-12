import type { Config } from "tailwindcss";

export default {
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      colors: {
        bg: "var(--bg)",
        "bg-2": "var(--bg-2)",
        surface: {
          DEFAULT: "var(--surface)",
          solid: "var(--surface-solid)",
        },
        "surface-2": {
          DEFAULT: "var(--surface-2)",
          solid: "var(--surface-2-solid)",
        },
        hair: {
          DEFAULT: "var(--hair)",
          strong: "var(--hair-strong)",
        },
        ink: {
          DEFAULT: "var(--ink)",
          2: "var(--ink-2)",
          3: "var(--ink-3)",
        },
        brand: {
          DEFAULT: "var(--brand)",
          hover: "var(--brand-hover)",
          ring: "var(--brand-ring)",
          tint: "var(--brand-tint)",
          glow: "var(--brand-glow)",
        },
        info: "var(--info)",
        good: "var(--good)",
        warn: "var(--warn)",
        bad: "var(--bad)",
        cyan: "var(--cyan)",
        purple: "var(--purple)",
        gold: "var(--gold)",
        silver: "var(--silver)",
        bronze: "var(--bronze)",
      },
      fontFamily: {
        sans: ["var(--font-sans)", "ui-sans-serif", "system-ui", "sans-serif"],
        mono: ["var(--font-mono)", "ui-monospace", "SFMono-Regular", "monospace"],
      },
      backdropBlur: {
        glass: "var(--glass-blur)",
      },
    },
  },
  plugins: [],
} satisfies Config;
