'use strict';
(() => {
  let guest;
  try { guest = JSON.parse(localStorage.getItem('planboard-guest')); } catch {}
  guest ||= {id: C.uid(), name: 'Gast', teams: []};
  let people = [];
  let filter = 'everyone';
  let onlyMine=false;
  const assigned = card => (card.assignees||[]).map(id=>(people.length?people:[guest]).find(p=>p.id===id)||{id,name:'Voormalig lid'});
  const personChip = p => '<span class="person-chip" style="--person-color:'+C.color(p.color,p.id)+'" title="'+esc(p.name)+'">'+esc(p.name)+'</span>';
  state = C.normalize(state);
  const persistGuest = () => localStorage.setItem('planboard-guest', JSON.stringify(guest));
  function options(selected) {
    return state.teams.map(t => '<option value="' + esc(t.id) + '"' + (t.id === selected ? ' selected' : '') + '>' + esc(t.name) + '</option>').join('');
  }
  function choices(id, selected, defaultTeam = 'everyone') {
    selected ||= ['team:'+defaultTeam];
    const entries = state.teams.map(t => ({id:'team:' + t.id, name:'Team: ' + t.name}))
      .concat((people.length ? people : [guest]).map(p => ({id:'user:' + p.id, name:p.name + (p.id === guest.id ? ' (jij)' : '')})));
    $(id).innerHTML = entries.map(e => '<label class="check-label"><input type="checkbox" value="' + esc(e.id) + '"' + (selected.includes(e.id) ? ' checked' : '') + '> ' + esc(e.name) + '</label>').join('');
    $(id).onchange = () => $(id).querySelector('input')?.setCustomValidity('');
  }
  function recipients(id) {
    const values = Array.from($(id).querySelectorAll('input:checked'), el => el.value);
    return values;
  }
  function refresh() {
    if (!state.teams.some(t => t.id === filter)) filter = 'everyone';
    $('teamFilter').innerHTML = options(filter);
  }
  function columns(teamId = filter) { return state.columns.filter(col => (col.teamId || 'everyone') === teamId); }
  function ensureColumns(teamId = filter) {
    if (teamId === 'everyone' || columns(teamId).length) return false;
    const source = columns('everyone');
    if (!source.length) return false;
    const mapping = new Map();
    const cloned = source.map(col => {
      const id = C.uid(); mapping.set(col.id, id);
      return {...col, id, teamId, reminder:'', recipients:['team:'+teamId]};
    });
    state.columns.push(...cloned);
    state.cards.filter(card => (card.teamId || 'everyone') === teamId && mapping.has(card.column)).forEach(card => C.move(card, mapping.get(card.column)));
    save();
    return true;
  }
  function sourceLabel(source) {
    if (source === 'me') return 'Mijn projecten';
    const [kind,id] = source.split(':');
    const item = kind === 'team' ? state.teams.find(t=>t.id===id) : (people.length?people:[guest]).find(p=>p.id===id);
    return kind === 'team' ? 'Team: ' + (item?.name || 'Onbekend') : (item?.name || 'Voormalig lid');
  }
  function sourceColor(source) {
    if (source === 'me') return C.color(guest.color,guest.id);
    const [kind,id] = source.split(':');
    return kind === 'team' ? C.color('',id) : C.color((people.find(p=>p.id===id)||{}).color,id);
  }
  function sourceCards(source) {
    if (source === 'me') return state.cards.filter(card => (card.assignees || []).includes(guest.id));
    const [kind,id] = source.split(':');
    if (kind === 'person') return state.cards.filter(card => (card.assignees || []).includes(id));
    const memberIds = new Set((people.length?people:[guest]).filter(person => (person.teams || []).includes(id)).map(person => person.id));
    return state.cards.filter(card => card.teamId === id || (card.assignees || []).some(member => memberIds.has(member)));
  }
  function memberships() {
    $('myTeams').innerHTML = '<p>Mijn teams</p>' + state.teams.map(t =>
      '<label class="check-label"><input type="checkbox" value="' + esc(t.id) + '"' +
      (t.id === 'everyone' ? ' checked disabled' : (guest.teams || []).includes(t.id) ? ' checked' : '') + '> ' + esc(t.name) + '</label>').join('');
  }
  function teamList() {
    $('teamList').innerHTML = state.teams.map(t => '<div class="team-edit"><input aria-label="Teamnaam" maxlength="60" data-team-name="' + esc(t.id) + '" value="' + esc(t.name) + '"' + (t.id === 'everyone' ? ' disabled' : '') + '>' +
      (t.id === 'everyone' ? '<small>Iedere deelnemer</small>' : '<button data-rename-team="' + esc(t.id) + '">Naam opslaan</button><button data-duplicate-team="' + esc(t.id) + '">Bord dupliceren</button><button class="danger" data-delete-team="' + esc(t.id) + '">Team verwijderen</button>') + '</div>').join('');
  }
  function duplicateTeam(id) {
    const source=state.teams.find(t=>t.id===id); if (!source) return;
    let name=source.name+' kopie',n=2;
    while(state.teams.some(team=>team.name.toLowerCase()===name.toLowerCase())) name=source.name+' kopie '+n++;
    const teamId=C.uid(), mapping=new Map();
    const replace=list=>[...(list||['team:'+id])].map(value=>value==='team:'+id?'team:'+teamId:value);
    const copiedColumns=columns(id).map(column=>{const newId=C.uid();mapping.set(column.id,newId);return {...column,id:newId,teamId,recipients:replace(column.recipients),reminder:column.reminder||''};});
    if (!copiedColumns.length) return toast('Dit team heeft nog geen kolommen om te dupliceren.');
    const copiedCards=state.cards.filter(card=>(card.teamId||'everyone')===id).map(card=>{
      const copy={...card,id:C.uid(),teamId,column:mapping.get(card.column)||copiedColumns[0].id,enteredAt:Date.now(),dueRecipients:replace(card.dueRecipients),timerRecipients:replace(card.timerRecipients)};
      delete copy.dueSentKey; delete copy.timerSentKey; delete copy.columnSentKey; return copy;
    });
    state.teams.push({id:teamId,name}); state.columns.push(...copiedColumns); state.cards.push(...copiedCards);
    save(); render(); teamList(); toast('Bord gedupliceerd als “'+name+'”.');
  }
  function removeTeam(id) {
    const team=state.teams.find(t=>t.id===id);
    if (!team || id==='everyone') return;
    const teamColumns=new Set(columns(id).map(column=>column.id));
    const projects=state.cards.filter(card=>(card.teamId||'everyone')===id);
    askDelete('Team “'+team.name+'” verwijderen? De '+teamColumns.size+' eigen kolom(men) verdwijnen uit het actieve bord. '+projects.length+' project(en) gaan naar Archief, niet naar Iedereen. Je kunt ze één jaar terugzien in Archief.',()=>{
      const replaceRecipients=list=>[...new Set((list||['team:everyone']).map(value=>value==='team:'+id?'team:everyone':value))];
      const archivedAt=Date.now(); state.archive ||= [];
      projects.forEach(card=>state.archive.push({id:C.uid(),archivedAt,teamName:team.name,columnName:state.columns.find(column=>column.id===card.column)?.name||'Voormalige kolom',card:{...card}}));
      state.cards=state.cards.filter(card=>(card.teamId||'everyone')!==id);
      state.cards.forEach(card=>{
        card.dueRecipients=replaceRecipients(card.dueRecipients); card.timerRecipients=replaceRecipients(card.timerRecipients);
      });
      state.columns.forEach(column=>column.recipients=replaceRecipients(column.recipients));
      state.columns=state.columns.filter(column=>(column.teamId||'everyone')!==id);
      state.teams=state.teams.filter(item=>item.id!==id);
      guest.teams=(guest.teams||[]).filter(teamId=>teamId!==id); persistGuest();
      people.forEach(person=>person.teams=(person.teams||[]).filter(teamId=>teamId!==id));
      if (filter===id) filter='everyone';
      $('teamsDialog').close();
    },3);
  }
  window.Teams = {
    me: () => guest,
    people: () => people.length ? people : [guest],
    setPeople(me, members) { guest = me; people = members; persistGuest(); refresh(); },
    refresh, recipients,
    cardStyle: card => { const first=assigned(card)[0]; return first?'--owner-color:'+C.color(first.color,first.id)+';background:color-mix(in srgb,'+C.color(first.color,first.id)+' 12%,white);border-left:3px solid '+C.color(first.color,first.id):''; },
    cardPeople: card => '<span class="card-people">'+assigned(card).map(personChip).join('')+'</span>',
    validate(ids) {
      for (const id of ids) {
        const input = $(id).querySelector('input');
        input?.setCustomValidity(recipients(id).length ? '' : 'Kies minstens één team of persoon.');
        if (input && !input.reportValidity()) return false;
      }
      return true;
    },
    activeTeam: () => filter,
    columns,
    ensureColumns,
    sourceLabel, sourceColor, sourceCards,
    matches: card => (!onlyMine||(card.assignees||[]).includes(guest.id)) && (card.teamId || 'everyone') === filter,
    openCard(card) {
      $('cardTeam').innerHTML = options(card.teamId || 'everyone');
      $('cardTeam').onchange = () => {
        ensureColumns($('cardTeam').value);
        window.PlanboardUI?.renderMoveColumns($('cardTeam').value);
      };
      const ids=card.assignees||[];
      const members=(people.length?people:[guest]).concat(ids.filter(id=>!people.some(p=>p.id===id)&&id!==guest.id).map(id=>({id,name:'Voormalig lid'})));
      $('cardAssignees').innerHTML=members.map(p=>'<label class="check-label"><input type="checkbox" value="'+esc(p.id)+'"'+(ids.includes(p.id)?' checked':'')+'>'+personChip(p)+'</label>').join('');
      const count=()=>{ $('assignmentCount').textContent=recipients('cardAssignees').length+' geselecteerd'; };
      $('cardAssignees').onchange=count; count();
      choices('dueRecipients', card.dueRecipients, card.teamId || 'everyone');
      choices('timerRecipients', card.timerRecipients, card.teamId || 'everyone');
    },
    cardFields: () => ({
      teamId: $('cardTeam').value,
      assignees: recipients('cardAssignees'),
      dueRecipients: recipients('dueRecipients'), timerRecipients: recipients('timerRecipients'),
      dueEpoch: $('dueDate').value ? C.dueTime($('dueDate').value, Number($('alertDays').value)) : null,
      timerEpoch: $('timerAt').value ? new Date($('timerAt').value).getTime() : null
    }),
    openColumn: col => choices('columnRecipients', col.recipients, col.teamId || 'everyone'),
    openProfile() {
      $('guestName').value = guest.name;
      $('guestColor').value = C.color(guest.color,guest.id);
      memberships();
      $('workspaceCodeField').hidden = !!window.Shared?.enabled;
      $('importLocal').hidden = !window.Shared?.enabled;
      $('adminButton').hidden = !window.Shared?.adminReady;
      $('connectionStatus').textContent = window.Shared?.enabled ? 'Verbonden met het gedeelde bord.' : 'Lokaal profiel. Voor gedeeld gebruik moet de Cloudflare-database gekoppeld zijn.';
      show('profileDialog');
    }
  };
  $('teamFilter').onchange = () => { filter = $('teamFilter').value; if (ensureColumns(filter)) toast('Dit team heeft nu een eigen kopie van de kolommen als startpunt. Verdere wijzigingen blijven alleen bij dit team.'); render(); };
  $('onlyMine').onchange = () => { onlyMine=$('onlyMine').checked; render(); };
  $('profileButton').onclick = () => window.Teams.openProfile();
  $('teamsButton').onclick = () => { teamList(); show('teamsDialog'); };
  $('addTeamForm').onsubmit = e => {
    e.preventDefault();
    const name = $('newTeamName').value.trim();
    if (!name) return;
    if (state.teams.some(t => t.name.toLowerCase() === name.toLowerCase())) return toast('Die teamnaam bestaat al.');
    state.teams.push({id:C.uid(),name});
    $('newTeamName').value = '';
    save(); render(); teamList();
  };
  $('teamList').onclick = e => {
    const button = e.target.closest('[data-rename-team]'), remove=e.target.closest('[data-delete-team]'), duplicate=e.target.closest('[data-duplicate-team]');
    if (remove) return removeTeam(remove.dataset.deleteTeam);
    if (duplicate) return duplicateTeam(duplicate.dataset.duplicateTeam);
    if (!button) return;
    const id = button.dataset.renameTeam;
    const input = Array.from($('teamList').querySelectorAll('[data-team-name]')).find(el => el.dataset.teamName === id);
    const name = input.value.trim();
    if (!name || id === 'everyone') return;
    if (state.teams.some(t => t.id !== id && t.name.toLowerCase() === name.toLowerCase())) return toast('Die teamnaam bestaat al.');
    state.teams.find(t => t.id === id).name = name;
    save(); render(); toast('Teamnaam opgeslagen.');
  };
  $('profileForm').onsubmit = async e => {
    e.preventDefault();
    const name = $('guestName').value.trim();
    if (!name) return;
    const teams = Array.from($('myTeams').querySelectorAll('input:checked'), el => el.value).filter(id => id !== 'everyone');
    try {
      if (window.Shared?.available || window.Shared?.enabled) {
        await window.Shared.profile({name,teams,color:$('guestColor').value,code:$('workspaceCode').value});
      } else {
        guest.name = name; guest.teams = teams; guest.color=$('guestColor').value; persistGuest(); render();
        toast('Gastprofiel lokaal opgeslagen. Gedeeld gebruik is nog niet geactiveerd.');
      }
      $('workspaceCode').value = '';
      $('profileDialog').close();
    } catch (error) { $('connectionStatus').textContent = error.message; }
  };
  refresh();
  // app.js loads first; render once more now that team/person information is available.
  render();
})();
