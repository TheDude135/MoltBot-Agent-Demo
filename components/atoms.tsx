// Shared visual atoms used across phase components. No business logic
// here — just primitive layout / labeling / control building blocks so the
// whole flow stays visually consistent.

"use client";

import type { ButtonHTMLAttributes, ReactNode } from "react";

// ─── Layout ───────────────────────────────────────────────────────────

/** The standard glass card. One source of truth for the surface style. */
export function Card({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`rounded-2xl border border-white/10 bg-white/[0.025] shadow-[0_1px_0_0_rgba(255,255,255,0.04)_inset,0_20px_40px_-24px_rgba(0,0,0,0.7)] backdrop-blur-sm ${className}`}
    >
      {children}
    </div>
  );
}

export function Section({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="space-y-2">
      <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-gray-500">
        {title}
      </p>
      {children}
    </section>
  );
}

/** Consistent phase header: title, optional sub-copy, optional back action. */
export function PhaseHeader({
  title,
  description,
  onBack,
}: {
  title: string;
  description?: ReactNode;
  onBack?: () => void;
}) {
  return (
    <header className="flex items-start justify-between gap-3">
      <div className="min-w-0">
        <h2 className="text-lg font-bold tracking-tight text-white">{title}</h2>
        {description && (
          <p className="mt-1 text-xs leading-relaxed text-gray-400">{description}</p>
        )}
      </div>
      {onBack && (
        <button
          onClick={onBack}
          className="shrink-0 rounded-lg px-2.5 py-1.5 text-xs font-medium text-gray-400 transition-colors hover:bg-white/5 hover:text-white"
        >
          ← Back
        </button>
      )}
    </header>
  );
}

// ─── Labels + chips ───────────────────────────────────────────────────

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
      {required && <span className="text-[10px] text-rose-400">*</span>}
      {secret && <span className="text-[10px] text-gray-500">🔒</span>}
    </label>
  );
}

export function Chip({
  children,
  tone = "gray",
}: {
  children: ReactNode;
  tone?: "gray" | "emerald" | "violet" | "amber";
}) {
  const styles: Record<NonNullable<typeof tone>, string> = {
    gray: "bg-white/[0.06] text-gray-400 ring-white/10",
    emerald: "bg-emerald-500/10 text-emerald-300 ring-emerald-500/20",
    violet: "bg-violet-500/10 text-violet-300 ring-violet-500/20",
    amber: "bg-amber-500/10 text-amber-300 ring-amber-500/20",
  };
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium ring-1 ring-inset ${styles[tone]}`}
    >
      {children}
    </span>
  );
}

// ─── Button ───────────────────────────────────────────────────────────

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
type ButtonSize = "sm" | "md";

const VARIANTS: Record<ButtonVariant, string> = {
  primary:
    "bg-gradient-to-b from-violet-500 to-violet-600 text-white shadow-lg shadow-violet-600/25 hover:from-violet-400 hover:to-violet-500 disabled:from-white/10 disabled:to-white/10 disabled:text-gray-500 disabled:shadow-none",
  secondary:
    "border border-white/10 bg-white/[0.02] text-gray-200 hover:border-white/20 hover:bg-white/5 disabled:opacity-40",
  ghost:
    "text-gray-300 hover:bg-white/5 hover:text-white disabled:opacity-40",
  danger:
    "border border-rose-500/30 bg-rose-500/10 text-rose-200 hover:bg-rose-500/15 disabled:opacity-40",
};

const SIZES: Record<ButtonSize, string> = {
  sm: "h-9 px-3.5 text-xs",
  md: "h-11 px-4 text-sm",
};

export function Button({
  variant = "primary",
  size = "md",
  loading = false,
  fullWidth = false,
  leadingIcon,
  children,
  className = "",
  disabled,
  ...rest
}: {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  fullWidth?: boolean;
  leadingIcon?: ReactNode;
  children: ReactNode;
} & ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...rest}
      disabled={disabled || loading}
      className={`inline-flex select-none items-center justify-center gap-2 rounded-xl font-bold tracking-tight transition-all duration-150 disabled:cursor-not-allowed ${
        VARIANTS[variant]
      } ${SIZES[size]} ${fullWidth ? "w-full" : ""} ${className}`}
    >
      {loading ? (
        <span className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" />
      ) : (
        leadingIcon
      )}
      {children}
    </button>
  );
}

// ─── Status ───────────────────────────────────────────────────────────

export function CenteredStatus({
  label,
  detail,
}: {
  label: string;
  detail?: string;
}) {
  return (
    <Card className="flex flex-col items-center justify-center gap-4 px-6 py-14 text-center">
      <span className="relative inline-flex h-9 w-9 items-center justify-center">
        <span className="absolute inset-0 animate-ping rounded-full bg-violet-500/20" />
        <span className="inline-block h-7 w-7 animate-spin rounded-full border-2 border-violet-400 border-t-transparent" />
      </span>
      <p className="text-sm font-semibold text-white">{label}</p>
      {detail && <p className="max-w-md text-xs leading-relaxed text-gray-500">{detail}</p>}
    </Card>
  );
}
