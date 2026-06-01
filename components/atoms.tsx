// Shared visual atoms used across phase components. No business logic
// here — just primitive layout/labeling building blocks.

"use client";

import type { ReactNode } from "react";

export function Section({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="space-y-2">
      <p className="text-xs font-bold uppercase tracking-wider text-gray-500">
        {title}
      </p>
      {children}
    </section>
  );
}

export function Label({
  required,
  secret,
  children,
}: {
  required?: boolean;
  secret?: boolean;
  children: ReactNode;
}) {
  return (
    <label className="mb-1 flex items-center gap-1 text-xs font-medium text-gray-300">
      {children}
      {required && <span className="text-[10px] text-red-400">*</span>}
      {secret && <span className="text-[10px] text-gray-500">🔒</span>}
    </label>
  );
}

export function Chip({
  children,
  tone = "gray",
}: {
  children: ReactNode;
  tone?: "gray" | "emerald" | "violet";
}) {
  const styles: Record<typeof tone, string> = {
    gray: "bg-white/5 text-gray-400",
    emerald: "bg-emerald-500/10 text-emerald-300",
    violet: "bg-violet-500/10 text-violet-300",
  };
  return (
    <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${styles[tone]}`}>
      {children}
    </span>
  );
}

export function CenteredStatus({
  label,
  detail,
}: {
  label: string;
  detail?: string;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-2xl border border-white/10 bg-white/[0.02] py-12 text-center">
      <div className="text-2xl">⏳</div>
      <p className="text-sm font-semibold text-white">{label}</p>
      {detail && <p className="text-xs text-gray-500">{detail}</p>}
    </div>
  );
}
