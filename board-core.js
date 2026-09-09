/* Shared state and reminder logic; also executable in Node for regression tests. */
(function (root) {
  'use strict';
  const DAY = 86400000;
  const labels = {title: 'Projectnaam', comment: 'Opmerkingen', date: 'Due date / veldwerk', lead: 'Waarschuw vooraf'};
  const uid = () => 'id-' + (globalThis.crypto?.randomUUID?.() || Date.now().toString(36) + Math.random().toString(36).slice(2));
  function seed(now = Date.now()) {
    const names = ['Nieuwe projecten', 'Qfield order maken', 'VWO maken', 'VWO ligt bij controle', 'VWO ligt in de bak', 'Veldwerkformulieren', 'Veldwerk gepland', 'Rapportage afmaken', 'Rapportage bij controle', 'Rapportage verstuurd'];
    return {version: 2, labels: {...labels}, columns: names.map((name, i) => ({id: 'stage-' + i, name, reminder: ''})), cards: [
      {id: uid(), title: '225063, AP04 Enschede', column: 'stage-0', comment: '', enteredAt: now, due: '', alert: 1},
      {id: uid(), title: '225845, Nijverdal', column: 'stage-3', comment: '', enteredAt: now, due: '', alert: 1},
      {id: uid(), title: '225774, Utrecht', column: 'stage-7', comment: '', enteredAt: now, due: '', alert: 1}
    ], notifications: []};
  }
  function normalize(data, now = Date.now()) {
    if (!data || !Array.isArray(data.columns) || !data.columns.length || !Array.isArray(data.cards)) throw new Error('Ongeldige bordgegevens');
    return {...data, version: 3, teams: [{id:'everyone',name:'Iedereen'}, ...(data.teams || []).filter(t => t.id !== 'everyone')], labels: {...labels, ...(data.fieldLabel ? {date: data.fieldLabel} : {}), ...data.labels},
      columns: data.columns.map(c => ({...c, id: String(c.id)})),
      cards: data.cards.map(c => ({...c, id: String(c.id), column: String(c.column), enteredAt: c.enteredAt || c.created || now, alert: c.alert ?? 1, due: c.due || '', timerAt: c.timerAt || '', comment: c.comment || ''})),
      notifications: Array.isArray(data.notifications) ? data.notifications : []};
  }
  function move(card, column, now = Date.now()) {
    if (card.column === column) return;
    card.column = column;
    card.enteredAt = now;
    delete card.columnSentKey;
    delete card.columnAlert;
  }
  function update(card, fields, now = Date.now()) {
    const result = {...card};
    move(result, fields.column, now);
    if (result.due !== fields.due || Number(result.alert) !== Number(fields.alert)) delete result.dueSentKey;
    if (result.timerAt !== fields.timerAt) delete result.timerSentKey;
    return Object.assign(result, fields);
  }
  function dueTime(date, days) {
    // Calendar-day arithmetic keeps the same local time across DST changes.
    const d = new Date(date + 'T09:00:00');
    d.setDate(d.getDate() - Number(days));
    return d.getTime();
  }
  function collect(state, now = Date.now(), limit = Infinity) {
    const events = [];
    const emit = (card, key, token, at, message, recipients) => {
      if (events.length >= limit || !Number.isFinite(at) || at > now || card[key] === token) return;
      card[key] = token;
      const notice = {id: uid(), card: card.id, title: card.title, text: message, at: now, read: false, recipients: recipients || ['team:everyone']};
      state.notifications.unshift(notice);
      events.push(notice);
    };
    state.cards.forEach(card => {
      if (card.timerAt) emit(card, 'timerSentKey', card.timerAt, card.timerEpoch ?? new Date(card.timerAt).getTime(), 'Je individuele herinnering is afgelopen.', card.timerRecipients);
      if (card.due) emit(card, 'dueSentKey', card.due + '/' + card.alert, card.dueEpoch ?? dueTime(card.due, card.alert), state.labels.date + ': ' + card.due + '.', card.dueRecipients);
      const col = state.columns.find(c => c.id === card.column);
      if (col && Number(col.reminder) > 0) {
        const token = col.id + '/' + card.enteredAt + '/' + col.reminder;
        emit(card, 'columnSentKey', token, card.enteredAt + Number(col.reminder) * DAY, 'Staat ' + col.reminder + ' dag(en) in ' + col.name + '.', col.recipients);
      }
    });
    return events;
  }
  const api = {DAY, uid, labels, seed, normalize, move, update, dueTime, collect};
  api.receives = (notice, member) => (notice.recipients || ['team:everyone']).some(r =>
    r === 'team:everyone' || r === 'user:' + member.id || (member.teams || []).some(t => r === 'team:' + t));
  root.BoardCore = api;
  if (typeof module !== 'undefined') module.exports = api;
  else root.BoardCore = api;
})(globalThis);
