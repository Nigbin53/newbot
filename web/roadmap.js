/* A whole-case roadmap. Recommendations use the user's documents and saved plan. */
function roadmapModel() {
  const docs=caseDocs(),sources=docs.filter(d=>!d.final&&d.kind!=='translate'),translations=docs.filter(d=>!d.final&&d.kind==='translate'),final=docs.find(d=>d.final);
  const visits=selectedVisits('all').filter(v=>v.kind!=='submission');
  return {docs,sources,translations,final,visits,ready:docs.filter(d=>isReady(d.id)).length,sourceReady:sources.filter(d=>isReady(d.id)).length,translationReady:translations.filter(d=>isReady(d.id)).length};
}
function roadmapNext() {
  const stops=cityPlanStops(),next=stops.find(s=>s.docs.some(d=>cityDocumentStage(d)==='todo'));
  if(next)return {kind:'city',id:next.id,title:`${next.city} · ${cityDocumentAction(next.docs.find(d=>cityDocumentStage(d)==='todo')).toLowerCase()}`,detail:next.docs.filter(d=>cityDocumentStage(d)==='todo').map(d=>d.title).join(' · ')};
  const unplanned=roadmapModel().sources.find(d=>!isReady(d.id)&&!visitForDoc(d));
  if(unplanned)return {kind:'doc',id:unplanned.id,title:'Укажите город для документа',detail:unplanned.title};
  if(roadmapModel().sources.some(d=>!isReady(d.id)))return {kind:'collection',title:'Забрать заказанные документы',detail:'Даты получения — по готовности учреждения'};
  const translation=roadmapModel().translations.find(d=>!isReady(d.id));
  if(translation)return {kind:'translation',title:'Передать документы на перевод',detail:'Исходные документы получены'};
  return {kind:'submission',title:'Подготовить комплект к подаче',detail:dayLabel(state.passportCase.submission)};
}
function openRoadmapNext() {
  const step=roadmapNext();
  if(step.kind==='city')cityPlanStopSheet(step.id);
  else if(step.kind==='collection')cityCollectionSheet();
  else if(step.kind==='translation')cityTranslationsSheet();
  else if(step.kind==='doc')docSheet(step.id);
  else submissionSheet();
}
function roadmapHomeEntry() {
  const step=roadmapNext(),stop=step.kind==='city'?cityPlanStops().find(s=>s.id===step.id):null,task=stop?.docs.find(d=>cityDocumentStage(d)==='todo');
  return `<button class="journey-next" data-action="open-roadmap"><span class="journey-next-kicker">${icon('route')}С ЧЕГО НАЧАТЬ</span><span class="journey-next-main"><strong>${stop?escapeHtml(stop.city):escapeHtml(step.title)}</strong><span class="journey-next-arrow">${icon('arrow-right')}</span></span><span class="journey-next-task">${escapeHtml(task?cityDocumentAction(task):step.detail)}</span><span class="journey-next-meta">${stop?`${dayLabel(stop.date)} · ${escapeHtml(stop.visits[0].office)}`:'Открыть ваш маршрут'}</span></button>`;
}
function roadmapPage() {
  const m=roadmapModel(),stops=cityPlanStops(),next=stops.find(s=>s.docs.some(d=>cityDocumentStage(d)==='todo')),cities=[...new Set(stops.map(s=>s.city))],unplanned=m.sources.filter(d=>!isReady(d.id)&&!visitForDoc(d)),outstanding=m.sources.filter(d=>!isReady(d.id)),ordered=outstanding.filter(d=>cityDocumentStage(d)==='ordered');
  return `<section class="city-plan-page"><div class="city-plan-heading"><h1 class="page-title">План поездок</h1><button class="city-plan-help" data-action="plan-help" aria-label="Как пользоваться маршрутом">${icon('info')}</button></div><p class="city-plan-subtitle">Куда ехать и что заказать.</p><div class="city-plan-overview"><div class="city-plan-overview-route"><strong>${plural(cities.length,'город','города','городов')}</strong><span>${plural(outstanding.length-ordered.length,'документ заказать','документа заказать','документов заказать')}</span></div><button class="city-plan-overview-goal" data-action="submission"><small>ПОДАЧА · ${escapeHtml(caseCity())}</small><strong>${dayLabel(state.passportCase.submission)}</strong><span>${escapeHtml(caseCity())}</span></button><div class="city-plan-route-line">${cities.map(escapeHtml).join(' <span aria-hidden="true">→</span> ')}</div></div>${unplanned.length?`<button class="city-plan-pending" data-action="doc" data-id="${unplanned[0].id}">${icon('alert')}<span><strong>Ещё ${plural(unplanned.length,'документ без города','документа без города','документов без города')}</strong><small>Укажите, где его получить, — он появится в маршруте.</small></span>${icon('chevron-right')}</button>`:''}<div class="city-route-list">${stops.map((stop,i)=>cityStopCard(stop,i,next?.id)).join('')}</div><div class="city-plan-section-heading"><h2>После заказов</h2><p>Сначала получите результаты, затем готовьте подачу.</p></div><div class="city-after-route"><button class="city-after-step" data-action="city-collection"><span class="city-after-number">${stops.length+1}</span><div><strong>Забрать готовые документы</strong><p>${ordered.length?`${plural(ordered.length,'заказ','заказа','заказов')} ожидают получения`:'Когда учреждения сообщат о готовности'} · даты нужно уточнить</p></div>${icon('chevron-right')}</button><button class="city-after-step" data-action="city-translations"><span class="city-after-number">${stops.length+2}</span><div><strong>Сделать переводы</strong><p>Ваши документы, мамы и деда · после получения оригиналов</p></div>${icon('chevron-right')}</button><button class="city-after-step" data-action="submission"><span class="city-after-number">${stops.length+3}</span><div><strong>Подать ваш комплект</strong><p>${dayLabel(state.passportCase.submission)} · ${escapeHtml(caseCity())} · один паспорт</p></div>${icon('chevron-right')}</button></div>${roadmapAlerts(m)}<p class="list-footnote">Порядок — по датам вашего плана. Поездки без даты стоят в конце: откройте их и укажите дату. Даты получения не назначаются автоматически.</p></section>`;
}
function roadmapAlerts(m) {
  const expired=m.docs.filter(d=>isExpired(d)),tight=m.docs.filter(d=>isTight(d)),late=state.passportCase.submission?m.translations.filter(d=>!isReady(d.id)&&(visitForDoc(d)?.date||d.remoteDate||'')>=state.passportCase.submission):[],unknown=m.sources.filter(d=>d.unknownExpiry&&!d.expiry);
  let html='';
  if(late.length){const d=late[0],date=visitForDoc(d)?.date||d.remoteDate;html+=`<button class="roadmap-alert" data-action="doc" data-id="${d.id}">${icon('alert')}<div><strong>Переводы без запаса к подаче</strong><p>${MEMBERS[d.member].label} · ${dayLabel(date)}${date===state.passportCase.submission?' — в день подачи.':' — после подачи.'} Уточните готовность и перенесите шаг или подачу.</p></div>${icon('chevron-right')}</button>`;}
  if(expired.length||tight.length)html+=`<button class="roadmap-alert" data-action="notifications">${icon('clock')}<div><strong>${expired.length?'Есть документы для обновления':'Небольшой запас по срокам'}</strong><p>${expired.length?plural(expired.length,'документ','документа','документов')+' не подходят к подаче.':`${MEMBERS[tight[0].member].label} · ${escapeHtml(tight[0].title)}: запас ${daysText(buffer(tight[0]))}.`}</p></div>${icon('chevron-right')}</button>`;
  if(unknown.length)html+=`<button class="roadmap-alert roadmap-alert-neutral" data-action="doc" data-id="${unknown[0].id}">${icon('info')}<div><strong>Сроки ещё нужно уточнить</strong><p>${plural(unknown.length,'документ','документа','документов')} без указанного срока. Отметка «готов» означает, что документ у вас.</p></div>${icon('chevron-right')}</button>`;
  return html;
}
function roadmapHelpSheet() {
  openSheet('Город за городом',`<div class="city-step-goal"><strong>Едете в город → заказываете документы → переходите к следующей поездке.</strong><p>Под каждым городом сразу видны нужные заказы. Внутри — учреждения, адреса, контакты и документы с собой.</p></div><ol class="city-step-question-list"><li><strong>«Заказал»</strong> — вы подали запрос. Это ещё не полученный документ.</li><li><strong>«Получил»</strong> — результат уже у вас. После этого он участвует в готовности общего комплекта.</li><li><strong>Следующая поездка</strong> выбирается по сохранённым датам. Если один город нужен в разные дни, это отдельные остановки.</li></ol><button class="primary-button" data-action="plan-next">Открыть ближайший шаг ${icon('arrow-right')}</button>`,'ПОНЯТНЫЙ ПЛАН ПОЕЗДОК');
}

function roadmapTranslationDateSheet(id) {
  const d=getDoc(id);if(!d||d.kind!=='translate')return;
  const visit=visitForDoc(d);if(visit){visitEditor(visit.id);return;}
  activeDocId=id;
  openSheet('Когда планируете переводы',`${ownerBadge(d.member)}<p class="section-caption" style="margin-top:12px">Уточните дату готовности у переводчика. Общая подача — ${dayLabel(state.passportCase.submission)}.</p><label class="field-label" for="translation-date">Дата переводов в вашем плане</label><input class="text-input" id="translation-date" type="date" value="${d.remoteDate||''}"><button class="primary-button" data-action="save-translation-date">Сохранить дату переводов</button><p class="sheet-note">Отведите время на проверку и исправления до подачи. Сохранение даты не создаёт заказ.</p>`,'ЭТАП 2 · ДАТА ЭТОЙ ВЕТКИ');
}

function cityDocumentStage(d) {
  return isReady(d.id)?'received':state.orders?.[d.id]?.ordered?'ordered':'todo';
}
function cityDocumentAction(d,verb='Заказать') {
  const names={'Архивная выписка':'архивную выписку','Справка о несудимости':'справку о несудимости','Свидетельство о браке':'свидетельство о браке','Подтверждение смены фамилии':'подтверждение смены фамилии','Архивная запись о рождении':'архивную запись о рождении','Справка из реестра':'справку из реестра'};
  return names[d.title]?`${verb} ${names[d.title]}`:`${verb}: «${d.title}»`;
}
function cityPlanStops() {
  const sources=roadmapModel().sources,groups=new Map();
  for(const visit of selectedVisits('all').filter(v=>v.kind!=='submission')) {
    const docs=sources.filter(d=>visit.docIds.includes(d.id));if(!docs.length)continue;
    const key=visit.date+'|'+visit.city;
    if(!groups.has(key))groups.set(key,{id:key,city:visit.city,date:visit.date,visits:[],docs:[]});
    const group=groups.get(key);group.visits.push(visit);
    for(const d of docs)if(!group.docs.some(item=>item.id===d.id))group.docs.push(d);
  }
  return [...groups.values()].sort((a,b)=>((a.date||'9999-12-31')+(a.visits[0].time||'')).localeCompare((b.date||'9999-12-31')+(b.visits[0].time||'')));
}
function cityStopCard(stop,index,currentId) {
  const current=stop.id===currentId,done=stop.docs.every(d=>cityDocumentStage(d)==='received'),ordered=stop.docs.every(d=>cityDocumentStage(d)!=='todo'),offices=[...new Set(stop.visits.map(v=>v.office))],addresses=[...new Set(stop.visits.map(v=>v.address).filter(Boolean))];
  return `<article class="city-stop ${current?'is-current':''} ${done?'is-done':ordered?'is-waiting':''}"><div class="city-stop-rail"><span class="city-stop-number">${done?icon('check'):index+1}</span></div><button class="city-stop-card" data-action="city-stop" data-id="${escapeHtml(stop.id)}">${current?`<span class="city-stop-status">${index===0?'ПЕРВАЯ ПОЕЗДКА':'СЛЕДУЮЩАЯ ПОЕЗДКА'}</span>`:''}<div class="city-stop-heading"><h2>${escapeHtml(stop.city)}${icon('chevron-right')}</h2><span class="city-stop-date"><strong>${dayLabel(stop.date)}</strong><small>${stop.visits.length===1?escapeHtml(stop.visits[0].time):plural(stop.visits.length,'приём','приёма','приёмов')}</small></span></div><p class="city-stop-meta">${offices.map(escapeHtml).join(' · ')}</p><ul class="city-stop-documents">${stop.docs.map(d=>{const stage=cityDocumentStage(d);return `<li><span class="city-task-dot">${icon(stage==='received'?'check':stage==='ordered'?'clock':'document')}</span><span class="city-task-title"><strong>${escapeHtml(stage==='todo'?cityDocumentAction(d):d.title)}</strong><span class="city-task-owner">${ownerBadge(d.member)}${stage==='ordered'?'<small>Заказан</small>':stage==='received'?'<small>Получен</small>':''}</span></span></li>`;}).join('')}</ul></button></article>`;
}
function cityPlanStopSheet(id) {
  const stops=cityPlanStops(),stop=stops.find(s=>s.id===id);if(!stop)return;
  const remaining=stop.docs.filter(d=>cityDocumentStage(d)==='todo'),allOrdered=remaining.length===0,next=stops.slice(stops.indexOf(stop)+1).find(s=>s.docs.some(d=>cityDocumentStage(d)==='todo'));
  openSheet(`${stops.indexOf(stop)+1}. ${escapeHtml(stop.city)}`,`<div class="city-step-goal"><strong>${allOrdered?'Заказы оформлены. Теперь получите результат.':'Поезжайте в этот город и оформите заказы.'}</strong><p>${dayLabel(stop.date)} · ${stop.visits.length===1?(stop.visits[0].time?`${escapeHtml(stop.visits[0].time)} в вашем плане`:'время не выбрано'):plural(stop.visits.length,'приём','приёма','приёмов')}</p></div>${stop.visits.map(v=>{const docs=stop.docs.filter(d=>v.docIds.includes(d.id)),prerequisites=[...new Set(docs.flatMap(depsOf))].map(getDoc).filter(d=>d&&d.kind!=='idcard');return `<section class="sheet-section"><div class="city-step-location"><h3>${escapeHtml(v.office)}</h3><p>${icon('pin')}${escapeHtml(v.city)}, ${escapeHtml(v.address||'Адрес нужно уточнить')}</p><p>${icon('clock')}${dayLabel(v.date)}${v.time?` · ${escapeHtml(v.time)}`:''}${state.checks[v.id+':confirm']?' · условия приёма уточнены':''}</p><p>${icon('phone')}${escapeHtml(v.contact||'Контакт ещё не указан')}</p></div><h3 style="margin-top:16px">Что заказать</h3>${docs.map(d=>cityOrderItem(d,stop.id)).join('')}<div class="sheet-section"><h3>Что взять и проверить</h3>${[[`${v.id}:id`,`Удостоверение личности · ${MEMBERS[v.member].label}`],[`${v.id}:original`,prerequisites.length?`Оригиналы: ${prerequisites.map(d=>d.title).join(' · ')}`:'Копии по списку учреждения — уточнить заранее'],[`${v.id}:confirm`,'Уточнить часы приёма, запись и нужные документы']].map(([key,label])=>`<button class="checklist-item" data-check="${key}" aria-pressed="${Boolean(state.checks[key])}"><span class="check-box ${state.checks[key]?'checked':''}">${icon('check')}</span>${escapeHtml(label)}</button>`).join('')}</div>${v.extraTask?`<p class="city-journey-note">После получения: ${escapeHtml(v.extraTask.toLowerCase())}.</p>`:''}<button class="secondary-button" data-action="edit-visit" data-id="${v.id}">${icon('edit')}Изменить адрес, дату или контакт</button></section>`;}).join('')}<div class="city-step-goal"><strong>После заказа</strong><p>Уточните, когда и как забрать результат. Отметка «Заказал» сохраняет заказ, но не делает документ полученным.</p></div>${next?`<button class="primary-button" data-action="city-stop" data-id="${escapeHtml(next.id)}">Следующий город · ${escapeHtml(next.city)} ${icon('arrow-right')}</button>`:`<button class="primary-button" data-action="city-collection">Дальше · получить заказы ${icon('arrow-right')}</button>`}<p class="sheet-note">Это ваш план: реальная запись и заказ в учреждении не создаются автоматически.</p>`,'ПОЕЗДКА · ЗАКАЗЫ В ОДНОМ ГОРОДЕ');
}
function cityOrderItem(d,stopId='') {
  const stage=cityDocumentStage(d),date=state.orders?.[d.id]?.collectionDate;
  return `<div class="city-order-item ${stage==='ordered'?'is-ordered':stage==='received'?'is-done':''}">${icon(stage==='received'?'check':stage==='ordered'?'clock':d.kind)}<div><strong>${escapeHtml(d.title)}</strong><p>${ownerBadge(d.member)}</p><small>${stage==='received'?'Получен':stage==='ordered'?date?`Получение в плане: ${dayLabel(date)}`:'Заказан · дату получения уточнить':'Ещё не заказан'}</small>${stage==='ordered'?`<button class="text-link" data-action="city-collection-date" data-id="${d.id}">${date?'Изменить дату получения':'Указать дату получения'}</button>`:''}</div>${stage==='todo'?`<button class="city-order-button" data-action="city-order" data-id="${d.id}" data-stop="${escapeHtml(stopId)}">Заказал</button>`:stage==='ordered'?`<button class="city-order-button" data-action="city-received" data-id="${d.id}">Получил</button>`:`<button class="city-order-button" data-action="doc" data-id="${d.id}">Открыть</button>`}${stage==='ordered'?`<button class="city-order-undo" data-action="city-order" data-id="${d.id}" data-stop="${escapeHtml(stopId)}">Вернуть в «не заказан»</button>`:''}</div>`;
}
function cityToggleOrder(id,stopId) {
  const d=roadmapModel().sources.find(d=>d.id===id);if(!d||isReady(id))return;
  if(state.orders[id]?.ordered)delete state.orders[id];
  else state.orders[id]={ordered:true,collectionDate:''};
  commit(state.orders[id]?.ordered?'Заказ отмечен. Получение нужно отметить отдельно.':'Документ снова в списке заказов.');
  if(stopId&&cityPlanStops().some(s=>s.id===stopId))cityPlanStopSheet(stopId);else cityCollectionSheet();
}
function cityMarkReceived(id) {
  const d=roadmapModel().sources.find(d=>d.id===id);if(!d||isReady(id))return;
  if(isExpired(d)){expirySheet(id);return;}
  if(missingDeps(d).length){docSheet(id);return;}
  d.received=true;state.orders[id]={...state.orders[id],ordered:true};
  commit('Получение отмечено. Готовность комплекта пересчитана.');cityCollectionSheet();
}
function cityCollectionSheet() {
  const m=roadmapModel(),ordered=m.sources.filter(d=>cityDocumentStage(d)==='ordered'),received=m.sources.filter(d=>isReady(d.id)),notOrdered=m.sources.filter(d=>cityDocumentStage(d)==='todo');
  openSheet('Забрать заказанные документы',`<div class="city-step-goal"><strong>${ordered.length?plural(ordered.length,'заказ ждёт получения','заказа ждут получения','заказов ждут получения'):'Заказов в ожидании пока нет'}</strong><p>Не выезжайте за результатом, пока учреждение не подтвердит готовность. Даты ниже — только те, которые вы указали.</p></div>${ordered.map(d=>{const v=visitForDoc(d);return `<div class="city-collection-place">${icon('pin')}${escapeHtml(v?.city||'Место уточнить')} · ${escapeHtml(v?.office||'Учреждение не указано')}</div>${cityOrderItem(d)}`;}).join('')}${notOrdered.length?`<p class="city-journey-note">Ещё ${plural(notOrdered.length,'документ нужно заказать','документа нужно заказать','документов нужно заказать')} — они остаются в маршруте по городам.</p>`:''}<p class="city-journey-note">${received.length} из ${m.sources.length} исходных документов уже получены.</p><button class="primary-button" data-action="city-translations">Дальше · переводы ${icon('arrow-right')}</button>`,'ПОСЛЕ ЗАКАЗОВ · ПОЛУЧЕНИЕ');
}
function cityCollectionDateSheet(id) {
  const d=roadmapModel().sources.find(d=>d.id===id);if(!d||!state.orders[id]?.ordered)return;activeDocId=id;
  openSheet('Когда забирать документ',`${ownerBadge(d.member)}<div class="city-step-goal"><strong>${escapeHtml(d.title)}</strong><p>Укажите дату, которую согласовали с учреждением. Неизвестный срок можно оставить пустым.</p></div><label class="field-label" for="collection-date">Дата получения в вашем плане</label><input class="text-input" type="date" id="collection-date" value="${state.orders[id].collectionDate||''}"><button class="primary-button" data-action="save-collection-date">Сохранить дату получения</button><button class="secondary-button" data-action="city-collection">Пока неизвестно · вернуться</button>`,'ЗАКАЗАНО · ОЖИДАЕМ ПОЛУЧЕНИЯ');
}
function cityTranslationsSheet() {
  const docs=roadmapModel().translations;
  openSheet('Передать документы на перевод',`<div class="city-step-goal"><strong>После получения оригиналов</strong><p>Переводы можно начинать отдельно для каждого поколения. Ниже видно, какие документы ещё нужно получить.</p></div>${docs.map(d=>{const deps=missingDeps(d);return `<button class="detail-link" data-action="doc" data-id="${d.id}">${ownerBadge(d.member)}<span><strong>${isReady(d.id)?'Переводы готовы':deps.length?'Сначала получить документы':'Передать документы на перевод'}</strong><small>${deps.length?deps.map(id=>escapeHtml(getDoc(id)?.title||'Документ')).join(' · '):'Нужные исходные документы получены'}${d.remoteDate?`<br>${dayLabel(d.remoteDate)} · в вашем плане`:''}</small></span>${icon('chevron-right')}</button>`;}).join('')}<button class="secondary-button" data-action="submission">Затем · проверить комплект и подать ${icon('arrow-right')}</button>`,'ПОСЛЕ ПОЛУЧЕНИЯ · ПЕРЕВОДЫ');
}
