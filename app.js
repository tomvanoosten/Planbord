/* Planboard UI, with optional same-origin shared workspace. */
'use strict';
const C = BoardCore;
const $ = id => document.getElementById(id);
const KEY = 'planboard-state';
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let state, activeCard, activeColumn, insertIndex, pendingDelete, confirmUnlockTimer, search = '', storageOK = true;
let todoDraftTimer;
const ACTIONS_KEY='planboard-actions';
let actionItems=[];
try { actionItems=JSON.parse(localStorage.getItem(ACTIONS_KEY))||[]; } catch {}
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
    window.Shared?.save(state);
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
  setTimeout(() => button.remove(), 10000);
}
function render() {
  const visibleColumns = window.Teams?.columns() || state.columns;
  $('board').innerHTML = visibleColumns.map(col => {
    const all = state.cards.filter(c => c.column === col.id && (!window.Teams || window.Teams.matches(c)));
    const cards = all.filter(c => (!window.Teams || window.Teams.matches(c)) && (c.title + ' ' + c.comment).toLocaleLowerCase().includes(search));
    return '<section class="column" style="width:' + C.width(col.width) + 'px;min-width:' + C.width(col.width) + 'px" data-column="' + esc(col.id) + '"><button class="column-resize" data-resize="' + esc(col.id) + '" aria-label="Breedte aanpassen: ' + esc(col.name) + '" title="Sleep om de breedte te wijzigen; dubbelklik voor standaardbreedte"></button><div class="column-head" draggable="true" data-drag-column="' + esc(col.id) + '" title="Sleep deze bovenbalk om de kolom te verplaatsen">' +
      '<button class="column-options" data-options="' + esc(col.id) + '" title="' + esc(col.name) + ' · kolomopties"><span class="column-name">' + esc(col.name) + '</span><span class="count">(' + all.length + ')</span><span class="dots">···</span></button>' +
      '<button class="add-card" data-add="' + esc(col.id) + '" aria-label="Project toevoegen aan ' + esc(col.name) + '">＋</button></div>' +
      (Number(col.reminder) > 0 ? '<div class="column-reminder">◷ Herinnering na ' + col.reminder + ' dag(en)</div>' : '') +
      '<div class="cards">' + (cards.length ? cards.map(card => '<button class="project-card' + (isOverdue(card) ? ' overdue' : '') + '" style="' + (isOverdue(card) ? '' : (window.Teams?.cardStyle(card)||'')) + '" draggable="true" data-card="' + esc(card.id) + '">' +
      '<span class="card-label">' + esc(state.labels.title) + '</span><span class="card-title">' + esc(card.title) + '</span>' +
      (window.Teams?.cardPeople(card)||'') +
      ((card.due || card.timerAt || card.comment) ? '<span class="card-meta">' + (card.due ? '<span>▦ ' + esc(card.due.split('-').reverse().join('-')) + '</span>' : '') +
      (card.timerAt ? '<span>◷ Timer</span>' : '') + (card.comment ? '<span>☰ Notitie</span>' : '') + '</span>' : '') + '</button>').join('') :
      '<div class="empty"><span class="empty-symbol" aria-hidden="true">▤</span><p>' + (search ? 'Geen overeenkomende projecten.' : 'Sleep hier een project naartoe of gebruik de + hierboven.') + '</p></div>') +
      '</div></section>';
  }).join('') + '<button class="column-end" data-new-column>＋ Kolom toevoegen</button>';
  const teamName = (state.teams || [{id:'everyone',name:'Iedereen'}]).find(t=>t.id === (window.Teams?.activeTeam?.() || 'everyone'))?.name || 'Iedereen';
  $('projectCount').textContent = allCardsForActiveTeam().length + ' projecten · ' + visibleColumns.length + ' kolommen · ' + teamName;
  renderNotifications();
  window.Teams?.refresh();
  renderTodoLists();
  renderArchive();
  renderActions();
}
function allCardsForActiveTeam() { return state.cards.filter(card => !window.Teams || window.Teams.matches(card)); }
function isOverdue(card) { return !!card.due && new Date(card.due + 'T23:59:59').getTime() < Date.now(); }
function activeColumns(teamId = window.Teams?.activeTeam?.() || 'everyone') {
  return window.Teams?.columns(teamId) || state.columns.filter(col => (col.teamId || 'everyone') === teamId);
}
function renderMoveColumns(teamId = $('cardTeam').value, selected) {
  window.Teams?.ensureColumns(teamId);
  const columns = activeColumns(teamId);
  $('moveCard').innerHTML = columns.map(col => '<option value="' + esc(col.id) + '">' + esc(col.name) + '</option>').join('');
  const wanted = selected || activeCard?.column;
  $('moveCard').value = columns.some(col=>col.id===wanted) ? wanted : columns[0]?.id || '';
}
window.PlanboardUI = {renderMoveColumns};
function openCard(id, column) {
  const found = id ? state.cards.find(c => String(c.id) === String(id)) : null;
  if (id && !found) return toast('Dit project is inmiddels verwijderd.');
  const stages = activeColumns();
  activeCard = found || {id: C.uid(), title: '', comment: '', due: '', alert: 1, timerAt: '', teamId: window.Teams?.activeTeam?.() || 'everyone', column: column || stages[0]?.id, enteredAt: Date.now()};
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
  renderMoveColumns(activeCard.teamId || 'everyone', activeCard.column);
  $('deleteCard').hidden = !found;
  window.Teams?.openCard(activeCard);
  if (!$('cardDialog').open) show('cardDialog');
  $('cardTitle').focus();
}
function persistActiveCard({close=false,quiet=false} = {}) {
  if (!activeCard) return true;
  if (window.Teams && !window.Teams.validate(['dueRecipients','timerRecipients'])) return false;
  const name = $('cardTitle').value.trim();
  if (!name) {
    if (!state.cards.some(card=>card.id===activeCard.id)) { if (close) $('cardDialog').close(); return true; }
    toast('Een projectnaam kan niet leeg zijn.'); return false;
  }
  const card = C.update(activeCard, {title: name, comment: $('cardComment').value, due: $('dueDate').value,
    alert: Number($('alertDays').value), timerAt: $('timerAt').value, column: $('moveCard').value, ...(window.Teams?.cardFields() || {})});
  const index = state.cards.findIndex(c => c.id === card.id);
  if (index < 0) state.cards.push(card); else state.cards[index] = card;
  activeCard = card;
  save(); render(); if (close) $('cardDialog').close(); if (!quiet) toast('Project opgeslagen.'); checkAlerts(); return true;
}
$('cardForm').onsubmit = event => { event.preventDefault(); persistActiveCard({close:true}); };
$('dueDate').onchange = () => { $('leadField').hidden = !$('dueDate').value; };
$('clearTimer').onclick = () => { $('timerAt').value = ''; };
$('newCard').onclick = () => openCard();
function openColumn(id) {
  activeColumn = activeColumns().find(c => c.id === id);
  $('columnName').value = activeColumn.name;
  $('columnReminderEnabled').checked = Number(activeColumn.reminder) > 0;
  $('columnDays').value = Number(activeColumn.reminder) || 1;
  $('columnDelayField').hidden = !$('columnReminderEnabled').checked;
  $('deleteColumn').disabled = activeColumns().length < 2;
  window.Teams?.openColumn(activeColumn);
  show('columnDialog');
}
$('columnReminderEnabled').onchange = () => { $('columnDelayField').hidden = !$('columnReminderEnabled').checked; };
$('columnForm').onsubmit = event => {
  event.preventDefault();
  if (window.Teams && !window.Teams.validate(['columnRecipients'])) return;
  const name = $('columnName').value.trim();
  if (!name) return toast('Vul een kolomnaam in.');
  activeColumn.name = name;
  activeColumn.reminder = $('columnReminderEnabled').checked ? Number($('columnDays').value) : '';
  if (window.Teams) activeColumn.recipients = window.Teams.recipients('columnRecipients');
  save(); render(); $('columnDialog').close(); toast('Kolom opgeslagen.'); checkAlerts();
};
function addColumn(index) {
  insertIndex = index;
  $('newColumnName').value = '';
  show('nameDialog');
}
$('newColumn').onclick = () => addColumn(activeColumns().length);
$('insertLeft').onclick = () => addColumn(activeColumns().indexOf(activeColumn));
$('insertRight').onclick = () => addColumn(activeColumns().indexOf(activeColumn) + 1);
$('nameForm').onsubmit = event => {
  event.preventDefault();
  const name = $('newColumnName').value.trim();
  if (!name) return toast('Vul een kolomnaam in.');
  const teamId = window.Teams?.activeTeam?.() || 'everyone';
  const columns = activeColumns(teamId);
  const actualIndex = columns[insertIndex] ? state.columns.indexOf(columns[insertIndex]) : state.columns.length;
  state.columns.splice(actualIndex, 0, {id: C.uid(), name, teamId, reminder: '', recipients:['team:'+teamId]});
  save(); render(); $('nameDialog').close(); $('columnDialog').close(); toast('Kolom toegevoegd.');
};
function askDelete(text, action, delay = 0, remote = false) {
  globalThis.clearInterval?.(confirmUnlockTimer);
  $('confirmHeading').textContent = 'Weet je het zeker?';
  $('confirmDelete').disabled = delay > 0;
  $('confirmDelete').textContent = delay ? 'Verwijderen (' + delay + ')' : 'Verwijderen';
  if (delay) {
    let seconds = delay;
    confirmUnlockTimer = setInterval(() => {
      seconds--;
      $('confirmDelete').textContent = seconds ? 'Verwijderen (' + seconds + ')' : 'Verwijderen';
      if (!seconds) { clearInterval(confirmUnlockTimer); $('confirmDelete').disabled = false; }
    }, 1000);
  }
  pendingDelete = {action, remote};
  $('confirmText').textContent = text;
  show('confirmDialog');
}
$('deleteColumn').onclick = () => {
  if (activeColumns().length < 2) return toast('Behoud minstens één kolom per team.');
  const target = activeColumn;
  const fallback = activeColumns().find(c => c.id !== target.id);
  const count = state.cards.filter(c => c.column === target.id).length;
  askDelete('Kolom “' + target.name + '” verwijderen? ' + count + ' project(en) worden verplaatst naar “' + fallback.name + '”.', () => {
    state.cards.filter(c => c.column === target.id).forEach(c => C.move(c, fallback.id));
    state.columns = state.columns.filter(c => c.id !== target.id);
    $('columnDialog').close();
  });
};
$('deleteCard').onclick = () => {
  const card = {...activeCard,title:$('cardTitle').value.trim()||activeCard.title,comment:$('cardComment').value,due:$('dueDate').value,alert:Number($('alertDays').value),timerAt:$('timerAt').value,column:$('moveCard').value||activeCard.column};
  askDelete('Project “' + card.title + '” uit het actieve bord verwijderen? Het project en de opmerkingen blijven één jaar in Archief bewaard.', () => {
    const column=state.columns.find(item=>item.id===card.column);
    const team=(state.teams||[]).find(item=>item.id===(card.teamId||'everyone'));
    state.archive ||= [];
    state.archive.push({id:C.uid(),archivedAt:Date.now(),teamName:team?.name||'Voormalig team',columnName:column?.name||'Voormalige kolom',card:{...card}});
    state.cards = state.cards.filter(c => c.id !== card.id);
    $('cardDialog').close();
  });
};
$('confirmDelete').onclick = () => {
  if ($('confirmDelete').disabled) return;
  const pending = pendingDelete; pendingDelete = null;
  globalThis.clearInterval?.(confirmUnlockTimer); $('confirmDialog').close();
  Promise.resolve(pending?.action?.()).then(() => {
    if (!pending?.remote) { save(); render(); }
    toast('Verwijderd.');
  }).catch(error => toast(error.message || 'Verwijderen lukt nu niet.'));
};
document.querySelectorAll('[data-close]').forEach(button => {
  button.onclick = () => {
    const dialog = button.closest('dialog');
    if (dialog.id === 'cardDialog') persistActiveCard({close:true,quiet:true});
    else dialog.close();
  };
});
async function showAdminMembers() {
  const data=await window.Shared.members();
  const me=window.Teams?.me?.();
  $('adminLoginForm').hidden=true; $('adminMembers').hidden=false;
  $('adminMemberList').innerHTML=data.members.map(member=>'<div class="admin-member"><span class="person-chip" style="--person-color:'+esc(member.color)+'">'+esc(member.name)+'</span><small>'+esc((member.teams||[]).join(', ') || 'Alleen Iedereen')+'</small>'+ (member.id===me?.id?'<small>jij</small>':'<button class="danger" data-admin-delete="'+esc(member.id)+'" data-admin-name="'+esc(member.name)+'">Verwijderen</button>')+'</div>').join('');
}
$('adminButton').onclick=()=>{ $('profileDialog').close(); $('adminCode').value=''; $('adminLoginForm').hidden=false; $('adminMembers').hidden=true; show('adminDialog'); };
$('adminLoginForm').onsubmit=async event=>{ event.preventDefault(); try { await window.Shared.adminLogin($('adminCode').value); $('adminCode').value=''; await showAdminMembers(); } catch(error) { toast(error.message); } };
$('adminMemberList').onclick=event=>{
  const button=event.target.closest('[data-admin-delete]'); if(!button) return;
  askDelete('Account “'+button.dataset.adminName+'” verwijderen? Dit kan niet ongedaan worden gemaakt. Projecten blijven behouden.',async()=>{ await window.Shared.deleteMember(button.dataset.adminDelete); await showAdminMembers(); },3,true);
};
if ($('cardDialog').addEventListener) {
  $('cardDialog').addEventListener('cancel', event => { event.preventDefault(); persistActiveCard({close:true,quiet:true}); });
  $('cardDialog').addEventListener('click', event => { if (event.target === $('cardDialog')) persistActiveCard({close:true,quiet:true}); });
}
$('board').onclick = event => {
  const option = event.target.closest('[data-options]');
  const add = event.target.closest('[data-add]');
  const card = event.target.closest('[data-card]');
  if (option) openColumn(option.dataset.options);
  else if (add) openCard(null, add.dataset.add);
  else if (card) openCard(card.dataset.card);
  else if (event.target.closest('[data-new-column]')) addColumn(activeColumns().length);
};
let dragged = null, draggedColumn = null, resizing = null;
$('board').onpointerdown = event => {
  const handle=event.target.closest('[data-resize]');
  if (!handle || event.button!==0) return;
  event.preventDefault();
  const column=state.columns.find(c=>c.id===handle.dataset.resize);
  resizing={column,handle,element:handle.closest('[data-column]'),start:event.clientX,width:C.width(column.width),next:C.width(column.width)};
  handle.setPointerCapture(event.pointerId);
};
$('board').onpointermove = event => {
  if (!resizing) return;
  resizing.next=C.width(resizing.width+event.clientX-resizing.start);
  resizing.element.style.width=resizing.element.style.minWidth=resizing.next+'px';
};
$('board').onpointerup = () => {
  if (!resizing) return;
  resizing.column.width=resizing.next; resizing=null; save(); render();
};
$('board').onpointercancel = () => { if (resizing) { resizing=null; render(); } };
$('board').ondblclick = event => {
  const handle=event.target.closest('[data-resize]');
  if (!handle) return;
  state.columns.find(c=>c.id===handle.dataset.resize).width=218; save(); render();
};
$('board').onkeydown = event => {
  const handle=event.target.closest('[data-resize]');
  if (!handle || !['ArrowLeft','ArrowRight'].includes(event.key)) return;
  event.preventDefault(); const col=state.columns.find(c=>c.id===handle.dataset.resize);
  col.width=C.width(C.width(col.width)+(event.key==='ArrowRight'?20:-20));save();render();
};
$('board').ondragstart = event => {
  const header = event.target.closest('[data-drag-column]');
  if (header?.dataset?.dragColumn) {
    draggedColumn = header.dataset.dragColumn;
    event.dataTransfer.setData('text/plain', draggedColumn);
    event.dataTransfer.effectAllowed = 'move';
    header.closest?.('[data-column]')?.classList.add('dragging-column');
    return;
  }
  const card = event.target.closest('[data-card]');
  if (!card) return;
  dragged = card.dataset.card;
  event.dataTransfer.setData('text/plain', dragged);
  event.dataTransfer.effectAllowed = 'move';
};
$('board').ondragover = event => {
  const col = event.target.closest('[data-column]');
  if (!col || (!dragged && !draggedColumn)) return;
  event.preventDefault();
  event.dataTransfer.dropEffect = 'move';
  document.querySelectorAll('.dragover,.column-dragover,.card-dragover').forEach(el => el.classList.remove('dragover','column-dragover','card-dragover'));
  if (draggedColumn) col.classList.add('column-dragover');
  else {
    col.classList.add('dragover');
    event.target.closest('[data-card]')?.classList.add('card-dragover');
  }
};
$('board').ondrop = event => {
  const col = event.target.closest('[data-column]');
  if (!col || (!dragged && !draggedColumn)) return;
  event.preventDefault();
  if (draggedColumn) {
    const target = col.dataset.column;
    if (target !== draggedColumn) {
      const from = state.columns.findIndex(column => column.id === draggedColumn);
      const [moved] = state.columns.splice(from,1);
      const targetIndex = state.columns.findIndex(column => column.id === target);
      const rect = col.getBoundingClientRect?.() || {left:0,width:0};
      const after = event.clientX > rect.left + rect.width / 2;
      state.columns.splice(targetIndex + (after ? 1 : 0),0,moved);
      save(); render(); toast('Kolom verplaatst.');
    }
    draggedColumn = null; return;
  }
  const card = state.cards.find(c => c.id === dragged);
  const targetCard = event.target.closest('[data-card]')?.dataset.card;
  if (card) {
    const moved = card.column !== col.dataset.column;
    if (moved) C.move(card, col.dataset.column);
    if (targetCard && targetCard !== card.id) {
      const from = state.cards.findIndex(item=>item.id===card.id);
      const [item] = state.cards.splice(from,1);
      const targetIndex = state.cards.findIndex(item=>item.id===targetCard);
      const targetElement = event.target.closest('[data-card]');
      const rect = targetElement?.getBoundingClientRect?.() || {top:0,height:0};
      const after = event.clientY > rect.top + rect.height / 2;
      state.cards.splice(targetIndex + (after ? 1 : 0),0,item);
    }
    save(); render(); toast(moved ? 'Project verplaatst.' : 'Projectvolgorde aangepast.');
  }
  dragged = null;
};
$('board').ondragend = () => { dragged = null; draggedColumn = null; document.querySelectorAll('.dragover,.column-dragover,.card-dragover,.dragging-column').forEach(el => el.classList.remove('dragover','column-dragover','card-dragover','dragging-column')); };

const TODO_KEY='planboard-todo-lists';
let activeView='board';
function todoPreferences() {
  try { return JSON.parse(localStorage.getItem(TODO_KEY)) || [{source:'me',collapsed:false}]; }
  catch { return [{source:'me',collapsed:false}]; }
}
function saveTodoPreferences(lists) { localStorage.setItem(TODO_KEY,JSON.stringify(lists)); }
function todoColumnName(card) { return state.columns.find(col=>col.id===card.column)?.name || 'Voormalige kolom'; }
function archiveMonths() {
  const now=new Date(),months=[];
  for(let offset=0;offset<12;offset++) { const date=new Date(now.getFullYear(),now.getMonth()-offset,1); months.push({key:date.toISOString().slice(0,7),name:new Intl.DateTimeFormat('nl-NL',{month:'long',year:'numeric'}).format(date)}); }
  return months;
}
function renderArchive() {
  if (!$('archiveMonths')) return;
  const archived=state.archive||[];
  $('archiveMonths').innerHTML=archiveMonths().map(month=>{
    const items=archived.filter(item=>new Date(item.archivedAt).toISOString().slice(0,7)===month.key).sort((a,b)=>b.archivedAt-a.archivedAt);
    return '<section class="archive-month"><h3>'+esc(month.name)+'</h3><span class="archive-count">('+items.length+')</span><div class="archive-items">'+(items.length?items.map(item=>'<article class="archive-card"><strong>'+esc(item.card.title)+'</strong><small>Team: '+esc(item.teamName)+' · Kolom: '+esc(item.columnName)+'</small>'+(item.card.due?'<small>▦ Deadline: '+esc(item.card.due.split('-').reverse().join('-'))+'</small>':'')+(item.card.timerAt?'<small>◷ Persoonlijke herinnering</small>':'')+(item.card.comment?'<p>'+esc(item.card.comment)+'</p>':'<p class="archive-empty-note">Geen opmerking.</p>')+'<time>Gearchiveerd '+esc(new Date(item.archivedAt).toLocaleDateString('nl-NL'))+'</time></article>').join(''):'<p class="archive-empty-note">Geen projecten.</p>')+'</div></section>';
  }).join('');
}
function normalizeActions(items) {
  return Array.isArray(items) ? items.slice(0,250).map(item=>({id:String(item.id||C.uid()),text:String(item.text||'').slice(0,4000),done:!!item.done})) : [];
}
function saveActions() {
  actionItems=normalizeActions(actionItems);
  localStorage.setItem(ACTIONS_KEY,JSON.stringify(actionItems));
  window.Shared?.saveActions?.(actionItems);
}
function renderActions() {
  if (!$('actionRows')) return;
  $('actionsOwner').textContent=window.Teams?.me?.()?.name ? 'Persoonlijke actielijst van '+window.Teams.me().name+'.' : 'Jouw persoonlijke klad- en actielijst.';
  $('actionRows').innerHTML=actionItems.length?actionItems.map(item=>'<div class="actions-row" data-action="'+esc(item.id)+'"><textarea data-action-text="'+esc(item.id)+'" aria-label="Actie">'+esc(item.text)+'</textarea><label class="action-check"><input type="checkbox" data-action-done="'+esc(item.id)+'"'+(item.done?' checked':'')+'><span>Gedaan</span></label></div>').join(''):'<div class="actions-row actions-empty"><textarea data-action-text="new" aria-label="Nieuwe actie" placeholder="Typ hier je eerste actie of klad…"></textarea><label class="action-check"><input type="checkbox" disabled><span>Gedaan</span></label></div>';
  $('actionRows').querySelectorAll?.('[data-action-text]').forEach(autoSizeAction);
}
function autoSizeAction(input) { if(!input?.style) return; input.style.height='0px'; input.style.height=Math.max(50,input.scrollHeight||50)+'px'; }
function updateAction(id,fields) {
  if (id==='new') { const text=String(fields.text||'').trim(); if(!text) return; actionItems.push({id:C.uid(),text,done:false}); }
  else { const item=actionItems.find(entry=>entry.id===id); if(!item)return; Object.assign(item,fields); }
  saveActions();
}
window.PlanboardActions={set(items){actionItems=normalizeActions(items);localStorage.setItem(ACTIONS_KEY,JSON.stringify(actionItems));renderActions();},get(){return normalizeActions(actionItems);}};
function renderTodoLists() {
  if (!$('todoLists') || !window.Teams) return;
  const lists=todoPreferences();
  $('todoLists').innerHTML=lists.map((list,index) => {
    const cards=window.Teams.sourceCards(list.source);
    const color=window.Teams.sourceColor(list.source);
    const title=window.Teams.sourceLabel(list.source);
    return '<section class="todo-list" style="--todo-color:'+esc(color)+'" data-todo-list="'+index+'"><button class="todo-list-head" data-toggle-todo="'+index+'"><span>'+esc(title)+'</span><span class="todo-count">('+cards.length+')</span><span class="todo-collapse">'+(list.collapsed?'⌄':'⌃')+'</span></button>'+
      (list.collapsed?'':'<div class="todo-list-content">'+(cards.length?cards.map(card => '<article class="todo-card" data-todo-card="'+esc(card.id)+'"><button class="todo-card-title" data-open-todo="'+esc(card.id)+'"><span>'+esc(card.title)+'</span><span class="todo-details"><span>▦ '+esc(todoColumnName(card))+'</span>'+(card.due?'<span>▦ '+esc(card.due.split('-').reverse().join('-'))+'</span>':'')+(card.timerAt?'<span>◷ Persoonlijke herinnering</span>':'')+'</span></button><label class="todo-comment-label">'+esc(state.labels.comment)+'<textarea class="todo-comment" data-todo-comment="'+esc(card.id)+'" placeholder="Opmerking toevoegen…">'+esc(card.comment)+'</textarea></label></article>').join(''):'<p class="todo-empty">Geen gekoppelde projecten.</p>')+'</div>')+'</section>';
  }).join('');
}
$('todoManage').onclick=()=>{
  const sources=[{id:'me',name:'Mijn projecten'}]
    .concat((window.Teams?.sourceCards?state.teams.map(team=>({id:'team:'+team.id,name:'Team: '+team.name})):[]))
    .concat((window.Shared?.enabled?[]:[]));
  const people=window.Teams?.people?.() || [];
  sources.push(...people.map(person=>({id:'person:'+person.id,name:'Persoon: '+person.name})));
  const existing=todoPreferences().map(list=>list.source);
  $('todoSource').innerHTML=sources.filter(source=>!existing.includes(source.id)).map(source=>'<option value="'+esc(source.id)+'">'+esc(source.name)+'</option>').join('') || '<option value="">Alle beschikbare lijsten worden al getoond</option>';
  $('addTodoForm').querySelector('button').disabled=!$('todoSource').value;
  $('todoListSettings').innerHTML=todoPreferences().map((list,index)=>'<div class="todo-setting"><strong>'+esc(window.Teams.sourceLabel(list.source))+'</strong><button data-collapse-todo="'+index+'">'+(list.collapsed?'Uitklappen':'Inklappen')+'</button>'+(list.source==='me'?'':'<button class="danger" data-remove-todo="'+index+'">Verbergen</button>')+'</div>').join('');
  show('todoDialog');
};
$('addTodoForm').onsubmit=event=>{event.preventDefault();const source=$('todoSource').value;if(!source)return;const lists=todoPreferences();lists.push({source,collapsed:false});saveTodoPreferences(lists);renderTodoLists();$('todoManage').click();};
$('todoListSettings').onclick=event=>{const remove=event.target.closest('[data-remove-todo]'),collapse=event.target.closest('[data-collapse-todo]');const lists=todoPreferences();if(remove)lists.splice(Number(remove.dataset.removeTodo),1);if(collapse)lists[Number(collapse.dataset.collapseTodo)].collapsed=!lists[Number(collapse.dataset.collapseTodo)].collapsed;saveTodoPreferences(lists);renderTodoLists();$('todoManage').click();};
$('todoLists').onclick=event=>{const toggle=event.target.closest('[data-toggle-todo]'),open=event.target.closest('[data-open-todo]');if(toggle){const lists=todoPreferences();lists[Number(toggle.dataset.toggleTodo)].collapsed=!lists[Number(toggle.dataset.toggleTodo)].collapsed;saveTodoPreferences(lists);renderTodoLists();}else if(open)openCard(open.dataset.openTodo);};
$('todoLists').oninput=event=>{const input=event.target.closest('[data-todo-comment]');if(!input)return;const card=state.cards.find(c=>c.id===input.dataset.todoComment);if(!card)return;card.comment=input.value;save();$('saveStatus').textContent='Opmerking gedeeld';};
$('todoLists').onchange=event=>{const input=event.target.closest('[data-todo-comment]');if(!input)return;const card=state.cards.find(c=>c.id===input.dataset.todoComment);if(card){card.comment=input.value;save();$('saveStatus').textContent='Opmerking gedeeld';}};
function setView(view) {
  activeView=view;
  document.body?.classList?.toggle('long-overview',view==='todo');
  $('board').hidden=view!=='board'; $('todoOverview').hidden=view!=='todo'; $('archiveOverview').hidden=view!=='archive'; $('actionsOverview').hidden=view!=='actions';
  $('todoViewButton').textContent=view==='board'?'☷ To do-overzicht':'▦ Terug naar projectstatus';
  $('todoViewButton').setAttribute('aria-pressed',String(view==='todo'));
  $('archiveViewButton').setAttribute('aria-pressed',String(view==='archive'));
  $('actionsViewButton').setAttribute('aria-pressed',String(view==='actions'));
}
$('todoViewButton').onclick=()=>setView(activeView==='board'?'todo':'board');
$('archiveViewButton').onclick=()=>setView(activeView==='archive'?'board':'archive');
$('actionsViewButton').onclick=()=>setView(activeView==='actions'?'board':'actions');
$('newAction').onclick=()=>{actionItems.push({id:C.uid(),text:'',done:false});saveActions();renderActions();$('actionRows').querySelector?.('textarea')?.focus();};
$('actionRows').oninput=event=>{const input=event.target.closest('[data-action-text]');if(!input)return;autoSizeAction(input);if(input.dataset.actionText==='new')return;updateAction(input.dataset.actionText,{text:input.value});};
$('actionRows').onchange=event=>{const text=event.target.closest('[data-action-text]');if(text&&text.dataset.actionText==='new')return updateAction('new',{text:text.value});const input=event.target.closest('[data-action-done]');if(!input)return;updateAction(input.dataset.actionDone,{done:input.checked});};
$('printActions').onclick=()=>window.print();
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
  const visible = state.notifications.map((n,i) => ({n,i})).filter(({n}) => window.Shared?.enabled || !window.Teams || C.receives(n,window.Teams.me()));
  $('badge').textContent = visible.filter(({n}) => !n.read).length;
  $('notificationList').innerHTML = visible.length ? visible.map(({n,i}) =>
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
    setTimeout(() => desktop.close(), 10000);
  } catch { toast('De desktopmelding kon niet worden getoond. Je melding staat in het meldingenoverzicht.'); }
}
function checkAlerts() {
  if (window.Shared?.enabled) return;
  const notes = C.collect(state);
  if (!notes.length) return;
  save(); renderNotifications(); notes.filter(n => !window.Teams || C.receives(n, window.Teams.me())).forEach(notify);
}
$('desktopNotifications').onclick = async () => {
  if (window.Shared?.enabled) return window.Shared.enablePush();
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
