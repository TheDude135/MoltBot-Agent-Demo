// Shared step timeline — ONE primitive used by BOTH the deploy half and the
// voice half so they look identical. Each step shows its status, a friendly
// one-liner, and the REAL public REST endpoint it calls (the demo doubles as a
// live API tutorial). Blueprint sub-steps render as compact chips under their
// parent step.

"use client";

import { CheckCircle, Circle, CircleNotch, XCircle } from "@phosphor-icons/react";
import { Card } from "./atoms";

export type StepStatus = "done" | "active" | "pending" | "failed";

const TONE: Record<StepStatus, { row: string; title: string; icon: string }> = {
  done: { row: "bg-emerald-500/[0.07]", title: "text-emerald-100", icon: "text-emerald-300" },
  failed: { row: "bg-rose-500/[0.08]", title: "text-rose-100", icon: "text-rose-300" },
  active: { row: "bg-violet-500/[0.10]", title: "text-violet-50", icon: "text-violet-200" },
  pending: { row: "bg-white/[0.02]", title: "text-gray-400", icon: "text-gray-600" },
};

export function StatusIcon({ status, size = 18 }: { status: StepStatus; size?: number }) {
  const cls = TONE[status].icon;
  if (status === "done") return <CheckCircle size={size} weight="fill" className={cls} />;
  if (status === "failed") return <XCircle size={size} weight="fill" className={cls} />;
  if (status === "active")
    return <CircleNotch size={size} weight="bold" className={`${cls} animate-spin`} />;
  return <Circle size={size} weight="bold" className={cls} />;
}

/** The real REST endpoint a step hits, as a colour-coded mono pill. */
export function EndpointPill({ method, path }: { method: string; path: string }) {
  const methodColor =
    method === "POST"
      ? "text-emerald-300"
      : method === "PUT"
        ? "text-amber-300"
        : method === "DELETE"
          ? "text-rose-300"
          : "text-sky-300";
  return (
    <span className="mt-1.5 inline-flex items-center gap-1.5 rounded-md border border-white/10 bg-black/40 px-2 py-0.5 font-mono text-[10px]">
      <span className={`font-semibold ${methodColor}`}>{method}</span>
      <span className="text-gray-400">{path}</span>
    </span>
  );
}

export interface Substep {
  key: string;
  label: string;
  /** One-line, plain-language explanation of what this sub-step does. */
  desc?: string;
  status: StepStatus;
}

export interface TimelineStep {
  key: string;
  title: string;
  desc?: string | null;
  /** The HTTP verb + path the step calls (omit for local-only steps). */
  method?: string;
  path?: string;
  status: StepStatus;
  /** Granular progress within the step (e.g. blueprint deploy sub-steps). */
  substeps?: Substep[];
}

export function Timeline({ title, steps }: { title: string; steps: TimelineStep[] }) {
  const done = steps.filter((s) => s.status === "done").length;
  return (
    <Card className="space-y-2 p-4">
      <div className="flex items-center justify-between pb-1 text-[11px] font-medium">
        <span className="text-gray-400">{title}</span>
        <span className="text-gray-500">
          {done} / {steps.length} done
        </span>
      </div>
      {steps.map((s) => {
        const t = TONE[s.status];
        return (
          <div
            key={s.key}
            className={`flex items-start gap-3 rounded-xl px-3 py-2.5 transition-colors ${t.row}`}
          >
            <span className="mt-0.5 flex-shrink-0">
              <StatusIcon status={s.status} />
            </span>
            <div className="min-w-0 flex-1">
              <p className={`text-[13px] font-semibold ${t.title}`}>{s.title}</p>
              {s.desc && (
                <p className="mt-0.5 text-[11px] leading-snug text-gray-500">{s.desc}</p>
              )}
              {s.method && s.path && <EndpointPill method={s.method} path={s.path} />}
              {s.substeps && s.substeps.length > 0 && (
                // One sub-step per row (stacked), each with its own status icon,
                // friendly title, and an explanatory one-liner.
                <ul className="mt-2.5 space-y-2 border-l border-white/10 pl-3">
                  {s.substeps.map((ss) => {
                    const st = TONE[ss.status];
                    return (
                      <li key={ss.key} className="flex items-start gap-2">
                        <span className="mt-0.5 flex-shrink-0">
                          <StatusIcon status={ss.status} size={13} />
                        </span>
                        <div className="min-w-0">
                          <p
                            className={`text-[11px] font-semibold ${
                              ss.status === "pending" ? "text-gray-500" : st.title
                            }`}
                          >
                            {ss.label}
                          </p>
                          {ss.desc && (
                            <p className="mt-0.5 text-[10px] leading-snug text-gray-500">
                              {ss.desc}
                            </p>
                          )}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </div>
        );
      })}
    </Card>
  );
}
