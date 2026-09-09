import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {api,tick} from './backend.mjs';
import {validEndpoint,authorization} from './push.mjs';
const origin='https://planbord-285.pages.dev';
function setup() {
  const db=new DatabaseSync(':memory:');
  const schema=readFileSync(new URL('./schema.sql',import.meta.url),'utf8');
  db.exec(schema);db.exec(schema);
  function statement(sql,args=[]) {
    return {
      bind(...values){return statement(sql,values);},
      async first(){return db.prepare(sql).get(...args)||null;},
      async all(){return {results:db.prepare(sql).all(...args)};},
      async run(){const r=db.prepare(sql).run(...args);return {meta:{changes:r.changes}};}
    };
  }
  const env={WORKSPACE_CODE:'test-invite',DB:{prepare:statement,async batch(queries){
    db.exec('BEGIN');try {const results=[];for(const q of queries) results.push(await q.run());db.exec('COMMIT');return results;}
    catch(e){db.exec('ROLLBACK');throw e;}
  }}};
  async function request(path,method='GET',body,cookie,requestOrigin=origin) {
    const headers={Origin:requestOrigin,'Content-Type':'application/json'};
    if(cookie) headers.Cookie=cookie;
    const r=await api(new Request(origin+'/api/'+path,{method,headers,body:body===undefined?undefined:JSON.stringify(body)}),env);
    return {status:r.status,body:await r.json(),cookie:r.headers.get('set-cookie')?.split(';')[0]};
  }
  async function guest(name) {
    const r=await request('join','POST',{name,code:'test-invite'});
    assert.equal(r.status,200);
    const data=await request('board','GET',undefined,r.cookie);
    return {cookie:r.cookie,...data.body};
  }
  return {db,env,request,guest};
}
test('shared data requires invitation and unforgeable session; cross-origin changes denied',async()=>{
  const x=setup();
  assert.equal((await x.request('board')).status,401);
  assert.equal((await x.request('join','POST',{name:'Tom',code:'wrong'})).status,403);
  const tom=await x.guest('Tom');
  assert.match(tom.me.id,/^[a-f0-9-]+$/);
  assert.equal((await x.request('profile','PUT',{name:'Evil',teams:[]},tom.cookie,'https://untrusted.example')).status,403);
  assert.equal((await x.request('board','GET',undefined,'pb_session='+'0'.repeat(64))).status,401);
});
test('shared board writes visible to a second guest; stale revisions cannot overwrite',async()=>{
  const x=setup(),tom=await x.guest('Tom'),mia=await x.guest('Mia');
  const state=tom.state;
  state.teams.push({id:'field',name:'Veldwerk'});
  assert.equal((await x.request('board','PUT',{version:tom.version,state},tom.cookie)).status,200);
  const remote=await x.request('board','GET',undefined,mia.cookie);
  assert.equal(remote.body.state.teams[1].name,'Veldwerk');
  assert.equal((await x.request('board','PUT',{version:tom.version,state:mia.state},mia.cookie)).status,409);
});
test('scheduled reminders target selected teams and users, deduplicate overlapping groups, and read state is personal',async()=>{
  const x=setup(),tom=await x.guest('Tom'),mia=await x.guest('Mia'),alex=await x.guest('Alex');
  const s=tom.state;
  s.teams.push({id:'field',name:'Veldwerk'});
  s.cards.push({id:'project',title:'Enschede',comment:'',column:s.columns[0].id,teamId:'field',
    due:'',alert:0,timerAt:'2020-01-01T10:00',timerRecipients:['team:field','user:'+tom.me.id]});
  assert.equal((await x.request('board','PUT',{version:tom.version,state:s},tom.cookie)).status,200);
  assert.equal((await x.request('profile','PUT',{name:'Tom',teams:['field']},tom.cookie)).status,200);
  assert.equal((await x.request('profile','PUT',{name:'Mia',teams:['field']},mia.cookie)).status,200);
  await tick(x.env);await tick(x.env);
  const a=(await x.request('board','GET',undefined,tom.cookie)).body;
  const b=(await x.request('board','GET',undefined,mia.cookie)).body;
  const c=(await x.request('board','GET',undefined,alex.cookie)).body;
  assert.equal(a.notifications.length,1);assert.equal(b.notifications.length,1);assert.equal(c.notifications.length,0);
  assert.equal(a.notifications[0].title,'Enschede');
  await x.request('read','POST',{all:true},tom.cookie);
  assert.equal((await x.request('board','GET',undefined,tom.cookie)).body.notifications[0].read,true);
  assert.equal((await x.request('board','GET',undefined,mia.cookie)).body.notifications[0].read,false);
});
test('Everyone is implicit for all guests; column reminders preserve entry clocks and route to selected groups',async()=>{
  const x=setup(),a=await x.guest('A'),b=await x.guest('B');
  const s=a.state;
  s.columns[0].reminder=1;s.columns[0].recipients=['team:everyone'];
  s.cards.push({id:'p',title:'Project',comment:'',column:s.columns[0].id,due:'',alert:1,timerAt:''});
  await x.request('board','PUT',{version:a.version,state:s},a.cookie);
  const row=x.db.prepare('SELECT data FROM board').get();
  const persisted=JSON.parse(row.data);
  persisted.cards[0].enteredAt=Date.now()-2*86400000;
  x.db.prepare('UPDATE board SET data=?').run(JSON.stringify(persisted));
  await tick(x.env);
  assert.equal((await x.request('board','GET',undefined,b.cookie)).body.notifications.length,1);
});
test('client cannot forge past sent markers or unknown recipients',async()=>{
  const x=setup(),a=await x.guest('A');
  a.state.cards.push({id:'p',title:'Project',comment:'',column:a.state.columns[0].id,
    due:'',alert:1,timerAt:'2020-01-01T10:00',timerSentKey:'2020-01-01T10:00',timerRecipients:['user:unknown']});
  assert.equal((await x.request('board','PUT',{version:a.version,state:a.state},a.cookie)).status,400);
  a.state.cards[0].timerRecipients=['team:everyone'];
  assert.equal((await x.request('board','PUT',{version:a.version,state:a.state},a.cookie)).status,200);
  await tick(x.env);
  assert.equal((await x.request('board','GET',undefined,a.cookie)).body.notifications.length,1);
});
test('push outbox is created transactionally and endpoint validation rejects internal URLs',async()=>{
  const x=setup(),a=await x.guest('A');
  assert.equal((await x.request('subscription','POST',{endpoint:'https://127.0.0.1/internal'},a.cookie)).status,400);
  assert.equal(validEndpoint('https://fcm.googleapis.com.evil.test/path'),false);
  assert.equal((await x.request('subscription','POST',{endpoint:'https://fcm.googleapis.com/fcm/send/test'},a.cookie)).status,200);
  a.state.cards.push({id:'p',title:'Push',comment:'',column:a.state.columns[0].id,due:'',alert:1,timerAt:'2020-01-01T10:00'});
  await x.request('board','PUT',{version:a.version,state:a.state},a.cookie);
  await tick(x.env);await tick(x.env);
  assert.equal(x.db.prepare('SELECT COUNT(*) AS n FROM push_jobs').get().n,1);
});
test('VAPID JWT signs the correct push-service audience',async()=>{
  const pair=await crypto.subtle.generateKey({name:'ECDSA',namedCurve:'P-256'},true,['sign','verify']);
  const jwk=await crypto.subtle.exportKey('jwk',pair.privateKey);
  const auth=await authorization('https://fcm.googleapis.com/test',{VAPID_PRIVATE_JWK:JSON.stringify(jwk),VAPID_PUBLIC_KEY:'test',PUSH_SUBJECT:'https://planbord-285.pages.dev'});
  const jwt=auth.match(/t=([^,]+)/)[1], [head,body,signature]=jwt.split('.');
  assert.equal(JSON.parse(Buffer.from(body,'base64url')).aud,'https://fcm.googleapis.com');
  assert.equal(await crypto.subtle.verify({name:'ECDSA',hash:'SHA-256'},pair.publicKey,Buffer.from(signature,'base64url'),new TextEncoder().encode(head+'.'+body)),true);
});
