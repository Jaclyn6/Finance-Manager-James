"use client";

import { Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";

/**
 * A single-button theme switcher that cycles between light and dark.
 * The `next-themes` library handles the localStorage + class
 * bookkeeping; we only need to flip the string.
 *
 * `mounted` gate: on the server, we don't know which theme will win
 * (it depends on client localStorage + prefers-color-scheme). Rendering
 * an icon based on an unknown theme would cause hydration mismatch —
 * so we render a neutral placeholder until the client mounts, then
 * swap in the right icon. The placeholder has the same dimensions so
 * the header doesn't shift.
 */
export function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const isDark = mounted && resolvedTheme === "dark";
  const label = isDark ? "라이트 모드로 전환" : "다크 모드로 전환";

  return (
    <Button
      variant="ghost"
      size="icon"
      aria-label={label}
      title={label}
      onClick={() => setTheme(isDark ? "light" : "dark")}
      className="size-9"
    >
      {mounted ? (
        isDark ? (
          <Sun className="size-4" />
        ) : (
          <Moon className="size-4" />
        )
      ) : (
        <span className="size-4" aria-hidden />
      )}
    </Button>
  );
}
