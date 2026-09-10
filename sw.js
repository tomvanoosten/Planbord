/* Background notification delivery; never cache API responses or guest cookies. */
self.addEventListener('install',event=>event.waitUntil(self.skipWaiting()));
self.addEventListener('activate',event=>event.waitUntil(self.clients.claim()));
async function ledger() {
  return new Promise((resolve,reject)=>{
    const request=indexedDB.open('planboard-push',1);
    request.onupgradeneeded=()=>request.result.createObjectStore('shown');
    request.onsuccess=()=>resolve(request.result);
    request.onerror=()=>reject(request.error);
  });
}
async function wasShown(db,id) {
  return new Promise((resolve,reject)=>{
    const r=db.transaction('shown').objectStore('shown').get(id);
    r.onsuccess=()=>resolve(!!r.result);r.onerror=()=>reject(r.error);
  });
}
async function remember(db,id) {
  return new Promise((resolve,reject)=>{
    const tx=db.transaction('shown','readwrite');
    tx.objectStore('shown').put(true,id);
    tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);
  });
}
// The same reminder can arrive via an open tab and push at once. Claim it in
// a single read/write transaction, shared by every tab on this device.
async function claim(db,id) {
  return new Promise((resolve,reject)=>{
    const tx=db.transaction('shown','readwrite'),store=tx.objectStore('shown');
    let fresh=false;const get=store.get(id);
    get.onsuccess=()=>{if(!get.result){fresh=true;store.put(true,id);}};
    tx.oncomplete=()=>resolve(fresh);tx.onerror=()=>reject(tx.error);
  });
}
async function showNotes(notes) {
  const db=await ledger();let shown=0;
  try {
    for(const note of notes.slice(0,100)) {
      if(!note.id||!note.title||!await claim(db,note.id)) continue;
      try {
        await self.registration.showNotification(note.title,{body:note.text,tag:note.id,silent:false,requireInteraction:false,data:{card:note.card}});
        shown++;
      } catch(error) {
        const tx=db.transaction('shown','readwrite');tx.objectStore('shown').delete(note.id);
        throw error;
      }
    }
  } finally {db.close();}
  return shown;
}
self.addEventListener('message',event=>{
  if(event.data?.type==='show-reminders'&&event.source?.url&&new URL(event.source.url).origin===self.location.origin)
    event.waitUntil(showNotes(event.data.notes||[]));
});
self.addEventListener('push',event=>{
  event.waitUntil((async()=>{
    try {
      const response=await fetch('/api/inbox',{credentials:'include',cache:'no-store'});
      if(!response.ok) throw new Error('Session unavailable');
      const {notifications}=await response.json();
      const windows=await self.clients.matchAll({type:'window',includeUncontrolled:true});
      await showNotes(notifications);
      windows.forEach(client=>client.postMessage({refresh:true}));
    } catch {
      await self.registration.showNotification('Planboard',{body:'Er is een nieuwe herinnering. Open het bord om je meldingen te bekijken.',tag:'planboard-open'});
    }
  })());
});
self.addEventListener('notificationclick',event=>{
  event.notification.close();
  event.waitUntil((async()=>{
    const card=event.notification.data?.card;
    const windows=await self.clients.matchAll({type:'window',includeUncontrolled:true});
    const existing=windows.find(c=>new URL(c.url).origin===self.location.origin);
    if(existing) { await existing.focus(); existing.postMessage({card}); }
    else await self.clients.openWindow('/'+(card?'?card='+encodeURIComponent(card):''));
  })());
});
