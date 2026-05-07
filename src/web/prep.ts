/**
 * CFI / pilot interview & oral-exam prep.
 *
 * Curated question bank covering the common ground a low-time pilot
 * gets quizzed on — flight-school CFI initial-hire interviews, FBO /
 * Part 91 panel interviews, regional airline screen calls. Sourced
 * from the FAA Airman Certification Standards (CFI ACS), 14 CFR Parts
 * 61 / 91 / 141, common community-shared interview reports on
 * r/flying / APC / Jetcareers.
 *
 * Scope is intentionally focused: high-frequency questions a CFI
 * candidate or low-time time-builder will see in real interviews.
 * Each prompt has a short "what they're looking for" answer to keep
 * the bank actionable instead of vague.
 *
 * Add more by appending to PREP_BANK — UI groups by `section`.
 */

export type PrepSection =
  | "foi"
  | "regulations"
  | "weather"
  | "aerodynamics"
  | "performance"
  | "systems"
  | "decision"
  | "behavioral"
  | "logistics";

export type PrepQuestion = {
  section: PrepSection;
  q: string;
  /** Short bullet-points the candidate should hit. NOT a verbatim answer
   *  to read off — interviewers can spot a memorized script in 10
   *  seconds. */
  hits: string[];
  /** Source / reference to look up for depth. */
  ref?: string;
};

export const SECTION_LABELS: Record<PrepSection, string> = {
  foi: "Fundamentals of Instruction (FOI)",
  regulations: "Regulations (Parts 61 / 91 / 141)",
  weather: "Weather & Meteorology",
  aerodynamics: "Aerodynamics & Stalls",
  performance: "Performance & W&B",
  systems: "Aircraft Systems",
  decision: "Aeronautical Decision-Making",
  behavioral: "Behavioral / Fit",
  logistics: "Logistics & Career Plan",
};

export const SECTION_ORDER: PrepSection[] = [
  "foi",
  "regulations",
  "weather",
  "aerodynamics",
  "performance",
  "systems",
  "decision",
  "behavioral",
  "logistics",
];

export const PREP_BANK: PrepQuestion[] = [
  // FOI ----------------------------------------------------------------
  {
    section: "foi",
    q: "What are the basic needs of a learner, per Maslow's hierarchy?",
    hits: [
      "Physiological → safety → social → esteem → self-actualization",
      "Lower needs must be met before higher learning happens",
      "In flight training: a hungry, scared, or fatigued student won't absorb material",
    ],
    ref: "FAA Aviation Instructor's Handbook, Ch. 1",
  },
  {
    section: "foi",
    q: "Walk me through the Laws of Learning.",
    hits: [
      "Readiness, Exercise, Effect, Primacy, Intensity, Recency",
      "Primacy: first impression sticks — teach correctly the first time",
      "Recency: most recent thing is best remembered — review at lesson end",
      "Effect: pleasant experience reinforces; unpleasant inhibits",
    ],
    ref: "AIH Ch. 2",
  },
  {
    section: "foi",
    q: "Levels of learning, lowest to highest?",
    hits: [
      "Rote → Understanding → Application → Correlation",
      "Rote = repeats a fact. Correlation = applies it to a new scenario",
      "CFI's job is to drive students toward Correlation",
    ],
    ref: "AIH Ch. 2",
  },
  {
    section: "foi",
    q: "Difference between teaching and instructing?",
    hits: [
      "Teaching = imparting knowledge",
      "Instructing = teaching + demonstrating + supervising practice",
      "CFIs do both, plus modeling professionalism",
    ],
  },
  {
    section: "foi",
    q: "How do you handle a student who fails a maneuver repeatedly?",
    hits: [
      "Diagnose: knowledge gap, motor-skill gap, or anxiety?",
      "Break the maneuver into smaller building blocks",
      "Demo + immediate practice with talk-through, then silent",
      "Emotional state matters — frustrated students don't learn",
    ],
  },

  // Regulations --------------------------------------------------------
  {
    section: "regulations",
    q: "What flight time / experience does a private pilot need? (FAR 61.109)",
    hits: [
      "40 hours total minimum (Part 61) — 35 if Part 141",
      "20 hours of dual instruction (3 hr cross-country, 3 hr night, 3 hr instrument, 3 hr in prep for the practical)",
      "10 hours of solo (5 hr solo cross-country, 1 solo XC of 150nm)",
      "Real-world average is 60-75 hours",
    ],
    ref: "14 CFR 61.109",
  },
  {
    section: "regulations",
    q: "Currency requirements for carrying passengers? (FAR 61.57)",
    hits: [
      "3 takeoffs and landings within preceding 90 days, same category/class",
      "Tailwheel: TO/L must be to a full stop",
      "Night PAX (1 hr after sunset to 1 hr before sunrise): 3 TO/L to full stop within 90 days",
    ],
    ref: "14 CFR 61.57",
  },
  {
    section: "regulations",
    q: "Required inspections for a Part 91 aircraft?",
    hits: [
      "AAV1ATE: Annual, Airworthiness Directives, VOR (30d for IFR), 100-hour (rental/instruction), Altimeter (24 cal mo for IFR), Transponder (24 cal mo), ELT (12 cal mo, battery 50% life)",
      "Annual = every 12 cal months by IA",
      "100-hour = if used for hire (instruction in school's aircraft counts)",
    ],
    ref: "14 CFR 91.409",
  },
  {
    section: "regulations",
    q: "When do you need supplemental oxygen?",
    hits: [
      "12,500-14,000 MSL: required for crew after 30 min",
      "Above 14,000 MSL: required for crew at all times",
      "Above 15,000 MSL: must be provided to passengers",
    ],
    ref: "14 CFR 91.211",
  },
  {
    section: "regulations",
    q: "What's the difference between Part 61 and Part 141 training?",
    hits: [
      "Part 61: flexible, fewer hour minimums for some certs (e.g., commercial 250 vs 190 hr at 141)",
      "Part 141: structured FAA-approved syllabus, fewer hours but stricter sequence",
      "R-ATP requires 141 program OR military / 4-year aviation degree",
    ],
    ref: "14 CFR Part 141",
  },

  // Weather ------------------------------------------------------------
  {
    section: "weather",
    q: "What is convective SIGMET? When is it issued?",
    hits: [
      "Convective SIGMET = severe thunderstorm activity hazardous to all aircraft",
      "Issued for: tornadoes, embedded thunderstorms, line of TS, hail ≥3/4 inch, severe turbulence",
      "Valid 2 hours, issued hourly H+55",
    ],
    ref: "AIM 7-1-6",
  },
  {
    section: "weather",
    q: "Walk through reading a METAR.",
    hits: [
      "Type, station, time, modifier, wind, vis, weather, sky, temp/dew, altimeter, remarks",
      "Wind: dddff(G)KT — 240@15G25",
      "Vis: SM (statute miles); RVR for runway visual range",
      "Sky: SKC/CLR/FEW/SCT/BKN/OVC + altitude in 100s ft AGL",
      "Temp/dew: M = minus (negative C)",
    ],
    ref: "AIM 7-1-29",
  },
  {
    section: "weather",
    q: "What causes carburetor ice and what conditions are most dangerous?",
    hits: [
      "Venturi cooling + fuel vaporization drops temp 30-70°F",
      "Most dangerous: 20-70°F OAT with high humidity (>50%)",
      "Symptoms: RPM drop in fixed-pitch, MP drop in constant-speed, rough running",
      "Apply heat: brief RPM drop then smoother running confirms ice was present",
    ],
  },
  {
    section: "weather",
    q: "What's a temperature inversion and why does it matter?",
    hits: [
      "Temp increases with altitude (opposite of normal)",
      "Stable air → smooth ride, but pollutants/fog trapped",
      "Wind shear at the inversion top can be hazardous on approach",
      "Often forms overnight under calm conditions",
    ],
  },
  {
    section: "weather",
    q: "Squall line vs. front vs. air mass thunderstorm — differences?",
    hits: [
      "Squall line: line of severe TS ahead of cold front, hardest to penetrate",
      "Frontal TS: along/near a front, moderate-severe",
      "Air mass: isolated afternoon pop-up from heating, generally avoidable",
    ],
  },

  // Aerodynamics -------------------------------------------------------
  {
    section: "aerodynamics",
    q: "Why does an aircraft stall?",
    hits: [
      "Critical angle of attack exceeded — airflow separates from upper surface",
      "Stall is about AOA, not airspeed — can stall at any attitude/airspeed",
      "Recovery: reduce AOA (pitch down), then add power, level wings",
    ],
  },
  {
    section: "aerodynamics",
    q: "Explain ground effect.",
    hits: [
      "Within ~1 wingspan of surface, induced drag reduces dramatically",
      "Wing more efficient → can lift off below normal Vlof or float on landing",
      "Hazard: sucking into ground effect → climbing out of it → wing loses efficiency → settling back",
    ],
  },
  {
    section: "aerodynamics",
    q: "Left-turning tendencies — name and explain.",
    hits: [
      "P-factor: descending blade has higher AOA at high pitch",
      "Torque: prop spinning right → equal/opposite reaction on aircraft to left",
      "Spiraling slipstream: prop wash hits left side of vertical stab",
      "Gyroscopic precession: nose-down pitch in tailwheels translates 90° to left yaw",
    ],
  },
  {
    section: "aerodynamics",
    q: "What is a coordinated turn? Why does it matter?",
    hits: [
      "Yaw rate matches the bank's turn rate — ball centered",
      "Uncoordinated: slipping (rudder behind) or skidding (rudder ahead)",
      "Skidding stall = spin entry; the dangerous one",
    ],
  },

  // Performance --------------------------------------------------------
  {
    section: "performance",
    q: "What's density altitude and why do we care?",
    hits: [
      "Pressure altitude corrected for non-standard temperature",
      "High DA = thinner air = less lift, less thrust, less prop efficiency",
      "Hot/high/humid days = longer takeoff, weaker climb",
      "Mountain airfields on summer afternoons are the classic killer",
    ],
  },
  {
    section: "performance",
    q: "Walk me through a Vx vs Vy decision.",
    hits: [
      "Vx = best angle, max altitude per horizontal distance — for obstacle clearance",
      "Vy = best rate, max altitude per time — for normal climb",
      "Vx is slower than Vy at sea level; they converge at absolute ceiling",
    ],
  },
  {
    section: "performance",
    q: "How does CG location affect performance and stability?",
    hits: [
      "Forward CG: more stable, more control input needed, slightly slower (more elevator drag)",
      "Aft CG: less stable, lighter pitch control, slightly faster, harder stall recovery",
      "Always within envelope per W&B — outside is illegal and unsafe",
    ],
  },

  // Systems ------------------------------------------------------------
  {
    section: "systems",
    q: "Walk me through the Cessna 172 fuel system.",
    hits: [
      "High wing → gravity feed; no fuel pump on carbureted models, electric pump on injected",
      "Two tanks (~26 gal each in 172S, 53 usable), selector: BOTH/L/R/OFF",
      "Vented fuel caps + crossover vent — vent failure can stop flow from one tank",
      "Fuel strainer + drain points (sumps) — preflight check for water/contamination",
    ],
  },
  {
    section: "systems",
    q: "What causes detonation and pre-ignition?",
    hits: [
      "Detonation: fuel explodes instead of burns — high CHT, low octane, lean mixture",
      "Pre-ignition: fuel ignites before spark — hotspot in cylinder",
      "Both = engine damage. Mitigate: enrich mixture, reduce power, monitor CHT",
    ],
  },

  // Decision -----------------------------------------------------------
  {
    section: "decision",
    q: "What is the IMSAFE checklist?",
    hits: [
      "Illness, Medication, Stress, Alcohol, Fatigue, Emotion / Eating",
      "Self-assessment before every flight — am I fit to act as PIC?",
      "If any answer is uncomfortable, the flight doesn't go",
    ],
    ref: "AIM 8-1-1",
  },
  {
    section: "decision",
    q: "Describe the 5P / DECIDE model.",
    hits: [
      "5P: Plan, Plane, Pilot, Passengers, Programming",
      "DECIDE: Detect, Estimate, Choose, Identify, Do, Evaluate",
      "Use at decision points (top of climb, approach gate) — not just emergencies",
    ],
  },
  {
    section: "decision",
    q: "Tell me about the hazardous attitudes and their antidotes.",
    hits: [
      "Anti-authority → Follow the rules, they're usually right",
      "Impulsivity → Not so fast, think first",
      "Invulnerability → It could happen to me",
      "Macho → Taking chances is foolish",
      "Resignation → I'm not helpless, I can make a difference",
    ],
  },

  // Behavioral / Fit ---------------------------------------------------
  {
    section: "behavioral",
    q: "Tell me about a time you had to give difficult feedback.",
    hits: [
      "STAR: Situation, Task, Action, Result",
      "Pick a real flight or training example — student who needed to fail a stage check, etc.",
      "Lead with care for the student/colleague, end with what changed",
    ],
  },
  {
    section: "behavioral",
    q: "Why this school / FBO / employer?",
    hits: [
      "Specifics: their fleet, their pathway, their location, their reputation",
      "Tie to your own goals — building hours, getting CFII added, regional pipeline",
      "Avoid: generic praise, money-first answers",
    ],
  },
  {
    section: "behavioral",
    q: "Where do you see yourself in 5 years?",
    hits: [
      "Honest career arc — most CFIs want to move to 121 or corporate",
      "Show commitment to current role first — \"build hours teaching well, then…\"",
      "Don't pretend you'll be a lifer if you won't",
    ],
  },
  {
    section: "behavioral",
    q: "How do you handle a student who scares you in the cockpit?",
    hits: [
      "Take controls when safety is at risk — \"my controls\"",
      "Debrief on the ground, not in the air",
      "Identify if it's a knowledge gap, skill gap, or attitude — different remediation",
      "Document. Failures of judgement go in records",
    ],
  },

  // Logistics ----------------------------------------------------------
  {
    section: "logistics",
    q: "What do you need from me to pass FAA scrutiny as a CFI?",
    hits: [
      "Clean medical (Class 1/2/3 depending on activity)",
      "TSA security threat assessment for foreign students",
      "Logbook endorsements: pre-solo, solo, XC, etc.",
      "TCO (Training Course Outline) at Part 141 schools",
      "FOI knowledge test pass + spin endorsement + checkride pass",
    ],
  },
  {
    section: "logistics",
    q: "How many students do you expect to fly per day in a busy season?",
    hits: [
      "2-4 students/day is typical (each lesson 1.5-2.5 hr block)",
      "Avoid >4 — fatigue cost compounds, instruction quality drops",
      "Ask about scheduling flexibility, weather cancellation policy, holiday pay",
    ],
  },
];
