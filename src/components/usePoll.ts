"use client";
import { useCallback, useEffect, useState } from "react";

/** Fetch JSON now and every `ms` (url null = do nothing). Results from an old url are dropped. */
export function usePoll<T>(url: string | null, ms: number | null) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!url) return;
    let alive = true;
    const load = async () => {
      try {
        const res = await fetch(url, { cache: "no-store" });
        const body = await res.json();
        if (!res.ok) throw new Error(body?.error ?? res.statusText);
        if (alive) {
          setData(body as T);
          setError(null);
        }
      } catch (e) {
        if (alive) setError((e as Error).message);
      }
    };
    load();
    const t = ms ? setInterval(load, ms) : undefined;
    return () => {
      alive = false;
      if (t) clearInterval(t);
    };
  }, [url, ms, tick]);

  const reload = useCallback(() => setTick((x) => x + 1), []);
  return { data, error, reload };
}
