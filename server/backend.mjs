import '../board-core.js';
import {validEndpoint,sendPush} from './push.mjs';
const C = globalThis.BoardCore;
const json = (data,status=200,headers={}) => new Response(JSON.stringify(data),{status,headers:{
  'Content-Type':'application/json','Cache-Control':'no-store',...headers}});
const error = (message,status=400) => Object.assign(new Error(message),{status});
const hash = async s => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(s))),b=>b.toString(16).padStart(2,'0')).join('');
const token = () => Array.from(crypto.getRandomValues(new Uint8Array(32)),b=>b.toString(16).padStart(2,'0')).join('');
const memberView = m => ({id:m.id,name:m.name,teams:JSON.parse(m.teams)});
async function row(env) {
  let r = await env.DB.prepare('SELECT * FROM board WHERE id=1').first();
  if (!r) {
    const s = C.normalize(C.seed()); s.cards=[]; s.notifications=[];
    await env.DB.prepare('INSERT OR IGNORE INTO board(id,data) VALUES(1,?)').bind(JSON.stringify(s)).run();
    r = await env.DB.prepare('SELECT * FROM board WHERE id=1').first();
  }
  return r;
}
async function auth(req,env) {
  const value = (req.headers.get('Cookie') || '').match(/(?:^|;\s*)pb_session=([a-f0-9]{64})(?:;|$)/)?.[1];
  if (!value) throw error('Verbind eerst je gastprofiel.',401);
  const m = await env.DB.prepare('SELECT * FROM members WHERE token_hash=? AND expires>?').bind(await hash(value),Date.now()).first();
  if (!m) throw error('Je gastprofiel is verlopen. Verbind opnieuw.',401);
  return m;
}
async function body(req) {
  if (!req.headers.get('Content-Type')?.includes('application/json')) throw error('JSON verwacht.',415);
  const raw = await req.text();
  if (raw.length > 1000000) throw error('Bord is te groot.',413);
  try { return JSON.parse(raw); } catch { throw error('Ongeldige gegevens.'); }
}
const cleanName = (s,max=200) => {
  if (typeof s !== 'string' || !s.trim() || s.length > max) throw error('Ongeldige naam.');
  return s.trim();
};
function validBoard(input,old,members) {
  const s = C.normalize(input);
  if (s.cards.length>1500 || s.columns.length>80 || s.teams.length>100) throw error('Te veel projecten, kolommen of teams.');
  const unique = list => new Set(list.map(x=>x.id)).size === list.length;
  if (!unique(s.columns)||!unique(s.cards)||!unique(s.teams)) throw error('Dubbele identificatie.');
  s.teams = s.teams.map(t=>({id:String(t.id),name:t.id==='everyone'?'Iedereen':cleanName(t.name,60)}));
  const recipientSet = new Set([...s.teams.map(t=>'team:'+t.id),...members.map(m=>'user:'+m.id)]);
  const recipients = a => {
    a ||= ['team:everyone'];
    if (!Array.isArray(a) || !a.length || a.length>200 || a.some(x=>!recipientSet.has(x))) throw error('Ongeldige ontvangers.');
    return [...new Set(a)];
  };
  s.columns = s.columns.map(col=>({id:String(col.id),name:cleanName(col.name,100),
    reminder:col.reminder==='' ? '' : Number(col.reminder || 0), recipients:recipients(col.recipients)}));
  if (s.columns.some(c=>c.reminder!==''&&(!Number.isInteger(c.reminder)||c.reminder<0||c.reminder>3650))) throw error('Ongeldige kolomduur.');
  for (const [key,value] of Object.entries(s.labels)) if (!['title','comment','date','lead'].includes(key) || typeof value !== 'string' || value.length>60) throw error('Ongeldige veldnamen.');
  s.cards = s.cards.map(c => {
    if (!s.columns.some(x=>x.id===c.column)) throw error('Kolom bestaat niet.');
    if (c.comment.length>20000 || !Number.isInteger(c.alert)||c.alert<0||c.alert>3650) throw error('Ongeldige projectgegevens.');
    if (c.due && !/^\d{4}-\d{2}-\d{2}$/.test(c.due)) throw error('Ongeldige datum.');
    if (c.timerAt && !Number.isFinite(new Date(c.timerAt).getTime())) throw error('Ongeldige timer.');
    const prev = old.cards.find(x=>x.id===c.id);
    const card = {id:c.id,title:cleanName(c.title),comment:c.comment,due:c.due,alert:c.alert,
      timerAt:c.timerAt,column:c.column,teamId:c.teamId||'everyone',
      dueRecipients:recipients(c.dueRecipients),timerRecipients:recipients(c.timerRecipients),
      enteredAt:prev?.column===c.column?prev.enteredAt:Date.now(),
      dueEpoch:c.due ? Number(c.dueEpoch ?? C.dueTime(c.due,c.alert)):null,
      timerEpoch:c.timerAt?Number(c.timerEpoch ?? new Date(c.timerAt).getTime()):null};
    if (!s.teams.some(t=>t.id===card.teamId)) throw error('Projectteam bestaat niet.');
    if ((card.due&&!Number.isFinite(card.dueEpoch))||(card.timerAt&&!Number.isFinite(card.timerEpoch))) throw error('Ongeldig alarmtijdstip.');
    if (prev?.due===card.due&&prev?.alert===card.alert) card.dueSentKey=prev.dueSentKey;
    if (prev?.timerAt===card.timerAt) card.timerSentKey=prev.timerSentKey;
    if (prev?.column===card.column) card.columnSentKey=prev.columnSentKey;
    return card;
  });
  return {version:3,labels:s.labels,teams:s.teams,columns:s.columns,cards:s.cards,notifications:[]};
}
async function inbox(env,id,unread=false) {
  const rows = await env.DB.prepare('SELECT n.data,d.seen FROM notices n JOIN deliveries d ON n.id=d.notice WHERE d.member=?'+
    (unread?' AND d.seen=0':'')+' ORDER BY n.created DESC LIMIT 100').bind(id).all();
  return rows.results.map(r=>({...JSON.parse(r.data),read:!!r.seen}));
}
async function envelope(env,m) {
  const r = await row(env);
  const members = (await env.DB.prepare('SELECT * FROM members WHERE expires>?').bind(Date.now()).all()).results;
  return {state:JSON.parse(r.data),version:r.version,me:memberView(m),members:members.map(memberView),notifications:await inbox(env,m.id)};
}
export async function api(request,env,ctx={waitUntil(){}}) {
  try {
    const url = new URL(request.url);
    const path = url.pathname.replace(/^\/api\//,'');
    if (!['GET','POST','PUT'].includes(request.method)) throw error('Niet toegestaan.',405);
    if (request.method !== 'GET') {
      const origin=request.headers.get('Origin');
      if (origin!==url.origin) throw error('Ongeldige herkomst.',403);
    }
    if (path==='config'&&request.method==='GET') return json({ready:!!(env.DB&&env.WORKSPACE_CODE),publicKey:env.VAPID_PUBLIC_KEY||null});
    if (!env.DB||!env.WORKSPACE_CODE) throw error('De beheerder moet de database en uitnodigingscode nog instellen.',503);
    if (path==='join'&&request.method==='POST') {
      const b = await body(request);
      const limitKey=await hash((request.headers.get('CF-Connecting-IP')||'local')+Math.floor(Date.now()/3600000));
      await env.DB.prepare('INSERT INTO join_limits(key,count) VALUES(?,1) ON CONFLICT(key) DO UPDATE SET count=count+1').bind(limitKey).run();
      const count=await env.DB.prepare('SELECT count FROM join_limits WHERE key=?').bind(limitKey).first();
      if (count.count>20) throw error('Te veel pogingen. Probeer het later opnieuw.',429);
      if (typeof b.code!=='string' || await hash(b.code)!==await hash(env.WORKSPACE_CODE)) throw error('Uitnodigingscode klopt niet.',403);
      const name=cleanName(b.name,60),id=crypto.randomUUID(),secret=token();
      await env.DB.prepare('INSERT INTO members(id,name,teams,token_hash,expires) VALUES(?,?,?,?,?)').bind(
        id,name,'[]',await hash(secret),Date.now()+365*86400000).run();
      return json({ok:true},200,{'Set-Cookie':'pb_session='+secret+'; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=31536000'});
    }
    const m = await auth(request,env);
    if (path==='board'&&request.method==='GET') return json(await envelope(env,m));
    if (path==='board'&&request.method==='PUT') {
      const b=await body(request),r=await row(env);
      if (b.version!==r.version) throw error('Een collega heeft het bord gewijzigd.',409);
      const members=(await env.DB.prepare('SELECT id FROM members').all()).results;
      const s=validBoard(b.state,JSON.parse(r.data),members);
      const update=await env.DB.prepare('UPDATE board SET data=?,version=version+1,stamp=? WHERE id=1 AND version=?').bind(
        JSON.stringify(s),crypto.randomUUID(),b.version).run();
      if (!update.meta.changes) throw error('Een collega heeft het bord gewijzigd.',409);
      return json({version:b.version+1});
    }
    if (path==='profile'&&request.method==='PUT') {
      const b=await body(request),s=JSON.parse((await row(env)).data);
      if (!Array.isArray(b.teams) || b.teams.some(id=>!s.teams.some(t=>t.id===id))) throw error('Ongeldige teams.');
      await env.DB.prepare('UPDATE members SET name=?,teams=? WHERE id=?').bind(cleanName(b.name,60),JSON.stringify([...new Set(b.teams)]),m.id).run();
      return json({ok:true});
    }
    if (path==='read'&&request.method==='POST') {
      const b=await body(request);
      await env.DB.prepare('UPDATE deliveries SET seen=1 WHERE member=?'+(b.all?'':' AND notice=?')).bind(...(b.all?[m.id]:[m.id,b.id])).run();
      return json({ok:true});
    }
    if (path==='subscription'&&request.method==='POST') {
      const b=await body(request);
      if (!validEndpoint(b.endpoint)) throw error('Niet-ondersteunde pushdienst.');
      await env.DB.prepare('INSERT INTO subscriptions(endpoint,member) VALUES(?,?) ON CONFLICT(endpoint) DO UPDATE SET member=excluded.member').bind(b.endpoint,m.id).run();
      return json({ok:true});
    }
    if (path==='inbox'&&request.method==='GET') return json({notifications:await inbox(env,m.id,true)});
    if (path==='test'&&request.method==='POST') {
      const s=JSON.parse((await row(env)).data),card=s.cards[0];
      if(!card) throw error('Maak eerst een project.');
      const recent=await env.DB.prepare('SELECT COUNT(*) AS count FROM notices n JOIN deliveries d ON n.id=d.notice WHERE d.member=? AND n.created>?').bind(m.id,Date.now()-60000).first();
      if(recent.count>10) throw error('Wacht even voor de volgende testmelding.',429);
      const notice={id:crypto.randomUUID(),card:card.id,title:card.title,text:'Testmelding voor jouw profiel.',at:Date.now()};
      const statements=await noticeStatements(env,notice,[m.id]);
      await env.DB.batch(statements);
      ctx.waitUntil(dispatch(env));
      return json({ok:true});
    }
    throw error('Niet gevonden.',404);
  } catch(e) {
    if(!e.status) console.error('Planboard API failure',e.message);
    return json({error:e.status?e.message:'Serverfout. Controleer de Cloudflare-configuratie.'},e.status||500);
  }
}
async function noticeStatements(env,n,ids,stamp) {
  const guard=stamp?' AND EXISTS(SELECT 1 FROM board WHERE id=1 AND stamp=?)':'';
  const args=stamp?[stamp]:[];
  const statements=[env.DB.prepare('INSERT OR IGNORE INTO notices(id,data,created) SELECT ?,?,? WHERE 1=1'+guard).bind(n.id,JSON.stringify(n),n.at,...args)];
  const targets=JSON.stringify(ids);
  statements.push(env.DB.prepare('INSERT OR IGNORE INTO deliveries(notice,member) SELECT ?,value FROM json_each(?) WHERE 1=1'+guard).bind(n.id,targets,...args));
  statements.push(env.DB.prepare('INSERT OR IGNORE INTO push_jobs(notice,endpoint) SELECT ?,endpoint FROM subscriptions WHERE member IN (SELECT value FROM json_each(?))'+guard).bind(n.id,targets,...args));
  return statements;
}
export async function tick(env) {
  if(!env.DB) return;
  for(let attempt=0;attempt<1;attempt++) {
    const r=await row(env),state=C.normalize(JSON.parse(r.data));
    const events=C.collect(state,Date.now(),5);
    if(!events.length) break;
    const members=(await env.DB.prepare('SELECT * FROM members WHERE expires>?').bind(Date.now()).all()).results.map(memberView);
    const stamp=crypto.randomUUID(); state.notifications=[];
    const statements=[env.DB.prepare('UPDATE board SET data=?,version=version+1,stamp=? WHERE id=1 AND version=?').bind(JSON.stringify(state),stamp,r.version)];
    for(const n of events) statements.push(...await noticeStatements(env,n,members.filter(m=>C.receives(n,m)).map(m=>m.id),stamp));
    const results=await env.DB.batch(statements);
    if(results[0].meta.changes) break;
  }
  await dispatch(env);
}
export async function dispatch(env) {
  if(!env.VAPID_PRIVATE_JWK||!env.VAPID_PUBLIC_KEY||!env.PUSH_SUBJECT) return;
  const cutoff=Date.now();
  const jobs=(await env.DB.prepare('SELECT notice,endpoint,attempts FROM push_jobs WHERE retry_at<=? AND attempts<8 LIMIT 5').bind(cutoff).all()).results;
  for(const job of jobs) {
    // Claim a job, so two scheduled invocations do not send it simultaneously.
    const claim=await env.DB.prepare('UPDATE push_jobs SET retry_at=?,attempts=attempts+1 WHERE notice=? AND endpoint=? AND attempts=? AND retry_at<=?').bind(
      Date.now()+60000,job.notice,job.endpoint,job.attempts,Date.now()).run();
    if(!claim.meta.changes) continue;
    try {
      const response=await sendPush(job.endpoint,env);
      if(response.ok || response.status===404 || response.status===410) {
        // One wake-up fetches the whole private inbox: coalesce older jobs for this device.
        await env.DB.prepare('DELETE FROM push_jobs WHERE endpoint=? AND notice IN (SELECT id FROM notices WHERE created<=?)').bind(job.endpoint,cutoff).run();
        if(response.status===404||response.status===410) await env.DB.prepare('DELETE FROM subscriptions WHERE endpoint=?').bind(job.endpoint).run();
      } else throw new Error('Push delivery failed: '+response.status);
    } catch {
      await env.DB.prepare('UPDATE push_jobs SET retry_at=? WHERE notice=? AND endpoint=?').bind(Date.now()+Math.min(3600000,60000*2**job.attempts),job.notice,job.endpoint).run();
    }
  }
}
