// Static content: tuning constants, the 12 world regions, actions, traps, events.
// Data only — no game logic, no DOM. Map geometry lives in worldgeo.js.

export const CONFIG = {
  daysPerTurn: 5,
  startingDrift: 40,
  driftBase: 5,
  driftPerInfectedRegion: 0.5,
  driftPerGlobalInfection: 14, // × globalInfection (0..1)

  baseGrowth: 0.23,
  growthShape: 4, // logistic shaping so a 2% seed still moves visibly
  transmissionStart: 10,
  transmissionPerUpgrade: 2,
  edgeFlow: 0.14,
  seedThreshold: 0.004,

  // Treatment is a real counterforce: above this much treatment, infection
  // actively declines. The Backfire trap inverts exactly this term.
  treatmentPivot: 115,
  // Collapse only accrues while infection is above this share of the world,
  // and recedes below it — the world repairs itself if you let it.
  collapseFloor: 0.25,

  maxArmedTraps: 2,
  armedTransmissionPenalty: 0.1, // holding a latent payload costs reach

  summitEvery: 6,
  summitCooperation: 12,

  // Clickable outbreak markers — the moment-to-moment reason to watch the map.
  bubbleChance: 0.75,
  bubbleMax: 2,
  bubbleDriftMin: 3,
  bubbleDriftMax: 8,

  cooperationLossThreshold: 80,
  cooperationLossTurns: 8, // ≈40 days at 5 days/turn
  collapseWin: 100,
  cureLoss: 100,

  investigationPerTurn: 1.5,
  investigationResolved: 100,
};

// Two hostile blocs plus a contested middle. Population in millions.
export const REGIONS = [
  { id: 'northAmerica', name: 'North America', short: 'N. America', bloc: 'blue', pop: 500, harsh: false },
  { id: 'westEurope', name: 'Western Europe', short: 'W. Europe', bloc: 'blue', pop: 420, harsh: false },
  { id: 'oceania', name: 'Oceania', short: 'Oceania', bloc: 'blue', pop: 45, harsh: false },

  { id: 'russia', name: 'Russia', short: 'Russia', bloc: 'red', pop: 150, harsh: true },
  { id: 'centralAsia', name: 'Central Asia', short: 'C. Asia', bloc: 'red', pop: 85, harsh: true },
  { id: 'eastAsia', name: 'East Asia', short: 'E. Asia', bloc: 'red', pop: 1650, harsh: false },

  { id: 'eastEurope', name: 'Eastern Europe', short: 'E. Europe', bloc: 'neutral', pop: 290, harsh: false },
  { id: 'middleEast', name: 'Middle East', short: 'Mid. East', bloc: 'neutral', pop: 290, harsh: false },
  { id: 'southAsia', name: 'South Asia', short: 'S. Asia', bloc: 'neutral', pop: 2100, harsh: false },
  { id: 'northAfrica', name: 'North Africa', short: 'N. Africa', bloc: 'neutral', pop: 280, harsh: true },
  { id: 'southAfrica', name: 'Sub-Saharan Africa', short: 'Sub-Saharan', bloc: 'neutral', pop: 1100, harsh: false },
  { id: 'southAmerica', name: 'South America', short: 'S. America', bloc: 'neutral', pop: 440, harsh: false },
];

// Undirected routes. `cross` marks a direct bloc-to-bloc link: political
// tension throttles it, which is how Influence spending reshapes the map.
export const EDGES = [
  { a: 'northAmerica', b: 'southAmerica' },
  { a: 'northAmerica', b: 'westEurope' },
  { a: 'northAmerica', b: 'eastAsia', cross: true },
  { a: 'southAmerica', b: 'northAfrica' },
  { a: 'westEurope', b: 'eastEurope' },
  { a: 'westEurope', b: 'northAfrica' },
  { a: 'westEurope', b: 'middleEast' },
  { a: 'westEurope', b: 'russia', cross: true },
  { a: 'eastEurope', b: 'russia' },
  { a: 'eastEurope', b: 'middleEast' },
  { a: 'russia', b: 'centralAsia' },
  { a: 'russia', b: 'eastAsia' },
  { a: 'centralAsia', b: 'eastAsia' },
  { a: 'centralAsia', b: 'middleEast' },
  { a: 'centralAsia', b: 'southAsia' },
  { a: 'middleEast', b: 'northAfrica' },
  { a: 'middleEast', b: 'southAsia' },
  { a: 'northAfrica', b: 'southAfrica' },
  { a: 'southAfrica', b: 'southAsia' },
  { a: 'southAsia', b: 'eastAsia' },
  { a: 'southAsia', b: 'oceania' },
  { a: 'eastAsia', b: 'oceania' },
];

export const TOTAL_POP = REGIONS.reduce((sum, r) => sum + r.pop, 0);

/**
 * Purchasable actions. Cost escalates: base + step × (times already bought).
 * `preview` is the only prose on the card; `tip` is a hover tooltip.
 */
export const ACTIONS = [
  {
    id: 'transmission',
    track: 'spread',
    name: 'Transmission',
    icon: '↗',
    base: 18,
    step: 8,
    max: 6,
    preview: '+2 transmission · +4 investigation',
    tip: 'Raises the single transmission number driving growth and border flow.',
  },
  {
    id: 'resilience',
    track: 'spread',
    name: 'Climate Resilience',
    icon: '❄',
    base: 26,
    step: 12,
    max: 3,
    preview: '+18% growth in harsh regions',
    tip: 'Russia, Central Asia and North Africa resist you until you adapt.',
  },
  {
    id: 'reach',
    track: 'spread',
    name: 'Vector Reach',
    icon: '✈',
    base: 48,
    step: 0,
    max: 1,
    preview: 'long-range seeding · +6 investigation',
    tip: 'Each turn, a chance to seed a region bordering nothing you hold.',
  },
  {
    id: 'seed',
    track: 'spread',
    name: 'Seed Region',
    icon: '✸',
    base: 14,
    step: 6,
    max: 99,
    needsRegion: true,
    preview: 'selected region → 2% infected',
    tip: 'Place an outbreak by hand in a clean region bordering an infected one.',
  },
  {
    id: 'asymptomatic',
    track: 'spread',
    name: 'Asymptomatic Carriage',
    icon: '◍',
    base: 30,
    step: 16,
    max: 3,
    preview: 'blocs under-count cases by 15% per level',
    tip: 'They treat what they can see. Stay invisible and the response comes late.',
  },
  {
    id: 'resistance',
    track: 'spread',
    name: 'Drug Resistance',
    icon: '⊗',
    base: 42,
    step: 26,
    max: 2,
    preview: 'treatment is 20% less effective per level',
    tip: 'Blunts the counterforce that pushes infection down.',
  },
  {
    id: 'disinfo',
    track: 'influence',
    name: 'Disinformation',
    icon: '◈',
    base: 20,
    step: 6,
    max: 99,
    preview: '−6 cooperation · +4 tension · −5 trust',
    tip: 'Cheap, repeatable noise. Keeps the blocs talking past each other.',
  },
  {
    id: 'leak',
    track: 'influence',
    name: 'Leak a Dossier',
    icon: '⚑',
    base: 34,
    step: 10,
    max: 99,
    preview: '−10 cooperation · +10 tension · +8 investigation',
    tip: 'Blame the rival bloc. Powerful, but investigators notice forged paper.',
  },
  {
    id: 'bury',
    track: 'influence',
    name: 'Bury Evidence',
    icon: '⊘',
    base: 24,
    step: 8,
    max: 99,
    preview: '−15 investigation',
    tip: 'Slow the enquiry. If it rules the outbreak natural, the blocs unite.',
  },
  {
    id: 'protest',
    track: 'influence',
    name: 'Fund a Protest Movement',
    icon: '✊',
    base: 38,
    step: 14,
    max: 99,
    preview: '−12 treatment both blocs · −5 trust · +4 tension',
    tip: 'Streets full of people are streets not under containment.',
  },
  {
    id: 'bribe',
    track: 'influence',
    name: 'Bribe an Investigator',
    icon: '⛃',
    base: 44,
    step: 20,
    max: 3,
    preview: 'the enquiry advances 30% slower, permanently',
    tip: 'Cheaper than burying evidence every turn, if bought early.',
  },
  {
    id: 'sabotage',
    track: 'influence',
    name: 'Sabotage Summit',
    icon: '✕',
    base: 45,
    step: 0,
    max: 99,
    preview: 'next summit adds no cooperation',
    tip: 'Must be bought before the summit convenes.',
  },
];

/**
 * Traps. A trap may only be armed while its trigger is false — no retroactive
 * arming. If the trigger fires while unarmed, the trap is missed.
 */
export const TRAPS = [
  {
    id: 'backfire',
    name: 'Backfire Response',
    icon: '☣',
    kind: 'Biological',
    cost: 70,
    triggerText: 'Either bloc’s treatment reaches 40',
    effectText: 'Treatment accelerates the outbreak for 3 turns (+60% collapse).',
    tellText: 'Autopsies expose it: +12 investigation when it fires.',
  },
  {
    id: 'decoy',
    name: 'Decoy Coat',
    icon: '⬡',
    kind: 'Immunological',
    cost: 85,
    triggerText: 'Cure research passes 25%',
    effectText: 'Cure progress falls 10 points and crawls for 3 turns. Trust collapses.',
    tellText: 'Costs 15% transmission for as long as you hold it.',
  },
  {
    id: 'sleeper',
    name: 'Sleeper Reservoir',
    icon: '◴',
    kind: 'Latent',
    cost: 75,
    triggerText: 'Any region is declared cleared',
    effectText: 'That region re-emerges at 30% infection three turns later.',
    tellText: 'No early benefit whatsoever — a pure bet on containment working.',
  },
  {
    id: 'cascade',
    name: 'Cure Cascade',
    icon: '⚗',
    kind: 'Research',
    cost: 90,
    triggerText: 'Cure research passes 50%',
    effectText: 'Every further 10% of cure adds +3 collapse and +1 lethality.',
    tellText: 'Also speeds the cure by 15% — a high-risk endgame bet.',
  },
];

/**
 * The event deck. `weight(state)` returns a relative draw weight, so the world
 * the player has made decides which cards come up, and `why` explains that to
 * the player. `effects` is interpreted by the engine — data stays data.
 *
 * `headline` is what the news ticker shows: the modern world reacting.
 */
export const EVENTS = [
  {
    id: 'festival',
    name: 'Festival Superspreader',
    headline: 'Festival goes ahead: 90,000 attend as organisers refuse to cancel',
    why: 'Likelier while infection is established but containment is loose.',
    weight: (s) => 6 + 24 * s.globalInfection * (1 - s.containmentShare),
    effects: [{ infectRandom: 0.08 }],
  },
  {
    id: 'election',
    name: 'Election Cycle',
    headline: 'Incumbent calls case numbers "wildly overstated" days before the vote',
    why: 'Likelier when public trust is low and tension is high.',
    weight: (s) => 4 + (100 - s.publicTrust) * 0.2 + s.tension * 0.14,
    effects: [{ treatment: -8 }, { meter: 'cooperation', delta: -5 }, { meter: 'publicTrust', delta: -4 }],
  },
  {
    id: 'conspiracy',
    name: 'Viral Conspiracy Post',
    headline: '#NotTheVirus trends worldwide; clinics report uptake collapsing overnight',
    why: 'Likelier the lower public trust falls.',
    weight: (s) => 3 + (100 - s.publicTrust) * 0.3,
    effects: [{ meter: 'publicTrust', delta: -14 }, { treatment: -6 }, { meter: 'cooperation', delta: -4 }],
  },
  {
    id: 'influencer',
    name: 'Miracle Cure Goes Viral',
    headline: 'Influencer’s "protocol" hits 40M views; health agencies scramble to respond',
    why: 'Likelier when trust is low and treatment is visible.',
    weight: (s) => 2 + (100 - s.publicTrust) * 0.18 + s.maxTreatment * 0.1,
    effects: [{ meter: 'publicTrust', delta: -10 }, { treatment: -7 }],
  },
  {
    id: 'protests',
    name: 'Mass Lockdown Protests',
    headline: 'Capitals fill with crowds as containment enters its third month',
    why: 'Likelier the more regions are under containment.',
    weight: (s) => 2 + s.containmentShare * 26 + (100 - s.publicTrust) * 0.1,
    effects: [{ treatment: -9 }, { meter: 'publicTrust', delta: -6 }, { meter: 'tension', delta: 4 }, { breakContainment: 1 }],
  },
  {
    id: 'strike',
    name: 'Port Strike',
    headline: 'Dockworkers walk out; 200 vessels idle outside the world’s busiest port',
    why: 'Likelier as military tension rises.',
    weight: (s) => 3 + s.tension * 0.26,
    effects: [{ closeEdge: 3 }, { cureMod: { turns: 2, mult: 0.9 } }],
  },
  {
    id: 'cable',
    name: 'Undersea Cable Cut',
    headline: 'Two trunk cables severed; genomic data sharing stalls indefinitely',
    why: 'Likelier as military tension rises.',
    weight: (s) => 2 + s.tension * 0.24 + s.cure * 0.07,
    effects: [{ cureMod: { turns: 2, mult: 0.4 } }, { meter: 'cooperation', delta: -3 }],
  },
  {
    id: 'travelban',
    name: 'Emergency Travel Ban',
    headline: 'Borders slam shut overnight; stranded travellers fill terminal floors',
    why: 'Likelier once the blocs are cooperating and treatment is scaling.',
    weight: (s) => 1 + s.cooperation * 0.16 + s.maxTreatment * 0.1,
    effects: [{ closeEdge: 4 }, { meter: 'cooperation', delta: 4 }, { meter: 'tension', delta: 6 }],
  },
  {
    id: 'corridor',
    name: 'Refugee Corridor Opens',
    headline: 'Humanitarian corridor agreed; first convoys cross the line of control',
    why: 'Likelier when tension is high but cooperation has not collapsed.',
    weight: (s) => 1 + s.tension * 0.18 + s.cooperation * 0.08,
    effects: [{ openCorridor: 3 }, { meter: 'tension', delta: -5 }],
  },
  {
    id: 'cyclone',
    name: 'Cyclone Evacuation',
    headline: 'Category 4 landfall forces 1.2 million into shelters',
    why: 'Always possible; worse once infection is widespread.',
    weight: (s) => 3 + 10 * s.globalInfection,
    effects: [{ infectRandom: 0.1 }, { treatment: -4 }],
  },
  {
    id: 'heatwave',
    name: 'Record Heatwave',
    headline: 'Third straight record summer; cooling centres open across the north',
    why: 'Background risk, slightly likelier as the world destabilises.',
    weight: (s) => 3 + 6 * s.globalInfection,
    effects: [{ transMod: { turns: 2, mult: 1.25 } }],
  },
  {
    id: 'schools',
    name: 'School Term Begins',
    headline: 'Classrooms reopen; ministers insist attendance is "non-negotiable"',
    why: 'Background risk once the outbreak is established.',
    weight: (s) => 3 + 12 * s.globalInfection,
    effects: [{ infectRandom: 0.07 }],
  },
  {
    id: 'surge',
    name: 'Hospital Surge',
    headline: 'Wards at 140% capacity; untreated patients discharged to free beds',
    why: 'Likelier the more infection outruns treatment.',
    weight: (s) => 1 + 20 * s.globalInfection - s.maxTreatment * 0.06,
    effects: [{ infectRandom: 0.06 }, { treatment: -5 }, { meter: 'publicTrust', delta: -5 }],
  },
  {
    id: 'coldchain',
    name: 'Cold-Chain Break',
    headline: 'Freezer failure spoils 4 million doses in transit',
    why: 'Likelier the more treatment capacity the blocs have built.',
    weight: (s) => 2 + s.maxTreatment * 0.22,
    effects: [{ treatment: -10 }, { meter: 'publicTrust', delta: -6 }],
  },
  {
    id: 'containment',
    name: 'Lab Containment Failure',
    headline: 'Biosafety breach confirmed at a national reference laboratory',
    why: 'Likelier the harder the blocs work on treatment and research.',
    weight: (s) => 2 + s.maxTreatment * 0.12 + s.researchTotal * 0.45,
    effects: [{ seedClean: true }, { meter: 'investigation', delta: 6 }],
  },
  {
    id: 'nationalism',
    name: 'Vaccine Nationalism',
    headline: 'Bloc blocks dose exports "until domestic need is met"',
    why: 'Likelier once research is advanced and tension is high.',
    weight: (s) => 1 + s.researchTotal * 0.4 + s.tension * 0.12,
    effects: [{ meter: 'cooperation', delta: -8 }, { meter: 'tension', delta: 7 }, { meter: 'publicTrust', delta: -3 }],
  },
  {
    id: 'crash',
    name: 'Market Crash',
    headline: 'Indices shed 11% in a session; emergency funding votes delayed',
    why: 'Likelier as the world destabilises.',
    weight: (s) => 1 + 16 * s.globalInfection + s.tension * 0.08,
    effects: [{ research: -1 }, { meter: 'cooperation', delta: -4 }, { meter: 'publicTrust', delta: -5 }],
  },
  {
    id: 'tracing',
    name: 'AI Contact Tracing Rollout',
    headline: 'Nationwide tracing system goes live; privacy challenge filed within hours',
    why: 'Likelier once the blocs are cooperating.',
    weight: (s) => 1 + s.cooperation * 0.2,
    effects: [{ treatment: 8 }, { meter: 'investigation', delta: 5 }, { meter: 'publicTrust', delta: -3 }],
  },
  {
    id: 'leakdata',
    name: 'Genomic Data Leak',
    headline: 'Leaked sequences show true case counts far above official figures',
    why: 'Likelier while a bloc is still concealing its numbers.',
    weight: (s) => (s.concealing ? 8 : 0.5) + s.investigation * 0.06,
    effects: [{ reveal: true }, { meter: 'cooperation', delta: 6 }, { meter: 'investigation', delta: 4 }],
  },
  {
    id: 'funding',
    name: 'Emergency Funding Package',
    headline: 'Record joint appropriation clears both legislatures in a single day',
    why: 'Likelier when cooperation is high.',
    weight: (s) => 0.5 + s.cooperation * 0.22,
    effects: [{ research: 1.5 }, { meter: 'cooperation', delta: 5 }, { treatment: 5 }],
  },
];
