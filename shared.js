'use strict';
(() => {
  let enabled = false, available = false, version = 0, busy = false, dirty = false, blocked = false, debounce;
  let seen = new Set();
  function showPushStatus(config) {
    const ready=!!config?.publicKey;
    $('pushStatus').textContent=ready ? 'Achtergrondherinneringen: sleutels ingesteld' : 'Achtergrondherinneringen: nog niet ingesteld';
    $('backgroundSetup').hidden=ready;
  }
  async function api(path, options = {}) {
    const response = await fetch('/api/' + path, {credentials:'same-origin', ...options,
      headers:{'Content-Type':'application/json', ...options.headers}});
    let data;
    try { data = await response.json(); } catch { throw new Error('De gedeelde server is nog niet geïnstalleerd.'); }
    if (!response.ok) {
      const err = new Error(data.error || 'Verbinding mislukt.');
      err.status = response.status;
      throw err;
    }
    return data;
  }
  function draft() {
    const data = {...state, notifications:[]};
    return JSON.parse(JSON.stringify(data));
  }
  function cache() { localStorage.setItem(KEY, JSON.stringify(state)); }
  function displayNotes(notes, alertNew = true) {
    for (const note of notes) {
      if (alertNew && !seen.has(note.id) && !note.read) toast(note.title + ': ' + note.text, note.card);
      seen.add(note.id);
    }
    state.notifications = notes;
    renderNotifications();
  }
  function apply(data, alertNew = false) {
    state = C.normalize(data.state);
    state.notifications = data.notifications;
    version = data.version;
    window.Teams.setPeople(data.me, data.members);
    displayNotes(data.notifications, alertNew);
    cache(); render();
    $('saveStatus').textContent = 'Gedeeld bord · bijgewerkt';
  }
  function fail(error) {
    blocked = true;
    localStorage.setItem('planboard-unsynced', JSON.stringify(state));
    $('saveStatus').textContent = 'Wijzigingen nog niet gedeeld';
    $('syncError').textContent = error.status === 409 ?
      'Een collega heeft het bord intussen gewijzigd. Je wijzigingen zijn niet overschreven of verzonden.' : error.message;
    if (!$('syncConflict').open) show('syncConflict');
    $('retrySync').hidden = error.status === 409;
  }
  async function flush() {
    if (!enabled || busy || blocked || !dirty) return;
    busy = true; dirty = false;
    try {
      const data = await api('board', {method:'PUT',body:JSON.stringify({version,state:draft()})});
      version = data.version;
      $('saveStatus').textContent = 'Gedeeld opgeslagen';
      localStorage.removeItem('planboard-unsynced');
    } catch (error) { dirty = true; fail(error); }
    finally { busy = false; if (dirty && !blocked) flush(); }
  }
  async function poll() {
    if (!enabled || busy || dirty || blocked || document.hidden || dragged) return;
    try {
      const data = await api('board');
      if (busy || dirty || blocked || dragged) return;
      if (document.querySelector('dialog[open]')) { displayNotes(data.notifications); return; }
      apply(data, true);
    } catch { $('saveStatus').textContent = 'Verbinding onderbroken · opnieuw proberen…'; }
  }
  async function profile(fields) {
    if (!enabled) {
      await api('join', {method:'POST',body:JSON.stringify(fields)});
      localStorage.setItem('planboard-before-shared', JSON.stringify(state));
      const data = await api('board');
      enabled = true; apply(data);
    } else {
      await api('profile', {method:'PUT',body:JSON.stringify(fields)});
      const data = await api('board');
      window.Teams.setPeople(data.me,data.members);
    }
    toast('Gastprofiel verbonden met het gedeelde bord.');
  }
  async function enablePush() {
    try {
      if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window))
        return toast('Deze browser ondersteunt geen achtergrondmeldingen.');
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') return toast('Sta meldingen toe in je browserinstellingen.');
      const config = await api('config');
      showPushStatus(config);
      if (!config.publicKey) return toast('Achtergrondherinneringen zijn nog niet ingesteld.');
      const registration = await navigator.serviceWorker.register('/sw.js');
      await navigator.serviceWorker.ready;
      const raw = atob(config.publicKey.replace(/-/g,'+').replace(/_/g,'/'));
      const key = Uint8Array.from(raw, c => c.charCodeAt(0));
      const subscription = await registration.pushManager.getSubscription() ||
        await registration.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:key});
      await api('subscription', {method:'POST',body:JSON.stringify(subscription.toJSON())});
      $('desktopNotifications').textContent='Meldingen staan aan op dit apparaat';
      toast('Achtergrondmeldingen ingeschakeld voor jouw profiel.');
    } catch (error) { toast(error.message); }
  }
  window.Shared = {
    get enabled(){return enabled;}, get available(){return available;}, profile, enablePush,
    save() {
      if (!enabled) return;
      dirty = true;
      localStorage.setItem('planboard-unsynced', JSON.stringify(state));
      clearTimeout(debounce); debounce = setTimeout(flush,250);
      $('saveStatus').textContent = 'Delen…';
    }
  };
  $('backgroundSetup').onclick = async () => {
    if (!enabled) return toast('Verbind eerst je gastprofiel.');
    try {
      const config=await api('push-setup',{method:'POST',body:'{}'});
      showPushStatus(config);
      toast('Achtergrondherinneringen zijn ingesteld. Iedere gebruiker kan nu meldingen op zijn eigen apparaat inschakelen.');
    } catch(error) { toast(error.message); }
  };
  $('retrySync').onclick = () => { blocked = false; $('syncConflict').close(); flush(); };
  $('downloadDraft').onclick = () => {
    const link = document.createElement('a');
    link.href = URL.createObjectURL(new Blob([JSON.stringify(state,null,2)],{type:'application/json'}));
    link.download = 'planboard-reservekopie.json'; link.click();
    setTimeout(() => URL.revokeObjectURL(link.href),1000);
  };
  $('reloadShared').onclick = async () => {
    try {
      const data = await api('board');
      localStorage.setItem('planboard-conflict-backup', JSON.stringify(state));
      dirty = false; blocked = false; localStorage.removeItem('planboard-unsynced');
      apply(data); $('syncConflict').close();
    } catch (error) { $('syncError').textContent = error.message; }
  };
  $('importLocal').onclick = async () => {
    if (!enabled) return;
    const raw = localStorage.getItem('planboard-before-shared');
    if (!raw) return toast('Er is geen lokaal bord om over te nemen.');
    const previous = C.normalize(JSON.parse(raw));
    askDelete('De lokale kolommen en projecten toevoegen aan dit gedeelde bord? Bestaande gedeelde projecten blijven staan.', () => {
      const mapping = new Map();
      for (const col of previous.columns) {
        const id = C.uid(); mapping.set(col.id,id);
        state.columns.push({...col,id,recipients:['team:everyone']});
      }
      for (const card of previous.cards) state.cards.push({...card,id:C.uid(),column:mapping.get(card.column),
        teamId:'everyone',dueRecipients:['team:everyone'],timerRecipients:['team:everyone'],
        dueEpoch:card.due?C.dueTime(card.due,card.alert):null,
        timerEpoch:card.timerAt?new Date(card.timerAt).getTime():null});
      localStorage.removeItem('planboard-before-shared');
    });
    $('confirmHeading').textContent = 'Lokaal bord toevoegen?';
    $('confirmDelete').textContent = 'Toevoegen';
  };
  // Personal read state lives on the server, never in the shared board document.
  $('markRead').onclick = async () => {
    if (!enabled) { state.notifications.forEach(n=>{n.read=true;}); save(); renderNotifications(); return; }
    try { await api('read',{method:'POST',body:JSON.stringify({all:true})}); state.notifications.forEach(n=>{n.read=true;}); renderNotifications(); }
    catch(error){toast(error.message);}
  };
  const oldClick = $('notificationList').onclick;
  $('notificationList').onclick = async event => {
    if (!enabled) return oldClick(event);
    const button = event.target.closest('[data-notice]');
    if (!button) return;
    const note = state.notifications[Number(button.dataset.notice)];
    try {
      await api('read',{method:'POST',body:JSON.stringify({id:note.id})});
      note.read=true; renderNotifications(); $('notificationDialog').close(); openCard(note.card);
    } catch(error){toast(error.message);}
  };
  const oldTest = $('testNotification').onclick;
  $('testNotification').onclick = async () => {
    if (!enabled) return oldTest();
    try { await api('test',{method:'POST',body:'{}'}); await poll(); toast('Testmelding voor jouw profiel verstuurd.'); }
    catch(error){toast(error.message);}
  };
  if ('serviceWorker' in navigator) navigator.serviceWorker.addEventListener('message', e => {
    if(e.data?.refresh) poll();
    if(e.data?.card) openCard(e.data.card);
  });
  async function init() {
    if (!location.protocol.startsWith('http')) return;
    try {
      const config = await api('config'); available = config.ready; showPushStatus(config);
      if (!available) return;
      const data = await api('board');
      // Keep a recoverable draft after refresh, including a network failure.
      const unsynced = localStorage.getItem('planboard-unsynced');
      enabled = true;
      if (unsynced) {
        state=C.normalize(JSON.parse(unsynced)); version=data.version;
        window.Teams.setPeople(data.me,data.members); dirty=true;
        fail({status:409}); render();
      } else apply(data);
      const cardId = new URL(location.href).searchParams.get('card');
      if (cardId) openCard(cardId);
    } catch(error) {
      if(error.status === 401) $('saveStatus').textContent='Lokaal · verbind je gastprofiel voor het gedeelde bord';
    }
  }
  init();
  setInterval(poll,5000);
})();
