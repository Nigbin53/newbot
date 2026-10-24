// «Путь» case state: conversion from the earlier Kinpass data, validation and a text
// summary for the bot. The browser app (web/app.js) owns the full model; the server
// only stores it per Telegram account and checks its shape.

export const PUT_MEMBERS = ['self', 'mom', 'grandpa'];
const OWNER_MAP = { self: 'self', mom: 'mom', grand: 'grandpa', grandpa: 'grandpa' };
const LABELS = { self: 'Я', mom: 'Мама', grandpa: 'Дед' };
export const MAX_PUT_BYTES = 262144;

export function guessKind(name) {
  const text = String(name || '').toLowerCase();
  if (/паспорт|удостоверени|buletin|паспорт/.test(text)) return 'idcard';
  if (/перевод|traduc/.test(text)) return 'translate';
  if (/архив|arhiv/.test(text)) return 'archive';
  if (/несудим|cazier/.test(text)) return 'shield';
  if (/свидетельств|certificat/.test(text)) return 'certificate';
  if (/фото|foto/.test(text)) return 'photo';
  if (/адрес|прописк|domicil|жительств/.test(text)) return 'home';
  return 'document';
}

const clean = value => typeof value === 'string' ? value.trim() : '';
const iso = value => /^\d{4}-\d{2}-\d{2}$/.test(clean(value)) ? clean(value) : '';

// Builds a «Путь» state from Kinpass documents and institutions. Nothing is invented:
// unknown dates stay empty, the submission date and city are left for the user.
export function fromKinpass({ documents = [], institutions = [] } = {}) {
  const places = (Array.isArray(institutions) ? institutions : []).map(item => ({
    id: clean(item.id), name: clean(item.name), city: clean(item.city), address: clean(item.address),
    phone: clean(item.phone), hours: clean(item.hours), lunch: clean(item.lunch), reception: clean(item.reception),
    notes: clean(item.notes), source: clean(item.source), checked: iso(item.checked),
  })).filter(item => item.id && item.name);
  const placeById = new Map(places.map(place => [place.id, place]));
  const docs = [];
  const orders = {};
  const groups = new Map();
  for (const old of Array.isArray(documents) ? documents : []) {
    if (!old || typeof old.id !== 'string') continue;
    const member = OWNER_MAP[old.owner] || 'self';
    const id = `${member}:k${old.id}`.slice(0, 100);
    const place = placeById.get(old.institution);
    const city = clean(place?.city || old.city);
    const doc = { id, member, title: clean(old.name) || 'Документ', kind: guessKind(old.name), received: old.status === 'ready', deps: [], expiry: iso(old.expires) || null, legacyId: old.id };
    if (iso(old.issued)) doc.issued = iso(old.issued);
    if (Number.isSafeInteger(old.days)) doc.days = old.days;
    if (city) doc.city = city;
    if (place) doc.placeId = place.id;
    if (old.file) doc.legacyFile = { name: clean(old.fileName) || 'Фото документа' };
    docs.push(doc);
    if (old.status === 'pending') orders[id] = { ordered: true, collectionDate: iso(old.expected) };
    if (doc.received || !city) continue;
    // One trip per owner, city, institution and known request date.
    const date = old.status === 'pending' ? iso(old.requested) : '';
    const key = [member, city.toLowerCase(), place?.id || '', date].join('|');
    if (!groups.has(key)) {
      groups.set(key, {
        id: `${member}:kv${groups.size + 1}`, member, city, date, time: '',
        office: place?.name || 'Учреждение уточнить', address: place?.address || '', contact: place?.phone || '',
        placeId: place?.id || '', docIds: [],
      });
    }
    groups.get(key).docIds.push(id);
  }
  const final = { id: 'self:final', member: 'self', title: 'Анкета и общий комплект', kind: 'documents', received: false, deps: [], expiry: null, final: true };
  docs.push(final);
  return {
    version: 3,
    passportCase: { id: 'my-passport', applicant: 'self', submission: '', city: '', docIds: docs.map(doc => doc.id) },
    activeMember: 'all', tripCity: 'all',
    members: { self: { submission: '', city: '' }, mom: { submission: '', city: '' }, grandpa: { submission: '', city: '' } },
    documents: docs, visits: [...groups.values()], files: {}, checks: {}, orders, indicator: true,
    places, migratedFrom: 'kinpass',
  };
}

// ---- Validation ----
export class PutError extends Error {}
const ID = /^[A-Za-z0-9:_-]{1,100}$/;
const DATE = value => value === '' || value === null || value === undefined || (/^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T12:00:00Z`)));
const fail = message => { throw new PutError(message); };

function walk(value, depth = 0) {
  if (depth > 8) fail('too deep');
  if (typeof value === 'string') { if (value.length > 2000 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value)) fail('bad string'); return; }
  if (value === null || typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value))) return;
  if (Array.isArray(value)) { if (value.length > 400) fail('array too long'); value.forEach(item => walk(item, depth + 1)); return; }
  if (typeof value === 'object') {
    const keys = Object.keys(value);
    if (keys.length > 600) fail('object too large');
    for (const key of keys) { if (key.length > 200 || key === '__proto__') fail('bad key'); walk(value[key], depth + 1); }
    return;
  }
  fail('bad value');
}

export function validatePut(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || value.version !== 3) fail('bad state');
  if (new TextEncoder().encode(JSON.stringify(value)).length > MAX_PUT_BYTES) fail('too large');
  walk(value);
  if (!Array.isArray(value.documents) || value.documents.length > 200) fail('documents');
  for (const doc of value.documents) {
    if (!doc || typeof doc !== 'object' || !ID.test(doc.id) || !PUT_MEMBERS.includes(doc.member)) fail('document id');
    if (typeof doc.title !== 'string' || !doc.title.trim() || doc.title.length > 200) fail('document title');
    if (typeof doc.kind !== 'string' || !/^[a-z-]{1,30}$/.test(doc.kind)) fail('document kind');
    if (doc.deps !== undefined && (!Array.isArray(doc.deps) || doc.deps.some(id => !ID.test(id)))) fail('document deps');
    if (!DATE(doc.expiry) || !DATE(doc.remoteDate)) fail('document date');
  }
  if (!Array.isArray(value.visits) || value.visits.length > 200) fail('visits');
  for (const visit of value.visits) {
    if (!visit || typeof visit !== 'object' || !ID.test(visit.id) || !PUT_MEMBERS.includes(visit.member)) fail('visit id');
    if (!Array.isArray(visit.docIds) || visit.docIds.some(id => !ID.test(id))) fail('visit docs');
    if (!DATE(visit.date) || (visit.time && !/^\d{2}:\d{2}$/.test(visit.time))) fail('visit date');
  }
  const passport = value.passportCase;
  if (!passport || typeof passport !== 'object' || !Array.isArray(passport.docIds) || passport.docIds.some(id => !ID.test(id)) || !DATE(passport.submission)) fail('passport case');
  for (const key of ['orders', 'checks', 'files']) {
    if (value[key] !== undefined && (typeof value[key] !== 'object' || value[key] === null || Array.isArray(value[key]))) fail(key);
  }
  if (value.places !== undefined && (!Array.isArray(value.places) || value.places.length > 100 || value.places.some(place => !place || !ID.test(place.id)))) fail('places');
  return value;
}

// ---- Summary for the bot ----
export function describePut(state, today) {
  const docs = Array.isArray(state?.documents) ? state.documents : [];
  const visits = Array.isArray(state?.visits) ? state.visits : [];
  const orders = state?.orders || {};
  const caseIds = new Set(state?.passportCase?.docIds || docs.map(doc => doc.id));
  const visitOf = id => visits.find(visit => visit.docIds?.includes(id));
  const lines = docs.filter(doc => caseIds.has(doc.id)).map(doc => {
    const visit = visitOf(doc.id);
    const status = doc.received ? 'получен' : orders[doc.id]?.ordered ? `заказан${orders[doc.id].collectionDate ? `, забрать ${orders[doc.id].collectionDate}` : ''}` : doc.final ? 'финальный комплект' : 'нужно заказать';
    return [`• ${doc.title} (${LABELS[doc.member] || doc.member})`, `статус: ${status}`,
      visit && `поездка: ${visit.city}${visit.date ? ` ${visit.date}` : ', дата не выбрана'}${visit.time ? ` ${visit.time}` : ''}${visit.office ? `, ${visit.office}` : ''}${visit.address ? `, ${visit.address}` : ''}${visit.contact ? `, тел. ${visit.contact}` : ''}`,
      !visit && doc.city && `город: ${doc.city}`, doc.days && `делается ~${doc.days} дн.`, doc.expiry && `действует до ${doc.expiry}`]
      .filter(Boolean).join('; ');
  });
  const places = (Array.isArray(state?.places) ? state.places : []).map(place => [`• ${place.name}`, place.city, place.address,
    place.phone && `тел. ${place.phone}`, place.hours && `часы: ${place.hours}`, place.lunch && `обед: ${place.lunch}`, place.reception && `приём: ${place.reception}`]
    .filter(Boolean).join('; '));
  const passport = state?.passportCase || {};
  return `Сегодня: ${today}.\nОдин паспорт, документы трёх поколений (Я, Мама, Дед). Подача: ${passport.submission || 'дата не выбрана'}${passport.city ? `, ${passport.city}` : ''}.\n` +
    `Документы:\n${lines.join('\n') || 'пока нет'}\nСохранённые учреждения:\n${places.join('\n') || 'пока нет'}`;
}
