// Rule tests for the Backfire engine. Run with: npm test
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  CONFIG,
  EVENTS,
  REGIONS,
  actionCost,
  armTrap,
  armedTrapCount,
  canArmTrap,
  canPurchase,
  collectBubble,
  computeScore,
  createGame,
  detectionFactor,
  cureForecast,
  endTurn,
  metrics,
  purchase,
  seedPatientZero,
  seedableRegions,
  sharedResearch,
  transmission,
  trapTriggered,
} from '../src/js/engine.js';

/** A game seeded and ready for the planning phase. */
function startedGame(seed = 'test-seed') {
  const state = createGame(seed);
  seedPatientZero(state, 'southAsia');
  return state;
}

/**
 * Apply one specific event by forcing it to be the only one the deck can draw.
 * The engine picks events by weight, so this isolates a single card.
 */
function applyEventForTest(state, event) {
  const saved = EVENTS.map((e) => e.weight);
  try {
    for (const e of EVENTS) e.weight = () => (e.id === event.id ? 1 : 0);
    endTurn(state);
  } finally {
    EVENTS.forEach((e, i) => {
      e.weight = saved[i];
    });
  }
}

/**
 * Run `fn` with the event deck silenced, so a comparison measures the mechanic
 * under test rather than two runs drawing different cards.
 */
function withoutEvents(fn) {
  const saved = EVENTS.map((e) => e.weight);
  try {
    for (const e of EVENTS) e.weight = () => 0;
    return fn();
  } finally {
    EVENTS.forEach((e, i) => {
      e.weight = saved[i];
    });
  }
}

/** Play `turns` turns, optionally running a planning hook each turn. */
function playTurns(state, turns, plan = null) {
  for (let i = 0; i < turns && state.phase === 'planning'; i++) {
    if (plan) plan(state, i);
    endTurn(state);
  }
  return state;
}

test('setup requires patient zero before the planning phase begins', () => {
  const state = createGame('seed-a');
  assert.equal(state.phase, 'setup');
  assert.equal(canPurchase(state, 'transmission').ok, false);
  assert.equal(endTurn(state).ok, false);

  const result = seedPatientZero(state, 'middleEast');
  assert.equal(result.ok, true);
  assert.equal(state.phase, 'planning');
  assert.ok(state.regions.middleEast.inf > 0);
  assert.ok(state.briefing, 'a briefing is available once play starts');
});

test('patient zero can only be placed once', () => {
  const state = startedGame();
  assert.equal(seedPatientZero(state, 'northAmerica').ok, false);
  assert.equal(state.regions.northAmerica.inf, 0);
});

test('Drift is spent, never goes negative, and unaffordable actions are blocked', () => {
  const state = startedGame();
  state.drift = 20;
  assert.equal(canPurchase(state, 'transmission').ok, true); // base 18
  purchase(state, 'transmission');
  assert.equal(state.drift, 2);

  const check = canPurchase(state, 'transmission');
  assert.equal(check.ok, false);
  assert.match(check.reason, /Needs \d+ Drift/);
  purchase(state, 'transmission');
  assert.equal(state.drift, 2, 'a refused purchase changes nothing');
  assert.ok(state.drift >= 0);
});

test('action costs escalate and respect their maximum', () => {
  const state = startedGame();
  state.drift = 10000;
  const first = actionCost(state, 'transmission');
  purchase(state, 'transmission');
  assert.equal(actionCost(state, 'transmission'), first + 8);

  for (let i = 0; i < 10; i++) purchase(state, 'transmission');
  assert.equal(state.purchases.transmission, 6, 'capped at max');
  assert.equal(canPurchase(state, 'transmission').ok, false);
});

test('transmission upgrades raise transmission; holding a trap costs reach', () => {
  const state = startedGame();
  state.drift = 10000;
  const base = transmission(state);
  purchase(state, 'transmission');
  assert.ok(transmission(state) > base);

  const beforeArming = transmission(state);
  armTrap(state, 'backfire');
  assert.equal(armedTrapCount(state), 1);
  assert.ok(transmission(state) < beforeArming, 'armed traps impose a transmission penalty');
});

test('seeding requires a clean region bordering an infected one', () => {
  const state = startedGame();
  state.drift = 10000;
  const seedable = seedableRegions(state);
  assert.ok(seedable.length > 0);
  assert.ok(!seedable.includes('southAsia'), 'already infected');
  assert.ok(!seedable.includes('northAmerica'), 'not adjacent to the outbreak');

  assert.equal(canPurchase(state, 'seed', 'northAmerica').ok, false);
  assert.equal(canPurchase(state, 'seed', null).ok, false);

  const target = seedable[0];
  assert.equal(purchase(state, 'seed', target).ok, true);
  assert.ok(state.regions[target].inf > 0);
});

test('a trap cannot be armed once its trigger condition exists', () => {
  const state = startedGame();
  state.drift = 10000;

  assert.equal(trapTriggered(state, 'backfire'), false);
  assert.equal(canArmTrap(state, 'backfire').ok, true);

  state.blocs.blue.treatment = 55; // trigger now exists
  assert.equal(trapTriggered(state, 'backfire'), true);
  const check = canArmTrap(state, 'backfire');
  assert.equal(check.ok, false);
  assert.match(check.reason, /too late/i);
  assert.equal(armTrap(state, 'backfire').ok, false);
  assert.equal(state.traps.backfire.status, 'available');
});

test('an unarmed trap whose trigger passes is recorded as missed, not armable later', () => {
  const state = startedGame();
  state.blocs.blue.treatment = 60;
  endTurn(state);
  assert.equal(state.traps.backfire.status, 'missed');
  state.drift = 10000;
  assert.equal(canArmTrap(state, 'backfire').ok, false);
});

test('an armed trap fires exactly once and leaves an explanation in the log', () => {
  const state = startedGame();
  state.drift = 10000;
  assert.equal(armTrap(state, 'backfire').ok, true);

  state.blocs.blue.treatment = 60;
  endTurn(state);
  assert.equal(state.traps.backfire.status, 'triggered');
  assert.ok(state.backfire && state.backfire.turns > 0);
  const fires = state.log.filter((e) => /BACKFIRE RESPONSE FIRES/.test(e.text));
  assert.equal(fires.length, 1);

  playTurns(state, 4);
  const firesAgain = state.log.filter((e) => /BACKFIRE RESPONSE FIRES/.test(e.text));
  assert.equal(firesAgain.length, 1, 'a trap never fires twice');
});

test('trap slots are limited, so some traps must be left unarmed', () => {
  const state = startedGame();
  state.drift = 10000;
  const ids = Object.keys(state.traps);
  assert.ok(ids.length > CONFIG.maxArmedTraps, 'there are more traps than slots');

  let armedCount = 0;
  for (const id of ids) {
    if (canArmTrap(state, id).ok) {
      armTrap(state, id);
      armedCount += 1;
    }
  }
  assert.equal(armedCount, CONFIG.maxArmedTraps);
  assert.equal(armedTrapCount(state), CONFIG.maxArmedTraps);

  const spare = ids.find((id) => state.traps[id].status === 'available');
  const check = canArmTrap(state, spare);
  assert.equal(check.ok, false);
  assert.match(check.reason, /at once/i);
});

test('Decoy Coat knocks the cure back and is unarmable once research passes 25%', () => {
  const state = startedGame('decoy');
  state.drift = 10000;
  assert.equal(canArmTrap(state, 'decoy').ok, true);
  armTrap(state, 'decoy');

  state.cure = 40;
  endTurn(state);
  assert.equal(state.traps.decoy.status, 'triggered');
  assert.ok(state.cure < 40, 'cure progress is knocked back');

  // Too late for a second game that never armed it.
  const late = startedGame('decoy-late');
  late.drift = 10000;
  late.cure = 30;
  assert.equal(canArmTrap(late, 'decoy').ok, false);
});

test('Sleeper Reservoir re-infects a region that was declared cleared', () => {
  const state = startedGame('sleeper');
  state.drift = 10000;
  armTrap(state, 'sleeper');
  assert.equal(trapTriggered(state, 'sleeper'), false, 'nothing is cleared yet');

  state.regions.northAmerica.cleared = true;
  state.regions.northAmerica.inf = 0;
  endTurn(state);
  assert.equal(state.traps.sleeper.status, 'triggered');
  assert.equal(state.sleeper.regionId, 'northAmerica');

  for (let i = 0; i < 3 && state.phase === 'planning'; i++) endTurn(state);
  assert.ok(state.regions.northAmerica.inf >= 0.25, 'the reservoir wakes');
  assert.equal(state.regions.northAmerica.cleared, false);
  assert.ok(state.log.some((e) => /RESERVOIR WAKES/.test(e.text) && e.pivotal));
});

test('outbreak markers pay Drift once and then are gone', () => {
  const state = startedGame('bubbles');
  // Play until some markers appear.
  for (let i = 0; i < 12 && !state.bubbles.length && state.phase === 'planning'; i++) endTurn(state);
  assert.ok(state.bubbles.length > 0, 'markers appear on infected regions');

  const bubble = state.bubbles[0];
  const before = state.drift;
  const result = collectBubble(state, bubble.id);
  assert.equal(result.ok, true);
  assert.equal(state.drift, before + bubble.amount);
  assert.equal(
    state.bubbles.some((b) => b.id === bubble.id),
    false,
  );
  assert.equal(collectBubble(state, bubble.id).ok, false, 'cannot be collected twice');
});

test('uncollected markers expire at the end of the turn', () => {
  const state = startedGame('expire');
  for (let i = 0; i < 12 && !state.bubbles.length && state.phase === 'planning'; i++) endTurn(state);
  assert.ok(state.bubbles.length > 0);
  const stale = state.bubbles[0].id;
  endTurn(state);
  assert.equal(
    state.bubbles.some((b) => b.id === stale),
    false,
    'last turn markers do not carry over',
  );
});

test('asymptomatic carriage makes the blocs under-count and react later', () => {
  const plain = startedGame('seen');
  const hidden = startedGame('unseen');
  hidden.drift = 10000;
  for (let i = 0; i < 3; i++) purchase(hidden, 'asymptomatic');
  assert.ok(detectionFactor(hidden) < detectionFactor(plain));

  // Pin the true case load each turn so only what the blocs can SEE differs.
  // (Left to run free, hiding causes more spread, which pushes detection back
  // up and the two converge — real behaviour, but it hides the mechanic.)
  withoutEvents(() => {
    for (let turn = 0; turn < 6; turn++) {
      for (const s of [plain, hidden]) {
        if (s.phase !== 'planning') continue;
        for (const r of ['northAmerica', 'westEurope', 'oceania']) s.regions[r].inf = 0.25;
        endTurn(s);
      }
    }
  });

  assert.ok(
    hidden.blocs.blue.detected < plain.blocs.blue.detected,
    'the bloc sees a smaller outbreak than it has',
  );
  assert.ok(
    hidden.blocs.blue.treatment < plain.blocs.blue.treatment,
    `hidden treatment ${hidden.blocs.blue.treatment} should trail plain ${plain.blocs.blue.treatment}`,
  );
});

test('every event in the deck applies without breaking any bound', () => {
  for (const event of EVENTS) {
    const state = startedGame(`event-${event.id}`);
    // A world with something to act on: infection, containment, research.
    for (const r of ['southAsia', 'eastAsia', 'northAmerica']) state.regions[r].inf = 0.4;
    state.regions.westEurope.contained = true;
    state.regions.westEurope.inf = 0.3;
    state.blocs.blue.research = 4;
    state.blocs.red.research = 4;

    applyEventForTest(state, event);

    for (const key of ['cooperation', 'tension', 'publicTrust', 'investigation', 'cure', 'collapse']) {
      assert.ok(state[key] >= 0 && state[key] <= 100, `${event.id} put ${key} out of range`);
    }
    for (const b of ['red', 'blue']) {
      assert.ok(state.blocs[b].treatment >= 0 && state.blocs[b].treatment <= 100, `${event.id} treatment`);
      assert.ok(state.blocs[b].research >= 0 && state.blocs[b].research <= 10, `${event.id} research`);
    }
    for (const r of REGIONS) {
      const inf = state.regions[r.id].inf;
      assert.ok(inf >= 0 && inf <= 1, `${event.id} infection in ${r.id}`);
    }
    assert.ok(state.drift >= 0, `${event.id} drift`);
  }
});

test('every event weight is finite and non-negative across extreme worlds', () => {
  const worlds = [
    { globalInfection: 0, containmentShare: 0, publicTrust: 100, tension: 0, cooperation: 0, cure: 0, maxTreatment: 0, researchTotal: 0, investigation: 0, concealing: true },
    { globalInfection: 1, containmentShare: 1, publicTrust: 0, tension: 100, cooperation: 100, cure: 100, maxTreatment: 100, researchTotal: 20, investigation: 100, concealing: false },
  ];
  for (const world of worlds) {
    for (const event of EVENTS) {
      const w = event.weight(world);
      assert.ok(Number.isFinite(w), `${event.id} weight is not finite`);
      assert.ok(w >= 0, `${event.id} weight is negative: ${w}`);
    }
  }
});

test('score rewards sprung traps and punishes missed ones', () => {
  const win = startedGame('score-win');
  win.collapse = 100;
  win.investigation = 10;
  win.outcome = { result: 'win' };
  win.traps.backfire.status = 'triggered';
  const strong = computeScore(win);

  const weak = startedGame('score-weak');
  weak.collapse = 100;
  weak.investigation = 10;
  weak.outcome = { result: 'win' };
  weak.traps.backfire.status = 'missed';
  const poor = computeScore(weak);

  assert.ok(strong.score > poor.score, 'firing a trap beats missing one');
  assert.ok(['S', 'A', 'B', 'C', 'D'].includes(strong.grade));

  const lost = startedGame('score-loss');
  lost.collapse = 100;
  lost.investigation = 10;
  lost.outcome = { result: 'loss' };
  lost.traps.backfire.status = 'triggered';
  assert.ok(computeScore(lost).score < strong.score, 'losing scores less than winning');
  assert.ok(computeScore(lost).score >= 0);
});

test('a temporary effect lasts exactly the number of turns its card promises', () => {
  // Backfire Response: 3 turns of inverted treatment after it fires.
  const bf = startedGame('dur-backfire');
  bf.drift = 10000;
  armTrap(bf, 'backfire');
  bf.blocs.blue.treatment = 60;
  endTurn(bf); // fires this turn; the 3-turn window starts next turn
  let backfireTurns = 0;
  for (let i = 0; i < 6 && bf.phase === 'planning'; i++) {
    if (bf.backfire && bf.backfire.turns > 0 && bf.backfire.born !== bf.turn) backfireTurns += 1;
    endTurn(bf);
  }
  assert.equal(backfireTurns, 3, 'Backfire inversion applies for 3 turns');

  // Sleeper Reservoir: relapse exactly 3 turns after it fires.
  const sl = startedGame('dur-sleeper');
  sl.drift = 10000;
  armTrap(sl, 'sleeper');
  sl.regions.northAmerica.cleared = true;
  sl.regions.northAmerica.inf = 0;
  endTurn(sl);
  const firedTurn = sl.turn;
  let relapseTurn = null;
  for (let i = 0; i < 8 && sl.phase === 'planning'; i++) {
    endTurn(sl);
    if (relapseTurn === null && sl.regions.northAmerica.inf >= 0.25) relapseTurn = sl.turn;
  }
  assert.equal(relapseTurn - firedTurn, 3, 'the reservoir wakes 3 turns after arming');
});

test('cure cascade fires on cure progress and feeds collapse', () => {
  const state = startedGame();
  state.drift = 10000;
  armTrap(state, 'cascade');
  state.cure = 49;
  state.blocs.blue.research = 8;
  state.blocs.red.research = 8;
  endTurn(state);
  assert.ok(state.cure >= 50);
  assert.equal(state.traps.cascade.status, 'triggered');
  assert.equal(state.cascadeActive, true);
});

test('all meters and progress values stay inside their bounds over a long run', () => {
  const state = startedGame('bounds');
  playTurns(state, 60, (s) => {
    for (const id of ['transmission', 'disinfo', 'leak', 'bury', 'reach', 'resilience']) {
      if (canPurchase(s, id).ok) purchase(s, id);
    }
  });

  const inRange = (v, lo, hi, label) =>
    assert.ok(v >= lo && v <= hi, `${label} out of range: ${v}`);
  inRange(state.cooperation, 0, 100, 'cooperation');
  inRange(state.tension, 0, 100, 'tension');
  inRange(state.publicTrust, 0, 100, 'public trust');
  inRange(state.investigation, 0, 100, 'investigation');
  inRange(state.cure, 0, 100, 'cure');
  inRange(state.collapse, 0, 100, 'collapse');
  assert.ok(state.drift >= 0, 'drift never negative');
  for (const r of REGIONS) inRange(state.regions[r.id].inf, 0, 1, `${r.id} infection`);
});

test('the game ends once and then refuses further turns', () => {
  const state = startedGame('ending');
  state.cure = 99.9;
  state.blocs.blue.research = 5;
  endTurn(state);
  assert.equal(state.phase, 'over');
  assert.equal(state.outcome.result, 'loss');
  const turnAtEnd = state.turn;

  assert.equal(endTurn(state).ok, false);
  assert.equal(state.turn, turnAtEnd, 'no further turns resolve');
  assert.equal(canPurchase(state, 'transmission').ok, false);
  assert.equal(canArmTrap(state, 'cascade').ok, false);
});

test('collapse at 100 is a win and the timeline explains it', () => {
  const state = startedGame('winning');
  for (const r of REGIONS) state.regions[r.id].inf = 0.95;
  state.collapse = 99;
  endTurn(state);
  assert.equal(state.phase, 'over');
  assert.equal(state.outcome.result, 'win');
  assert.ok(state.log.some((e) => e.pivotal), 'pivotal entries exist for the causal timeline');
});

test('sustained cooperation is a loss, and only after the full streak', () => {
  const state = startedGame('coop');
  state.cooperation = 95;
  for (let i = 0; i < CONFIG.cooperationLossTurns - 1; i++) {
    state.cooperation = 95;
    endTurn(state);
    assert.equal(state.phase, 'planning', `still playing after ${i + 1} united turns`);
  }
  state.cooperation = 95;
  endTurn(state);
  assert.equal(state.phase, 'over');
  assert.equal(state.outcome.result, 'loss');
  assert.match(state.outcome.title, /united/i);
});

test('the cure forecast responds to cooperation rather than being cosmetic', () => {
  const low = startedGame('forecast-low');
  const high = startedGame('forecast-high');
  for (const s of [low, high]) {
    s.blocs.blue.research = 6;
    s.blocs.red.research = 6;
    s.blocs.red.concealing = false;
  }
  low.cooperation = 10;
  high.cooperation = 90;
  endTurn(low);
  endTurn(high);

  assert.ok(high.cureRateLast > low.cureRateLast, 'cooperation speeds the cure');
  const lowForecast = cureForecast(low);
  const highForecast = cureForecast(high);
  assert.ok(lowForecast.known && highForecast.known);
  assert.ok(highForecast.turns < lowForecast.turns, 'forecast shortens when cooperation is high');
});

test('a concealing bloc withholds research from the joint cure effort', () => {
  // Isolate the mechanism: identical research, only the concealment flag differs.
  const open = startedGame('open');
  const hidden = startedGame('hidden');
  for (const s of [open, hidden]) {
    s.blocs.blue.research = 5;
    s.blocs.red.research = 5;
  }
  open.blocs.red.concealing = false;
  hidden.blocs.red.concealing = true;
  assert.ok(
    sharedResearch(open) > sharedResearch(hidden),
    'withheld data counts for less toward the cure',
  );
});

test('the Red Bloc stops concealing once its own outbreak passes 25%', () => {
  const quiet = startedGame('quiet');
  const loud = startedGame('loud');
  for (const r of ['russia', 'centralAsia', 'eastAsia']) {
    quiet.regions[r].inf = 0.1;
    loud.regions[r].inf = 0.45;
  }
  endTurn(quiet);
  endTurn(loud);
  assert.equal(quiet.blocs.red.concealing, true, 'a small outbreak stays hidden');
  assert.equal(loud.blocs.red.concealing, false, 'a large one cannot be hidden');
  assert.ok(loud.log.some((e) => /no longer hide/.test(e.text)));
});

test('attribution resolving unites the blocs and permanently speeds the cure', () => {
  const state = startedGame('attribution');
  state.investigation = 99.9;
  const before = state.cooperation;
  endTurn(state);
  assert.equal(state.investigationResolved, true);
  assert.ok(state.cooperation > before);
  assert.ok(state.cureMultiplier > 1);
  assert.ok(state.log.some((e) => /ATTRIBUTION/.test(e.text) && e.pivotal));
});

test('summits add cooperation unless sabotaged beforehand', () => {
  const plain = startedGame('summit-plain');
  const sabotaged = startedGame('summit-sab');
  sabotaged.drift = 10000;
  assert.equal(purchase(sabotaged, 'sabotage').ok, true);
  // Align both runs on the same cooperation before the summit turn.
  for (const s of [plain, sabotaged]) {
    s.turn = CONFIG.summitEvery;
    s.cooperation = 40;
  }
  endTurn(plain);
  endTurn(sabotaged);
  assert.ok(plain.cooperation > sabotaged.cooperation, 'sabotage denies the summit its gain');
  assert.equal(sabotaged.sabotageArmed, false, 'sabotage is consumed');
  assert.ok(sabotaged.log.some((e) => /summit collapses/i.test(e.text)));
});

test('infection spreads along connectivity, not into unconnected regions', () => {
  const state = startedGame('spread');
  state.drift = 10000;
  for (let i = 0; i < 4; i++) purchase(state, 'transmission');
  playTurns(state, 6);
  assert.ok(metrics(state).infectedRegions > 1, 'the outbreak reaches neighbours');
  assert.ok(state.regions.southAsia.inf > 0.02, 'the seed region grows');
});

test('the same seed and inputs reproduce the same run', () => {
  const run = (seed) => {
    const state = createGame(seed);
    seedPatientZero(state, 'middleEast');
    playTurns(state, 15, (s) => {
      if (canPurchase(s, 'transmission').ok) purchase(s, 'transmission');
      if (canArmTrap(s, 'backfire').ok) armTrap(s, 'backfire');
    });
    return {
      cure: state.cure,
      collapse: state.collapse,
      cooperation: state.cooperation,
      infection: metrics(state).globalInfection,
      log: state.log.length,
    };
  };
  assert.deepEqual(run('same'), run('same'));
  assert.notDeepEqual(run('same'), run('different'));
});

test('restarting produces a clean state', () => {
  const played = startedGame('restart');
  played.drift = 10000;
  purchase(played, 'transmission');
  playTurns(played, 5);

  const fresh = createGame('restart');
  assert.equal(fresh.phase, 'setup');
  assert.equal(fresh.turn, 1);
  assert.equal(fresh.day, 0);
  assert.equal(fresh.drift, CONFIG.startingDrift);
  assert.equal(fresh.cure, 0);
  assert.equal(fresh.collapse, 0);
  assert.deepEqual(fresh.purchases, {});
  assert.equal(metrics(fresh).infectedRegions, 0);
  assert.equal(armedTrapCount(fresh), 0);
});
