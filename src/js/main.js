// Wiring: owns the game state and the view state, routes input to the engine.

import { createGame, endTurn, purchase, armTrap, seedPatientZero } from './engine.js';
import { renderAll, renderRegionDetail } from './ui.js';

const view = { track: 'spread', selectedRegion: null };
let state = createGame(randomSeed());

function randomSeed() {
  return Math.random().toString(36).slice(2, 8);
}

const handlers = {
  onSelectRegion(regionId) {
    if (state.phase === 'setup') {
      seedPatientZero(state, regionId);
      view.selectedRegion = regionId;
      draw();
      return;
    }
    view.selectedRegion = view.selectedRegion === regionId ? null : regionId;
    draw();
  },
  onPurchase(actionId) {
    const result = purchase(state, actionId, view.selectedRegion);
    if (result.ok) draw();
  },
  onArmTrap(trapId) {
    const result = armTrap(state, trapId);
    if (result.ok) draw();
  },
};

function draw() {
  renderAll(state, view, handlers);
}

function restart() {
  state = createGame(randomSeed());
  view.track = 'spread';
  view.selectedRegion = null;
  document.getElementById('end-screen').hidden = true;
  draw();
}

document.getElementById('end-turn').addEventListener('click', () => {
  if (state.phase !== 'planning') return;
  endTurn(state);
  draw();
});

document.getElementById('restart').addEventListener('click', restart);
document.getElementById('end-restart').addEventListener('click', restart);

for (const tab of document.querySelectorAll('.tab')) {
  tab.addEventListener('click', () => {
    view.track = tab.dataset.track;
    draw();
  });
}

const helpScreen = document.getElementById('help-screen');
document.getElementById('help-button').addEventListener('click', () => {
  helpScreen.hidden = false;
});
document.getElementById('help-close').addEventListener('click', () => {
  helpScreen.hidden = true;
});
helpScreen.addEventListener('click', (ev) => {
  if (ev.target === helpScreen) helpScreen.hidden = true;
});
document.addEventListener('keydown', (ev) => {
  if (ev.key === 'Escape') helpScreen.hidden = true;
});

document.getElementById('map').addEventListener('mouseleave', () => {
  renderRegionDetail(state, view.selectedRegion);
});

draw();
