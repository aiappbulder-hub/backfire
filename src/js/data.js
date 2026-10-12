// Static content: tuning constants, the 12-region world, actions, traps, events.
// Everything here is data only — no game logic, no DOM.

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

// Bloc ids: 'red', 'blue', 'neutral'. Coordinates are 0..100 on an abstract map.
export const REGIONS = [
  { id: 'cascade', name: 'Cascade Reach', bloc: 'blue', pop: 180, x: 11, y: 26, harsh: false },
  { id: 'verge', name: 'Atlantic Verge', bloc: 'blue', pop: 210, x: 29, y: 21, harsh: false },
  { id: 'meridian', name: 'Meridian Coast', bloc: 'blue', pop: 160, x: 16, y: 46, harsh: false },
  { id: 'lowland', name: 'Lowland Union', bloc: 'blue', pop: 240, x: 43, y: 39, harsh: false },
  { id: 'karelia', name: 'Karelia Shelf', bloc: 'red', pop: 150, x: 62, y: 17, harsh: true },
  { id: 'volkov', name: 'Volkov Basin', bloc: 'red', pop: 230, x: 77, y: 29, harsh: false },
  { id: 'sayan', name: 'Sayan Uplands', bloc: 'red', pop: 120, x: 67, y: 42, harsh: true },
  { id: 'tiemen', name: 'Tiemen Corridor', bloc: 'red', pop: 300, x: 86, y: 49, harsh: false },
  { id: 'sable', name: 'Sable Gulf', bloc: 'neutral', pop: 260, x: 51, y: 57, harsh: false },
  { id: 'auric', name: 'Auric Plateau', bloc: 'neutral', pop: 190, x: 29, y: 67, harsh: true },
  { id: 'tessellate', name: 'Tessellate Delta', bloc: 'neutral', pop: 310, x: 61, y: 75, harsh: false },
  { id: 'harrow', name: 'Harrow Archipelago', bloc: 'neutral', pop: 90, x: 87, y: 71, harsh: false },
];

// Undirected edges. `cross` marks a bloc-to-bloc border: political tension
// throttles it, which is how Influence spending reshapes the map.
export const EDGES = [
  { a: 'cascade', b: 'verge' },
  { a: 'cascade', b: 'meridian' },
  { a: 'verge', b: 'lowland' },
  { a: 'meridian', b: 'lowland' },
  { a: 'meridian', b: 'auric' },
  { a: 'lowland', b: 'sable' },
  { a: 'lowland', b: 'karelia', cross: true },
  { a: 'karelia', b: 'volkov' },
  { a: 'volkov', b: 'sayan' },
  { a: 'volkov', b: 'tiemen' },
  { a: 'sayan', b: 'tiemen' },
  { a: 'sayan', b: 'sable', cross: true },
  { a: 'tiemen', b: 'harrow' },
  { a: 'sable', b: 'auric' },
  { a: 'sable', b: 'tessellate' },
  { a: 'tessellate', b: 'auric' },
  { a: 'tessellate', b: 'harrow' },
];

export const TOTAL_POP = REGIONS.reduce((sum, r) => sum + r.pop, 0);

/**
 * Purchasable actions. Cost escalates: base + step × (times already bought).
 * `track` is the UI tab; all three tracks draw from the same Drift pool.
 */
export const ACTIONS = [
  {
    id: 'transmission',
    track: 'spread',
    name: 'Transmission',
    base: 18,
    step: 8,
    max: 6,
    blurb: 'Raise the single transmission number driving growth and border flow.',
    preview: '+2 transmission · +4 investigation',
  },
  {
    id: 'resilience',
    track: 'spread',
    name: 'Climate Resilience',
    base: 26,
    step: 12,
    max: 3,
    blurb: 'Harsh regions (Karelia, Sayan, Auric) resist you until you adapt.',
    preview: '+18% growth in harsh regions',
  },
  {
    id: 'reach',
    track: 'spread',
    name: 'Vector Reach',
    base: 48,
    step: 0,
    max: 1,
    blurb: 'Long-haul vectors: a chance each turn to seed a non-adjacent region.',
    preview: 'unlocks long-range seeding · +6 investigation',
  },
  {
    id: 'seed',
    track: 'spread',
    name: 'Seed Region',
    base: 14,
    step: 6,
    max: 99,
    needsRegion: true,
    blurb: 'Place a new outbreak by hand in a selected clean region next to an infected one.',
    preview: 'selected region → 2% infected',
  },
  {
    id: 'disinfo',
    track: 'influence',
    name: 'Disinformation Push',
    base: 20,
    step: 6,
    max: 99,
    blurb: 'Cheap, repeatable noise. Keeps the blocs talking past each other.',
    preview: '−6 cooperation · +4 tension · −5 public trust',
  },
  {
    id: 'leak',
    track: 'influence',
    name: 'Leak a Dossier',
    base: 34,
    step: 10,
    max: 99,
    blurb: 'Blame the rival bloc. Powerful, but investigators notice forged paper.',
    preview: '−10 cooperation · +10 tension · +8 investigation',
  },
  {
    id: 'bury',
    track: 'influence',
    name: 'Bury Evidence',
    base: 24,
    step: 8,
    max: 99,
    blurb: 'Slow the attribution enquiry. If it concludes "natural", the blocs unite.',
    preview: '−15 investigation',
  },
  {
    id: 'sabotage',
    track: 'influence',
    name: 'Sabotage Summit',
    base: 45,
    step: 0,
    max: 99,
    blurb: 'Neutralise the next scheduled summit. Must be bought before it convenes.',
    preview: 'next summit adds no cooperation',
  },
];

/**
 * Traps. A trap may only be armed while `trigger(state)` is false — no
 * retroactive arming. If the trigger fires while unarmed, the trap is missed.
 */
export const TRAPS = [
  {
    id: 'backfire',
    name: 'Backfire Response',
    cost: 70,
    triggerText: 'Either bloc’s treatment programme reaches 40',
    effectText:
      'For 3 turns: treatment accelerates the outbreak instead of slowing it (×2 transmission pressure, +60% collapse).',
    tellText: 'Autopsy data exposes it later: +12 investigation when it fires.',
  },
  {
    id: 'cascade',
    name: 'Cure Cascade',
    cost: 90,
    triggerText: 'Global cure research passes 50%',
    effectText:
      'Every further 10% of cure progress adds +3 collapse per turn and +1 lethality.',
    tellText: 'Raises cure speed by 15% — a high-risk endgame bet.',
  },
];

/**
 * Six events. `weight(state)` returns a relative draw weight so that the
 * world the player has made determines which cards come up. `why` explains
 * the weighting to the player, so odds are legible rather than mysterious.
 */
export const EVENTS = [
  {
    id: 'festival',
    name: 'Festival Superspreader',
    text: 'A stadium season goes ahead in a region already carrying cases.',
    why: 'Likelier while infection is established but containment is still loose.',
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
    text: 'Shipping strands; one border route closes for three turns.',
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
    why: 'Likelier the harder the blocs are working on treatment and research.',
    weight: (s) => 2 + s.maxTreatment * 0.14 + s.researchTotal * 0.5,
  },
];
