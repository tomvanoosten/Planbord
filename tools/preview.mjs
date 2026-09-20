// Isolated local UI/API preview. Never connects to the production database.
import {createServer} from 'node:http';
import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {api,tick} from '../server/backend.mjs';
const db=new DatabaseSync(':memory:');
db.exec(readFileSync(new URL('../server/schema.sql',import.meta.url),'utf8'));
function prepare(sql,args=[]) {return {bind(...v){return prepare(sql,v);},async first(){return db.prepare(sql).get(...args)||null;},async all(){return {results:db.prepare(sql).all(...args)};},async run(){return {meta:{changes:db.prepare(sql).run(...args).changes}};}};}
const env={WORKSPACE_CODE:'preview',ADMIN_CODE:'preview-admin',DB:{prepare,async batch(queries){db.exec('BEGIN');try{const out=[];for(const q of queries)out.push(await q.run());db.exec('COMMIT');return out;}catch(e){db.exec('ROLLBACK');throw e;}}}};
const seed=globalThis.BoardCore.normalize(globalThis.BoardCore.seed());
seed.columns[0].name='Nieuwe projecten met een lange kolomnaam';
db.prepare('INSERT INTO board(id,data) VALUES(1,?)').run(JSON.stringify(seed));
const files=new Set(['index.html','app.js','board-core.js','styles.css','teams.js','notifications.js','shared.js','sw.js']);
createServer(async(req,res)=>{try{
 const url=new URL(req.url,'http://localhost:8788');
 if(url.pathname.startsWith('/api/')){
  const chunks=[];for await(const c of req)chunks.push(c);
  const response=await api(new Request(url,{method:req.method,headers:req.headers,body:['GET','HEAD'].includes(req.method)?undefined:Buffer.concat(chunks)}),env,{waitUntil(p){p.catch(console.error);}});
  res.writeHead(response.status,Object.fromEntries(response.headers));res.end(await response.text());return;
 }
 const name=url.pathname==='/'?'index.html':url.pathname.slice(1);
 if(!files.has(name)){res.writeHead(404);res.end();return;}
 res.writeHead(200,{'Content-Type':name.endsWith('.js')?'text/javascript':name.endsWith('.css')?'text/css':'text/html','Cache-Control':'no-store'});
 res.end(readFileSync(new URL('../'+name,import.meta.url)));
}catch(e){res.writeHead(500);res.end(String(e));}}).listen(8788,'127.0.0.1',()=>console.log('Isolated preview: http://localhost:8788 (code: preview, admin: preview-admin)'));
setInterval(()=>tick(env,{scheduled:true}).catch(console.error),10000);
