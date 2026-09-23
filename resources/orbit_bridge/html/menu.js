const app = document.getElementById('app');
const who = document.getElementById('who');
const plist = document.getElementById('plist');
const res = () => (typeof GetParentResourceName === 'function' ? GetParentResourceName() : 'orbit');

function post(name, data = {}) {
  return fetch(`https://${res()}/${name}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
}

function renderPlayers(list) {
  plist.innerHTML = '';
  (list || []).forEach((p) => {
    const li = document.createElement('li');
    li.innerHTML = `<span class="name">#${p.id} ${p.name || ''}</span>`;
    const b = document.createElement('button');
    b.textContent = 'Kick';
    b.className = 'danger';
    b.onclick = () => post('kick', { id: p.id, reason: 'Orbit' });
    li.appendChild(b);
    plist.appendChild(li);
  });
}

document.querySelectorAll('.tabs button').forEach((btn) => {
  btn.onclick = () => {
    document.querySelectorAll('.tabs button').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    document.querySelectorAll('.tab').forEach((t) => t.classList.add('hidden'));
    document.getElementById(`tab-${btn.dataset.tab}`).classList.remove('hidden');
  };
});

document.getElementById('btnClose').onclick = () => post('close');

document.querySelectorAll('[data-act]').forEach((btn) => {
  btn.addEventListener('click', () => {
    const act = btn.dataset.act;
    if (act === 'announce') {
      post('announce', { message: document.getElementById('announceMsg').value });
      return;
    }
    post(act);
  });
});

window.addEventListener('message', (e) => {
  const d = e.data || {};
  if (d.action === 'open') {
    app.classList.remove('hidden');
    who.textContent = d.name ? `Admin · ${d.name}` : 'Admin';
    renderPlayers(d.players || []);
  }
  if (d.action === 'close') app.classList.add('hidden');
  if (d.action === 'players') renderPlayers(d.list || []);
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') post('close');
});
