// Headless balance harness. Plays scripted strategies over many seeds and
// reports win rates and game length, so tuning is based on evidence.
//
//   node tools/playtest.js [runsPerStrategy]

import {
  armTrap,
  collectBubble,
  canArmTrap,
  canPurchase,
  createGame,
  endTurn,
  metrics,
  purchase,
  seedableRegions,
  seedPatientZero,
} from '../src/js/engine.js';

const RUNS = Number(process.argv[2] || 40);
const START = 'southAsia'; // the most populous region — a fair opening for every strategy

// A human would hoover up the Drift markers every turn; the harness should too.
const sweepBubbles = (state) => {
  for (const bubble of [...state.bubbles]) collectBubble(state, bubble.id);
};

const buy = (state, id, region = null) => {
  if (canPurchase(state, id, region).ok) return purchase(state, id, region).ok;
  return false;
};

const trySeed = (state) => {
  const options = seedableRegions(state);
  if (!options.length) return false;
  // Prefer the fattest reachable region.
  return buy(state, 'seed', options[0]);
};

const STRATEGIES = {
  'spread-heavy'(state) {
    buy(state, 'transmission');
    buy(state, 'resilience');
    buy(state, 'reach');
    trySeed(state);
  },

  'trap-heavy'(state) {
    // Arm whatever the slots allow, cheapest trigger first.
    for (const id of Object.keys(state.traps)) {
      if (canArmTrap(state, id).ok) armTrap(state, id);
    }
    buy(state, 'transmission');
  },

  balanced(state) {
    // Keep the enquiry cold, deny summits, arm traps on time, and only spend
    // the remainder on reach — a trap you cannot afford is a trap you miss.
    if (state.investigation > 60) buy(state, 'bury');
    if (state.briefing && state.briefing.summitIn === 1) buy(state, 'sabotage');
    if (canArmTrap(state, 'backfire').ok) armTrap(state, 'backfire');
    if (state.cure > 30 && canArmTrap(state, 'cascade').ok) armTrap(state, 'cascade');

    const savingForTrap = Object.keys(state.traps).some((id) => {
      const check = canArmTrap(state, id);
      return !check.ok && /Drift/.test(check.reason || '');
    });
    if (!savingForTrap) {
      buy(state, 'transmission');
      trySeed(state);
    }
  },

  'influence-only'(state) {
    buy(state, 'disinfo');
    buy(state, 'leak');
    if (state.investigation > 50) buy(state, 'bury');
  },
};

function playOne(name, seed) {
  const state = createGame(seed);
  seedPatientZero(state, START);
  let guard = 0;
  while (state.phase === 'planning' && guard++ < 200) {
    sweepBubbles(state);
    STRATEGIES[name](state);
    endTurn(state);
  }
  return {
    result: state.outcome ? state.outcome.result : 'unresolved',
    title: state.outcome ? state.outcome.title : 'ran past 200 turns',
    turns: state.turn,
    collapse: state.collapse,
    cure: state.cure,
    infection: metrics(state).globalInfection,
  };
}

const pad = (s, n) => String(s).padEnd(n);
const fmt = (n, d = 1) => n.toFixed(d);

console.log(`Backfire balance harness — ${RUNS} runs per strategy\n`);
console.log(
  `${pad('strategy', 16)}${pad('win%', 7)}${pad('avg turns', 11)}${pad('avg collapse', 14)}${pad(
    'avg cure',
    10,
  )}loss causes`,
);
console.log('-'.repeat(94));

for (const name of Object.keys(STRATEGIES)) {
  const runs = [];
  for (let i = 0; i < RUNS; i++) runs.push(playOne(name, `${name}-${i}`));

  const wins = runs.filter((r) => r.result === 'win').length;
  const causes = {};
  for (const r of runs.filter((x) => x.result !== 'win')) {
    causes[r.title] = (causes[r.title] || 0) + 1;
  }
  const avg = (key) => runs.reduce((s, r) => s + r[key], 0) / runs.length;

  console.log(
    `${pad(name, 16)}${pad(fmt((wins / runs.length) * 100, 0) + '%', 7)}${pad(
      fmt(avg('turns')),
      11,
    )}${pad(fmt(avg('collapse')), 14)}${pad(fmt(avg('cure')), 10)}${Object.entries(causes)
      .map(([k, v]) => `${k} ×${v}`)
      .join(', ')}`,
  );
}
