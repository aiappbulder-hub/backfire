// Wiring: owns the game state and the view state, routes input to the engine.

import { createGame, endTurn, purchase, armTrap, seedPatientZero } from './engine.js';
import { renderAll } from './ui.js';

const byId = (id) => document.getElementById(id);

const view = { sheet: null, selectedRegion: null };
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
  draw();
}

byId('end-turn').addEventListener('click', () => {
  if (state.phase !== 'planning') return;
  endTurn(state);
  draw();
});

for (const btn of document.querySelectorAll('.dock-btn')) {
  btn.addEventListener('click', () => openSheet(btn.dataset.sheet));
}

byId('sheet-close').addEventListener('click', () => {
  view.sheet = null;
  draw();
});

byId('end-restart').addEventListener('click', restart);

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
