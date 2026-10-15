"use client";
import { useSyncExternalStore } from "react";
import { Moon, Sun } from "lucide-react";

import { THEME_KEY as KEY } from "./theme-script";
type Theme = "light" | "dark";

// The theme lives on <html data-theme>, set before paint by the script in the
// root layout; this button only flips it and remembers the choice.
function subscribe(onChange: () => void) {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  return () => observer.disconnect();
}
const current = (): Theme => (document.documentElement.dataset.theme === "dark" ? "dark" : "light");

export function ThemeToggle() {
  const theme = useSyncExternalStore(subscribe, current, () => "light" as Theme);
  const next: Theme = theme === "dark" ? "light" : "dark";
  return (
    <button
      type="button"
      className="theme-toggle"
      aria-label={`Switch to ${next} mode`}
      title={`Switch to ${next} mode`}
      onClick={() => {
        document.documentElement.dataset.theme = next;
        try { localStorage.setItem(KEY, next); } catch { /* private mode: the choice lasts this visit */ }
      }}
    >
      {theme === "dark" ? <Sun size={16} strokeWidth={1.75} aria-hidden="true" /> : <Moon size={16} strokeWidth={1.75} aria-hidden="true" />}
    </button>
  );
}
