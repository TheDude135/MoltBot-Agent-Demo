// Global flow stepper. Renders the five logical steps of the demo and
// highlights where the user is. Purely presentational: page.tsx maps the
// current `phase` to a step index and passes it in.

"use client";

import { Check } from "@phosphor-icons/react";

export const STEPS = ["Blueprint", "Site", "Configure", "Deploy", "Voice"] as const;

export function Stepper({ current }: { current: number }) {
  return (
    <ol className="flex items-center gap-1.5">
      {STEPS.map((label, i) => {
        const state = i < current ? "done" : i === current ? "active" : "todo";
        return (
          <li key={label} className="flex flex-1 items-center gap-1.5">
            <div className="flex items-center gap-2">
              <span
                className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-bold transition-colors ${
                  state === "done"
                    ? "bg-violet-500 text-white"
                    : state === "active"
                      ? "bg-violet-500/15 text-violet-200 ring-2 ring-violet-500"
                      : "bg-white/[0.04] text-gray-600 ring-1 ring-white/10"
                }`}
              >
                {state === "done" ? <Check size={13} weight="bold" /> : i + 1}
              </span>
              <span
                className={`hidden text-xs font-medium transition-colors sm:inline ${
                  state === "active"
                    ? "text-white"
                    : state === "done"
                      ? "text-gray-400"
                      : "text-gray-600"
                }`}
              >
                {label}
              </span>
            </div>
            {i < STEPS.length - 1 && (
              <span
                className={`h-px flex-1 transition-colors ${
                  i < current ? "bg-violet-500/50" : "bg-white/10"
                }`}
              />
            )}
          </li>
        );
      })}
    </ol>
  );
}
