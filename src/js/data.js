// Static content: tuning constants, the 12 world regions, actions, traps, events.
// Data only — no game logic, no DOM. Map geometry lives in worldgeo.js.

export const CONFIG = {
  daysPerTurn: 5,
  startingDrift: 40,
  driftBase: 7,
  driftPerInfectedRegion: 0.7,
  driftPerGlobalInfection: 18, // × globalInfection (0..1)

  baseGrowth: 0.26,
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

  summitEvery: 5,
  summitCooperation: 12,

  cooperationLossThreshold: 80,
  cooperationLossTurns: 6, // ≈30 days at 5 days/turn
  collapseWin: 100,
  cureLoss: 100,

  investigationPerTurn: 1.8,
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
 * Six events. `weight(state)` returns a relative draw weight so the world the
 * player has made determines which cards come up. `why` explains the weighting,
 * so the odds are legible rather than mysterious.
 */
export const EVENTS = [
  {
    id: 'festival',
    name: 'Festival Superspreader',
    text: 'A stadium season goes ahead in a region already carrying cases.',
    why: 'Likelier while infection is established but containment is loose.',
    weight: (s) => 6 + 26 * s.globalInfection * (1 - s.containmentShare),
  },
  {
    id: 'election',
    name: 'Election Cycle',
    text: 'An incumbent downplays case numbers to survive the vote.',
    why: 'Likelier when public trust is low and tension is high.',
    weight: (s) => 4 + (100 - s.publicTrust) * 0.22 + s.tension * 0.16,
  },
  {
    id: 'strike',
    name: 'Port Strike',
    text: 'Shipping strands; one route closes for three turns.',
    why: 'Likelier as military tension rises.',
    weight: (s) => 3 + s.tension * 0.3,
  },
  {
    id: 'cable',
    name: 'Undersea Cable Cut',
    text: 'Genomic data sharing stalls; joint research crawls for two turns.',
    why: 'Likelier as military tension rises.',
    weight: (s) => 2 + s.tension * 0.26 + s.cure * 0.08,
  },
  {
    id: 'coldchain',
    name: 'Cold-Chain Break',
    text: 'A spoiled shipment forces a treatment suspension.',
    why: 'Likelier the more treatment capacity the blocs have built.',
    weight: (s) => 2 + s.maxTreatment * 0.26,
  },
  {
    id: 'containment',
    name: 'Lab Containment Failure',
    text: 'A second seed point escapes a high-security facility.',
    why: 'Likelier the harder the blocs work on treatment and research.',
    weight: (s) => 2 + s.maxTreatment * 0.14 + s.researchTotal * 0.5,
  },
];
