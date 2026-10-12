// Rendering only. Reads game state, writes DOM. No game rules live here.

import {
  ACTIONS,
  CONFIG,
  EDGES,
  REGIONS,
  REGION_BY_ID,
  TRAPS,
  actionCost,
  armedTrapCount,
  canArmTrap,
  canPurchase,
  causalTimeline,
  cureForecast,
  driftIncome,
  metrics,
  seedableRegions,
  transmission,
  trapTriggered,
  turnsUntilSummit,
  visibleInfection,
} from './engine.js';
import { LANDMASSES, VIEWBOX, project, ringToPath } from './worldgeo.js';

const $ = (id) => document.getElementById(id);
const pct = (v) => `${Math.round(v * 100)}%`;
const SVG_NS = 'http://www.w3.org/2000/svg';

const BLOC_LABEL = { red: 'Red Bloc', blue: 'Blue Bloc', neutral: 'Neutral' };
// Base landmass colours, before infection is painted over them.
const BLOC_FILL = { red: '#3a2026', blue: '#1b2a3f', neutral: '#242a33' };
const BLOC_EDGE = { red: '#e0453c', blue: '#3d8ae0', neutral: '#6d7988' };

function el(tag, attrs = {}, text = null) {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  if (text !== null) node.textContent = text;
  return node;
}

/** Status word + glyph, so state never depends on colour alone. */
function regionStatus(state, regionId) {
  const rs = state.regions[regionId];
  const seen = visibleInfection(state, regionId);
  if (rs.cleared) return { glyph: '✓', word: 'cleared' };
  if (rs.contained) return { glyph: '▣', word: 'contained' };
  if (seen.value > 0.001) return { glyph: seen.unverified ? '≈' : '◉', word: 'infected' };
  return { glyph: '', word: 'clean' };
}

// ---------------------------------------------------------------------------
// Map
// ---------------------------------------------------------------------------

export function renderMap(state, view, handlers) {
  const svg = $('map');
  svg.setAttribute('viewBox', VIEWBOX);
  svg.textContent = '';

  const canSeedNow =
    state.phase === 'setup' ||
    (state.phase === 'planning' && view.track === 'spread' && state.drift >= actionCost(state, 'seed'));
  const seedable = state.phase === 'setup' ? REGIONS.map((r) => r.id) : seedableRegions(state);

  // Ocean and graticule.
  svg.appendChild(el('rect', { x: 0, y: 0, width: 1000, height: 500, fill: '#0b1119' }));
  const grid = el('g', { class: 'graticule' });
  for (let lon = -150; lon <= 150; lon += 30) {
    const [x] = project([lon, 0]);
    grid.appendChild(el('line', { x1: x, y1: 30, x2: x, y2: 410 }));
  }
  for (let lat = -30; lat <= 60; lat += 30) {
    const [, y] = project([0, lat]);
    grid.appendChild(el('line', { x1: 0, y1: y, x2: 1000, y2: y }));
  }
  svg.appendChild(grid);

  // Routes, drawn under the labels so the map stays readable.
  const routes = el('g', { class: 'routes' });
  for (const e of EDGES) {
    const [x1, y1] = project(LANDMASSES[e.a].label);
    const [x2, y2] = project(LANDMASSES[e.b].label);
    const closed = (state.closedEdges[`${e.a}|${e.b}`] || 0) > 0;
    const hot = state.regions[e.a].inf > 0.05 && state.regions[e.b].inf > 0.05;
    const classes = ['route'];
    if (e.cross) classes.push('is-cross');
    if (closed) classes.push('is-closed');
    else if (hot) classes.push('is-hot');
    routes.appendChild(el('line', { x1, y1, x2, y2, class: classes.join(' ') }));
  }
  svg.appendChild(routes);

  // Landmasses.
  for (const region of REGIONS) {
    const rs = state.regions[region.id];
    const seen = visibleInfection(state, region.id);
    const status = regionStatus(state, region.id);
    const geo = LANDMASSES[region.id];

    const classes = ['region'];
    if (rs.contained) classes.push('is-contained');
    if (rs.cleared) classes.push('is-cleared');
    if (view.selectedRegion === region.id) classes.push('is-selected');
    if (canSeedNow && seedable.includes(region.id)) classes.push('is-seedable');

    const group = el('g', {
      class: classes.join(' '),
      tabindex: '0',
      role: 'button',
      'aria-label': `${region.name}, ${BLOC_LABEL[region.bloc]}, ${status.word}, ${pct(seen.value)} infected`,
    });

    for (const ring of geo.shapes) {
      const d = ringToPath(ring);
      group.appendChild(
        el('path', { d, class: 'land', fill: BLOC_FILL[region.bloc], stroke: BLOC_EDGE[region.bloc] }),
      );
      if (seen.value > 0.001) {
        group.appendChild(
          el('path', {
            d,
            class: 'infection',
            fill: rs.contained ? '#c8821f' : '#d8352b',
            'fill-opacity': (0.2 + 0.8 * Math.min(1, seen.value)).toFixed(2),
            stroke: 'none',
          }),
        );
      }
    }

    const [lx, ly] = project(geo.label);
    const label = el('text', { x: lx, y: ly, class: 'region-label' }, region.short);
    group.appendChild(label);
    if (seen.value > 0.001 || rs.cleared) {
      group.appendChild(
        el(
          'text',
          { x: lx, y: ly + 15, class: 'region-figure' },
          rs.cleared ? '✓ cleared' : `${status.glyph} ${pct(seen.value)}`,
        ),
      );
    }
    // A generous invisible target over the label, so tapping a region's name
    // selects it — thin coastlines are awkward to hit, especially on a phone.
    group.appendChild(
      el('circle', {
        cx: lx,
        cy: ly - 4,
        r: 30,
        class: 'hit',
        fill: '#000',
        'fill-opacity': '0',
        'pointer-events': 'all',
      }),
    );

    group.appendChild(
      el('title', {}, `${region.name} — ${BLOC_LABEL[region.bloc]} — ${status.word} — ${pct(seen.value)}`),
    );

    group.addEventListener('click', () => handlers.onSelectRegion(region.id));
    group.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter' || ev.key === ' ') {
        ev.preventDefault();
        handlers.onSelectRegion(region.id);
      }
    });
    group.addEventListener('mouseenter', () => renderRegionDetail(state, region.id));
    group.addEventListener('focus', () => renderRegionDetail(state, region.id));

    svg.appendChild(group);
  }

  const m = metrics(state);
  $('map-status').textContent =
    state.phase === 'setup'
      ? 'Choose where it starts.'
      : `${m.infectedRegions}/12 regions · ${pct(m.globalInfection)} infected`;
}

export function renderRegionDetail(state, regionId) {
  const box = $('region-detail');
  if (!regionId) {
    box.innerHTML = '<p class="muted">Hover or tap a region.</p>';
    return;
  }
  const region = REGION_BY_ID[regionId];
  const seen = visibleInfection(state, regionId);
  const status = regionStatus(state, regionId);

  box.innerHTML = '';
  const h = document.createElement('h3');
  h.textContent = region.name;
  const sub = document.createElement('p');
  sub.className = 'detail-sub';
  const bits = [BLOC_LABEL[region.bloc], `${region.pop}M`, `${status.glyph} ${status.word}`.trim()];
  if (seen.unverified) bits.push('unverified');
  if (region.harsh) bits.push('harsh climate');
  sub.textContent = bits.join(' · ');

  const figure = document.createElement('p');
  figure.className = 'detail-figure';
  figure.textContent = pct(seen.value);

  box.append(h, sub, figure);
  if (region.bloc !== 'neutral') {
    const treat = document.createElement('p');
    treat.className = 'detail-sub';
    treat.textContent = `Treatment ${Math.round(state.blocs[region.bloc].treatment)}`;
    box.appendChild(treat);
  }
}

// ---------------------------------------------------------------------------
// Status bars and meters
// ---------------------------------------------------------------------------

export function renderStatus(state) {
  $('clock-turn').textContent = `Turn ${state.turn}`;
  $('clock-day').textContent = `Day ${state.day}`;
  $('drift-value').textContent = Math.floor(state.drift);
  $('drift-income').textContent = `+${driftIncome(state)}`;
  $('seed-value').textContent = state.seed;

  $('collapse-value').textContent = `${Math.round(state.collapse)}%`;
  $('collapse-bar').style.width = `${state.collapse}%`;
  $('cure-value').textContent = `${Math.round(state.cure)}%`;
  $('cure-bar').style.width = `${state.cure}%`;

  const forecast = cureForecast(state);
  $('cure-forecast').textContent = forecast.known
    ? `~${forecast.turns} turns left`
    : 'not started';

  const meters = [
    ['coop', state.cooperation, state.cooperation >= CONFIG.cooperationLossThreshold],
    ['tension', state.tension, false],
    ['trust', state.publicTrust, false],
    ['invest', state.investigation, state.investigation >= 70],
  ];
  for (const [key, value, danger] of meters) {
    $(`${key}-bar`).style.width = `${value}%`;
    $(`${key}-value`).textContent = Math.round(value);
    $(`${key}-bar`).closest('.meter').classList.toggle('is-danger', danger);
  }

  $('coop-note').textContent =
    state.cooperationStreak > 0
      ? `united ${state.cooperationStreak}/${CONFIG.cooperationLossTurns}`
      : `lose at ${CONFIG.cooperationLossThreshold}`;
  $('invest-note').textContent = state.investigationResolved ? 'ruled natural' : 'blocs unite at 100';
  $('summit-value').textContent = turnsUntilSummit(state);
  document.querySelector('[data-meter="summit"] .meter-note').textContent = state.sabotageArmed
    ? 'sabotaged'
    : 'turns away';
}

// ---------------------------------------------------------------------------
// Briefing
// ---------------------------------------------------------------------------

export function renderBriefing(state) {
  const host = $('briefing');
  host.innerHTML = '';
  const brief = state.briefing;
  if (!brief) {
    host.innerHTML = '<p class="muted">Choose a starting region.</p>';
    return;
  }

  // Compact stat tiles instead of a wall of label/value rows.
  const stats = document.createElement('div');
  stats.className = 'stat-grid';
  const tiles = [
    ['Infected', pct(brief.globalInfection)],
    ['Regions', `${brief.infectedRegions}/12`],
    ['Transmission', String(Math.round(transmission(state) * 10) / 10)],
    ['Summit in', `${brief.summitIn}`],
  ];
  for (const [k, v] of tiles) {
    const tile = document.createElement('div');
    tile.className = 'stat';
    const value = document.createElement('span');
    value.className = 'stat-value';
    value.textContent = v;
    const name = document.createElement('span');
    name.className = 'stat-name';
    name.textContent = k;
    tile.append(value, name);
    stats.appendChild(tile);
  }
  host.appendChild(stats);

  for (const intent of brief.intentions) {
    const div = document.createElement('div');
    div.className = `intent bloc-${intent.id}`;
    const strong = document.createElement('strong');
    strong.textContent = intent.name;
    const p = document.createElement('p');
    const bits = [intent.intent, `seen ${pct(intent.detected)}`, `treat ${intent.treatment}`];
    if (intent.extras.length) bits.push(...intent.extras);
    p.textContent = bits.join(' · ');
    div.append(strong, p);
    host.appendChild(div);
  }

  const risks = document.createElement('div');
  risks.className = 'risk-list';
  const rh = document.createElement('h3');
  rh.textContent = 'Likely next';
  risks.appendChild(rh);
  for (const risk of brief.risks) {
    const div = document.createElement('div');
    div.className = 'risk';
    div.title = risk.why; // the reasoning is a tooltip, not another paragraph
    const name = document.createElement('span');
    name.textContent = risk.name;
    const chance = document.createElement('span');
    chance.className = 'risk-chance';
    chance.textContent = `${risk.chance}%`;
    div.append(name, chance);
    risks.appendChild(div);
  }
  host.appendChild(risks);
}

// ---------------------------------------------------------------------------
// Action cards
// ---------------------------------------------------------------------------

export function renderActions(state, view, handlers) {
  const host = $('actions');
  host.innerHTML = '';

  if (view.track === 'traps') {
    renderTrapCards(state, host, handlers);
    return;
  }

  for (const action of ACTIONS.filter((a) => a.track === view.track)) {
    const bought = state.purchases[action.id] || 0;
    const cost = actionCost(state, action.id);
    const check = canPurchase(state, action.id, view.selectedRegion);

    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'card action-card';
    card.disabled = !check.ok;
    card.title = action.tip;
    card.addEventListener('click', () => handlers.onPurchase(action.id));

    const icon = document.createElement('span');
    icon.className = 'card-icon';
    icon.textContent = action.icon;

    const main = document.createElement('span');
    main.className = 'card-main';
    const name = document.createElement('span');
    name.className = 'card-name';
    name.textContent = action.name;
    const preview = document.createElement('span');
    preview.className = 'card-preview';
    preview.textContent = check.ok || !check.reason ? action.preview : check.reason;
    main.append(name, preview);

    const right = document.createElement('span');
    right.className = 'card-right';
    const price = document.createElement('span');
    price.className = 'card-cost';
    price.textContent = cost;
    right.appendChild(price);
    if (action.max < 90) {
      const level = document.createElement('span');
      level.className = 'card-level';
      level.textContent = `${bought}/${action.max}`;
      right.appendChild(level);
    }

    card.append(icon, main, right);
    host.appendChild(card);
  }
}

function renderTrapCards(state, host, handlers) {
  const note = document.createElement('p');
  note.className = 'track-note';
  note.textContent = `${armedTrapCount(state)}/${CONFIG.maxArmedTraps} held · never armable after its trigger`;
  host.appendChild(note);

  for (const trap of TRAPS) {
    const runtime = state.traps[trap.id];
    const check = canArmTrap(state, trap.id);

    const card = document.createElement('div');
    card.className = `card trap-card is-${runtime.status}`;

    const head = document.createElement('div');
    head.className = 'trap-head';
    const icon = document.createElement('span');
    icon.className = 'card-icon';
    icon.textContent = trap.icon;
    const name = document.createElement('span');
    name.className = 'card-name';
    name.textContent = trap.name;
    const price = document.createElement('span');
    price.className = 'card-cost';
    price.textContent = trap.cost;
    head.append(icon, name, price);

    const rows = document.createElement('div');
    rows.className = 'trap-rows';
    for (const [k, v] of [
      ['Trigger', trap.triggerText],
      ['Effect', trap.effectText],
    ]) {
      const row = document.createElement('p');
      const key = document.createElement('span');
      key.textContent = k;
      row.append(key, document.createTextNode(v));
      rows.appendChild(row);
    }

    const foot = document.createElement('div');
    foot.className = 'card-foot';
    const status = document.createElement('span');
    status.className = `trap-status is-${runtime.status}`;
    status.textContent =
      runtime.status === 'triggered'
        ? `fired · turn ${runtime.firedTurn}`
        : runtime.status === 'missed'
          ? 'missed'
          : runtime.status;
    status.title = trap.tellText;
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = 'Arm';
    button.disabled = !check.ok;
    if (!check.ok) button.title = check.reason;
    button.addEventListener('click', () => handlers.onArmTrap(trap.id));
    foot.append(status, button);

    card.append(head, rows, foot);
    host.appendChild(card);
  }
}

// ---------------------------------------------------------------------------
// Log and end screen
// ---------------------------------------------------------------------------

export function renderLog(state) {
  const host = $('log');
  host.innerHTML = '';
  const entries = state.turnReport.length ? state.turnReport : state.log.slice(-6);
  $('log-note').textContent = state.turnReport.length ? `Turn ${state.turn}` : '';

  for (const entry of entries) {
    const li = document.createElement('li');
    li.className = `kind-${entry.kind}${entry.pivotal ? ' is-pivotal' : ''}`;
    li.textContent = entry.text;
    host.appendChild(li);
  }
}

export function renderEndScreen(state) {
  const overlay = $('end-screen');
  if (state.phase !== 'over' || !state.outcome) {
    overlay.hidden = true;
    return;
  }
  const { result, title, summary } = state.outcome;
  overlay.querySelector('.dialog').className = `dialog is-${result}`;
  $('end-title').textContent = result === 'win' ? title : 'Humanity won';
  $('end-summary').textContent = `${summary} Collapse ${Math.round(state.collapse)}% · cure ${Math.round(
    state.cure,
  )}% · turn ${state.turn}.`;

  const list = $('end-timeline');
  list.innerHTML = '';
  for (const entry of causalTimeline(state)) {
    const li = document.createElement('li');
    const when = document.createElement('span');
    when.className = 'timeline-when';
    when.textContent = `T${entry.turn}`;
    const text = document.createElement('span');
    text.textContent = entry.text;
    li.append(when, text);
    list.appendChild(li);
  }
  overlay.hidden = false;
}

export function renderAll(state, view, handlers) {
  renderStatus(state);
  renderMap(state, view, handlers);
  renderBriefing(state);
  renderActions(state, view, handlers);
  renderLog(state);
  renderEndScreen(state);
  renderRegionDetail(state, view.selectedRegion);
  $('end-turn').disabled = state.phase !== 'planning';
  $('end-turn').textContent = state.phase === 'setup' ? 'Choose a start' : 'End turn';
  for (const tab of document.querySelectorAll('.tab')) {
    const active = tab.dataset.track === view.track;
    tab.classList.toggle('is-active', active);
    tab.setAttribute('aria-selected', String(active));
  }
}
