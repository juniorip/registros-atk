/* Local redesign: compose the existing, permission-scoped views and their live controls.
   Financial amounts and decisions still come from the original renderers and handlers. */
const FX_STATE={salaryId:null,salaryTab:'breakdown',chartGroup:'day',statsTab:'general'};
const FX_MONTH_COMPARISONS=new Map(),FX_CHART_MODELS=new WeakMap();
let FX_CHART_OBSERVER=null;
function fxPreviousMonth(month){const [year,number]=month.split('-').map(Number),date=new Date(Date.UTC(year,number-2,1));return date.toISOString().slice(0,7);}
function fxGrowth(current,previous){
 if(!Number.isFinite(current)||!Number.isFinite(previous))return {kind:'unavailable',text:'Sin base comparable'};
 if(previous===0)return current===0?{kind:'flat',text:'0.0%'}:{kind:'new',text:'Sin base previa'};
 const percent=(current-previous)/Math.abs(previous)*100;
 return {kind:percent>0?'up':percent<0?'down':'flat',text:(percent>0?'+':'')+percent.toFixed(1)+'%'};
}
function fxGrowthMarkup(current,previous,label,previousLabel){
 const growth=fxGrowth(current,previous),symbol={up:'↑',down:'↓',flat:'→',new:'',unavailable:''}[growth.kind];
 return '<span class="fx-growth '+growth.kind+'" title="'+esc('Valor anterior: '+previousLabel)+'">'+symbol+' '+esc(growth.text)+'</span><span class="fx-growth-label">'+esc(label)+'</span>';
}
function fxProjectMonthlyData(payload,ratings,month){
 // Synchronous projection through the existing incentive engine. No renders,
 // requests, settings changes or user actions can occur before finally restores it.
 const saved={records:RECORDS,referrals:REFERRALS,wrongCards:WRONG_CARDS,calls:CALL_REPORTS,ratings:RATINGS,penalties:PENALTY_REPORTS,incentives:INCENTIVE_TOTALS_CACHE,visibleRecords:VISIBLE_RECORDS_CACHE,visibleUsers:VISIBLE_USERS_CACHE};
 try{
  RECORDS=(payload.records||[]).map(mapRecord);REFERRALS=(payload.referrals||[]).map(mapReferral);WRONG_CARDS=(payload.wrongCards||[]).map(mapWrongCard);CALL_REPORTS=(payload.callReports||[]).map(mapCallReport);PENALTY_REPORTS=(payload.penaltyReports||[]).map(mapPenaltyReport);RATINGS=ratings.rows||[];
  const records=getVisibleRecords().filter(row=>recordAccountingMonthKey(row)===month);
  const earningsByUser=new Map(getVisibleUsers().filter(user=>user.role!=='admin').map(user=>[Number(user.id),getTotalIncentiveForUser(user,month)]));
  const earnings=[...earningsByUser.values()].reduce((sum,value)=>sum+value,0);
  return {records,earnings,earningsByUser};
 }finally{RECORDS=saved.records;REFERRALS=saved.referrals;WRONG_CARDS=saved.wrongCards;CALL_REPORTS=saved.calls;RATINGS=saved.ratings;PENALTY_REPORTS=saved.penalties;INCENTIVE_TOTALS_CACHE=saved.incentives;VISIBLE_RECORDS_CACHE=saved.visibleRecords;VISIBLE_USERS_CACHE=saved.visibleUsers;}
}
function fxComparisonProjection(entry){
 if(!entry.payload)return null;
 if(!entry.projection||entry.attendanceRef!==ATTENDANCE||entry.usersRef!==USERS||entry.settingsRef!==SETTINGS){entry.projection=fxProjectMonthlyData(entry.payload,entry.ratings,entry.month);entry.attendanceRef=ATTENDANCE;entry.usersRef=USERS;entry.settingsRef=SETTINGS;}
 return entry.projection;
}
function fxSubscribeMonthlyComparison(month,element,paint){
 const scope=currentVisibilityKey(),previous=fxPreviousMonth(month),key=scope+'|'+previous;
 if(FX_STATE.comparisonScope!==scope){FX_MONTH_COMPARISONS.clear();FX_STATE.comparisonScope=scope;}
 let entry=FX_MONTH_COMPARISONS.get(key);
 if(entry&&Date.now()-entry.startedAt>(entry.error?60000:300000)){FX_MONTH_COMPARISONS.delete(key);entry=null;}
 if(!entry){
  entry={month:previous,startedAt:Date.now(),listeners:[],payload:null,ratings:null,error:false};FX_MONTH_COMPARISONS.set(key,entry);
  while(FX_MONTH_COMPARISONS.size>8)FX_MONTH_COMPARISONS.delete(FX_MONTH_COMPARISONS.keys().next().value);
  const pending=entry;
  scheduleIdleTask(async()=>{
   if(currentVisibilityKey()!==scope){if(FX_MONTH_COMPARISONS.get(key)===pending)FX_MONTH_COMPARISONS.delete(key);return;}
   try{
    const modules=['records','referrals','wrongCards','callReports','penaltyReports'].map(name=>'module='+name).join('&');
    const results=await Promise.allSettled([apiFetch('/api/state?'+modules+'&month='+encodeURIComponent(previous),{method:'GET',silent:true}),apiFetch('/api/ratings?month='+encodeURIComponent(previous),{method:'GET',silent:true})]);
    if(currentVisibilityKey()!==scope){if(FX_MONTH_COMPARISONS.get(key)===pending)FX_MONTH_COMPARISONS.delete(key);return;}
    if(results[0].status==='fulfilled')pending.payload=results[0].value;
    if(results[1].status==='fulfilled')pending.ratings=results[1].value;
    pending.error=!pending.payload;pending.incomeError=!pending.ratings;
   }catch(_error){pending.error=true;}
   if(currentVisibilityKey()!==scope){if(FX_MONTH_COMPARISONS.get(key)===pending)FX_MONTH_COMPARISONS.delete(key);return;}
   pending.listeners=pending.listeners.filter(listener=>listener.element.isConnected);
   pending.listeners.forEach(listener=>listener.paint(pending));
  });
 }
 entry.listeners=entry.listeners.filter(listener=>listener.element.isConnected);entry.listeners.push({element,paint});paint(entry);
}
function fxMonthlyGrowthNotes(metrics,month,current,selector){
 const notes=[...metrics.querySelectorAll('.fx-metric small')],label='vs '+new Intl.DateTimeFormat('es-PE',{month:'short',timeZone:'UTC'}).format(new Date(fxPreviousMonth(month)+'-15T12:00:00Z'));
 notes.slice(0,current.length).forEach(note=>note.classList.add('fx-comparison-note'));
 fxSubscribeMonthlyComparison(month,metrics,entry=>{
  if(!metrics.isConnected&&entry.payload)return;
  let previous=null;try{if(entry.payload&&entry.ratings)previous=fxComparisonProjection(entry);else if(entry.payload){previous=fxProjectMonthlyData(entry.payload,{rows:[]},entry.month);previous.earnings=null;}}catch(_error){entry.error=true;}
  const values=previous?selector(previous):[];
  current.forEach((value,index)=>{const note=notes[index];if(!note)return;if(entry.error){note.textContent='Comparación no disponible';return;}if(!previous){note.textContent='Calculando variación…';return;}note.innerHTML=fxGrowthMarkup(value,values[index],label,!Number.isFinite(values[index])?'No disponible':index===2&&state.view==='dashboard'?money(values[index]):String(values[index]));});
 });
}
function fxElement(tag,cls,html=''){const node=document.createElement(tag);node.className=cls;node.innerHTML=html;return node;}
function fxFloatingMenu(menu){
 menu.addEventListener('toggle',()=>{if(!menu.open)return;const summary=menu.querySelector('summary'),content=menu.querySelector('div'),rect=summary.getBoundingClientRect();if(!content)return;content.style.position='fixed';content.style.left=Math.max(8,Math.min(rect.right-Math.max(155,content.offsetWidth),innerWidth-Math.max(165,content.offsetWidth+8)))+'px';content.style.top=(rect.bottom+content.offsetHeight+8>innerHeight?Math.max(8,rect.top-content.offsetHeight-6):rect.bottom+5)+'px';content.style.right='auto';});
}
function fxPanel(title,content,cls=''){const panel=fxElement('section','fx-panel '+cls,'<div class="fx-panel-head"><h2>'+esc(title)+'</h2></div>');if(typeof content==='string')panel.insertAdjacentHTML('beforeend',content);else if(content)panel.append(content);return panel;}
function fxMetric(label,value,icon='document',tone='blue',note='Periodo seleccionado'){
 return '<article class="fx-metric '+tone+'"><span class="fx-metric-icon">'+redesignIcon(icon)+'</span><div><span class="fx-label">'+esc(label)+'</span><strong class="fx-value">'+esc(String(value))+'</strong><small>'+esc(note)+'</small></div><svg class="fx-mini-bars" viewBox="0 0 25 24" aria-hidden="true"><path d="M4 21v-5m8 5V9m8 12V3"/></svg></article>';
}
function fxMetrics(items){return fxElement('div','fx-metrics',items.map(item=>fxMetric(...item)).join(''));}
function fxNavigate(view){document.querySelector('.nav [data-nav="'+view+'"]')?.click();}
function fxRefreshAttendanceView(){
 if(!state.currentUser||!['dashboard','asistencia','sueldos','colaboradores','estadisticas','mis-comisiones','reportes','cierre','safetypay'].includes(state.view))return;
 const focused=activeAttendanceFilter();if(focused)renderPreservingField(focused);else preserveMainScroll(()=>render());
}
function fxAdvanced(nodes,title='Más información y herramientas'){
 const available=nodes.filter(node=>node&&node.isConnected);if(!available.length)return null;
 const details=fxElement('details','fx-advanced','<summary>'+esc(title)+'</summary>');available[0].before(details);available.forEach(node=>details.append(node));return details;
}
function fxCardMetrics(grid){
 if(!grid)return null;
 const cards=[...grid.children].filter(card=>card.querySelector('.stat-value,.stats-summary-value'));
 if(!cards.length)return null;
 const icons=['document','history','check','wallet'];
 const salary=state.view==='sueldos';
 const items=cards.slice(0,4).map((card,index)=>[
  card.querySelector('.stat-label,.stats-summary-label')?.textContent.trim()||'Resumen',
  card.querySelector('.stat-value,.stats-summary-value')?.textContent.trim()||'0',salary?['wallet','stats','document','history'][index]:icons[index],salary?['mint','mint','mint','amber'][index]:['blue','amber','mint','mint'][index],
  card.querySelector('.stat-sub,.stats-summary-sub')?.textContent.trim()||'Periodo y filtros seleccionados'
 ]);
 const metrics=fxMetrics(items);grid.before(metrics);grid.hidden=true;return metrics;
}
function fxStatusTabs(select,labels){
 if(!select)return null;
 const tabs=fxElement('div','fx-tabs');tabs.setAttribute('role','group');tabs.setAttribute('aria-label','Filtrar por estado');
 labels.forEach(([value,label])=>{const button=fxElement('button',select.value===value?'active':'',esc(label));button.type='button';button.onclick=()=>{select.value=value;select.dispatchEvent(new Event('change',{bubbles:true}));};tabs.append(button);});
 select.hidden=true;select.closest('.table-wrap')?.before(tabs);return tabs;
}
function fxCreateButton(main,submitId,label){
 const details=main.querySelector('#'+submitId)?.closest('.ui-create-panel'),header=main.querySelector('.ui-page-heading,.page-header');if(!details||!header)return;
 details.classList.add('fx-create-body');const button=fxElement('button','fx-primary',redesignIcon('plus')+esc(label));button.type='button';button.onclick=()=>{details.open=!details.open;button.setAttribute('aria-expanded',String(details.open));};button.setAttribute('aria-expanded',String(details.open));header.append(button);
}
function fxIsApprovedOperation(row){
 return !!row.validatedAt&&!row.rejectedAt&&(row.tipo==='operacion'||row.type==='OPERACION');
}
function fxChart(records,month,chartWidth=700,group=FX_STATE.chartGroup,dateLabels=false){
 const dateParts=month.split('-').map(Number),days=new Date(dateParts[0],dateParts[1],0).getDate();
 const step=group==='week'?7:1;
 const buckets=Array.from({length:Math.ceil(days/step)},(_,i)=>({label:step===1?String(i+1).padStart(2,'0'):'Sem. '+(i+1),records:0,approved:0}));
 records.forEach(row=>{const day=Number(String(row.fechaOperacion||row.fecha||row.createdAt||'').slice(8,10));const bucket=buckets[Math.floor((day-1)/step)];if(bucket){bucket.records++;if(fxIsApprovedOperation(row))bucket.approved++;}});
 const width=Math.max(280,Math.round(chartWidth)),height=220,left=38,right=16,top=12,bottom=30,max=Math.max(...buckets.map(b=>b.records),1),base=height-bottom;
 const x=i=>left+i*(width-left-right)/Math.max(1,buckets.length-1),y=value=>base-value*(base-top)/max;
 const path=key=>buckets.map((b,i)=>(i?'L':'M')+x(i).toFixed(1)+','+y(b[key]).toFixed(1)).join(' ');
 const grid=Array.from({length:5},(_,i)=>{const value=max*i/4;return '<line x1="'+left+'" x2="'+(width-right)+'" y1="'+y(value)+'" y2="'+y(value)+'"/><text x="'+(left-9)+'" y="'+(y(value)+4)+'" text-anchor="end">'+Math.round(value)+'</text>';}).join('');
 const monthLabel=new Intl.DateTimeFormat('es-PE',{month:'short',timeZone:'UTC'}).format(new Date(month+'-15T12:00:00Z')).replace('.','').toLowerCase();
 const labels=buckets.filter((_,i)=>dateLabels?[0,4,9,14,19,24,buckets.length-1].includes(i):i%Math.max(1,Math.floor(buckets.length/7))===0||i===buckets.length-1).map(b=>{const i=buckets.indexOf(b);return '<text x="'+x(i)+'" y="'+(height-8)+'" text-anchor="middle">'+(dateLabels?Number(b.label)+' '+monthLabel:b.label)+'</text>';}).join('');
 const dots=buckets.map((b,i)=>'<circle cx="'+x(i)+'" cy="'+y(b.records)+'" r="3" fill="#409cff"><title>'+esc(b.label+' · '+b.records+' registros · '+b.approved+' operaciones aprobadas')+'</title></circle>').join('');
 const hits=buckets.map((b,i)=>{const start=i*step+1,end=Math.min(days,start+step-1),label=step===1?String(start).padStart(2,'0')+'/'+String(dateParts[1]).padStart(2,'0')+'/'+dateParts[0]:'Del '+start+' al '+end+' de '+monthLabel+' de '+dateParts[0],from=i===0?left:(x(i-1)+x(i))/2,to=i===buckets.length-1?width-right:(x(i)+x(i+1))/2;return '<rect class="fx-chart-hit" x="'+from+'" y="'+top+'" width="'+(to-from)+'" height="'+(base-top)+'" fill="transparent" tabindex="0" data-chart-date="'+esc(label)+'" data-chart-records="'+b.records+'" data-chart-approved="'+b.approved+'" aria-label="'+esc(label+': '+b.records+' registros, '+b.approved+' operaciones aprobadas')+'"/>';}).join('');
 return '<svg class="fx-chart" viewBox="0 0 '+width+' '+height+'" role="group" aria-label="Registros y operaciones aprobadas del periodo"><defs><linearGradient id="fxArea" x1="0" y1="0" x2="0" y2="1"><stop stop-color="#3597ff" stop-opacity=".3"/><stop offset="1" stop-color="#3597ff" stop-opacity=".01"/></linearGradient></defs><g class="fx-chart-grid">'+grid+labels+'</g><path d="'+path('records')+' L'+x(buckets.length-1)+','+base+' L'+left+','+base+' Z" fill="url(#fxArea)"/><path d="'+path('records')+'" fill="none" stroke="#409cff" stroke-width="2.5"/><path d="'+path('approved')+'" fill="none" stroke="#54e3b3" stroke-width="2.5"/>'+dots+hits+'</svg>';
}
function fxBindChartTooltip(body){
 const tooltip=fxElement('div','fx-chart-tooltip');tooltip.hidden=true;tooltip.setAttribute('role','tooltip');body.append(tooltip);
 const hide=()=>{tooltip.hidden=true;};
 const show=event=>{const hit=event.target.closest?.('[data-chart-date]');if(!hit){hide();return;}tooltip.innerHTML='<strong>'+esc(hit.dataset.chartDate)+'</strong><span class="blue-dot">Registros <b>'+esc(hit.dataset.chartRecords)+'</b></span><span class="mint-dot">Operaciones aprobadas <b>'+esc(hit.dataset.chartApproved)+'</b></span>';tooltip.hidden=false;const bounds=body.getBoundingClientRect(),point=hit.getBoundingClientRect(),px=event.clientX??point.left+point.width/2,py=event.clientY??point.top+point.height/2;tooltip.style.left=Math.max(4,Math.min(body.clientWidth-tooltip.offsetWidth-4,px-bounds.left+12))+'px';tooltip.style.top=Math.max(4,Math.min(body.clientHeight-tooltip.offsetHeight-4,py-bounds.top-tooltip.offsetHeight-12))+'px';};
 body.onpointermove=show;body.onpointerleave=hide;body.onfocusin=show;body.onfocusout=hide;body.onkeydown=event=>{if(event.key==='Escape')hide();};
}
function fxChartPanel(records,month,title='Registros y operaciones'){
 const panel=fxPanel(title,'','fx-chart-panel');
 const modes=fxElement('div','fx-segment');[['day','Día'],['week','Semana']].forEach(([value,label])=>{const button=fxElement('button',FX_STATE.chartGroup===value?'active':'',label);button.type='button';button.onclick=()=>{FX_STATE.chartGroup=value;preserveMainScroll(()=>render());};modes.append(button);});panel.firstElementChild.insertAdjacentHTML('beforeend','<div class="fx-chart-legend"><span class="blue-dot">Registros</span><span class="mint-dot">Operaciones aprobadas</span></div>');panel.firstElementChild.append(modes);panel.append(fxElement('div','fx-chart-body',fxChart(records,month)));FX_CHART_MODELS.set(panel,{records,month});return panel;
}
function fxObserveCharts(){
 if(FX_CHART_OBSERVER)FX_CHART_OBSERVER.disconnect();
 const draw=(panel,width)=>{const model=FX_CHART_MODELS.get(panel),size=Math.max(280,Math.round(width-24));if(!panel.isConnected||!model||panel.dataset.chartWidth===String(size))return;panel.dataset.chartWidth=String(size);const body=panel.querySelector('.fx-chart-body');body.innerHTML=model.kind==='branches'?fxBranchChartSvg(model.rows,size):fxChart(model.records,model.month,size,model.group,model.dateLabels);if(model.kind!=='branches')fxBindChartTooltip(body);};
 document.querySelectorAll('.fx-chart-panel').forEach(panel=>draw(panel,panel.clientWidth));
 if(typeof ResizeObserver!=='undefined'){FX_CHART_OBSERVER=new ResizeObserver(entries=>entries.forEach(entry=>draw(entry.target,entry.contentRect.width)));document.querySelectorAll('.fx-chart-panel').forEach(panel=>FX_CHART_OBSERVER.observe(panel));}
}
function fxDashboard(main){
 const source=main.querySelector('.dashboard-shell');if(!source)return;
 const month=activeMonthKey(state.dashboardMonth),records=getVisibleRecords().filter(row=>recordAccountingMonthKey(row)===month);
 const attendanceKey=getSessionScopeKey()+'|'+month;
 if(!ATTENDANCE && !ATTENDANCE_LOADING && FX_STATE.dashboardAttendanceRequested!==attendanceKey){FX_STATE.dashboardAttendanceRequested=attendanceKey;setTimeout(async()=>{if(state.view==='dashboard'){await loadAttendance(false,true);fxRefreshAttendanceView();}},0);}
 const approved=records.filter(fxIsApprovedOperation),pending=records.filter(row=>isPendingApproval(row));
 const total=source.querySelector('.dashboard-summary-card.green .dashboard-summary-value')?.textContent.trim()||'—';
 const attendance=ATTENDANCE?.people?.length?getAttendanceRows(ATTENDANCE).filter(row=>row.date===limaTodayKey()):null;
 const present=attendance?new Set(attendance.filter(row=>row.entryTime).map(row=>row.personId)).size:0;
 const people=attendance?getAttendancePeople().filter(person=>!isInactiveCollaborator(person)).length:0;
 const metrics=fxMetrics([
  ['Registros del mes',records.length,'document','blue',monthLabelFromKey(month)],
  ['Operaciones aprobadas',approved.length,'check','mint','Validaciones confirmadas'],
  ['Comisiones generadas',total,'wallet','mint','Cálculo original del equipo'],
  ['Asistencia de hoy',attendance?present+' / '+people:'—','people','blue',attendance?'Con entrada registrada':'Disponible en Asistencia']
 ]);
 const layout=fxElement('div','fx-dashboard');const top=fxElement('div','fx-dashboard-top');top.append(fxChartPanel(records,month));
 const pendingRatings=RATINGS.filter(row=>monthKeyFromDate(row.date||row.rawDate)===month&&row.approvalStatus==='PENDING').length;
 const refs=REFERRALS.filter(row=>monthKeyFromDate(row.validatedAt||row.createdAt)===month&&!row.validatedAt&&!row.rejectedAt);
 const requests=(ATTENDANCE?.changeRequests||[]).filter(row=>!row.status||String(row.status).toUpperCase()==='PENDING');
 const reviews=fxPanel('Pendientes de revisión','','fx-review-list');
 [['document','Operaciones',pending.length,'todos'],['star','Calificaciones',pendingRatings,'calificaciones'],['people','Referidos',refs.length,'referidos'],['calendar','Solicitudes de asistencia',ATTENDANCE?requests.length:'—','asistencia']].forEach(([icon,label,count,view])=>{
  if(!document.querySelector('.nav [data-nav="'+view+'"]'))return;
  const button=fxElement('button','fx-review-row',redesignIcon(icon)+'<span>'+label+'</span><b>'+count+'</b><i>›</i>');button.type='button';button.onclick=()=>fxNavigate(view);reviews.append(button);
 });top.append(reviews);layout.append(top);
 const lower=fxElement('div','fx-dashboard-bottom');
 const sedes=[...new Set(records.map(row=>getItemSede(row)).filter(Boolean))];
 const table='<div class="fx-scroll"><table><thead><tr><th>Sede</th><th>Registros</th><th>Operaciones</th><th>Conversión</th></tr></thead><tbody>'+sedes.map(sede=>{const rows=records.filter(row=>getItemSede(row)===sede),valid=rows.filter(fxIsApprovedOperation).length,pct=rows.length?valid/rows.length*100:0;return '<tr><td>'+esc(sede)+'</td><td>'+rows.length+'</td><td>'+valid+'</td><td><div class="fx-progress-value"><span>'+pct.toFixed(1)+'%</span><div class="fx-progress"><i style="width:'+pct+'%"></i></div></div></td></tr>';}).join('')+'</tbody></table></div>';
 lower.append(fxPanel('Rendimiento por sede',table));
 const recent=records.slice().sort((a,b)=>String(b.createdAt||b.fecha).localeCompare(String(a.createdAt||a.fecha))).slice(0,5);
 const activity=fxPanel('Registros recientes','','fx-activity');
 recent.forEach(row=>{const owner=getItemOwner(row),button=fxElement('button','fx-activity-row',avatar(owner,30,10)+'<span><strong>'+esc(row.cliente||row.clientName||row.dni||'Registro')+'</strong><small>'+esc(owner.name||'')+' · '+esc(getItemSede(row))+'</small></span><em class="'+(row.validatedAt?'mint':'amber')+'">'+(row.validatedAt?'Aprobado':row.rejectedAt?'Rechazado':'Pendiente')+'</em>');button.type='button';button.onclick=()=>fxNavigate('todos');activity.append(button);});
 if(!recent.length)activity.insertAdjacentHTML('beforeend','<p class="fx-muted">Sin registros en este periodo.</p>');lower.append(activity);layout.append(lower);
 if(isAdmin()){
  const key=getSessionScopeKey()+'|'+month;
  if(SAFETYPAY_CMR_SUMMARY_KEY!==key&&!SAFETYPAY_CMR_SUMMARY_LOADING)setTimeout(async()=>{await loadSafetypayCmrSummary(month);if(state.view==='dashboard')preserveMainScroll(()=>render());},0);
  const safety=SAFETYPAY_CMR_SUMMARY_KEY===key?SAFETYPAY_CMR_SUMMARY:null,goals=getSafetypaySedeGoals(month),goal=SEDES.reduce((sum,sede)=>sum+Number(goals[sede]||0),0),pct=goal&&safety?safety.currentTotal/goal*100:0;
  const strip=fxElement('button','fx-safety-strip',redesignIcon('card')+'<span><small>SafetyPay del mes · CMR + IO</small><strong>'+(safety?money(safety.currentTotal):'Calculando…')+'</strong></span><span class="fx-strip-goal"><small>Meta conjunta</small><strong>'+money(goal)+'</strong></span><div class="fx-progress"><i style="width:'+Math.min(100,pct)+'%"></i></div><b>'+(safety?pct.toFixed(1)+'%':'—')+'</b>');strip.type='button';strip.onclick=()=>{state.safetypayMonth=month;fxNavigate('safetypay');};layout.append(strip);
 }
 source.before(metrics,layout);
 fxMonthlyGrowthNotes(metrics,month,[records.length,approved.length,Number(total.replace(/[^0-9.\-]/g,''))],previous=>[previous.records.length,previous.records.filter(fxIsApprovedOperation).length,previous.earnings]);
 const attendanceNote=metrics.querySelector('.fx-metric:last-child small');if(attendanceNote){const yesterday=new Date(limaTodayKey()+'T12:00:00Z');yesterday.setUTCDate(yesterday.getUTCDate()-1);const previousRows=ATTENDANCE?getAttendanceRows(ATTENDANCE).filter(row=>row.date===yesterday.toISOString().slice(0,10)):[],previousPeople=new Set(previousRows.filter(row=>row.entryTime).map(row=>row.personId)).size;attendanceNote.classList.add('fx-comparison-note');attendanceNote.innerHTML=attendance&&previousRows.length?fxGrowthMarkup(present,previousPeople,'vs ayer',previousPeople+' con entrada'):'Sin datos de ayer';}
 const monthSelect=source.querySelector('#dashboardMonth');const header=main.querySelector('.ui-page-heading,.page-header');if(monthSelect&&header)header.append(monthSelect);
 const advanced=fxAdvanced([source],'Comisiones por colaborador, alertas y reportes');if(advanced)advanced.classList.add('fx-dashboard-tools');
 main.querySelector('.ui-dashboard-charts')?.remove();
}
function fxStatisticsModel(records,users,ratings,month,sede,commissionForUser){
 const scopedRecords=records.filter(row=>recordAccountingMonthKey(row)===month&&(!sede||getItemSede(row)===sede));
 const members=users.filter(user=>user.role!=='admin'&&(!sede||userSede(user)===sede));
 const rows=members.map(user=>{
  const own=scopedRecords.filter(row=>Number(row.userId)===Number(user.id)),operations=own.filter(fxIsApprovedOperation).length;
  const ownRatings=ratings.filter(row=>Number(row.matchedUserId)===Number(user.id)&&monthKeyFromDate(row.date||row.rawDate)===month&&Number(row.rating)>=1&&Number(row.rating)<=5);
  return {id:Number(user.id),name:user.name,username:user.username||'',sede:userSede(user),records:own.length,operations,conversion:own.length?operations/own.length*100:0,rating:ownRatings.length?ownRatings.reduce((sum,row)=>sum+Number(row.rating),0)/ownRatings.length:null,ratingCount:ownRatings.length,commissions:Number(commissionForUser(user,month)||0)};
 });
 const allowed=new Set([...members.map(user=>userSede(user)),...scopedRecords.map(row=>getItemSede(row))]);
 const order=['Lince','Norte','Sur','Miraflores',...allowed];
 const branches=[...new Set(order)].filter(site=>allowed.has(site)&&(!sede||site===sede)).map(site=>{
  const branchRecords=scopedRecords.filter(row=>getItemSede(row)===site),operations=branchRecords.filter(fxIsApprovedOperation).length;
  return {name:site,records:branchRecords.length,operations,conversion:branchRecords.length?operations/branchRecords.length*100:0,commissions:rows.filter(row=>row.sede===site).reduce((sum,row)=>sum+row.commissions,0)};
 });
 const approved=scopedRecords.filter(fxIsApprovedOperation).length;
 return {month,sede,records:scopedRecords,rows,branches,totalRecords:scopedRecords.length,operations:approved,conversion:scopedRecords.length?approved/scopedRecords.length*100:0,commissions:rows.reduce((sum,row)=>sum+row.commissions,0),userIds:members.map(user=>Number(user.id))};
}
function fxStatsIcon(name){
 const paths={records:'<path d="M6 20V11m6 9V4m6 16V8"/>',approved:'<circle cx="12" cy="12" r="9"/><path d="m8 12 3 3 5-6"/>',conversion:'<path d="M6 19 18 5"/><circle cx="7" cy="7" r="2.5"/><circle cx="17" cy="17" r="2.5"/>',commissions:'<ellipse cx="9" cy="6" rx="6" ry="3"/><path d="M3 6v8c0 4 12 4 12 0V6M3 10c0 4 12 4 12 0"/><path d="M15 11c8-2 9 7 3 9-3 1-6 0-6-2m9-3c-2 2-5 2-7 1"/>',search:'<circle cx="10" cy="10" r="6.5"/><path d="m15 15 5 5"/>'};
 return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'+paths[name]+'</svg>';
}
function fxBranchChartSvg(rows,chartWidth=700){
 const width=Math.max(280,Math.round(chartWidth)),height=220,left=79,right=39,top=10,bottom=30,plotWidth=width-left-right;
 const maximum=Math.max(1,...rows.flatMap(row=>[row.records,row.operations])),rawStep=maximum/8,power=10**Math.floor(Math.log10(rawStep)),step=([1,2,5,10].find(value=>value*power>=rawStep)||10)*power,axisMax=Math.ceil(maximum/step)*step;
 const x=value=>left+value/axisMax*plotWidth,groupHeight=(height-top-bottom)/Math.max(1,rows.length),barHeight=Math.min(13,groupHeight*.28),gap=3;
 let ticks='';for(let value=0;value<=axisMax+step*.01;value+=step)ticks+='<line x1="'+x(value)+'" x2="'+x(value)+'" y1="'+top+'" y2="'+(height-bottom)+'"/><text x="'+x(value)+'" y="'+(height-9)+'" text-anchor="middle">'+Number(value.toFixed(2))+'</text>';
 const bars=rows.map((row,index)=>{const y=top+index*groupHeight+(groupHeight-barHeight*2-gap)/2;return '<g><text class="fx-branch-label" x="'+(left-10)+'" y="'+(y+barHeight+gap/2+4)+'" text-anchor="end">'+esc(row.name)+'</text><rect class="fx-branch-records" data-series="records" x="'+left+'" y="'+y+'" width="'+(x(row.records)-left)+'" height="'+barHeight+'" rx="1"><title>'+esc(row.name+': '+row.records+' registros')+'</title></rect><text class="fx-branch-count" x="'+(x(row.records)+6)+'" y="'+(y+barHeight-2)+'">'+row.records+'</text><rect class="fx-branch-operations" data-series="operations" x="'+left+'" y="'+(y+barHeight+gap)+'" width="'+(x(row.operations)-left)+'" height="'+barHeight+'" rx="1"><title>'+esc(row.name+': '+row.operations+' operaciones aprobadas')+'</title></rect><text class="fx-branch-count" x="'+(x(row.operations)+6)+'" y="'+(y+barHeight*2+gap-2)+'">'+row.operations+'</text></g>';}).join('');
 return '<svg class="fx-chart fx-paired-bars" viewBox="0 0 '+width+' '+height+'" role="img" aria-label="Comparación de registros y operaciones aprobadas por sede"><g class="fx-chart-grid">'+ticks+'</g>'+bars+'<line class="fx-branch-axis" x1="'+left+'" x2="'+(width-right)+'" y1="'+(height-bottom)+'" y2="'+(height-bottom)+'"/></svg>';
}
function fxStatsRatingsMarkup(row){
 if(row.rating===null)return '<span class="fx-no-rating">Sin calificaciones</span>';
 return '<span class="fx-rating-stars" role="img" aria-label="'+row.rating.toFixed(1)+' de 5" title="'+row.ratingCount+' calificaciones"><span>★★★★★</span><span class="fx-rating-fill" style="width:'+row.rating/5*100+'%">★★★★★</span></span><span class="fx-rating-number">'+row.rating.toFixed(1)+'</span>';
}
function fxStatsFilteredRows(rows,search,sede,sort='records',direction='desc'){
 const query=normalizePersonName(search||''),sign=direction==='asc'?1:-1;
 return rows.filter(row=>(!sede||row.sede===sede)&&(!query||normalizePersonName(row.name+' '+row.username).includes(query))).slice().sort((a,b)=>{
  if(a[sort]===null&&b[sort]!==null)return 1;if(b[sort]===null&&a[sort]!==null)return -1;
  const compare=typeof a[sort]==='string'?a[sort].localeCompare(b[sort],'es'):Number(a[sort]||0)-Number(b[sort]||0);
  return compare*sign||a.name.localeCompare(b.name,'es');
 });
}
function fxStatsPeoplePanel(model){
 const panel=fxPanel('Rendimiento por colaborador','','fx-stats-people fx-ranking');
 const filters=fxElement('div','fx-stats-people-filters','<label class="fx-stats-search">'+fxStatsIcon('search')+'<input type="search" id="fxStatsPeopleSearch" class="search-input" aria-label="Buscar colaborador" placeholder="Buscar colaborador..." value="'+esc(FX_STATE.statsPeopleSearch||'')+'"/></label><select class="filter-select" id="fxStatsPeopleSede" aria-label="Filtrar colaboradores por sede"><option value="">Todas las sedes</option>'+[...new Set(model.rows.map(row=>row.sede))].map(site=>'<option value="'+esc(site)+'"'+(FX_STATE.statsPeopleSede===site?' selected':'')+'>'+esc(site)+'</option>').join('')+'</select>');
 panel.firstElementChild.append(filters);
 const columns=[['name','Colaborador'],['sede','Sede'],['records','Registros'],['operations','Operaciones'],['conversion','Conversión'],['rating','Calificaciones'],['commissions','Comisiones']];
 const table=fxElement('div','fx-stats-table-scroll','<table class="fx-stats-people-table"><thead><tr>'+columns.map(([key,label])=>'<th scope="col" aria-sort="none"><button type="button" data-fx-stats-sort="'+key+'">'+label+'<span aria-hidden="true">↕</span></button></th>').join('')+'</tr></thead><tbody></tbody></table>');
 const footer=fxElement('footer','fx-table-pagination');panel.append(table,footer);
 const update=()=>{
  const rows=fxStatsFilteredRows(model.rows,FX_STATE.statsPeopleSearch,FX_STATE.statsPeopleSede,FX_STATE.statsPeopleSort||'records',FX_STATE.statsPeopleDirection||'desc'),count=Math.max(1,Math.ceil(rows.length/6));
  FX_STATE.statsPeoplePage=Math.max(1,Math.min(FX_STATE.statsPeoplePage||1,count));const start=(FX_STATE.statsPeoplePage-1)*6;
  table.querySelector('tbody').innerHTML=rows.slice(start,start+6).map(row=>'<tr data-fx-stats-user="'+row.id+'"><td title="'+esc(row.name)+'">'+esc(row.name)+'</td><td>'+esc(row.sede)+'</td><td>'+row.records+'</td><td>'+row.operations+'</td><td>'+row.conversion.toFixed(1)+'%</td><td>'+fxStatsRatingsMarkup(row)+'</td><td>'+money(row.commissions)+'</td></tr>').join('')||'<tr><td colspan="7" class="fx-stats-empty">No hay colaboradores con estos filtros.</td></tr>';
  table.querySelectorAll('th').forEach(th=>{const key=th.querySelector('button').dataset.fxStatsSort;th.setAttribute('aria-sort',key===(FX_STATE.statsPeopleSort||'records')?(FX_STATE.statsPeopleDirection==='asc'?'ascending':'descending'):'none');});
  footer.innerHTML='<span>Mostrando '+(rows.length?start+1:0)+'–'+Math.min(start+6,rows.length)+' de '+rows.length+' colaboradores</span><div></div>';
  const pages=footer.lastElementChild,make=(label,page,disabled,aria)=>{const button=fxElement('button',page===FX_STATE.statsPeoplePage&&!aria?'active':'',label);button.type='button';button.disabled=disabled;if(aria)button.setAttribute('aria-label',aria);else button.setAttribute('aria-label','Página de colaboradores '+page);button.onclick=()=>{FX_STATE.statsPeoplePage=page;update();};pages.append(button);};
  make('‹',FX_STATE.statsPeoplePage-1,FX_STATE.statsPeoplePage===1,'Página anterior de colaboradores');for(let number=1;number<=count;number++)make(String(number),number,false);make('›',FX_STATE.statsPeoplePage+1,FX_STATE.statsPeoplePage===count,'Página siguiente de colaboradores');
 };
 filters.querySelector('input').oninput=event=>{FX_STATE.statsPeopleSearch=event.target.value;FX_STATE.statsPeoplePage=1;update();};filters.querySelector('select').onchange=event=>{FX_STATE.statsPeopleSede=event.target.value;FX_STATE.statsPeoplePage=1;update();};
 table.querySelectorAll('[data-fx-stats-sort]').forEach(button=>{button.onclick=()=>{const key=button.dataset.fxStatsSort;FX_STATE.statsPeopleDirection=FX_STATE.statsPeopleSort===key&&FX_STATE.statsPeopleDirection==='desc'?'asc':'desc';if(['name','sede'].includes(key)&&FX_STATE.statsPeopleSort!==key)FX_STATE.statsPeopleDirection='asc';FX_STATE.statsPeopleSort=key;FX_STATE.statsPeoplePage=1;update();};});update();return panel;
}
function fxStatsComparisonNotes(metrics,model){
 const notes=[...metrics.querySelectorAll('small')];notes.forEach(note=>{note.classList.add('fx-comparison-note','fx-stats-trend');note.parentElement.parentElement.append(note);});
 const label='vs mes anterior';fxSubscribeMonthlyComparison(model.month,metrics,entry=>{
  let previous=null;try{if(entry.payload&&entry.ratings)previous=fxComparisonProjection(entry);else if(entry.payload){previous=fxProjectMonthlyData(entry.payload,{rows:[]},entry.month);previous.earningsByUser=null;}}catch(_error){entry.error=true;}
  if(!previous){notes.forEach(note=>note.textContent=entry.error?'Comparación no disponible':'Calculando variación…');return;}
  const records=previous.records.filter(row=>!model.sede||getItemSede(row)===model.sede),operations=records.filter(fxIsApprovedOperation).length,conversion=records.length?operations/records.length*100:0,commissions=previous.earningsByUser?model.userIds.reduce((sum,id)=>sum+Number(previous.earningsByUser.get(id)||0),0):null;
  [[model.totalRecords,records.length],[model.operations,operations],[model.conversion,conversion],[model.commissions,commissions]].forEach(([current,old],index)=>{
   if(index!==2){notes[index].innerHTML=fxGrowthMarkup(current,old,label,index===3?(old===null?'No disponible':money(old)):String(old));return;}
   const delta=Math.round((current-old)*10)/10,kind=delta>0?'up':delta<0?'down':'flat';notes[index].innerHTML='<span class="fx-growth '+kind+'" title="Conversión anterior: '+old.toFixed(1)+'%">'+(delta>0?'↑ +':delta<0?'↓ ':'→ ')+delta.toFixed(1)+' pts</span><span class="fx-growth-label">'+label+'</span>';
  });
 });
}
function fxStatsExportCsv(rows){
 const quote=value=>'"'+String(value??'').replace(/"/g,'""')+'"',text=value=>/^[=+\-@\t\r]/.test(String(value))?"'"+value:value;
 const output=[['Colaborador','Sede','Registros','Operaciones aprobadas','Conversión (%)','Promedio calificaciones','Comisiones (S/)'],...rows.map(row=>[text(row.name),text(row.sede),row.records,row.operations,row.conversion.toFixed(1),row.rating===null?'':row.rating.toFixed(1),row.commissions.toFixed(2)])];
 return '\uFEFF'+output.map(row=>row.map(quote).join(';')).join('\r\n');
}
function fxStatistics(main){
 const shell=main.querySelector('.stats-shell');if(!shell)return;
 const month=activeMonthKey(state.recordsMonth),sede=(isAdmin()||canPreviewAllSedesAsManager())?(state.statsSede||state.managerViewSede||''):userSede(state.currentUser),identity=currentVisibilityKey();
 if(FX_STATE.statsIdentity!==identity){FX_STATE.statsIdentity=identity;FX_STATE.statsPeopleSearch='';FX_STATE.statsPeopleSede='';FX_STATE.statsPeopleSort='records';FX_STATE.statsPeopleDirection='desc';FX_STATE.statsPeoplePage=1;}
 const scope=month+'|'+sede;if(FX_STATE.statsPeopleScope!==scope){FX_STATE.statsPeopleScope=scope;FX_STATE.statsPeoplePage=1;if(sede)FX_STATE.statsPeopleSede='';}
 const archive=visibleArchivedRecordsForMonth(month),records=archive.length?archive:getVisibleRecords(),ratings=mergeArchivedRatingRows(visibleArchivedRatingsForMonth(month),RATINGS);
 const model=fxStatisticsModel(records,getVisibleUsers(),ratings,month,sede,getTotalIncentiveForUser);
 const heading=shell.querySelector('.ui-page-heading,.page-header'),filterPanel=shell.querySelector('#recordsMonth')?.closest('.table-wrap');
 if(heading){['recordsMonth','statsSede'].forEach(id=>{const control=shell.querySelector('#'+id);if(control)heading.append(control);});filterPanel?.remove();const title=heading.querySelector('.page-title'),subtitle=heading.querySelector('.page-sub');if(title)title.textContent='Estadísticas';if(subtitle)subtitle.textContent='Indicadores y evolución de tu equipo';}
 const legacy=fxAdvanced([...shell.children].filter(node=>node!==heading),'Más análisis y parámetros');if(legacy)shell.append(legacy);
 const content=fxElement('div','fx-statistics-content');if(heading)heading.after(content);else shell.prepend(content);
 const metrics=fxMetrics([['Registros',model.totalRecords,'stats','blue',''],['Operaciones aprobadas',model.operations,'check','blue',''],['Conversión',model.conversion.toFixed(1)+'%','stats','blue',''],['Comisiones',money(model.commissions),'wallet','blue','']]);metrics.classList.add('fx-stats-metrics');metrics.querySelectorAll('.fx-metric-icon').forEach((icon,index)=>icon.innerHTML=fxStatsIcon(['records','approved','conversion','commissions'][index]));content.append(metrics);fxStatsComparisonNotes(metrics,model);
 const tabs=fxElement('div','fx-tabs fx-stats-tabs');[['general','General'],['sede','Por sede'],['people','Por colaborador']].forEach(([key,label])=>{const button=fxElement('button',FX_STATE.statsTab===key?'active':'',label);button.type='button';button.onclick=()=>{FX_STATE.statsTab=key;preserveMainScroll(()=>render());};tabs.append(button);});content.append(tabs);
 const charts=fxElement('div','fx-stat-charts fx-stats-reference-charts'),line=fxChartPanel(model.records,month,'Evolución del mes');line.querySelector('.fx-segment')?.remove();line.querySelector('.mint-dot').textContent='Operaciones';FX_CHART_MODELS.set(line,{records:model.records,month,group:'day',dateLabels:true});line.querySelector('.fx-chart-body').innerHTML=fxChart(model.records,month,700,'day',true);
 const branch=fxPanel('Comparación por sede','','fx-chart-panel fx-branch-panel');branch.firstElementChild.insertAdjacentHTML('beforeend','<div class="fx-chart-legend"><span class="blue-dot">Registros</span><span class="mint-dot">Operaciones</span></div>');branch.append(fxElement('div','fx-chart-body',fxBranchChartSvg(model.branches)));FX_CHART_MODELS.set(branch,{kind:'branches',rows:model.branches});charts.append(line,branch);content.append(charts);
 const people=fxStatsPeoplePanel(model);content.append(people);
 if(FX_STATE.statsTab==='people')charts.hidden=true;
 if(FX_STATE.statsTab==='sede'){people.hidden=true;line.hidden=true;charts.classList.add('fx-stats-sede-only');const summary=fxPanel('Rendimiento por sede','<div class="fx-stats-table-scroll"><table class="fx-stats-branch-table"><thead><tr><th>Sede</th><th>Registros</th><th>Operaciones</th><th>Conversión</th><th>Comisiones</th></tr></thead><tbody>'+model.branches.map(row=>'<tr><td>'+esc(row.name)+'</td><td>'+row.records+'</td><td>'+row.operations+'</td><td>'+row.conversion.toFixed(1)+'%</td><td>'+money(row.commissions)+'</td></tr>').join('')+'</tbody></table></div>');content.append(summary);}
 if(heading){const exportButton=fxElement('button','btn-sm fx-stats-export','<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="M12 3v12m-5-5 5 5 5-5M4 15v6h16v-6"/></svg>Exportar');exportButton.type='button';exportButton.title='Exportar los colaboradores filtrados a CSV';exportButton.onclick=()=>{const rows=fxStatsFilteredRows(model.rows,FX_STATE.statsPeopleSearch,FX_STATE.statsPeopleSede,FX_STATE.statsPeopleSort||'records',FX_STATE.statsPeopleDirection||'desc');downloadBlobFile('estadisticas-'+month+'.csv',new Blob([fxStatsExportCsv(rows)],{type:'text/csv;charset=utf-8'}));};heading.append(exportButton);}
 main.querySelector('.ui-dashboard-charts')?.remove();
}
function fxCollaborators(main){
 const workers=main.querySelector('.workers-grid,.worker-grid');
 const cards=[...main.querySelectorAll('.worker-card')];if(!cards.length)return;
 const people=getSalaryPeople({ignoreFilters:true}).people||[],active=people.filter(person=>!isInactiveCollaborator(person)).length,sedes=new Set(people.map(person=>getPersonSede(person)).filter(Boolean)).size;
 const strip=fxElement('div','fx-team-strip',[['people',people.length,'colaboradores'],['check',active,'activos'],['history',people.length-active,'inactivos'],['people',sedes,'sedes']].map(([icon,count,label])=>'<div>'+redesignIcon(icon)+'<span><strong>'+count+'</strong><small>'+label+'</small></span></div>').join(''));
 const first=main.querySelector('.workers-toolbar')||workers||cards[0].parentElement;first.before(strip);
 const create=main.querySelector('#createLooseUserBtn');if(create)main.querySelector('.ui-page-heading,.page-header')?.append(create);
 cards.forEach(card=>{
  const footer=card.querySelector('.worker-card-footer,.worker-actions');
  if(!footer)return;
  const secondary=[...footer.querySelectorAll('button')].filter(button=>/renuncia|inactivar|activar|reactivar/i.test(button.textContent));
  if(secondary.length){const menu=fxElement('details','fx-worker-menu','<summary aria-label="Más acciones del colaborador">···</summary><div></div>');secondary.forEach(button=>menu.lastElementChild.append(button));footer.append(menu);fxFloatingMenu(menu);}
 });
}
function fxReferrals(main){
 const oldGrid=main.querySelector('.stat-grid'),rows=getReferralRows();
 const pending=rows.filter(row=>!row.validatedAt&&!row.rejectedAt).length,approved=rows.filter(row=>row.validatedAt&&!row.rejectedAt),amount=approved.reduce((sum,row)=>sum+Number(row.referralCommission||0),0);
 if(oldGrid){oldGrid.before(fxMetrics([['Referidos visibles',rows.length,'people'],['Pendientes',pending,'history','amber'],['Aprobados',approved.length,'check','mint'],['Comisiones aprobadas',money(amount),'wallet','mint']]));oldGrid.hidden=true;}
 fxStatusTabs(main.querySelector('#referralStatus'),[['','Todos'],['pending','Pendientes'],['validated','Aprobados'],['rejected','Rechazados']]);
 const rule=main.querySelector('.alert-banner');if(rule){const create=main.querySelector('.ui-create-panel');if(create)create.append(rule);}
 main.querySelectorAll('.referral-actions').forEach(actions=>{
  const buttons=[...actions.querySelectorAll('button')],secondary=buttons.filter(button=>/eliminar|agregar efect/i.test(button.textContent));
  if(!secondary.length)return;
  const menu=fxElement('details','fx-row-menu','<summary aria-label="Más acciones del referido">···</summary><div></div>');secondary.forEach(button=>menu.lastElementChild.append(button));actions.append(menu);fxFloatingMenu(menu);
 });
 const table=main.querySelector('.referrals-table');if(table){table.querySelector('colgroup')?.remove();const heads=[...table.querySelectorAll('thead th')];heads[heads.length-2]?.remove();const widths=isEmployee()?[20,13,8,11,9,14,12,13]:[15,10,16,6,9,8,11,10,15];table.querySelectorAll('thead th').forEach((head,index)=>{head.style.width=widths[index]+'%';});table.querySelectorAll('tbody tr').forEach(row=>{if(row.children.length<8)return;const notes=row.children[row.children.length-2],menu=row.querySelector('.fx-row-menu>div');if(menu)menu.insertAdjacentHTML('afterbegin','<p class="fx-referral-notes">'+esc(notes.textContent.trim())+'</p>');notes.remove();});}
}
function fxRatings(main){
 const grid=main.querySelector('.stat-grid'),rows=getRatingRows(),rated=rows.filter(row=>Number(row.rating)>0),mean=rated.length?rated.reduce((sum,row)=>sum+Number(row.rating),0)/rated.length:0;
 if(grid){const approvedAmount=grid.querySelectorAll('.stat-value')[3]?.textContent.trim()||money(0);grid.before(fxMetrics([['Calificaciones recibidas',rows.length,'document','blue'],['Promedio',rated.length?mean.toFixed(1)+' ★':'—','star','amber','Respuestas con estrellas'],['Pendientes',rows.filter(row=>row.approvalStatus==='PENDING').length,'history','amber'],['Comisión aprobada',approvedAmount,'wallet','mint']]));grid.hidden=true;}
 fxStatusTabs(main.querySelector('#ratingStatus'),[['','Todas'],['pending','Pendientes'],['approved','Aprobadas'],['invalid','No válidas'],['rejected','Rechazadas']]);
 main.querySelectorAll('.ui-rating-table tbody tr').forEach(row=>{if(row.children[6]?.textContent.includes('Aprobada')){const secondary=row.querySelector('.ui-row-menu-content'),reject=row.querySelector('.ui-rating-primary [data-rating-reject]');if(secondary&&reject)secondary.append(reject);}});
}
function fxSafetyGoalCards(grid,month){
 const cards=[...grid.querySelectorAll('.safetypay-goal-card')];
 cards.forEach(card=>{
  const oldLabel=card.querySelector('.stat-label')?.textContent||'';
  const sede=card.dataset.safetypayGoal||SEDES.find(site=>oldLabel.startsWith('Meta '+site+' -'));
  if(!sede)return;
  const progress=safetypayProgress(getSafetypaySedeRows(sede,month),sede,month);
  const percentage=progress.goal>0?Math.max(0,progress.total/progress.goal*100):0,complete=percentage>=100;
  card.classList.add('fx-goal-card');card.dataset.goalSede=sede;
  card.dataset.goalTone=complete?'complete':percentage<25?'low':'progress';
  card.innerHTML='<div class="fx-goal-heading"><span class="fx-goal-site"><svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 2a7 7 0 0 0-7 7c0 5 7 13 7 13s7-8 7-13a7 7 0 0 0-7-7m0 10a3 3 0 1 1 0-6 3 3 0 0 1 0 6"/></svg>'+esc(sede)+'</span>'+(complete?'<span class="fx-goal-complete">Meta cumplida</span>':'')+'</div><strong class="fx-goal-amount">'+money(progress.total)+'</strong><div class="fx-goal-meta"><span>Meta: '+money(progress.goal)+'</span><strong>'+percentage.toFixed(1).replace(/\.0$/,'')+'%</strong></div><div class="fx-goal-track" role="meter" aria-label="Avance de '+esc(sede)+'" aria-valuemin="0" aria-valuemax="100" aria-valuenow="'+Math.min(100,percentage).toFixed(1)+'" aria-valuetext="'+percentage.toFixed(1)+'% de la meta"><span style="width:'+Math.min(100,percentage)+'%"></span></div>';
  if(card.hasAttribute('data-safetypay-goal')){card.tabIndex=0;card.setAttribute('role','button');card.setAttribute('aria-label','Ver códigos de '+sede);card.onkeydown=event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();card.click();}};}
 });
 const order=['Lince','Norte','Sur','Miraflores'];cards.sort((a,b)=>order.indexOf(a.dataset.goalSede)-order.indexOf(b.dataset.goalSede)).forEach(card=>grid.append(card));
}
function fxSafety(main){
 const overview=main.querySelector('.safetypay-admin-overview'),hero=main.querySelector('.safetypay-cmr-card');
 if(overview&&hero){overview.before(hero);overview.classList.add('fx-safety-tools');fxAdvanced([overview],'Metas y administración de SafetyPay');}
 if(hero){hero.classList.add('fx-safety-hero');const title=hero.querySelector('.safetypay-cmr-title'),total=hero.querySelector('.safetypay-cmr-total'),comparison=hero.querySelector('.safetypay-cmr-comparison'),logo=hero.querySelector('img'),copy=fxElement('span','fx-safety-copy');[title,total,comparison].filter(Boolean).forEach(node=>copy.append(node));hero.append(copy);const goals=getSafetypaySedeGoals(safetypayMonthKey()),target=SEDES.reduce((sum,sede)=>sum+Number(goals[sede]||0),0),summary=SAFETYPAY_CMR_SUMMARY_KEY===getSessionScopeKey()+'|'+safetypayMonthKey()?SAFETYPAY_CMR_SUMMARY:null,pct=summary&&target?summary.currentTotal/target*100:0;hero.insertAdjacentHTML('beforeend','<span class="fx-hero-progress"><small>Meta total</small><strong>'+money(target)+'</strong><span class="fx-progress-value"><span class="fx-progress"><i style="width:'+Math.min(100,pct)+'%"></i></span><b>'+(summary?pct.toFixed(1)+'%':'—')+'</b></span></span>');if(logo)hero.append(logo);}
 const stats=[...main.querySelectorAll('.stat-grid')];stats.forEach(grid=>{fxAdvanced([grid],grid.textContent.includes('Bancos por monto')?'Distribución por colaborador, banco y código':'Resumen del código y controles de duplicados');});
 const month=safetypayMonthKey(),goals=main.querySelector('.safetypay-goal-grid'),sede=state.safetypaySede||state.managerViewSede||userSede(state.currentUser)||SEDES[0];
 if(goals){
  fxSafetyGoalCards(goals,month);
  if(!ATTENDANCE&&!ATTENDANCE_LOADING&&FX_STATE.safetyAttendanceRequested!==getSessionScopeKey()){FX_STATE.safetyAttendanceRequested=getSessionScopeKey();setTimeout(async()=>{if(state.view==='safetypay'){await loadAttendance(false,true);fxRefreshAttendanceView();}},0);}
  const people=ATTENDANCE?.people||[],eligible=safetypaySharedBonusEligiblePeople(people,sede,month),pool=getSafetypaySharedBonusPool();
  const strip=fxElement('details','fx-bonus-strip','<summary>'+redesignIcon('people')+'<strong>Bono de sede · '+esc(sede)+'</strong><span>'+money(pool)+' · '+(ATTENDANCE?eligible.length+' colaboradores elegibles':'Cargando equipo…')+'</span><small>Atención al Cliente y Jefe de Sede</small><b>Ver reparto →</b></summary><div class="fx-bonus-people">'+(eligible.length?eligible.map(person=>'<div><span>'+esc(person.personName)+'</span><strong>'+money(safetypaySharedBonusForPerson(person,people,month))+'</strong></div>').join(''):'<p>Sin reparto habilitado para la sede y periodo seleccionados.</p>')+'</div>');goals.after(strip);
 }
 const tabs=fxElement('div','fx-tabs','<button class="active" type="button">Códigos registrados</button><button type="button">Metas por sede</button>');
 const codePanel=main.querySelector('#safetypaySearch')?.closest('.table-wrap');
 if(codePanel){
  const table=codePanel.querySelector('table');if(table){table.classList.add('fx-safety-table');const heading=table.querySelector('thead tr');if(heading)heading.innerHTML=['Fecha','Código','Tipo','Colaborador','Sede','Monto','Estado',''].map(label=>'<th>'+label+'</th>').join('');table.querySelectorAll('tbody tr').forEach(row=>{const cells=[...row.children];if(cells.length<9){cells[0]?.setAttribute('colspan','8');return;}const sede=cells[7].querySelector('span'),sedeCell=fxElement('td','',esc((sede?.textContent||'').replace(/^\s*[-–]\s*/,'')));sede?.remove();const duplicate=!!cells[3].querySelector('.danger'),status=fxElement('td','',duplicate?'<span class="days-chip danger">Duplicado</span>':'<span class="days-chip ok">Registrado</span>'),more=fxElement('td','');const details=fxElement('details','fx-row-menu','<summary aria-label="Detalles y acciones del código">···</summary><div class="fx-code-info">'+[[0,'Cliente'],[1,'Código cliente'],[2,'Tarjeta'],[6,'Operación']].map(([index,label])=>'<p><small>'+label+'</small><strong>'+esc(cells[index].textContent.trim())+'</strong></p>').join('')+'</div>');if(cells[9])while(cells[9].firstChild)details.lastElementChild.append(cells[9].firstChild);more.append(details);row.replaceChildren(cells[8],cells[4],cells[3],cells[7],sedeCell,cells[5],status,more);fxFloatingMenu(details);});}
  codePanel.before(tabs);tabs.children[0].onclick=()=>{tabs.querySelectorAll('button').forEach(b=>b.classList.remove('active'));tabs.children[0].classList.add('active');codePanel.hidden=false;};tabs.children[1].onclick=()=>{tabs.querySelectorAll('button').forEach(b=>b.classList.remove('active'));tabs.children[1].classList.add('active');codePanel.hidden=true;main.querySelector('.safetypay-goal-grid')?.scrollIntoView({behavior:'smooth',block:'nearest'});};
 }
}
function fxAttendance(main){
 const sourceInfo=main.querySelector('.ui-source-panel');if(sourceInfo)main.append(sourceInfo);
 const hero=main.querySelector('.attendance-hero'),period=main.querySelector('#attendanceMonth');if(hero&&period)hero.append(period);
 const tabs=main.querySelector('.tabs'),requests=main.querySelector('.ui-review-panel'),panel=main.querySelector('#attendanceSearch')?.closest('.table-wrap');
 if(panel){const toolbar=panel.querySelector('.table-header'),more=fxElement('details','fx-filter-menu','<summary>Más filtros</summary><div></div>');['attendanceDepartment','attendancePerson'].forEach(id=>{const control=panel.querySelector('#'+id);if(control)more.lastElementChild.append(control);});if(more.lastElementChild.children.length&&toolbar){toolbar.append(more);fxFloatingMenu(more);}const note=[...panel.children].find(node=>node.textContent.trim().startsWith('Los nuevos marcajes'));if(note){note.classList.add('fx-attendance-note');panel.append(note);}}
 if(tabs&&requests){[...tabs.children].forEach(button=>button.addEventListener('click',()=>{FX_STATE.attendanceRequests=false;},{capture:true}));const button=fxElement('button','tab'+(FX_STATE.attendanceRequests?' active':''),'Solicitudes '+(requests.querySelector('.table-title')?.textContent.match(/\(\d+\)/)?.[0]||''));button.type='button';button.onclick=()=>{FX_STATE.attendanceRequests=!FX_STATE.attendanceRequests;preserveMainScroll(()=>render());};tabs.append(button);requests.hidden=!FX_STATE.attendanceRequests;if(FX_STATE.attendanceRequests){requests.open=true;if(panel)panel.hidden=true;[...tabs.children].forEach(tab=>tab.classList.remove('active'));button.classList.add('active');}}
 const summary=main.querySelector('.ui-attendance-summary');if(summary){
  const month=activeMonthKey(state.attendanceMonth),source=archivedAttendanceForMonth(month)||ATTENDANCE;
  const rows=getAttendanceRows(source).filter(row=>String(row.date).startsWith(month)),data=attendanceSummaryFromRows(rows);
  const extra=rows.reduce((sum,row)=>sum+Number(row.overtimeMinutes||0),0);
  summary.before(fxMetrics([['Colaboradores',data.totalPeople,'people'],['Jornadas completas',data.completeDays,'check','mint'],['Tardanzas',data.lateEntries,'history','amber'],['Sin entrada registrada',data.missingEntries,'calendar','red'],['Horas extra',minutesLabel(extra),'stats','mint']]));summary.hidden=true;
 }
}
function fxSalary(main){
 const table=main.querySelector('.ui-salary-table');if(!table)return;
 fxCardMetrics(main.querySelector('.ui-salary-summary'));
 const panel=table.closest('.table-wrap'),split=fxElement('div','fx-salary-split'),detail=fxElement('aside','fx-salary-detail');
 const heading=main.querySelector('.ui-page-heading,.page-header'),monthSelect=main.querySelector('#salaryMonth'),periodPanel=monthSelect?.closest('.table-wrap');
 if(heading&&monthSelect){heading.append(monthSelect);const badge=periodPanel?.querySelector('.days-chip');if(badge)heading.append(badge);if(periodPanel)periodPanel.remove();}
 const toolbar=panel.querySelector('.table-header');
 if(toolbar){
  const more=fxElement('details','fx-filter-menu','<summary>Más filtros y acciones</summary><div></div>');
  [...toolbar.children].forEach(child=>{if(child.matches('#attendanceSearch,#salarySede'))return;if(child.matches('.table-title')){child.hidden=true;return;}if(child.matches('#salaryExportFormat,#exportSalariesBtn')){heading?.append(child);return;}more.lastElementChild.append(child);});toolbar.append(more);fxFloatingMenu(more);
 }
 panel.before(split);split.append(panel,detail);
 const allRows=[...table.querySelectorAll('tr[data-salary-detail]')],pageSize=7,pageCount=Math.max(1,Math.ceil(allRows.length/pageSize));
 FX_STATE.salaryPage=Math.min(Math.max(1,FX_STATE.salaryPage||1),pageCount);
 const start=(FX_STATE.salaryPage-1)*pageSize;allRows.forEach((row,index)=>{row.hidden=index<start||index>=start+pageSize;});
 const footer=fxElement('footer','fx-table-pagination','<span>Mostrando '+(allRows.length?start+1:0)+'–'+Math.min(start+pageSize,allRows.length)+' de '+allRows.length+' colaboradores</span>');
 const pages=fxElement('div','');for(let number=1;number<=pageCount;number++){const button=fxElement('button',number===FX_STATE.salaryPage?'active':'',String(number));button.type='button';button.setAttribute('aria-label','Página de sueldos '+number);button.onclick=()=>{FX_STATE.salaryPage=number;preserveMainScroll(()=>render());};pages.append(button);}footer.append(pages);panel.append(footer);
 table.querySelectorAll('tr[data-salary-detail]').forEach(row=>{
  const person=getSalaryPersonById(row.dataset.salaryDetail),cell=row.children[1];
  if(person&&cell){cell.dataset.fullRole=cell.textContent.trim();cell.innerHTML=esc(person.closedSnapshot?person.sede:getPersonSede(person));}
 });
 const roleHeading=table.querySelector('thead th:nth-child(2)');if(roleHeading)roleHeading.textContent='Sede';
 const ids=allRows.map(row=>String(row.dataset.salaryDetail));
 const selected=ids.includes(String(state.salaryDetailId))?String(state.salaryDetailId):ids.includes(String(FX_STATE.salaryId))?String(FX_STATE.salaryId):ids[0];
 state.salaryDetailId=selected||null;FX_STATE.salaryId=selected||null;
 const extras=[...main.querySelectorAll('.table-wrap')].filter(node=>!split.contains(node)&&!node.querySelector('#salaryMonth,#attendanceSearch'));
 const advanced=fxAdvanced(extras,'Gratificación, CTS y herramientas de pago');
 if(advanced)advanced.querySelector('summary')?.addEventListener('click',()=>{setTimeout(()=>{if(advanced.open && advanced.querySelector('#salaryLoadGratification') && typeof requestSalaryHistory==='function')requestSalaryHistory();},0);});
 paintFaithfulSalary();
}
function paintFaithfulSalary(){
 const target=document.querySelector('.fx-salary-detail');if(!target)return;
 if(state.fxSalaryFull){target.replaceChildren();return;}
 const person=getSalaryPersonById(state.salaryDetailId);if(!person){target.innerHTML='<p class="fx-muted">Selecciona un colaborador para ver su desglose.</p>';return;}
 FX_STATE.salaryId=String(person.personId);
 const source=fxElement('div','',renderSalaryDetailModal());
 const blocks=[...source.querySelectorAll('.salary-break-card')].slice(0,2),summary=source.querySelector('.salary-total-box');
 target.innerHTML='<header class="fx-salary-person"><span class="fx-person-avatar">'+esc(String(person.personName||'').split(/\s+/).filter(Boolean).slice(0,2).map(p=>p[0]).join(''))+'</span><div><h2>'+esc(person.personName)+'</h2><p>'+esc(person.payrollRole||'Sin definir')+' · '+esc(person.closedSnapshot?person.sede:getPersonSede(person))+'</p></div></header>';
 const tabs=fxElement('div','fx-tabs fx-detail-tabs');[['breakdown','Desglose'],['attendance','Asistencia']].forEach(([key,label])=>{const button=fxElement('button',FX_STATE.salaryTab===key?'active':'',label);button.type='button';button.onclick=()=>{FX_STATE.salaryTab=key;paintFaithfulSalary();};tabs.append(button);});target.append(tabs);
 if(FX_STATE.salaryTab==='breakdown')blocks.forEach((block,index)=>{if(index===0)[...block.children].forEach(line=>{const label=line.querySelector('span')?.textContent||'',amount=Number((line.querySelector('strong')?.textContent||'').replace(/[^0-9.\-]/g,''))||0;if(/Dias sin pago/.test(label)||(/Salida anticipada|Penalidades aprobadas/.test(label)&&amount===0))line.remove();});target.append(block);});
 else {const daily=source.querySelector('.salary-detail-table');if(daily){const headings=['Fecha','Ent.','Sal.','Estado','Normal','Extra','Desc.','Total'];daily.querySelectorAll('thead th').forEach((cell,index)=>{cell.title=cell.textContent.trim();cell.setAttribute('aria-label',cell.title);cell.textContent=headings[index]||cell.title;});target.append(daily);}else target.insertAdjacentHTML('beforeend','<p class="fx-muted">El detalle diario está disponible en la vista completa.</p>');}
 if(summary){summary.className='fx-salary-totals';summary.querySelectorAll('.salary-summary-item:not(.is-total)').forEach(item=>item.remove());const label=summary.querySelector('.is-total span');if(label)label.textContent='Total a recibir';target.append(summary);}
 const registeredPerson=(ATTENDANCE?.people||[]).find(item=>String(item.personId)===String(person.personId))||person;
 const bankAccounts=getBankAccounts(registeredPerson).filter(account=>account.bank&&account.number);
 const bankInfo=fxElement('section','fx-salary-bank','<h3>'+ (bankAccounts.length>1?'Cuentas registradas para depósito':'Cuenta registrada para depósito')+'</h3>'+ (bankAccounts.length?bankAccounts.map(account=>'<div class="fx-salary-bank-row"><span>'+esc(account.bank)+'<small>'+esc(account.type||'Cuenta')+'</small></span><strong>'+esc(account.number)+'</strong></div>').join(''):'<p>Sin cuenta bancaria registrada.</p>'));
 target.append(bankInfo);
 const actions=source.querySelector('.modal-actions');if(actions){actions.querySelector('#salaryDetailClose')?.remove();actions.className='fx-salary-actions';const more=fxElement('details','fx-salary-extra-actions','<summary>Ajustes de bonos</summary><div></div>');actions.querySelectorAll('#salaryExtraBonusEdit,#salaryBonusToggle').forEach(button=>more.lastElementChild.append(button));target.append(actions);if(more.lastElementChild.children.length)tabs.after(more);}
 const full=fxElement('button','fx-full-detail','Ver detalle completo →');full.type='button';full.onclick=()=>{state.fxSalaryFull=true;target.replaceChildren();openSalaryDetail(person.personId,true);};target.append(full);
 bindSalaryDetailModal();
 document.querySelectorAll('tr[data-salary-detail]').forEach(row=>row.classList.toggle('fx-selected',String(row.dataset.salaryDetail)===String(person.personId)));
}
function applyFaithfulLayout(){
 const main=document.querySelector('.main');if(!main)return;
 const views={dashboard:fxDashboard,estadisticas:fxStatistics,colaboradores:fxCollaborators,calificaciones:fxRatings,referidos:fxReferrals,safetypay:fxSafety,asistencia:fxAttendance,sueldos:fxSalary};
 // Keep the shared theme on every module; only custom layouts need an adapter.
 main.classList.add('faithful-view');
 if(!views[state.view])return;
 views[state.view](main);
 const periodIds={calificaciones:'ratingMonth',referidos:'referralMonth',safetypay:'safetypayMonth'};
 const period=main.querySelector('#'+periodIds[state.view]),pageHeader=main.querySelector('.ui-page-heading,.page-header');if(period&&pageHeader)pageHeader.append(period);
 if(state.view==='referidos')fxCreateButton(main,'saveReferralBtn','Nuevo referido');
 if(state.view==='safetypay')fxCreateButton(main,'saveSafetypayBtn','Registrar código');
 if(['safetypay','calificaciones'].includes(state.view))main.querySelectorAll('.fx-advanced,.ui-analysis-summary').forEach(node=>main.append(node));
 const directHeading=main.querySelector(':scope > .page-header');if(directHeading){const copy=fxElement('div','fx-header-copy');[...directHeading.children].filter(node=>node.matches('.page-title,.page-sub')).forEach(node=>copy.append(node));directHeading.prepend(copy);}
 const header=main.querySelector('.ui-page-heading,.page-header,.attendance-hero');if(header)header.classList.add('fx-header');
 fxObserveCharts();
}
document.addEventListener('scroll',()=>{document.querySelectorAll('.fx-row-menu[open],.fx-worker-menu[open],.fx-filter-menu[open]').forEach(menu=>{menu.open=false;});},{capture:true,passive:true});
