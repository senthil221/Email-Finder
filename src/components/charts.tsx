"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { n } from "./format";

function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [w, setW] = useState(0);
  useEffect(() => {
    if (!ref.current) return;
    const ro = new ResizeObserver(([e]) => setW(e.contentRect.width));
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, []);
  return [ref, w] as const;
}

const niceMax = (v: number) => {
  if (v <= 5) return 5;
  const p = Math.pow(10, Math.floor(Math.log10(v)));
  for (const m of [1, 2, 2.5, 5, 10]) if (m * p >= v) return m * p;
  return 10 * p;
};

type Point = { t: string; checks: number; valid: number };

/** Checks per minute (area) with emails found per minute (line), last 60 minutes. */
export function ThroughputChart({ series, now, height = 210 }: { series: Point[]; now: number; height?: number }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);

  // One slot per minute for the last 60 minutes, zeros where nothing ran.
  const data = useMemo(() => {
    const byMin = new Map(series.map((p) => [Math.floor(new Date(p.t).getTime() / 60000), p]));
    const end = Math.floor(now / 60000);
    return Array.from({ length: 60 }, (_, i) => {
      const m = end - 59 + i;
      const p = byMin.get(m);
      return { m, checks: p?.checks ?? 0, valid: p?.valid ?? 0 };
    });
  }, [series, now]);

  const pad = { l: 34, r: 8, t: 10, b: 22 };
  const w = Math.max(0, width - pad.l - pad.r);
  const h = height - pad.t - pad.b;
  const max = niceMax(Math.max(...data.map((d) => d.checks), 1));
  const x = (i: number) => pad.l + (i / 59) * w;
  const y = (v: number) => pad.t + h - (v / max) * h;
  const path = (k: "checks" | "valid") => data.map((d, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(d[k]).toFixed(1)}`).join("");
  const area = `${path("checks")}L${x(59)},${y(0)}L${x(0)},${y(0)}Z`;
  const ticks = [0, max / 2, max];
  const total = data.reduce((s, d) => s + d.checks, 0);
  const hv = hover !== null ? data[hover] : null;

  return (
    <div className="chart" ref={ref}>
      <div className="legend" style={{ marginBottom: 6 }}>
        <span>
          <i style={{ background: "var(--signal)", height: 3, width: 12 }} /> Checks / min
        </span>
        <span>
          <i style={{ background: "var(--ok)", height: 3, width: 12 }} /> Found / min
        </span>
        <span className="faint" style={{ marginLeft: "auto" }}>
          {n(total)} checks in the last hour
        </span>
      </div>
      {width > 0 && (
        <svg
          height={height}
          role="img"
          aria-label={`Checks per minute over the last hour, ${total} in total`}
          onPointerMove={(e) => {
            const r = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
            const i = Math.round(((e.clientX - r.left - pad.l) / w) * 59);
            setHover(Math.max(0, Math.min(59, i)));
          }}
          onPointerLeave={() => setHover(null)}
        >
          <defs>
            <linearGradient id="areaGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--signal)" stopOpacity="0.22" />
              <stop offset="100%" stopColor="var(--signal)" stopOpacity="0" />
            </linearGradient>
          </defs>
          {ticks.map((t) => (
            <g key={t}>
              <line className="grid-line" x1={pad.l} x2={pad.l + w} y1={y(t)} y2={y(t)} />
              <text className="axis" x={pad.l - 8} y={y(t) + 3} textAnchor="end">
                {n(t)}
              </text>
            </g>
          ))}
          {[0, 15, 30, 45, 59].map((i) => (
            <text key={i} className="axis" x={x(i)} y={height - 4} textAnchor={i === 0 ? "start" : i === 59 ? "end" : "middle"}>
              {i === 59 ? "now" : `-${59 - i}m`}
            </text>
          ))}
          <path className="area" d={area} />
          <path className="line draw" d={path("checks")} />
          <path className="line-ok draw" d={path("valid")} />
          <circle className="dot" cx={x(59)} cy={y(data[59].checks)} r={4} fill="var(--signal)" />
          {hv && hover !== null && (
            <g>
              <line className="cross" x1={x(hover)} x2={x(hover)} y1={pad.t} y2={pad.t + h} />
              <circle className="dot" cx={x(hover)} cy={y(hv.checks)} r={4} fill="var(--signal)" />
              <circle className="dot" cx={x(hover)} cy={y(hv.valid)} r={4} fill="var(--ok)" />
            </g>
          )}
        </svg>
      )}
      {hv && hover !== null && (
        <div className="tip" style={{ left: x(hover), top: y(hv.checks) + 26 }}>
          <div className="t-head">{new Date(hv.m * 60000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</div>
          <div className="t-row">
            <i style={{ background: "var(--signal)" }} />
            <b>{n(hv.checks)}</b> <span className="muted">checks</span>
          </div>
          <div className="t-row">
            <i style={{ background: "var(--ok)" }} />
            <b>{n(hv.valid)}</b> <span className="muted">found</span>
          </div>
        </div>
      )}
    </div>
  );
}

/** Tiny trend line for KPI tiles. */
export function Spark({ values, color = "var(--signal)", w = 84, h = 28 }: { values: number[]; color?: string; w?: number; h?: number }) {
  if (values.length < 2) return null;
  const max = Math.max(...values, 1);
  const pts = values.map((v, i) => `${((i / (values.length - 1)) * w).toFixed(1)},${(h - 2 - (v / max) * (h - 4)).toFixed(1)}`);
  return (
    <svg className="spark" width={w} height={h} aria-hidden>
      <polyline points={pts.join(" ")} fill="none" stroke={color} strokeWidth={1.75} strokeLinejoin="round" strokeLinecap="round" opacity={0.85} />
      <circle cx={w} cy={pts.at(-1)!.split(",")[1]} r={2.5} fill={color} />
    </svg>
  );
}

/** Single-series columns with a value on each cap and a hover tooltip. */
export function ColumnChart({
  data,
  color = "var(--ok)",
  height = 170,
  format = (v: number) => n(v),
  tip,
}: {
  data: { label: string; value: number }[];
  color?: string;
  height?: number;
  format?: (v: number) => string;
  tip?: (d: { label: string; value: number }, i: number) => string;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const pad = { t: 18, b: 22, l: 4, r: 4 };
  const h = height - pad.t - pad.b;
  const max = Math.max(1, ...data.map((d) => d.value));
  const slot = data.length ? (width - pad.l - pad.r) / data.length : 0;
  const bw = Math.min(24, Math.max(4, slot * 0.62));
  const showAll = slot > 26;
  // Thin the x labels so they never collide (always keep the last one).
  const step = Math.max(1, Math.ceil(44 / Math.max(1, slot)));
  return (
    <div className="chart" ref={ref} onPointerLeave={() => setHover(null)}>
      {width > 0 && (
        <svg height={height} role="img" aria-label={data.map((d) => `${d.label}: ${format(d.value)}`).join(", ")}>
          <line className="grid-line" x1={pad.l} x2={width - pad.r} y1={pad.t + h} y2={pad.t + h} />
          {data.map((d, i) => {
            const x = pad.l + slot * i + (slot - bw) / 2;
            const bh = Math.max(d.value ? 2 : 0, (d.value / max) * h);
            const y = pad.t + h - bh;
            const r = Math.min(4, bh);
            return (
              <g key={d.label} onPointerEnter={() => setHover(i)} style={{ cursor: "default" }}>
                <rect x={pad.l + slot * i} y={pad.t} width={slot} height={h} fill="transparent" />
                <path
                  d={`M${x},${pad.t + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + bw - r}Q${x + bw},${y} ${x + bw},${y + r}V${pad.t + h}Z`}
                  fill={color}
                  opacity={hover === null || hover === i ? 1 : 0.45}
                  style={{ transition: "opacity 120ms" }}
                />
                {(showAll || hover === i || d.value === max) && d.value > 0 && (
                  <text className="axis" x={x + bw / 2} y={y - 5} textAnchor="middle" style={{ fill: "var(--ink-soft)" }}>
                    {format(d.value)}
                  </text>
                )}
                {((i % step === 0 && data.length - 1 - i >= step) || i === data.length - 1) && (
                  <text className="axis" x={x + bw / 2} y={height - 5} textAnchor="middle">
                    {d.label}
                  </text>
                )}
              </g>
            );
          })}
        </svg>
      )}
      {hover !== null && data[hover] && (
        <div className="tip" style={{ left: pad.l + slot * hover + slot / 2, top: pad.t + h - (data[hover].value / max) * h }}>
          <div className="t-row">
            <i style={{ background: color }} />
            <span>{tip ? tip(data[hover], hover) : `${data[hover].label}: ${format(data[hover].value)}`}</span>
          </div>
        </div>
      )}
    </div>
  );
}

/** Rows x columns grid; each cell is the share of its row, shaded in one hue. */
export function Heatmap({
  rows,
  cols,
  value,
  colLabel = (c: string) => c,
}: {
  rows: string[];
  cols: string[];
  value: (row: string, col: string) => number;
  colLabel?: (c: string) => string;
}) {
  const totals = Object.fromEntries(rows.map((r) => [r, cols.reduce((s, c) => s + value(r, c), 0)]));
  return (
    <div style={{ overflowX: "auto" }}>
      <table className="heat">
        <thead>
          <tr>
            <th />
            {cols.map((c) => (
              <th key={c}>{colLabel(c)}</th>
            ))}
            <th className="r">Finds</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r}>
              <th>{r}</th>
              {cols.map((c) => {
                const v = value(r, c);
                const share = totals[r] ? v / totals[r] : 0;
                return (
                  <td key={c} title={`${r} · ${colLabel(c)}: ${v} of ${totals[r]} finds (${Math.round(share * 100)}%)`}>
                    <span
                      className="cell"
                      style={{
                        background: `color-mix(in srgb, var(--ok) ${Math.round(8 + share * 82)}%, var(--surface-3))`,
                        color: share > 0.45 ? "#fff" : share > 0 ? "var(--ink)" : "var(--faint)",
                      }}
                    >
                      {v ? `${Math.round(share * 100)}%` : "·"}
                    </span>
                  </td>
                );
              })}
              <td className="r num muted">{n(totals[r])}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
