"use client";

import { ThemeProvider as NextThemesProvider } from "next-themes";
import type { ComponentProps } from "react";

/**
 * Wraps `next-themes` with our defaults. Must be a Client Component
 * because theme detection happens from localStorage + system prefs at
 * hydration time.
 *
 * Config notes:
 * - `attribute="class"` toggles a `.dark` class on `<html>`; our
 *   `globals.css` `.dark` ruleset overrides the :root palette.
 * - `defaultTheme="system"` respects the OS preference on first visit.
 *   Kraken is light-first; respecting system means light-mode users
 *   get the hero design, dark-mode users get our dimmed variant.
 * - `disableTransitionOnChange` suppresses the flash of interpolation
 *   when the user toggles — colors should swap, not fade.
 */
export function ThemeProvider({
  children,
  ...props
}: ComponentProps<typeof NextThemesProvider>) {
  return (
    <NextThemesProvider
      attribute="class"
      defaultTheme="system"
      enableSystem
      disableTransitionOnChange
      {...props}
    >
      {children}
    </NextThemesProvider>
  );
}
