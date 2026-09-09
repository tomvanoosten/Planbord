const enc = new TextEncoder();
export function b64(bytes) {
  return btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/=/g,'').replace(/\+/g,'-').replace(/\//g,'_');
}
export function validEndpoint(value) {
  try {
    const u = new URL(value);
    return u.protocol === 'https:' && !u.username && !u.password && !u.port && (
      u.hostname === 'fcm.googleapis.com' || u.hostname === 'updates.push.services.mozilla.com' ||
      u.hostname.endsWith('.push.services.mozilla.com') || u.hostname.endsWith('.notify.windows.com') ||
      u.hostname === 'web.push.apple.com');
  } catch { return false; }
}
export async function authorization(endpoint, env) {
  const head = b64(enc.encode(JSON.stringify({typ:'JWT',alg:'ES256'})));
  const payload = b64(enc.encode(JSON.stringify({aud:new URL(endpoint).origin,
    exp:Math.floor(Date.now()/1000)+3600,sub:env.PUSH_SUBJECT})));
  const jwk = JSON.parse(env.VAPID_PRIVATE_JWK);
  const key = await crypto.subtle.importKey('jwk',jwk,{name:'ECDSA',namedCurve:'P-256'},false,['sign']);
  const sig = await crypto.subtle.sign({name:'ECDSA',hash:'SHA-256'},key,enc.encode(head+'.'+payload));
  return 'vapid t='+head+'.'+payload+'.'+b64(sig)+', k='+env.VAPID_PUBLIC_KEY;
}
// Empty Web Push payload: the service worker fetches the private inbox using
// its same-origin HttpOnly session cookie. No project content goes to the push service.
export async function sendPush(endpoint,env) {
  if (!validEndpoint(endpoint)) throw new Error('Unsupported push endpoint');
  return fetch(endpoint,{method:'POST',redirect:'error',headers:{
    Authorization:await authorization(endpoint,env),TTL:'3600',Urgency:'normal'
  }});
}
