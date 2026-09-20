// Export only application data; session credentials are never written to disk.
import {mkdir,writeFile} from 'node:fs/promises';
const origin='https://planbord-285.pages.dev';
const response=await fetch(origin+'/api/join',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({name:'GPT',code:process.env.PLANBOARD_INVITE})});
if(!response.ok) throw new Error('Backup login failed: '+response.status);
const cookie=response.headers.get('set-cookie').split(';')[0];
const board=await fetch(origin+'/api/board',{headers:{Cookie:cookie}});
if(!board.ok) throw new Error('Backup failed: '+board.status);
const data=await board.json();
if(!Array.isArray(data.state?.cards)||!data.state.columns?.length) throw new Error('Invalid backup');
const directory=new URL('../.private/',import.meta.url);
await mkdir(directory,{recursive:true});
const name='planboard-backup-'+new Date().toISOString().replace(/[:.]/g,'-')+'.json';
await writeFile(new URL(name,directory),JSON.stringify({exportedAt:new Date().toISOString(),...data},null,2),{flag:'wx'});
console.log(JSON.stringify({file:'.private/'+name,projects:data.state.cards.length,columns:data.state.columns.length,version:data.version}));
