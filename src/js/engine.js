// Backfire game engine — all rules live here. No DOM access, no rendering.
// Everything is deterministic given a seed and the same sequence of player calls.

import { CONFIG, REGIONS, EDGES, ACTIONS, TRAPS, EVENTS, TOTAL_POP } from './data.js';
import { hashSeed, nextRandom, randomInt, weightedPick } from './rng.js';

const REGION_BY_ID = Object.fromEntries(REGIONS.map((r) => [r.id, r]));
const ACTION_BY_ID = Object.fromEntries(ACTIONS.map((a) => [a.id, a]));
const TRAP_BY_ID = Object.fromEntries(TRAPS.map((t) => [t.id, t]));

const NEIGHBOURS = (() => {
  const map = Object.fromEntries(REGIONS.map((r) => [r.id, []]));
  for (const e of EDGES) {
    map[e.a].push(e.b);
    map[e.b].push(e.a);
  }
  return map;
})();

const edgeKey = (e) => `${e.a}|${e.b}`;

/**
 * Timed effects. The convention: an effect created during turn N lasts for the
 * next N_turns full turns — the turn it was created in does not count, because
 * most of that turn has already resolved by the time it starts.
 *
 * `born` records the creating turn so the end-of-turn tick skips it once.
 */
function startTimer(state, turns) {
  return { turns, born: state.turn };
}

function timerActive(state, timer) {
  return Boolean(timer) && timer.turns > 0 && timer.born !== state.turn;
}

function tickTimer(state, timer) {
  if (timer && timer.born !== state.turn) timer.turns -= 1;
  return timer;
}
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const round1 = (v) => Math.round(v * 10) / 10;

// ---------------------------------------------------------------------------
// Construction
// ---------------------------------------------------------------------------

export function createGame(seed = Date.now()) {
  const state = {
    seed: String(seed),
    rngState: hashSeed(seed),
    phase: 'setup', // setup → planning → over
    outcome: null,
    turn: 1,
    day: 0,

    drift: CONFIG.startingDrift,
    purchases: {},

    lethality: 0,
    collapse: 0,
    cure: 0,
    cureRateLast: 0,
    cureMods: [], // [{ turns, mult }]
    transMods: [], // temporary transmission multipliers from events
    corridorTurns: 0, // refugee corridor: cross-bloc friction suspended
    bubbles: [], // clickable outbreak markers worth Drift
    bubbleSeq: 0,
    headline: null, // latest news headline, for the ticker
    sleeper: null, // armed Sleeper Reservoir relapse: { regionId, turns, born }
    cureMultiplier: 1, // permanent multiplier (attribution)

    cooperation: 28,
    tension: 46,
    publicTrust: 62,
    investigation: 0,
    investigationResolved: false,
    cooperationStreak: 0,

    blocs: {
      red: {
        id: 'red',
        name: 'Red Bloc',
        treatment: 0,
        research: 0,
        detected: 0,
        concealing: true,
        forcedReveal: false,
      },
      blue: { id: 'blue', name: 'Blue Bloc', treatment: 0, research: 0, detected: 0, concealing: false },
    },

    regions: Object.fromEntries(
      REGIONS.map((r) => [r.id, { id: r.id, inf: 0, contained: false, cleared: false }]),
    ),
    closedEdges: {}, // edgeKey → turns remaining

    traps: Object.fromEntries(
      TRAPS.map((t) => [t.id, { id: t.id, status: 'available', firedTurn: null }]),
    ),
    backfire: null,
    cascadeActive: false,
    cascadeTier: 0,
    sabotageArmed: false,

    log: [],
    turnReport: [],
    briefing: null,
  };

  pushLog(state, 'Choose a region to seed patient zero.', 'system');
  return state;
}

function pushLog(state, text, kind = 'info', pivotal = false) {
  const entry = { turn: state.turn, day: state.day, text, kind, pivotal };
  state.log.push(entry);
  state.turnReport.push(entry);
  return entry;
}

// ---------------------------------------------------------------------------
// Derived values
// ---------------------------------------------------------------------------

export function transmission(state) {
  const upgrades = state.purchases.transmission || 0;
  let t = CONFIG.transmissionStart + upgrades * CONFIG.transmissionPerUpgrade;
  // Holding a latent payload costs a little base reach.
  if (armedTrapCount(state) > 0) t *= 1 - CONFIG.armedTransmissionPenalty;
  // The Decoy Coat is bulky: it costs more while held.
  if (state.traps.decoy.status === 'armed') t *= 0.85;
  for (const mod of state.transMods) if (timerActive(state, mod)) t *= mod.mult;
  return t;
}

/** How much of the real case load the blocs can see. Asymptomatic carriage hides it. */
export function detectionFactor(state) {
  return Math.max(0.3, 1 - 0.15 * (state.purchases.asymptomatic || 0));
}

/** Treatment's real bite, after drug resistance blunts it. */
function effectiveTreatment(state, treat) {
  return treat * Math.max(0.3, 1 - 0.2 * (state.purchases.resistance || 0));
}

export function armedTrapCount(state) {
  return Object.values(state.traps).filter((t) => t.status === 'armed').length;
}

export function metrics(state) {
  let infectedPop = 0;
  let containedInfectedPop = 0;
  let infectedRegions = 0;
  let clearedRegions = 0;

  for (const r of REGIONS) {
    const rs = state.regions[r.id];
    infectedPop += r.pop * rs.inf;
    if (rs.contained) containedInfectedPop += r.pop * rs.inf;
    if (rs.inf > 0.001) infectedRegions++;
    if (rs.cleared) clearedRegions++;
  }

  const globalInfection = infectedPop / TOTAL_POP;
  const maxTreatment = Math.max(state.blocs.red.treatment, state.blocs.blue.treatment);
  const researchTotal = state.blocs.red.research + state.blocs.blue.research;

  return {
    globalInfection,
    infectedRegions,
    clearedRegions,
    containmentShare: infectedPop > 0 ? containedInfectedPop / infectedPop : 0,
    maxTreatment,
    researchTotal,
    cooperation: state.cooperation,
    tension: state.tension,
    publicTrust: state.publicTrust,
    cure: state.cure,
  };
}

/** Research actually feeding the joint cure effort (concealed data is withheld). */
export function sharedResearch(state) {
  const { red, blue } = state.blocs;
  return blue.research + red.research * (red.concealing ? 0.4 : 1);
}

export function driftIncome(state) {
  const m = metrics(state);
  return round1(
    CONFIG.driftBase +
      CONFIG.driftPerInfectedRegion * m.infectedRegions +
      CONFIG.driftPerGlobalInfection * m.globalInfection,
  );
}

/** What the player is allowed to see. A concealing bloc degrades its own data. */
export function visibleInfection(state, regionId) {
  const region = REGION_BY_ID[regionId];
  const rs = state.regions[regionId];
  const concealed = region.bloc === 'red' && state.blocs.red.concealing && rs.inf > 0;
  const seen = rs.inf * detectionFactor(state) * (concealed ? 0.55 : 1);
  return {
    value: seen,
    unverified: concealed || detectionFactor(state) < 1,
  };
}

export function cureForecast(state) {
  const rate = state.cureRateLast;
  if (state.cure >= CONFIG.cureLoss) return { turns: 0, known: true };
  if (rate < 0.05) return { turns: null, known: false };
  return { turns: Math.max(1, Math.ceil((CONFIG.cureLoss - state.cure) / rate)), known: true };
}

export function turnsUntilSummit(state) {
  const every = CONFIG.summitEvery;
  return every - ((state.turn - 1) % every);
}

// ---------------------------------------------------------------------------
// Player actions
// ---------------------------------------------------------------------------

export function actionCost(state, actionId) {
  const action = ACTION_BY_ID[actionId];
  const bought = state.purchases[actionId] || 0;
  return action.base + action.step * bought;
}

export function seedableRegions(state) {
  const anyInfected = REGIONS.some((r) => state.regions[r.id].inf > 0.001);
  return REGIONS.filter((r) => {
    const rs = state.regions[r.id];
    if (rs.inf > 0.001) return false;
    if (!anyInfected) return true;
    return NEIGHBOURS[r.id].some((n) => state.regions[n].inf > 0.001);
  }).map((r) => r.id);
}

/** Seed patient zero during setup. */
export function seedPatientZero(state, regionId) {
  if (state.phase !== 'setup') return { ok: false, reason: 'Patient zero is already placed.' };
  if (!REGION_BY_ID[regionId]) return { ok: false, reason: 'Unknown region.' };
  state.regions[regionId].inf = 0.02;
  state.phase = 'planning';
  state.turnReport = [];
  pushLog(
    state,
    `Patient zero seeded in ${REGION_BY_ID[regionId].name}. Nobody has noticed yet.`,
    'spread',
    true,
  );
  state.briefing = buildBriefing(state);
  return { ok: true };
}

export function canPurchase(state, actionId, regionId = null) {
  if (state.phase !== 'planning') return { ok: false, reason: 'Not in the planning phase.' };
  const action = ACTION_BY_ID[actionId];
  if (!action) return { ok: false, reason: 'Unknown action.' };

  const bought = state.purchases[actionId] || 0;
  if (bought >= action.max) return { ok: false, reason: 'Fully upgraded.' };

  const cost = actionCost(state, actionId);
  if (state.drift < cost) return { ok: false, reason: `Needs ${cost} Drift.` };

  if (action.needsRegion) {
    if (!regionId) return { ok: false, reason: 'Select a region on the map first.' };
    if (!seedableRegions(state).includes(regionId)) {
      return { ok: false, reason: 'Must be a clean region bordering an infected one.' };
    }
  }

  if (actionId === 'sabotage' && state.sabotageArmed) {
    return { ok: false, reason: 'The next summit is already sabotaged.' };
  }

  return { ok: true, cost };
}

export function purchase(state, actionId, regionId = null) {
  const check = canPurchase(state, actionId, regionId);
  if (!check.ok) return check;

  state.drift = round1(state.drift - check.cost);
  state.purchases[actionId] = (state.purchases[actionId] || 0) + 1;

  switch (actionId) {
    case 'transmission':
      state.investigation = clamp(state.investigation + 4, 0, 100);
      pushLog(state, `Transmission raised to ${round1(transmission(state))}.`, 'spread');
      break;
    case 'resilience':
      pushLog(state, `Climate resilience improved (level ${state.purchases.resilience}).`, 'spread');
      break;
    case 'asymptomatic':
      pushLog(state, `Asymptomatic carriage improved — reported cases now run ${Math.round((1 - detectionFactor(state)) * 100)}% below the truth.`, 'spread');
      break;
    case 'resistance':
      pushLog(state, 'Drug resistance acquired. Treatment programmes lose their bite.', 'spread');
      break;
    case 'protest':
      for (const b of ['red', 'blue']) {
        state.blocs[b].treatment = clamp(state.blocs[b].treatment - 12, 0, 100);
      }
      state.publicTrust = clamp(state.publicTrust - 5, 0, 100);
      state.tension = clamp(state.tension + 4, 0, 100);
      pushLog(state, 'Protest movement funded. Containment buckles under the crowds.', 'political');
      break;
    case 'bribe':
      pushLog(state, 'Investigator bribed. The enquiry slows for good.', 'political');
      break;
    case 'reach':
      state.investigation = clamp(state.investigation + 6, 0, 100);
      pushLog(state, 'Long-haul vectors acquired. Distant regions are now reachable.', 'spread');
      break;
    case 'seed':
      state.regions[regionId].inf = Math.max(state.regions[regionId].inf, 0.02);
      pushLog(state, `New outbreak seeded in ${REGION_BY_ID[regionId].name}.`, 'spread');
      break;
    case 'disinfo':
      state.cooperation = clamp(state.cooperation - 6, 0, 100);
      state.tension = clamp(state.tension + 4, 0, 100);
      state.publicTrust = clamp(state.publicTrust - 5, 0, 100);
      pushLog(state, 'Disinformation push: cooperation slips, trust erodes.', 'political');
      break;
    case 'leak':
      state.cooperation = clamp(state.cooperation - 10, 0, 100);
      state.tension = clamp(state.tension + 10, 0, 100);
      state.investigation = clamp(state.investigation + 8, 0, 100);
      pushLog(state, 'Dossier leaked. The blocs blame each other — and investigators dig.', 'political');
      break;
    case 'bury':
      state.investigation = clamp(state.investigation - 15, 0, 100);
      pushLog(state, 'Evidence buried. The attribution enquiry loses ground.', 'political');
      break;
    case 'sabotage':
      state.sabotageArmed = true;
      pushLog(state, 'Summit sabotage prepared. The next summit will achieve nothing.', 'political');
      break;
    default:
      break;
  }

  state.briefing = buildBriefing(state);
  return { ok: true };
}

// --- Traps -----------------------------------------------------------------

/** A trap's trigger condition, evaluated against live state. */
export function trapTriggered(state, trapId) {
  const m = metrics(state);
  if (trapId === 'backfire') return m.maxTreatment >= 40;
  if (trapId === 'decoy') return state.cure >= 25;
  if (trapId === 'sleeper') return REGIONS.some((r) => state.regions[r.id].cleared);
  if (trapId === 'cascade') return state.cure >= 50;
  return false;
}

export function canArmTrap(state, trapId) {
  if (state.phase !== 'planning') return { ok: false, reason: 'Not in the planning phase.' };
  const trap = state.traps[trapId];
  if (!trap) return { ok: false, reason: 'Unknown trap.' };
  if (trap.status !== 'available') return { ok: false, reason: `Already ${trap.status}.` };
  // The defining rule: no retroactive arming.
  if (trapTriggered(state, trapId)) {
    return { ok: false, reason: 'Trigger condition already exists — too late to arm.' };
  }
  if (armedTrapCount(state) >= CONFIG.maxArmedTraps) {
    return { ok: false, reason: `Only ${CONFIG.maxArmedTraps} traps can be held at once.` };
  }
  const cost = TRAP_BY_ID[trapId].cost;
  if (state.drift < cost) return { ok: false, reason: `Needs ${cost} Drift.` };
  return { ok: true, cost };
}

export function armTrap(state, trapId) {
  const check = canArmTrap(state, trapId);
  if (!check.ok) return check;
  state.drift = round1(state.drift - check.cost);
  state.traps[trapId].status = 'armed';
  pushLog(state, `${TRAP_BY_ID[trapId].name} armed. It does nothing until its trigger exists.`, 'trap');
  state.briefing = buildBriefing(state);
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Turn resolution
// ---------------------------------------------------------------------------

export function endTurn(state) {
  if (state.phase !== 'planning') return { ok: false, reason: 'Game is not in play.' };

  state.turnReport = [];
  state.bubbles = []; // last turn's markers expire uncollected
  state.day += CONFIG.daysPerTurn;

  resolveSpread(state);
  resolveBlocs(state);
  resolveEvent(state);
  resolveSummit(state);
  resolvePolitics(state);
  resolveCure(state);
  resolveTraps(state);
  resolveCollapse(state);
  tickTimers(state);

  const ended = checkEndConditions(state);
  if (!ended) {
    state.turn += 1;
    state.drift = round1(state.drift + driftIncome(state));
    spawnBubbles(state);
    state.briefing = buildBriefing(state);
  }
  return { ok: true, report: state.turnReport };
}

/**
 * Outbreak markers: small Drift payouts that appear on infected regions and
 * vanish at the end of the turn. They are the reason to keep watching the map
 * rather than only the panels.
 */
function spawnBubbles(state) {
  const live = REGIONS.filter((r) => state.regions[r.id].inf > 0.02);
  if (!live.length || nextRandom(state) > CONFIG.bubbleChance) return;

  const count = 1 + randomInt(state, CONFIG.bubbleMax);
  const used = new Set();
  for (let i = 0; i < count; i++) {
    const region = live[randomInt(state, live.length)];
    if (used.has(region.id)) continue;
    used.add(region.id);
    const span = CONFIG.bubbleDriftMax - CONFIG.bubbleDriftMin + 1;
    state.bubbles.push({
      id: (state.bubbleSeq += 1),
      regionId: region.id,
      amount: CONFIG.bubbleDriftMin + randomInt(state, span),
    });
  }
}

/** Collect one marker. Returns the Drift gained. */
export function collectBubble(state, bubbleId) {
  const index = state.bubbles.findIndex((b) => b.id === bubbleId);
  if (index === -1) return { ok: false, reason: 'That marker is gone.' };
  const [bubble] = state.bubbles.splice(index, 1);
  state.drift = round1(state.drift + bubble.amount);
  return { ok: true, amount: bubble.amount };
}

/**
 * Final score. Rewards collapse, traps that actually fired and staying
 * unattributed; punishes traps whose trigger passed while unarmed.
 */
export function computeScore(state) {
  const traps = Object.values(state.traps);
  const fired = traps.filter((t) => t.status === 'triggered').length;
  const missed = traps.filter((t) => t.status === 'missed').length;

  const parts = [
    ['Collapse', Math.round(state.collapse * 50)],
    ['Traps sprung', fired * 300],
    ['Traps missed', missed * -150],
    ['Never attributed', Math.round((100 - state.investigation) * 5)],
    ['Speed', Math.max(0, 60 - state.turn) * 40],
  ];

  let score = parts.reduce((sum, [, value]) => sum + value, 0);
  const won = state.outcome && state.outcome.result === 'win';
  if (!won) score = Math.round(score * 0.4);
  score = Math.max(0, score);

  const grade =
    score >= 7000 ? 'S' : score >= 5500 ? 'A' : score >= 4000 ? 'B' : score >= 2500 ? 'C' : 'D';
  return { score, grade, parts, won: Boolean(won) };
}

function treatmentFor(state, region) {
  if (region.bloc === 'neutral') {
    // Neutral regions get whatever spills over from both blocs, at half strength.
    return ((state.blocs.red.treatment + state.blocs.blue.treatment) / 2) * 0.5;
  }
  return state.blocs[region.bloc].treatment;
}

function climateFactor(state, region) {
  if (!region.harsh) return 1;
  return Math.min(1, 0.45 + 0.18 * (state.purchases.resilience || 0));
}

function resolveSpread(state) {
  const trans = transmission(state);
  const scale = trans / CONFIG.transmissionStart;
  const next = {};
  const newOutbreaks = [];

  for (const r of REGIONS) next[r.id] = state.regions[r.id].inf;

  // Internal growth (uses pre-turn values so order never matters).
  for (const r of REGIONS) {
    const rs = state.regions[r.id];
    if (rs.inf <= 0) continue;
    const treat = effectiveTreatment(state, treatmentFor(state, r));
    const backfiring = timerActive(state, state.backfire);

    // Growth and suppression are separate terms. Containment slows the spread
    // AND helps the response clear cases; folding them into one multiplier
    // made containment weaken the very suppression it should strengthen.
    let growth =
      CONFIG.baseGrowth *
      scale *
      rs.inf *
      (1 - rs.inf) *
      CONFIG.growthShape *
      climateFactor(state, r) *
      (rs.contained ? 0.35 : 1);

    if (backfiring) {
      // Backfire Response: every treated case feeds the outbreak instead.
      growth *= 1 + treat / 110;
      next[r.id] += growth;
    } else {
      let contain = rs.contained ? CONFIG.containedSuppressionBonus : 1;
      if (rs.contained) {
        const fed = NEIGHBOURS[r.id].some(
          (n) => state.regions[n].inf > 0.05 && !state.regions[n].contained,
        );
        if (!fed) contain *= CONFIG.coordinatedClearanceBonus; // nothing re-seeding it
      }
      const suppression = rs.inf * (treat / 100) * CONFIG.suppressionRate * contain;
      next[r.id] += growth - suppression;
    }

    // Over-lethality burns through a population instead of sustaining it.
    if (state.lethality > 0 && rs.inf > 0.55) {
      next[r.id] -= rs.inf * state.lethality * 0.004;
    }
  }

  // Cross-border transfer.
  for (const e of EDGES) {
    if (timerActive(state, state.closedEdges[edgeKey(e)])) continue;
    const friction =
      e.cross && state.corridorTurns <= 0 ? Math.max(0.15, 1 - state.tension / 120) : 1;
    for (const [from, to] of [
      [e.a, e.b],
      [e.b, e.a],
    ]) {
      const src = state.regions[from];
      const dst = state.regions[to];
      if (src.inf <= 0.01) continue;
      const dstRegion = REGION_BY_ID[to];
      const flow =
        CONFIG.edgeFlow *
        scale *
        src.inf *
        (1 - dst.inf) *
        friction *
        (src.contained ? 0.3 : 1) *
        (dst.contained ? 0.25 : 1) *
        (dst.cleared ? 0.3 : 1) *
        climateFactor(state, dstRegion);
      if (dst.inf <= 0 && flow < CONFIG.seedThreshold) continue; // too weak to take hold
      if (dst.inf <= 0) newOutbreaks.push(to);
      next[to] += flow;
    }
  }

  // Long-haul vector jumps.
  if (state.purchases.reach && nextRandom(state) < 0.35) {
    const clean = REGIONS.filter((r) => state.regions[r.id].inf <= 0.001);
    if (clean.length) {
      const target = clean[randomInt(state, clean.length)];
      next[target.id] = Math.max(next[target.id], 0.02);
      newOutbreaks.push(target.id);
      pushLog(state, `Long-haul vector lands in ${target.name}.`, 'spread');
    }
  }

  for (const r of REGIONS) {
    state.regions[r.id].inf = clamp(next[r.id], 0, 1);
    if (state.regions[r.id].inf > 0.001 && state.regions[r.id].cleared) {
      state.regions[r.id].cleared = false;
      pushLog(state, `${r.name} is no longer clear — cases are back.`, 'spread', true);
    }
  }

  for (const id of new Set(newOutbreaks)) {
    if (state.regions[id].inf > 0.001) {
      pushLog(state, `Outbreak crosses into ${REGION_BY_ID[id].name}.`, 'spread');
    }
  }
}

function resolveBlocs(state) {
  for (const blocId of ['red', 'blue']) {
    const bloc = state.blocs[blocId];
    const regions = REGIONS.filter((r) => r.bloc === blocId);
    const pop = regions.reduce((s, r) => s + r.pop, 0);
    const detected =
      (regions.reduce((s, r) => s + r.pop * state.regions[r.id].inf, 0) / pop) * detectionFactor(state);
    bloc.detected = detected;

    if (blocId === 'red') {
      const wasConcealing = bloc.concealing;
      bloc.concealing = bloc.forcedReveal ? false : detected < 0.25;
      if (wasConcealing && !bloc.concealing) {
        pushLog(
          state,
          'Red Bloc can no longer hide its case numbers. Real data reaches the joint effort.',
          'bloc',
          true,
        );
      }
    }

    const target = clamp(detected * 170 + state.cooperation * 0.2, 0, 100);
    const before = bloc.treatment;
    bloc.treatment = clamp(bloc.treatment + clamp(target - bloc.treatment, -6, 9), 0, 100);
    if (Math.floor(before / 20) !== Math.floor(bloc.treatment / 20)) {
      pushLog(
        state,
        `${bloc.name} scales its treatment programme to ${Math.round(bloc.treatment)}.`,
        'bloc',
      );
    }

    if (detected > 0.02) {
      const before2 = bloc.research;
      bloc.research = Math.min(10, bloc.research + 0.55 + state.cooperation / 180);
      if (before2 < 0.01) pushLog(state, `${bloc.name} opens a research programme.`, 'bloc', true);
    }

    // Containment and clearance decisions.
    for (const r of regions) {
      const rs = state.regions[r.id];
      if (!rs.contained && !rs.cleared && rs.inf > 0.18 && bloc.treatment > 25) {
        rs.contained = true;
        pushLog(state, `${bloc.name} declares containment in ${r.name}.`, 'bloc');
      }
      if (rs.contained && rs.inf < CONFIG.clearanceThreshold) {
        rs.contained = false;
        rs.cleared = true;
        rs.inf = 0;
        pushLog(state, `${r.name} is declared cleared.`, 'bloc', true);
      }
    }
  }

  // Neutral regions fall under containment once both blocs are mobilised.
  const spill = (state.blocs.red.treatment + state.blocs.blue.treatment) / 2;
  for (const r of REGIONS.filter((x) => x.bloc === 'neutral')) {
    const rs = state.regions[r.id];
    if (!rs.contained && !rs.cleared && rs.inf > 0.25 && spill > 40) {
      rs.contained = true;
      pushLog(state, `International mission imposes containment in ${r.name}.`, 'bloc');
    }
    if (rs.contained && rs.inf < CONFIG.clearanceThreshold) {
      rs.contained = false;
      rs.cleared = true;
      rs.inf = 0;
      pushLog(state, `${r.name} is declared cleared.`, 'bloc', true);
    }
  }
}

function eventContext(state) {
  return {
    ...metrics(state),
    investigation: state.investigation,
    concealing: state.blocs.red.concealing,
  };
}
function resolveEvent(state) {
  const ctx = eventContext(state);
  const event = weightedPick(state, EVENTS, (e) => e.weight(ctx));
  if (!event) return;
  state.lastEvent = event.id;
  applyEvent(state, event);
}

const METERS = new Set(['cooperation', 'tension', 'publicTrust', 'investigation']);

/** Interpret one declarative effect from the event deck. */
function applyEffect(state, effect) {
  if (effect.meter) {
    if (!METERS.has(effect.meter)) throw new Error(`unknown meter ${effect.meter}`);
    state[effect.meter] = clamp(state[effect.meter] + effect.delta, 0, 100);
    return;
  }
  if (effect.treatment !== undefined) {
    for (const b of ['red', 'blue']) {
      state.blocs[b].treatment = clamp(state.blocs[b].treatment + effect.treatment, 0, 100);
    }
    return;
  }
  if (effect.research !== undefined) {
    for (const b of ['red', 'blue']) {
      state.blocs[b].research = clamp(state.blocs[b].research + effect.research, 0, 10);
    }
    return;
  }
  if (effect.infectRandom !== undefined) {
    const live = REGIONS.filter((r) => state.regions[r.id].inf > 0.01);
    if (!live.length) return;
    const target = live[randomInt(state, live.length)];
    state.regions[target.id].inf = clamp(state.regions[target.id].inf + effect.infectRandom, 0, 1);
    state.lastEventRegion = target.name;
    return;
  }
  if (effect.seedClean) {
    const clean = REGIONS.filter((r) => state.regions[r.id].inf <= 0.001);
    if (!clean.length) return;
    const target = clean[randomInt(state, clean.length)];
    state.regions[target.id].inf = 0.02;
    state.regions[target.id].cleared = false;
    state.lastEventRegion = target.name;
    return;
  }
  if (effect.closeEdge !== undefined) {
    const open = EDGES.filter((e) => !state.closedEdges[edgeKey(e)]);
    if (!open.length) return;
    const e = open[randomInt(state, open.length)];
    state.closedEdges[edgeKey(e)] = startTimer(state, effect.closeEdge);
    state.lastEventRegion = `${REGION_BY_ID[e.a].name} ↔ ${REGION_BY_ID[e.b].name}`;
    return;
  }
  if (effect.openCorridor !== undefined) {
    state.corridorTurns = Math.max(state.corridorTurns, effect.openCorridor);
    return;
  }
  if (effect.cureMod) {
    state.cureMods.push({ ...effect.cureMod, ...startTimer(state, effect.cureMod.turns) });
    return;
  }
  if (effect.transMod) {
    state.transMods.push({ ...effect.transMod, ...startTimer(state, effect.transMod.turns) });
    return;
  }
  if (effect.drift !== undefined) {
    state.drift = Math.max(0, round1(state.drift + effect.drift));
    return;
  }
  if (effect.reveal) {
    // A leak cannot be un-leaked: concealment is over for good.
    state.blocs.red.concealing = false;
    state.blocs.red.forcedReveal = true;
    return;
  }
  if (effect.breakContainment !== undefined) {
    let left = effect.breakContainment;
    for (const r of REGIONS) {
      if (left <= 0) break;
      const rs = state.regions[r.id];
      if (rs.contained) {
        rs.contained = false;
        left -= 1;
        state.lastEventRegion = r.name;
      }
    }
  }
}

function applyEvent(state, event) {
  state.lastEventRegion = null;
  for (const effect of event.effects) applyEffect(state, effect);

  // A second seed point or a blown cover changes the shape of the run.
  const pivotal = event.effects.some((e) => e.seedClean || e.reveal);
  const where = state.lastEventRegion ? ` (${state.lastEventRegion})` : '';
  pushLog(state, `${event.name}: ${event.headline}${where}`, 'event', pivotal);
  state.headline = { turn: state.turn, name: event.name, text: event.headline };
}
function resolveSummit(state) {
  if (state.turn % CONFIG.summitEvery !== 0) return;
  if (state.sabotageArmed) {
    state.sabotageArmed = false;
    state.tension = clamp(state.tension + 6, 0, 100);
    pushLog(state, 'The summit collapses in recrimination. Your work.', 'political', true);
    return;
  }
  state.cooperation = clamp(state.cooperation + CONFIG.summitCooperation, 0, 100);
  pushLog(
    state,
    `Emergency summit convenes: cooperation +${CONFIG.summitCooperation}.`,
    'political',
    true,
  );
}

function resolvePolitics(state) {
  const m = metrics(state);

  const coopTarget =
    18 + 55 * m.globalInfection + (state.investigationResolved ? 25 : 0) - state.tension * 0.25;
  state.cooperation = clamp(
    state.cooperation + clamp(coopTarget - state.cooperation, -6, 5),
    0,
    100,
  );

  state.tension = clamp(state.tension + clamp(40 - state.tension, -2, 2), 0, 100);

  const trustTarget = 60 - 40 * m.globalInfection;
  state.publicTrust = clamp(
    state.publicTrust + clamp(trustTarget - state.publicTrust, -3, 3),
    0,
    100,
  );

  if (!state.investigationResolved) {
    // Each bribe slows the enquiry's steady advance for the rest of the run.
    const bribeSlowdown = Math.max(0.3, 1 - 0.3 * (state.purchases.bribe || 0));
    state.investigation = clamp(
      state.investigation + (CONFIG.investigationPerTurn + m.globalInfection * 2) * bribeSlowdown,
      0,
      100,
    );
    if (state.investigation >= CONFIG.investigationResolved) {
      state.investigationResolved = true;
      state.cooperation = clamp(state.cooperation + 25, 0, 100);
      state.cureMultiplier *= 1.5;
      pushLog(
        state,
        'ATTRIBUTION: investigators conclude the outbreak was natural. Blame evaporates, the blocs close ranks and the cure effort accelerates permanently.',
        'political',
        true,
      );
    }
  }
}

function resolveCure(state) {
  const research = sharedResearch(state);
  const eventMult = state.cureMods.reduce(
    (acc, mod) => (timerActive(state, mod) ? acc * mod.mult : acc),
    1,
  );
  const rate =
    (0.4 + 0.22 * research) *
    (0.55 + state.cooperation / 110) *
    eventMult *
    state.cureMultiplier *
    (state.cascadeActive ? 1.15 : 1);

  state.cureRateLast = round1(rate);
  const before = state.cure;
  state.cure = clamp(state.cure + rate, 0, 100);

  for (const milestone of [25, 50, 75, 90]) {
    if (before < milestone && state.cure >= milestone) {
      pushLog(state, `Cure research passes ${milestone}%.`, 'bloc', milestone >= 50);
    }
  }
}

function resolveTraps(state) {
  for (const trapId of Object.keys(state.traps)) {
    const trap = state.traps[trapId];
    const triggered = trapTriggered(state, trapId);
    if (!triggered) continue;

    if (trap.status === 'armed') {
      trap.status = 'triggered';
      trap.firedTurn = state.turn;
      if (trapId === 'backfire') {
        state.backfire = startTimer(state, 3);
        state.investigation = clamp(state.investigation + 12, 0, 100);
        pushLog(
          state,
          'BACKFIRE RESPONSE FIRES: every treated case now accelerates the outbreak for 3 turns. Autopsy data will expose the mechanism.',
          'trap',
          true,
        );
      } else if (trapId === 'decoy') {
        state.cure = clamp(state.cure - 10, 0, 100);
        state.cureMods.push({ ...startTimer(state, 3), mult: 0.55 });
        state.publicTrust = clamp(state.publicTrust - 20, 0, 100);
        pushLog(
          state,
          'DECOY COAT FIRES: the candidate vaccine protects against the wrong coat. Cure progress collapses and public trust goes with it.',
          'trap',
          true,
        );
      } else if (trapId === 'sleeper') {
        const cleared = REGIONS.find((r) => state.regions[r.id].cleared);
        state.sleeper = { regionId: cleared.id, ...startTimer(state, 3) };
        pushLog(
          state,
          `SLEEPER RESERVOIR ARMS: ${cleared.name} was declared cleared. Something is still there.`,
          'trap',
          true,
        );
      } else if (trapId === 'cascade') {
        state.cascadeActive = true;
        state.cascadeTier = Math.floor((state.cure - 50) / 10);
        pushLog(
          state,
          'CURE CASCADE FIRES: from here, every 10% of cure progress feeds the collapse — and speeds the cure.',
          'trap',
          true,
        );
      }
    } else if (trap.status === 'available') {
      trap.status = 'missed';
      pushLog(
        state,
        `${TRAP_BY_ID[trapId].name} was never armed — its trigger has now passed. That opportunity is gone.`,
        'trap',
        true,
      );
    }
  }

  // Cure Cascade keeps paying out as the cure climbs.
  if (state.cascadeActive) {
    const tier = Math.max(0, Math.floor((state.cure - 50) / 10));
    if (tier > state.cascadeTier) {
      state.lethality += tier - state.cascadeTier;
      state.cascadeTier = tier;
      pushLog(state, `Cascade deepens: lethality rises to ${round1(state.lethality)}.`, 'trap');
    }
  }
}

function resolveCollapse(state) {
  const m = metrics(state);
  const over = m.globalInfection - CONFIG.collapseFloor;
  let gain;
  if (over > 0) {
    gain = over * 7.8 * (1 + state.lethality * 0.02) * (1 - 0.4 * m.containmentShare);
    if (timerActive(state, state.backfire)) gain *= 1.45;
    if (state.cascadeActive) gain += 3 * state.cascadeTier;
  } else {
    // Below the floor the world rebuilds faster than you break it.
    gain = over * 5;
  }

  const before = state.collapse;
  state.collapse = clamp(state.collapse + gain, 0, 100);
  if (before < 75 && state.collapse >= 75) {
    pushLog(state, 'Global systems are failing faster than they can be rebuilt.', 'outcome', true);
  } else if (before > 10 && gain < 0 && Math.floor(before / 20) > Math.floor(state.collapse / 20)) {
    pushLog(
      state,
      `The world is recovering: infection is under ${Math.round(CONFIG.collapseFloor * 100)}% and collapse has fallen to ${Math.round(state.collapse)}%.`,
      'outcome',
    );
  }
}

function tickTimers(state) {
  if (state.sleeper) {
    tickTimer(state, state.sleeper);
    if (state.sleeper.turns <= 0) {
      const rs = state.regions[state.sleeper.regionId];
      const region = REGION_BY_ID[state.sleeper.regionId];
      rs.inf = Math.max(rs.inf, 0.3);
      rs.cleared = false;
      rs.contained = false;
      state.publicTrust = clamp(state.publicTrust - 10, 0, 100);
      pushLog(
        state,
        `RESERVOIR WAKES: ${region.name} was clear. It is now 30% infected again, and nobody can explain it.`,
        'trap',
        true,
      );
      state.sleeper = null;
    }
  }

  if (state.corridorTurns > 0) state.corridorTurns -= 1;

  state.transMods = state.transMods.filter((mod) => tickTimer(state, mod).turns > 0);

  if (state.backfire) {
    tickTimer(state, state.backfire);
    if (state.backfire.turns <= 0) {
      state.backfire = null;
      pushLog(state, 'The backfire window closes; treatment starts working again.', 'trap');
    }
  }
  for (const key of Object.keys(state.closedEdges)) {
    if (tickTimer(state, state.closedEdges[key]).turns <= 0) delete state.closedEdges[key];
  }
  state.cureMods = state.cureMods.filter((mod) => tickTimer(state, mod).turns > 0);
}

function endGame(state, result, title, summary) {
  state.phase = 'over';
  state.outcome = { result, title, summary, turn: state.turn, day: state.day };
  pushLog(state, `${title} — ${summary}`, 'outcome', true);
}

function checkEndConditions(state) {
  const m = metrics(state);

  if (state.collapse >= CONFIG.collapseWin) {
    endGame(
      state,
      'win',
      'Backfire complete',
      'Collapse reached 100 with no countermeasure left standing. Every rational response became your weapon.',
    );
    return true;
  }

  if (state.cure >= CONFIG.cureLoss) {
    endGame(state, 'loss', 'The cure completed', 'Joint research finished the cure before collapse.');
    return true;
  }

  if (state.cooperation >= CONFIG.cooperationLossThreshold) {
    state.cooperationStreak += 1;
    if (state.cooperationStreak >= CONFIG.cooperationLossTurns) {
      endGame(
        state,
        'loss',
        'The blocs united',
        `Cooperation held above ${CONFIG.cooperationLossThreshold} for ${CONFIG.cooperationLossTurns} turns. A unified response ended the outbreak.`,
      );
      return true;
    }
  } else {
    state.cooperationStreak = 0;
  }

  if (state.turn > 3 && m.globalInfection <= 0.0005) {
    endGame(
      state,
      'loss',
      'Burned out',
      'The outbreak killed its hosts faster than it could travel and died with them.',
    );
    return true;
  }

  return false;
}

// ---------------------------------------------------------------------------
// Briefing — what the player sees before spending
// ---------------------------------------------------------------------------

export function buildBriefing(state) {
  const m = metrics(state);
  const ctx = eventContext(state);

  const weights = EVENTS.map((e) => ({ event: e, weight: Math.max(0, e.weight(ctx)) }));
  const total = weights.reduce((s, w) => s + w.weight, 0) || 1;
  const risks = weights
    .sort((a, b) => b.weight - a.weight)
    .slice(0, 3)
    .map((w) => ({
      name: w.event.name,
      chance: Math.round((w.weight / total) * 100),
      why: w.event.why,
    }));

  const intentions = ['red', 'blue'].map((blocId) => {
    const bloc = state.blocs[blocId];
    const target = clamp(bloc.detected * 160 + state.cooperation * 0.15, 0, 100);
    let intent;
    if (target > bloc.treatment + 2) intent = 'escalating treatment';
    else if (target < bloc.treatment - 2) intent = 'winding treatment down';
    else intent = 'holding its current posture';
    const extras = [];
    if (blocId === 'red' && bloc.concealing) extras.push('concealing case data');
    if (bloc.research > 0) extras.push(`research ${round1(bloc.research)}/10`);
    return {
      id: blocId,
      name: bloc.name,
      detected: bloc.detected,
      treatment: Math.round(bloc.treatment),
      intent,
      extras,
    };
  });

  return {
    turn: state.turn,
    day: state.day,
    globalInfection: m.globalInfection,
    infectedRegions: m.infectedRegions,
    clearedRegions: m.clearedRegions,
    income: driftIncome(state),
    forecast: cureForecast(state),
    summitIn: turnsUntilSummit(state),
    risks,
    intentions,
  };
}

export function causalTimeline(state) {
  return state.log.filter((entry) => entry.pivotal);
}

export { REGION_BY_ID, NEIGHBOURS, CONFIG, REGIONS, EDGES, ACTIONS, TRAPS, EVENTS, TOTAL_POP };
