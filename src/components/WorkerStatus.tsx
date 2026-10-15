"use client";
import { usePoll } from "./usePoll";

type Status = {
  worker: { state: string; message: string | null; heartbeat_at: string } | null;
  online: boolean;
  checksToday: number;
  dailyLimit: number;
};

const LABELS: Record<string, string> = {
  running: "Worker running",
  idle: "Worker idle",
  paused_daily_limit: "Paused: daily limit",
  error: "Worker error",
  stopped: "Worker stopped",
  offline: "Worker offline",
};

export function WorkerStatus() {
  const { data } = usePoll<Status>("/api/status", 5000);
  if (!data) return null;
  const stale = !data.online;
  const state = stale ? "offline" : data.worker!.state;
  const pct = Math.min(100, (data.checksToday / data.dailyLimit) * 100);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }} title={data.worker?.message ?? ""}>
      <span className={`status ${state}`} style={{ fontSize: 12 }}>
        {LABELS[state] ?? state}
      </span>
      <div className="progress">
        <i style={{ width: `${pct}%`, background: pct > 90 ? "var(--warning-solid)" : undefined }} />
      </div>
      <span className="faint num" style={{ fontSize: 11.5 }}>
        {data.checksToday.toLocaleString()} / {data.dailyLimit.toLocaleString()} checks today
      </span>
      {state === "error" && data.worker?.message && (
        <span style={{ fontSize: 11.5, color: "var(--danger-ink)" }}>{data.worker.message}</span>
      )}
    </div>
  );
}
