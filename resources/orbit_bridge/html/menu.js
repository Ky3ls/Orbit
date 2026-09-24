const app = document.getElementById('app');
const who = document.getElementById('who');
const plist = document.getElementById('plist');
const playerModal = document.getElementById('playerModal');
const pmName = document.getElementById('pmName');
const pmIdBadge = document.getElementById('pmIdBadge');
const pmReason = document.getElementById('pmReason');
const pmBanReason = document.getElementById('pmBanReason');
const pmInfo = document.getElementById('pmInfo');
const playerFilter = document.getElementById('playerFilter');
const promptEl = document.getElementById('prompt');
const promptTitle = document.getElementById('promptTitle');
const promptInput = document.getElementById('promptInput');
const mainMenu = document.getElementById('mainMenu');
const vehMenu = document.getElementById('vehMenu');

let perms = {};
let players = [];
let selectedPlayer = null;
let toggles = { noclip: false, god: false, superjump: false, ids: false };
let focusIdx = 0;
let promptKind = null;
let pmTab = 'actions';

const ICO = {
  mode: '<svg viewBox="0 0 16 16" width="15" height="15"><path fill="currentColor" d="M8 1.5 9.2 6.2 14 7.2 9.2 8.2 8 12.9 6.8 8.2 2 7.2 6.8 6.2Z"/><circle cx="8" cy="8" r="1.4" fill="currentColor"/></svg>',
  tp: '<svg viewBox="0 0 16 16" width="15" height="15"><path fill="currentColor" d="M8 1.8c2.6 0 4.7 2 4.7 4.5 0 3.2-4.7 7.9-4.7 7.9S3.3 9.5 3.3 6.3C3.3 3.8 5.4 1.8 8 1.8Zm0 2.4a2.1 2.1 0 1 0 0 4.2 2.1 2.1 0 0 0 0-4.2Z"/></svg>',
  heal: '<svg viewBox="0 0 16 16" width="15" height="15"><path fill="currentColor" d="M6.2 1.8h3.6v4.4h4.4v3.6H9.8v4.4H6.2V9.8H1.8V6.2h4.4Z"/></svg>',
  megaphone: '<svg viewBox="0 0 16 16" width="15" height="15"><path fill="currentColor" d="M2.2 6.2h2.4l5.2-3.2v9.6L4.6 9.4H2.2Zm11 1.2a3.6 3.6 0 0 1 0 2.8l-1.1-.5a2.4 2.4 0 0 0 0-1.8Z"/></svg>',
  broom: '<svg viewBox="0 0 16 16" width="15" height="15"><path fill="currentColor" d="M9.4 1.6 14 6.2l-1.2 1.2-4.6-4.6Zm-1 2.2 4.6 4.6-6.4 4.2c-1.4.9-3.2.6-4.2-.5-.9-1-.9-2.6.2-3.7Z"/></svg>',
  ids: '<svg viewBox="0 0 16 16" width="15" height="15"><rect x="2.2" y="3.2" width="11.6" height="9.6" rx="1.4" fill="none" stroke="currentColor" stroke-width="1.5"/><path stroke="currentColor" stroke-width="1.4" d="M5 7.2h6M5 9.6h4"/></svg>',
  veh: '<svg viewBox="0 0 16 16" width="15" height="15"><path fill="currentColor" d="M3.2 7.2 4.4 4.2h7.2l1.2 3h1v4.2h-1.6a1.6 1.6 0 0 1-3.2 0H6.8a1.6 1.6 0 0 1-3.2 0H2.2V7.2Zm2.2 3.4a1 1 0 1 0 0-2 1 1 0 0 0 0 2Zm5.2 0a1 1 0 1 0 0-2 1 1 0 0 0 0 2Z"/></svg>',
  coords: '<svg viewBox="0 0 16 16" width="15" height="15"><path d="M8 1.5v13M1.5 8h13" fill="none" stroke="currentColor" stroke-width="1.5"/><circle cx="8" cy="8" r="2.2" fill="currentColor"/></svg>',
};

/** @type {Record<string, { idx: number, label: string, ico: string, options: Array<object> }>} */
const selectors = {
  mode: {
    idx: 0,
    label: 'Modus',
    ico: 'mode',
    options: [
      { id: 'noclip', label: 'NoClip', act: 'toggleNoclip', perm: 'noclip', toggle: 'noclip' },
      { id: 'god', label: 'Godmode', act: 'toggleGod', perm: 'god', toggle: 'god' },
      { id: 'superjump', label: 'Superjump', act: 'toggleSuperjump', perm: 'superjump', toggle: 'superjump' },
    ],
  },
  tp: {
    idx: 0,
    label: 'Teleport',
    ico: 'tp',
    options: [
      { id: 'wp', label: 'Wegpunkt', act: 'tpWaypoint', perm: 'teleport' },
      { id: 'back', label: 'Zurück', act: 'tpBack', perm: 'teleport' },
      { id: 'coords', label: 'Koordinaten…', act: 'promptCoords', perm: 'teleport' },
    ],
  },
  heal: {
    idx: 0,
    label: 'Heilung',
    ico: 'heal',
    options: [
      { id: 'self', label: 'Selbst', act: 'healSelf', perm: 'healSelf' },
      { id: 'all', label: 'Alle', act: 'healAll', perm: 'healAll' },
    ],
  },
  veh: {
    idx: 0,
    label: 'Aktion',
    ico: 'veh',
    options: [
      { id: 'repair', label: 'Reparieren', act: 'vehRepair', perm: 'vehicle' },
      { id: 'boost', label: 'Boost', act: 'vehBoost', perm: 'vehicle' },
      { id: 'flip', label: 'Aufrichten', act: 'vehFlip', perm: 'vehicle' },
      { id: 'del', label: 'Löschen', act: 'vehDelete', perm: 'vehicle', danger: true },
    ],
  },
};

const MAIN_ACTIONS = [
  { id: 'announce', label: 'Ankündigung', ico: 'megaphone', act: 'promptAnnounce', perm: 'announce' },
  { id: 'area', label: 'Area bereinigen', ico: 'broom', act: 'clearArea', perm: 'clearArea' },
  { id: 'ids', label: 'Spieler-IDs', ico: 'ids', act: 'toggleIds', perm: 'ids', toggle: 'ids' },
];

const PACT_MOD = [
  { id: 'message', label: 'DM', pact: 'message', perm: 'message' },
  { id: 'warn', label: 'Warn', pact: 'warn', perm: 'warn' },
  { id: 'kick', label: 'Kick', pact: 'kick', perm: 'kick', danger: true },
];
const PACT_INT = [
  { id: 'heal', label: 'Heal', pact: 'heal', perm: 'healSelf' },
  { id: 'goto', label: 'Goto', pact: 'goto', perm: 'goto' },
  { id: 'bring', label: 'Bring', pact: 'bring', perm: 'bring' },
  { id: 'spectate', label: 'Spectate', pact: 'spectate', perm: 'spectate' },
  { id: 'freeze', label: 'Freeze', pact: 'freeze', perm: 'freeze' },
];
const PACT_TROLL = [
  { id: 'drunk', label: 'Betrunken', pact: 'drunk', perm: 'players' },
  { id: 'fire', label: 'Feuer', pact: 'fire', perm: 'players' },
];

const res = () => (typeof GetParentResourceName === 'function' ? GetParentResourceName() : 'orbit');

function post(name, data = {}) {
  return fetch(`https://${res()}/${name}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  }).catch(() => {});
}

function can(perm) {
  if (!perm) return true;
  if (!perms || typeof perms !== 'object') return true;
  if (perms[perm] === undefined) return true;
  return !!perms[perm];
}

function currentOpt(key) {
  const s = selectors[key];
  if (!s || !s.options.length) return null;
  s.idx = ((s.idx % s.options.length) + s.options.length) % s.options.length;
  return s.options[s.idx];
}

function paintRow(el, key) {
  const s = selectors[key];
  if (!el || !s) return;
  const opt = currentOpt(key);
  if (!opt) {
    el.classList.add('is-disabled');
    return;
  }
  const allowed = can(opt.perm);
  const on = opt.toggle ? !!toggles[opt.toggle] : false;
  el.classList.toggle('is-disabled', !allowed);
  el.classList.toggle('is-on', on);
  el.classList.toggle('danger', !!opt.danger);
  el.dataset.perm = opt.perm || '';

  const mid = el.querySelector('.mid');
  const cyc = el.querySelector('.cyc');
  if (mid) {
    mid.innerHTML = `<span class="lab">${s.label}</span><span class="val">${opt.label}${on ? '<i class="badge-on" title="aktiv"></i>' : ''}</span>`;
  }
  if (cyc) cyc.innerHTML = '<b>‹</b><b>›</b>';
}

function paintActionRow(el) {
  if (!el) return;
  const toggle = el.dataset.toggle;
  const on = toggle ? !!toggles[toggle] : false;
  el.classList.toggle('is-on', on);
  el.classList.toggle('is-disabled', !can(el.dataset.perm));
  const mid = el.querySelector('.mid');
  if (mid) {
    const lab = el.dataset.label || '';
    mid.innerHTML = `<span class="lab">${lab}</span>${on ? '<i class="badge-on" title="aktiv"></i>' : ''}`;
  }
}

function buildCycleRow(key) {
  const s = selectors[key];
  const el = document.createElement('div');
  el.className = 'row cycle';
  el.dataset.selector = key;
  el.setAttribute('role', 'listbox');
  el.tabIndex = -1;
  el.innerHTML = `
    <span class="ico">${ICO[s.ico] || ''}</span>
    <span class="mid"></span>
    <span class="cyc" aria-hidden="true"></span>
  `;
  paintRow(el, key);
  el.addEventListener('click', (e) => {
    const cyc = e.target.closest('.cyc');
    if (cyc) {
      const rect = cyc.getBoundingClientRect();
      cycleSelector(key, e.clientX < rect.left + rect.width / 2 ? -1 : 1);
      return;
    }
    activateSelector(key);
  });
  return el;
}

function buildActionRow(def) {
  const el = document.createElement('div');
  el.className = 'row act';
  el.dataset.act = def.act;
  el.dataset.perm = def.perm || '';
  el.dataset.label = def.label;
  if (def.toggle) el.dataset.toggle = def.toggle;
  el.tabIndex = -1;
  el.innerHTML = `
    <span class="ico">${ICO[def.ico] || ''}</span>
    <span class="mid"></span>
  `;
  paintActionRow(el);
  el.addEventListener('click', () => runAction(def.act));
  return el;
}

function buildMenus() {
  mainMenu.innerHTML = '';
  mainMenu.appendChild(buildCycleRow('mode'));
  mainMenu.appendChild(buildCycleRow('tp'));
  mainMenu.appendChild(buildCycleRow('heal'));
  MAIN_ACTIONS.forEach((a) => mainMenu.appendChild(buildActionRow(a)));

  vehMenu.innerHTML = '';
  vehMenu.appendChild(buildCycleRow('veh'));
}

function paintAllSelectors() {
  document.querySelectorAll('[data-selector]').forEach((el) => paintRow(el, el.dataset.selector));
  document.querySelectorAll('.row.act').forEach((el) => paintActionRow(el));
}

function cycleSelector(key, dir) {
  const s = selectors[key];
  if (!s || !s.options.length) return;
  s.idx = (s.idx + dir + s.options.length) % s.options.length;
  const el = document.querySelector(`[data-selector="${key}"]`);
  paintRow(el, key);
}

function openPrompt(kind, title, placeholder, initial = '') {
  promptKind = kind;
  promptTitle.textContent = title;
  promptInput.placeholder = placeholder || '';
  promptInput.value = initial || '';
  promptEl.classList.remove('hidden');
  promptEl.setAttribute('aria-hidden', 'false');
  requestAnimationFrame(() => {
    promptInput.focus();
    promptInput.select();
  });
}

function closePrompt() {
  promptKind = null;
  promptEl.classList.add('hidden');
  promptEl.setAttribute('aria-hidden', 'true');
  promptInput.blur();
}

function submitPrompt() {
  const val = (promptInput.value || '').trim();
  const kind = promptKind;
  closePrompt();
  if (kind === 'announce') {
    if (!val) return;
    post('announce', { message: val });
  } else if (kind === 'coords') {
    if (!val) return;
    post('tpCoords', { coords: val });
  }
}

function runAction(act) {
  if (act === 'promptAnnounce') {
    openPrompt('announce', 'Ankündigung', 'Nachricht an alle…');
    return;
  }
  if (act === 'promptCoords') {
    openPrompt('coords', 'Koordinaten', 'x, y, z');
    post('copyCoords').then(async (r) => {
      try {
        const d = await r.json();
        if (d && d.coords && promptKind === 'coords') {
          promptInput.value = d.coords;
          promptInput.select();
        }
      } catch (_) { /* */ }
    });
    return;
  }
  if (act === 'toggleNoclip') {
    toggles.noclip = !toggles.noclip;
    paintAllSelectors();
    post('toggleNoclip', { enabled: toggles.noclip });
    return;
  }
  if (act === 'toggleGod') {
    toggles.god = !toggles.god;
    paintAllSelectors();
    post('toggleGod', { enabled: toggles.god });
    return;
  }
  if (act === 'toggleSuperjump') {
    toggles.superjump = !toggles.superjump;
    paintAllSelectors();
    post('toggleSuperjump', { enabled: toggles.superjump });
    return;
  }
  if (act === 'toggleIds') {
    toggles.ids = !toggles.ids;
    paintAllSelectors();
    post('toggleIds', { enabled: toggles.ids });
    return;
  }
  post(act);
}

function activateSelector(key) {
  const opt = currentOpt(key);
  if (!opt || !can(opt.perm)) return;
  if (opt.act) runAction(opt.act);
}

function applyPerms() {
  paintAllSelectors();
  document.querySelectorAll('[data-perm]').forEach((el) => {
    if (el.classList.contains('row')) return;
    el.disabled = !can(el.dataset.perm);
  });
  renderPactButtons();
}

function activeTabId() {
  const btn = document.querySelector('.tabs button.active');
  return btn ? btn.dataset.tab : 'main';
}

function isModalOpen() {
  return playerModal && !playerModal.classList.contains('hidden');
}

function isPromptOpen() {
  return promptEl && !promptEl.classList.contains('hidden');
}

function isTypingTarget(el) {
  if (!el) return false;
  const tag = (el.tagName || '').toLowerCase();
  return tag === 'input' || tag === 'textarea' || el.isContentEditable;
}

function renderPactButtons() {
  const fill = (root, list) => {
    if (!root) return;
    root.innerHTML = '';
    list.forEach((a) => {
      if (!can(a.perm)) return;
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = a.label;
      b.dataset.pact = a.pact;
      b.dataset.perm = a.perm || '';
      if (a.danger) b.classList.add('danger');
      b.onclick = () => runPact(a.pact);
      root.appendChild(b);
    });
  };
  fill(document.getElementById('pmMod'), PACT_MOD);
  fill(document.getElementById('pmInt'), PACT_INT);
  fill(document.getElementById('pmTroll'), PACT_TROLL);
}

function runPact(pact) {
  if (!selectedPlayer) return;
  let reason = pmReason.value || '';
  if (pact === 'ban') reason = pmBanReason.value || reason;
  post('playerAction', { id: selectedPlayer.id, action: pact, reason });
}

function focusables() {
  const list = [];
  if (isPromptOpen()) {
    list.push(promptInput, document.getElementById('promptOk'), document.getElementById('promptCancel'));
    return list.filter(Boolean);
  }
  if (isModalOpen()) {
    playerModal.querySelectorAll('.pm-nav-btn').forEach((el) => list.push(el));
    const pane = playerModal.querySelector(`.pm-view:not(.hidden)`);
    if (pane) {
      pane.querySelectorAll('button:not([disabled]), input:not([disabled])').forEach((el) => list.push(el));
    }
    list.push(document.getElementById('pmClose'));
    return list.filter(Boolean);
  }
  document.querySelectorAll('.tabs button').forEach((el) => list.push(el));
  const tab = document.getElementById(`tab-${activeTabId()}`);
  if (tab) {
    tab.querySelectorAll('.row:not(.is-disabled), input:not([disabled]), #plist li[data-pid], button:not([disabled])').forEach((el) => {
      list.push(el);
    });
  }
  return list;
}

function clearKbFocus() {
  document.querySelectorAll('.kb-focus').forEach((el) => el.classList.remove('kb-focus'));
}

function setKbFocus(idx, opts = {}) {
  const items = focusables();
  if (!items.length) return;
  focusIdx = ((idx % items.length) + items.length) % items.length;
  clearKbFocus();
  const el = items[focusIdx];
  el.classList.add('kb-focus');
  if (opts.domFocus !== false && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA')) {
    el.focus({ preventScroll: true });
  } else if (document.activeElement && isTypingTarget(document.activeElement) && document.activeElement !== el) {
    document.activeElement.blur();
  }
  el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}

function moveFocus(delta) {
  setKbFocus(focusIdx + delta);
}

function focusedEl() {
  return focusables()[focusIdx] || null;
}

function activateFocused() {
  const el = focusedEl();
  if (!el || el.disabled) return;
  if (el.classList.contains('row') && el.dataset.selector) {
    activateSelector(el.dataset.selector);
    return;
  }
  if (el.classList.contains('row') && el.dataset.act) {
    runAction(el.dataset.act);
    return;
  }
  if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') {
    el.focus();
    return;
  }
  el.click();
}

function cycleFocused(dir) {
  const el = focusedEl();
  if (el && el.classList.contains('row') && el.dataset.selector) {
    cycleSelector(el.dataset.selector, dir);
    return true;
  }
  return false;
}

function switchTab(dir) {
  const tabs = [...document.querySelectorAll('.tabs button')];
  if (!tabs.length) return;
  let i = tabs.findIndex((t) => t.classList.contains('active'));
  i = (i + dir + tabs.length) % tabs.length;
  tabs[i].click();
  requestAnimationFrame(() => {
    const items = focusables();
    const firstContent = items.findIndex((el) => !el.closest('.tabs'));
    setKbFocus(firstContent >= 0 ? firstContent : 0, { domFocus: false });
  });
}

function setPmTab(name) {
  pmTab = name;
  document.querySelectorAll('.pm-nav-btn').forEach((b) => {
    b.classList.toggle('active', b.dataset.pm === name);
  });
  document.querySelectorAll('.pm-view').forEach((v) => v.classList.add('hidden'));
  const pane = document.getElementById(`pm-pane-${name}`);
  if (pane) pane.classList.remove('hidden');
}

function renderPlayers(list) {
  players = list || [];
  const q = (playerFilter.value || '').trim().toLowerCase();
  plist.innerHTML = '';
  players
    .filter((p) => !q || String(p.name || '').toLowerCase().includes(q) || String(p.id).includes(q))
    .forEach((p) => {
      const li = document.createElement('li');
      li.dataset.pid = String(p.id);
      li.setAttribute('role', 'button');
      li.tabIndex = -1;
      li.innerHTML = `<div><div class="name">#${p.id} ${p.name || ''}</div><div class="meta">${p.ping ?? 0} ms</div></div>`;
      li.onclick = () => openPlayer(p);
      plist.appendChild(li);
    });
  if (!plist.children.length) {
    const empty = document.createElement('li');
    empty.innerHTML = '<div class="meta">Keine Spieler</div>';
    empty.style.cursor = 'default';
    plist.appendChild(empty);
  }
}

function openPlayer(p) {
  selectedPlayer = p;
  pmName.textContent = p.name || `Spieler #${p.id}`;
  pmIdBadge.textContent = `[${p.id}]`;
  pmInfo.innerHTML = `
    <dt>ID</dt><dd>${p.id}</dd>
    <dt>Name</dt><dd>${p.name || '—'}</dd>
    <dt>Ping</dt><dd>${p.ping ?? 0} ms</dd>
  `;
  setPmTab('actions');
  playerModal.classList.remove('hidden');
  playerModal.setAttribute('aria-hidden', 'false');
  applyPerms();
  requestAnimationFrame(() => setKbFocus(0, { domFocus: false }));
}

function closePlayer() {
  selectedPlayer = null;
  playerModal.classList.add('hidden');
  playerModal.setAttribute('aria-hidden', 'true');
}

document.querySelectorAll('.tabs button').forEach((btn) => {
  btn.onclick = () => {
    document.querySelectorAll('.tabs button').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    document.querySelectorAll('.tab').forEach((t) => t.classList.add('hidden'));
    document.getElementById(`tab-${btn.dataset.tab}`).classList.remove('hidden');
    if (btn.dataset.tab !== 'players') closePlayer();
  };
});

document.querySelectorAll('.pm-nav-btn').forEach((btn) => {
  btn.onclick = () => {
    setPmTab(btn.dataset.pm);
    requestAnimationFrame(() => setKbFocus(0, { domFocus: false }));
  };
});

document.getElementById('pmClose').onclick = () => {
  closePlayer();
  requestAnimationFrame(() => setKbFocus(0, { domFocus: false }));
};

document.querySelector('.pm-ban-btn')?.addEventListener('click', () => runPact('ban'));

playerFilter.oninput = () => renderPlayers(players);

document.querySelectorAll('[data-act="refreshPlayers"]').forEach((btn) => {
  btn.addEventListener('click', () => runAction('refreshPlayers'));
});

document.getElementById('promptOk').onclick = submitPrompt;
document.getElementById('promptCancel').onclick = () => {
  closePrompt();
  requestAnimationFrame(() => setKbFocus(0, { domFocus: false }));
};

buildMenus();

window.addEventListener('message', (e) => {
  const d = e.data || {};
  if (d.action === 'open') {
    app.classList.remove('hidden');
    app.classList.toggle('align-right', !!(d.alignRight || (d.game && d.game.alignRight)));
    who.textContent = d.name ? `Admin · ${d.name}` : 'Admin';
    perms = d.perms || {};
    applyPerms();
    renderPlayers(d.players || []);
    closePlayer();
    closePrompt();
    requestAnimationFrame(() => {
      const items = focusables();
      const first = items.findIndex((el) => el.dataset && el.dataset.selector === 'mode');
      setKbFocus(first >= 0 ? first : 0, { domFocus: false });
    });
  }
  if (d.action === 'close') {
    app.classList.add('hidden');
    closePlayer();
    closePrompt();
    clearKbFocus();
  }
  if (d.action === 'players') renderPlayers(d.list || []);
  if (d.action === 'toggles' && d.toggles) {
    toggles = { ...toggles, ...d.toggles };
    paintAllSelectors();
  }
});

document.addEventListener('keydown', (e) => {
  if (app.classList.contains('hidden') && !isModalOpen() && !isPromptOpen()) return;

  const typing = isTypingTarget(document.activeElement);

  if (e.key === 'Escape') {
    e.preventDefault();
    if (isPromptOpen()) {
      closePrompt();
      requestAnimationFrame(() => setKbFocus(0, { domFocus: false }));
    } else if (isModalOpen()) {
      closePlayer();
      requestAnimationFrame(() => setKbFocus(0, { domFocus: false }));
    } else if (typing) {
      document.activeElement.blur();
    } else {
      post('close');
    }
    return;
  }

  if (isPromptOpen()) {
    if (e.key === 'Enter') {
      e.preventDefault();
      submitPrompt();
    }
    return;
  }

  if (e.key === 'Tab') {
    e.preventDefault();
    if (isModalOpen()) return;
    switchTab(e.shiftKey ? -1 : 1);
    return;
  }

  if (typing) {
    if (e.key === 'Enter') {
      e.preventDefault();
      document.activeElement.blur();
      moveFocus(1);
    }
    return;
  }

  if (e.key === 'ArrowDown') {
    e.preventDefault();
    moveFocus(1);
    return;
  }
  if (e.key === 'ArrowUp') {
    e.preventDefault();
    moveFocus(-1);
    return;
  }
  if (e.key === 'ArrowRight') {
    e.preventDefault();
    if (!cycleFocused(1)) moveFocus(1);
    return;
  }
  if (e.key === 'ArrowLeft') {
    e.preventDefault();
    if (!cycleFocused(-1)) moveFocus(-1);
    return;
  }
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault();
    activateFocused();
  }
});
