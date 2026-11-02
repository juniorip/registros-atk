/* Presentation helpers: use existing scoped records and handlers. */
const REDESIGN_FORM_OPEN = {};
function redesignIcon(name){
 const paths={dashboard:'<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="4" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="11" width="7" height="10" rx="1"/>',stats:'<path d="M4 20V10m6 10V4m6 16v-7m5 7H2"/>',calendar:'<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M7 3v4m10-4v4M3 11h18"/>',wallet:'<rect x="3" y="5" width="18" height="15" rx="2"/><path d="M3 8h18m-6 4h6v5h-6z"/>',people:'<circle cx="9" cy="7" r="3"/><path d="M3 21v-4a6 6 0 0 1 12 0v4m2-17a3 3 0 0 1 0 6m1 4a5 5 0 0 1 3 5v2"/>',star:'<path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-3-5.6 3 1.1-6.2L3 9.6l6.2-.9Z"/>',card:'<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 10h18m-14 5h4"/>',phone:'<path d="m5 3 4 4-2 3a15 15 0 0 0 7 7l3-2 4 4-2 3C10 22 2 14 2 5Z"/>',document:'<path d="M14 3H5v18h14V8Zm0 0v5h5M8 12h8m-8 4h6"/>',check:'<path d="m4 12 5 5L20 5"/>',bell:'<path d="M5 16V9a7 7 0 0 1 14 0v7l2 2H3Zm4 5h6"/>',settings:'<path d="m9 3-.8 3-2 .9-2.7-.8-2 3.4L3.7 12l-.2 2.3-2 2 2 3.4 3-.6 2 1L9 23h4l.8-3 2-.9 2.7.8 2-3.4-2.2-2.5.2-2.3 2-2-2-3.4-3 .6-2-1L13 3Z"/><circle cx="11" cy="13" r="3"/>',history:'<path d="M3 11a9 9 0 1 1 2 7M3 4v7h7m2-5v6l4 2"/>',plus:'<path d="M12 4v16M4 12h16"/>'};
 return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'+(paths[name]||paths.document)+'</svg>';
}
function redesignCompactForm(buttonId,title){
 const button=document.getElementById(buttonId),card=button?.closest('.form-card');
 if(!card || card.parentElement.classList.contains('ui-create-panel')) return;
 const panel=document.createElement('details');panel.className='ui-create-panel';panel.open=!!REDESIGN_FORM_OPEN[buttonId];
 if(buttonId==='saveSafetypayBtn' && typeof SAFETYPAY_EDIT_ID!=='undefined' && Number(SAFETYPAY_EDIT_ID)>0) panel.open=true;
 const summary=document.createElement('summary');summary.innerHTML=redesignIcon('plus')+'<span>'+title+'</span>';
 card.before(panel);panel.append(summary,card);panel.addEventListener('toggle',()=>{REDESIGN_FORM_OPEN[buttonId]=panel.open;});
}
function redesignDashboardChart(){
 if(!['dashboard','estadisticas'].includes(state.view) || document.querySelector('.ui-dashboard-charts')) return;
 const month=activeMonthKey(state.view==='estadisticas'?state.recordsMonth:state.dashboardMonth),selectedSede=state.view==='estadisticas'?(state.statsSede||state.managerViewSede||''):'',visible=getVisibleRecords().filter(record=>recordAccountingMonthKey(record)===month && (!selectedSede||getItemSede(record)===selectedSede));
 if(!visible.length) return;
 const parsed=month.match(/^(\d{4})-(\d{2})$/);if(!parsed) return;
 const totalDays=new Date(Number(parsed[1]),Number(parsed[2]),0).getDate();
 const daily=Array.from({length:totalDays},()=>0),operations=Array.from({length:totalDays},()=>0);
 visible.forEach(record=>{const day=Number(String(record.fechaOperacion||record.fecha||record.createdAt||'').slice(8,10));if(day>=1&&day<=totalDays){daily[day-1]++;if(record.validatedAt && !record.rejectedAt)operations[day-1]++;}});
 const max=Math.max(...daily,...operations,1),width=640,height=155,pad=22;
 const points=values=>values.map((value,index)=>`${pad+index*(width-pad*2)/(totalDays-1)},${height-pad-value*(height-pad*2)/max}`).join(' ');
 const line=points(daily),ops=points(operations),area=`${pad},${height-pad} ${line} ${width-pad},${height-pad}`;
 const chart=document.createElement('section');chart.className='ui-dashboard-charts';
 const sedes=[...new Set(visible.map(record=>getItemSede(record)).filter(Boolean))];
 chart.innerHTML=`<article class="ui-chart-card"><div class="ui-chart-title"><strong>Actividad del mes</strong><span><i class="ui-dot blue"></i>Registros <i class="ui-dot mint"></i>Validados</span></div><svg class="ui-line-chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="Actividad diaria de registros y validaciones">${[0,.5,1].map(value=>`<line x1="${pad}" y1="${pad+value*(height-pad*2)}" x2="${width-pad}" y2="${pad+value*(height-pad*2)}" stroke="#243b57" stroke-dasharray="3 5"/>`).join('')}<polygon points="${area}" fill="#297bf218"/><polyline points="${line}" fill="none" stroke="#4696ff" stroke-width="2"/><polyline points="${ops}" fill="none" stroke="#50dfb6" stroke-width="2"/></svg><div class="ui-chart-axis"><span>01</span><span>08</span><span>15</span><span>22</span><span>${totalDays}</span></div></article><article class="ui-chart-card"><div class="ui-chart-title"><strong>Distribución por sede</strong><span>${visible.length} registros</span></div><div class="ui-sede-bars">${sedes.map(sede=>{const count=visible.filter(record=>getItemSede(record)===sede).length;return `<div><span>${esc(sede)}</span><div class="ui-bar-track"><i style="width:${Math.round(count/visible.length*100)}%"></i></div><strong>${count}</strong></div>`;}).join('')}</div></article>`;
 const anchor=document.querySelector(state.view==='estadisticas'?'.stats-card-grid':'.dashboard-summary-grid');if(anchor)anchor.after(chart);else document.querySelector('.main')?.append(chart);
}
function decorateRedesign(){
 const main=document.querySelector('.main');if(!main)return;
 const iconMap={dashboard:'dashboard',estadisticas:'stats',asistencia:'calendar',sueldos:'wallet',colaboradores:'people',calificaciones:'star',safetypay:'card',referidos:'people',llamadas:'phone',tarjetas:'card',todos:'document',penalidades:'bell','auditoria-pagos':'check',cierre:'calendar','archivo-cierres':'history',alertas:'bell',admin:'settings',grupos:'people',historial:'history',reportes:'document','mis-registros':'document','mis-comisiones':'wallet'};
 document.querySelectorAll('[data-nav]').forEach(item=>{const slot=item.querySelector('.nav-icon');if(slot)slot.innerHTML=redesignIcon(iconMap[item.dataset.nav]);});
 const logo=document.querySelector('.sidebar-logo');if(logo)logo.innerHTML='<img src="/brands/atk-peru-wk.png" alt="ATK Altoque Perú WK"/>';
 document.querySelector('.sidebar-top-actions')?.remove();
 main.dataset.view=state.view;
 if(document.body.dataset.localPreview==='true'){
  const notice=document.createElement('div');notice.className='preview-notice';notice.innerHTML='<span><strong>VISTA LOCAL</strong> · Copia aislada: los cambios de esta prueba no afectan al sistema real.</span><a href="http://localhost:3100/">Inicio local</a>';main.prepend(notice);
 }
 if(['dashboard','colaboradores'].includes(state.view) && !main.querySelector('.page-header')){
  const heading=document.createElement('div');heading.className='page-header';heading.innerHTML=state.view==='colaboradores'?'<div class="page-title">Colaboradores</div><div class="page-sub">Administra la información de tu equipo</div>':'<div class="page-title">Dashboard</div><div class="page-sub">Vista general de tu operación</div>';const first=main.querySelector('.preview-notice');if(first)first.after(heading);else main.prepend(heading);
 }
 const heading=main.querySelector('.page-header');
 const month=main.querySelector('select[id*="Month"],select[id*="month"]');
 if(heading && month && month.selectedOptions[0]){
  const wrapper=document.createElement('div');wrapper.className='ui-page-heading';heading.before(wrapper);wrapper.append(heading);const period=document.createElement('div');period.className='ui-period-chip';period.innerHTML=redesignIcon('calendar')+'<span>'+esc(month.selectedOptions[0].textContent)+'</span>';wrapper.append(period);
 }
 if(state.view==='calificaciones'){
  const ranking=[...main.querySelectorAll('.stat-grid')].find(grid=>grid.textContent.includes('Ranking por calificaciones aprobadas'));
  if(ranking){const details=document.createElement('details');details.className='ui-analysis-summary';details.open=!!REDESIGN_FORM_OPEN.ratingAnalysis;const summary=document.createElement('summary');summary.textContent='Resumen de calificaciones: ranking y estrellas';ranking.before(details);details.append(summary,ranking);details.addEventListener('toggle',()=>{REDESIGN_FORM_OPEN.ratingAnalysis=details.open;});}
  const ratingTable=main.querySelector('[data-rating-approve],[data-rating-edit]')?.closest('table');
  if(ratingTable){ratingTable.classList.add('ui-rating-table');const head=ratingTable.querySelector('thead tr');const actionHeading=document.createElement('th');actionHeading.textContent='Acciones';head.insertBefore(actionHeading,head.lastElementChild);
   ratingTable.querySelectorAll('tbody tr').forEach(row=>{
    if(row.children.length<8){const empty=row.querySelector('[colspan]');if(empty)empty.colSpan+=1;return;}
    const statusCell=row.children[6],buttons=[...statusCell.querySelectorAll('button')],actions=document.createElement('td');actions.className='ui-rating-actions';
    const primary=document.createElement('div');primary.className='ui-rating-primary';const secondary=[];
    buttons.forEach(button=>{if(button.matches('[data-rating-approve],[data-rating-reject]'))primary.append(button);else secondary.push(button);});actions.append(primary);
    if(secondary.length){const menu=document.createElement('details');menu.className='ui-row-menu';const summary=document.createElement('summary');summary.textContent='···';summary.setAttribute('aria-label','Más acciones de calificación');const content=document.createElement('div');content.className='ui-row-menu-content';secondary.forEach(button=>content.append(button));menu.append(summary,content);actions.append(menu);menu.addEventListener('toggle',()=>{if(menu.open){const rect=summary.getBoundingClientRect();content.style.left=Math.max(8,Math.min(rect.right-145,innerWidth-155))+'px';content.style.top=(rect.bottom+90>innerHeight?rect.top-85:rect.bottom+5)+'px';}});}
    row.insertBefore(actions,row.lastElementChild);
   });
  }
 }
 if(state.view==='asistencia'){
  const title=main.querySelector('.attendance-hero .page-title'),subtitle=main.querySelector('.attendance-hero .page-sub');if(title)title.textContent='Asistencia';if(subtitle)subtitle.textContent='Control de marcaciones y jornada laboral';
  const pendingPanel=[...main.querySelectorAll('.table-wrap')].find(panel=>panel.querySelector('.table-title')?.textContent.includes('Solicitudes pendientes'));
  if(pendingPanel){const details=document.createElement('details');details.className='ui-review-panel';details.open=!!REDESIGN_FORM_OPEN.attendanceReview;details.addEventListener('toggle',()=>{REDESIGN_FORM_OPEN.attendanceReview=details.open;});const summary=document.createElement('summary');summary.textContent=pendingPanel.querySelector('.table-title').textContent;pendingPanel.before(details);details.append(summary,pendingPanel);}
  const sourceCard=main.querySelector('.attendance-source-card');if(sourceCard){const details=document.createElement('details');details.className='ui-source-panel';const summary=document.createElement('summary');summary.textContent='Información del periodo';sourceCard.before(details);details.append(summary,sourceCard);}
  const month=activeMonthKey(state.attendanceMonth),source=archivedAttendanceForMonth(month)||ATTENDANCE;
  if(source?.people?.length && (state.attendanceTab||'resumen')==='resumen'){
   const rows=getAttendanceRows(source).filter(row=>String(row.date).startsWith(month)),summary=attendanceSummaryFromRows(rows),extra=rows.reduce((sum,row)=>sum+Number(row.overtimeMinutes||0),0);
   const cards=document.createElement('div');cards.className='stat-grid ui-attendance-summary';cards.innerHTML=[['Colaboradores',summary.totalPeople],['Jornadas completas',summary.completeDays],['Tardanzas',summary.lateEntries],['Horas extra',minutesLabel(extra)]].map(([label,value])=>'<div class="stat-card"><div class="stat-label">'+label+'</div><div class="stat-value">'+value+'</div><div class="stat-sub">Periodo y filtros seleccionados</div></div>').join('');
   const tabs=main.querySelector('.tabs');if(tabs)tabs.before(cards);
  }
 }
 if(state.view==='sueldos'){
  const salaryTable=main.querySelector('[data-salary-detail]')?.closest('table');
  if(salaryTable){
   salaryTable.classList.add('ui-salary-table');
   const rows=[...salaryTable.querySelectorAll('tbody tr[data-salary-detail]')];
   const numeric=cell=>Number((cell?.textContent||'').replace(/[^0-9.\-]/g,''))||0;
   const net=rows.reduce((sum,row)=>sum+numeric(row.children[6]),0),commissions=rows.reduce((sum,row)=>sum+numeric(row.children[7]),0),total=rows.reduce((sum,row)=>sum+numeric(row.children[8]),0),pending=rows.filter(row=>(row.children[9]?.textContent||'').toLowerCase().includes('pendiente')).length;
   const cards=document.createElement('div');cards.className='stat-grid ui-salary-summary';cards.innerHTML=[['Sueldo neto',money(net)],['Comisiones',money(commissions)],['Total estimado',money(total)],['Pagos pendientes',String(pending)]].map(([label,value])=>'<div class="stat-card"><div class="stat-label">'+label+'</div><div class="stat-value green">'+value+'</div><div class="stat-sub">Colaboradores de esta vista</div></div>').join('');
   salaryTable.closest('.table-wrap')?.before(cards);
   rows.forEach(row=>{if(row.children[0])row.children[0].title=row.children[0].textContent.trim();});
  }
 }
 main.querySelectorAll('.table-wrap > table').forEach(table=>{const scroll=document.createElement('div');scroll.className='ui-table-scroll';table.before(scroll);scroll.append(table);});
 if(state.view==='safetypay'){
  const audit=main.querySelector('#safetypayAuditUpload')?.closest('.form-card');
  if(audit){const details=document.createElement('details');details.className='ui-analysis-summary';details.open=!!REDESIGN_FORM_OPEN.safetypayAudit;const summary=document.createElement('summary');summary.textContent='Auditoría mensual de Safetypay';audit.before(details);details.append(summary,audit);details.addEventListener('toggle',()=>{REDESIGN_FORM_OPEN.safetypayAudit=details.open;});}
 }
 if(state.view==='referidos')redesignCompactForm('saveReferralBtn','Nuevo referido');
 if(state.view==='safetypay')redesignCompactForm('saveSafetypayBtn','Registrar código');
 redesignDashboardChart();
 if(typeof applyFaithfulLayout==='function')applyFaithfulLayout();
}
