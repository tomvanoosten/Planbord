const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const C = require('./board-core.js');

test('old saved projects, comments and renamed date field survive migration', () => {
  const s = C.normalize({columns: [{id:'a',name:'Custom'}],cards:[{id:7,column:'a',title:'My project',comment:'Keep this',created:100,alert:0}],fieldLabel:'Veldwerk'});
  assert.equal(s.cards[0].id, '7');
  assert.equal(s.cards[0].comment, 'Keep this');
  assert.equal(s.cards[0].alert, 0);
  assert.equal(s.labels.date, 'Veldwerk');
});
test('column reminders restart on movement and never repeat within a stay', () => {
  const s = C.seed(1000);
  const c = s.cards[0];
  s.columns[1].reminder = 1;
  C.move(c, s.columns[1].id, 5000);
  assert.equal(C.collect(s, 5000 + C.DAY - 1).length, 0);
  assert.equal(C.collect(s, 5000 + C.DAY).length, 1);
  assert.equal(C.collect(s, 5000 + C.DAY + 1).length, 0);
  C.move(c, s.columns[0].id, 10000);
  C.move(c, s.columns[1].id, 20000);
  assert.equal(C.collect(s, 20000 + C.DAY).length, 1);
});
test('individual timers survive save/reload; unchanged edits do not rearm them', () => {
  const s = C.seed();
  let c = s.cards[0];
  c = C.update(c, {...c,timerAt:'2026-09-10T11:00'});
  s.cards[0] = c;
  const now = new Date('2026-09-10T11:00').getTime();
  assert.equal(C.collect(s,now).length,1);
  s.cards[0] = C.update(c,{...c,comment:'An unrelated edit'});
  const loaded = C.normalize(JSON.parse(JSON.stringify(s)));
  assert.equal(C.collect(loaded,now+1000).length,0);
  loaded.cards[0] = C.update(loaded.cards[0],{...loaded.cards[0],timerAt:'2026-09-10T11:01'});
  assert.equal(C.collect(loaded,now+60000).length,1);
  loaded.cards[0] = C.update(loaded.cards[0],{...loaded.cards[0],timerAt:''});
  assert.equal(C.collect(loaded,now+120000).length,0);
});
test('zero days alerts on the date at 09:00; missed alerts are delivered on return', () => {
  const s = C.seed();
  s.cards[0].due = '2026-09-10';
  s.cards[0].alert = 0;
  const at = new Date('2026-09-10T09:00').getTime();
  assert.equal(C.collect(s,at-1).length,0);
  assert.equal(C.collect(s,at+10*C.DAY).length,1);
  assert.equal(C.collect(s,at+11*C.DAY).length,0);
});
test('date warning uses calendar days across daylight-saving boundaries', () => {
  const expected = new Date('2026-03-28T09:00:00').getTime();
  assert.equal(C.dueTime('2026-03-29',1),expected);
});

// Run the real browser handlers against a small DOM adapter, without a browser.
function app(saved) {
  class Element {
    constructor(){this.value='';this.hidden=false;this.open=false;this.children=[];this.inputs=[];this.dataset={};this.classList={add(){},remove(){}};}
    showModal(){this.open=true;}
    close(){this.open=false;}
    focus(){}
    addEventListener(type,listener){(this.listeners ||= {})[type]=listener;}
    append(item){this.children.push(item);}
    remove(){this.removed=true;}
    set innerHTML(value){
      this.html=value;this.inputs=[];
      for(const match of value.matchAll(/<input([^>]*)>/g)){
        const input=new Element(),attrs=match[1];
        input.value=attrs.match(/value="([^"]*)"/)?.[1]||'';
        input.checked=/\schecked(?:\s|$)/.test(attrs);
        input.dataset.teamName=attrs.match(/data-team-name="([^"]*)"/)?.[1];
        this.inputs.push(input);
      }
      const opts=[...value.matchAll(/<option value="([^"]+)"([^>]*)>/g)];
      if(opts.length)this.value=(opts.find(o=>o[2].includes('selected'))||opts[0])[1];
    }
    get innerHTML(){return this.html||'';}
    querySelectorAll(selector){return selector==='input:checked'?this.inputs.filter(i=>i.checked):this.inputs;}
    querySelector(){return this.inputs[0]||null;}
    setCustomValidity(value){this.validation=value;}
    reportValidity(){return !this.validation;}
  }
  const elements = {};
  for (const match of fs.readFileSync('index.html','utf8').matchAll(/id="([^"]+)"/g)) elements[match[1]]=new Element();
  const data = new Map(saved === undefined ? [] : [['planboard-state',saved]]);
  const timeouts = [];
  const context = {BoardCore:C,document:{getElementById:id=>elements[id],querySelectorAll:()=>[],querySelector:()=>null,createElement:()=>new Element(),addEventListener(){}},
    localStorage:{getItem:k=>data.get(k)||null,setItem:(k,v)=>data.set(k,v),removeItem:k=>data.delete(k)},setTimeout:(f,ms)=>timeouts.push({f,ms}),clearTimeout(){},setInterval(){},
    navigator:{},location:{protocol:'file:'},
    console,window:{addEventListener(){},focus(){}}};
  vm.createContext(context);
  vm.runInContext(fs.readFileSync('app.js','utf8'),context);
  return {el:elements,data,context,timeouts,run:code=>vm.runInContext(code,context),load:file=>vm.runInContext(fs.readFileSync(file,'utf8'),context)};
}
test('card open/save/reopen persists comments, timer, zero-day lead, and stage', () => {
  const a = app();
  a.el.newCard.onclick();
  assert.equal(a.el.cardDialog.open,true);
  a.el.cardTitle.value='Test project';
  a.el.cardComment.value='Long comments are preserved';
  a.el.dueDate.value='2099-01-10';
  a.el.alertDays.value='0';
  a.el.timerAt.value='2099-01-10T08:30';
  a.el.moveCard.value='stage-1';
  a.el.cardForm.onsubmit({preventDefault(){}});
  assert.equal(a.el.cardDialog.open,false);
  const s=JSON.parse(a.data.get('planboard-state'));
  const c=s.cards.find(c=>c.title==='Test project');
  assert.equal(c.alert,0);
  const b=app(JSON.stringify(s));
  b.run('openCard('+JSON.stringify(c.id)+')');
  assert.equal(b.el.cardComment.value,c.comment);
  assert.equal(b.el.timerAt.value,c.timerAt);
  assert.equal(b.el.moveCard.value,'stage-1');
});
test('escape from an existing project saves the edited values without pressing save',()=>{
  const a=app();
  const id=a.run('state.cards[0].id');
  a.run('openCard('+JSON.stringify(id)+')');
  a.el.cardComment.value='Deze opmerking is automatisch opgeslagen';
  a.el.cardDialog.listeners.cancel({preventDefault(){}});
  assert.equal(a.el.cardDialog.open,false);
  assert.equal(a.run('state.cards[0].comment'),'Deze opmerking is automatisch opgeslagen');
});
test('insert left/right and delete confirmation preserve cards', () => {
  const a=app();
  a.run("openColumn('stage-0')");
  a.el.insertRight.onclick();
  a.el.newColumnName.value='Inserted';
  a.el.nameForm.onsubmit({preventDefault(){}});
  assert.equal(a.run('state.columns[1].name'),'Inserted');
  a.run("openColumn('stage-0')");
  a.el.insertLeft.onclick();
  a.el.newColumnName.value='Before';
  a.el.nameForm.onsubmit({preventDefault(){}});
  assert.equal(a.run('state.columns[0].name'),'Before');
  a.run("openColumn('stage-0')");
  a.el.deleteColumn.onclick();
  assert.equal(a.el.confirmDialog.open,true);
  assert.equal(a.run("state.columns.some(c=>c.id==='stage-0')"),true);
  a.el.confirmDelete.onclick();
  assert.equal(a.run("state.columns.some(c=>c.id==='stage-0')"),false);
  assert.equal(a.run('state.cards.length'),3);
  assert.equal(a.run("state.cards.some(c=>c.column==='stage-0')"),false);
});
test('archiving a project removes it from the active board but keeps its details in the archive',()=>{
  const a=app();
  const id=a.run('state.cards[0].id');
  a.run('openCard('+JSON.stringify(id)+')');
  a.el.cardComment.value='Bewaar deze opmerking';
  a.el.deleteCard.onclick(); a.el.confirmDelete.onclick();
  assert.equal(a.run('state.cards.some(card=>card.id==='+JSON.stringify(id)+')'),false);
  assert.equal(a.run('state.archive.length'),1);
  assert.equal(a.run('state.archive[0].card.comment'),'Bewaar deze opmerking');
});
test('permanent archive removal is only rendered for an admin and requires confirmation',()=>{
  const a=app();
  a.run("state.archive=[{id:'archive-admin-test',archivedAt:Date.now(),teamName:'Iedereen',columnName:'Klaar',card:{id:'old',title:'Oud project',comment:'',due:'',timerAt:'',alert:1}}];renderArchive()");
  assert.doesNotMatch(a.el.archiveMonths.innerHTML,/Definitief verwijderen/);
  a.context.window.Shared={isAdmin:true,async deleteArchived(){}};a.run('renderArchive()');
  assert.match(a.el.archiveMonths.innerHTML,/Definitief verwijderen/);
  a.el.archiveMonths.onclick({target:{closest(){return {dataset:{purgeArchive:'archive-admin-test',purgeName:'Oud project'}};}}});
  assert.equal(a.el.confirmDialog.open,true);assert.match(a.el.confirmText.textContent,/kan alleen via een dagelijkse back-up/);
});
test('test alert works without desktop API, opens its card, and expires in ten seconds', () => {
  const a=app();
  a.el.testNotification.onclick();
  assert.equal(a.el.toasts.children.length,1);
  assert.equal(a.timeouts[0].ms,10000);
  a.el.toasts.children[0].onclick();
  assert.equal(a.el.cardDialog.open,true);
});
test('invalid storage does not brick board or overwrite old data', () => {
  const a=app('{broken');
  assert.equal(a.el.storageWarning.hidden,false);
  a.el.newCard.onclick();
  assert.equal(a.el.cardDialog.open,true);
  assert.equal(a.data.get('planboard-state'),'{broken');
});
test('drag-and-drop moves the actual card and restarts its column clock', () => {
  const a=app();
  a.run("state.cards[0].enteredAt=1");
  const id=a.run('state.cards[0].id');
  a.el.board.ondragstart({target:{closest:()=>({dataset:{card:id}})},dataTransfer:{setData(){}}});
  a.el.board.ondrop({preventDefault(){},target:{closest:()=>({dataset:{column:'stage-2'}})}});
  assert.equal(a.run('state.cards[0].column'),'stage-2');
  assert.ok(a.run('state.cards[0].enteredAt')>1);
});
test('custom labels persist through subsequent project saves', () => {
  const a=app();
  a.el.settingsButton.onclick();
  a.el.settingDate.value='Veldwerk';
  a.el.settingComment.value='Commentaar';
  a.el.settingsForm.onsubmit({preventDefault(){}});
  a.el.newCard.onclick();
  assert.equal(a.el.dateLabel.textContent,'Veldwerk');
  a.el.cardTitle.value='Named';
  a.el.cardForm.onsubmit({preventDefault(){}});
  assert.equal(JSON.parse(a.data.get('planboard-state')).labels.date,'Veldwerk');
});
test('desktop alert contains project name, opens project and is closed after ten seconds', () => {
  const a=app();
  let shown;
  class Notification {
    static permission='granted';
    constructor(title,options){this.title=title;this.options=options;shown=this;}
    close(){this.closed=true;}
  }
  a.context.Notification=Notification;
  a.context.window.Notification=Notification;
  a.el.testNotification.onclick();
  assert.equal(shown.title,a.run('state.cards[0].title'));
  shown.onclick();
  assert.equal(a.el.cardDialog.open,true);
  const closing=a.timeouts[a.timeouts.length-1];
  assert.equal(closing.ms,10000);
  closing.f();
  assert.equal(shown.closed,true);
});
test('closed dialogs cannot overlay the board; no obsolete enhancement script loads', () => {
  const css=fs.readFileSync('styles.css','utf8');
  const html=fs.readFileSync('index.html','utf8');
  assert.match(css,/\[hidden\]\{display:none!important\}/);
  assert.match(css,/dialog:not\(\[open\]\)\{display:none!important\}/);
  assert.doesNotMatch(html,/enhancements.js/);
  assert.doesNotMatch(html,/<dialog[^>]*\sopen(?:\s|>)/);
});
test('teams UI creates and filters teams and saves distinct audiences per reminder',()=>{
  const a=app();a.load('teams.js');a.load('shared.js');
  a.el.teamsButton.onclick();
  a.el.newTeamName.value='Veldwerk';
  a.el.addTeamForm.onsubmit({preventDefault(){}});
  const id=a.run('state.teams[1].id');
  a.el.newCard.onclick();
  a.el.cardTitle.value='Teamproject';
  a.el.cardTeam.value=id;
  a.el.cardTeam.onchange();
  a.el.dueRecipients.inputs.forEach(i=>{i.checked=i.value==='team:'+id;});
  a.el.timerRecipients.inputs.forEach(i=>{i.checked=i.value==='team:'+id;});
  a.el.cardForm.onsubmit({preventDefault(){}});
  const card=a.run('state.cards[state.cards.length-1]');
  assert.equal(card.teamId,id);
  assert.equal(card.dueRecipients[0],'team:'+id);
  assert.equal(card.timerRecipients[0],'team:'+id);
  a.el.teamFilter.value=id;a.el.teamFilter.onchange();
  assert.equal(a.context.window.Teams.matches(card),true);
  assert.equal(a.context.window.Teams.matches({teamId:'different'}),false);
  assert.equal(a.run("state.columns.filter(c=>c.teamId==='"+id+"').length"),10);
  assert.equal(a.run("state.cards.find(c=>c.id==='"+card.id+"').column"),a.run("state.columns.find(c=>c.teamId==='"+id+"').id"));
  assert.equal(a.run("state.columns.filter(c=>c.teamId==='everyone').length"),10);
});
test('the Everyone board can be duplicated without carrying old assignees or audiences',()=>{
  const a=app();a.load('teams.js');a.el.teamsButton.onclick();
  a.el.teamList.onclick({target:{closest(selector){return selector==='[data-duplicate-team]'?{dataset:{duplicateTeam:'everyone'}}:null;}}});
  assert.equal(a.run('state.teams.length'),2);
  const id=a.run('state.teams[1].id');
  assert.equal(a.run("state.columns.filter(column=>column.teamId==="+JSON.stringify(id)+").length"),10);
  assert.equal(a.run("state.cards.filter(card=>card.teamId==="+JSON.stringify(id)+").every(card=>card.assignees.length===0&&card.dueRecipients[0]==='team:'+"+JSON.stringify(id)+")"),true);
});
test('message inbox exposes reply, add-to-actions and delete as distinct choices',()=>{
  const a=app();
  a.context.window.PlanboardMessages.set([{id:'message-1',sender:'member-1',senderName:'Mia',senderColor:'#459056',body:'Controleer de offerte',created:1,seen:false}],[],false);
  assert.match(a.el.messageInbox.innerHTML,/Controleer de offerte/);
  assert.match(a.el.messageInbox.innerHTML,/Naar Acties/);
  assert.match(a.el.messageInbox.innerHTML,/Beantwoorden/);
  assert.match(a.el.messageInbox.innerHTML,/Wissen/);
  a.el.messageInbox.onclick({target:{closest(){return {dataset:{messageAction:'actions',messageId:'message-1'}};}}});
  assert.equal(a.context.window.PlanboardActions.get().at(-1).text,'Controleer de offerte');
  assert.equal(a.run('messageItems.length'),1);
});
test('team-aware board data keeps legacy columns and projects while adding a separate team board',()=>{
  const s=C.normalize({columns:[{id:'main',name:'Algemeen'}],cards:[{id:'old',title:'Bestaand',column:'main',comment:''}],teams:[{id:'field',name:'Veldwerk'}]});
  assert.equal(s.columns[0].teamId,'everyone');
  assert.equal(s.cards[0].teamId,'everyone');
  assert.equal(s.cards[0].column,'main');
});
test('empty audience blocks saving rather than silently notifying everyone',()=>{
  const a=app();a.load('teams.js');
  a.el.newCard.onclick();
  a.el.cardTitle.value='Nobody selected';
  a.el.dueRecipients.inputs.forEach(i=>{i.checked=false;});
  a.el.cardForm.onsubmit({preventDefault(){}});
  assert.equal(a.el.cardDialog.open,true);
  assert.equal(a.run("state.cards.some(c=>c.title==='Nobody selected')"),false);
});
