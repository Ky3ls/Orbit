const app = document.getElementById('app');
const who = document.getElementById('who');
const plist = document.getElementById('plist');
const playerModal = document.getElementById('playerModal');
const pmName = document.getElementById('pmName');
const pmId = document.getElementById('pmId');
const pmReason = document.getElementById('pmReason');
const playerFilter = document.getElementById('playerFilter');

let perms = {};
let players = [];
let selectedId = null;
let toggles = { noclip: false, god: false, superjump: false, ids: false };

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

function applyPerms() {
  document.querySelectorAll('[data-perm]').forEach((el) => {
    el.disabled = !can(el.dataset.perm);
  });
}

function setToggleUi() {
  document.querySelectorAll('[data-act="toggleNoclip"]').forEach((b) => b.classList.toggle('active-toggle', toggles.noclip));
  document.querySelectorAll('[data-act="toggleGod"]').forEach((b) => b.classList.toggle('active-toggle', toggles.god));
  document.querySelectorAll('[data-act="toggleSuperjump"]').forEach((b) => b.classList.toggle('active-toggle', toggles.superjump));
  document.querySelectorAll('[data-act="toggleIds"]').forEach((b) => b.classList.toggle('active-toggle', toggles.ids));
}

function renderPlayers(list) {
  players = list || [];
  const q = (playerFilter.value || '').trim().toLowerCase();
  plist.innerHTML = '';
  players
    .filter((p) => !q || String(p.name || '').toLowerCase().includes(q) || String(p.id).includes(q))
    .forEach((p) => {
      const li = document.createElement('li');
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
  selectedId = p.id;
  pmName.textContent = p.name || `Spieler #${p.id}`;
  pmId.textContent = `ID ${p.id} · ${p.ping ?? 0} ms`;
  playerModal.classList.remove('hidden');
  applyPerms();
}

function closePlayer() {
  selectedId = null;
  playerModal.classList.add('hidden');
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

document.getElementById('btnClose').onclick = () => post('close');
document.getElementById('pmClose').onclick = closePlayer;
playerFilter.oninput = () => renderPlayers(players);

document.querySelectorAll('[data-act]').forEach((btn) => {
  btn.addEventListener('click', () => {
    const act = btn.dataset.act;
    if (act === 'announce') {
      post('announce', { message: document.getElementById('announceMsg').value });
      return;
    }
    if (act === 'tpCoords') {
      post('tpCoords', { coords: document.getElementById('tpCoords').value });
      return;
    }
    if (act === 'copyCoords') {
      post('copyCoords').then(async (r) => {
        try {
          const d = await r.json();
          if (d && d.coords) {
            document.getElementById('tpCoords').value = d.coords;
            if (navigator.clipboard) navigator.clipboard.writeText(d.coords).catch(() => {});
          }
        } catch (_) { /* */ }
      });
      return;
    }
    if (act === 'toggleNoclip') { toggles.noclip = !toggles.noclip; setToggleUi(); post('toggleNoclip', { enabled: toggles.noclip }); return; }
    if (act === 'toggleGod') { toggles.god = !toggles.god; setToggleUi(); post('toggleGod', { enabled: toggles.god }); return; }
    if (act === 'toggleSuperjump') { toggles.superjump = !toggles.superjump; setToggleUi(); post('toggleSuperjump', { enabled: toggles.superjump }); return; }
    if (act === 'toggleIds') { toggles.ids = !toggles.ids; setToggleUi(); post('toggleIds', { enabled: toggles.ids }); return; }
    post(act);
  });
});

document.querySelectorAll('[data-pact]').forEach((btn) => {
  btn.addEventListener('click', () => {
    if (selectedId == null) return;
    const action = btn.dataset.pact;
    const reason = pmReason.value || '';
    post('playerAction', { id: selectedId, action, reason });
  });
});

window.addEventListener('message', (e) => {
  const d = e.data || {};
  if (d.action === 'open') {
    app.classList.remove('hidden');
    who.textContent = d.name ? `Admin · ${d.name}` : 'Admin';
    perms = d.perms || {};
    applyPerms();
    setToggleUi();
    renderPlayers(d.players || []);
    closePlayer();
  }
  if (d.action === 'close') {
    app.classList.add('hidden');
    closePlayer();
  }
  if (d.action === 'players') renderPlayers(d.list || []);
  if (d.action === 'toggles' && d.toggles) {
    toggles = { ...toggles, ...d.toggles };
    setToggleUi();
  }
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') post('close');
});
