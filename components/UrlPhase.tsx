// URL phase — between Catalog and Configure. User types their Wix
// Bookings URL; submission calls /api/introspect to pre-fill the next
// phase's variables. On failure: stays here, renders actionable feedback.

"use client";

import type { Blueprint } from "@/lib/types";
import { Button, PhaseHeader, Section } from "./atoms";

export function UrlPhase(props: {
  blueprint: Blueprint;
  siteUrl: string;
  onChangeSiteUrl: (v: string) => void;
  introspecting: boolean;
  introspectError: string | null;
  onSubmit: () => void;
  onBack: () => void;
}) {
  return (
    <div className="space-y-5">
      <PhaseHeader
        title="What is your Wix Bookings site?"
        description="We'll read your services, prices, and staff from the public Wix site and pre-fill the next page, so you don't have to copy them by hand."
        onBack={props.onBack}
      />

      <Section title="Site URL">
        <input
          type="text"
          value={props.siteUrl}
          onChange={(e) => props.onChangeSiteUrl(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !props.introspecting) props.onSubmit();
          }}
          placeholder="topdetailsbarber.com"
          autoFocus
          disabled={props.introspecting}
          className="w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2.5 text-sm text-white placeholder:text-gray-600 focus:border-violet-500 focus:outline-none disabled:opacity-50"
        />
        <p className="mt-1 text-[10px] text-gray-600">
          Just the domain is fine. We accept any of:{" "}
          <code className="font-mono">topdetailsbarber.com</code>,{" "}
          <code className="font-mono">https://www.topdetailsbarber.com</code>,
          or a full booking-page URL.
        </p>
      </Section>

      {props.introspectError && (
        <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-4">
          <p className="text-sm font-semibold text-red-300">
            Couldn&apos;t set up your agent from this URL
          </p>
          <p className="mt-1 text-xs text-red-200/85">
            {props.introspectError}
          </p>
          <p className="mt-2 text-[10px] text-red-200/60">
            This demo currently only works with sites built on Wix Bookings.
            If your booking system is somewhere else (Square, Calendly,
            Squarespace, custom), get in touch — we&apos;ll let you know when
            your platform is supported.
          </p>
        </div>
      )}

      <Button
        onClick={props.onSubmit}
        disabled={props.siteUrl.trim().length === 0}
        loading={props.introspecting}
        fullWidth
        leadingIcon={!props.introspecting ? <span>🔍</span> : undefined}
      >
        {props.introspecting ? "Reading your site…" : "Inspect site"}
      </Button>
    </div>
  );
}
