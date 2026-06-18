// Blueprint detail phase - the intro screen shown after a user picks a
// blueprint and before the deploy form. It "sells" the blueprint: a hero with
// its name + description, a stat strip, and three plain-language sections
// (what it can do / what you'll make yours / what's inside), then a single
// "Continue to deploy" CTA that opens the existing form.
//
// Everything is derived from the blueprint the API returned - no copy is
// hardcoded to a specific bot - so this renders well for any blueprint a
// fork's owner creates.

"use client";

import type { ReactNode } from "react";
import type { Blueprint, BlueprintVariable } from "@/lib/types";
import { EMOJI_VARIABLE_KEY } from "@/lib/types";
import { describeSkill, type SkillIconKey } from "@/lib/skill-catalog";
import { formatBytes, tidyDashes } from "@/lib/format";
import {
  AddressBook,
  ArrowRight,
  BookOpen,
  CalendarBlank,
  CalendarCheck,
  CaretLeft,
  CheckSquare,
  Envelope,
  FileText,
  LockSimple,
  Phone,
  Sparkle,
} from "@phosphor-icons/react";
import { Button, Card } from "./atoms";

const SKILL_ICONS: Record<SkillIconKey, typeof Sparkle> = {
  email: Envelope,
  calendar: CalendarBlank,
  crm: AddressBook,
  knowledge: BookOpen,
  phone: Phone,
  schedule: CalendarCheck,
  tasks: CheckSquare,
  generic: Sparkle,
};

export function BlueprintDetailPhase({
  blueprint,
  usesSite,
  onBack,
  onContinue,
}: {
  blueprint: Blueprint;
  /** True when the deploy flow starts with the Wix "Site" step. Changes the
   *  one-line hint under the CTA so the user knows what comes next. */
  usesSite: boolean;
  onBack: () => void;
  onContinue: () => void;
}) {
  // The variables the user actually personalizes. The emoji is driven by the
  // identity picker on the next screen, so it isn't a "setting" here.
  const settings = blueprint.variables.filter((v) => v.key !== EMOJI_VARIABLE_KEY);
  const files = blueprint.fileManifest;
  const skills = blueprint.skills;

  return (
    <div className="space-y-5">
      {/* Back row */}
      <button
        onClick={onBack}
        className="inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-xs font-medium text-gray-400 transition-colors hover:bg-white/5 hover:text-white"
      >
        <CaretLeft size={13} weight="bold" /> All blueprints
      </button>

      {/* Hero */}
      <Card className="relative overflow-hidden p-5 sm:p-6">
        <div
          aria-hidden
          className="pointer-events-none absolute -right-16 -top-16 h-48 w-48 rounded-full bg-violet-600/20 blur-3xl"
        />
        <div className="relative">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-xl font-bold tracking-tight text-white">
                {blueprint.name}
              </h2>
              <span className="rounded-full bg-white/[0.06] px-2 py-0.5 text-[10px] font-medium text-gray-400 ring-1 ring-inset ring-white/10">
                v{blueprint.version}
              </span>
            </div>
            {blueprint.description && (
              <p className="mt-1.5 text-sm leading-relaxed text-gray-300">
                {tidyDashes(blueprint.description)}
              </p>
            )}
          </div>
        </div>

        {/* Stat strip */}
        <div className="relative mt-5 grid grid-cols-3 gap-2">
          <Stat value={skills.length} label="skills" sub="built in" />
          <Stat value={settings.length} label="settings" sub="to make yours" />
          <Stat value={files.length} label="files" sub="included" />
        </div>
      </Card>

      {/* What it can do (skills) */}
      <SectionBlock
        title="What it can do"
        intro="Capabilities this agent has the moment it goes live."
      >
        {skills.length === 0 ? (
          <Empty>
            Runs on its own persona and playbooks - no extra integrations to wire
            up.
          </Empty>
        ) : (
          <ul className="space-y-2">
            {skills.map(({ slug }) => {
              const info = describeSkill(slug);
              const Icon = SKILL_ICONS[info.icon];
              return (
                <li
                  key={slug}
                  className="flex items-start gap-3 rounded-xl border border-white/[0.07] bg-white/[0.02] p-3"
                >
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-300 ring-1 ring-inset ring-emerald-500/20">
                    <Icon size={16} weight="bold" />
                  </span>
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-white">{info.title}</p>
                    <p className="mt-0.5 text-xs leading-relaxed text-gray-400">
                      {info.blurb}
                    </p>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </SectionBlock>

      {/* What you'll make yours (variables) */}
      <SectionBlock
        title="What you'll make yours"
        intro="A few details to tailor it to your business. You'll fill these in next - sensible defaults are already in place."
      >
        {settings.length === 0 ? (
          <Empty>Nothing to configure. It works the moment you deploy it.</Empty>
        ) : (
          <ul className="space-y-2">
            {settings.map((v) => (
              <SettingRow key={v.key} variable={v} />
            ))}
          </ul>
        )}
      </SectionBlock>

      {/* What's inside (files) */}
      <SectionBlock
        title="What's inside"
        intro="The persona and playbooks that define how it thinks, talks, and gets work done. Each deploy copies these into the new agent's own isolated workspace."
      >
        {files.length === 0 ? (
          <Empty>No files ship with this blueprint.</Empty>
        ) : (
          <ul className="divide-y divide-white/[0.06] overflow-hidden rounded-xl border border-white/[0.07] bg-white/[0.02]">
            {files.map((f) => (
              <li key={f.path} className="flex items-center gap-3 px-3 py-2.5">
                <FileText
                  size={15}
                  weight="bold"
                  className="shrink-0 text-violet-300/80"
                />
                <span className="min-w-0 flex-1 truncate font-mono text-xs text-gray-200">
                  {f.path}
                </span>
                <span className="shrink-0 rounded-md bg-white/[0.06] px-1.5 py-0.5 text-[10px] font-medium text-gray-400">
                  {fileRole(f.path)}
                </span>
                <span className="shrink-0 font-mono text-[10px] text-gray-500">
                  {formatBytes(f.sizeBytes)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </SectionBlock>

      {/* CTA */}
      <div className="pt-1">
        <Button
          onClick={onContinue}
          fullWidth
          className="group"
          leadingIcon={
            <ArrowRight
              size={16}
              weight="bold"
              className="transition-transform group-hover:translate-x-0.5"
            />
          }
        >
          Continue to deploy
        </Button>
        <p className="mt-2 text-center text-[11px] text-gray-500">
          {usesSite
            ? "Next: point it at your site, then review the settings before it goes live."
            : "Next: name your agent and review the settings before it goes live."}
        </p>
      </div>
    </div>
  );
}

// ─── Local building blocks ────────────────────────────────────────────

function Stat({
  value,
  label,
  sub,
}: {
  value: number;
  label: string;
  sub: string;
}) {
  return (
    <div className="rounded-xl border border-white/[0.07] bg-white/[0.02] px-3 py-2.5 text-center">
      <p className="text-xl font-bold tracking-tight text-white">{value}</p>
      <p className="text-[11px] font-semibold text-gray-300">{label}</p>
      <p className="text-[10px] text-gray-500">{sub}</p>
    </div>
  );
}

function SectionBlock({
  title,
  intro,
  children,
}: {
  title: string;
  intro: string;
  children: ReactNode;
}) {
  return (
    <section className="space-y-2.5">
      <div>
        <h3 className="text-sm font-bold tracking-tight text-white">{title}</h3>
        <p className="mt-0.5 text-xs leading-relaxed text-gray-500">{intro}</p>
      </div>
      {children}
    </section>
  );
}

function SettingRow({ variable }: { variable: BlueprintVariable }) {
  const isSecret = variable.type === "secret";
  return (
    <li className="flex items-start gap-3 rounded-xl border border-white/[0.07] bg-white/[0.02] p-3">
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-violet-500/10 text-violet-300 ring-1 ring-inset ring-violet-500/20">
        {isSecret ? (
          <LockSimple size={15} weight="bold" />
        ) : (
          <Sparkle size={15} weight="bold" />
        )}
      </span>
      <div className="min-w-0">
        <p className="flex items-center gap-1.5 text-sm font-semibold text-white">
          {variable.label || variable.key}
          {variable.required && (
            <span className="rounded bg-rose-500/15 px-1 py-px text-[9px] font-semibold uppercase tracking-wide text-rose-300">
              required
            </span>
          )}
        </p>
        {variable.description && (
          <p className="mt-0.5 text-xs leading-relaxed text-gray-400">
            {tidyDashes(variable.description)}
          </p>
        )}
      </div>
    </li>
  );
}

function Empty({ children }: { children: ReactNode }) {
  return (
    <p className="rounded-xl border border-dashed border-white/10 bg-white/[0.015] px-3 py-3 text-xs text-gray-500">
      {children}
    </p>
  );
}

/** A one-word role tag for a manifest file, from its path. */
function fileRole(path: string): string {
  const p = path.toLowerCase();
  if (/soul/.test(p)) return "Persona";
  if (/protocol|playbook|flow/.test(p)) return "Playbook";
  if (/knowledge|(^|\/)kb\//.test(p)) return "Knowledge";
  if (/config|\.json$/.test(p)) return "Config";
  return "File";
}
