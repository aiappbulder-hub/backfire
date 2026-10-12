// Rule tests for the Backfire engine. Run with: npm test
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  CONFIG,
  REGIONS,
  actionCost,
  armTrap,
  armedTrapCount,
  canArmTrap,
  canPurchase,
  createGame,
  cureForecast,
  endTurn,
  metrics,
  purchase,
  seedPatientZero,
  seedableRegions,
  transmission,
  trapTriggered,
} from '../src/js/engine.js';

/** A game seeded and ready for the planning phase. */
function startedGame(seed = 'test-seed') {
  const state = createGame(seed);
  seedPatientZero(state, 'tessellate');
  return state;
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

  const result = seedPatientZero(state, 'sable');
  assert.equal(result.ok, true);
  assert.equal(state.phase, 'planning');
  assert.ok(state.regions.sable.inf > 0);
  assert.ok(state.briefing, 'a briefing is available once play starts');
});

test('patient zero can only be placed once', () => {
  const state = startedGame();
  assert.equal(seedPatientZero(state, 'cascade').ok, false);
  assert.equal(state.regions.cascade.inf, 0);
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
  assert.ok(!seedable.includes('tessellate'), 'already infected');
  assert.ok(!seedable.includes('cascade'), 'not adjacent to the outbreak');

  assert.equal(canPurchase(state, 'seed', 'cascade').ok, false);
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
  assert.ok(state.backfireTurns > 0);
  const fires = state.log.filter((e) => /BACKFIRE RESPONSE FIRES/.test(e.text));
  assert.equal(fires.length, 1);

  playTurns(state, 4);
  const firesAgain = state.log.filter((e) => /BACKFIRE RESPONSE FIRES/.test(e.text));
  assert.equal(firesAgain.length, 1, 'a trap never fires twice');
});

test('only two traps can be held at once', () => {
  const state = startedGame();
  state.drift = 10000;
  armTrap(state, 'backfire');
  armTrap(state, 'cascade');
  assert.equal(armedTrapCount(state), CONFIG.maxArmedTraps);
  // With both slots used, nothing else can be armed.
  assert.equal(canArmTrap(state, 'backfire').ok, false);
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
  const open = startedGame('open');
  const hidden = startedGame('hidden');
  for (const s of [open, hidden]) {
    s.blocs.blue.research = 5;
    s.blocs.red.research = 5;
    s.cooperation = 50;
  }
  open.blocs.red.concealing = false;
  hidden.blocs.red.concealing = true;
  // Freeze the AI's own concealment decision so only the flag differs.
  for (const s of [open, hidden]) s.regions.tessellate.inf = 0.2;
  endTurn(open);
  endTurn(hidden);
  assert.ok(open.cure > hidden.cure, 'shared data produces a faster cure');
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
  assert.ok(state.regions.tessellate.inf > 0.02, 'the seed region grows');
});

test('the same seed and inputs reproduce the same run', () => {
  const run = (seed) => {
    const state = createGame(seed);
    seedPatientZero(state, 'sable');
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
