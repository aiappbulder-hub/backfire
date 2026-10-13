// Wiring: owns the game state and the view state, routes input to the engine.

import {
  armTrap,
  collectBubble,
  createGame,
  endTurn,
  purchase,
  seedPatientZero,
} from './engine.js';
import { renderAll } from './ui.js';

const byId = (id) => document.getElementById(id);

const view = { sheet: null, selectedRegion: null, changedRegions: null };
let state = createGame(randomSeed());

function randomSeed() {
  return Math.random().toString(36).slice(2, 8);
}

const handlers = {
  onSelectRegion(regionId) {
    if (state.phase === 'setup') {
      seedPatientZero(state, regionId);
      view.selectedRegion = regionId;
      view.sheet = 'brief'; // first thing to read once the outbreak exists
      draw();
      return;
    }
    view.selectedRegion = view.selectedRegion === regionId ? null : regionId;
    draw();
  },
  onPurchase(actionId) {
    if (purchase(state, actionId, view.selectedRegion).ok) draw();
  },
  onArmTrap(trapId) {
    if (armTrap(state, trapId).ok) draw();
  },
  onCollectBubble(bubbleId) {
    if (collectBubble(state, bubbleId).ok) draw();
  },
};

function draw() {
  renderAll(state, view, handlers);
}

function openSheet(name) {
  view.sheet = view.sheet === name ? null : name;
  draw();
}

function restart() {
  state = createGame(randomSeed());
  view.sheet = null;
  view.selectedRegion = null;
  byId('end-screen').hidden = true;
  byId('title-screen').hidden = false;
  draw();
}

/** A compact signature of a region's visible state, to detect what changed. */
function regionSignatures(s) {
  const sig = {};
  for (const id of Object.keys(s.regions)) {
    const r = s.regions[id];
    const band = r.inf < 0.001 ? 0 : r.inf < 0.1 ? 1 : r.inf < 0.4 ? 2 : 3;
    sig[id] = `${r.contained ? 'c' : ''}${r.cleared ? 'x' : ''}${band}`;
  }
  return sig;
}

byId('end-turn').addEventListener('click', () => {
  if (state.phase !== 'planning') return;
  const before = regionSignatures(state);
  endTurn(state);
  const after = regionSignatures(state);
  const changed = new Set(Object.keys(after).filter((id) => after[id] !== before[id]));
  view.changedRegions = changed.size ? changed : null;
  draw();
  // The flash plays once on the post-turn render; later renders should not re-fire it.
  view.changedRegions = null;
});

for (const btn of document.querySelectorAll('.dock-btn')) {
  btn.addEventListener('click', () => openSheet(btn.dataset.sheet));
}

byId('sheet-close').addEventListener('click', () => {
  view.sheet = null;
  draw();
});

byId('end-restart').addEventListener('click', restart);

byId('title-begin').addEventListener('click', () => {
  byId('title-screen').hidden = true;
});

const helpScreen = byId('help-screen');
byId('help-button').addEventListener('click', () => {
  helpScreen.hidden = false;
});
byId('help-close').addEventListener('click', () => {
  helpScreen.hidden = true;
});
helpScreen.addEventListener('click', (ev) => {
  if (ev.target === helpScreen) helpScreen.hidden = true;
});

document.addEventListener('keydown', (ev) => {
  if (ev.key !== 'Escape') return;
  if (!helpScreen.hidden) helpScreen.hidden = true;
  else if (view.sheet) {
    view.sheet = null;
    draw();
  }
});

draw();
