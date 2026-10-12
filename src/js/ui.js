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

const $ = (id) => document.getElementById(id);
const pct = (v) => `${Math.round(v * 100)}%`;
const SVG_NS = 'http://www.w3.org/2000/svg';

const BLOC_LABEL = { red: 'Red Bloc', blue: 'Blue Bloc', neutral: 'Neutral' };

function el(tag, attrs = {}, text = null) {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  if (text !== null) node.textContent = text;
  return node;
}

function hexPoints(cx, cy, r) {
  const pts = [];
  for (let i = 0; i < 6; i++) {
    const a = (Math.PI / 180) * (60 * i - 30);
    pts.push(`${(cx + r * Math.cos(a)).toFixed(2)},${(cy + r * Math.sin(a)).toFixed(2)}`);
  }
  return pts.join(' ');
}

const radiusOf = (region) => 3.5 + region.pop / 95;

/** Status word + glyph for a region, so status never depends on colour alone. */
function regionStatus(state, regionId) {
  const rs = state.regions[regionId];
  const seen = visibleInfection(state, regionId);
  if (rs.cleared) return { glyph: '✓', word: 'cleared' };
  if (rs.contained) return { glyph: '▣', word: 'contained' };
  if (seen.value > 0.001) return { glyph: seen.unverified ? '≈' : '◉', word: 'infected' };
  return { glyph: '◌', word: 'clean' };
}

// ---------------------------------------------------------------------------
// Map
// ---------------------------------------------------------------------------

export function renderMap(state, view, handlers) {
  const svg = $('map');
  svg.textContent = '';
  const seedable = state.phase === 'setup' ? REGIONS.map((r) => r.id) : seedableRegions(state);
  // Highlight placeable regions while the player is actually able to seed one.
  const canSeedNow =
    state.phase === 'setup' ||
    (state.phase === 'planning' &&
      view.track === 'spread' &&
      state.drift >= actionCost(state, 'seed'));

  const edgeLayer = el('g', { class: 'edges' });
  for (const e of EDGES) {
    const a = REGION_BY_ID[e.a];
    const b = REGION_BY_ID[e.b];
    const closed = (state.closedEdges[`${e.a}|${e.b}`] || 0) > 0;
    const hot = state.regions[e.a].inf > 0.05 && state.regions[e.b].inf > 0.05;
    const classes = ['edge'];
    if (e.cross) classes.push('is-cross');
    if (closed) classes.push('is-closed');
    else if (hot) classes.push('is-hot');
    const line = el('line', {
      x1: a.x,
      y1: a.y,
      x2: b.x,
      y2: b.y,
      class: classes.join(' '),
    });
    if (closed) line.appendChild(el('title', {}, `${a.name} ↔ ${b.name}: route closed`));
    edgeLayer.appendChild(line);
  }
  svg.appendChild(edgeLayer);

  for (const region of REGIONS) {
    const rs = state.regions[region.id];
    const seen = visibleInfection(state, region.id);
    const status = regionStatus(state, region.id);
    const r = radiusOf(region);

    const classes = [`region`, `bloc-${region.bloc}`];
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

    group.appendChild(
      el('polygon', {
        points: hexPoints(region.x, region.y, r),
        class: 'region-body',
        fill: region.bloc === 'red' ? '#2a1a1d' : region.bloc === 'blue' ? '#16202e' : '#1d232c',
      }),
    );

    if (seen.value > 0.001) {
      group.appendChild(
        el('polygon', {
          points: hexPoints(region.x, region.y, r * Math.sqrt(Math.min(1, seen.value))),
          fill: rs.contained ? '#b06a28' : '#c23a32',
          'fill-opacity': '0.85',
          stroke: 'none',
          'pointer-events': 'none',
        }),
      );
    }

    group.appendChild(el('text', { x: region.x, y: region.y + 0.9, class: 'region-glyph' }, status.glyph));
    group.appendChild(
      el('text', { x: region.x, y: region.y + r + 2.6, class: 'region-label' }, region.name),
    );
    group.appendChild(
      el(
        'text',
        { x: region.x, y: region.y + r + 4.9, class: 'region-figure' },
        seen.value > 0.001 ? `${seen.unverified ? '≈' : ''}${pct(seen.value)}` : status.word,
      ),
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

  $('map-status').textContent =
    state.phase === 'setup'
      ? 'Select a region to seed patient zero.'
      : `${metrics(state).infectedRegions}/12 regions carrying cases · global infection ${pct(
          metrics(state).globalInfection,
        )}`;
}

export function renderRegionDetail(state, regionId) {
  const box = $('region-detail');
  if (!regionId) {
    box.innerHTML = '<p class="muted">Tap or hover a region for details.</p>';
    return;
  }
  const region = REGION_BY_ID[regionId];
  const rs = state.regions[regionId];
  const seen = visibleInfection(state, regionId);
  const status = regionStatus(state, regionId);
  const neighbours = EDGES.filter((e) => e.a === regionId || e.b === regionId).map((e) => {
    const other = e.a === regionId ? e.b : e.a;
    const closed = (state.closedEdges[`${e.a}|${e.b}`] || 0) > 0;
    return `${REGION_BY_ID[other].name}${closed ? ' (closed)' : ''}${e.cross ? ' ⚔' : ''}`;
  });

  box.innerHTML = '';
  const h = document.createElement('h3');
  h.textContent = region.name;
  const sub = document.createElement('p');
  sub.className = 'muted';
  sub.style.margin = '0';
  sub.style.fontSize = '12px';
  sub.textContent = `${BLOC_LABEL[region.bloc]} · ${region.pop}M${region.harsh ? ' · harsh climate' : ''}`;

  const dl = document.createElement('dl');
  const rows = [
    ['Status', `${status.glyph} ${status.word}${seen.unverified ? ' (unverified)' : ''}`],
    ['Infected', pct(seen.value)],
    ['Routes', neighbours.join(', ')],
  ];
  if (region.bloc !== 'neutral') {
    rows.push(['Treatment', String(Math.round(state.blocs[region.bloc].treatment))]);
  }
  for (const [k, v] of rows) {
    const dt = document.createElement('dt');
    dt.textContent = k;
    const dd = document.createElement('dd');
    dd.textContent = v;
    dl.append(dt, dd);
  }
  box.append(h, sub, dl);
}

// ---------------------------------------------------------------------------
// Status bars and meters
// ---------------------------------------------------------------------------

export function renderStatus(state) {
  const m = metrics(state);
  $('clock-turn').textContent = `Turn ${state.turn}`;
  $('clock-day').textContent = `Day ${state.day}`;
  $('drift-value').textContent = Math.floor(state.drift);
  $('drift-income').textContent = `+${driftIncome(state)} / turn`;
  $('seed-value').textContent = state.seed;

  $('collapse-value').textContent = `${Math.round(state.collapse)}%`;
  $('collapse-bar').style.width = `${state.collapse}%`;
  $('cure-value').textContent = `${Math.round(state.cure)}%`;
  $('cure-bar').style.width = `${state.cure}%`;

  const forecast = cureForecast(state);
  $('cure-forecast').textContent = forecast.known
    ? `est. ${forecast.turns} turns to cure (rate ${state.cureRateLast}/turn)`
    : 'Cure forecast: research has not started';

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
      ? `united ${state.cooperationStreak}/${CONFIG.cooperationLossTurns} turns — you lose at ${CONFIG.cooperationLossTurns}`
      : `loss at ${CONFIG.cooperationLossThreshold} for ${CONFIG.cooperationLossTurns} turns`;
  $('invest-note').textContent = state.investigationResolved
    ? 'resolved: ruled natural, cure accelerated'
    : 'at 100 the blocs unite';
  $('summit-value').textContent = turnsUntilSummit(state);
  document.querySelector('[data-meter="summit"] .meter-note').textContent = state.sabotageArmed
    ? 'sabotage ready'
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
    host.innerHTML = '<p class="muted">Seed patient zero to receive the first briefing.</p>';
    return;
  }

  const block = (title) => {
    const b = document.createElement('div');
    b.className = 'brief-block';
    const h = document.createElement('h3');
    h.textContent = title;
    b.appendChild(h);
    return b;
  };
  const line = (left, right) => {
    const l = document.createElement('div');
    l.className = 'brief-line';
    const a = document.createElement('span');
    a.textContent = left;
    const c = document.createElement('span');
    c.textContent = right;
    l.append(a, c);
    return l;
  };

  const world = block('World');
  world.appendChild(line('Global infection', pct(brief.globalInfection)));
  world.appendChild(line('Regions with cases', `${brief.infectedRegions}/12`));
  world.appendChild(line('Regions declared cleared', String(brief.clearedRegions)));
  world.appendChild(line('Transmission', String(Math.round(transmission(state) * 10) / 10)));
  world.appendChild(
    line('Cure forecast', brief.forecast.known ? `~${brief.forecast.turns} turns (est.)` : 'unknown'),
  );
  world.appendChild(
    line('Next summit', `${brief.summitIn} turn${brief.summitIn === 1 ? '' : 's'}${state.sabotageArmed ? ' · sabotaged' : ''}`),
  );
  host.appendChild(world);

  const blocs = block('Bloc intentions');
  for (const intent of brief.intentions) {
    const div = document.createElement('div');
    div.className = `intent bloc-${intent.id}`;
    const strong = document.createElement('strong');
    strong.textContent = `${intent.name}: ${intent.intent}`;
    const p = document.createElement('p');
    const bits = [`detected ${pct(intent.detected)}`, `treatment ${intent.treatment}`, ...intent.extras];
    p.textContent = bits.join(' · ');
    div.append(strong, p);
    blocs.appendChild(div);
  }
  host.appendChild(blocs);

  const risks = block('Likeliest developments');
  for (const risk of brief.risks) {
    const div = document.createElement('div');
    div.className = 'risk';
    const name = document.createElement('span');
    name.textContent = risk.name;
    const chance = document.createElement('span');
    chance.className = 'risk-chance';
    chance.textContent = `${risk.chance}%`;
    const why = document.createElement('span');
    why.className = 'risk-why';
    why.textContent = risk.why;
    div.append(name, chance, why);
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

  const actions = ACTIONS.filter((a) => a.track === view.track);
  for (const action of actions) {
    const bought = state.purchases[action.id] || 0;
    const cost = actionCost(state, action.id);
    const check = canPurchase(state, action.id, view.selectedRegion);

    const card = document.createElement('div');
    card.className = 'card';

    const head = document.createElement('div');
    head.className = 'card-head';
    const h = document.createElement('h3');
    h.textContent = action.name;
    const price = document.createElement('span');
    price.className = 'card-cost';
    price.textContent = `${cost} Drift`;
    head.append(h, price);

    const blurb = document.createElement('p');
    blurb.className = 'card-blurb';
    blurb.textContent = action.blurb;

    const preview = document.createElement('p');
    preview.className = 'card-preview';
    preview.textContent = `→ ${action.preview}`;

    const foot = document.createElement('div');
    foot.className = 'card-foot';
    const level = document.createElement('span');
    level.className = 'card-level';
    level.textContent =
      action.max < 90 ? `level ${bought}/${action.max}` : bought ? `bought ×${bought}` : '';
    const right = document.createElement('div');
    right.style.display = 'flex';
    right.style.alignItems = 'center';
    right.style.gap = '8px';
    if (!check.ok) {
      const reason = document.createElement('span');
      reason.className = 'card-reason';
      reason.textContent = check.reason;
      right.appendChild(reason);
    }
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = action.id === 'seed' ? 'Seed' : 'Buy';
    button.disabled = !check.ok;
    button.addEventListener('click', () => handlers.onPurchase(action.id));
    right.appendChild(button);
    foot.append(level, right);

    card.append(head, blurb, preview, foot);
    host.appendChild(card);
  }
}

function renderTrapCards(state, host, handlers) {
  const note = document.createElement('p');
  note.className = 'card-preview';
  note.style.margin = '0 0 4px';
  note.textContent = `Held ${armedTrapCount(state)}/${CONFIG.maxArmedTraps} · holding a trap costs ${Math.round(
    CONFIG.armedTransmissionPenalty * 100,
  )}% transmission · a trap can never be armed after its trigger exists`;
  host.appendChild(note);

  for (const trap of TRAPS) {
    const runtime = state.traps[trap.id];
    const triggered = trapTriggered(state, trap.id);
    const check = canArmTrap(state, trap.id);

    const card = document.createElement('div');
    card.className = 'card';

    const head = document.createElement('div');
    head.className = 'card-head';
    const h = document.createElement('h3');
    h.textContent = trap.name;
    const price = document.createElement('span');
    price.className = 'card-cost';
    price.textContent = `${trap.cost} Drift`;
    head.append(h, price);

    const status = document.createElement('span');
    status.className = `trap-status is-${runtime.status}`;
    status.textContent =
      runtime.status === 'triggered'
        ? `triggered on turn ${runtime.firedTurn}`
        : runtime.status === 'missed'
          ? 'missed — trigger passed'
          : runtime.status;

    const meta = document.createElement('dl');
    meta.className = 'trap-meta';
    const rows = [
      ['Trigger', trap.triggerText],
      ['Effect', trap.effectText],
      ['Cost / tell', trap.tellText],
      ['Trigger now?', triggered ? 'yes — condition already met' : 'not yet'],
    ];
    for (const [k, v] of rows) {
      const dt = document.createElement('dt');
      dt.textContent = k;
      const dd = document.createElement('dd');
      dd.textContent = v;
      meta.append(dt, dd);
    }

    const foot = document.createElement('div');
    foot.className = 'card-foot';
    foot.appendChild(status);
    const right = document.createElement('div');
    right.style.display = 'flex';
    right.style.alignItems = 'center';
    right.style.gap = '8px';
    if (!check.ok) {
      const reason = document.createElement('span');
      reason.className = 'card-reason';
      reason.textContent = check.reason;
      right.appendChild(reason);
    }
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = 'Arm';
    button.disabled = !check.ok;
    button.addEventListener('click', () => handlers.onArmTrap(trap.id));
    right.appendChild(button);
    foot.append(right);

    card.append(head, meta, foot);
    host.appendChild(card);
  }
}

// ---------------------------------------------------------------------------
// Log and end screen
// ---------------------------------------------------------------------------

export function renderLog(state) {
  const host = $('log');
  host.innerHTML = '';
  const entries = state.turnReport.length ? state.turnReport : state.log.slice(-8);
  $('log-note').textContent = state.turnReport.length
    ? `Turn ${state.turn} · ${entries.length} development${entries.length === 1 ? '' : 's'}`
    : 'Everything that changed, and why.';

  for (const entry of entries) {
    const li = document.createElement('li');
    li.className = `kind-${entry.kind}${entry.pivotal ? ' is-pivotal' : ''}`;
    const turn = document.createElement('span');
    turn.className = 'log-turn';
    turn.textContent = `T${entry.turn}`;
    const text = document.createElement('span');
    text.textContent = entry.text;
    li.append(turn, text);
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
  $('end-title').textContent = result === 'win' ? `${title} — you win` : `${title} — you lose`;
  $('end-summary').textContent = `${summary} Collapse ${Math.round(state.collapse)}% · cure ${Math.round(
    state.cure,
  )}% · cooperation ${Math.round(state.cooperation)} · turn ${state.turn} (day ${state.day}).`;

  const list = $('end-timeline');
  list.innerHTML = '';
  for (const entry of causalTimeline(state)) {
    const li = document.createElement('li');
    const when = document.createElement('span');
    when.className = 'timeline-when';
    when.textContent = `T${entry.turn} · D${entry.day}`;
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
  $('end-turn').textContent = state.phase === 'setup' ? 'Seed patient zero first' : 'End turn';
  for (const tab of document.querySelectorAll('.tab')) {
    const active = tab.dataset.track === view.track;
    tab.classList.toggle('is-active', active);
    tab.setAttribute('aria-selected', String(active));
  }
}
