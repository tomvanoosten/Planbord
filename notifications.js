'use strict';
(() => {
  let audio;
  const soundOn=()=>localStorage.getItem('planboard-sound')==='on';
  $('notificationSound').checked=soundOn();
  function unlock() {
    if(!soundOn()) return;
    const Audio=window.AudioContext||window.webkitAudioContext;
    if(!Audio) return;
    audio ||= new Audio(); audio.resume().catch(()=>{});
  }
  document.addEventListener('pointerdown',unlock);
  document.addEventListener('keydown',unlock);
  function chime() {
    if(!soundOn()||!audio||audio.state!=='running') return;
    const gain=audio.createGain(),tone=audio.createOscillator();
    gain.gain.setValueAtTime(0.0001,audio.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.12,audio.currentTime+0.03);
    gain.gain.exponentialRampToValueAtTime(0.0001,audio.currentTime+0.6);
    tone.frequency.setValueAtTime(660,audio.currentTime);tone.frequency.setValueAtTime(880,audio.currentTime+0.18);
    tone.connect(gain);gain.connect(audio.destination);tone.start();tone.stop(audio.currentTime+0.65);
  }
  $('notificationSound').onchange=()=>{localStorage.setItem('planboard-sound',$('notificationSound').checked?'on':'off');unlock();chime();};
  async function deliver(notes) {
    if(!notes.length) return;
    chime();
    if(!('Notification' in window)||Notification.permission!=='granted'||!('serviceWorker' in navigator)) return;
    try {
      const registration=await navigator.serviceWorker.getRegistration('/');
      registration?.active?.postMessage({type:'show-reminders',notes});
    } catch { /* The persistent personal inbox remains available. */ }
  }
  window.PlanboardNotifications={deliver};
})();
