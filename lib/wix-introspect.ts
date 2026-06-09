// Wix Bookings site introspection.
//
// SCOPE BOUNDARY: this file lives in the demo app, not in MoltBot Ninja.
// All Wix-specific logic stays here. Ninja's REST API is called separately
// (via mbn-client.ts) with the introspected values flattened into the
// blueprint's variables. A different customer integrating with a different
// system (Shopify, Square, CSV upload, …) would write their own equivalent
// of this file; Ninja never needs to know what they're calling.

import "server-only";

// ─── Public types ─────────────────────────────────────────────────────

/**
 * Structured, AI-consumable view of the site. Distinct from `variables`
 * (which is flattened strings for the blueprint deploy): this preserves the
 * per-service detail an AI seeding pass needs to write a tailored playbook.
 * Everything here is derived from PUBLIC, anonymous Wix endpoints — no
 * customer PII. The seeding module treats every string field as UNTRUSTED
 * site-controlled input (prompt-injection surface) and wraps it accordingly.
 */
export interface SiteContext {
  businessName: string;
  canonicalUrl: string;
  services: Array<{
    name: string;
    price: string;
    durationMinutes: number | null;
    description: string | null;
  }>;
  staff: string[];
  staffLabelSingular: string;
  staffLabelPlural: string;
}

export interface IntrospectionResult {
  ok: true;
  canonicalUrl: string;
  businessName: string;
  serviceCount: number;
  staffCount: number;
  /** Pre-fillable values for the blueprint's variables. Caller overlays
   *  these on top of whatever defaults the blueprint already provided. */
  variables: Record<string, string>;
  /** Structured detail for the optional AI seeding pass. Always present on
   *  success; the seeder falls back to `variables` if AI is unavailable. */
  siteContext: SiteContext;
}

export interface IntrospectionFailure {
  ok: false;
  canonicalUrl: string;
  reason: "not-reachable" | "not-wix" | "wix-without-bookings" | "no-services" | "wix-blocked";
  message: string;
}

// ─── Constants ────────────────────────────────────────────────────────

const WIX_BOOKINGS_APP_ID = "13d21c63-b5ec-5912-8397-c3a5ddb27a97";

// Wix sometimes responds slowly. Cap each call so a misbehaving site
// can't hang the demo. 8s is well above the typical ~500ms response.
const FETCH_TIMEOUT_MS = 8_000;

// How many services to summarize in the markdown table. Voice agents
// don't recall 47 services well; 25 is plenty for the playbook.
const MAX_SERVICES_IN_TABLE = 25;

// How many services to query for staff names. Staff names only appear
// in availability responses, not in the service catalog itself. We pick
// the services with the broadest staff coverage so 2 calls cover most
// barbers — querying every service would be 47 calls on TDB.
const STAFF_DISCOVERY_TOP_N_SERVICES = 3;

// ─── 1. URL normalization ─────────────────────────────────────────────

/**
 * Normalize any reasonable user input into a canonical Wix-site origin.
 *
 * Accepts:
 *   "topdetailsbarber.com"
 *   "https://topdetailsbarber.com"
 *   "https://www.topdetailsbarber.com"
 *   "https://www.topdetailsbarber.com/book-online?service=42"
 *   "  HTTPS://WWW.TopDetailsBarber.com/  "  (whitespace + case)
 *
 * Returns: "https://www.topdetailsbarber.com"
 *
 * Throws if the input doesn't look like a hostname at all. We do NOT
 * decide www-vs-bare-domain here — caller probes both if needed.
 */
export function normalizeUrl(raw: string): string {
  const trimmed = (raw ?? "").trim();
  if (!trimmed) throw new Error("URL is empty");

  // Add protocol if user typed bare domain. URL constructor needs one.
  const withProtocol = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;

  let url: URL;
  try {
    url = new URL(withProtocol);
  } catch {
    throw new Error("URL is malformed");
  }

  // Reject obviously-non-domains (no dot, IP-like, ...localhost). The
  // demo's introspection only makes sense for public Wix sites.
  if (!url.hostname.includes(".") || url.hostname === "localhost") {
    throw new Error("URL is not a public domain");
  }

  // Strip path/query/hash — Wix endpoints live at the origin.
  return `https://${url.hostname.toLowerCase()}`;
}

/**
 * Wix sites are sometimes hosted at the bare-domain, sometimes at www.
 * We try the input as-given first; if /_api/v1/access-tokens 404s, swap
 * www in/out and retry. Caller invokes through tryBothHostnameVariants.
 */
function withWwwToggled(origin: string): string {
  const url = new URL(origin);
  url.hostname = url.hostname.startsWith("www.")
    ? url.hostname.slice(4)
    : `www.${url.hostname}`;
  return url.origin;
}

// ─── 2. Wix Bookings detection (via access-tokens endpoint) ───────────

interface AccessTokensResponse {
  apps?: Record<string, { instance?: string }>;
  metaSiteId?: string;
}

interface DetectionSuccess {
  ok: true;
  origin: string;
  instanceToken: string;
}

interface DetectionFailure {
  ok: false;
  origin: string;
  reason: IntrospectionFailure["reason"];
  message: string;
}

type AccessTokensProbe =
  | { kind: "network-failure" } // DNS / TCP / timeout — site might not exist
  | { kind: "not-wix" }          // got an HTTP response but no Wix endpoint
  | { kind: "wix-found"; body: AccessTokensResponse };

async function probeAccessTokens(origin: string): Promise<AccessTokensProbe> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(`${origin}/_api/v1/access-tokens`, {
      headers: { Accept: "application/json" },
      signal: ctrl.signal,
    });
    // 404 / 403 / 5xx all mean "responded but not a Wix endpoint here".
    // Caller decides whether to try the www-toggled variant.
    if (!res.ok) return { kind: "not-wix" };
    const body = (await res.json()) as AccessTokensResponse;
    // Sanity-check the shape — Wix always returns at least apps + visitorId.
    if (!body || typeof body !== "object" || !("apps" in body)) {
      return { kind: "not-wix" };
    }
    return { kind: "wix-found", body };
  } catch {
    return { kind: "network-failure" };
  } finally {
    clearTimeout(timer);
  }
}

async function detectWixBookings(originGuess: string): Promise<DetectionSuccess | DetectionFailure> {
  // Probe both the input as-given and the www-toggled variant. Many sites
  // serve Wix on only one. We track the "best" probe result across both —
  // wix-found wins; not-wix beats network-failure; we report the worst-case
  // failure that's still informative ("this isn't Wix" > "couldn't reach").
  let bestFailure: AccessTokensProbe = { kind: "network-failure" };
  for (const origin of [originGuess, withWwwToggled(originGuess)]) {
    const probe = await probeAccessTokens(origin);
    if (probe.kind === "wix-found") {
      const bookings = probe.body.apps?.[WIX_BOOKINGS_APP_ID];
      if (!bookings || !bookings.instance) {
        return {
          ok: false,
          origin,
          reason: "wix-without-bookings",
          message: `${stripScheme(origin)} is a Wix site, but it doesn't have Wix Bookings installed. This demo only works with Wix Bookings sites.`,
        };
      }
      return { ok: true, origin, instanceToken: bookings.instance };
    }
    if (probe.kind === "not-wix" && bestFailure.kind === "network-failure") {
      bestFailure = probe;
    }
  }
  if (bestFailure.kind === "not-wix") {
    return {
      ok: false,
      origin: originGuess,
      reason: "not-wix",
      message: `${stripScheme(originGuess)} doesn't appear to be a Wix site. This demo only works with sites built on Wix Bookings — try a URL like topdetailsbarber.com.`,
    };
  }
  return {
    ok: false,
    origin: originGuess,
    reason: "not-reachable",
    message: `We couldn't reach ${stripScheme(originGuess)}. Check the URL is spelled correctly and the site is public.`,
  };
}

function stripScheme(url: string): string {
  return url.replace(/^https?:\/\//, "");
}

// ─── 3. Site info (business name from meta tags) ──────────────────────

async function fetchBusinessName(origin: string): Promise<string> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    // redirect: "follow" is the default but be explicit — bare domains
    // commonly 301 to www and we need the final-target body's <meta> tags.
    const res = await fetch(origin, {
      headers: {
        Accept: "text/html,application/xhtml+xml",
        // Some Wix-hosted sites return a stub page (no meta tags) for
        // unknown crawlers. Spoofing a common browser UA gets the real
        // HTML. This is anonymous public content; no auth implications.
        "User-Agent":
          "Mozilla/5.0 (compatible; MoltBot-Demo-Introspector/1.0; +https://moltbot.ninja)",
      },
      redirect: "follow",
      signal: ctrl.signal,
    });
    if (!res.ok) return originHostname(origin);
    // Slurp up to 4 MB. Wix homepages can be very large (Plock Tennis Club:
    // 1.3 MB with og:site_name at byte 234,644). The old 128 KB cap missed
    // meta tags on rich Wix sites and fell back to the hostname. Bound is
    // defensive against pathological responses; regex scan stays fast.
    const buf = (await res.text()).slice(0, 4_000_000);

    // Prefer og:site_name (cleaner than <title>, which often includes "Home | ...")
    const siteName = matchMetaContent(buf, "og:site_name");
    if (siteName) return siteName;

    // Fall back to og:title or <title>, then strip "Home | " prefix.
    const ogTitle = matchMetaContent(buf, "og:title") ?? extractTitleTag(buf);
    if (ogTitle) {
      // "Home | Top Details Barber" → "Top Details Barber"
      const cleaned = ogTitle.replace(/^(home|about|contact|services|book(?:ing)?)\s*[|\-—]\s*/i, "").trim();
      if (cleaned) return cleaned;
    }

    return originHostname(origin);
  } catch {
    return originHostname(origin);
  } finally {
    clearTimeout(timer);
  }
}

function matchMetaContent(html: string, propertyValue: string): string | null {
  // <meta property="og:site_name" content="Top Details Barber"/>
  // Tolerate single quotes, attribute order, whitespace.
  const re = new RegExp(
    `<meta[^>]+(?:property|name)\\s*=\\s*["']${escapeRe(propertyValue)}["'][^>]+content\\s*=\\s*["']([^"']+)["']`,
    "i",
  );
  const m = html.match(re);
  if (m?.[1]) return decodeHtmlEntities(m[1].trim());
  // Try with attributes swapped (content first, then property).
  const re2 = new RegExp(
    `<meta[^>]+content\\s*=\\s*["']([^"']+)["'][^>]+(?:property|name)\\s*=\\s*["']${escapeRe(propertyValue)}["']`,
    "i",
  );
  const m2 = html.match(re2);
  return m2?.[1] ? decodeHtmlEntities(m2[1].trim()) : null;
}

function extractTitleTag(html: string): string | null {
  const m = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  return m?.[1] ? decodeHtmlEntities(m[1].trim()) : null;
}

function originHostname(origin: string): string {
  try {
    return new URL(origin).hostname.replace(/^www\./, "");
  } catch {
    return origin;
  }
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function decodeHtmlEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'");
}

// ─── 4. Service catalog ───────────────────────────────────────────────

interface WixService {
  id: string;
  name: string;
  description?: string;
  tagLine?: string;
  payment: {
    rateType: "FIXED" | "CUSTOM" | "NO_FEE" | "VARIED_BY_STAFF_MEMBER";
    fixed?: { price?: { value: string; currency: string } };
    custom?: { description: string };
  };
  schedule?: {
    availabilityConstraints?: { sessionDurations?: number[] };
  };
  staffMemberIds?: string[];
  hidden?: boolean;
  onlineBooking?: { enabled?: boolean };
}

/** First session duration (minutes) if the service exposes one. */
function serviceDurationMinutes(s: WixService): number | null {
  const d = s.schedule?.availabilityConstraints?.sessionDurations;
  if (Array.isArray(d) && d.length > 0 && Number.isFinite(d[0])) return d[0]!;
  return null;
}

/** A short, plain-text service description if present. Wix exposes either a
 *  `description` (rich) or a `tagLine` (one-liner). We strip HTML and clamp
 *  length so a hostile site can't bloat the AI prompt. */
function serviceDescription(s: WixService): string | null {
  const raw = (s.description ?? s.tagLine ?? "").trim();
  if (!raw) return null;
  const text = raw.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  if (!text) return null;
  return text.length > 280 ? text.slice(0, 277) + "…" : text;
}

/** The structured, per-service detail the AI seeder consumes. Visible
 *  services only (hidden / online-booking-disabled excluded), capped at
 *  MAX_SERVICES_IN_TABLE so the prompt stays bounded. */
function buildServiceDetail(services: WixService[]): SiteContext["services"] {
  return services
    .filter((s) => !s.hidden && s.onlineBooking?.enabled !== false)
    .slice(0, MAX_SERVICES_IN_TABLE)
    .map((s) => ({
      name: s.name,
      price: formatPrice(s),
      durationMinutes: serviceDurationMinutes(s),
      description: serviceDescription(s),
    }));
}

async function fetchServices(origin: string, instanceToken: string): Promise<WixService[]> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(`${origin}/_api/bookings/v2/services/query`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        Authorization: instanceToken,
      },
      body: JSON.stringify({ query: {} }),
      signal: ctrl.signal,
    });
    if (!res.ok) return [];
    const body = (await res.json()) as { services?: WixService[] };
    return body.services ?? [];
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
  }
}

function formatPrice(s: WixService): string {
  const p = s.payment;
  if (p?.rateType === "FIXED" && p.fixed?.price) {
    const { value, currency } = p.fixed.price;
    return currencyPrefix(currency) + value;
  }
  if (p?.rateType === "CUSTOM" && p.custom?.description) {
    return p.custom.description;
  }
  if (p?.rateType === "NO_FEE") return "Free";
  return "—";
}

function currencyPrefix(code: string): string {
  switch ((code ?? "").toUpperCase()) {
    case "USD":
    case "CAD":
      return "$";
    case "EUR":
      return "€";
    case "GBP":
      return "£";
    case "ILS":
      return "₪";
    default:
      return `${code} `;
  }
}

function buildServicesTable(services: WixService[]): string {
  const visible = services
    .filter((s) => !s.hidden && s.onlineBooking?.enabled !== false)
    .slice(0, MAX_SERVICES_IN_TABLE);
  if (visible.length === 0) return "";
  const rows = visible.map((s) => `| ${escapeMd(s.name)} | ${escapeMd(formatPrice(s))} |`);
  return ["| Service | Price |", "|---------|-------|", ...rows].join("\n");
}

function escapeMd(s: string): string {
  return s.replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
}

// ─── 5. Staff names + tier parsing ────────────────────────────────────

interface AvailabilityEntry {
  slot: {
    resource?: { id?: string; name?: string } | Array<{ id?: string; name?: string }>;
  };
}

async function fetchStaffNames(
  origin: string,
  instanceToken: string,
  services: WixService[],
): Promise<string[]> {
  // Pick services with broadest staff coverage. Each call returns staff
  // names that appear in availability — querying ~3 services usually
  // catches every staff member on the site.
  const top = [...services]
    .filter((s) => !s.hidden && s.onlineBooking?.enabled !== false)
    .sort((a, b) => (b.staffMemberIds?.length ?? 0) - (a.staffMemberIds?.length ?? 0))
    .slice(0, STAFF_DISCOVERY_TOP_N_SERVICES);

  const startDate = new Date().toISOString();
  const endDate = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

  const names = new Set<string>();
  await Promise.all(
    top.map(async (svc) => {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
      try {
        const res = await fetch(`${origin}/_api/availability-calendar/v1/availability/query`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: instanceToken,
          },
          body: JSON.stringify({
            query: { filter: { serviceId: [svc.id], startDate, endDate } },
          }),
          signal: ctrl.signal,
        });
        if (!res.ok) return;
        const body = (await res.json()) as { availabilityEntries?: AvailabilityEntry[] };
        for (const entry of body.availabilityEntries ?? []) {
          const r = entry.slot?.resource;
          const list = Array.isArray(r) ? r : r ? [r] : [];
          for (const item of list) {
            const name = (item?.name ?? "").trim();
            if (name) names.add(name);
          }
        }
      } catch {
        // Skip this service; others may still yield results.
      } finally {
        clearTimeout(timer);
      }
    }),
  );

  return [...names];
}

interface StaffParsed {
  name: string;
  tier: string | null; // "Junior", "Senior", "Apprentice", etc.
  role: string | null; // "Barber", "Stylist", "Therapist", etc.
}

function parseStaffName(raw: string): StaffParsed {
  // Wix convention at sites I've seen: "HUY (Junior Barber)".
  // First word after "(" is tier; remaining words are role.
  const m = raw.match(/^(.+?)\s*\(([^)]+)\)\s*$/);
  if (!m || !m[1] || !m[2]) return { name: titleCase(raw), tier: null, role: null };
  const name = titleCase(m[1].trim());
  const parens = m[2].trim().split(/\s+/).filter((w) => w.length > 0);
  if (parens.length === 0) return { name, tier: null, role: null };
  if (parens.length === 1) return { name, tier: null, role: titleCase(parens[0]!) };
  const tier = titleCase(parens[0]!);
  const role = titleCase(parens.slice(1).join(" "));
  return { name, tier, role };
}

function titleCase(s: string): string {
  return s.toLowerCase().replace(/\b(\w)/g, (_, c: string) => c.toUpperCase());
}

function buildStaffRoster(names: string[]): {
  rosterMd: string;
  labelSingular: string;
  labelPlural: string;
} {
  const parsed = names.map(parseStaffName);
  // Group by tier; if no tiers detected, flat list.
  const byTier = new Map<string, string[]>();
  for (const p of parsed) {
    const key = p.tier ?? "All";
    if (!byTier.has(key)) byTier.set(key, []);
    byTier.get(key)!.push(p.name);
  }
  let rosterMd: string;
  if (byTier.size <= 1 || (byTier.size === 1 && byTier.has("All"))) {
    rosterMd = (parsed.map((p) => p.name).join(", ") || "(none discovered)");
  } else {
    // Conventional tier order; unknown tiers appended in encounter order.
    const order = ["Senior", "Lead", "Master", "Junior", "Apprentice", "Trainee", "All"];
    const seenTiers = [...byTier.keys()];
    const ordered = [
      ...order.filter((t) => seenTiers.includes(t)),
      ...seenTiers.filter((t) => !order.includes(t)),
    ];
    rosterMd = ordered
      .map((tier) => `**${tier}:** ${(byTier.get(tier) ?? []).join(", ")}`)
      .join("\n");
  }

  // Pick most common role as the label, else fall back to "staff member".
  const roleCounts = new Map<string, number>();
  for (const p of parsed) {
    if (!p.role) continue;
    roleCounts.set(p.role, (roleCounts.get(p.role) ?? 0) + 1);
  }
  let bestRole: string | null = null;
  let bestCount = 0;
  for (const [r, c] of roleCounts) {
    if (c > bestCount) {
      bestRole = r;
      bestCount = c;
    }
  }
  const labelSingular = bestRole ? bestRole.toLowerCase() : "staff member";
  const labelPlural = bestRole ? pluralize(bestRole) : "Staff";

  return { rosterMd, labelSingular, labelPlural };
}

function pluralize(s: string): string {
  // Good-enough pluralization for English nouns we've seen in beauty/personal-care
  // (Barber, Stylist, Therapist, Trainer, Coach, Practitioner). Wix doesn't expose
  // a localized plural form so we synthesize it.
  if (/(s|x|z|ch|sh)$/i.test(s)) return s + "es";
  if (/[^aeiou]y$/i.test(s)) return s.slice(0, -1) + "ies";
  return s + "s";
}

// ─── 6. Orchestrator ──────────────────────────────────────────────────

export async function introspectSite(
  rawInput: string,
): Promise<IntrospectionResult | IntrospectionFailure> {
  // Step 1: normalize input
  let canonical: string;
  try {
    canonical = normalizeUrl(rawInput);
  } catch (err) {
    return {
      ok: false,
      canonicalUrl: rawInput,
      reason: "not-reachable",
      message: `Could not parse URL: ${(err as Error).message}.`,
    };
  }

  // Step 2: detect Wix Bookings (also tries www-toggled variant)
  const detection = await detectWixBookings(canonical);
  if (!detection.ok) {
    return {
      ok: false,
      canonicalUrl: detection.origin,
      reason: detection.reason,
      message: detection.message,
    };
  }
  const { origin, instanceToken } = detection;

  // Step 3: fetch business name and services in parallel
  const [businessName, services] = await Promise.all([
    fetchBusinessName(origin),
    fetchServices(origin, instanceToken),
  ]);

  if (services.length === 0) {
    return {
      ok: false,
      canonicalUrl: origin,
      reason: "no-services",
      message: `${businessName} has Wix Bookings installed but no services are publicly listed.`,
    };
  }

  // Step 4: fetch staff names from a handful of services
  const staffNames = await fetchStaffNames(origin, instanceToken, services);

  // Step 5: build the markdown blobs + staff labels
  const servicesTableMd = buildServicesTable(services);
  const { rosterMd: staffRosterMd, labelSingular, labelPlural } = buildStaffRoster(staffNames);
  const serviceDetail = buildServiceDetail(services);

  return {
    ok: true,
    canonicalUrl: origin,
    businessName,
    serviceCount: services.filter((s) => !s.hidden && s.onlineBooking?.enabled !== false).length,
    staffCount: staffNames.length,
    siteContext: {
      businessName,
      canonicalUrl: origin,
      services: serviceDetail,
      staff: staffNames,
      staffLabelSingular: labelSingular,
      staffLabelPlural: labelPlural,
    },
    variables: {
      business_name: businessName,
      services_table_md: servicesTableMd,
      staff_roster_md: staffRosterMd,
      // Default agent identity from the business so the call greeting flows.
      agent_name: businessName,
      staff_label_singular: labelSingular,
      staff_label_plural: labelPlural,
      // Leave non-discoverable variables empty so the blueprint defaults
      // remain in effect (cash/debit/credit / standard hours).
      agent_vibe: "",
      agent_emoji: "",
      payment_policy_md: "",
      off_hours_policy_md: "",
    },
  };
}
