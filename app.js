/* Planboard: browser-only UI. All saved data stays in this browser. */
'use strict';
const C = BoardCore;
const $ = id => document.getElementById(id);
const KEY = 'planboard-state';
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let state, activeCard, activeColumn, insertIndex, pendingDelete, search = '', storageOK = true;
try {
  const raw = localStorage.getItem(KEY);
  state = raw ? C.normalize(JSON.parse(raw)) : C.seed();
} catch (error) {
  state = C.seed();
  storageOK = false;
  $('storageWarning').hidden = false;
  $('storageWarning').textContent = 'Opgeslagen gegevens konden niet worden geladen. Je kunt het bord proberen; bestaande opslag wordt niet overschreven.';
}
function save() {
  if (!storageOK) return;
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
    $('saveStatus').textContent = 'Opgeslagen in deze browser';
  } catch {
    $('storageWarning').hidden = false;
    $('storageWarning').textContent = 'Opslaan lukt niet in deze browser. Houd deze pagina open om wijzigingen niet te verliezen.';
    $('saveStatus').textContent = 'Niet opgeslagen';
  }
}
function show(id) { $(id).showModal(); }
function toast(text, cardId) {
  const button = document.createElement('button');
  button.className = 'toast';
  button.textContent = text;
  if (cardId) {
    const hint = document.createElement('small');
    hint.textContent = 'Klik om het project te openen';
    button.append(hint);
  }
  button.onclick = () => { button.remove(); if (cardId) openCard(cardId); };
  $('toasts').append(button);
  setTimeout(() => button.remove(), 5000);
}
function render() {
  $('board').innerHTML = state.columns.map(col => {
    const all = state.cards.filter(c => c.column === col.id);
    const cards = all.filter(c => (c.title + ' ' + c.comment).toLocaleLowerCase().includes(search));
    return '<section class="column" data-column="' + esc(col.id) + '"><div class="column-head">' +
      '<button class="column-options" data-options="' + esc(col.id) + '" title="' + esc(col.name) + ' · kolomopties"><span class="column-name">' + esc(col.name) + '</span><span class="count">(' + all.length + ')</span><span class="dots">···</span></button>' +
      '<button class="add-card" data-add="' + esc(col.id) + '" aria-label="Project toevoegen aan ' + esc(col.name) + '">＋</button></div>' +
      (Number(col.reminder) > 0 ? '<div class="column-reminder">◷ Herinnering na ' + col.reminder + ' dag(en)</div>' : '') +
      '<div class="cards">' + (cards.length ? cards.map(card => '<button class="project-card" draggable="true" data-card="' + esc(card.id) + '">' +
      '<span class="card-label">' + esc(state.labels.title) + '</span><span class="card-title">' + esc(card.title) + '</span>' +
      ((card.due || card.timerAt || card.comment) ? '<span class="card-meta">' + (card.due ? '<span>▦ ' + esc(card.due.split('-').reverse().join('-')) + '</span>' : '') +
      (card.timerAt ? '<span>◷ Timer</span>' : '') + (card.comment ? '<span>☰ Notitie</span>' : '') + '</span>' : '') + '</button>').join('') :
      '<div class="empty"><span class="empty-symbol" aria-hidden="true">▤</span><p>' + (search ? 'Geen overeenkomende projecten.' : 'Sleep hier een project naartoe of gebruik de + hierboven.') + '</p></div>') +
      '</div></section>';
  }).join('') + '<button class="column-end" data-new-column>＋ Kolom toevoegen</button>';
  $('projectCount').textContent = state.cards.length + ' projecten · ' + state.columns.length + ' kolommen';
  renderNotifications();
}
function openCard(id, column) {
  const found = id ? state.cards.find(c => String(c.id) === String(id)) : null;
  if (id && !found) return toast('Dit project is inmiddels verwijderd.');
  activeCard = found || {id: C.uid(), title: '', comment: '', due: '', alert: 1, timerAt: '', column: column || state.columns[0].id, enteredAt: Date.now()};
  $('cardHeading').textContent = found ? 'Project bewerken' : 'Nieuw project';
  $('cardTitle').value = activeCard.title;
  $('cardComment').value = activeCard.comment;
  $('dueDate').value = activeCard.due;
  $('alertDays').value = activeCard.alert;
  $('timerAt').value = activeCard.timerAt || '';
  $('leadField').hidden = !activeCard.due;
  $('titleLabel').textContent = state.labels.title;
  $('commentLabel').textContent = state.labels.comment;
  $('dateLabel').textContent = state.labels.date;
  $('leadLabel').textContent = state.labels.lead;
  $('moveCard').innerHTML = state.columns.map(col => '<option value="' + esc(col.id) + '">' + esc(col.name) + '</option>').join('');
  $('moveCard').value = activeCard.column;
  $('deleteCard').hidden = !found;
  if (!$('cardDialog').open) show('cardDialog');
  $('cardTitle').focus();
}
$('cardForm').onsubmit = event => {
  event.preventDefault();
  const name = $('cardTitle').value.trim();
  if (!name) return toast('Vul een projectnaam in.');
  const card = C.update(activeCard, {title: name, comment: $('cardComment').value, due: $('dueDate').value,
    alert: Number($('alertDays').value), timerAt: $('timerAt').value, column: $('moveCard').value});
  const index = state.cards.findIndex(c => c.id === card.id);
  if (index < 0) state.cards.push(card); else state.cards[index] = card;
  save(); render(); $('cardDialog').close(); toast('Project opgeslagen.'); checkAlerts();
};
$('dueDate').onchange = () => { $('leadField').hidden = !$('dueDate').value; };
$('clearTimer').onclick = () => { $('timerAt').value = ''; };
$('newCard').onclick = () => openCard();
function openColumn(id) {
  activeColumn = state.columns.find(c => c.id === id);
  $('columnName').value = activeColumn.name;
  $('columnReminderEnabled').checked = Number(activeColumn.reminder) > 0;
  $('columnDays').value = Number(activeColumn.reminder) || 1;
  $('columnDelayField').hidden = !$('columnReminderEnabled').checked;
  $('deleteColumn').disabled = state.columns.length < 2;
  show('columnDialog');
}
$('columnReminderEnabled').onchange = () => { $('columnDelayField').hidden = !$('columnReminderEnabled').checked; };
$('columnForm').onsubmit = event => {
  event.preventDefault();
  const name = $('columnName').value.trim();
  if (!name) return toast('Vul een kolomnaam in.');
  activeColumn.name = name;
  activeColumn.reminder = $('columnReminderEnabled').checked ? Number($('columnDays').value) : '';
  save(); render(); $('columnDialog').close(); toast('Kolom opgeslagen.'); checkAlerts();
};
function addColumn(index) {
  insertIndex = index;
  $('newColumnName').value = '';
  show('nameDialog');
}
$('newColumn').onclick = () => addColumn(state.columns.length);
$('insertLeft').onclick = () => addColumn(state.columns.indexOf(activeColumn));
$('insertRight').onclick = () => addColumn(state.columns.indexOf(activeColumn) + 1);
$('nameForm').onsubmit = event => {
  event.preventDefault();
  const name = $('newColumnName').value.trim();
  if (!name) return toast('Vul een kolomnaam in.');
  state.columns.splice(insertIndex, 0, {id: C.uid(), name, reminder: ''});
  save(); render(); $('nameDialog').close(); $('columnDialog').close(); toast('Kolom toegevoegd.');
};
function askDelete(text, action) {
  pendingDelete = action;
  $('confirmText').textContent = text;
  show('confirmDialog');
}
$('deleteColumn').onclick = () => {
  if (state.columns.length < 2) return toast('Behoud minstens één kolom.');
  const target = activeColumn;
  const fallback = state.columns.find(c => c.id !== target.id);
  const count = state.cards.filter(c => c.column === target.id).length;
  askDelete('Kolom “' + target.name + '” verwijderen? ' + count + ' project(en) worden verplaatst naar “' + fallback.name + '”.', () => {
    state.cards.filter(c => c.column === target.id).forEach(c => C.move(c, fallback.id));
    state.columns = state.columns.filter(c => c.id !== target.id);
    $('columnDialog').close();
  });
};
$('deleteCard').onclick = () => {
  const id = activeCard.id;
  askDelete('Project “' + activeCard.title + '” en de bijbehorende opmerkingen verwijderen?', () => {
    state.cards = state.cards.filter(c => c.id !== id);
    $('cardDialog').close();
  });
};
$('confirmDelete').onclick = () => {
  pendingDelete?.(); pendingDelete = null;
  $('confirmDialog').close(); save(); render(); toast('Verwijderd.');
};
document.querySelectorAll('[data-close]').forEach(button => {
  button.onclick = () => button.closest('dialog').close();
});
$('board').onclick = event => {
  const option = event.target.closest('[data-options]');
  const add = event.target.closest('[data-add]');
  const card = event.target.closest('[data-card]');
  if (option) openColumn(option.dataset.options);
  else if (add) openCard(null, add.dataset.add);
  else if (card) openCard(card.dataset.card);
  else if (event.target.closest('[data-new-column]')) addColumn(state.columns.length);
};
let dragged = null;
$('board').ondragstart = event => {
  const card = event.target.closest('[data-card]');
  if (!card) return;
  dragged = card.dataset.card;
  event.dataTransfer.setData('text/plain', dragged);
  event.dataTransfer.effectAllowed = 'move';
};
$('board').ondragover = event => {
  const col = event.target.closest('[data-column]');
  if (!col || !dragged) return;
  event.preventDefault();
  event.dataTransfer.dropEffect = 'move';
  document.querySelectorAll('.dragover').forEach(el => el.classList.remove('dragover'));
  col.classList.add('dragover');
};
$('board').ondrop = event => {
  const col = event.target.closest('[data-column]');
  if (!col || !dragged) return;
  event.preventDefault();
  const card = state.cards.find(c => c.id === dragged);
  if (card) { C.move(card, col.dataset.column); save(); render(); toast('Project verplaatst.'); }
  dragged = null;
};
$('board').ondragend = () => { dragged = null; document.querySelectorAll('.dragover').forEach(el => el.classList.remove('dragover')); };
$('search').oninput = () => { search = $('search').value.trim().toLocaleLowerCase(); render(); };
$('settingsButton').onclick = () => {
  for (const key of ['Title', 'Comment', 'Date', 'Lead']) $('setting' + key).value = state.labels[key.toLowerCase()];
  show('settingsDialog');
};
$('settingsForm').onsubmit = event => {
  event.preventDefault();
  for (const key of ['Title', 'Comment', 'Date', 'Lead']) {
    const value = $('setting' + key).value.trim();
    if (!value) return toast('Vul alle veldnamen in.');
  }
  for (const key of ['Title', 'Comment', 'Date', 'Lead']) state.labels[key.toLowerCase()] = $('setting' + key).value.trim();
  save(); render(); $('settingsDialog').close(); toast('Veldnamen opgeslagen.');
};
function renderNotifications() {
  $('badge').textContent = state.notifications.filter(n => !n.read).length;
  $('notificationList').innerHTML = state.notifications.length ? state.notifications.map((n, i) =>
    '<button class="notification ' + (n.read ? '' : 'unread') + '" data-notice="' + i + '"><strong>' + esc(n.title) + '</strong><small>' + esc(n.text) + '</small></button>').join('') : '<p class="help">Je hebt nog geen meldingen.</p>';
}
$('bell').onclick = () => { renderNotifications(); show('notificationDialog'); };
$('markRead').onclick = () => { state.notifications.forEach(n => { n.read = true; }); save(); renderNotifications(); };
$('notificationList').onclick = event => {
  const button = event.target.closest('[data-notice]');
  if (!button) return;
  const note = state.notifications[Number(button.dataset.notice)];
  note.read = true;
  save(); renderNotifications(); $('notificationDialog').close(); openCard(note.card);
};
function notify(note) {
  toast(note.title + ': ' + note.text, note.card);
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  try {
    const desktop = new Notification(note.title, {body: note.text, tag: note.id, requireInteraction: false});
    desktop.onclick = () => {
      window.focus(); note.read = true; save(); renderNotifications(); openCard(note.card); desktop.close();
    };
    setTimeout(() => desktop.close(), 5000);
  } catch { toast('De desktopmelding kon niet worden getoond. Je melding staat in het meldingenoverzicht.'); }
}
function checkAlerts() {
  const notes = C.collect(state);
  if (!notes.length) return;
  save(); renderNotifications(); notes.forEach(notify);
}
$('desktopNotifications').onclick = async () => {
  if (!('Notification' in window) || !window.isSecureContext) return toast('Desktopmeldingen vereisen een ondersteunde browser op HTTPS of localhost.');
  try {
    const permission = await Notification.requestPermission();
    toast(permission === 'granted' ? 'Desktopmeldingen ingeschakeld. Gebruik Testmelding om te controleren.' : 'Desktopmeldingen zijn niet toegestaan. Je kunt dit aanpassen in de site-instellingen van je browser.');
  } catch { toast('De browser heeft het verzoek om desktopmeldingen niet toegestaan.'); }
};
$('testNotification').onclick = () => {
  const card = state.cards[0];
  if (!card) return toast('Maak eerst een project aan om een melding te testen.');
  const note = {id: C.uid(), card: card.id, title: card.title, text: 'Testmelding — klik om dit project te openen.', at: Date.now(), read: false};
  state.notifications.unshift(note); save(); renderNotifications(); notify(note);
};
document.addEventListener('visibilitychange', () => { if (!document.hidden) checkAlerts(); });
window.addEventListener('focus', checkAlerts);
render(); checkAlerts();
setInterval(checkAlerts, 1000);
