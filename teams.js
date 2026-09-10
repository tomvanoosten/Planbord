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
  function choices(id, selected) {
    selected ||= ['team:everyone'];
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
  function memberships() {
    $('myTeams').innerHTML = '<p>Mijn teams</p>' + state.teams.map(t =>
      '<label class="check-label"><input type="checkbox" value="' + esc(t.id) + '"' +
      (t.id === 'everyone' ? ' checked disabled' : (guest.teams || []).includes(t.id) ? ' checked' : '') + '> ' + esc(t.name) + '</label>').join('');
  }
  function teamList() {
    $('teamList').innerHTML = state.teams.map(t => '<div class="team-edit"><input aria-label="Teamnaam" maxlength="60" data-team-name="' + esc(t.id) + '" value="' + esc(t.name) + '"' + (t.id === 'everyone' ? ' disabled' : '') + '>' +
      (t.id === 'everyone' ? '<small>Iedere deelnemer</small>' : '<button data-rename-team="' + esc(t.id) + '">Naam opslaan</button>') + '</div>').join('');
  }
  window.Teams = {
    me: () => guest,
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
    matches: card => (!onlyMine||(card.assignees||[]).includes(guest.id))&&(filter === 'everyone' || card.teamId === filter),
    openCard(card) {
      $('cardTeam').innerHTML = options(card.teamId || 'everyone');
      const ids=card.assignees||[];
      const members=(people.length?people:[guest]).concat(ids.filter(id=>!people.some(p=>p.id===id)&&id!==guest.id).map(id=>({id,name:'Voormalig lid'})));
      $('cardAssignees').innerHTML=members.map(p=>'<label class="check-label"><input type="checkbox" value="'+esc(p.id)+'"'+(ids.includes(p.id)?' checked':'')+'>'+personChip(p)+'</label>').join('');
      const count=()=>{ $('assignmentCount').textContent=recipients('cardAssignees').length+' geselecteerd'; };
      $('cardAssignees').onchange=count; count();
      choices('dueRecipients', card.dueRecipients);
      choices('timerRecipients', card.timerRecipients);
    },
    cardFields: () => ({
      teamId: $('cardTeam').value,
      assignees: recipients('cardAssignees'),
      dueRecipients: recipients('dueRecipients'), timerRecipients: recipients('timerRecipients'),
      dueEpoch: $('dueDate').value ? C.dueTime($('dueDate').value, Number($('alertDays').value)) : null,
      timerEpoch: $('timerAt').value ? new Date($('timerAt').value).getTime() : null
    }),
    openColumn: col => choices('columnRecipients', col.recipients),
    openProfile() {
      $('guestName').value = guest.name;
      $('guestColor').value = C.color(guest.color,guest.id);
      memberships();
      $('workspaceCodeField').hidden = !!window.Shared?.enabled;
      $('importLocal').hidden = !window.Shared?.enabled;
      $('connectionStatus').textContent = window.Shared?.enabled ? 'Verbonden met het gedeelde bord.' : 'Lokaal profiel. Voor gedeeld gebruik moet de Cloudflare-database gekoppeld zijn.';
      show('profileDialog');
    }
  };
  $('teamFilter').onchange = () => { filter = $('teamFilter').value; render(); };
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
    const button = e.target.closest('[data-rename-team]');
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
})();
