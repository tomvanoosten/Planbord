'use strict';
(() => {
  let enabled = false, available = false, adminReady = false, version = 0, busy = false, dirty = false, blocked = false, debounce, actionsDebounce;
  let seen = new Set();
  function showPushStatus(config) {
    const ready=!!config?.publicKey;
    $('pushStatus').textContent=ready ? 'Meldingen: controleer achtergrondstatus' : 'Meldingen: nog niet ingesteld';
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
    const fresh=[];
    for (const note of notes) {
      if (alertNew && !seen.has(note.id) && !note.read) { toast(note.title + ': ' + note.text, note.card); fresh.push(note); }
      seen.add(note.id);
    }
    state.notifications = notes;
    renderNotifications();
    window.PlanboardNotifications?.deliver(fresh);
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
    if (!enabled || busy || dirty || blocked || dragged || resizing) return;
    try {
      const data = await api('board');
      if (busy || dirty || blocked || dragged || resizing) return;
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
      if(fields.color) await api('profile',{method:'PUT',body:JSON.stringify(fields)});
    } else {
      await api('profile', {method:'PUT',body:JSON.stringify(fields)});
      const data = await api('board');
      window.Teams.setPeople(data.me,data.members);
      render();
    }
    toast('Gastprofiel verbonden met het gedeelde bord.');
  }
  async function register(fields) {
    await api('register',{method:'POST',body:JSON.stringify(fields)});
    const data=await api('board'); enabled=true; apply(data);
    if(fields.color) await api('profile',{method:'PUT',body:JSON.stringify(fields)});
    await loadActions(); toast('Account gemaakt en verbonden met het gedeelde bord.');
  }
  async function login(fields) {
    await api('login',{method:'POST',body:JSON.stringify(fields)});
    const data=await api('board'); enabled=true; apply(data); await loadActions();
    toast('Ingelogd op het gedeelde bord.');
  }
  async function setAccount(fields) {
    await api('account',{method:'PUT',body:JSON.stringify(fields)});
    toast('Gebruikersnaam en wachtwoord opgeslagen.');
  }
  async function loadActions() {
    if(!enabled) return;
    try { const data=await api('actions'); window.PlanboardActions?.set(data.items); }
    catch(error) { toast(error.message); }
  }
  function saveActions(items) {
    if(!enabled) return;
    clearTimeout(actionsDebounce); actionsDebounce=setTimeout(async()=>{
      try { await api('actions',{method:'PUT',body:JSON.stringify({items})}); }
      catch(error) { $('saveStatus').textContent='Acties nog niet gedeeld'; toast(error.message); }
    },250);
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
      let subscription = await registration.pushManager.getSubscription();
      const oldKey=subscription?.options.applicationServerKey;
      if (subscription && oldKey && (oldKey.byteLength!==key.length || new Uint8Array(oldKey).some((v,i)=>v!==key[i]))) {
        await subscription.unsubscribe();subscription=null;
      }
      subscription ||= await registration.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:key});
      await api('subscription', {method:'POST',body:JSON.stringify(subscription.toJSON())});
      $('desktopNotifications').textContent='Meldingen staan aan op dit apparaat';
      toast('Achtergrondmeldingen ingeschakeld voor jouw profiel.');
      await refreshPushStatus();
    } catch (error) { toast(error.message); }
  }
  window.Shared = {
    get enabled(){return enabled;}, get available(){return available;}, get adminReady(){return adminReady;}, profile, register, login, setAccount, loadActions, saveActions, enablePush,
    async adminLogin(code) { return api('admin/login',{method:'POST',body:JSON.stringify({code})}); },
    async members() { return api('admin/members'); },
    async deleteMember(id) { return api('admin/members/'+encodeURIComponent(id),{method:'DELETE'}); },
    save() {
      if (!enabled) return;
      dirty = true;
      localStorage.setItem('planboard-unsynced', JSON.stringify(state));
      clearTimeout(debounce); debounce = setTimeout(flush,250);
      $('saveStatus').textContent = 'Delen…';
    }
  };
  async function refreshPushStatus() {
    if(!enabled) { $('deviceStatus').textContent='Verbind eerst je gastprofiel.'; return; }
    try {
      const supported='Notification' in window && 'PushManager' in window && 'serviceWorker' in navigator;
      const registration=supported?await navigator.serviceWorker.getRegistration('/'):null;
      const sub=await registration?.pushManager.getSubscription();
      const status=await api('notification-status'+(sub?'?endpoint='+encodeURIComponent(sub.endpoint):''));
      const active=supported&&Notification.permission==='granted'&&status.registered;
      $('desktopNotifications').textContent=active?'Meldingen aan op dit apparaat':'Meldingen inschakelen';
      $('deviceStatus').textContent=!supported?'Deze browser ondersteunt geen systeemmeldingen. Open het bord in Edge, Chrome of Firefox.':Notification.permission==='denied'?'Meldingen geblokkeerd: sta ze toe via de site-instellingen van je browser.':active?'Meldingen aan op dit apparaat.':'Meldingen op dit apparaat staan nog niet aan.';
      if(status.deliveryProblems) $('deviceStatus').textContent+=' De pushdienst heeft '+status.deliveryProblems+' melding(en) nog niet kunnen bezorgen. Bekijk je inbox; controleer de verbinding en schrijf dit apparaat zo nodig opnieuw in.';
      $('schedulerStatus').textContent=!status.publicKey?'Het bord is nog niet ingericht voor pushmeldingen.':status.schedulerActive?'Achtergrondherinneringen actief. Laatste controle: '+new Date(status.schedulerAt).toLocaleTimeString('nl-NL')+'.':status.schedulerAt?'Achtergrondcontrole is onderbroken. Laatste controle: '+new Date(status.schedulerAt).toLocaleString('nl-NL')+'.':'Achtergrondcontrole nog niet actief. Zolang het bord open is worden herinneringen hier wel gecontroleerd.';
      $('pushStatus').textContent=!status.publicKey?'Meldingen: nog niet ingesteld':status.schedulerActive?'Achtergrondherinneringen actief':'Achtergrondcontrole niet actief';
    } catch(error) { $('schedulerStatus').textContent='Status niet beschikbaar: '+error.message; }
  }
  $('notificationSettings').onclick=()=>{show('pushDialog');refreshPushStatus();};
  $('refreshPushStatus').onclick=refreshPushStatus;
  $('enablePushHere').onclick=enablePush;
  $('backupBoard').onclick=async()=>{
    try {
      const data=enabled?await api('backup'):{format:'planboard-backup',exportedAt:new Date().toISOString(),state};
      const link=document.createElement('a');link.href=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'}));
      link.download='planboard-reservekopie-'+new Date().toISOString().slice(0,10)+'.json';link.click();setTimeout(()=>URL.revokeObjectURL(link.href),1000);
    } catch(error){toast(error.message);}
  };
  $('backgroundSetup').onclick = async () => {
    if (!enabled) return toast('Verbind eerst je gastprofiel.');
    try {
      const config=await api('push-setup',{method:'POST',body:'{}'});
      showPushStatus(config);
      toast('Pushmeldingen zijn ingericht. Controleer nu de achtergrondtaak via Meldingsinstellingen.');
      await refreshPushStatus();
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
      const config = await api('config'); available = config.ready; adminReady=!!config.adminReady; showPushStatus(config);
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
      loadActions();
      if('serviceWorker' in navigator && 'Notification' in window && Notification.permission==='granted') navigator.serviceWorker.register('/sw.js').catch(()=>{});
      refreshPushStatus();
      const cardId = new URL(location.href).searchParams.get('card');
      if (cardId) openCard(cardId);
    } catch(error) {
      if(error.status === 401) $('saveStatus').textContent='Lokaal · verbind je gastprofiel voor het gedeelde bord';
    }
  }
  init();
  setInterval(poll,5000);
  setInterval(()=>{if(enabled&&!document.hidden)refreshPushStatus();},60000);
})();
