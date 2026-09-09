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
self.addEventListener('push',event=>{
  event.waitUntil((async()=>{
    try {
      const response=await fetch('/api/inbox',{credentials:'include',cache:'no-store'});
      if(!response.ok) throw new Error('Session unavailable');
      const {notifications}=await response.json();
      const windows=await self.clients.matchAll({type:'window',includeUncontrolled:true});
      const db=await ledger();
      const latest=[];
      for(const note of notifications) if(!await wasShown(db,note.id)) latest.push(note);
      if(!latest.length) {
        await self.registration.showNotification('Planboard',{body:'Je meldingen zijn bijgewerkt.',tag:'planboard-update',data:{}});
        db.close();
        return;
      }
      for(const n of latest) {
        await self.registration.showNotification(n.title,{body:n.text,tag:n.id,renotify:false,requireInteraction:false,data:{card:n.card}});
        await remember(db,n.id);
      }
      // Best effort only: browsers may terminate a service worker before a timer.
      setTimeout(async()=>{
        const shown=await self.registration.getNotifications();
        shown.filter(n=>latest.some(x=>x.id===n.tag)).forEach(n=>n.close());
      },5000);
      windows.forEach(client=>client.postMessage({refresh:true}));
      db.close();
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
