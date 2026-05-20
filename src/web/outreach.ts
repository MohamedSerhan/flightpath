/**
 * Cover-letter / outreach template generator.
 *
 * Takes a Listing + minimal applicant context and produces a
 * polished, employer-type-appropriate first-contact email. The
 * point isn't to remove the applicant from the loop — it's to
 * remove the blank-page tax of writing the same opening over and
 * over for a low-time CFI doing the "cold-call FBOs" hustle the
 * research file flagged as standard advice.
 *
 * The applicant info comes from localStorage (one-time form on the
 * outreach modal); listings stay anonymous.
 */

import type { Listing } from "../shared/types.ts";

export type ApplicantProfile = {
  name?: string;
  email?: string;
  phone?: string;
  baseLocation?: string;
  totalTime?: number;
  /** How many flight hours the pilot is logging per month right now.
   *  Used by the hours-to-ATP banner to project a runway date. Optional. */
  monthlyHours?: number;
  multiEngineHours?: number;
  turbineHours?: number;
  tailwheelHours?: number;
  complexHours?: number;
  instrumentHours?: number;
  picHours?: number;
  crossCountryHours?: number;
  hasInstrument?: boolean;
  hasMultiEngine?: boolean;
  hasCfii?: boolean;
  hasMei?: boolean;
  willingToRelocate?: boolean;
  notes?: string;
};

const STORAGE_KEY = "flightpath:applicant";

export function readApplicantProfile(): ApplicantProfile {
  if (typeof localStorage === "undefined") return {};
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as ApplicantProfile) : {};
  } catch {
    return {};
  }
}

export function writeApplicantProfile(p: ApplicantProfile): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(p));
  } catch {
    /* ignore quota errors */
  }
}

/** Decide which template to use for an employer based on the listing. */
function classifyEmployer(listing: Listing): "school" | "fbo" | "regional" | "corporate" | "charter" | "generic" {
  const text = `${listing.title} ${listing.employer ?? ""} ${listing.url ?? ""}`.toLowerCase();
  if (/(flight\s*school|aviation\s*academy|college|university|atp\b|embry|aero(naut|space))/i.test(text)) return "school";
  if (/(airline|regional|airways|skywest|endeavor|breeze|piedmont|envoy|psa|republic|cape\s*air|jetblue|spirit|alaska|delta|american\s*airlines|united)/i.test(text)) return "regional";
  if (/(charter|part\s*135|fractional|netjets|flexjet|wheels\s*up|jet\s*linx|solairus|talon)/i.test(text)) return "charter";
  if (/(corporate|gulfstream|citation|challenger|falcon|pic\b|sic\b|captain|first\s*officer)/i.test(text)) return "corporate";
  if (/(fbo|fixed\s*base|line\s*service|airport)/i.test(text)) return "fbo";
  return "generic";
}

function ratingsLine(p: ApplicantProfile): string {
  const items: string[] = ["CFI"];
  if (p.hasInstrument) items.push("Instrument");
  if (p.hasMultiEngine) items.push("Multi-Engine");
  if (p.hasCfii) items.push("CFII");
  if (p.hasMei) items.push("MEI");
  return items.join(", ");
}

function header(p: ApplicantProfile): string {
  const parts: string[] = [];
  if (p.name) parts.push(p.name);
  const contact: string[] = [];
  if (p.email) contact.push(p.email);
  if (p.phone) contact.push(p.phone);
  if (contact.length > 0) parts.push(contact.join(" · "));
  if (p.baseLocation) parts.push(p.baseLocation);
  return parts.join("\n");
}

function signature(p: ApplicantProfile): string {
  const lines = ["Best regards,"];
  if (p.name) lines.push(p.name);
  const contact: string[] = [];
  if (p.email) contact.push(p.email);
  if (p.phone) contact.push(p.phone);
  if (contact.length > 0) lines.push(contact.join(" · "));
  return lines.join("\n");
}

export type OutreachOutput = {
  subject: string;
  body: string;
};

export type OutreachMode = "initial" | "follow-up";

export function buildOutreach(
  listing: Listing,
  p: ApplicantProfile,
  mode: OutreachMode = "initial",
): OutreachOutput {
  if (mode === "follow-up") return buildFollowUp(listing, p);
  return buildInitial(listing, p);
}

function buildInitial(listing: Listing, p: ApplicantProfile): OutreachOutput {
  const employerType = classifyEmployer(listing);
  const employerName = listing.employer ?? "your team";
  const ratings = ratingsLine(p);
  const tt = p.totalTime ? `~${p.totalTime.toLocaleString()} hours total` : "limited total time but a strong training foundation";
  const relocation = p.willingToRelocate ? "I am open to relocating to support a great opportunity." : "";
  const baseLine = p.baseLocation ? `Currently based in ${p.baseLocation}.` : "";

  const subject = `${listing.title} — ${p.name ?? "Pilot inquiry"}`;
  const intro = header(p);

  // Per-type opener / value-prop. Each template stays short on purpose —
  // employers skim. Specifics come from the applicant editing the draft.
  const templates: Record<typeof employerType, string> = {
    school: `Hello ${employerName.split(" ")[0]} hiring team,

I'm writing to express my interest in the ${listing.title} role I saw on your careers page. I am a ${ratings}-rated pilot with ${tt}, and I'd be a strong fit for a flight-instruction position in your program.

${baseLine} ${relocation}

A few specifics that may be relevant:
- Comfortable with structured Part 141 syllabi and FOI principles
- Reliable, professional with students and ground staff, and consistent record-keeper
- Looking for a long-term seat where I can grow with the school as I build toward Part 121 minimums

I'd welcome the chance to talk through your current openings and the school's training environment. My resume and logbook summary are available on request.

${signature(p)}`,

    fbo: `Hello ${employerName.split(" ")[0]} team,

I'm reaching out about the ${listing.title} role posted recently. As a ${ratings}-rated CFI with ${tt}, I'm looking for a home airport where I can teach actively, build hours, and be useful to the operation beyond instruction.

${baseLine} ${relocation}

I'd be grateful for the opportunity to meet, see the airfield, and talk about how I could contribute. Happy to come by in person if that helps.

${signature(p)}`,

    regional: `Hello,

I'm writing to express interest in the ${listing.title} pathway with ${employerName}. I am a CFI ( ${ratings} ) with ${tt}, currently building toward Part 121 minimums, and I'd appreciate guidance on the right cadence for applying through your hiring pipeline.

${baseLine} ${relocation}

If a recruiter is available to speak briefly about the program, expected timelines, and any prerequisite training I should be working on now, I'd value the conversation.

${signature(p)}`,

    charter: `Hello ${employerName.split(" ")[0]} hiring team,

I'm reaching out about the ${listing.title} opening. I'm a CFI ( ${ratings} ) with ${tt} and a strong interest in Part 135 / charter flying as the next step in my career.

${baseLine} ${relocation}

I understand mins for this seat may exceed my current totals — I'd still appreciate a short conversation about your hiring runway and what I should be focused on building toward (sim time, multi PIC, etc.) to be a strong candidate when ready.

${signature(p)}`,

    corporate: `Hello,

I'm writing about the ${listing.title} opening at ${employerName}. I am a ${ratings}-rated pilot with ${tt}. I recognize this role likely targets a more experienced PIC/SIC pool — I'm reaching out to introduce myself, ask about your hiring cadence, and see if there's a path I should be working toward.

${baseLine} ${relocation}

If a brief introductory call is possible, I'd appreciate the opportunity. Happy to share more detail on training and goals.

${signature(p)}`,

    generic: `Hello ${employerName.split(" ")[0]} hiring team,

I'd like to express interest in the ${listing.title} role. I am a ${ratings}-rated pilot with ${tt}, and I believe I can contribute to your operation.

${baseLine} ${relocation}

I'd welcome the chance to discuss the role and how my training background lines up with your needs.

${signature(p)}`,
  };

  const body = `${intro ? intro + "\n\n" : ""}${templates[employerType]}`;

  return { subject, body };
}

function buildFollowUp(listing: Listing, p: ApplicantProfile): OutreachOutput {
  const employerName = listing.employer ?? "your team";
  const subject = `Following up — ${listing.title}${p.name ? ` (${p.name})` : ""}`;
  const intro = header(p);

  // Single template — follow-ups don't need the per-employer-type
  // tailoring of the initial outreach. Keep it short, polite, action-
  // oriented; ask for a status, offer to provide more info.
  const template = `Hello ${employerName.split(" ")[0]} hiring team,

I'm following up on my application for the ${listing.title} role. I wanted to check in and confirm my continued interest in the position.

If a status update or next-step timeline is available, I'd appreciate hearing it. I'm also happy to provide any additional information — references, logbook summary, or a brief introductory call — that would help your evaluation.

Thank you for your time.

${signature(p)}`;

  const body = `${intro ? intro + "\n\n" : ""}${template}`;
  return { subject, body };
}
