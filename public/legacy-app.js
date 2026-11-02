const TAB_SESSION_KEY='registrosAtkTabSession';
const TAB_VIEW_KEY='registrosAtkTabView';
let PORTAL_GRANT='';
let PORTAL_TURNOS_URL='';
function tabSessionToken(){ try{ return sessionStorage.getItem(TAB_SESSION_KEY)||''; }catch{ return ''; } }
function clearTabSession(){ try{ sessionStorage.removeItem(TAB_SESSION_KEY); sessionStorage.removeItem(TAB_VIEW_KEY); }catch{} }
const FORCE_UNIFIED_ENTRY=location.hostname==='atkportal.app'||new URLSearchParams(location.search).get('portal')==='turnos';
if(FORCE_UNIFIED_ENTRY) clearTabSession();
function rememberTabView(){
  if(!state.currentUser || !tabSessionToken() || !sidebarSectionsForCurrentUser().some(section=>section.items.some(item=>item.id===state.view))) return;
  try{sessionStorage.setItem(TAB_VIEW_KEY,JSON.stringify({userId:String(state.currentUser.id),view:state.view}));}catch{}
}
function restoreTabView(){
  if(!state.currentUser || state.currentUser.forcePasswordReset || !tabSessionToken()) return;
  try{
    const saved=JSON.parse(sessionStorage.getItem(TAB_VIEW_KEY)||'null');
    if(saved?.userId===String(state.currentUser.id) && sidebarSectionsForCurrentUser().some(section=>section.items.some(item=>item.id===saved.view)) && viewAllowedForCurrentUser(saved.view)) state.view=saved.view;
  }catch{}
}
function sessionRequestHeaders(){ const token=tabSessionToken(); return token ? {'Authorization':'Bearer '+token,'X-Registros-Client':'tab-login-v1'} : {'X-Registros-Client':'tab-login-v1'}; }

const WARN_DAY = 6;
const EXPIRE_DAY = 7;
const AUTO_REFRESH_TICK_MS = 15000;
const AUTO_REFRESH_FAST_MS = 45000;
const AUTO_REFRESH_DEFAULT_MS = 90000;
const AUTO_REFRESH_HEAVY_MS = 120000;
const PAGE_SIZE = 15;

const COLORS = ['#22c97a','#a78bfa','#f5a623','#2dd4bf','#f472b6','#60a5fa'];
const CORE_STATE_MODULES = ['settings','monthlyClosures','users'];
const WARM_STATE_MODULES = ['safetypayCodes','penaltyReportUsers'];
const API_READS_IN_FLIGHT = new Map();
const HOLIDAYS_BY_YEAR = new Map();
let USER_LOOKUP_SOURCE = null;
let USER_LOOKUP_BY_ID = new Map();

let USERS = [];
let REFERRALS = [];
let WRONG_CARDS = [];
let CALL_REPORTS = [];
let SAFETYPAY_CODES = [];
let STATE_MODULES_LOADED = new Set();
let STATE_MODULES_LOADING = new Set();
const STATE_MODULE_SNAPSHOTS = new Map();
const STATE_RESPONSE_REVISIONS = new Map();
let STATE_RESPONSE_WRITE_VERSION = 0;
const STATE_MODULE_SNAPSHOT_TTL_MS = 60000;
let STATE_MODULE_ERRORS = {};
let SUPPRESSED_SAFETYPAY_NOTIFY_IDS = new Set();
let SAFETYPAY_AUDIT = null;
let SAFETYPAY_CMR_SUMMARY = null;
let SAFETYPAY_CMR_SUMMARY_KEY = '';
let SAFETYPAY_CMR_SUMMARY_LOADING = false;
let VISIBLE_USERS_CACHE = { key:'', source:null, result:[] };
let VISIBLE_RECORDS_CACHE = { key:'', source:null, usersRef:null, result:[] };
let INCENTIVE_TOTALS_CACHE = { key:'', month:'', recordsRef:null, referralsRef:null, wrongCardsRef:null, callsRef:null, ratingsRef:null, penaltiesRef:null, result:new Map() };
let RATINGS = [];
let RATING_SETTINGS = { requiredFields:['dni'], fieldOptions:[{key:'dni',label:'DNI'},{key:'comment',label:'Comentario'},{key:'advisor',label:'Asesor'}] };
let RATINGS_LOADING = false;
let RATINGS_ERROR = '';
let RATINGS_LOADED = false;
let RATINGS_SCOPE_KEY = '';
let RATINGS_DECISION_REVISION = 0;
let MANAGER_REPORT_RATINGS = [];
let MANAGER_REPORT_RATINGS_KEY = '';
let MANAGER_REPORT_RATINGS_LOADING = false;
let STATS_TREND = [];
let STATS_TREND_KEY = '';
let STATS_TREND_LOADING = false;
let STATS_TREND_ERROR = '';
let PENALTY_REPORTS = [];
let PENALTY_REPORT_USERS = [];
let MONTHLY_CLOSURES = [];
let ATTENDANCE_SELECTED_REQUEST_IDS = new Set();
let WORK_GROUPS = null;
let WORK_GROUPS_LOADING = false;
const APP_CACHE_VERSION = '20260910-stats-expired-operations';

function daysAgo(n){ const d=new Date(); d.setDate(d.getDate()-n); return d.toISOString().split('T')[0]; }
function daysSince(ds){ return Math.floor((new Date()-new Date(ds))/86400000); }
function fmt(ds){ if(!ds) return '-'; const [y,m,d]=ds.split('-'); return `${d}/${m}/${y}`; }
function fmtDateTime(ds){
  if(!ds) return '-';
  const dt=new Date(ds);
  if(Number.isNaN(dt.getTime())) return ds;
  const dd=String(dt.getDate()).padStart(2,'0');
  const mm=String(dt.getMonth()+1).padStart(2,'0');
  const yyyy=dt.getFullYear();
  const hh=String(dt.getHours()).padStart(2,'0');
  const mi=String(dt.getMinutes()).padStart(2,'0');
  return `${dd}/${mm}/${yyyy} ${hh}:${mi}`;
}
const PERU_NATIONAL_HOLIDAYS = [
  { month:1, day:1, name:'Ano Nuevo' },
  { month:5, day:1, name:'Dia del Trabajo' },
  { month:6, day:7, name:'Batalla de Arica y Dia de la Bandera' },
  { month:6, day:29, name:'San Pedro y San Pablo' },
  { month:7, day:23, name:'Dia de la Fuerza Aerea del Peru' },
  { month:7, day:28, name:'Fiestas Patrias' },
  { month:7, day:29, name:'Fiestas Patrias' },
  { month:8, day:6, name:'Batalla de Junin' },
  { month:8, day:30, name:'Santa Rosa de Lima' },
  { month:10, day:8, name:'Combate de Angamos' },
  { month:11, day:1, name:'Dia de Todos los Santos' },
  { month:12, day:8, name:'Inmaculada Concepcion' },
  { month:12, day:9, name:'Batalla de Ayacucho' },
  { month:12, day:25, name:'Navidad' }
];
function dateKey(year, monthIndex, day){
  return `${year}-${String(monthIndex+1).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
}
function addDaysToDateKey(date, days){
  const d=new Date(`${date}T00:00:00`);
  d.setDate(d.getDate()+days);
  return dateKey(d.getFullYear(), d.getMonth(), d.getDate());
}
function easterSundayDateKey(year){
  const a=year%19;
  const b=Math.floor(year/100);
  const c=year%100;
  const d=Math.floor(b/4);
  const e=b%4;
  const f=Math.floor((b+8)/25);
  const g=Math.floor((b-f+1)/3);
  const h=(19*a+b-d-g+15)%30;
  const i=Math.floor(c/4);
  const k=c%4;
  const l=(32+2*e+2*i-h-k)%7;
  const m=Math.floor((a+11*h+22*l)/451);
  const month=Math.floor((h+l-7*m+114)/31);
  const day=((h+l-7*m+114)%31)+1;
  return dateKey(year, month-1, day);
}
function peruNationalHolidaysForYear(year){
  if(HOLIDAYS_BY_YEAR.has(year)) return HOLIDAYS_BY_YEAR.get(year);
  const easter=easterSundayDateKey(year);
  const holidays=[
    ...PERU_NATIONAL_HOLIDAYS.map(holiday=>({
      date:dateKey(year, holiday.month-1, holiday.day),
      name:holiday.name
    })),
    { date:addDaysToDateKey(easter, -3), name:'Jueves Santo' },
    { date:addDaysToDateKey(easter, -2), name:'Viernes Santo' }
  ].sort((a,b)=>a.date.localeCompare(b.date));
  HOLIDAYS_BY_YEAR.set(year,holidays);
  return holidays;
}
function peruNationalHoliday(date){
  if(!date) return null;
  const year=Number(String(date).slice(0,4));
  if(!year) return null;
  return peruNationalHolidaysForYear(year).find(holiday=>holiday.date===date) || null;
}
function isPaidNationalHoliday(day){
  if(!day?.date || !peruNationalHoliday(day.date)) return false;
  const dateObj=new Date(`${day.date}T00:00:00`);
  return dateObj.getDay()!==0;
}
function downloadJsonFile(filename, payload){
  const blob=new Blob([JSON.stringify(payload, null, 2)], { type:'application/json;charset=utf-8' });
  downloadBlobFile(filename, blob);
}
function downloadBlobFile(filename, blob){
  const url=URL.createObjectURL(blob);
  const link=document.createElement('a');
  link.href=url;
  link.download=filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(()=>URL.revokeObjectURL(url), 1200);
}
function initials(n){ return (n||'?').split(' ').map(w=>w[0]).slice(0,2).join('').toUpperCase(); }
function getUserById(id){
  if(USER_LOOKUP_SOURCE!==USERS){ USER_LOOKUP_SOURCE=USERS; USER_LOOKUP_BY_ID=new Map(USERS.map(user=>[user.id,user])); }
  return USER_LOOKUP_BY_ID.get(id)||{name:'?',color:'#888'};
}
function getItemOwner(item){ return item?.user || getUserById(item?.userId); }
function getItemSede(item){ return normalizeSede(item?.historicalSede || getItemOwner(item)?.sede); }

let RECORDS = [];
let CHANGE_LOGS = null;
let CHANGE_LOGS_LOADING = false;
let CHANGE_LOGS_META={total:0,page:1,limit:40};
let CHANGE_LOGS_REVISION=0;
let WORK_CALENDAR = null;
let WORK_CALENDAR_LOADING = false;
let WORK_CALENDAR_ERROR = '';
function newWorkCalendarDraft(){ return {id:'',date:'',reason:'',scope:'ALL',sede:'',personIds:[],kind:'PAID_REST',entry:'09:00',exit:'18:00',breakMinutes:60,additionalPercent:100}; }
let WORK_CALENDAR_DRAFT = newWorkCalendarDraft();
let ATTENDANCE = null;
let ATTENDANCE_LOADING = false;
let ATTENDANCE_ERROR = '';
let ATTENDANCE_OWNER_KEY = '';
let SALARY_HISTORY_REQUEST_KEY = '';
let ATTENDANCE_INCLUDES_INACTIVE = false;
let SALARY_PEOPLE_CACHE_KEY = '';
let SALARY_PEOPLE_CACHE_VALUE = null;
let SALARY_PEOPLE_CACHE_MAP = new Map();
const SIDEBAR_COLLAPSED_KEY = 'atkSidebarCollapsed';

let state = {
  view:'login', currentUser:null, modal:null, newModal:false, resetUserId:null, sessionPassword:'',
  ft:'', fUser:'', fTipo:'', fDesde:'', fHasta:'', fApproval:'', fSede:'', recordsMonth:'',
  referralSearch:'', referralUser:'', referralStatus:'', referralMonth:'',
  wrongCardSearch:'', wrongCardStatus:'', wrongCardMonth:'',
  callSearch:'', callStatus:'', callMonth:'',
  safetypaySearch:'', safetypayMonth:'', safetypaySede:'', safetypayDuplicatesOnly:false, safetypayCmrTotalOnly:false, safetypayEdit:false,
  ratingSearch:'', ratingMonth:'', ratingUser:'', ratingStatus:'', ratingStars:'',
  penaltyTab:'received', penaltyStatus:'', penaltySede:'', penaltyWorker:'', penaltySearch:'', penaltyMonth:'', paymentAuditMonth:'', paymentAuditSearch:'', statsSede:'', statsTrendMonths:'3', statsCompareSedeA:'', statsCompareSedeB:'', managerViewSede:'',
  reportMode:'all', reportUser:'', reportMonth:'', reportSede:'', salaryMonth:'', attendanceMonth:'', attendanceSearch:'', attendanceDate:'', attendancePerson:'', attendanceDepartment:'', attendanceSede:'', salarySede:'', collaboratorStatus:'active', collaboratorSearch:'', collaboratorRole:'', collaboratorSede:'', attendanceEdit:null, ratingEdit:null, collaboratorEditId:null, salaryDetailId:null, closureMonth:'',
  attendanceTab:'resumen', adminTab:'payout', alertTab:'warn', dashboardUserId:null, dashboardMonth:'', managerReportPeriod:'day', managerReportFrom:'', managerReportTo:'', periodScope:'',
  archiveViewer:null,
  sidebarCollapsed: localStorage.getItem(SIDEBAR_COLLAPSED_KEY)==='1',
  pages:{},historyGroup:'all',historyModule:'',historySearch:'',historyFrom:'',historyTo:'',historyPage:1
};
const VIEW_STATE_MODULES = {
  dashboard:['records','referrals','wrongCards','callReports','penaltyReports'],
  estadisticas:['records','referrals','wrongCards','callReports','penaltyReports'],
  todos:['records'],
  'mis-registros':['records'],
  alertas:['records','referrals','wrongCards','callReports','penaltyReports'],
  referidos:['referrals'],
  llamadas:['callReports'],
  tarjetas:['wrongCards'],
  penalidades:['penaltyReports'],
  'auditoria-pagos':['penaltyReports','penaltyReportUsers'],
  sueldos:['records','referrals','wrongCards','callReports','penaltyReports','safetypayCodes'],
  colaboradores:['records','referrals','wrongCards','callReports','penaltyReports','safetypayCodes'],
  cierre:['records','referrals','wrongCards','callReports','penaltyReports','safetypayCodes'],
  reportes:['records','referrals','wrongCards','callReports','penaltyReports','safetypayCodes'],
  'mis-comisiones':['records','referrals','wrongCards','callReports','penaltyReports'],
  safetypay:['safetypayCodes'],
};
const PAYROLL_ROLE_OPTIONS = ['Jefe de Pagos','Subjefe de Pagos','Encargado de Pagos','Jefe de Sede','Personal Registro','Facturacion','Marketing','Sin definir'];
const EMPLOYMENT_TYPE_OPTIONS = [
  { value:'FULL_TIME', label:'Tiempo completo' },
  { value:'PART_TIME', label:'Part time' }
];
const PART_TIME_MODE_OPTIONS = [
  { value:'MORNING', label:'9:00 a 1:00' },
  { value:'AFTERNOON', label:'2:00 a 6:00' }
];
const PAYROLL_ROLE_CONFIG = {
  'Jefe de Pagos': { baseSalary:3000, penaltyPerMinute:1.0, bonus:150, balanceBonus:75 },
  'Subjefe de Pagos': { baseSalary:2500, penaltyPerMinute:1.0, bonus:150, balanceBonus:75 },
  'Encargado de Pagos': { baseSalary:2000, penaltyPerMinute:1.0, bonus:150, balanceBonus:75 },
  'Jefe de Sede': { baseSalary:1500, penaltyPerMinute:0.7, bonus:70, balanceBonus:0 },
  'Personal Registro': { baseSalary:1250, penaltyPerMinute:0.5, bonus:50, balanceBonus:0 },
  'Facturacion': { baseSalary:1500, penaltyPerMinute:0.7, bonus:50, balanceBonus:0 },
  'Marketing': { baseSalary:0, penaltyPerMinute:0, bonus:0, balanceBonus:0 },
  'Sin definir': { baseSalary:0, penaltyPerMinute:0, bonus:0, balanceBonus:0 },
};
const MANAGER_APPROVED_PENALTY_COMMISSION = 0.50;
const MANAGER_APPROVED_RATING_COMMISSION = 0.30;
const APPROVED_CALL_COMMISSION = 0.05;
const SALARY_BASE_DAYS = 26;
const EARLY_LEAVE_PENALTY_PER_MINUTE = 0;
const EARLY_LEAVE_PENALTY_LAST_MONTH = '2026-05';
const MYPE_GRATIFICATION_FACTOR = 0.5;
const GRATIFICATION_SYSTEM_ATTENDANCE_START_MONTH = '2026-06';
const HIRE_DATE_BY_PERSON_ID = {
  '73774814':'2026-03-02',
  '73741963':'2026-07-01',
  '74711120':'2026-03-09',
  '75348462':'2026-02-17',
  '72355741':'2026-05-11',
  '60975845':'2025-12-17',
  '72622151':'2025-12-02',
  '75615541':'2025-10-06',
  '60895202':'2026-01-19',
  '60940366':'2026-01-19',
  '60698987':'2026-02-16',
  '60938226':'2026-02-07',
  '74953773':'2025-07-04',
  '71478909':'2026-03-02',
  '72457103':'2026-05-25',
  '77334478':'2026-05-26',
  '359435':'2026-05-26',
  '71208828':'2025-03-01',
  '72436808':'2025-07-15',
  '73047759':'2026-06-02',
  '70025553':'2026-06-08',
  '72221020':'2025-03-20',
  '72508116':'2025-12-06'
};
const HIRE_DATE_BY_USERNAME = {
  'ashley':'2026-07-01'
};
const HIRE_DATE_BY_NAME = {
  'ashley toyco espinoza':'2026-07-01'
};
const DEFAULT_SAFETYPAY_MONTHLY_GOAL = 750000;
const SAFETYPAY_SHARED_BONUS_THRESHOLD = 0.80;
const SAFETYPAY_SHARED_BONUS_POOL = 300;
const SAFETYPAY_MANAGER_BONUS = 300;
const DEFAULT_PAYOUT_SETTINGS = {
  callCommission: APPROVED_CALL_COMMISSION,
  ratingCommission: 2,
  wrongCardBonus: 10,
  managerRatingApprovalCommission: MANAGER_APPROVED_RATING_COMMISSION,
  managerRecordValidationCommission: 0.3,
  managerPenaltyApprovalCommission: MANAGER_APPROVED_PENALTY_COMMISSION,
  safetypaySharedThreshold: SAFETYPAY_SHARED_BONUS_THRESHOLD,
  safetypaySharedBonusPool: SAFETYPAY_SHARED_BONUS_POOL,
  safetypayManagerBonus: SAFETYPAY_MANAGER_BONUS,
  commercialCardCommissionRate: 0.08,
  commercialCardMinimumCommission: 30,
  commercialCardMinimumThreshold: 375,
  roleDefaults: PAYROLL_ROLE_CONFIG
};
const SAFETYPAY_BANKS = ['CMR','IBK','IO'];
const SAFETYPAY_CODE_OPTIONS = ['ATK1'];
const BANK_ACCOUNT_OPTIONS = ['BCP','BBVA','Interbank','Scotiabank','Banco de la Nacion','BanBif','Pichincha','Caja','Yape / Plin','Otro'];
const DEFAULT_MANAGER_PUNCTUAL_STAFF_BONUS = 50;
const MIN_MANAGER_PUNCTUAL_STAFF_DAYS = 20;
const EXTRA_BONUS_CONFIG = {
  managerInnovation: { label:'Bono aporte e innovacion operativa', amount:50, roles:['Jefe de Sede'], manual:true, multiple:true, max:8 },
  managerLeadership: { label:'Bono liderazgo', amount:30, roles:['Jefe de Sede'], manual:true, multiple:true, max:50 },
  paymentsBalance: { label:'Bono de cuadre', amount:75, roleAmountField:'balanceBonus', roles:['Jefe de Pagos','Subjefe de Pagos','Encargado de Pagos','Pagos'], area:'Pagos', manual:true, multiple:false, max:1, defaultQuantity:1 },
  employeeInnovation: { label:'Bono propuesta de innovacion', amount:50, roles:['Personal Registro'], manual:true, multiple:true, max:8 },
};
const SEDES = ['Lince','Sur','Norte','Miraflores'];
const COLLABORATOR_AREA_OPTIONS = ['Atencion al cliente','Jefes de sede','Pagos','Facturacion','Marketing'];
const PAYMENTS_PERSON_IDS = new Set(['75348462','72221020','73774814','72508116']);
let SETTINGS = { commissionPerRecord: 0.40, safetypayMonthlyGoal: DEFAULT_SAFETYPAY_MONTHLY_GOAL, safetypaySedeGoals:null, safetypayGoalHistory:null, payoutSettings:{...DEFAULT_PAYOUT_SETTINGS} };
const DEFAULT_CUSTOMER_SERVICE_PENALTIES = [
  { code:'ERROR_DATOS', label:'Error de datos', amount:2.00, description:'Dato errado detectado por Facturacion o jefe.' },
  { code:'ABANDONO_CHAT', label:'Abandono chat', amount:2.00, description:'Chat con m-s de 20 minutos sin respuesta.' },
  { code:'MAL_FLUJO_CMR_SAFETY', label:'Mal flujo CMR / Safety', amount:2.00, description:'Omitir protocolo obligatorio o responder generico.' },
  { code:'PROCESO_AL_AIRE', label:'Dejar conversacion / proceso al aire', amount:2.00, description:'Conversacion abandonada sin datos obligatorios.' },
  { code:'ERROR_REGISTRO_MANUAL', label:'Error en registro manual o codigo', amount:2.00, description:'DNI, nombre, celular, correo o codigo mal ingresado.' },
  { code:'FALTA_UNIFORME', label:'Falta de uniforme completo', amount:10.00, description:'Asiste sin uniforme oficial.' },
];
let BOOTING = true;
let AUTO_REFRESH_TIMER = null;
let AUTO_REFRESH_LAST_AT = 0;
let BUSY_COUNT = 0;
let BUSY_MESSAGE = 'Procesando...';
let NEW_RECORD_SUBMITTING = false;
let EDIT_RECORD_SUBMITTING = false;
let LOGOUT_SUBMITTING = false;
let REFERRAL_DRAFT_DIRTY = false;
let REFERRAL_DRAFT = { clientName:'', dni:'', amount:'', bank:'BBVA', notes:'' };
let SAFETYPAY_DRAFT_DIRTY = false;
let SAFETYPAY_DRAFT = { clientDni:'', cardLast4:'', customerCode:'', bank:'CMR', code:'ATK1', amount:'', operationNumber:'' };
let SAFETYPAY_EDIT_ID = null;
let CALL_DRAFT_DIRTY = false;
let CALL_DRAFT = { clientDni:'', clientName:'' };
let PENALTY_REPORT_DRAFT_DIRTY = false;
let PENALTY_REPORT_DRAFT = { clientDni:'', clientName:'', reason:'', penaltyCode:'' };
let PAYMENT_AUDIT_DRAFT = { workerUserId:'', type:'DATA_ERROR', reason:'', evidenceImage:'' };
let LAST_PENALTY_INBOX_KEY = '';
let FILTER_INTERACTION_UNTIL = 0;
let AUTO_REFRESH_RUNNING = false;
let FILTER_RENDER_TIMER = null;
let SESSION_WARMUP_KEY = '';

function getSessionScopeKey(user=state.currentUser){
  if(!user) return '';
  return `${user.id}:${user.role}:${userSede(user)}`;
}

function resetAttendanceCache(){
  ATTENDANCE = null;
  ATTENDANCE_LOADING = false;
  ATTENDANCE_ERROR = '';
  ATTENDANCE_OWNER_KEY = '';
  ATTENDANCE_INCLUDES_INACTIVE = false;
  SALARY_PEOPLE_CACHE_KEY = '';
  SALARY_PEOPLE_CACHE_VALUE = null;
  SALARY_PEOPLE_CACHE_MAP.clear();
}

function scheduleIdleTask(task){
  if(typeof window!=='undefined' && typeof window.requestIdleCallback==='function'){
    window.requestIdleCallback(()=>task(), { timeout: 1200 });
    return;
  }
  setTimeout(task, 180);
}

function getViewStateModules(view=state.view){
  return [...new Set([...(VIEW_STATE_MODULES[view] || [])])];
}

function scopedDataMonthForView(view=state.view){
  if(view==='dashboard') return activeMonthKey(state.dashboardMonth);
  if(view==='estadisticas' || view==='todos' || view==='mis-registros' || view==='alertas') return activeMonthKey(state.recordsMonth);
  if(view==='referidos') return activeMonthKey(state.referralMonth);
  if(view==='llamadas') return activeMonthKey(state.callMonth);
  if(view==='tarjetas') return activeMonthKey(state.wrongCardMonth);
  if(view==='penalidades') return activeMonthKey(state.penaltyMonth);
  if(view==='auditoria-pagos') return activeMonthKey(state.paymentAuditMonth);
  if(view==='safetypay') return safetypayMonthKey();
  if(view==='calificaciones') return ratingMonthKey();
  if(view==='sueldos' || view==='mis-comisiones') return salaryViewMonthKey();
  if(view==='asistencia' || view==='colaboradores' || view==='cierre') return activeMonthKey(state.attendanceMonth || state.salaryMonth || state.closureMonth);
  if(view==='reportes') return reportMonthKey();
  return salaryMonthKey();
}

function stateModuleScope(module, view=state.view){
  const scopedModules=new Set(['records','referrals','wrongCards','callReports','safetypayCodes','penaltyReports']);
  return scopedModules.has(module) ? scopedDataMonthForView(view) : 'all';
}

function stateModuleLoadKey(module, view=state.view){
  return `${module}:${stateModuleScope(module, view)}`;
}

function renderSectionLoading(title='Cargando seccion', message='Preparando datos...'){
  return `<div class="page-header"><div class="page-title">${title}</div><div class="page-sub">${message}</div></div><div class="table-wrap"><div class="empty-state"><div class="section-spinner" role="status" aria-label="Cargando"></div><p>${message}</p></div></div>`;
}

function warmSessionData(){
  const scopeKey=getSessionScopeKey();
  const warmKey=`${scopeKey}|${state.view}`;
  if(!scopeKey || SESSION_WARMUP_KEY===warmKey || !state.currentUser || state.currentUser.forcePasswordReset) return;
  SESSION_WARMUP_KEY=warmKey;
  scheduleIdleTask(async()=>{
    try{
      const missing=getViewStateModules().filter(module=>!STATE_MODULES_LOADED.has(stateModuleLoadKey(module)) && !STATE_MODULES_LOADING.has(stateModuleLoadKey(module)));
      if(missing.length){
        await refreshState(true, missing);
        preserveMainScroll(()=>render());
      }
    }catch(error){
      // Silent warmup: if a background prefetch fails, the section can retry normally on open.
    }
  });
}

function resetSessionViewState(){
  SALARY_HISTORY_REQUEST_KEY = '';
  API_READS_IN_FLIGHT.clear();
  state.modal=null;
  state.newModal=false;
  state.attendanceEdit=null;
  state.ft=''; state.fUser=''; state.fTipo=''; state.fDesde=''; state.fHasta=''; state.fApproval=''; state.fSede=''; state.recordsMonth='';
  state.referralSearch=''; state.referralUser=''; state.referralStatus=''; state.referralMonth='';
  state.wrongCardSearch=''; state.wrongCardStatus=''; state.wrongCardMonth='';
  state.callSearch=''; state.callStatus=''; state.callMonth='';
  state.safetypaySearch=''; state.safetypayMonth=''; state.safetypaySede=''; state.safetypayDuplicatesOnly=false; state.safetypayCmrTotalOnly=false;
  state.ratingSearch=''; state.ratingMonth=''; state.ratingUser=''; state.ratingStatus=''; state.ratingStars='';
  state.penaltyTab='received'; state.penaltyStatus=''; state.penaltySede=''; state.penaltyWorker=''; state.penaltySearch=''; state.penaltyMonth=''; state.paymentAuditMonth=''; state.paymentAuditSearch='';
  PAYMENT_AUDIT_DRAFT={ workerUserId:'', type:'DATA_ERROR', reason:'', evidenceImage:'' };
  state.reportMode='all'; state.reportUser='';
  state.attendanceSearch=''; state.attendanceDate=''; state.attendancePerson=''; state.attendanceDepartment=''; state.attendanceSede=''; state.salarySede=''; state.attendanceMonth=''; state.salaryDetailId=null; state.closureMonth=''; state.reportMonth=''; state.reportSede=''; state.salaryMonth='';
  state.collaboratorSearch=''; state.collaboratorRole=''; state.collaboratorSede='';
  state.attendanceTab='resumen'; state.adminTab='payout'; state.alertTab='warn'; state.managerViewSede='';
  state.dashboardUserId=null;
  state.dashboardMonth='';
  state.periodScope='';
  STATE_MODULES_LOADED = new Set();
  STATE_MODULES_LOADING = new Set();
  STATE_MODULE_SNAPSHOTS.clear();
  STATE_RESPONSE_REVISIONS.clear();
  STATE_MODULE_ERRORS = {};
  ATTENDANCE_SELECTED_REQUEST_IDS.clear();
  WORK_CALENDAR=null; WORK_CALENDAR_ERROR=''; WORK_CALENDAR_DRAFT=newWorkCalendarDraft();
  resetAttendanceCache();
  REFERRAL_DRAFT_DIRTY=false;
  REFERRAL_DRAFT={ clientName:'', dni:'', amount:'', bank:'BBVA', notes:'' };
  SAFETYPAY_DRAFT_DIRTY=false;
  SAFETYPAY_DRAFT={ clientDni:'', cardLast4:'', customerCode:'', bank:'CMR', code:'ATK1', amount:'', operationNumber:'' };
  SAFETYPAY_EDIT_ID=null;
  CALL_DRAFT_DIRTY=false;
  CALL_DRAFT={ clientDni:'', clientName:'' };
  PENALTY_REPORT_DRAFT_DIRTY=false;
  PENALTY_REPORT_DRAFT={ clientDni:'', clientName:'', reason:'', penaltyCode:'' };
  RATINGS=[];
  RATINGS_ERROR='';
  RATINGS_LOADING=false;
  RATINGS_LOADED=false;
  RATINGS_SCOPE_KEY='';
}

function hasPayloadKey(payload, key){
  return !!payload && Object.prototype.hasOwnProperty.call(payload, key);
}

function stateModuleCollection(module, replacement){
  const replacing=arguments.length>1;
  if(replacing) STATE_RESPONSE_REVISIONS.clear();
  switch(module){
    case 'records': if(replacing) RECORDS=replacement; return RECORDS;
    case 'referrals': if(replacing) REFERRALS=replacement; return REFERRALS;
    case 'wrongCards': if(replacing) WRONG_CARDS=replacement; return WRONG_CARDS;
    case 'callReports': if(replacing) CALL_REPORTS=replacement; return CALL_REPORTS;
    case 'safetypayCodes': if(replacing) SAFETYPAY_CODES=replacement; return SAFETYPAY_CODES;
    case 'penaltyReports': if(replacing) PENALTY_REPORTS=replacement; return PENALTY_REPORTS;
    default: return null;
  }
}

function rememberStateModule(key){
  const rows=stateModuleCollection(key.split(':')[0]);
  if(!rows) return;
  const cacheKey=`${getSessionScopeKey()}|${key}`;
  STATE_MODULE_SNAPSHOTS.delete(cacheKey);
  STATE_MODULE_SNAPSHOTS.set(cacheKey, { rows, at:Date.now() });
  while(STATE_MODULE_SNAPSHOTS.size>24) STATE_MODULE_SNAPSHOTS.delete(STATE_MODULE_SNAPSHOTS.keys().next().value);
}

function restoreStateModule(module){
  const key=stateModuleLoadKey(module);
  if(STATE_MODULES_LOADED.has(key) || STATE_MODULES_LOADING.has(key)) return;
  const snapshot=STATE_MODULE_SNAPSHOTS.get(`${getSessionScopeKey()}|${key}`);
  if(!snapshot || Date.now()-snapshot.at>STATE_MODULE_SNAPSHOT_TTL_MS) return;
  stateModuleCollection(module, snapshot.rows);
  for(const previousKey of STATE_MODULES_LOADED){
    if(previousKey.startsWith(module+':')) STATE_MODULES_LOADED.delete(previousKey);
  }
  STATE_MODULES_LOADED.add(key);
  delete STATE_MODULE_ERRORS[key];
}

function markLoadedStateModules(payload){
  const moduleNames=['settings','monthlyClosures','users','penaltyReportUsers','records','referrals','wrongCards','callReports','safetypayCodes','penaltyReports'];
  const loadedKeys=Array.isArray(payload?.__loadedStateModuleKeys)
    ? payload.__loadedStateModuleKeys.filter(key=>hasPayloadKey(payload, key.split(':')[0]))
    : moduleNames.filter(module=>hasPayloadKey(payload, module)).map(module=>stateModuleLoadKey(module));
  loadedKeys.forEach(key=>{
    // Each module has a single in-memory collection, not one per month.
    // Replacing it invalidates every previously loaded month of that module.
    const prefix=key.split(':')[0]+':';
    for(const previousKey of STATE_MODULES_LOADED){
      if(previousKey.startsWith(prefix)) STATE_MODULES_LOADED.delete(previousKey);
    }
    STATE_MODULES_LOADED.add(key);
    delete STATE_MODULE_ERRORS[key];
    rememberStateModule(key);
  });
}

function buildStateUrl(modules, scopedMonth=null){
  if(!Array.isArray(modules) || !modules.length) return '/api/state';
  const params=new URLSearchParams();
  modules.forEach(module=>params.append('module', module));
  // Capture the month at the beginning of a request.  The user can switch
  // months before it finishes, so reading state again here can mix two views.
  const month=scopedMonth===null ? scopedDataMonthForView() : scopedMonth;
  if(month) params.set('month', month);
  return `/api/state?${params.toString()}`;
}

function ensureStateModulesLoaded(modules){
  if(!Array.isArray(modules) || !modules.length) return false;
  modules.forEach(restoreStateModule);
  const missing=modules.filter(module=>{
    const key=stateModuleLoadKey(module);
    return !STATE_MODULE_ERRORS[key] && !STATE_MODULES_LOADED.has(key) && !STATE_MODULES_LOADING.has(key);
  });
  if(!missing.length) return modules.some(module=>!STATE_MODULES_LOADED.has(stateModuleLoadKey(module)) && STATE_MODULES_LOADING.has(stateModuleLoadKey(module)));
  const loadingKeys=missing.map(module=>stateModuleLoadKey(module));
  loadingKeys.forEach(key=>STATE_MODULES_LOADING.add(key));
  // Start immediately so refreshState captures this view's month before a
  // navigation or another filter change can alter it.
  refreshState(true, missing)
      .then(()=>preserveMainScroll(()=>render()))
      .catch(error=>{
        loadingKeys.forEach(key=>{ STATE_MODULE_ERRORS[key]=error?.message || 'No se pudo cargar esta pagina.'; });
        preserveMainScroll(()=>render());
      });
  return true;
}

function stateModuleErrorFor(modules){
  if(!Array.isArray(modules)) return '';
  const module=modules.find(key=>STATE_MODULE_ERRORS[stateModuleLoadKey(key)]);
  return module ? STATE_MODULE_ERRORS[stateModuleLoadKey(module)] : '';
}

function renderStateLoadError(modules){
  const message=stateModuleErrorFor(modules) || 'No se pudo cargar esta pagina.';
  return `<div class="page-header"><div class="page-title">No se pudo cargar</div><div class="page-sub">${esc(message)}</div></div><div class="table-wrap"><div class="empty-state"><div class="es-icon">!</div><p>${esc(message)}</p><button class="btn-primary" data-retry-modules="${esc((modules||[]).join(','))}">Reintentar</button></div></div>`;
}

function setAttendancePayload(payload, includesInactive=false){
  ATTENDANCE = payload;
  ATTENDANCE_INCLUDES_INACTIVE = includesInactive;
  ATTENDANCE_ERROR = '';
  ATTENDANCE_OWNER_KEY = attendanceCacheKey();
  SALARY_PEOPLE_CACHE_KEY = '';
  SALARY_PEOPLE_CACHE_VALUE = null;
  SALARY_PEOPLE_CACHE_MAP.clear();
}

function salaryHistoryRequested(){
  return state.view==='sueldos' && SALARY_HISTORY_REQUEST_KEY===getSessionScopeKey()+'|'+salaryViewMonthKey();
}
async function requestSalaryHistory(){
  if(state.view!=='sueldos' || ATTENDANCE_LOADING) return;
  if(salaryHistoryRequested() && ATTENDANCE_OWNER_KEY===attendanceCacheKey()) return;
  const session=getSessionScopeKey(),month=salaryViewMonthKey();
  const previous={payload:ATTENDANCE,owner:ATTENDANCE_OWNER_KEY,inactive:ATTENDANCE_INCLUDES_INACTIVE};
  SALARY_HISTORY_REQUEST_KEY=session+'|'+month;
  const button=document.getElementById('salaryLoadGratification');
  if(button){button.disabled=true;button.textContent='Cargando historial para gratificación…';}
  const result=await loadAttendance(false,true);
  if(session!==getSessionScopeKey() || state.view!=='sueldos' || month!==salaryViewMonthKey()) return;
  if(!result){
    const error=ATTENDANCE_ERROR || 'No se pudo cargar el historial de gratificación. Puedes volver a intentarlo.';
    SALARY_HISTORY_REQUEST_KEY='';
    ATTENDANCE=previous.payload;ATTENDANCE_OWNER_KEY=previous.owner;ATTENDANCE_INCLUDES_INACTIVE=previous.inactive;ATTENDANCE_ERROR='';
    preserveMainScroll(()=>render());
    await appAlert(error,'Error');
    return;
  }
  preserveMainScroll(()=>render());
}
function attendanceCacheKey(){
  return `${getSessionScopeKey()}|${scopedDataMonthForView(state.view)}|${salaryHistoryRequested()?'payroll-history':'monthly'}`;
}

function getDups(records){
  const seen={};
  records.forEach(r=>{ const key=`${String(r.dni||'').trim()}:${recordAccountingMonthKey(r)}`; if(!seen[key]) seen[key]=[]; seen[key].push(r.id); });
  const s=new Set();
  Object.values(seen).forEach(ids=>{ if(ids.length>1) ids.forEach(id=>s.add(id)); });
  return s;
}
function duplicateGroups(records, { includeRejected=true, includeMarked=false } = {}){
  const groups=new Map();
  (records || []).forEach(record=>{
    const dni=String(record?.dni || '').trim();
    if(!dni) return;
    if(!includeRejected && record.rejectedAt) return;
    const key=`${dni}:${recordAccountingMonthKey(record)}`;
    if(!groups.has(key)) groups.set(key, { dni, records:[] });
    groups.get(key).records.push(record);
  });
  return Array.from(groups.values())
    .map(group=>({ dni:group.dni, records:group.records.slice().sort((a,b)=>String(a.fecha || '').localeCompare(String(b.fecha || '')) || Number(a.id)-Number(b.id)) }))
    .filter(group=>group.records.length>1);
}
function unresolvedDuplicateRecords(records){
  return duplicateGroups(records, { includeRejected:false }).flatMap(group=>group.records);
}
function duplicateGroupForRecord(record, records=RECORDS){
  if(!record) return [];
  const month=recordAccountingMonthKey(record);
  return (records || []).filter(item=>String(item.dni || '').trim()===String(record.dni || '').trim() && recordAccountingMonthKey(item)===month);
}
function activeDuplicatePeers(record, records=RECORDS){
  return duplicateGroupForRecord(record, records).filter(item=>Number(item.id)!==Number(record.id) && !item.rejectedAt);
}
function duplicateStatusChip(record){
  const validation=validationText(record);
  if(record.rejectedAt) return `<span class="days-chip expired">Rechazado</span>`;
  if(record.validatedAt) return `<span class="days-chip done">Validado</span>`;
  if(isPendingApproval(record)) return `<span class="days-chip danger">Pendiente</span>`;
  return `<span class="days-chip ${validation.cls}">${validation.label}</span>`;
}

function dupDetailsHtml(record){
  if(!record?.duplicateDetails?.length) return '';
  const seen=new Set();
  const details=record.duplicateDetails
    .map(item=>({ sede:item.sede||'Otra sede', userName:item.userName||'Sin nombre' }))
    .filter(item=>{
      const key=`${item.sede}:${item.userName}`;
      if(seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  if(!details.length) return '';
  return `<div style="margin-top:4px;color:var(--amber);font-size:11px;line-height:1.25">Tambi-n en ${details.map(item=>`${item.sede}: ${item.userName}`).join(' - ')}</div>`;
}

function getCommissionRate(){
  return Number(SETTINGS.commissionPerRecord||0);
}
function getPayoutSetting(key){
  const raw=SETTINGS.payoutSettings && typeof SETTINGS.payoutSettings==='object' ? SETTINGS.payoutSettings : {};
  const fallback=DEFAULT_PAYOUT_SETTINGS[key];
  const value=Number(raw[key] ?? fallback);
  return Number.isFinite(value) && value>=0 ? value : fallback;
}
function getCallCommission(){ return getPayoutSetting('callCommission'); }
function getRatingCommission(){ return getPayoutSetting('ratingCommission'); }
function getWrongCardBonus(){ return getPayoutSetting('wrongCardBonus'); }
function getManagerRatingCommission(){ return getPayoutSetting('managerRatingApprovalCommission'); }
function getManagerRecordValidationCommission(){ return getPayoutSetting('managerRecordValidationCommission'); }
function getManagerPenaltyCommission(){ return getPayoutSetting('managerPenaltyApprovalCommission'); }
function getSafetypaySharedThreshold(){ return getPayoutSetting('safetypaySharedThreshold'); }
function getSafetypaySharedBonusPool(){ return getPayoutSetting('safetypaySharedBonusPool'); }
function getSafetypayManagerBonus(){ return getPayoutSetting('safetypayManagerBonus'); }
function getPayrollRoleDefaults(){
  const raw=SETTINGS.payoutSettings && typeof SETTINGS.payoutSettings==='object' && SETTINGS.payoutSettings.roleDefaults && typeof SETTINGS.payoutSettings.roleDefaults==='object'
    ? SETTINGS.payoutSettings.roleDefaults
    : {};
  return Object.fromEntries(Object.entries(PAYROLL_ROLE_CONFIG).map(([role,fallback])=>{
    const candidate=raw[role] && typeof raw[role]==='object' ? raw[role] : {};
    const read=(key)=>{
      const value=Number(candidate[key] ?? fallback[key] ?? 0);
      return Number.isFinite(value) && value>=0 ? value : Number(fallback[key] || 0);
    };
    return [role, { baseSalary:read('baseSalary'), penaltyPerMinute:read('penaltyPerMinute'), bonus:read('bonus'), balanceBonus:read('balanceBonus') }];
  }));
}
function getPayrollRoleConfig(role){
  const defaults=getPayrollRoleDefaults();
  return defaults[role || 'Sin definir'] || defaults['Sin definir'] || PAYROLL_ROLE_CONFIG['Sin definir'];
}
function getSafetypaySedeGoals(month=safetypayMonthKey()){
  const fallback=Number(SETTINGS.safetypayMonthlyGoal || DEFAULT_SAFETYPAY_MONTHLY_GOAL);
  const history=SETTINGS.safetypayGoalHistory && typeof SETTINGS.safetypayGoalHistory==='object' ? SETTINGS.safetypayGoalHistory : {};
  const historical=history?.[month];
  const raw=historical && typeof historical==='object'
    ? historical
    : SETTINGS.safetypaySedeGoals && typeof SETTINGS.safetypaySedeGoals==='object' ? SETTINGS.safetypaySedeGoals : {};
  return SEDES.reduce((acc, sede)=>{
    const value=Number(raw[sede] ?? fallback);
    acc[sede]=Number.isFinite(value) && value>0 ? value : fallback;
    return acc;
  }, {});
}
function getSafetypayGoal(sede, month=safetypayMonthKey()){
  if(sede) return getSafetypaySedeGoals(month)[normalizeSede(sede)] || DEFAULT_SAFETYPAY_MONTHLY_GOAL;
  return Number(SETTINGS.safetypayMonthlyGoal || DEFAULT_SAFETYPAY_MONTHLY_GOAL);
}

function referralBankLabel(bank){
  return bank==='BBVA'?'BBVA':bank==='BCP'?'BCP':bank==='SCOTIABANK'?'Scotiabank':bank==='INTERBANK'?'Interbank':bank;
}
function calcReferralBankCommission(bank, amount){
  return Number(amount||0);
}
function calcReferralCommission(bank, amount){
  return Number(amount||0)*0.004;
}
let ZLINK_SYNC_BUSY=false;
let ZLINK_SYNC_LAST_AT=0;
let ZLINK_SYNC_MESSAGE='';
async function syncZlinkAttendance(silent=false){
  if(ZLINK_SYNC_BUSY || !isAdmin()) return;
  ZLINK_SYNC_BUSY=true;
  ZLINK_SYNC_LAST_AT=Date.now();
  try{
    const month=state.attendanceMonth || salaryMonthKey();
    const result=await apiFetch(`/api/attendance/zlink?month=${encodeURIComponent(month)}`, {method:'POST',silent,busyMessage:'Sincronizando marcajes de Zlink...'});
    const pending=result.unmatched?.length || 0;
    ZLINK_SYNC_MESSAGE=`Zlink: ${result.addedPunches || 0} marcajes nuevos, ${result.updatedPeople || 0} colaboradores actualizados.${pending?` ${pending} codigo(s) sin vincular.`:''} Ultima sincronizacion: ${new Date().toLocaleTimeString('es-PE')}.`;
    await loadAttendance(true,true);
    preserveMainScroll(()=>render());
    if(!silent && pending) await appAlert(`Estos codigos de Zlink no coinciden con una ficha: ${result.unmatched.map(item=>`${item.code}: ${item.name}`).join(', ')}. No se importaron para evitar duplicados.`, 'Colaboradores pendientes de vincular');
  }catch(error){
    ZLINK_SYNC_MESSAGE=`Zlink: ${error.message || 'No se pudo sincronizar.'}`;
    if(!silent) await appAlert(error.message || 'No se pudo sincronizar Zlink.', 'Conexion Zlink');
    preserveMainScroll(()=>render());
  }finally{ ZLINK_SYNC_BUSY=false; }
}
async function uploadAttendanceFile(file){
  if(!file) return;
  const formData=new FormData();
  formData.append('file', file);
  showBusy('Importando asistencia desde Excel...');
  try{
    const response = await fetch('/api/attendance', {
      method:'POST',
      body: formData,
      headers:sessionRequestHeaders(),
      credentials:'same-origin',
      cache:'no-store'
    });
    const payload = await response.json().catch(()=>({}));
    if(!response.ok){
      throw new Error(payload.error || 'No se pudo importar el Excel.');
    }
    setAttendancePayload(payload);
    preserveMainScroll(()=>render());
  } finally {
    hideBusy();
  }
}
function updateBusyOverlay(){
  const overlay=document.getElementById('busyOverlay');
  const text=document.getElementById('busyText');
  if(text) text.textContent=BUSY_MESSAGE;
  if(overlay){
    overlay.classList.toggle('show', BUSY_COUNT>0);
    overlay.setAttribute('aria-hidden', BUSY_COUNT>0 ? 'false' : 'true');
  }
}
function showBusy(message){
  BUSY_COUNT += 1;
  BUSY_MESSAGE = message || 'Procesando...';
  updateBusyOverlay();
}
async function withLoadingFrame(message,action){
  showBusy(message);
  try{
    await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
    return await action();
  }finally{ hideBusy(); }
}
function hideBusy(){
  BUSY_COUNT = Math.max(0, BUSY_COUNT-1);
  if(BUSY_COUNT===0) BUSY_MESSAGE='Procesando...';
  updateBusyOverlay();
}

function appDialog({ title='Confirmar accion', message='', mode='alert', defaultValue='', confirmText='Aceptar', cancelText='Cancelar', danger=false }={}){
  return new Promise(resolve=>{
    const overlay=document.createElement('div');
    overlay.className='dialog-overlay';
    const inputHtml=mode==='prompt'
      ? `<textarea class="dialog-input" id="appDialogInput" rows="3">${defaultValue || ''}</textarea>`
      : '';
    overlay.innerHTML=`<div class="dialog-card" role="dialog" aria-modal="true">
      <div class="dialog-kicker">Altoque Peru WK</div>
      <div class="dialog-title">${title}</div>
      <div class="dialog-message">${message}</div>
      ${inputHtml}
      <div class="dialog-actions">
        ${mode!=='alert'?`<button class="dialog-btn" id="appDialogCancel">${cancelText}</button>`:''}
        <button class="dialog-btn ${danger?'danger':'primary'}" id="appDialogOk">${confirmText}</button>
      </div>
    </div>`;
    const cleanup=(value)=>{
      overlay.remove();
      resolve(value);
    };
    document.body.appendChild(overlay);
    const input=overlay.querySelector('#appDialogInput');
    const ok=overlay.querySelector('#appDialogOk');
    const cancel=overlay.querySelector('#appDialogCancel');
    if(input){
      input.focus();
      input.select();
    }else{
      ok.focus();
    }
    ok.onclick=()=>cleanup(mode==='prompt' ? (input.value || '') : true);
    if(cancel) cancel.onclick=()=>cleanup(mode==='prompt' ? null : false);
    overlay.onclick=e=>{ if(e.target===overlay) cleanup(mode==='alert' ? true : (mode==='prompt' ? null : false)); };
    overlay.onkeydown=e=>{
      if(e.key==='Escape') cleanup(mode==='alert' ? true : (mode==='prompt' ? null : false));
      if(e.key==='Enter' && mode!=='prompt') cleanup(true);
    };
  });
}

function appAlert(message, title='Aviso'){
  return appDialog({ title, message, mode:'alert', confirmText:'Entendido' });
}

function appConfirm(message, { title='Confirmar accion', confirmText='Aceptar', cancelText='Cancelar', danger=false }={}){
  return appDialog({ title, message, mode:'confirm', confirmText, cancelText, danger });
}

function appPrompt(message, { title='Completar informacion', defaultValue='', confirmText='Guardar', cancelText='Cancelar', danger=false }={}){
  return appDialog({ title, message, mode:'prompt', defaultValue, confirmText, cancelText, danger });
}

function getCommissionableRecordsForUser(user){
  if(!user) return [];
  if(!userCanReceiveCommissions(user)) return [];
  if(user.role==='manager'||user.role==='employee') return RECORDS.filter(r=>r.userId===user.id&&!!r.validatedAt);
  return [];
}
function userCanReceiveCommissions(user){
  if(!user) return false;
  const inactiveProfile=(ATTENDANCE?.profiles||[]).find(person=>Number(person.extraBonuses?.__linkedUserId||0)===Number(user.id));
  if(inactiveProfile && isInactiveCollaborator(inactiveProfile)) return false;
  if(!ATTENDANCE?.people?.length) return true;
  const person=ATTENDANCE.people.find(item=>Number(userForAttendancePerson(item)?.id || 0)===Number(user.id));
  return !person || (!isInactiveCollaborator(person) && !blocksVariablePay(person));
}
function getTotalIncentiveForUser(user, month=salaryViewMonthKey()){
  if(!user) return 0;
  const key=currentVisibilityKey();
  const cacheMiss=
    INCENTIVE_TOTALS_CACHE.key!==key ||
    INCENTIVE_TOTALS_CACHE.month!==month ||
    INCENTIVE_TOTALS_CACHE.recordsRef!==RECORDS ||
    INCENTIVE_TOTALS_CACHE.referralsRef!==REFERRALS ||
    INCENTIVE_TOTALS_CACHE.wrongCardsRef!==WRONG_CARDS ||
    INCENTIVE_TOTALS_CACHE.callsRef!==CALL_REPORTS ||
    INCENTIVE_TOTALS_CACHE.ratingsRef!==RATINGS ||
    INCENTIVE_TOTALS_CACHE.penaltiesRef!==PENALTY_REPORTS;
  if(cacheMiss){
    const totals=new Map();
    const add=(userId, amount)=>{
      const id=Number(userId||0);
      if(!id || !Number.isFinite(Number(amount))) return;
      totals.set(id, Number(totals.get(id)||0) + Number(amount||0));
    };
    RECORDS.forEach(record=>{ const owner=getUserById(record.userId); if(owner&&userCanReceiveCommissions(owner)&&record.validatedAt&&recordAccountingMonthKey(record)===month) add(record.userId, getCommissionRate()); });
    REFERRALS.forEach(referral=>{ const owner=getUserById(referral.userId); if(owner&&userCanReceiveCommissions(owner)&&referral.validatedAt&&monthKeyFromDate(referral.validatedAt || referral.createdAt)===month) add(referral.userId, Number(referral.referralCommission||0)); });
    WRONG_CARDS.forEach(report=>{ const owner=getUserById(report.userId); if(owner&&userCanReceiveCommissions(owner)&&(report.status==='APPROVED' || report.validatedAt)&&monthKeyFromDate(report.detectedDate || report.validatedAt || report.createdAt)===month) add(report.userId, Number(report.bonusAmount||getWrongCardBonus())); });
    CALL_REPORTS.forEach(report=>{ const owner=getUserById(report.userId); if(owner&&userCanReceiveCommissions(owner)&&(report.status==='APPROVED' || report.validatedAt)&&monthKeyFromDate(report.validatedAt || report.createdAt)===month) add(report.userId, Number(report.bonusAmount||getCallCommission())); });
    RATINGS.forEach(row=>{ const owner=getUserById(row.matchedUserId); if(owner&&userCanReceiveCommissions(owner)&&row.payable&&monthKeyFromDate(row.approvedAt || row.date || row.rawDate)===month) add(row.matchedUserId, Number(row.amount||getRatingCommission())); });
    getVisibleUsers().forEach(visibleUser=>{
      if(visibleUser.role!=='manager' || !userCanReceiveCommissions(visibleUser)) return;
      add(visibleUser.id, approvedRatingsDecidedByUser(visibleUser, month).length * getManagerRatingCommission());
      add(visibleUser.id, approvedRecordsValidatedByUser(visibleUser, month).length * getManagerRecordValidationCommission());
      add(visibleUser.id, approvedPenaltyReportsSentByUser(visibleUser, month).length * getManagerPenaltyCommission());
    });
    getVisibleUsers().forEach(visibleUser=>{
      if(!userCanReceiveCommissions(visibleUser)) return;
      approvedPaymentAuditReportsSentByUserFromRows(visibleUser, PENALTY_REPORTS, month)
        .forEach(report=>add(visibleUser.id, Number(report.reporterBonusAmount || 1)));
    });
    INCENTIVE_TOTALS_CACHE = {
      key,
      month,
      recordsRef:RECORDS,
      referralsRef:REFERRALS,
      wrongCardsRef:WRONG_CARDS,
      callsRef:CALL_REPORTS,
      ratingsRef:RATINGS,
      penaltiesRef:PENALTY_REPORTS,
      result:totals
    };
  }
  return Number(INCENTIVE_TOTALS_CACHE.result.get(Number(user.id)) || 0);
}
function calcComm(records, userId){
  return records.filter(r=>(!userId||r.userId===userId)&&!!r.validatedAt).length * getCommissionRate();
}
function calcUserCommission(user, month=salaryViewMonthKey()){
  return getCommissionableRecordsForUser(user).filter(record=>recordAccountingMonthKey(record)===month).length * getCommissionRate();
}

function isAdmin(){ return state.currentUser?.role==='admin'; }
function isManager(){ return state.currentUser?.role==='manager'; }
function isEmployee(){ return state.currentUser?.role==='employee'; }
function canManageSafetypayPayments(){ return (state.currentUser?.username || '').trim().toLowerCase()==='laura'; }
function canCreateSafetypayCodes(){ return !!state.currentUser && !canPreviewAllSedesAsManager(); }
function canEditSafetypayCodes(){ return isAdmin() || isManager(); }
function normalizeSede(sede){ return sede==='Centro'?'Lince':(sede||'Lince'); }
function userSede(user){ return normalizeSede(user?.sede); }
function paymentIdentityWords(user){ return `${user?.name||''} ${user?.username||''}`.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean); }
function isPaymentsSupervisor(user=state.currentUser){ return paymentIdentityWords(user).includes('matias'); }
function isPaymentsTeamMember(user){ const words=new Set(paymentIdentityWords(user)); return ['franco','junior','laura','andrea'].some(name=>words.has(name)); }
function optionalSede(sede){ return sede ? normalizeSede(sede) : ''; }
function canPreviewAllSedesAsManager(){ return isManager() && String(state.currentUser?.username || '').trim().toLowerCase()==='jefe.temporal'; }
function activeManagerPreviewSede(){ return canPreviewAllSedesAsManager() ? optionalSede(state.managerViewSede) : userSede(state.currentUser); }
function matchesManagerPreviewSede(sede){ const selected=activeManagerPreviewSede(); return !selected || normalizeSede(sede)===selected; }
function currentVisibilityKey(){
  const user=state.currentUser;
  return user ? `${user.id}:${user.role}:${userSede(user)}:${state.managerViewSede || ''}` : 'guest';
}
function getVisibleUsers(){
  const key=currentVisibilityKey();
  if(VISIBLE_USERS_CACHE.key===key && VISIBLE_USERS_CACHE.source===USERS) return VISIBLE_USERS_CACHE.result;
  const result=isAdmin()
    ? USERS
    : isManager()
      ? isPaymentsSupervisor()
        ? USERS.filter(u=>u.id===state.currentUser.id||isPaymentsTeamMember(u))
        : USERS.filter(u=>u.role!=='admin'&&!isPaymentsTeamMember(u)&&matchesManagerPreviewSede(userSede(u)))
      : USERS.filter(u=>u.id===state.currentUser.id);
  VISIBLE_USERS_CACHE = { key, source:USERS, result };
  return result;
}
function getVisibleSalaryPeople(){
  if(!ATTENDANCE?.people?.length) return [];
  const visibleUserIds=new Set(getVisibleUsers().map(user=>Number(user.id)));
  return (getSalaryPeople().people || []).filter(person=>{
    const linkedUser=userForAttendancePerson(person);
    if(linkedUser) return visibleUserIds.has(Number(linkedUser.id));
    return isAdmin() || isManager();
  });
}
function canManageUsers(){
  if(canPreviewAllSedesAsManager()) return false;
  return isAdmin() || isManager();
}
function canManageUserRole(role){
  if(canPreviewAllSedesAsManager()) return false;
  if(isAdmin()) return true;
  return isManager() && role==='employee';
}
function canManageUser(user){
  if(isAdmin()) return user.id!==state.currentUser.id;
  if(canPreviewAllSedesAsManager()) return false;
  if(isPaymentsSupervisor()) return isPaymentsTeamMember(user);
  return isManager() && user.role==='employee' && !isPaymentsTeamMember(user) && userSede(user)===userSede(state.currentUser);
}
function manageableUsersForCollaborator(){
  return USERS
    .filter(user=>user.role!=='admin' || isAdmin())
    .filter(user=>isAdmin() || (isManager() && !canPreviewAllSedesAsManager() && user.role==='employee' && (isPaymentsSupervisor()?isPaymentsTeamMember(user):!isPaymentsTeamMember(user)&&userSede(user)===userSede(state.currentUser))))
    .sort((a,b)=>String(a.name||'').localeCompare(String(b.name||'')));
}
function collaboratorLinkedUserId(person){
  const raw=person?.extraBonuses?.__linkedUserId;
  const id=Number(raw);
  return Number.isFinite(id) && id>0 ? id : null;
}
function defaultUsernameForPerson(person){
  const base=normalizePersonName(person?.personName || person?.personId || 'usuario')
    .replace(/[^a-z0-9]+/g, '.')
    .replace(/^\.+|\.+$/g, '')
    .slice(0, 24);
  return base || String(person?.personId || 'usuario').toLowerCase();
}
function getVisibleRecords(){
  const key=currentVisibilityKey();
  const visibleUsers=getVisibleUsers();
  if(VISIBLE_RECORDS_CACHE.key===key && VISIBLE_RECORDS_CACHE.source===RECORDS && VISIBLE_RECORDS_CACHE.usersRef===visibleUsers){
    return VISIBLE_RECORDS_CACHE.result;
  }
  const result=RECORDS.filter(r=>canViewRecord(r));
  VISIBLE_RECORDS_CACHE = { key, source:RECORDS, usersRef:visibleUsers, result };
  return result;
}
function canViewRecord(r){
  if(isAdmin()) return true;
  if(isPaymentsSupervisor()) return isPaymentsTeamMember(getItemOwner(r));
  if(isManager() && isPaymentsTeamMember(getItemOwner(r))) return false;
  if(isManager()) return matchesManagerPreviewSede(getItemSede(r));
  return Number(r.userId)===Number(state.currentUser.id);
}
function canValidateOrReject(r){
  if(!canValidateRecord(r)) return false;
  if(isAdmin()) return true;
  if(canPreviewAllSedesAsManager()) return false;
  if(isPaymentsSupervisor()) return isPaymentsTeamMember(getItemOwner(r));
  if(isManager() && isPaymentsTeamMember(getItemOwner(r))) return false;
  return isManager() && getItemSede(r)===userSede(state.currentUser);
}
function canDeleteRecord(r){
  if(!r) return false;
  if(isAdmin()) return true;
  if(canPreviewAllSedesAsManager()) return false;
  if(isManager()){
    const owner=getItemOwner(r);
    return !!owner && owner.role!=='admin' && getItemSede(r)===userSede(state.currentUser);
  }
  return false;
}
function getRecordOwnerName(r){
  return getItemOwner(r)?.name || 'Atencion al cliente';
}
function getReportableUsers(){
  return getVisibleUsers().filter(u=>u.role!=='admin');
}
function getReportSelectedSede(){
  if(state.reportMode!=='all') return '';
  if(canPreviewAllSedesAsManager()) return optionalSede(state.reportSede || state.managerViewSede);
  if(!isAdmin()) return userSede(state.currentUser);
  return state.reportSede ? normalizeSede(state.reportSede) : '';
}
function reportSedeMatches(sede){
  const selected=getReportSelectedSede();
  return !selected || normalizeSede(sede)===selected;
}
function getReportItemDate(item){
  return item?.validatedAt || item?.decidedAt || item?.detectedDate || item?.createdAt || item?.date || item?.rawDate || '';
}
function getReportItemSede(item){
  if(item?.targetSede) return normalizeSede(item.targetSede);
  if(item?.workerSede) return normalizeSede(item.workerSede);
  if(item?.sede) return normalizeSede(item.sede);
  if(item?.historicalSede) return normalizeSede(item.historicalSede);
  return getItemSede(item);
}
function getReportPersonSede(person, month=reportMonthKey()){
  const safeMonth=/^\d{4}-\d{2}$/.test(String(month || '')) ? month : reportMonthKey();
  return getPersonSedeAt(person, `${safeMonth}-01`) || getPersonSede(person) || userSede(userForAttendancePerson(person));
}
function getReportCollaborators(monthDate=reportMonthDate()){
  const month=salaryMonthKey(monthDate);
  return getFinancialReportPeople(monthDate).map(person=>{
    const linkedUser=userForAttendancePerson(person);
    return {
      id:`person:${person.personId}`,
      personId:person.personId,
      name:person.personName,
      role:linkedUser?.role || (person.payrollRole==='Jefe de Sede' ? 'manager' : 'employee'),
      sede:getReportPersonSede(person, month) || 'Lince',
      department:person.department || '',
      linkedUserId:linkedUser?.id || null
    };
  }).sort((a,b)=>a.name.localeCompare(b.name));
}
function getReportRecords(month=reportMonthKey()){
  const validRecords=getVisibleRecords().filter(r=>
    !!r.validatedAt &&
    recordAccountingMonthKey(r)===month &&
    reportSedeMatches(getItemSede(r))
  );
  if(state.reportMode==='user' && state.reportUser){
    const selected=getReportCollaborators(monthDateFromKey(month)).find(item=>item.id===state.reportUser);
    if(!selected) return [];
    if(selected.linkedUserId) return validRecords.filter(r=>Number(r.userId)===Number(selected.linkedUserId));
    return [];
  }
  return validRecords;
}
function getReportSummaryUsers(){
  return getReportableUsers().filter(u=>state.reportMode==='all'
    ? reportSedeMatches(userSede(u))
    : u.id==state.reportUser
  );
}
function getFinancialReportPeople(monthDate=reportMonthDate()){
  const month=salaryMonthKey(monthDate);
  const salaryData=ATTENDANCE ? getSalaryPeople({ ignoreFilters:true, date:monthDate }) : null;
  return (salaryData?.people || []).filter(person=>{
    const linkedUser=userForAttendancePerson(person);
    const sede=getReportPersonSede(person, month);
    if(!reportSedeMatches(sede)) return false;
    if(isAdmin()) return true;
    if(isManager()){
      if(canPreviewAllSedesAsManager()) return true;
      return sede===userSede(state.currentUser);
    }
    return linkedUser ? Number(linkedUser.id)===Number(state.currentUser.id) : false;
  });
}
function reportReferralStatusLabel(referral){
  if(referral.validatedAt) return `Aprobado ${fmt(referral.validatedAt)}`;
  if(referral.rejectedAt) return 'Rechazado';
  return referral.pendingApproval ? 'Pendiente de aprobacion' : 'Pendiente';
}
function reportDecisionStatusLabel(item){
  if(item.status==='APPROVED' || item.validatedAt) return `Aprobado ${fmt(item.validatedAt || item.createdAt)}`;
  if(item.status==='REJECTED' || item.rejectedAt) return 'Rechazado';
  return item.pendingApproval ? 'Pendiente de aprobacion' : 'Pendiente';
}
function reportRatingStatusLabel(row){
  if(!row?.valid) return row.missingFields?.length ? `No valida: falta ${row.missingFields.join(', ')}` : 'No valida';
  if(row.approvalStatus==='APPROVED') return 'Aprobada';
  if(row.approvalStatus==='REJECTED' || row.approvalStatus==='AUTO_REJECTED') return 'Rechazada';
  return 'Pendiente';
}
function getReportUserBundle(user){
  if(!user) return null;
  const salaryData=ATTENDANCE ? getSalaryPeople() : null;
  const targetName=normalizePersonName(user.name || user.username || '');
  const salaryPerson=(salaryData?.people || []).find(person=>{
    const linkedUser=userForAttendancePerson(person);
    if(linkedUser && Number(linkedUser.id)===Number(user.id)) return true;
    return normalizePersonName(person.personName || '')===targetName;
  }) || null;
  const records=getVisibleRecords().filter(record=>Number(record.userId)===Number(user.id));
  const referrals=REFERRALS.filter(referral=>Number(referral.userId)===Number(user.id));
  const wrongCards=WRONG_CARDS.filter(report=>Number(report.userId)===Number(user.id));
  const calls=CALL_REPORTS.filter(report=>Number(report.userId)===Number(user.id));
  const penalties=PENALTY_REPORTS.filter(report=>Number(report.workerUserId)===Number(user.id) || normalizePersonName(report.workerName || '')===targetName);
  const ratings=RATINGS.filter(row=>{
    if(Number(row.matchedUserId || 0)===Number(user.id)) return true;
    return normalizePersonName(row.matchedUserName || row.advisor || '')===targetName;
  });
  return {
    user,
    salaryData,
    salaryPerson,
    records,
    referrals,
    wrongCards,
    calls,
    penalties,
    ratings
  };
}
function getReportPersonBundle(reportPerson, month=reportMonthKey()){
  if(!reportPerson) return null;
  const salaryData=ATTENDANCE ? getSalaryPeople({ ignoreFilters:true, date:monthDateFromKey(month) }) : null;
  const salaryPerson=(salaryData?.people || []).find(person=>person.personId===reportPerson.personId) || null;
  const linkedUser=reportPerson.linkedUserId ? getUserById(Number(reportPerson.linkedUserId)) : userForAttendancePerson(salaryPerson);
  const userId=linkedUser?.id || null;
  const targetName=normalizePersonName(reportPerson.name || salaryPerson?.personName || '');
  const records=userId ? getVisibleRecords().filter(record=>Number(record.userId)===Number(userId) && !!record.validatedAt && recordAccountingMonthKey(record)===month) : [];
  const referrals=userId ? REFERRALS.filter(referral=>Number(referral.userId)===Number(userId) && monthKeyFromDate(referral.validatedAt || referral.createdAt)===month) : [];
  const wrongCards=userId ? WRONG_CARDS.filter(report=>Number(report.userId)===Number(userId) && monthKeyFromDate(report.validatedAt || report.detectedDate || report.createdAt)===month) : [];
  const calls=userId ? CALL_REPORTS.filter(report=>Number(report.userId)===Number(userId) && monthKeyFromDate(report.validatedAt || report.createdAt)===month) : [];
  const penalties=PENALTY_REPORTS.filter(report=>{
    if(monthKeyFromDate(report.decidedAt || report.createdAt)!==month) return false;
    if(userId && Number(report.workerUserId)===Number(userId)) return true;
    return normalizePersonName(report.workerName || '')===targetName;
  });
  const ratings=RATINGS.filter(row=>{
    if(monthKeyFromDate(row.date || row.rawDate)!==month) return false;
    if(userId && Number(row.matchedUserId || 0)===Number(userId)) return true;
    return normalizePersonName(row.matchedUserName || row.advisor || '')===targetName;
  });
  return {
    user: linkedUser ? { ...linkedUser, name: reportPerson.name, sede: reportPerson.sede } : { id:null, name:reportPerson.name, username:'', role:reportPerson.role, sede:reportPerson.sede },
    salaryData,
    salaryPerson,
    records,
    referrals,
    wrongCards,
    calls,
    penalties,
    ratings
  };
}
function roleToLocal(role){ return role==='ADMIN'?'admin':role==='MANAGER'?'manager':'employee'; }
function localToRole(role){ return role==='manager'?'MANAGER':role==='admin'?'ADMIN':'EMPLOYEE'; }
function platformToLocal(platform){ return platform==='DRIVE'?'drive':'web'; }
function localToPlatform(platform){ return platform==='drive'?'DRIVE':'WEB'; }
function modeToLocal(mode){ return mode==='PRESENCIAL'?'presencial':'virtual'; }
function localToMode(mode){ return mode==='presencial'?'PRESENCIAL':'VIRTUAL'; }
function typeToLocal(type){ return type==='OPERACION'?'operacion':'registro'; }
function localToType(type){ return type==='operacion'?'OPERACION':'REGISTRO'; }
function isoDate(value){ return value?String(value).slice(0,10):''; }
function mapUser(user){
  return {
    id:user.id,
    name:user.name,
    username:user.username,
    role:roleToLocal(user.role),
    sede:normalizeSede(user.sede),
    forcePasswordReset:!!user.forcePasswordReset,
    color:user.color||COLORS[user.id % COLORS.length]
  };
}
function mapRecord(record){
  return {
    id:record.id,
    userId:record.userId,
    user:record.user ? mapUser(record.user) : null,
    historicalSede:normalizeSede(record.historicalSede || record.user?.sede),
    cliente:record.clientName||'',
    dni:record.dni,
    tipo:typeToLocal(record.type),
    fecha:isoDate(record.registrationDate),
    fechaOperacion:isoDate(record.operationDate),
    validatedAt:isoDate(record.validatedAt),
    validatedById:record.validatedById || record.validatedBy?.id || null,
    validatedBy:record.validatedBy ? mapUser(record.validatedBy) : null,
    rejectedAt:isoDate(record.rejectedAt),
    rejectionReason:record.rejectionReason||'',
    createdAt:record.createdAt||`${isoDate(record.registrationDate)}T09:00`,
    modalidad:modeToLocal(record.mode),
    plataforma:platformToLocal(record.uploadPlatform),
    notas:record.notes||'',
    isDuplicate:!!record.isDuplicate,
    duplicateDetails:Array.isArray(record.duplicateDetails)?record.duplicateDetails:[]
  };
}
function mapReferral(referral){
  return {
    id:referral.id,
    userId:referral.userId,
    user:referral.user ? mapUser(referral.user) : null,
    historicalSede:normalizeSede(referral.historicalSede || referral.user?.sede),
    cliente:referral.clientName||'',
    dni:referral.dni||'',
    amount:Number(referral.amount||0),
    bank:referral.bank,
    bankLabel:referral.bankLabel||referralBankLabel(referral.bank),
    bankCommission:calcReferralBankCommission(referral.bank, Number(referral.amount||0)),
    referralCommission:calcReferralCommission(referral.bank, Number(referral.amount||0)),
    notes:referral.notes||'',
    createdAt:referral.createdAt||'',
    validatedAt:isoDate(referral.validatedAt),
    rejectedAt:isoDate(referral.rejectedAt),
    rejectionReason:referral.rejectionReason||'',
    pendingApproval:!!referral.pendingApproval
  };
}
function mapWrongCard(report){
  return {
    id:report.id,
    userId:report.userId,
    user:report.user ? mapUser(report.user) : null,
    historicalSede:normalizeSede(report.historicalSede || report.user?.sede),
    cliente:report.clientName||'',
    dni:report.clientDni||'',
    detectedDate:isoDate(report.detectedDate),
    notes:report.notes||'',
    status:report.status||'PENDING',
    validatedAt:isoDate(report.validatedAt),
    rejectedAt:isoDate(report.rejectedAt),
    rejectionReason:report.rejectionReason||'',
    createdAt:report.createdAt||'',
    bonusAmount:Number(report.bonusAmount||getWrongCardBonus()),
    pendingApproval:!!report.pendingApproval
  };
}
function mapCallReport(report){
  return {
    id:report.id,
    userId:report.userId,
    user:report.user ? mapUser(report.user) : null,
    historicalSede:normalizeSede(report.historicalSede || report.user?.sede),
    cliente:report.clientName||'',
    dni:report.clientDni||'',
    status:report.status||'PENDING',
    validatedAt:isoDate(report.validatedAt),
    rejectedAt:isoDate(report.rejectedAt),
    rejectionReason:report.rejectionReason||'',
    createdAt:report.createdAt||'',
    bonusAmount:Number(report.bonusAmount||getCallCommission()),
    pendingApproval:!!report.pendingApproval
  };
}
function mapSafetypayCode(entry){
  return {
    id:entry.id,
    userId:entry.userId,
    user:entry.user ? mapUser(entry.user) : null,
    historicalSede:normalizeSede(entry.historicalSede || entry.user?.sede),
    clientDni:entry.clientDni||'',
    cardLast4:entry.cardLast4||'',
    customerCode:entry.customerCode||'',
    bank:entry.bank||'CMR',
    code:entry.code||'ATK1',
    amount:Number(entry.amount||0),
    operationNumber:entry.operationNumber||'',
    paymentStatus:entry.paymentStatus||'PENDING',
    paidAt:entry.paidAt||'',
    createdAt:entry.createdAt||''
  };
}
function wrongCardStatusMeta(report){
  if(report.status==='APPROVED' || report.validatedAt) return { cls:'ok', label:`Aprobada ${fmt(report.validatedAt)}` };
  if(report.status==='REJECTED' || report.rejectedAt) return { cls:'danger', label:'Rechazada' };
  return { cls:'warn', label:'Pendiente' };
}
function mapPenaltyReport(report){
  return {
    id:report.id,
    clientDni:report.clientDni||'',
    clientName:report.clientName||'',
    workerUserId:report.workerUserId||null,
    workerName:report.workerName||'',
    workerSede:normalizeSede(report.workerSede),
    targetSede:normalizeSede(report.targetSede),
    penaltyCode:report.penaltyCode||'',
    penaltyLabel:report.penaltyLabel||'Penalidad',
    penaltyAmount:Number(report.penaltyAmount||0),
    category:report.category||'CUSTOMER_SERVICE',
    evidenceImage:report.evidenceImage||'',
    managerPenaltyAmount:Number(report.managerPenaltyAmount||0),
    reporterBonusAmount:Number(report.reporterBonusAmount||0),
    reason:report.reason||'',
    status:report.status||'PENDING',
    sentById:report.sentById,
    sentBy:report.sentBy ? mapUser(report.sentBy) : null,
    receiver:report.receiver ? mapUser(report.receiver) : null,
    decidedBy:report.decidedBy ? mapUser(report.decidedBy) : null,
    decidedById:report.decidedById||report.decidedBy?.id||null,
    decidedAt:report.decidedAt||'',
    decisionReason:report.decisionReason||'',
    createdAt:report.createdAt||'',
    pendingApproval:!!report.pendingApproval
  };
}
function getPenaltyRules(){
  return Array.isArray(SETTINGS.customerServicePenalties) && SETTINGS.customerServicePenalties.length
    ? SETTINGS.customerServicePenalties
    : DEFAULT_CUSTOMER_SERVICE_PENALTIES;
}
function penaltyStatusMeta(status){
  if(status==='APPROVED') return { cls:'ok', label:'Aprobado' };
  if(status==='REJECTED') return { cls:'danger', label:'Rechazado' };
  return { cls:'warn', label:'Pendiente' };
}
function getPenaltyInboxReports(){
  if(isAdmin()) return PENALTY_REPORTS.filter(r=>r.status==='PENDING');
  if(!isManager()) return [];
  return PENALTY_REPORTS.filter(r=>r.status==='PENDING' && userSede(state.currentUser)===r.targetSede);
}
function isPaymentAuditReport(report){
  return report?.category==='PAYMENT_AUDIT' || report?.penaltyCode==='PAYMENT_AUDIT_ERROR';
}
function normalizedPersonWords(value){
  return String(value||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
}
function isPaymentAuditReporter(user=state.currentUser){
  if(!user) return false;
  const words=new Set([...normalizedPersonWords(user.name), ...normalizedPersonWords(user.username)]);
  return ['franco','matias','junior','andrea','laura'].some(name=>words.has(name));
}
function canAccessPaymentAudits(){ return isPaymentAuditReporter() || isManager() || isAdmin(); }
function playNotificationSound(){
  try{
    const AudioContext=window.AudioContext||window.webkitAudioContext;
    if(!AudioContext) return;
    const ctx=new AudioContext();
    const osc=ctx.createOscillator();
    const gain=ctx.createGain();
    osc.type='sine';
    osc.frequency.setValueAtTime(780, ctx.currentTime);
    osc.frequency.setValueAtTime(980, ctx.currentTime + 0.11);
    gain.gain.setValueAtTime(0.001, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.08, ctx.currentTime + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.25);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.28);
  }catch(error){
    // Some browsers block audio until the first user interaction.
  }
}
function showNotificationToast({ title, message, icon='!', view='alertas', onOpen=null }){
  const old=document.getElementById('notificationToast');
  if(old) old.remove();
  const toast=document.createElement('div');
  toast.id='notificationToast';
  toast.className='notify-toast';
  toast.innerHTML=`<div class="notify-icon">${icon}</div><div><strong>${title}</strong><span>${message}</span></div>`;
  document.body.appendChild(toast);
  setTimeout(()=>toast.classList.add('show'), 20);
  setTimeout(()=>{ toast.classList.remove('show'); setTimeout(()=>toast.remove(), 250); }, 5200);
  toast.onclick=()=>{
    if(typeof onOpen==='function') onOpen();
    else state.view=view;
    render();
    toast.remove();
  };
  playNotificationSound();
}
function showPenaltyToast(report){
  showNotificationToast({
    icon:'!',
    title:'Nueva penalidad recibida',
    message:`${report.workerName} - ${report.penaltyLabel}`,
    view:'penalidades',
    onOpen:()=>{ state.view='penalidades'; state.penaltyTab='received'; }
  });
  if(state.view==='penalidades'){
    state.penaltyTab='received';
    preserveMainScroll(()=>render());
  }
}
function checkPenaltyInboxNotification(previousReports=[]){
  if(!state.currentUser || !isManager()) return;
  const key=`penaltyInboxLast:${state.currentUser.id}`;
  const previousMax=previousReports
    .filter(r=>r.status==='PENDING' && r.targetSede===userSede(state.currentUser))
    .reduce((max,r)=>Math.max(max, Number(r.id)||0), Number(localStorage.getItem(key)||0));
  const incoming=getPenaltyInboxReports().sort((a,b)=>Number(b.id)-Number(a.id))[0];
  if(!incoming) return;
  const incomingId=Number(incoming.id)||0;
  const lastSeen=Number(localStorage.getItem(key)||0);
  if(incomingId > Math.max(previousMax, lastSeen)){
    localStorage.setItem(key, String(incomingId));
    showPenaltyToast(incoming);
  }else if(incomingId > lastSeen){
    localStorage.setItem(key, String(incomingId));
  }
}
function byId(items=[]){
  const map=new Map();
  items.forEach(item=>map.set(Number(item.id), item));
  return map;
}
function changedFromEmpty(previous, current, field){
  return !previous?.[field] && !!current?.[field];
}
function changedStatus(previous, current){
  if(!previous || !current) return false;
  if(previous.status && current.status && previous.status!==current.status) return true;
  return changedFromEmpty(previous, current, 'validatedAt') ||
    changedFromEmpty(previous, current, 'rejectedAt') ||
    changedFromEmpty(previous, current, 'decidedAt');
}
function shouldNotifyReviewer(itemUserId){
  return (isAdmin() || isManager()) && Number(itemUserId)!==Number(state.currentUser?.id);
}
function notifyStateChanges(previous){
  if(!state.currentUser || state.view==='login' || state.view==='force-password') return;
  const previousRecords=byId(previous.records);
  const previousReferrals=byId(previous.referrals);
  const previousWrongCards=byId(previous.wrongCards);
  const previousCalls=byId(previous.calls);
  const previousSafetypay=byId(previous.safetypay);
  const previousPenalties=byId(previous.penalties);

  const newPendingRecord=RECORDS.find(record=>
    !previousRecords.has(Number(record.id)) &&
    shouldNotifyReviewer(record.userId)
  );
  if(newPendingRecord){
    const user=getUserById(newPendingRecord.userId);
    showNotificationToast({
      icon:'!',
      title:'Nuevo registro enviado',
      message:`${user.name} - ${newPendingRecord.cliente || newPendingRecord.dni}`,
      view:isAdmin()||isManager()?'todos':'mis-registros',
      onOpen:()=>{ state.view=isAdmin()||isManager()?'todos':'mis-registros'; }
    });
    return;
  }

  const newReferral=REFERRALS.find(referral=>
    !previousReferrals.has(Number(referral.id)) &&
    shouldNotifyReviewer(referral.userId)
  );
  if(newReferral){
    const user=getUserById(newReferral.userId);
    showNotificationToast({
      icon:'!',
      title:'Nuevo referido enviado',
      message:`${user.name} - ${newReferral.cliente || newReferral.dni}`,
      view:'referidos'
    });
    return;
  }

  const newWrongCard=WRONG_CARDS.find(report=>
    !previousWrongCards.has(Number(report.id)) &&
    shouldNotifyReviewer(report.userId)
  );
  if(newWrongCard){
    const user=getUserById(newWrongCard.userId);
    showNotificationToast({
      icon:'!',
      title:'Nueva tarjeta erronea',
      message:`${user.name} - ${newWrongCard.cliente || newWrongCard.dni}`,
      view:'tarjetas'
    });
    return;
  }

  const newCall=CALL_REPORTS.find(report=>
    !previousCalls.has(Number(report.id)) &&
    shouldNotifyReviewer(report.userId)
  );
  if(newCall){
    const user=getUserById(newCall.userId);
    showNotificationToast({
      icon:'!',
      title:'Nueva llamada registrada',
      message:`${user.name} - ${newCall.cliente || newCall.dni}`,
      view:'llamadas'
    });
    return;
  }

  SUPPRESSED_SAFETYPAY_NOTIFY_IDS.forEach(id=>{
    if(!SAFETYPAY_CODES.some(entry=>Number(entry.id)===id)) SUPPRESSED_SAFETYPAY_NOTIFY_IDS.delete(id);
  });
  const newSafetypay=SAFETYPAY_CODES.find(entry=>{
    const entryId=Number(entry.id);
    return !SUPPRESSED_SAFETYPAY_NOTIFY_IDS.has(entryId) &&
      !previousSafetypay.has(entryId) &&
      shouldNotifyReviewer(entry.userId);
  });
  if(newSafetypay){
    const user=newSafetypay.user || getUserById(newSafetypay.userId);
    showNotificationToast({
      icon:'!',
      title:'Nuevo codigo Safetypay',
      message:`${user.name} - ${newSafetypay.bank} - ${money(newSafetypay.amount)}`,
      view:'safetypay'
    });
    return;
  }

  const ownRecordDecision=RECORDS.find(record=>{
    if(Number(record.userId)!==Number(state.currentUser.id)) return false;
    const previousRecord=previousRecords.get(Number(record.id));
    return changedFromEmpty(previousRecord, record, 'validatedAt') || changedFromEmpty(previousRecord, record, 'rejectedAt');
  });
  if(ownRecordDecision){
    showNotificationToast({
      icon:ownRecordDecision.validatedAt?'OK':'NO',
      title:ownRecordDecision.validatedAt?'Registro validado':'Registro rechazado',
      message:`${ownRecordDecision.cliente || ownRecordDecision.dni}`,
      view:'mis-registros'
    });
    return;
  }

  const ownReferralDecision=REFERRALS.find(referral=>{
    if(Number(referral.userId)!==Number(state.currentUser.id)) return false;
    const previousReferral=previousReferrals.get(Number(referral.id));
    return changedFromEmpty(previousReferral, referral, 'validatedAt') || changedFromEmpty(previousReferral, referral, 'rejectedAt');
  });
  if(ownReferralDecision){
    showNotificationToast({
      icon:ownReferralDecision.validatedAt?'OK':'NO',
      title:ownReferralDecision.validatedAt?'Referido validado':'Referido rechazado',
      message:`${ownReferralDecision.cliente || ownReferralDecision.dni}`,
      view:'referidos'
    });
    return;
  }

  const ownWrongCardDecision=WRONG_CARDS.find(report=>{
    if(Number(report.userId)!==Number(state.currentUser.id)) return false;
    const previousReport=previousWrongCards.get(Number(report.id));
    return changedStatus(previousReport, report);
  });
  if(ownWrongCardDecision){
    showNotificationToast({
      icon:ownWrongCardDecision.status==='APPROVED'?'OK':'NO',
      title:ownWrongCardDecision.status==='APPROVED'?'Tarjeta aprobada':'Tarjeta rechazada',
      message:`${ownWrongCardDecision.cliente || ownWrongCardDecision.dni}`,
      view:'tarjetas'
    });
    return;
  }

  const ownCallDecision=CALL_REPORTS.find(report=>{
    if(Number(report.userId)!==Number(state.currentUser.id)) return false;
    const previousReport=previousCalls.get(Number(report.id));
    return changedStatus(previousReport, report);
  });
  if(ownCallDecision){
    showNotificationToast({
      icon:ownCallDecision.status==='APPROVED'?'OK':'NO',
      title:ownCallDecision.status==='APPROVED'?'Llamada aprobada':'Llamada rechazada',
      message:`${ownCallDecision.cliente || ownCallDecision.dni}`,
      view:'llamadas'
    });
    return;
  }

  const ownPenalty=(!isAdmin() && !isManager()) ? PENALTY_REPORTS.find(report=>{
    if(Number(report.workerUserId)!==Number(state.currentUser.id)) return false;
    const previousReport=previousPenalties.get(Number(report.id));
    return !previousReport || changedStatus(previousReport, report);
  }) : null;
  if(ownPenalty){
    showNotificationToast({
      icon:'!',
      title:'Penalidad registrada',
      message:`${ownPenalty.penaltyLabel} - ${ownPenalty.clientName}`,
      view:'penalidades',
      onOpen:()=>{ state.view='penalidades'; state.penaltyTab='received'; }
    });
    return;
  }

  const sentPenaltyDecision=(isAdmin() || isManager()) ? PENALTY_REPORTS.find(report=>{
    if(Number(report.sentById)!==Number(state.currentUser.id)) return false;
    const previousReport=previousPenalties.get(Number(report.id));
    return previousReport && changedStatus(previousReport, report);
  }) : null;
  if(sentPenaltyDecision){
    showNotificationToast({
      icon:sentPenaltyDecision.status==='APPROVED'?'OK':'NO',
      title:sentPenaltyDecision.status==='APPROVED'?'Penalidad aprobada':'Penalidad rechazada',
      message:`${sentPenaltyDecision.workerName} - ${sentPenaltyDecision.penaltyLabel}`,
      view:'penalidades',
      onOpen:()=>{ state.view='penalidades'; state.penaltyTab='sent'; }
    });
  }
}
function applyStatePayload(payload){
  if(LOGOUT_SUBMITTING) return;
  STATE_RESPONSE_REVISIONS.clear();
  const previousScope=getSessionScopeKey();
  const previousPenaltyReports=[...PENALTY_REPORTS];
  const previousForNotifications={
    records:[...RECORDS],
    referrals:[...REFERRALS],
    wrongCards:[...WRONG_CARDS],
    calls:[...CALL_REPORTS],
    safetypay:[...SAFETYPAY_CODES],
    penalties:[...PENALTY_REPORTS]
  };
  if(hasPayloadKey(payload, 'users')) USERS = (payload.users||[]).map(mapUser);
  if(hasPayloadKey(payload, 'penaltyReportUsers')) PENALTY_REPORT_USERS = (payload.penaltyReportUsers||[]).map(mapUser);
  if(hasPayloadKey(payload, 'records')) RECORDS = (payload.records||[]).map(mapRecord);
  if(hasPayloadKey(payload, 'referrals')) REFERRALS = (payload.referrals||[]).map(mapReferral);
  if(hasPayloadKey(payload, 'wrongCards')) WRONG_CARDS = (payload.wrongCards||[]).map(mapWrongCard);
  if(hasPayloadKey(payload, 'callReports')) CALL_REPORTS = (payload.callReports||[]).map(mapCallReport);
  if(hasPayloadKey(payload, 'safetypayCodes')){
    SAFETYPAY_CODES = (payload.safetypayCodes||[]).map(mapSafetypayCode);
    SALARY_PEOPLE_CACHE_KEY = '';
    SALARY_PEOPLE_CACHE_VALUE = null;
    SALARY_PEOPLE_CACHE_MAP.clear();
  }
  if(hasPayloadKey(payload, 'penaltyReports')) PENALTY_REPORTS = (payload.penaltyReports||[]).map(mapPenaltyReport);
  if(hasPayloadKey(payload, 'monthlyClosures')) MONTHLY_CLOSURES = Array.isArray(payload.monthlyClosures) ? payload.monthlyClosures : MONTHLY_CLOSURES;
  if(hasPayloadKey(payload, 'settings')){
    if(Array.isArray(payload.settings?.ratingRequiredFields)){
      const required=payload.settings.ratingRequiredFields.filter(field=>['dni','comment','advisor'].includes(field));
      RATING_SETTINGS={...RATING_SETTINGS, requiredFields:required.length?required:['dni']};
    }
    SETTINGS = {
      commissionPerRecord: Number(payload.settings?.commissionPerRecord ?? 0.4) || 0.4,
      safetypayMonthlyGoal: Number(payload.settings?.safetypayMonthlyGoal ?? DEFAULT_SAFETYPAY_MONTHLY_GOAL) || DEFAULT_SAFETYPAY_MONTHLY_GOAL,
      safetypaySedeGoals: payload.settings?.safetypaySedeGoals || null,
      safetypayGoalHistory: payload.settings?.safetypayGoalHistory || null,
      payoutSettings: { ...DEFAULT_PAYOUT_SETTINGS, ...(payload.settings?.payoutSettings || {}) },
      customerServicePenalties: payload.settings?.customerServicePenalties || DEFAULT_CUSTOMER_SERVICE_PENALTIES
    };
    SALARY_PEOPLE_CACHE_KEY = '';
    SALARY_PEOPLE_CACHE_VALUE = null;
    SALARY_PEOPLE_CACHE_MAP.clear();
  }
  markLoadedStateModules(payload);
  if(payload.currentUser) state.currentUser = mapUser(payload.currentUser);
  const nextScope=getSessionScopeKey();
  if(previousScope && previousScope!==nextScope){
    resetSessionViewState();
  }
  const canNotifyChanges=!!previousScope && previousScope===nextScope;
  state.resetUserId = payload.currentUser.forcePasswordReset ? payload.currentUser.id : null;
  if(state.currentUser.forcePasswordReset){
    state.view='force-password';
  } else if(!state.view || state.view==='login' || state.view==='force-password'){
    state.view=state.currentUser.role==='admin'?'dashboard':'mis-registros';
  }
  if(canNotifyChanges){
    checkPenaltyInboxNotification(previousPenaltyReports);
    notifyStateChanges(previousForNotifications);
  }
  warmSessionData();
}
function apiFetch(url, options={}){
  const method=String(options.method || 'GET').toUpperCase();
  if(method!=='GET'){
    API_READS_IN_FLIGHT.clear();
    STATE_RESPONSE_REVISIONS.clear();
    STATE_RESPONSE_WRITE_VERSION++;
    return performApiFetch(url,options);
  }
  const key=JSON.stringify([getSessionScopeKey(),url,options.headers || {}]);
  if(API_READS_IN_FLIGHT.has(key)) return API_READS_IN_FLIGHT.get(key);
  const pending=performApiFetch(url,options).finally(()=>{
    if(API_READS_IN_FLIGHT.get(key)===pending) API_READS_IN_FLIGHT.delete(key);
  });
  API_READS_IN_FLIGHT.set(key,pending);
  return pending;
}
async function performApiFetch(url, options={}){
  const fetchOptions={...options};
  const silent=!!fetchOptions.silent;
  delete fetchOptions.silent;
  if(!silent) showBusy(fetchOptions.busyMessage || 'Procesando...');
  delete fetchOptions.busyMessage;
  try{
  const response = await fetch(url, {
    credentials:'include',
    cache:'no-store',
    ...fetchOptions,
    headers:{
      'Content-Type':'application/json',
      ...(fetchOptions.headers||{}),
      ...sessionRequestHeaders()
    }
  });
    const payload = await response.json().catch(()=>({}));
    if(!response.ok){
      const error = new Error(payload.error || 'Error de servidor');
      error.status = response.status;
      error.payload = payload;
      if(response.status===401) clearTabSession();
      if(response.status===401 && state.view!=='login'){
        resetSessionViewState();
        state.currentUser=null;
        state.resetUserId=null;
        state.view='login';
        SESSION_WARMUP_KEY='';
        render();
        error.message='Tu sesion vencio. Ingresa otra vez para continuar.';
      }
      throw error;
    }
    if(fetchOptions.method && fetchOptions.method.toUpperCase()!=='GET'){ STATE_MODULE_SNAPSHOTS.clear(); CHANGE_LOGS=null; }
    return payload;
  } finally {
    if(!silent) hideBusy();
  }
}
async function refreshState(silent=false, modules=null, bootstrap=false){
  const requestedSession=getSessionScopeKey();
  const requestedWriteVersion=STATE_RESPONSE_WRITE_VERSION;
  const loadingKeys=Array.isArray(modules) && modules.length ? modules.map(module=>stateModuleLoadKey(module)) : [];
  const requestedMonth=Array.isArray(modules) && modules.length ? scopedDataMonthForView() : null;
  if(Array.isArray(modules) && modules.length){
    loadingKeys.forEach(key=>STATE_MODULES_LOADING.add(key));
  }
  try{
    const stateUrl=buildStateUrl(modules, requestedMonth);
    const responseKey=`${requestedSession}|${stateUrl}|${bootstrap ? 'bootstrap' : 'view'}`;
    let requestUrl=bootstrap ? stateUrl+(stateUrl.includes('?')?'&':'?')+'bootstrap=1' : stateUrl;
    const priorRevision=silent ? STATE_RESPONSE_REVISIONS.get(responseKey) : null;
    if(priorRevision) requestUrl+=(requestUrl.includes('?')?'&':'?')+'since='+encodeURIComponent(priorRevision);
    const payload = await apiFetch(requestUrl, { method:'GET', silent, busyMessage:'Actualizando informacion...' });
    if(LOGOUT_SUBMITTING || requestedWriteVersion!==STATE_RESPONSE_WRITE_VERSION) return null;
    if(requestedSession && requestedSession!==getSessionScopeKey()) return null;
    // Do not let a late response for a previous month overwrite the month the
    // user is currently viewing. This was leaving Safetypay intermittently at 0.
    if(loadingKeys.length && requestedMonth!==scopedDataMonthForView()) return null;
    if(payload.unchanged) return payload;
    if(loadingKeys.length) payload.__loadedStateModuleKeys = bootstrap
      ? ['settings','monthlyClosures','users','records','referrals','wrongCards','callReports','penaltyReports'].filter(module=>hasPayloadKey(payload,module)).map(module=>stateModuleLoadKey(module))
      : loadingKeys;
    applyStatePayload(payload);
    if(payload.revision){
      STATE_RESPONSE_REVISIONS.set(responseKey,payload.revision);
      while(STATE_RESPONSE_REVISIONS.size>32) STATE_RESPONSE_REVISIONS.delete(STATE_RESPONSE_REVISIONS.keys().next().value);
    }
    return payload;
  } finally {
    loadingKeys.forEach(key=>STATE_MODULES_LOADING.delete(key));
  }
}
async function loadAttendance(force=false, silent=false){
  if(silent && ATTENDANCE_LOADING) return false;
  // Payroll and reports need former collaborators too: they remain payable in
  // the months worked and can contribute to a historical manager bonus.
  const needsInactiveCollaborators=isAdmin() && ['colaboradores','sueldos','reportes','estadisticas','cierre','archivo-cierres'].includes(state.view);
  const scopeKey=attendanceCacheKey();
  if(ATTENDANCE_OWNER_KEY && ATTENDANCE_OWNER_KEY!==scopeKey){
    resetAttendanceCache();
  }
  if(ATTENDANCE && !force && (!needsInactiveCollaborators || ATTENDANCE_INCLUDES_INACTIVE)){
    ATTENDANCE_LOADING = false;
    return ATTENDANCE;
  }
  ATTENDANCE_LOADING = true;
  ATTENDANCE_ERROR = '';
  if(!silent) render();
  try{
    const params=new URLSearchParams();
    const month=scopedDataMonthForView(state.view);
    // Gratification needs every month of the semester, not only the visible payroll month.
    if(month && !salaryHistoryRequested()) params.set('month', month);
    if(needsInactiveCollaborators) params.set('includeInactive','1');
    if(silent && ATTENDANCE?.revision) params.set('since',ATTENDANCE.revision);
    const url=params.toString() ? `/api/attendance?${params.toString()}` : '/api/attendance';
    const payload=await apiFetch(url, { method:'GET', silent, busyMessage:'Cargando asistencias...' });
    if(scopeKey!==attendanceCacheKey()) return false;
    if(payload.unchanged) return false;
    setAttendancePayload(payload,needsInactiveCollaborators);
    return ATTENDANCE;
  }catch(error){
    if(scopeKey!==attendanceCacheKey() || (silent && ATTENDANCE)) return false;
    ATTENDANCE = null;
    ATTENDANCE_ERROR = error.message || 'No se pudo cargar la asistencia.';
    return null;
  } finally {
    ATTENDANCE_LOADING = false;
    if(!silent || scopeKey!==attendanceCacheKey()) render();
  }
}
function viewNeedsInactiveAttendance(){
  return isAdmin() && ['colaboradores','sueldos','reportes','estadisticas','cierre','archivo-cierres'].includes(state.view);
}
function ensureAttendanceLoaded(){
  if(ATTENDANCE_OWNER_KEY && ATTENDANCE_OWNER_KEY!==attendanceCacheKey()){
    resetAttendanceCache();
  }
  const needsInactive=viewNeedsInactiveAttendance();
  const hasInactive=ATTENDANCE_INCLUDES_INACTIVE;
  if((!ATTENDANCE || (needsInactive && !hasInactive)) && !ATTENDANCE_LOADING && state.currentUser){
    setTimeout(()=>loadAttendance(needsInactive), 0);
    return true;
  }
  return false;
}
function ratingsCacheKey(month=scopedDataMonthForView(state.view)){
  return `${getSessionScopeKey()}|${month || salaryMonthKey()}`;
}

// Start independent section data together, before waiting for its state modules.
function startViewDataLoads(view){
  const scope=getSessionScopeKey();
  const month=scopedDataMonthForView(view);
  const refresh=()=>{ if(scope===getSessionScopeKey() && state.view===view && month===scopedDataMonthForView()) preserveMainScroll(()=>render()); };
  if(['dashboard','estadisticas','sueldos','reportes','mis-comisiones','calificaciones'].includes(view) && !ratingsLoadedFor(month) && !RATINGS_LOADING && !RATINGS_ERROR){
    loadRatings(false,true,month).then(refresh);
  }
  const needsAttendance=['asistencia','sueldos','colaboradores','cierre','reportes','mis-comisiones'].includes(view) || (view==='admin' && state.adminTab==='calendar') || (view==='dashboard' && isManager());
  const needsReload=!ATTENDANCE || ATTENDANCE_OWNER_KEY!==attendanceCacheKey() || (viewNeedsInactiveAttendance() && !ATTENDANCE_INCLUDES_INACTIVE);
  if(needsAttendance && needsReload && !ATTENDANCE_LOADING && !ATTENDANCE_ERROR){
    loadAttendance(false,true).then(refresh);
  }
}

function ratingsLoadedFor(month=scopedDataMonthForView(state.view)){
  return RATINGS_LOADED && RATINGS_SCOPE_KEY===ratingsCacheKey(month);
}

async function submitRatingDecision(rowKey,action,reason){
  const sessionKey=getSessionScopeKey(),scopeKey=RATINGS_SCOPE_KEY;
  RATINGS_DECISION_REVISION++;
  const payload=await apiFetch('/api/ratings/decision',{
    method:'POST',body:JSON.stringify({rowKey,action,reason}),
    busyMessage:action==='approve'?'Aprobando calificacion...':action==='reject'?'Rechazando calificacion...':'Actualizando calificacion...'
  });
  RATINGS_DECISION_REVISION++;
  if(sessionKey!==getSessionScopeKey()) return;
  if(payload.row?.rowKey===rowKey && scopeKey===RATINGS_SCOPE_KEY){
    RATINGS=RATINGS.map(row=>row.rowKey===rowKey?{...row,...payload.row}:row);
    MANAGER_REPORT_RATINGS=MANAGER_REPORT_RATINGS.map(row=>row.rowKey===rowKey?{...row,...payload.row}:row);
    SALARY_PEOPLE_CACHE_KEY='';SALARY_PEOPLE_CACHE_VALUE=null;SALARY_PEOPLE_CACHE_MAP.clear();
    preserveMainScroll(()=>render());
  }else if(scopeKey===RATINGS_SCOPE_KEY){
    await loadRatings(true);
  }
}

async function loadRatings(force=false, silent=false, month=scopedDataMonthForView(state.view)){
  const decisionRevision=RATINGS_DECISION_REVISION;
  const scopeKey=ratingsCacheKey(month);
  const sessionKey=getSessionScopeKey();
  if(RATINGS_LOADED && RATINGS_SCOPE_KEY===scopeKey && !force) return RATINGS;
  RATINGS_LOADING = true;
  RATINGS_ERROR = '';
  if(!silent) preserveMainScroll(()=>render());
  try{
    const params=new URLSearchParams();
    if(month) params.set('month', month);
    const url=params.toString() ? `/api/ratings?${params.toString()}` : '/api/ratings';
    const payload = await apiFetch(url, { method:'GET', silent, busyMessage:'Cargando calificaciones...' });
    if(sessionKey!==getSessionScopeKey() || scopeKey!==ratingsCacheKey() || decisionRevision!==RATINGS_DECISION_REVISION) return [];
    RATINGS = Array.isArray(payload.rows) ? payload.rows : [];
    RATING_SETTINGS = payload.settings || RATING_SETTINGS;
    RATINGS_LOADED = true;
    RATINGS_SCOPE_KEY = scopeKey;
    return RATINGS;
  }catch(error){
    if(sessionKey!==getSessionScopeKey() || scopeKey!==ratingsCacheKey() || decisionRevision!==RATINGS_DECISION_REVISION) return [];
    RATINGS = [];
    RATINGS_ERROR = error.message || 'No se pudo cargar calificaciones.';
    RATINGS_SCOPE_KEY = '';
    return [];
  } finally {
    RATINGS_LOADING = false;
    const ratingsView=['dashboard','estadisticas','sueldos','reportes','mis-comisiones','calificaciones'].includes(state.view);
    const canPaint=state.modal===null && !state.ratingEdit && !state.attendanceEdit && !state.newModal && !state.collaboratorEditId && !isEditingForm();
    if(!silent || (sessionKey===getSessionScopeKey() && ratingsView && canPaint)) preserveMainScroll(()=>render());
  }
}

function stopAutoRefresh(){
  if(AUTO_REFRESH_TIMER){
    clearInterval(AUTO_REFRESH_TIMER);
    AUTO_REFRESH_TIMER = null;
    AUTO_REFRESH_LAST_AT = 0;
  }
}

async function loadManagerReportRatings(period){
  const key=`${getSessionScopeKey()}|${period.from}|${period.to}`;
  if(MANAGER_REPORT_RATINGS_KEY===key) return MANAGER_REPORT_RATINGS;
  if(MANAGER_REPORT_RATINGS_LOADING) return MANAGER_REPORT_RATINGS;
  MANAGER_REPORT_RATINGS_LOADING=true;
  try{
    const params=new URLSearchParams({ from:period.from, to:period.to });
    const payload=await apiFetch(`/api/ratings?${params.toString()}`, { method:'GET', silent:true, busyMessage:'Cargando calificaciones del reporte...' });
    MANAGER_REPORT_RATINGS=Array.isArray(payload.rows) ? payload.rows : [];
    MANAGER_REPORT_RATINGS_KEY=key;
    return MANAGER_REPORT_RATINGS;
  }catch(_error){
    MANAGER_REPORT_RATINGS=[];
    MANAGER_REPORT_RATINGS_KEY=key;
    return [];
  }finally{
    MANAGER_REPORT_RATINGS_LOADING=false;
    if(state.view==='dashboard') preserveMainScroll(()=>render());
  }
}

function statsTrendCacheKey(month, sede, count){
  return `${getSessionScopeKey()}|${month}|${sede || 'all'}|${count}`;
}
async function loadStatsTrend(month, sede, count){
  const key=statsTrendCacheKey(month, sede, count);
  if(STATS_TREND_KEY===key) return STATS_TREND;
  if(STATS_TREND_LOADING) return STATS_TREND;
  STATS_TREND_LOADING=true;
  STATS_TREND_ERROR='';
  try{
    const params=new URLSearchParams({ month, months:String(count) });
    if(sede) params.set('sede', sede);
    const payload=await apiFetch(`/api/stats-trend?${params.toString()}`, { method:'GET', silent:true, busyMessage:'Cargando comparativo mensual...' });
    STATS_TREND=Array.isArray(payload.months) ? payload.months : [];
    STATS_TREND_KEY=key;
    return STATS_TREND;
  }catch(error){
    STATS_TREND=[];
    STATS_TREND_KEY=key;
    STATS_TREND_ERROR=error.message || 'No se pudo cargar el comparativo mensual.';
    return [];
  }finally{
    STATS_TREND_LOADING=false;
    if(state.view==='estadisticas') preserveMainScroll(()=>render());
  }
}

function isEditingForm(){
  const active=document.activeElement;
  if(!active) return false;
  const tag=(active.tagName||'').toUpperCase();
  if(tag==='INPUT' || tag==='TEXTAREA' || tag==='SELECT') return true;
  if(active.isContentEditable) return true;
  return false;
}

function hasReferralDraft(){
  return REFERRAL_DRAFT_DIRTY && ['clientName','dni','amount','notes'].some(key=>String(REFERRAL_DRAFT[key]||'').trim());
}
function hasPenaltyReportDraft(){
  if(state.view!=='penalidades' || state.penaltyTab!=='new') return false;
  return PENALTY_REPORT_DRAFT_DIRTY;
}
function hasSafetypayDraft(){
  return SAFETYPAY_DRAFT_DIRTY && ['clientDni','cardLast4','amount','operationNumber'].some(key=>String(SAFETYPAY_DRAFT[key]||'').trim());
}
function hasCallDraft(){
  return CALL_DRAFT_DIRTY && ['clientDni','clientName'].some(key=>String(CALL_DRAFT[key]||'').trim());
}

function currentAutoRefreshMs(){
  const fastViews = new Set(['todos','mis-registros','alertas','safetypay','llamadas','calificaciones','referidos','tarjetas','penalidades']);
  const heavyViews = new Set(['sueldos','reportes','estadisticas','cierre']);
  if(state.view==='asistencia') return AUTO_REFRESH_TICK_MS;
  if(fastViews.has(state.view)) return AUTO_REFRESH_FAST_MS;
  if(heavyViews.has(state.view)) return AUTO_REFRESH_HEAVY_MS;
  return AUTO_REFRESH_DEFAULT_MS;
}

function activeAttendanceFilter(){
  const id=document.activeElement?.id || '';
  return state.view==='asistencia' && ['attendanceSearch','attendanceMonth','attendanceSede','attendanceDepartment','attendancePerson','attendanceDate'].includes(id) ? id : '';
}

async function autoRefreshTick(force=false){
    if(AUTO_REFRESH_RUNNING) return;
    if(document.visibilityState==='hidden') return;
    if(!state.currentUser || state.view==='login' || state.view==='force-password') return;
    const intervalMs = currentAutoRefreshMs();
    if(!force && Date.now() - AUTO_REFRESH_LAST_AT < intervalMs) return;
    if(Date.now()<FILTER_INTERACTION_UNTIL) return;
    if(state.modal!==null || state.newModal || state.attendanceEdit || (state.salaryDetailId && (state.view!=='sueldos' || state.fxSalaryFull)) || state.dashboardUserId || document.querySelector('.dialog-overlay,.modal-overlay')) return;
    if(isEditingForm() && !activeAttendanceFilter()) return;
    if(state.view==='referidos' && hasReferralDraft()) return;
    if(state.view==='safetypay' && hasSafetypayDraft()) return;
    if(state.view==='llamadas' && hasCallDraft()) return;
    if(hasPenaltyReportDraft()) return;
    if(state.view==='admin' && state.adminTab==='add') return;
    const refreshingView=state.view;
    AUTO_REFRESH_RUNNING=true;
    try{
      AUTO_REFRESH_LAST_AT = Date.now();
      if(state.view==='asistencia') { if(await loadAttendance(true,true)===false) return; }
      else if(['sueldos','reportes','mis-comisiones','cierre','estadisticas'].includes(state.view)){
        const [data,attendance]=await Promise.all([refreshState(true,[...new Set([...CORE_STATE_MODULES,...getViewStateModules()])]),loadAttendance(true,true)]);
        if(data?.unchanged && attendance===false) return;
      } else {
        const data=await refreshState(true, [...new Set([...CORE_STATE_MODULES, ...getViewStateModules()])]);
        if(data?.unchanged) return;
      }
      if(state.view!==refreshingView || state.attendanceEdit || state.modal!==null || state.newModal) return;
      const focusedFilter=activeAttendanceFilter();
      if(focusedFilter) renderPreservingField(focusedFilter);
      else preserveMainScroll(()=>render());
    }catch(error){
      // Ignore transient polling errors and keep the current screen stable.
    }finally{
      AUTO_REFRESH_RUNNING=false;
    }
}

function startAutoRefresh(){
  if(AUTO_REFRESH_TIMER || !state.currentUser) return;
  AUTO_REFRESH_LAST_AT = Date.now();
  AUTO_REFRESH_TIMER = setInterval(()=>autoRefreshTick(), AUTO_REFRESH_TICK_MS);
}

document.addEventListener('visibilitychange',()=>{ if(document.visibilityState==='visible') autoRefreshTick(true); });
window.addEventListener('focus',()=>autoRefreshTick(true));

function todayStr(){ return new Date().toISOString().split('T')[0]; }
function recordAge(r){ return daysSince(r.fecha); }
function operationDelay(r){
  if(!r.fechaOperacion) return null;
  return Math.floor((new Date(r.fechaOperacion)-new Date(r.fecha))/86400000);
}
function operatedWithinWindow(r){
  const d=operationDelay(r);
  return d!==null && d>=0 && d<=EXPIRE_DAY;
}
function isPendingApproval(r){
  return r.tipo==='operacion' && !!r.fechaOperacion && operatedWithinWindow(r) && !r.validatedAt && !r.rejectedAt;
}
function isApprovalLocked(r){
  return isPendingApproval(r) || !!r.validatedAt || !!r.rejectedAt;
}
function canEditRecordFields(r){
  if(!r) return false;
  if(!canEditMonth(recordAccountingMonthKey(r))) return false;
  const locked=isApprovalLocked(r);
  const canEdit=(isAdmin()||r.userId===state.currentUser.id) && !locked;
  const canEditMode=(isAdmin()||isManager()||r.userId===state.currentUser.id);
  return canEdit || (locked && canEditMode);
}
function canValidateRecord(r){
  if(!canEditMonth(recordAccountingMonthKey(r))) return false;
  return isPendingApproval(r);
}
function validationText(r){
  if(r.validatedAt) return { cls:'done', label:`Validado ${fmt(r.validatedAt)}` };
  if(r.rejectedAt) return { cls:'expired', label:'Rechazado' };
  if(r.tipo==='operacion' && !r.fechaOperacion) return { cls:'warn', label:'Falta fecha de operacion' };
  if(r.tipo==='operacion' && !operatedWithinWindow(r)) return { cls:'expired', label:'Opero fuera de plazo' };
  if(isPendingApproval(r)) return { cls:'danger', label:'Pendiente de aprobacion' };
  if(r.tipo==='registro' && recordAge(r)>EXPIRE_DAY) return { cls:'expired', label:'Sin operacion valida' };
  return { cls:'ok', label:'Aun sin validar' };
}
const RECORD_VALIDATIONS_IN_FLIGHT = new Set();
async function validateRecord(id){
  if(RECORD_VALIDATIONS_IN_FLIGHT.has(Number(id))) return false;
  const record=RECORDS.find(item=>Number(item.id)===Number(id));
  const peers=activeDuplicatePeers(record);
  if(record && peers.length){
    state.view='alertas';
    state.alertTab='dups';
    state.recordsMonth=recordAccountingMonthKey(record);
    render();
    await appAlert('Este DNI tiene duplicados activos. Primero resuelve cual registro se queda con la comision.', 'Duplicado pendiente');
    return false;
  }
  RECORD_VALIDATIONS_IN_FLIGHT.add(Number(id));
  try{
    await apiFetch(`/api/records/${id}/decision`, {
      method:'POST',
      body:JSON.stringify({ action:'validate' }),
      busyMessage:'Validando registro...'
    });
    await refreshState(false, [...new Set([...CORE_STATE_MODULES, 'records'])]);
    return true;
  }catch(error){
    await appAlert(error.message || 'No se pudo validar el registro.', 'Error de validacion');
    return false;
  }finally{
    hideBusy();
    RECORD_VALIDATIONS_IN_FLIGHT.delete(Number(id));
  }
}
async function rejectRecord(id, reason){
  await apiFetch(`/api/records/${id}/decision`, {
    method:'POST',
    body:JSON.stringify({ action:'reject', reason }),
    busyMessage:'Rechazando registro...'
  });
  await refreshState(false, [...new Set([...CORE_STATE_MODULES, 'records'])]);
}
async function keepDuplicateRecord(id){
  const keeper=RECORDS.find(item=>Number(item.id)===Number(id));
  if(!keeper) return;
  const peers=activeDuplicatePeers(keeper).filter(item=>canValidateOrReject(item));
  if(!peers.length){
    await appAlert('No hay otros duplicados pendientes que se puedan rechazar.', 'Duplicado');
    return;
  }
  const ok=await appConfirm(`Se mantendra el registro #${keeper.id} y se rechazara(n) ${peers.length} duplicado(s) pendiente(s) del DNI ${keeper.dni}.`, { title:'Resolver duplicado', confirmText:'Mantener este' });
  if(!ok) return;
  for(const peer of peers){
    await apiFetch(`/api/records/${peer.id}/decision`, {
      method:'POST',
      body:JSON.stringify({ action:'reject', reason:`Duplicado resuelto: se mantiene registro #${keeper.id}.` }),
      busyMessage:'Resolviendo duplicados...'
    });
  }
  await refreshState(false, [...new Set([...CORE_STATE_MODULES, 'records'])]);
  render();
}
async function rejectDuplicateRecord(id){
  const record=RECORDS.find(item=>Number(item.id)===Number(id));
  if(!record) return;
  const reason=await appPrompt('Motivo del rechazo:', { title:'Rechazar duplicado', defaultValue:'Duplicado: DNI ya registrado por otro colaborador.', confirmText:'Rechazar', danger:true });
  if(!reason || !reason.trim()) return;
  await rejectRecord(id, reason.trim());
  render();
}
async function validateReferral(id){
  await apiFetch(`/api/referrals/${id}/decision`, {
    method:'POST',
    body:JSON.stringify({ action:'validate' }),
    busyMessage:'Validando referido...'
  });
  await refreshState(false, [...new Set([...CORE_STATE_MODULES, 'referrals'])]);
}
async function rejectReferral(id, reason){
  await apiFetch(`/api/referrals/${id}/decision`, {
    method:'POST',
    body:JSON.stringify({ action:'reject', reason }),
    busyMessage:'Rechazando referido...'
  });
  await refreshState(false, [...new Set([...CORE_STATE_MODULES, 'referrals'])]);
}

function avatar(user, size=32, fs=12){
  return `<div class="user-avatar" style="width:${size}px;height:${size}px;background:${user.color};font-size:${fs}px">${initials(user.name)}</div>`;
}
function shortTime(value){
  return value ? String(value).slice(0,5) : '-';
}
function minutesLabel(value){
  if(!value) return '0 min';
  const hours=Math.floor(value/60);
  const minutes=value%60;
  return hours ? `${hours}h ${String(minutes).padStart(2,'0')}m` : `${minutes} min`;
}
function money(value){
  return `S/ ${Number(value || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
function esc(value){
  return String(value ?? '').replace(/[&<>"']/g, char=>({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[char]));
}
function ratingStarsHtml(value){
  const rating=Math.max(0, Math.min(5, Math.floor(Number(value) || 0)));
  return `${'&#9733;'.repeat(rating)}${'&#9734;'.repeat(5-rating)}`;
}
function monthWorkdays(year, monthIndex){
  let total=0;
  const day=new Date(year, monthIndex, 1);
  while(day.getMonth()===monthIndex){
    if(day.getDay()!==0) total += 1;
    day.setDate(day.getDate()+1);
  }
  return total;
}
function attendanceDayWorked(day){
  return !day.absence && !!(day.entryTime || day.exitTime);
}
function timeMinutesOrNull(value){
  if(!value) return null;
  const parts=String(value).split(':').map(Number);
  if(parts.length<2 || parts.some(Number.isNaN)) return null;
  return (parts[0]*60) + parts[1];
}
function timeFromMinutes(minutes){
  const value=Math.max(0, Math.min(23*60+59, Number(minutes || 0)));
  const hours=Math.floor(value/60);
  const mins=value%60;
  return `${String(hours).padStart(2,'0')}:${String(mins).padStart(2,'0')}`;
}
function isLauraJulyShiftException(person, date){
  const personId=String(person?.personId || '').trim();
  const personName=normalizePersonName(person?.personName || '');
  const day=String(date || '').slice(0,10);
  return (personId==='73774814' || personName.includes('laura')) && day>='2026-07-10' && day<='2026-07-31';
}
function isNicolleOctoberShiftException(person, date){
  const personId=String(person?.personId || '').trim();
  const personName=normalizePersonName(person?.personName || '');
  const isNicolle=personId==='60895202' || personName==='nicolle constancio manco' || personName==='nicole constancio manco';
  const day=String(date || '9999-12-31').slice(0,10);
  return isNicolle && day>='2026-10-05';
}
function isVanessaMorningShift(person){
  const personId=String(person?.personId || '').trim();
  const personName=normalizePersonName(person?.personName || '');
  return personId==='60975845' || personName.includes('vanessa fernandez');
}
function getAttendanceSchedule(person, date){
  const calendar=calendarForPerson(person,date);
  if(calendar?.kind==='SPECIAL_SHIFT'){
    const entryMinutes=timeMinutesOrNull(calendar.entry), exitMinutes=timeMinutesOrNull(calendar.exit);
    return {entryMinutes,exitMinutes,breakMinutes:calendar.breakMinutes,shiftHours:(exitMinutes-entryMinutes-calendar.breakMinutes)/60,label:`Jornada especial: ${calendar.entry} a ${calendar.exit}`};
  }
  const personId=String(person?.personId || '').trim();
  const personName=normalizePersonName(person?.personName || '');
  if(isNicolleOctoberShiftException(person, date)){
    return { entryMinutes:9*60+30, exitMinutes:18*60+30, shiftHours:8, breakMinutes:60, label:'Tiempo completo 9:30 a 6:30' };
  }
  if(isLauraJulyShiftException(person, date)){
    return { entryMinutes:10*60, exitMinutes:19*60, shiftHours:8, breakMinutes:60, label:'Tiempo completo 10:00 a 7:00' };
  }
  if(isVanessaMorningShift(person)){
    return { entryMinutes:8*60, exitMinutes:12*60, shiftHours:4, breakMinutes:0, label:'Part time 8:00 a 12:00' };
  }
  if(person?.employmentType==='PART_TIME'){
    if(person?.partTimeMode==='AFTERNOON'){
      return { entryMinutes:14*60, exitMinutes:18*60, shiftHours:4, breakMinutes:0, label:'Part time 2:00 a 6:00' };
    }
    return { entryMinutes:9*60, exitMinutes:13*60, shiftHours:4, breakMinutes:0, label:'Part time 9:00 a 1:00' };
  }
  return { entryMinutes:9*60, exitMinutes:18*60, shiftHours:8, breakMinutes:60, label:'Tiempo completo 9:00 a 6:00' };
}
function isLastCalendarDay(dateText){
  if(!dateText) return false;
  const date=new Date(`${dateText}T00:00:00`);
  if(Number.isNaN(date.getTime())) return false;
  return date.getDate()===new Date(date.getFullYear(), date.getMonth()+1, 0).getDate();
}
function shouldAutoCloseMonthEndExit(day){
  if(!day || (day.calendarException && day.calendarException.kind!=='SPECIAL_SHIFT') || !isLastCalendarDay(day.date)) return false;
  if(day.justifiedDay || day.exitTime || !day.entryTime) return false;
  return day.date>='2026-10-31' && day.date<=limaTodayKey();
}
function applyMonthEndAutoExit(day, person){
  if(!shouldAutoCloseMonthEndExit(day)) return day;
  const schedule=getAttendanceSchedule(person, day.date);
  return {
    ...day,
    exitTime:timeFromMinutes(schedule.exitMinutes),
    exitStatus:'Salida automatica fin de mes',
    autoMonthEndExit:true
  };
}
function recomputeDisplayedAttendanceDay(day, person){
  if(day.absence) return {...day,entryTime:null,exitTime:null,entryStatus:'Sin entrada',exitStatus:'Sin salida',status:'Sin marcaje',lateMinutes:0,earlyLeaveMinutes:0,overtimeMinutes:0,justifiedEntry:false,justifiedExit:false,justifiedDay:false,calendarException:null};
  const calendar=day.calendarException || calendarForPerson(person,day.date);
  if(calendar && calendar.kind!=='SPECIAL_SHIFT') return {...day,calendarException:calendar,entryStatus:calendar.reason,exitStatus:calendar.reason,status:calendar.kind==='PAID_REST'?'Descanso pagado':'Descanso sin pago',lateMinutes:0,lateLabel:'0 min',earlyLeaveMinutes:0,earlyLeaveLabel:'0 min',overtimeMinutes:0,overtimeLabel:'0 min'};
  const normalizedDay={...day,calendarException:calendar};
  const schedule=getAttendanceSchedule(person, normalizedDay.date);
  const entryMinutes=timeMinutesOrNull(normalizedDay.entryTime);
  const exitMinutes=timeMinutesOrNull(normalizedDay.exitTime);
  const tolerance=Number(ATTENDANCE?.schedule?.entryToleranceMinutes ?? 5);
  const justifiedDay=!!normalizedDay.justifiedDay;
  const justifiedEntry=justifiedDay ? false : !!normalizedDay.justifiedEntry;
  const justifiedExit=justifiedDay ? false : !!normalizedDay.justifiedExit;
  const lateMinutes=entryMinutes===null || justifiedEntry || justifiedDay
    ? 0
    : entryMinutes > schedule.entryMinutes + tolerance
      ? Math.max(0, entryMinutes - schedule.entryMinutes)
      : 0;
  const overtimeMinutes=exitMinutes===null || justifiedDay ? 0 : Math.max(0, exitMinutes - schedule.exitMinutes);
  const earlyLeaveMinutes=exitMinutes===null || justifiedExit || justifiedDay ? 0 : Math.max(0, schedule.exitMinutes - exitMinutes);
  const entryStatus=justifiedDay
    ? 'Justificado'
    : normalizedDay.entryTime
      ? justifiedEntry
        ? 'Ingreso justificado'
        : lateMinutes>0
          ? 'Tarde'
          : 'A tiempo'
      : justifiedEntry
        ? 'Falta justificada'
        : 'Sin entrada';
  let exitStatus=justifiedDay ? 'Justificado' : normalizedDay.exitTime ? 'A tiempo' : 'Sin salida';
  if(!justifiedDay && normalizedDay.exitTime){
    if(justifiedExit) exitStatus='Salida justificada';
    else if(overtimeMinutes>0) exitStatus='Salida extendida';
    else if(earlyLeaveMinutes>0) exitStatus='Salida anticipada';
  }
  const status=justifiedDay
    ? 'Justificado'
    : normalizedDay.entryTime && normalizedDay.exitTime
      ? 'Completo'
      : normalizedDay.entryTime
        ? 'Falta salida'
        : normalizedDay.exitTime
          ? 'Falta entrada'
          : 'Sin marcajes';
  return {
    ...normalizedDay,
    entryStatus,
    exitStatus,
    status,
    lateMinutes,
    lateLabel:minutesLabel(lateMinutes),
    earlyLeaveMinutes,
    earlyLeaveLabel:minutesLabel(earlyLeaveMinutes),
    overtimeMinutes,
    overtimeLabel:minutesLabel(overtimeMinutes)
  };
}
function salaryProfileForMonth(person,month){
  const live=(ATTENDANCE?.people||[]).find(item=>String(item.personId)===String(person.personId));
  if(person.closedSnapshot && live) person={...person,monthlySalary:live.monthlySalary,configuredSalary:live.configuredSalary,payrollRole:live.payrollRole,employmentType:live.employmentType,partTimeMode:live.partTimeMode};
  const byMonth=new Map();
  for(const entry of [...(person.extraBonuses?.__salaryHistory||[]),...(live?.extraBonuses?.__salaryHistory||[])]){
    if(/^\d{4}-(0[1-9]|1[0-2])$/.test(entry?.effectiveMonth) && Number.isFinite(entry.monthlySalary) && entry.monthlySalary>=0) byMonth.set(entry.effectiveMonth,entry);
  }
  const history=[...byMonth.values()].sort((a,b)=>a.effectiveMonth.localeCompare(b.effectiveMonth));
  const entry=history.filter(item=>item.effectiveMonth<=month).at(-1);
  return {...person,monthlySalary:Number(person.configuredSalary ?? person.monthlySalary ?? 0),...(entry||{}),salaryHistoryUnverified:!entry?month<limaTodayKey().slice(0,7):entry.source==='prior-value-undated'};
}
function getEffectiveMonthlySalary(person){
  const roleConfig=getPayrollRoleConfig(person.payrollRole || 'Sin definir');
  const configuredSalary=Number(person.monthlySalary ?? roleConfig.baseSalary ?? 0);
  if(person?.employmentType!=='PART_TIME') return configuredSalary;
  const halfRoleSalary=Number(roleConfig.baseSalary || 0) * 0.5;
  if(halfRoleSalary > 0 && configuredSalary <= halfRoleSalary + 0.01){
    return Number(configuredSalary.toFixed(2));
  }
  return Number((configuredSalary / 2).toFixed(2));
}
function getEmploymentFactor(person){
  return person?.employmentType==='PART_TIME' ? 0.5 : 1;
}
function getSuggestedMonthlySalary(payrollRole, employmentType='FULL_TIME'){
  const roleConfig=getPayrollRoleConfig(payrollRole || 'Sin definir');
  const baseSalary=Number(roleConfig.baseSalary || 0);
  return Number((employmentType==='PART_TIME' ? baseSalary * 0.5 : baseSalary).toFixed(2));
}
function getEditableMonthlySalary(person){
  return getEffectiveMonthlySalary({
    ...person,
    monthlySalary:Number(person?.configuredSalary ?? person?.monthlySalary ?? 0)
  });
}
function scaleEmploymentAmount(person, amount){
  const numeric=Number(amount || 0);
  return Number((numeric * getEmploymentFactor(person)).toFixed(2));
}
function getPenaltyPerMinute(person){
  const roleConfig=getPayrollRoleConfig(person.payrollRole || 'Sin definir');
  if(person && person.penaltyPerMinute !== undefined && person.penaltyPerMinute !== null && person.penaltyPerMinute !== ''){
    const customPenalty=Number(person.penaltyPerMinute);
    return Number.isFinite(customPenalty) && customPenalty > 0 ? customPenalty : scaleEmploymentAmount(person, Number(roleConfig.penaltyPerMinute || 0));
  }
  const customPenalty=Number(person.penaltyPerMinute);
  return Number.isFinite(customPenalty) && customPenalty > 0 ? customPenalty : scaleEmploymentAmount(person, Number(roleConfig.penaltyPerMinute || 0));
}
function getDefaultBonusAmount(person){
  const roleConfig=getPayrollRoleConfig(person?.payrollRole || 'Sin definir');
  return scaleEmploymentAmount(person, Number(roleConfig.bonus || 0));
}
function getBonusAmount(person){
  const customBonus=Number(person?.bonusAmount);
  return Number.isFinite(customBonus) && customBonus > 0 ? customBonus : getDefaultBonusAmount(person);
}
function getPartTimeBonusFactor(person){
  return getEmploymentFactor(person);
}
function scaleBonusForPerson(person, amount){
  return Number(Number(amount || 0).toFixed(2));
}
function scaleBonusBreakdownForPerson(person, breakdown){
  const factor=getPartTimeBonusFactor(person);
  if(factor===1) return breakdown;
  return (breakdown || []).map(item=>({
    ...item,
    amount:item.automatic ? Number((Number(item.amount || 0) * factor).toFixed(2)) : Number(Number(item.amount || 0).toFixed(2)),
    unitAmount:item.unitAmount === undefined
      ? item.unitAmount
      : item.automatic
        ? Number((Number(item.unitAmount || 0) * factor).toFixed(2))
        : Number(Number(item.unitAmount || 0).toFixed(2))
  }));
}
function normalizePersonName(value){
  return String(value||'').trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/\s+/g,' ');
}
function blocksVariablePay(person){
  const flags=person?.extraBonuses || {};
  if(Object.prototype.hasOwnProperty.call(flags,'__commissionsEnabled')) return flags.__commissionsEnabled===false;
  const name=normalizePersonName(person?.personName);
  return name.includes('nicols olenka');
}
function isInactiveCollaborator(person){
  return !!person?.extraBonuses?.__inactive;
}
function inactiveCollaboratorDate(person){
  return String(person?.extraBonuses?.__inactiveAt || '').slice(0,10);
}
function terminationDate(person){
  return String(person?.extraBonuses?.__terminationDate || '').slice(0,10);
}
function isBeforeOrOnTermination(person, value){
  const endDate=terminationDate(person);
  if(!endDate) return true;
  const itemDate=String(value || '').slice(0,10);
  if(!itemDate) return true;
  if(itemDate<=endDate) return true;
  const reactivatedAt=String(person?.extraBonuses?.__reactivatedAt || '').slice(0,10);
  return !!reactivatedAt && itemDate>=reactivatedAt;
}
function freezeAtTermination(person, rows, dateForRow){
  return (rows || []).filter(row=>isBeforeOrOnTermination(person, dateForRow(row)));
}
function isInactiveForSalaryMonth(person, salaryMonth){
  if(!isInactiveCollaborator(person)) return false;
  const termination=terminationDate(person);
  // A cese keeps its final month payable, but never appears in later months.
  if(termination) return termination < `${salaryMonth}-01`;
  const inactiveMonth=inactiveCollaboratorDate(person).slice(0,7);
  return !inactiveMonth || inactiveMonth<=salaryMonth;
}
function isSurSharedHalfSafetypayPerson(person){
  if(getPersonSede(person)!=='Sur') return false;
  const name=normalizePersonName(person?.personName);
  return name.includes('abigail') || name.includes('vanessa');
}
function looseIdentity(value){
  return normalizePersonName(value).replace(/(.)\1+/g,'$1');
}
function tokenDistance(a, b){
  const left=String(a||'');
  const right=String(b||'');
  if(left===right) return 0;
  const rows=left.length+1;
  const cols=right.length+1;
  const dp=Array.from({ length:rows }, (_, i)=>Array.from({ length:cols }, (_, j)=>i===0 ? j : j===0 ? i : 0));
  for(let i=1; i<rows; i+=1){
    for(let j=1; j<cols; j+=1){
      const cost=left[i-1]===right[j-1] ? 0 : 1;
      dp[i][j]=Math.min(dp[i-1][j]+1, dp[i][j-1]+1, dp[i-1][j-1]+cost);
    }
  }
  return dp[left.length][right.length];
}
function tokenSimilar(a, b){
  const left=String(a||'');
  const right=String(b||'');
  if(left.length<4 || right.length<4) return false;
  if(left===right) return true;
  const distance=tokenDistance(left, right);
  const limit=Math.max(left.length, right.length)>=7 ? 2 : 1;
  return distance<=limit;
}
function userForAttendancePerson(person){
  const hasManualLink=!!person?.extraBonuses && Object.prototype.hasOwnProperty.call(person.extraBonuses, '__linkedUserId');
  const linkedId=collaboratorLinkedUserId(person);
  if(hasManualLink){
    const linked=USERS.find(user=>Number(user.id)===Number(linkedId));
    return linked || null;
  }
  const target=normalizePersonName(person?.personName);
  if(!target) return null;
  const personId=normalizePersonName(person?.personId);
  const targetTokens=target.split(' ').filter(token=>token.length>=3);
  const exact=USERS.find(user=>normalizePersonName(user.name)===target);
  if(exact) return exact;
  const exactUserName=USERS.find(user=>{
    const username=normalizePersonName(user.username);
    return username && (username===target || username===personId);
  });
  if(exactUserName) return exactUserName;

  const scored=USERS.map(user=>{
    const name=normalizePersonName(user.name);
    const username=normalizePersonName(user.username);
    const nameTokens=name.split(' ').filter(token=>token.length>=3);
    const usernameTokens=username.split(' ').filter(token=>token.length>=4);
    const sharedNameTokens=nameTokens.filter(token=>targetTokens.includes(token));
    const sharedUsernameTokens=usernameTokens.filter(token=>targetTokens.includes(token));
    const similarNameTokens=nameTokens.filter(token=>!targetTokens.includes(token) && targetTokens.some(targetToken=>tokenSimilar(token, targetToken)));
    const similarUsernameTokens=usernameTokens.filter(token=>!targetTokens.includes(token) && targetTokens.some(targetToken=>tokenSimilar(token, targetToken)));
    let score=0;
    if(name && (name.includes(target) || target.includes(name))) score+=40;
    if(sharedNameTokens.length>=2) score+=60 + sharedNameTokens.length;
    else if(sharedNameTokens.length===1 && targetTokens.length===1) score+=8;
    else if(sharedNameTokens.length===1) score+=12;
    if(similarNameTokens.length>=2) score+=24 + similarNameTokens.length;
    else if(similarNameTokens.length===1) score+=14;
    if(sharedUsernameTokens.length) score+=12 + sharedUsernameTokens.length;
    if(similarUsernameTokens.length) score+=16 + similarUsernameTokens.length;
    if(username.length>=4 && target.includes(username)) score+=10;
    return {
      user,
      score,
      sharedNameTokens:sharedNameTokens.length,
      similarNameTokens:similarNameTokens.length,
      sharedUsernameTokens:sharedUsernameTokens.length,
      similarUsernameTokens:similarUsernameTokens.length
    };
  })
    .filter(item=>item.score>0 && (item.sharedNameTokens + item.similarNameTokens)>=2)
    .sort((a,b)=>b.score-a.score || b.sharedNameTokens-a.sharedNameTokens || b.similarNameTokens-a.similarNameTokens || b.sharedUsernameTokens-a.sharedUsernameTokens || b.similarUsernameTokens-a.similarUsernameTokens);

  return scored[0]?.user || null;
}
function sedeFromDepartment(department=''){
  const text=normalizePersonName(department);
  if(text.includes('sur')) return 'Sur';
  if(text.includes('norte')) return 'Norte';
  if(text.includes('miraflores') || text.includes('miraf')) return 'Miraflores';
  if(text.includes('centro') || text.includes('lince')) return 'Lince';
  return '';
}
function getPersonTransferHistory(person){
  const rows=Array.isArray(person?.extraBonuses?.__sedeTransfers) ? person.extraBonuses.__sedeTransfers : [];
  return rows
    .map(row=>({
      from:row?.from ? normalizeSede(row.from) : '',
      to:row?.to ? normalizeSede(row.to) : '',
      effectiveDate:String(row?.effectiveDate || '')
    }))
    .filter(row=>row.to && /^\d{4}-\d{2}-\d{2}$/.test(row.effectiveDate))
    .sort((a,b)=>a.effectiveDate.localeCompare(b.effectiveDate));
}
function getPersonStoredSede(person){
  const stored=person?.extraBonuses?.__currentSede ? normalizeSede(person.extraBonuses.__currentSede) : '';
  if(stored) return stored;
  const user=userForAttendancePerson(person);
  if(user) return userSede(user);
  return sedeFromDepartment(person?.department || '');
}
function getPersonSedeAt(person, dateValue=''){
  const date=String(dateValue || '').slice(0,10);
  if(!date) return getPersonStoredSede(person);
  const user=userForAttendancePerson(person);
  let sede=normalizeSede(person?.extraBonuses?.__baseSede || userSede(user) || sedeFromDepartment(person?.department || ''));
  getPersonTransferHistory(person).forEach(row=>{
    if(row.effectiveDate<=date) sede=row.to;
  });
  return sede || getPersonStoredSede(person);
}
function getPersonSede(person){
  return getPersonStoredSede(person);
}
function profileForAttendancePerson(person){
  const personId=String(person?.personId || '').trim();
  const name=normalizePersonName(person?.personName || '');
  const profiles=Array.isArray(ATTENDANCE?.profiles) ? ATTENDANCE.profiles : [];
  return profiles.find(profile=>String(profile?.personId || '').trim()===personId)
    || profiles.find(profile=>name && normalizePersonName(profile?.personName || '')===name)
    || null;
}
function collaboratorAreaForPerson(person){
  const profile=profileForAttendancePerson(person);
  const role=normalizePersonName(person?.payrollRole || profile?.payrollRole || '');
  const department=normalizePersonName(person?.department || profile?.department || '');
  const personId=String(person?.personId || '').trim();
  if(PAYMENTS_PERSON_IDS.has(personId) || role.includes('pagos') || department.includes('area pagos') || department.includes('jefe de pagos') || department.includes('encargado de pagos')) return 'Pagos';
  if(role.includes('jefe de sede')) return 'Jefes de sede';
  if(role.includes('facturacion') || department.includes('facturacion')) return 'Facturacion';
  if(role.includes('marketing') || department.includes('mkt') || department.includes('marketing')) return 'Marketing';
  if(role.includes('personal registro') || department.includes('atencion al cliente')) return 'Atencion al cliente';
  return person?.department ? String(person.department).trim() : 'Sin Area';
}
function matchesAttendanceDepartment(person, selectedDepartment){
  const selected=String(selectedDepartment || '').trim();
  if(!selected) return true;
  if(normalizePersonName(collaboratorAreaForPerson(person))===normalizePersonName(selected)) return true;
  const profile=profileForAttendancePerson(person);
  return normalizePersonName(person?.department || profile?.department || '')===normalizePersonName(selected);
}
function displayDepartmentForPerson(person){
  const area=collaboratorAreaForPerson(person);
  if(area && area!=='Sin Area') return area;
  const currentSede=getPersonSede(person);
  const linkedUser=userForAttendancePerson(person);
  if(linkedUser?.role==='manager') return 'Jefes de sede';
  if(linkedUser) return 'Atencion al cliente';
  return currentSede ? 'Atencion al cliente' : 'Sin Area';
}
function getBankAccounts(person){
  const raw=person?.extraBonuses?.__bankAccounts;
  return Array.isArray(raw) ? raw.filter(account=>account && (account.bank || account.type || account.number)) : [];
}
function getManagerPunctualStaffBonusRate(person){
  const raw=Number(person?.extraBonuses?.managerPunctualStaffAmount);
  return Number.isFinite(raw) && raw >= 0 ? raw : DEFAULT_MANAGER_PUNCTUAL_STAFF_BONUS;
}
function monthlyDaysForPerson(person, year, month){
  const monthKey=`${year}-${String(month+1).padStart(2,'0')}`;
  if(monthKey < GRATIFICATION_SYSTEM_ATTENDANCE_START_MONTH){
    return historicalWorkedDaysForPerson(person, year, month);
  }
  const rows=(person?.days || []).filter(day=>{
    const dt=new Date(`${day.date}T00:00:00`);
    return dt.getFullYear()===year && dt.getMonth()===month;
  });
  const byDate=new Map(rows.map(day=>[day.date, recomputeDisplayedAttendanceDay({ ...day, holiday:peruNationalHoliday(day.date) }, person)]));
  peruNationalHolidaysForYear(year)
    .filter(holiday=>{
      const dt=new Date(`${holiday.date}T00:00:00`);
      return dt.getMonth()===month && dt.getDay()!==0;
    })
    .forEach(holiday=>{
      const existing=byDate.get(holiday.date);
      if(existing){
        byDate.set(holiday.date, recomputeDisplayedAttendanceDay({ ...existing, holiday }, person));
      } else {
        byDate.set(holiday.date, {
          date:holiday.date,
          entryTime:null,
          exitTime:null,
          entryStatus:'Feriado nacional',
          exitStatus:'Feriado nacional',
          lateMinutes:0,
          earlyLeaveMinutes:0,
          justifiedDay:false,
          holiday,
          syntheticHoliday:true
        });
      }
    });
  (ATTENDANCE?.workCalendar || []).filter(rule=>rule.date.startsWith(monthKey) && rule.date<=limaTodayKey() && new Date(rule.date+'T12:00:00Z').getUTCDay()!==0).forEach(rule=>{
    if(!byDate.has(rule.date) && calendarForPerson(person,rule.date)) byDate.set(rule.date,recomputeDisplayedAttendanceDay({date:rule.date,punches:[],entryTime:null,exitTime:null},person));
  });
  return [...byDate.values()].sort((a,b)=>a.date.localeCompare(b.date));
}
function historicalWorkedDaysForPerson(person, year, month){
  const hireDate=hireDateForPerson(person);
  const firstDate=dateKey(year, month, 1);
  const lastDate=monthLastDateKey(`${year}-${String(month+1).padStart(2,'0')}`);
  if(hireDate && hireDate > lastDate) return [];
  const startDate=hireDate && hireDate > firstDate ? hireDate : firstDate;
  const day=new Date(`${startDate}T00:00:00`);
  const end=new Date(`${lastDate}T00:00:00`);
  const rows=[];
  while(day<=end){
    if(day.getDay()!==0){
      const current=dateKey(day.getFullYear(), day.getMonth(), day.getDate());
      const schedule=getAttendanceSchedule(person, current);
      rows.push({
        date:current,
        entryTime:timeFromMinutes(schedule.entryMinutes),
        exitTime:timeFromMinutes(schedule.exitMinutes),
        entryStatus:'Historico completo',
        exitStatus:'Historico completo',
        lateMinutes:0,
        earlyLeaveMinutes:0,
        overtimeMinutes:0,
        overtimeLabel:'',
        justifiedDay:false,
        syntheticHistorical:true,
        holiday:peruNationalHoliday(current)
      });
    }
    day.setDate(day.getDate()+1);
  }
  return rows;
}
function expectedWorkdaysForPersonInMonth(person, year, month, fallbackWorkdays=monthWorkdays(year, month)){
  const hireDate=hireDateForPerson(person);
  const firstDate=dateKey(year, month, 1);
  const lastDate=monthLastDateKey(`${year}-${String(month+1).padStart(2,'0')}`);
  if(!hireDate) return fallbackWorkdays;
  if(hireDate > lastDate) return 0;
  const startDate=hireDate > firstDate ? hireDate : firstDate;
  let total=0;
  const day=new Date(`${startDate}T00:00:00`);
  const end=new Date(`${lastDate}T00:00:00`);
  while(day<=end){
    if(day.getDay()!==0) total += 1;
    day.setDate(day.getDate()+1);
  }
  return total;
}
function managerSedeWorkdaysForPerson(person, year, month, sede){
  return monthlyDaysForPerson(person, year, month).filter(day=>{
    const dateObj=new Date(`${day.date}T00:00:00`);
    if(dateObj.getDay()===0) return false;
    return getPersonSedeAt(person, day.date)===sede;
  });
}
function punctualStaffForManager(managerPerson, allPeople, year, month){
  const managerUser=userForAttendancePerson(managerPerson);
  if((managerPerson?.payrollRole || '')!=='Jefe de Sede' && managerUser?.role!=='manager') return [];
  const managerSede=getPersonSede(managerPerson);
  if(!managerSede) return [];
  return (allPeople || []).map(person=>{
    if(person.personId===managerPerson.personId) return false;
    if((person.payrollRole || '')==='Jefe de Sede') return false;
    if(collaboratorAreaForPerson(person)==='Pagos') return false;
    if(!isAttentionCustomerPayroll(person)) return false;
    const personUser=userForAttendancePerson(person);
    if(personUser?.role==='manager' || personUser?.role==='admin') return false;
    const sedeDays=managerSedeWorkdaysForPerson(person, year, month, managerSede);
    if(!sedeDays.length) return null;
    const monthDays=monthlyDaysForPerson(person, year, month);
    const workedMonthDays=monthDays.filter(attendanceDayWorked);
    const workedSedeDays=sedeDays.filter(attendanceDayWorked);
    const lateCount=sedeDays.filter(day=>day.entryStatus==='Tarde' || Number(day.lateMinutes || 0)>0).length;
    const expectedWorkdays=sedeDays.filter(day=>!isPaidNationalHoliday(day) && !isCalendarRest(day)).length;
    const requiredDays=Math.min(MIN_MANAGER_PUNCTUAL_STAFF_DAYS, Math.max(1, expectedWorkdays));
    if(workedSedeDays.length < requiredDays || lateCount > 0) return null;
    const weight=workedMonthDays.length ? Math.min(1, workedSedeDays.length / workedMonthDays.length) : 1;
    return {
      ...person,
      punctualWeight:Number(weight.toFixed(4)),
      punctualWorkedDays:workedSedeDays.length,
      punctualExpectedDays:expectedWorkdays
    };
  }).filter(Boolean);
}
function approvedPenaltyReportsForPerson(person, month=salaryMonthKey()){
  return approvedPenaltyReportsForPersonFromRows(person, PENALTY_REPORTS, month);
}
function approvedPenaltyReportsForPersonFromRows(person, rows, month=salaryMonthKey()){
  const user=userForAttendancePerson(person);
  const target=normalizePersonName(person?.personName);
  return (rows || []).filter(report=>{
    if(report.status!=='APPROVED') return false;
    if(monthKeyFromDate(report.decidedAt || report.createdAt)!==month) return false;
    if(user && report.workerUserId===user.id) return true;
    return normalizePersonName(report.workerName)===target;
  });
}
function approvedPenaltyReportsSentByUser(user, month=salaryMonthKey()){
  return approvedPenaltyReportsSentByUserFromRows(user, PENALTY_REPORTS, month);
}
function approvedPenaltyReportsSentByUserFromRows(user, rows, month=salaryMonthKey()){
  if(!user) return [];
  return (rows || []).filter(report=>
    report.status==='APPROVED' &&
    !isPaymentAuditReport(report) &&
    report.sentById===user.id &&
    monthKeyFromDate(report.decidedAt || report.createdAt)===month
  );
}
function approvedPaymentAuditReportsForManagerFromRows(person, rows, month=salaryMonthKey()){
  const user=userForAttendancePerson(person);
  if(!user || user.role!=='manager') return [];
  const sede=normalizeSede(getPersonSede(person) || user.sede);
  return (rows||[]).filter(report=>
    isPaymentAuditReport(report) && report.status==='APPROVED' &&
    normalizeSede(report.targetSede)===sede && Number(report.decidedById)===Number(user.id) &&
    monthKeyFromDate(report.decidedAt || report.createdAt)===month
  );
}
function approvedPaymentAuditReportsSentByUserFromRows(user, rows, month=salaryMonthKey()){
  if(!user) return [];
  return (rows||[]).filter(report=>
    isPaymentAuditReport(report) && report.status==='APPROVED' && report.sentById===user.id &&
    monthKeyFromDate(report.decidedAt || report.createdAt)===month
  );
}
function approvedWrongCardsForPerson(person, month=salaryMonthKey()){
  return approvedWrongCardsForPersonFromRows(person, WRONG_CARDS, month);
}
function approvedWrongCardsForPersonFromRows(person, rows, month=salaryMonthKey()){
  const user=userForAttendancePerson(person);
  if(!user) return [];
  return (rows || []).filter(report=>
    report.userId===user.id &&
    (report.status==='APPROVED' || report.validatedAt) &&
    monthKeyFromDate(report.detectedDate || report.validatedAt || report.createdAt)===month
  );
}
function approvedReferralsForPerson(person, month=salaryMonthKey()){
  return approvedReferralsForPersonFromRows(person, REFERRALS, month);
}
function approvedReferralsForPersonFromRows(person, rows, month=salaryMonthKey()){
  const user=userForAttendancePerson(person);
  if(!user) return [];
  return (rows || []).filter(referral=>
    referral.userId===user.id &&
    !!referral.validatedAt &&
    monthKeyFromDate(referral.validatedAt || referral.createdAt)===month
  );
}
function isAttentionCustomerPayroll(person){
  const role=person?.payrollRole || '';
  const department=normalizePersonName(person?.department || '').toUpperCase();
  return role==='Personal Registro' && department.includes('ATENCION AL CLIENTE');
}
function extraBonusAppliesToPerson(config, person, role=person?.payrollRole || 'Sin definir'){
  if(config.area && normalizePersonName(collaboratorAreaForPerson(person))===normalizePersonName(config.area)) return true;
  return Array.isArray(config.roles) && config.roles.includes(role);
}
function extraBonusUnitAmount(config, role){
  return config.roleAmountField ? Number(getPayrollRoleConfig(role)[config.roleAmountField] || 0) : Number(config.amount || 0);
}
function getExtraBonusBreakdown(person, penaltyCount){
  const role=person?.payrollRole || 'Sin definir';
  const flags=person?.extraBonuses || {};
  const breakdown=[];
  Object.entries(EXTRA_BONUS_CONFIG).forEach(([key, config])=>{
    if(!extraBonusAppliesToPerson(config, person, role)) return;
    if(config.automatic) return;
    const rawQty=Object.prototype.hasOwnProperty.call(flags, key)
      ? (flags[key]===true ? 1 : Number(flags[key] || 0))
      : Number(config.defaultQuantity || 0);
    const quantity=Number.isFinite(rawQty) ? Math.max(0, Math.min(Number(config.max || 99), rawQty)) : 0;
    if(quantity>0){
      const configuredUnitAmount=extraBonusUnitAmount(config, role);
      breakdown.push({ key, label:config.label, amount:configuredUnitAmount * quantity, unitAmount:configuredUnitAmount, quantity, automatic:false, applies:true });
    }
  });
  return breakdown;
}
function salaryMonthKey(date=new Date()){
  return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}`;
}
function defaultReportMonthDate(){
  const date=new Date();
  date.setDate(1);
  if(isManager() && !isAdmin()) date.setMonth(date.getMonth()-1);
  return date;
}
function reportMonthKey(){
  return state.reportMonth || salaryMonthKey(defaultReportMonthDate());
}
function reportMonthDate(){
  return monthDateFromKey(reportMonthKey());
}
function salaryViewMonthKey(){
  return state.salaryMonth || salaryMonthKey();
}
function salaryViewMonthDate(){
  return monthDateFromKey(salaryViewMonthKey());
}
function monthDateFromKey(month){
  const [year, monthNum]=String(month || salaryMonthKey()).split('-').map(Number);
  return new Date(year || new Date().getFullYear(), (monthNum || 1)-1, 1);
}
function monthKeyFromDate(value){
  if(!value) return '';
  const text=String(value);
  if(/^\d{4}-\d{2}/.test(text)) return text.slice(0,7);
  const date=new Date(text);
  return Number.isNaN(date.getTime()) ? '' : salaryMonthKey(date);
}
function recordAccountingMonthKey(record){
  if(record?.fechaOperacion) return monthKeyFromDate(record.fechaOperacion);
  const registrationDate=record?.fecha || record?.createdAt;
  // Late approval never moves a record's commission into the approval month.
  // Use the operation date when present; otherwise keep the registration month.
  if(registrationDate) return monthKeyFromDate(registrationDate);
  return monthKeyFromDate(record?.rejectedAt || record?.validatedAt);
}
function appliesEarlyLeavePenalty(date){
  return EARLY_LEAVE_PENALTY_PER_MINUTE > 0 && monthKeyFromDate(date) <= EARLY_LEAVE_PENALTY_LAST_MONTH;
}
function earlyLeavePolicyLabel(month=salaryViewMonthKey()){
  return 'Salida anticipada sin penalidad';
}
function gratificationContext(month=salaryViewMonthKey()){
  const [year, monthNum]=String(month || salaryMonthKey()).split('-').map(Number);
  const firstHalf=Number(monthNum || 1) <= 7;
  const startMonth=firstHalf ? 1 : 7;
  const paymentMonth=firstHalf ? 7 : 12;
  const periodMonths=Array.from({ length:6 }, (_, index)=>`${year}-${String(startMonth + index).padStart(2,'0')}`);
  return {
    year,
    paymentMonth,
    baseSalaryMonth:`${year}-${firstHalf?'06':'11'}`,
    periodMonths,
    label:firstHalf ? `Julio ${year}` : `Diciembre ${year}`,
    periodLabel:firstHalf ? `Enero - Junio ${year}` : `Julio - Diciembre ${year}`
  };
}
function hireDateForPerson(person){
  const stored=String(person?.extraBonuses?.__hireDate || '').slice(0,10);
  if(/^\d{4}-\d{2}-\d{2}$/.test(stored)) return stored;
  const direct=HIRE_DATE_BY_PERSON_ID[String(person?.personId || '').trim()];
  if(direct) return direct;
  const linkedUser=userForAttendancePerson(person);
  const byUsername=HIRE_DATE_BY_USERNAME[normalizePersonName(linkedUser?.username || '')];
  if(byUsername) return byUsername;
  const byUserName=HIRE_DATE_BY_NAME[normalizePersonName(linkedUser?.name || '')];
  if(byUserName) return byUserName;
  return HIRE_DATE_BY_NAME[normalizePersonName(person?.personName || '')] || '';
}
function dateIsOnOrBefore(date, compareDate){
  if(!date || !compareDate) return false;
  return String(date).slice(0,10) <= String(compareDate).slice(0,10);
}
function monthLastDateKey(month){
  const [year, monthNum]=String(month || salaryMonthKey()).split('-').map(Number);
  const last=new Date(year || new Date().getFullYear(), monthNum || 1, 0);
  return salaryMonthKey(last) + '-' + String(last.getDate()).padStart(2,'0');
}
function personActiveInMonth(person, month=salaryMonthKey()){
  const hireDate=hireDateForPerson(person);
  return !hireDate || dateIsOnOrBefore(hireDate, monthLastDateKey(month));
}
function userActiveInMonth(user, month=salaryMonthKey()){
  if(!user) return true;
  const byUsername=HIRE_DATE_BY_USERNAME[normalizePersonName(user.username || '')];
  const byName=HIRE_DATE_BY_NAME[normalizePersonName(user.name || '')];
  const hireDate=byUsername || byName || '';
  return !hireDate || dateIsOnOrBefore(hireDate, monthLastDateKey(month));
}
function actualWorkedHoursForGratification(day, person){
  const schedule=getAttendanceSchedule(person, day?.date);
  const holiday=day?.holiday || peruNationalHoliday(day?.date);
  if(day?.calendarException?.kind==='PAID_REST') return schedule.shiftHours;
  if(holiday && !attendanceDayWorked(day)) return schedule.shiftHours;
  const entry=timeMinutesOrNull(day?.entryTime);
  const exit=timeMinutesOrNull(day?.exitTime);
  if(entry===null || exit===null || exit<=entry) return 0;
  const rawHours=(exit-entry)/60;
  const breakHours=schedule.breakMinutes && rawHours>schedule.shiftHours ? schedule.breakMinutes/60 : 0;
  return Math.max(0, rawHours - breakHours);
}
function expectedMonthHoursForPerson(person, month){
  const [year, monthNum]=String(month).split('-').map(Number);
  const monthIndex=(monthNum || 1)-1;
  let hours=0;
  const day=new Date(year, monthIndex, 1);
  while(day.getMonth()===monthIndex){
    if(day.getDay()!==0){
      const current=dateKey(day.getFullYear(), day.getMonth(), day.getDate());
      hours += getAttendanceSchedule(person, current).shiftHours;
    }
    day.setDate(day.getDate()+1);
  }
  return hours;
}
function gratificationMonthCredit(person, month, monthPerson){
  const today=limaTodayKey(),firstDate=month+'-01',lastDate=monthLastDateKey(month);
  const hireDate=hireDateForPerson(person),endDate=terminationDate(person);
  const monthlyPerson=monthPerson || person;
  const days=(monthPerson?.dayPayments || []).filter(day=>day.date?.startsWith(month) && day.date<=today);
  const workedHours=days.reduce((sum,day)=>sum+actualWorkedHoursForGratification(day,monthlyPerson),0);
  const expectedHours=expectedMonthHoursForPerson(monthlyPerson,month);
  const result={credit:0,workedHours,expectedHours,nonComputableDays:0,unverifiedDays:0,source:'Mes calendario completo'};
  if(!hireDate) return {...result,source:'Sin fecha de ingreso'};
  if(hireDate>firstDate || (endDate && endDate<lastDate)) return {...result,source:'Vinculo no cubre el mes completo'};
  if(lastDate>today) return {...result,source:'Mes pendiente de completar'};
  if(month<GRATIFICATION_SYSTEM_ATTENDANCE_START_MONTH) return {...result,credit:1,source:'Historico por fecha de ingreso; sin marcajes'};
  const byDate=new Map(days.map(day=>[day.date,day]));
  let nonComputableDays=0,unverifiedDays=0;
  for(let date=new Date(firstDate+'T12:00:00Z');date.toISOString().slice(0,10)<=lastDate;date.setUTCDate(date.getUTCDate()+1)){
    if(date.getUTCDay()===0) continue;
    const key=date.toISOString().slice(0,10),day=byDate.get(key);
    if(day?.absence){nonComputableDays++;continue;}
    const calendar=day?.calendarException || calendarForPerson(monthlyPerson,key);
    if(calendar?.kind==='UNPAID_REST'){nonComputableDays++;continue;}
    if(calendar?.kind==='PAID_REST' || day?.holiday || peruNationalHoliday(key)) continue;
    if(!day || day.syntheticHoliday || day.justifiedDay || key>=today){
      if(!day?.entryTime && !day?.exitTime) unverifiedDays++;
      continue;
    }
    if(!day.entryTime && !day.exitTime) nonComputableDays++;
  }
  return {...result,credit:Math.max(0,1-nonComputableDays/30),nonComputableDays,unverifiedDays};
}
function buildGratificationRows(visiblePeople, referenceMonth=salaryViewMonthKey()){
  const context=gratificationContext(referenceMonth);
  const monthlyMaps=context.periodMonths.map(month=>{
    const data=getSalaryPeople({ ignoreFilters:true, date:monthDateFromKey(month) });
    return new Map((data.people || []).map(person=>[String(person.personId), person]));
  });
  return (visiblePeople || []).map(person=>{
    const monthPeople=context.periodMonths.map((month, index)=>monthlyMaps[index].get(String(person.personId)) || null);
    const credits=context.periodMonths.map((month, index)=>gratificationMonthCredit(person, month, monthPeople[index]));
    const monthsWorked=credits.reduce((sum,item)=>sum + Number(item.credit || 0),0);
    const months=monthPeople.filter(Boolean);
    const variableValues=monthPeople.map((item,index)=>{
      if(!item || context.periodMonths[index]>limaTodayKey().slice(0,7)) return {commissions:0,overtime:0};
      return {commissions:Number(item.commissionsPay||0),overtime:(item.dayPayments||[]).reduce((sum,day)=>sum+Number(day.overtimePay||0),0)+Number(item.previousMonthExtraPay||0)};
    });
    const commissionMonths=variableValues.filter(item=>item.commissions>0).length;
    const overtimeMonths=variableValues.filter(item=>item.overtime>0).length;
    const commissionAverage=commissionMonths>=3?variableValues.reduce((sum,item)=>sum+item.commissions,0)/6:0;
    const overtimeAverage=overtimeMonths>=3?variableValues.reduce((sum,item)=>sum+item.overtime,0)/6:0;
    const variableMonths=variableValues.filter(item=>item.commissions>0 || item.overtime>0).length;
    const variableAverage=commissionAverage+overtimeAverage;
    const basePerson=salaryProfileForMonth(person,context.baseSalaryMonth);
    const baseSalary=getEffectiveMonthlySalary(basePerson);
    const computableBase=baseSalary + variableAverage;
    const fullRegimeGratification=computableBase * (monthsWorked / 6);
    const mypeGratification=fullRegimeGratification * MYPE_GRATIFICATION_FACTOR;
    return {
      person,
      baseSalary,
      salaryHistoryUnverified:basePerson.salaryHistoryUnverified || monthPeople.some(item=>item?.salaryHistoryUnverified),
      variableAverage,
      variableMonths,
      commissionMonths,
      overtimeMonths,
      commissionAverage,
      overtimeAverage,
      nonComputableDays:credits.reduce((sum,item)=>sum+item.nonComputableDays,0),
      unverifiedDays:credits.reduce((sum,item)=>sum+item.unverifiedDays,0),
      monthsWorked,
      fullRegimeGratification,
      gratification:mypeGratification,
      total:mypeGratification,
      hireDate:hireDateForPerson(person),
      credits,
      context
    };
  });
}
function dateMatchesQuickPeriod(value, scope=state.periodScope){
  if(!scope) return true;
  const date=new Date(value);
  if(Number.isNaN(date.getTime())) return false;
  const today=new Date();
  const dayStart=new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const targetStart=new Date(date.getFullYear(), date.getMonth(), date.getDate());
  if(scope==='day') return targetStart.getTime()===dayStart.getTime();
  if(scope==='month') return date.getFullYear()===today.getFullYear() && date.getMonth()===today.getMonth();
  if(scope==='week'){
    const monday=new Date(dayStart);
    const day=monday.getDay() || 7;
    monday.setDate(monday.getDate()-day+1);
    const nextMonday=new Date(monday);
    nextMonday.setDate(nextMonday.getDate()+7);
    return targetStart>=monday && targetStart<nextMonday;
  }
  return true;
}
function periodFilterHtml(){
  return `<select class="filter-select" id="periodScope"><option value=""${!state.periodScope?' selected':''}>Todo tiempo</option><option value="day"${state.periodScope==='day'?' selected':''}>Hoy</option><option value="week"${state.periodScope==='week'?' selected':''}>Esta semana</option><option value="month"${state.periodScope==='month'?' selected':''}>Este mes</option></select>`;
}
function activeMonthKey(value){
  return value || salaryMonthKey();
}
function monthLabelFromKey(month){
  if(!month) return '-';
  const [year, monthNum]=month.split('-').map(Number);
  return new Intl.DateTimeFormat('es-PE', { month:'long', year:'numeric' }).format(new Date(year, monthNum-1, 1));
}
function getRecentMonthKeys(count=18, extraValues=[]){
  const keys=new Set();
  const cursor=new Date();
  cursor.setDate(1);
  for(let index=0; index<count; index+=1){
    keys.add(`${cursor.getFullYear()}-${String(cursor.getMonth()+1).padStart(2,'0')}`);
    cursor.setMonth(cursor.getMonth()-1);
  }
  extraValues.forEach(value=>{
    const key=monthKeyFromDate(value);
    if(/^\d{4}-\d{2}$/.test(key)) keys.add(key);
  });
  return [...keys].sort((a,b)=>b.localeCompare(a));
}
function addMonthOptionKey(keys, value){
  if(!value) return;
  const raw=String(value || '').trim();
  const key=/^\d{4}-\d{2}$/.test(raw) ? raw : monthKeyFromDate(raw);
  if(/^\d{4}-\d{2}$/.test(key)) keys.add(key);
}
function getDataMonthKeys(extraValues=[]){
  const keys=new Set();
  extraValues.forEach(value=>addMonthOptionKey(keys, value));
  (MONTHLY_CLOSURES||[]).forEach(item=>addMonthOptionKey(keys, item.month));
  (ATTENDANCE?.availableDates||[]).forEach(date=>addMonthOptionKey(keys, date));
  (RECORDS||[]).forEach(record=>addMonthOptionKey(keys, recordAccountingMonthKey(record)));
  (REFERRALS||[]).forEach(row=>addMonthOptionKey(keys, row.validatedAt || row.createdAt));
  (WRONG_CARDS||[]).forEach(row=>addMonthOptionKey(keys, row.detectedDate || row.validatedAt || row.createdAt));
  (CALL_REPORTS||[]).forEach(row=>addMonthOptionKey(keys, row.validatedAt || row.createdAt));
  (PENALTY_REPORTS||[]).forEach(row=>addMonthOptionKey(keys, row.decidedAt || row.createdAt));
  (RATINGS||[]).forEach(row=>addMonthOptionKey(keys, row.approvedAt || row.date || row.rawDate));
  (SAFETYPAY_CODES||[]).forEach(row=>addMonthOptionKey(keys, row.createdAt));
  return [...keys].sort((a,b)=>b.localeCompare(a));
}
function monthKeysFromRange(startMonth, endMonth=salaryMonthKey()){
  if(!/^\d{4}-\d{2}$/.test(startMonth || '') || !/^\d{4}-\d{2}$/.test(endMonth || '')) return [];
  const [startYear, startMonthNum]=startMonth.split('-').map(Number);
  const [endYear, endMonthNum]=endMonth.split('-').map(Number);
  const cursor=new Date(endYear, endMonthNum-1, 1);
  const start=new Date(startYear, startMonthNum-1, 1);
  const keys=[];
  while(cursor>=start){
    keys.push(`${cursor.getFullYear()}-${String(cursor.getMonth()+1).padStart(2,'0')}`);
    cursor.setMonth(cursor.getMonth()-1);
  }
  return keys;
}
function monthFilterSelectHtml(id, value, { placeholder='Todos los meses', includeEmpty=true, count=24, extraValues=[], showRecent=true }={}){
  let months=showRecent ? getRecentMonthKeys(count, [value, ...extraValues]) : getDataMonthKeys([value, ...extraValues]);
  if(!months.length) months=getRecentMonthKeys(1, [value]);
  return `<select class="filter-select" id="${id}" style="width:170px">${includeEmpty?`<option value="">${placeholder}</option>`:''}${months.map(month=>`<option value="${month}"${value===month?' selected':''}>${monthLabelFromKey(month)}</option>`).join('')}</select>`;
}
function getSelectedClosureMonth(){
  return state.closureMonth || salaryMonthKey();
}
function getClosure(month){
  return MONTHLY_CLOSURES.find(item=>item.month===month);
}
function isClosedMonth(month){
  return getClosure(month)?.status==='CLOSED';
}
function canEditMonth(month){
  return !isClosedMonth(month) || isAdmin();
}
function closureArchiveForMonth(month){
  const closure=getClosure(month);
  const embedded=closure?.pending?.archivedData;
  if(embedded?.month===month && embedded?.modules) return embedded;
  if(state.archiveViewer?.month===month && state.archiveViewer?.modules) return state.archiveViewer;
  return null;
}
function mapArchivedRating(row){
  const approvalStatus=row.status || row.approvalStatus || 'PENDING';
  const matchedUser=row.matchedUserId ? getUserById(Number(row.matchedUserId)) : null;
  const rating=Number(row.rating || 0);
  const valid=!!row.dni && rating>=4 && !!(row.matchedUserId || row.matchedUserName || row.advisor);
  return {
    rowKey:row.rowKey || `archive-rating-${row.id || row.rowNumber || row.createdAt}`,
    rowNumber:row.rowNumber || 0,
    rawDate:row.createdAt || row.decidedAt || '',
    date:row.createdAt || row.decidedAt || '',
    advisor:row.advisor || row.matchedUserName || '',
    matchedUserId:row.matchedUserId || null,
    matchedUserName:row.matchedUserName || matchedUser?.name || row.advisor || '',
    matchedUserColor:matchedUser?.color || '#4f8ef7',
    sede:normalizeSede(row.sede || matchedUser?.sede),
    rating,
    dni:row.dni || '',
    comment:row.comment || '',
    approvalStatus,
    approvedAt:row.decidedAt || row.updatedAt || row.createdAt || '',
    decidedBy:row.decidedBy ? mapUser(row.decidedBy) : null,
    decisionReason:row.decisionReason || '',
    valid,
    payable:approvalStatus==='APPROVED',
    amount:approvalStatus==='APPROVED' ? 1 : 0,
    missingFields:row.dni ? [] : ['dni'],
    archived:true
  };
}
function archivedRecordsForMonth(month){
  const archive=closureArchiveForMonth(month);
  const records=Array.isArray(archive?.modules?.records) ? archive.modules.records : [];
  return records.map(mapRecord);
}
function visibleArchivedRecordsForMonth(month){
  const records=archivedRecordsForMonth(month);
  if(!records.length) return [];
  const visibleUserIds=new Set(getVisibleUsers().map(user=>Number(user.id)));
  return records.filter(record=>visibleUserIds.has(Number(record.userId)) || canViewRecord(record));
}
function archivedRatingsForMonth(month){
  const archive=closureArchiveForMonth(month);
  const rows=Array.isArray(archive?.modules?.ratingApprovals) ? archive.modules.ratingApprovals : [];
  return rows.map(mapArchivedRating);
}
function visibleArchivedRatingsForMonth(month){
  const rows=archivedRatingsForMonth(month);
  if(!rows.length) return [];
  const visibleUserIds=new Set(getVisibleUsers().map(user=>Number(user.id)));
  if(isAdmin()) return rows;
  if(isManager()) return rows.filter(row=>matchesManagerPreviewSede(row.sede) || visibleUserIds.has(Number(row.matchedUserId || 0)));
  return rows.filter(row=>Number(row.matchedUserId || 0)===Number(state.currentUser.id));
}
function mergeArchivedRatingRows(archivedRows, liveRows){
  if(!archivedRows.length) return [...liveRows];
  const archivedByKey=new Map(archivedRows
    .filter(row=>row.rowKey && !String(row.rowKey).startsWith('archive-rating-'))
    .map(row=>[row.rowKey,row]));
  const liveKeys=new Set(liveRows.map(row=>row.rowKey));
  const liveRowNumbers=new Set(liveRows.map(row=>Number(row.rowNumber)).filter(Boolean));
  const mergedLive=liveRows.map(row=>{
    const archived=archivedByKey.get(row.rowKey) || archivedRows.find(item=>Number(item.rowNumber)===Number(row.rowNumber));
    if(!archived || !row.valid || row.approvalStatus!=='PENDING' || !['APPROVED','REJECTED'].includes(archived.approvalStatus)) return row;
    const payable=archived.approvalStatus==='APPROVED';
    return {
      ...row,
      approvalStatus:archived.approvalStatus,
      approvedAt:payable ? archived.approvedAt : '',
      rejectedAt:payable ? '' : archived.approvedAt,
      decidedBy:archived.decidedBy,
      decisionReason:archived.decisionReason,
      payable,
      amount:payable ? getRatingCommission() : 0
    };
  });
  const seenArchivedRows=new Set();
  const archivedOnly=archivedRows.filter(row=>{
    const rowNumber=Number(row.rowNumber || 0);
    const identity=rowNumber ? `row:${rowNumber}` : `key:${row.rowKey}`;
    if(liveKeys.has(row.rowKey) || (rowNumber && liveRowNumbers.has(rowNumber)) || seenArchivedRows.has(identity)) return false;
    seenArchivedRows.add(identity);
    return true;
  });
  return [...mergedLive,...archivedOnly];
}
function archivedAttendanceForMonth(month){
  const archive=closureArchiveForMonth(month);
  return archive?.modules?.attendance || null;
}
function archivedModuleRowsForMonth(month, moduleName, mapper){
  const archive=closureArchiveForMonth(month);
  const rows=Array.isArray(archive?.modules?.[moduleName]) ? archive.modules[moduleName] : [];
  return rows.map(mapper);
}
function archivedWrongCardsForMonth(month){
  return archivedModuleRowsForMonth(month, 'wrongCards', mapWrongCard);
}
function archivedCallsForMonth(month){
  return archivedModuleRowsForMonth(month, 'callReports', mapCallReport);
}
function archivedReferralsForMonth(month){
  const archive=closureArchiveForMonth(month);
  const rows=Array.isArray(archive?.modules?.referrals) ? archive.modules.referrals : [];
  return rows.map(mapReferral);
}
function archivedPenaltiesForMonth(month){
  const archive=closureArchiveForMonth(month);
  const rows=Array.isArray(archive?.modules?.penaltyReports) ? archive.modules.penaltyReports : [];
  return rows.map(mapPenaltyReport);
}
function closedSalaryDataFromClosure(month, options={}){
  const closure=getClosure(month);
  const details=Array.isArray(closure?.details) ? closure.details : [];
  if(closure?.status!=='CLOSED' || !details.length) return null;
  const ignoreFilters=!!options.ignoreFilters;
  const monthDate=monthDateFromKey(month);
  let people=details.map(row=>{
    const linkedUser=USERS.find(user=>
      normalizePersonName(user.name || user.username || '')===normalizePersonName(row.personName || '') ||
      normalizePersonName(user.username || '')===normalizePersonName(row.personName || '')
    ) || null;
    const total=Number(row.salary || 0);
    const commissionsPay=Number(row.bonus || 0);
    const salaryPay=Math.max(0, total - commissionsPay);
    const profile=salaryProfileForMonth({personId:String(row.personId),closedSnapshot:true},month);
    const historicalBase=getEffectiveMonthlySalary(profile);
    return {
      personId:String(row.personId || row.id || row.personName || ''),
      personName:row.personName || 'Sin nombre',
      department:row.department || '',
      payrollRole:row.payrollRole || 'Sin definir',
      linkedUserId:linkedUser?.id || null,
      sede:row.sede || userSede(linkedUser) || '',
      monthDays:[],
      dayPayments:[],
      workedDays:0,
      missingDays:0,
      configuredSalary:profile.monthlySalary,
      monthlySalary:historicalBase,
      salaryHistoryUnverified:profile.salaryHistoryUnverified,
      dailyRate:0,
      hourlyRate:0,
      salaryPay,
      commissionsPay,
      estimatedSalary:total,
      totalDailyPay:salaryPay,
      totalLatePenalty:0,
      totalEarlyLeavePenalty:0,
      penaltyReportDiscount:Number(row.discounts || 0),
      totalDiscounts:Number(row.discounts || 0),
      totalBonusPoints:0,
      totalExtraMinutes:Number(row.overtimeMinutes || 0),
      paidHolidayDays:0,
      holidayPay:0,
      variablePayBlocked:false,
      hasBonus:commissionsPay>0,
      bonusAmount:0,
      extraBonusAmount:commissionsPay,
      extraBonusBreakdown:[],
      approvedPenalties:[],
      approvedRecords:[],
      recordCommission:Number(row.commission || 0),
      approvedSentPenalties:[],
      penaltyIssuerBonus:0,
      approvedWrongCards:[],
      wrongCardBonus:0,
      safetypaySharedBonus:0,
      safetypayManagerBonus:0,
      managerPunctualStaffBonus:0,
      managerPunctualStaffBonusRate:0,
      managerPunctualStaffCount:0,
      managerPunctualStaffList:[],
      approvedRatings:[],
      ratingBonus:0,
      approvedRatingDecisions:[],
      ratingDecisionBonus:0,
      approvedRecordValidations:[],
      recordValidationBonus:0,
      approvedCalls:[],
      callBonus:0,
      approvedReferrals:[],
      referralBonus:Number(row.referralCommission || 0),
      configuredBonus:0,
      bonusBlockedReason:'',
      lateEntries:0,
      totalLateMinutes:0,
      totalEarlyLeaveMinutes:0,
      salaryPaid:!!row.paid,
      salaryPaidMonth:month,
      salaryPaidAt:null,
      commissionsPaid:!!row.commissionsPaid,
      commissionPaidMonth:row.commissionPaidMonth || null,
      commissionPaidAt:row.commissionPaidAt || null,
      salaryMonthKey:month,
      closedSnapshot:true
    };
  });
  if(!ignoreFilters && state.view==='sueldos' && state.salarySede){
    people=people.filter(person=>normalizeSede(person.closedSnapshot ? person.sede : getPersonSede(person))===state.salarySede);
  }
  if(!ignoreFilters && state.attendancePerson){
    people=people.filter(person=>person.personId===state.attendancePerson);
  }
  if(!ignoreFilters && state.attendanceDepartment){
    people=people.filter(person=>matchesAttendanceDepartment(person, state.attendanceDepartment));
  }
  if(!ignoreFilters && state.attendanceSearch){
    const q=state.attendanceSearch.toLowerCase();
    people=people.filter(person=>
      String(person.personName || '').toLowerCase().includes(q) ||
      String(person.personId || '').toLowerCase().includes(q)
    );
  }
  return {
    people,
    workdays:monthWorkdays(monthDate.getFullYear(), monthDate.getMonth()),
    totalConfiguredSalary:people.reduce((sum, person)=>sum+Number(person.monthlySalary || 0),0),
    monthLabel:monthLabelFromKey(month),
    closedSnapshot:true
  };
}
function safetypayMonthKey(){
  return state.safetypayMonth || salaryMonthKey();
}
async function loadSafetypayCmrSummary(month=safetypayMonthKey()){
  const key=`${getSessionScopeKey()}|${month}`;
  if(SAFETYPAY_CMR_SUMMARY_KEY===key) return SAFETYPAY_CMR_SUMMARY;
  if(SAFETYPAY_CMR_SUMMARY_LOADING) return SAFETYPAY_CMR_SUMMARY;
  SAFETYPAY_CMR_SUMMARY_LOADING=true;
  try{
    const payload=await apiFetch(`/api/safetypay/summary?month=${encodeURIComponent(month)}`, { method:'GET', silent:true, busyMessage:'Calculando total SafetyPay...' });
    SAFETYPAY_CMR_SUMMARY=payload;
    SAFETYPAY_CMR_SUMMARY_KEY=key;
    return payload;
  }catch(_error){
    SAFETYPAY_CMR_SUMMARY=null;
    SAFETYPAY_CMR_SUMMARY_KEY=key;
    return null;
  }finally{
    SAFETYPAY_CMR_SUMMARY_LOADING=false;
    if(state.view==='safetypay') preserveMainScroll(()=>render());
  }
}
function isAdminSafetypayEntry(entry){
  return getItemOwner(entry)?.role==='admin';
}
function safetypayVisibleRows(month=safetypayMonthKey()){
  let rows=[...SAFETYPAY_CODES].filter(entry=>monthKeyFromDate(entry.createdAt)===month);
  // The selected Safetypay month is already an exact date scope. Applying the
  // global "Este mes" filter here hid historical months such as August.
  if(!state.safetypayMonth) rows=rows.filter(entry=>dateMatchesQuickPeriod(entry.createdAt));
  if(isEmployee() && !canManageSafetypayPayments()) rows=rows.filter(entry=>!isAdminSafetypayEntry(entry) && getItemSede(entry)===userSede(state.currentUser));
  if((isAdmin() || canPreviewAllSedesAsManager()) && state.safetypaySede){
    rows=rows.filter(entry=>!isAdminSafetypayEntry(entry) && getItemSede(entry)===state.safetypaySede);
  }else if(isManager() && !canPreviewAllSedesAsManager()){
    rows=rows.filter(entry=>!isAdminSafetypayEntry(entry) && getItemSede(entry)===userSede(state.currentUser));
  }
  // En el detalle CMR se muestran también los registros del admin para auditoría,
  // aunque esos registros siguen excluidos de metas, bonos y total por sede.
  if(state.safetypayCmrTotalOnly) rows=rows.filter(entry=>['CMR','IO'].includes(entry.bank));
  const duplicateIds=getSafetypayDuplicateIds(rows);
  if(state.safetypayDuplicatesOnly){
    rows=rows.filter(entry=>duplicateIds.has(Number(entry.id)));
  }
  if(state.safetypaySearch){
    const q=state.safetypaySearch.toLowerCase();
    rows=rows.filter(entry=>
      entry.clientDni.toLowerCase().includes(q) ||
      entry.cardLast4.includes(q) ||
      String(entry.customerCode||'').includes(q) ||
      entry.operationNumber.toLowerCase().includes(q) ||
      entry.bank.toLowerCase().includes(q) ||
      entry.code.toLowerCase().includes(q) ||
      getItemOwner(entry).name.toLowerCase().includes(q)
    );
  }
  return rows.sort((a,b)=>String(b.createdAt||'').localeCompare(String(a.createdAt||'')));
}
function safetypayDuplicateKey(value){
  return String(value || '').trim().toUpperCase();
}
function safetypayEntryDay(entry){
  const value=entry?.createdAt;
  const date=value ? new Date(value) : new Date();
  if(Number.isNaN(date.getTime())) return isoDate(value);
  return dateKey(date.getFullYear(), date.getMonth(), date.getDate());
}
function getSafetypayDuplicateIds(rows=[]){
  const groups=new Map();
  rows.forEach(entry=>{
    const customerCode=safetypayDuplicateKey(entry.customerCode);
    [
      ['codigo-dia', customerCode ? `${customerCode}:${safetypayEntryDay(entry)}` : ''],
      ['operacion', safetypayDuplicateKey(entry.operationNumber)]
    ].forEach(([type, value])=>{
      if(!value || /^0+$/.test(value)) return;
      const key=`${type}:${value}`;
      if(!groups.has(key)) groups.set(key, []);
      groups.get(key).push(Number(entry.id));
    });
  });
  const duplicates=new Set();
  groups.forEach(ids=>{
    if(ids.length > 1){
      ids.forEach(id=>duplicates.add(id));
    }
  });
  return duplicates;
}
function findSafetypayDraftDuplicates(draft, ignoreId=null){
  const customerCode=safetypayDuplicateKey(draft?.customerCode);
  const operationNumber=safetypayDuplicateKey(draft?.operationNumber);
  const editingEntry=ignoreId ? SAFETYPAY_CODES.find(entry=>Number(entry.id)===Number(ignoreId)) : null;
  const targetMonth=monthKeyFromDate(editingEntry?.createdAt) || salaryMonthKey();
  const targetDay=safetypayEntryDay(editingEntry);
  return SAFETYPAY_CODES.filter(entry=>{
    if(Number(entry.id)===Number(ignoreId)) return false;
    if(monthKeyFromDate(entry.createdAt)!==targetMonth) return false;
    const sameCode=customerCode && safetypayDuplicateKey(entry.customerCode)===customerCode && safetypayEntryDay(entry)===targetDay;
    const sameOperation=operationNumber && safetypayDuplicateKey(entry.operationNumber)===operationNumber;
    return sameCode || sameOperation;
  }).map(entry=>({
    entry,
    sameCode:customerCode && safetypayDuplicateKey(entry.customerCode)===customerCode && safetypayEntryDay(entry)===targetDay,
    sameOperation:operationNumber && safetypayDuplicateKey(entry.operationNumber)===operationNumber
  }));
}
function getSafetypayRowsForSelectedScope(month=safetypayMonthKey()){
  if(((isAdmin() || canPreviewAllSedesAsManager()) && !state.safetypaySede) || canManageSafetypayPayments()){
    return SAFETYPAY_CODES.filter(entry=>monthKeyFromDate(entry.createdAt)===month && userActiveInMonth(getItemOwner(entry), month));
  }
  const sede=(isAdmin() || canPreviewAllSedesAsManager()) ? state.safetypaySede : userSede(state.currentUser);
  return getSafetypaySedeRows(sede, month);
}
function getSafetypaySedeRows(sede, month=safetypayMonthKey()){
  return SAFETYPAY_CODES.filter(entry=>
    monthKeyFromDate(entry.createdAt)===month &&
    !isAdminSafetypayEntry(entry) &&
    getItemSede(entry)===sede &&
    userActiveInMonth(getItemOwner(entry), month)
  );
}
function safetypayProgress(rows, sede='', month=safetypayMonthKey()){
  const total=rows.reduce((sum, entry)=>sum+Number(entry.amount||0),0);
  const goal=getSafetypayGoal(sede, month);
  const pct=goal ? Math.min(100, (total/goal)*100) : 0;
  let message='Recien empezando';
  if(pct>=100) message='Meta cumplida';
  else if(pct>=80) message='Llegaron al 80%, bono de sede habilitado';
  else if(pct>=60) message='Falta poco para el 80%';
  else if(pct>=50) message='Ya van la mitad';
  else if(pct>=25) message='Buen avance, sigan empujando';
  return { total, pct, message, goal };
}
function safetypayManagerBonusForPerson(person, month=safetypayMonthKey()){
  const user=userForAttendancePerson(person);
  if(!user || user.role!=='manager' || (person.payrollRole || '')!=='Jefe de Sede') return 0;
  return safetypayProgress(getSafetypaySedeRows(userSede(user), month), userSede(user), month).pct>=100 ? getSafetypayManagerBonus() : 0;
}
function safetypaySharedBonusEligiblePeople(allPeople, sede, month=safetypayMonthKey()){
  if(!sede) return [];
  const progress=safetypayProgress(getSafetypaySedeRows(sede, month), sede, month);
  if(progress.pct < getSafetypaySharedThreshold()*100) return [];
  const firstDate=`${month}-01`;
  const lastDate=monthLastDateKey(month);
  // September 2026 Lince shared pool is split among these four confirmed recipients.
  const septemberLinceRecipients=new Set(['359435','60733076','60698987','70972407']);
  return (allPeople || []).filter(person=>{
    if(sede==='Lince' && month==='2026-09' && !septemberLinceRecipients.has(String(person?.personId || '').trim())) return false;
    const linkedUser=userForAttendancePerson(person);
    if(linkedUser?.role==='admin') return false;
    if(!['Atencion al cliente','Jefes de sede'].includes(collaboratorAreaForPerson(person))) return false;
    if(blocksVariablePay(person)) return false;
    if(!personActiveInMonth(person, month)) return false;
    // If the hire date is missing, use attendance on the first scheduled
    // working day as evidence that the person was already active that month.
    const hireDate=hireDateForPerson(person);
    if(hireDate){
      if(hireDate>firstDate) return false;
    } else {
      const [year, monthNumber]=month.split('-').map(Number);
      const firstScheduledDay=monthlyDaysForPerson(person, year, monthNumber-1).find(day=>{
        const dayDate=new Date(`${day.date}T00:00:00`);
        return dayDate.getDay()!==0 && !day.holiday && getAttendanceSchedule(person, day.date).shiftHours>0;
      });
      if(!firstScheduledDay || (!attendanceDayWorked(firstScheduledDay) && !firstScheduledDay.justifiedDay)) return false;
    }
    const termination=terminationDate(person);
    if(termination && termination<=lastDate) return false;
    const inactiveAt=inactiveCollaboratorDate(person);
    if(inactiveAt && inactiveAt<=lastDate) return false;
    return getPersonSedeAt(person, firstDate)===sede && getPersonSedeAt(person, lastDate)===sede;
  });
}
function safetypaySharedBonusWeight(person){
  if(blocksVariablePay(person)) return 0;
  if(isSurSharedHalfSafetypayPerson(person)) return 0.5;
  return person?.employmentType==='PART_TIME' ? 0.5 : 1;
}
function safetypaySharedBonusForPerson(person, allPeople, month=safetypayMonthKey()){
  const sede=getPersonSede(person);
  const eligiblePeople=safetypaySharedBonusEligiblePeople(allPeople, sede, month);
  if(!eligiblePeople.length) return 0;
  const totalWeight=eligiblePeople.reduce((sum, item)=>sum + safetypaySharedBonusWeight(item), 0);
  if(totalWeight<=0) return 0;
  const poolCents=Math.max(0, Math.round(Number(getSafetypaySharedBonusPool() || 0)*100));
  if(poolCents<=0) return 0;
  const allocations=eligiblePeople.map(item=>{
    const exactCents=poolCents*safetypaySharedBonusWeight(item)/totalWeight;
    const cents=Math.floor(exactCents);
    return { person:item, cents, remainder:exactCents-cents };
  });
  const remainingCents=poolCents-allocations.reduce((sum, item)=>sum+item.cents, 0);
  allocations.sort((a,b)=>{
    const remainderDifference=b.remainder-a.remainder;
    if(Math.abs(remainderDifference)>1e-9) return remainderDifference;
    const aId=String(a.person.personId || '');
    const bId=String(b.person.personId || '');
    return aId===bId ? 0 : aId<bId ? -1 : 1;
  });
  for(let index=0;index<remainingCents;index++) allocations[index].cents+=1;
  const allocation=allocations.find(item=>item.person.personId===person.personId);
  return allocation ? allocation.cents/100 : 0;
}
function ratingMonthKey(){
  return activeMonthKey(state.ratingMonth);
}
function ratingRowsForPerson(person, month=salaryMonthKey()){
  return ratingRowsForPersonFromRows(person, RATINGS, month);
}
function ratingRowsForPersonFromRows(person, rows, month=salaryMonthKey()){
  const user=userForAttendancePerson(person);
  const target=normalizePersonName(person?.personName);
  return (rows || []).filter(row=>{
    if(!row.payable) return false;
    if(monthKeyFromDate(row.date || row.rawDate)!==month) return false;
    if(user && row.matchedUserId===user.id) return true;
    return normalizePersonName(row.matchedUserName || row.advisor)===target;
  });
}
function approvedRatingsDecidedByUser(user, month=salaryMonthKey()){
  return approvedRatingsDecidedByUserFromRows(user, RATINGS, month);
}
function approvedRatingsDecidedByUserFromRows(user, rows, month=salaryMonthKey()){
  if(!user) return [];
  return (rows || []).filter(row=>
    row.payable &&
    Number(row.decidedBy?.id || 0)===Number(user.id) &&
    monthKeyFromDate(row.approvedAt || row.date || row.rawDate)===month
  );
}
function approvedRecordsValidatedByUser(user, month=salaryMonthKey()){
  return approvedRecordsValidatedByUserFromRows(user, RECORDS, month);
}
function approvedRecordsValidatedByUserFromRows(user, rows, month=salaryMonthKey()){
  if(!user) return [];
  return (rows || []).filter(record=>
    !!record.validatedAt &&
    (record.tipo==='operacion' || record.type==='OPERACION') &&
    Number(record.validatedById || record.validatedBy?.id || 0)===Number(user.id) &&
    recordAccountingMonthKey(record)===month
  );
}
function approvedCallsForPerson(person, month=salaryMonthKey()){
  return approvedCallsForPersonFromRows(person, CALL_REPORTS, month);
}
function approvedCallsForPersonFromRows(person, rows, month=salaryMonthKey()){
  const user=userForAttendancePerson(person);
  const target=normalizePersonName(person?.personName);
  return (rows || []).filter(report=>{
    if(report.status!=='APPROVED' && !report.validatedAt) return false;
    if(monthKeyFromDate(report.validatedAt || report.createdAt)!==month) return false;
    if(user && Number(report.userId)===Number(user.id)) return true;
    return normalizePersonName(getItemOwner(report).name)===target;
  });
}
function getRatingRows(){
  const month=ratingMonthKey();
  const archivedRows=visibleArchivedRatingsForMonth(month);
  let rows=mergeArchivedRatingRows(archivedRows,RATINGS);
  if(month) rows=rows.filter(row=>monthKeyFromDate(row.date || row.rawDate)===month);
  rows=rows.filter(row=>dateMatchesQuickPeriod(row.date || row.rawDate));
  if(state.ratingUser) rows=rows.filter(row=>row.matchedUserId==state.ratingUser);
  if(state.ratingStars) rows=rows.filter(row=>Number(row.rating)===Number(state.ratingStars));
  if(state.ratingStatus){
    rows=rows.filter(row=>{
      if(state.ratingStatus==='approved') return row.payable;
      if(state.ratingStatus==='pending') return row.approvalStatus==='PENDING';
      if(state.ratingStatus==='rejected') return row.approvalStatus==='REJECTED';
      if(state.ratingStatus==='invalid') return !row.valid;
      return true;
    });
  }
  if(state.ratingSearch){
    const q=normalizePersonName(state.ratingSearch);
    rows=rows.filter(row=>
      normalizePersonName(row.advisor).includes(q) ||
      normalizePersonName(row.matchedUserName).includes(q) ||
      normalizePersonName(row.dni).includes(q) ||
      normalizePersonName(row.comment).includes(q)
    );
  }
  return rows.sort((a,b)=>String(b.date||b.rawDate||'').localeCompare(String(a.date||a.rawDate||'')));
}
function defersMonthEndOvertime(day){
  return !!day?.date && day.date>='2026-10-31' && isLastCalendarDay(day.date);
}
function previousMonthOvertimeForPerson(person, month){
  const previousDate=new Date(month+'-01T12:00:00Z');previousDate.setUTCDate(0);
  const date=previousDate.toISOString().slice(0,10),previousMonth=date.slice(0,7);
  const live=(ATTENDANCE?.people||[]).find(item=>String(item.personId)===String(person.personId));
  const supplemental=[...(person.payrollCarryDays||[]),...(live?.payrollCarryDays||[])].find(item=>item?.date===date && date==='2026-09-30' && month==='2026-10');
  const day=supplemental || [person.previousMonthLastDay,live?.previousMonthLastDay,...(person.days||[])].find(item=>item?.date===date);
  if(!day || (!supplemental && !defersMonthEndOvertime(day)) || !day.entryTime || !day.exitTime || day.autoMonthEndExit) return {minutes:0,amount:0,date};
  const historical=salaryProfileForMonth(archivedAttendanceForMonth(previousMonth)?.people?.find(item=>String(item.personId)===String(person.personId))||person,previousMonth);
  const payment=computeAttendancePayment(day,historical,monthWorkdays(previousDate.getUTCFullYear(),previousDate.getUTCMonth()),true);
  return {minutes:Math.round(Number(payment.overtimeHours||0)*60),amount:Number(payment.overtimePay||0),date};
}
function computeAttendancePayment(day, person, salaryBaseDays=SALARY_BASE_DAYS, includeMonthEndOvertime=false){
  if(day.absence) return {dailyPay:0,regularPay:0,overtimePay:0,latePenalty:0,earlyLeavePenalty:0,bonusPoints:0,workedHours:0,regularHours:0,overtimeHours:0};
  // Payroll projection only: the attendance day and real punches stay unchanged.
  day=applyMonthEndAutoExit(day,person);
  const calendar=day.calendarException || calendarForPerson(person,day.date);
  if(calendar && calendar.kind!=='SPECIAL_SHIFT' && new Date(day.date+'T12:00:00Z').getUTCDay()!==0){
    const dailyRate=getEffectiveMonthlySalary(person)/Math.max(1,Number(salaryBaseDays)||SALARY_BASE_DAYS);
    const schedule=getAttendanceSchedule(person,day.date);
    return WorkCalendar.calendarRestPayment(calendar,dailyRate,dailyRate/Math.max(1,schedule.shiftHours),timeMinutesOrNull(day.entryTime),timeMinutesOrNull(day.exitTime),schedule.breakMinutes);
  }
  const dateObj=new Date(`${day.date}T00:00:00`);
  if(dateObj.getDay()===0) return { dailyPay:0, latePenalty:0, earlyLeavePenalty:0, bonusPoints:0, workedHours:0 };
  if(day.justifiedDay) return { dailyPay:0, regularPay:0, overtimePay:0, latePenalty:0, earlyLeavePenalty:0, bonusPoints:0, workedHours:0, regularHours:0, overtimeHours:0 };
  const entryMinutes=timeMinutesOrNull(day.entryTime);
  const exitMinutes=timeMinutesOrNull(day.exitTime);
  const monthlySalary=getEffectiveMonthlySalary(person);
  const schedule=getAttendanceSchedule(person, day.date);
  const effectiveSalaryBaseDays=Math.max(1, Number(salaryBaseDays) || SALARY_BASE_DAYS);
  const hourlyRate=((monthlySalary/effectiveSalaryBaseDays)/schedule.shiftHours);
  const holiday=day.holiday || peruNationalHoliday(day.date);
  if(holiday && !attendanceDayWorked(day)){
    const regularPay=monthlySalary / effectiveSalaryBaseDays;
    return { dailyPay:regularPay, regularPay, overtimePay:0, latePenalty:0, earlyLeavePenalty:0, bonusPoints:1, workedHours:0, regularHours:0, overtimeHours:0, holiday };
  }
  const latePenalty=(day.lateMinutes||0) * getPenaltyPerMinute(person);
  const earlyLeavePenalty=appliesEarlyLeavePenalty(day.date) ? (day.earlyLeaveMinutes||0) * EARLY_LEAVE_PENALTY_PER_MINUTE : 0;
  const isAbsence=(day.entryStatus==='Sin entrada' && day.exitStatus==='Sin salida');
  let bonusPoints=0;
  if(!isAbsence && day.entryStatus!=='Tarde'){
    bonusPoints=1;
  }
  if(entryMinutes===null || exitMinutes===null || isAbsence){
    return { dailyPay:0, regularPay:0, overtimePay:0, latePenalty, earlyLeavePenalty, bonusPoints, workedHours:0, regularHours:0, overtimeHours:0 };
  }
  const effectiveStart=schedule.entryMinutes;
  const regularEnd=Math.min(exitMinutes, schedule.exitMinutes);
  const rawRegularMinutes=Math.max(0, regularEnd - effectiveStart);
  const regularHours=Math.max(0, (rawRegularMinutes - schedule.breakMinutes) / 60);
  const overtimeHours=!includeMonthEndOvertime && defersMonthEndOvertime(day) ? 0 : Math.max(0, (exitMinutes - schedule.exitMinutes) / 60);
  const firstTwoExtra=Math.min(2, overtimeHours);
  const remainingExtra=Math.max(0, overtimeHours - 2);
  const regularPay=regularHours * hourlyRate;
  const overtimePay=(firstTwoExtra * hourlyRate * 1.25) + (remainingExtra * hourlyRate * 1.35);
  const workedHours=regularHours + overtimeHours;
  const dailyPay=Math.max(0, regularPay + overtimePay - latePenalty - earlyLeavePenalty);
  return { dailyPay, regularPay, overtimePay, latePenalty, earlyLeavePenalty, bonusPoints, workedHours, regularHours, overtimeHours };
}
function collectionCacheStamp(rows=[], fields=['updatedAt','validatedAt','createdAt']){
  const list=Array.isArray(rows) ? rows : [];
  let latest='';
  list.forEach(row=>{
    fields.forEach(field=>{
      const value=String(row?.[field] || '');
      if(value>latest) latest=value;
    });
  });
  return `${list.length}:${latest}`;
}
function getSalaryPeople(options={}){
  const ignoreFilters=!!options.ignoreFilters;
  const includeInactive=!!options.includeInactive;
  const salaryDate=options.date instanceof Date ? options.date : new Date();
  const salaryMonth=salaryMonthKey(salaryDate);
  const archivedAttendance=archivedAttendanceForMonth(salaryMonth);
  const canRebuildArchivedSalary=Array.isArray(archivedAttendance?.people) && archivedAttendance.people.length>0;
  const closedSalaryData=canRebuildArchivedSalary ? null : closedSalaryDataFromClosure(salaryMonth, options);
  if(closedSalaryData) return closedSalaryData;
  const attendanceSource=canRebuildArchivedSalary ? archivedAttendance : ATTENDANCE;
  if(!attendanceSource?.people?.length) return [];
  const cacheKey=[
    attendanceSource.importedAt || '',
    attendanceSource.sourceFile || '',
    ATTENDANCE_OWNER_KEY || '',
    APP_CACHE_VERSION,
    collectionCacheStamp(RECORDS, ['updatedAt','validatedAt','rejectedAt','createdAt']),
    collectionCacheStamp(RATINGS, ['updatedAt','approvedAt','date','rawDate']),
    collectionCacheStamp(REFERRALS, ['updatedAt','validatedAt','rejectedAt','createdAt']),
    collectionCacheStamp(WRONG_CARDS, ['updatedAt','validatedAt','detectedDate','createdAt']),
    collectionCacheStamp(CALL_REPORTS, ['updatedAt','validatedAt','createdAt']),
    collectionCacheStamp(PENALTY_REPORTS, ['updatedAt','decidedAt','createdAt']),
    JSON.stringify(SETTINGS.payoutSettings || {}),
    String(SETTINGS.commissionPerRecord || ''),
    salaryMonth,
    canRebuildArchivedSalary ? 'archived' : 'live',
    ignoreFilters ? '__all__' : (state.attendancePerson || ''),
    ignoreFilters ? '__all__' : (state.attendanceDepartment || ''),
    ignoreFilters || state.view!=='sueldos' ? '__all__' : (state.salarySede || ''),
    ignoreFilters ? '__all__' : (state.attendanceSearch || '')
  ].join('|');
  if(SALARY_PEOPLE_CACHE_MAP.has(cacheKey)) return SALARY_PEOPLE_CACHE_MAP.get(cacheKey);
  if(SALARY_PEOPLE_CACHE_KEY===cacheKey && SALARY_PEOPLE_CACHE_VALUE){
    SALARY_PEOPLE_CACHE_MAP.set(cacheKey, SALARY_PEOPLE_CACHE_VALUE);
    return SALARY_PEOPLE_CACHE_VALUE;
  }
  const today=salaryDate;
  const currentYear=today.getFullYear();
  const currentMonth=today.getMonth();
  const workdays=monthWorkdays(currentYear, currentMonth);
  const sourcePeople=[...attendanceSource.people].filter(person=>
    includeInactive || !isInactiveCollaborator(person)
  );
  const archivedRecords=visibleArchivedRecordsForMonth(salaryMonth);
  const sourceRecords=archivedRecords.length ? archivedRecords : RECORDS;
  const archivedRatings=visibleArchivedRatingsForMonth(salaryMonth);
  const sourceRatings=mergeArchivedRatingRows(archivedRatings,RATINGS);
  const archivedWrongCards=archivedWrongCardsForMonth(salaryMonth);
  const sourceWrongCards=archivedWrongCards.length ? archivedWrongCards : WRONG_CARDS;
  const archivedCalls=archivedCallsForMonth(salaryMonth);
  const sourceCalls=archivedCalls.length ? archivedCalls : CALL_REPORTS;
  const archivedReferrals=archivedReferralsForMonth(salaryMonth);
  const sourceReferrals=archivedReferrals.length ? archivedReferrals : REFERRALS;
  const archivedPenalties=archivedPenaltiesForMonth(salaryMonth);
  const sourcePenalties=archivedPenalties.length ? archivedPenalties : PENALTY_REPORTS;
  let people=sourcePeople.map(person=>{
    person=salaryProfileForMonth(person,salaryMonth);
    const monthDays=monthlyDaysForPerson(person, currentYear, currentMonth).filter(day=>isBeforeOrOnTermination(person, day.date));
    const roleConfig=getPayrollRoleConfig(person.payrollRole || 'Sin definir');
    const configuredSalary=Number(person.monthlySalary ?? roleConfig.baseSalary ?? 0);
    const monthlySalary=getEffectiveMonthlySalary({ ...person, monthlySalary: configuredSalary });
    const salaryBaseDays=Math.max(1, workdays);
    const previousOvertime=previousMonthOvertimeForPerson(person,salaryMonth);
    const dayPayments=monthDays.map(day=>({
      ...day,
      ...computeAttendancePayment(day, { ...person, monthlySalary, payrollRole: person.payrollRole || 'Sin definir' }, salaryBaseDays),
      payrollEstimatedExit:shouldAutoCloseMonthEndExit(day)?timeFromMinutes(getAttendanceSchedule(person,day.date).exitMinutes):null
    }));
    const workedDays=dayPayments.filter(day=>day.dailyPay>0 || attendanceDayWorked(day)).length;
    const expectedWorkdays=expectedWorkdaysForPersonInMonth(person, currentYear, currentMonth, workdays);
    const unpaidRestDays=dayPayments.filter(day=>day.calendarException?.kind==='UNPAID_REST' && !attendanceDayWorked(day)).length;
    const missingDays=Math.max(0, expectedWorkdays - workedDays - unpaidRestDays);
    const totalDailyPay=dayPayments.reduce((sum, day)=>sum + Number(day.dailyPay || 0), 0) + previousOvertime.amount;
    const totalLatePenalty=dayPayments.reduce((sum, day)=>sum + Number(day.latePenalty || 0), 0);
    const totalEarlyLeavePenalty=dayPayments.reduce((sum, day)=>sum + Number(day.earlyLeavePenalty || 0), 0);
    const totalBonusPoints=dayPayments.reduce((sum, day)=>sum + Number(day.bonusPoints || 0), 0);
    const totalExtraMinutes=dayPayments.reduce((sum, day)=>sum + (defersMonthEndOvertime(day)?0:Number(day.overtimeMinutes||0)), 0);
    const deferredExtraMinutes=dayPayments.filter(defersMonthEndOvertime).reduce((sum,day)=>sum+Math.round(Number(computeAttendancePayment(day,person,salaryBaseDays,true).overtimeHours||0)*60),0);
    const paidHolidayDays=dayPayments.filter(day=>isPaidNationalHoliday(day)).length;
    const holidayPay=dayPayments.reduce((sum, day)=>sum + (isPaidNationalHoliday(day) ? Number(day.regularPay || 0) : 0), 0);
    const currentSalaryMonth=salaryMonth;
    const variablePayBlocked=blocksVariablePay(person);
    const approvedPenalties=freezeAtTermination(person, approvedPenaltyReportsForPersonFromRows(person, sourcePenalties, currentSalaryMonth), report=>report.decidedAt || report.createdAt);
    const penaltyReportDiscount=approvedPenalties.reduce((sum, report)=>sum + Number(report.penaltyAmount || 0), 0);
    const linkedUser=userForAttendancePerson(person);
    const approvedRecords=linkedUser
      ? sourceRecords.filter(record=>
          Number(record.userId)===Number(linkedUser.id) &&
          !!record.validatedAt &&
          recordAccountingMonthKey(record)===currentSalaryMonth &&
          isBeforeOrOnTermination(person, record.operationDate || record.fechaOperacion || record.validatedAt || record.createdAt)
        )
      : [];
    const recordCommission=variablePayBlocked ? 0 : approvedRecords.length * getCommissionRate();
    const approvedSentPenalties=freezeAtTermination(person, approvedPenaltyReportsSentByUserFromRows(linkedUser, sourcePenalties, currentSalaryMonth), report=>report.decidedAt || report.createdAt);
    const penaltyIssuerBonus=!variablePayBlocked && (person.payrollRole || '')==='Jefe de Sede' ? approvedSentPenalties.length * getManagerPenaltyCommission() : 0;
    const approvedPaymentAuditsAsManager=freezeAtTermination(person, approvedPaymentAuditReportsForManagerFromRows(person, sourcePenalties, currentSalaryMonth), report=>report.decidedAt || report.createdAt);
    const paymentAuditManagerDiscount=approvedPaymentAuditsAsManager.reduce((sum, report)=>sum + Number(report.managerPenaltyAmount || 0.5), 0);
    const approvedPaymentAuditsSent=freezeAtTermination(person, approvedPaymentAuditReportsSentByUserFromRows(linkedUser, sourcePenalties, currentSalaryMonth), report=>report.decidedAt || report.createdAt);
    const paymentAuditReporterBonus=variablePayBlocked ? 0 : approvedPaymentAuditsSent.reduce((sum, report)=>sum + Number(report.reporterBonusAmount || 1), 0);
    const approvedWrongCards=freezeAtTermination(person, approvedWrongCardsForPersonFromRows(person, sourceWrongCards, currentSalaryMonth), report=>report.detectedDate || report.validatedAt || report.createdAt);
    const wrongCardBonus=variablePayBlocked ? 0 : scaleBonusForPerson(person, approvedWrongCards.reduce((sum, report)=>sum + Number(report.bonusAmount || getWrongCardBonus()), 0));
    const safetypaySharedBonus=variablePayBlocked ? 0 : safetypaySharedBonusForPerson(person, sourcePeople, currentSalaryMonth);
    const safetypayManagerBonus=variablePayBlocked ? 0 : scaleBonusForPerson(person, safetypayManagerBonusForPerson(person, currentSalaryMonth));
    const approvedRatings=freezeAtTermination(person, ratingRowsForPersonFromRows(person, sourceRatings, currentSalaryMonth), row=>row.approvedAt || row.date || row.rawDate);
    const ratingBonus=variablePayBlocked ? 0 : approvedRatings.reduce((sum, row)=>sum + Number(row.amount || getRatingCommission()), 0);
    const approvedRatingDecisions=freezeAtTermination(person, approvedRatingsDecidedByUserFromRows(linkedUser, sourceRatings, currentSalaryMonth), row=>row.approvedAt || row.date || row.rawDate);
    const ratingDecisionBonus=!variablePayBlocked && (person.payrollRole || '')==='Jefe de Sede' ? approvedRatingDecisions.length * getManagerRatingCommission() : 0;
    const approvedRecordValidations=freezeAtTermination(person, approvedRecordsValidatedByUserFromRows(linkedUser, sourceRecords, currentSalaryMonth), record=>record.validatedAt || record.operationDate || record.fechaOperacion || record.createdAt);
    const recordValidationBonus=!variablePayBlocked && (person.payrollRole || '')==='Jefe de Sede' ? approvedRecordValidations.length * getManagerRecordValidationCommission() : 0;
    const approvedCalls=freezeAtTermination(person, approvedCallsForPersonFromRows(person, sourceCalls, currentSalaryMonth), report=>report.validatedAt || report.createdAt);
    const callBonus=variablePayBlocked ? 0 : scaleBonusForPerson(person, approvedCalls.length * getCallCommission());
    const approvedReferrals=freezeAtTermination(person, approvedReferralsForPersonFromRows(person, sourceReferrals, currentSalaryMonth), referral=>referral.validatedAt || referral.createdAt);
    const referralBonus=variablePayBlocked ? 0 : approvedReferrals.reduce((sum, referral)=>sum + Number(referral.referralCommission || 0), 0);
    const punctualStaff=variablePayBlocked ? [] : punctualStaffForManager(person, sourcePeople, currentYear, currentMonth);
    const managerPunctualStaffBonusRate=getManagerPunctualStaffBonusRate(person);
    const managerPunctualStaffWeight=punctualStaff.reduce((sum, item)=>sum + Number(item.punctualWeight || 1), 0);
    const managerPunctualStaffBonus=!variablePayBlocked && (person.payrollRole || '')==='Jefe de Sede' ? Number((managerPunctualStaffWeight * managerPunctualStaffBonusRate).toFixed(2)) : 0;
    const configuredBonus=getBonusAmount(person);
    const bonusBlockedReason=person.bonusDisabled ? (person.bonusDisabledReason || 'Retirado por disciplina') : '';
    const monthLateEntries=dayPayments.filter(day=>day.entryStatus==='Tarde' || Number(day.lateMinutes || 0)>0).length;
    const monthLateMinutes=dayPayments.reduce((sum, day)=>sum + Number(day.lateMinutes || 0), 0);
    const monthEarlyLeaveMinutes=dayPayments.reduce((sum, day)=>sum + Number(day.earlyLeaveMinutes || 0), 0);
    const hasBonus=workedDays > 0 && monthLateEntries === 0 && !person.bonusDisabled && configuredBonus > 0;
    const bonusAmount=hasBonus ? Number(configuredBonus || 0) : 0;
    const extraBonusBreakdown=variablePayBlocked ? [] : scaleBonusBreakdownForPerson(person, getExtraBonusBreakdown(person, approvedPenalties.length));
    const extraBonusAmount=extraBonusBreakdown.reduce((sum, bonus)=>sum + Number(bonus.amount || 0), 0);
    const commissionsPay=
      recordCommission +
      bonusAmount +
      extraBonusAmount +
      penaltyIssuerBonus +
      paymentAuditReporterBonus +
      ratingDecisionBonus +
      recordValidationBonus +
      wrongCardBonus +
      callBonus +
      safetypaySharedBonus +
      safetypayManagerBonus +
      managerPunctualStaffBonus +
      ratingBonus +
      referralBonus;
    const grossSalaryPay=dayPayments.reduce((sum, day)=>sum + Number(day.regularPay || 0) + Number(day.overtimePay || 0), 0) + previousOvertime.amount;
    const salaryPay=Math.max(0, grossSalaryPay - totalLatePenalty - totalEarlyLeavePenalty - penaltyReportDiscount - paymentAuditManagerDiscount);
    return {
      ...person,
      monthDays,
      dayPayments,
      workedDays,
      missingDays,
      configuredSalary,
      monthlySalary,
      dailyRate: monthlySalary / salaryBaseDays,
      hourlyRate: ((monthlySalary/salaryBaseDays)/getAttendanceSchedule(person).shiftHours),
      salaryPay,
      commissionsPay,
      estimatedSalary: Math.max(0, salaryPay + commissionsPay),
      totalDailyPay,
      totalLatePenalty,
      totalEarlyLeavePenalty,
      penaltyReportDiscount,
      paymentAuditManagerDiscount,
      totalDiscounts: totalLatePenalty + totalEarlyLeavePenalty + penaltyReportDiscount + paymentAuditManagerDiscount,
      totalBonusPoints,
      totalExtraMinutes,
      deferredExtraMinutes,
      previousMonthExtraMinutes:previousOvertime.minutes,
      previousMonthExtraPay:previousOvertime.amount,
      previousMonthExtraDate:previousOvertime.date,
      paidHolidayDays,
      holidayPay,
      variablePayBlocked,
      hasBonus,
      bonusAmount,
      extraBonusAmount,
      extraBonusBreakdown,
      approvedPenalties,
      approvedRecords,
      recordCommission,
      approvedSentPenalties,
      penaltyIssuerBonus,
      approvedPaymentAuditsAsManager,
      approvedPaymentAuditsSent,
      paymentAuditReporterBonus,
      approvedWrongCards,
      wrongCardBonus,
      safetypaySharedBonus,
      safetypayManagerBonus,
      managerPunctualStaffBonus,
      managerPunctualStaffBonusRate,
      managerPunctualStaffCount: punctualStaff.length,
      managerPunctualStaffWeight,
      managerPunctualStaffList: punctualStaff.map(item=>({ personId:item.personId, personName:item.personName, share:Number(item.punctualWeight || 1), workedDays:Number(item.punctualWorkedDays || 0), expectedDays:Number(item.punctualExpectedDays || 0) })),
      approvedRatings,
      ratingBonus,
      approvedRatingDecisions,
      ratingDecisionBonus,
      approvedRecordValidations,
      recordValidationBonus,
      approvedCalls,
      callBonus,
      approvedReferrals,
      referralBonus,
      configuredBonus,
      bonusBlockedReason,
      lateEntries: monthLateEntries,
      totalLateMinutes: monthLateMinutes,
      totalEarlyLeaveMinutes: monthEarlyLeaveMinutes,
      salaryPaid: person.salaryPaidMonth === currentSalaryMonth,
      salaryPaidMonth: person.salaryPaidMonth || null,
      salaryPaidAt: person.salaryPaidAt || null,
      commissionsPaid: (person.extraBonuses?.__commissionPaidMonth || null) === currentSalaryMonth,
      commissionPaidMonth: person.extraBonuses?.__commissionPaidMonth || null,
      commissionPaidAt: person.extraBonuses?.__commissionPaidAt || null,
      salaryMonthKey: currentSalaryMonth
    };
  });
  if(!ignoreFilters && state.view==='sueldos' && state.salarySede){
    people=people.filter(person=>normalizeSede(person.closedSnapshot ? person.sede : getPersonSede(person))===state.salarySede);
  }
  if(!ignoreFilters && state.attendancePerson){
    people=people.filter(person=>person.personId===state.attendancePerson);
  }
  if(!ignoreFilters && state.attendanceDepartment){
    people=people.filter(person=>matchesAttendanceDepartment(person, state.attendanceDepartment));
  }
  if(!ignoreFilters && state.attendanceSearch){
    const q=state.attendanceSearch.toLowerCase();
    people=people.filter(person=>
      person.personName.toLowerCase().includes(q) ||
      person.personId.toLowerCase().includes(q)
    );
  }
  const totalConfiguredSalary=people.reduce((sum, person)=>sum+person.monthlySalary,0);
  const result={ people, workdays, totalConfiguredSalary, monthLabel: new Intl.DateTimeFormat('es-PE', { month:'long', year:'numeric' }).format(today) };
  SALARY_PEOPLE_CACHE_KEY = cacheKey;
  SALARY_PEOPLE_CACHE_VALUE = result;
  SALARY_PEOPLE_CACHE_MAP.set(cacheKey, result);
  if(SALARY_PEOPLE_CACHE_MAP.size > 8){
    SALARY_PEOPLE_CACHE_MAP.delete(SALARY_PEOPLE_CACHE_MAP.keys().next().value);
  }
  return result;
}
function getCurrentUserSalaryPerson(){
  const salaryData=getSalaryPeople({ ignoreFilters:true, date:salaryViewMonthDate() });
  const currentId=Number(state.currentUser?.id || 0);
  return (salaryData.people||[]).find(person=>{
    const linked=userForAttendancePerson(person);
    return linked && Number(linked.id)===currentId;
  }) || null;
}
function paidSalaryMonthsForCurrentUser(){
  if(!ATTENDANCE) return [];
  const months=new Set();
  const currentId=Number(state.currentUser?.id || 0);
  if(!currentId) return [];
  for(let i=0;i<18;i+=1){
    const date=new Date();
    date.setDate(1);
    date.setMonth(date.getMonth()-i);
    try{
      const salaryData=getSalaryPeople({ ignoreFilters:true, date }) || {};
      const person=(salaryData.people || []).find(item=>{
        const linked=userForAttendancePerson(item);
        return linked && Number(linked.id)===currentId;
      });
      if(person?.salaryPaid) months.add(person.salaryMonthKey);
    }catch(_error){
      continue;
    }
  }
  return [...months].filter(Boolean).sort().reverse();
}
function getSalaryPersonById(personId){
  const target=String(personId ?? '').trim();
  if(!target) return null;
  const scoped=(getSalaryPeople({ date:salaryViewMonthDate() }).people || []).find(item=>String(item.personId ?? '').trim()===target);
  if(scoped) return scoped;
  return (getSalaryPeople({ ignoreFilters:true, date:salaryViewMonthDate() }).people || []).find(item=>String(item.personId ?? '').trim()===target) || null;
}
function openSalaryDetail(personId, full=false){
  const person=getSalaryPersonById(personId);
  if(!person){
    appAlert('No se encontro el detalle de sueldo para esta persona. Actualiza asistencia e intenta otra vez.', 'Detalle de sueldo');
    return;
  }
  state.salaryDetailId=String(person.personId ?? personId).trim();
  if(!full && state.view==='sueldos' && document.querySelector('.fx-salary-detail') && typeof paintFaithfulSalary==='function'){
    state.fxSalaryFull=false;
    paintFaithfulSalary();
    return;
  }
  const modalRoot=document.getElementById('mr');
  if(modalRoot && state.view==='sueldos'){
    try{
      document.body.classList.toggle('modal-open', true);
      modalRoot.innerHTML=renderSalaryDetailModal();
      bindSalaryDetailModal();
      return;
    }catch(error){
      console.error('Error al abrir detalle de sueldo', error);
    }
  }
  render();
}
function exportIndividualReportPdf(reportBundle, selectedUser, generatedByUser=state.currentUser){
  if(!reportBundle || !selectedUser) return false;
  const totalCommission=Number(reportBundle?.salaryPerson?.commissionsPay || 0);
  const w=window.open('', '_blank');
  if(!w) return false;
      const salaryPerson=reportBundle.salaryPerson;
      const attendanceRows=(salaryPerson?.dayPayments || [])
        .slice()
        .sort((a,b)=>String(a.date || '').localeCompare(String(b.date || '')))
        .map(day=>{
          const status=attendanceStatusMeta(day);
          return `<tr>
            <td>${fmt(day.date)}</td>
            <td>${shortTime(day.entryTime)}</td>
            <td>${shortTime(day.exitTime)}</td>
            <td>${status.label}</td>
            <td>${minutesLabel(day.lateMinutes || 0)}</td>
            <td>${minutesLabel(day.overtimeMinutes || 0)}</td>
            <td>${money(day.regularPay || 0)}</td>
            <td>${money(day.overtimePay || 0)}</td>
            <td>${money(day.dailyPay || 0)}</td>
          </tr>`;
        }).join('');
      const recordRows=reportBundle.records
        .slice()
        .sort((a,b)=>String(b.createdAt || b.fechaOperacion || b.fecha || '').localeCompare(String(a.createdAt || a.fechaOperacion || a.fecha || '')))
        .map(record=>{
          const status=validationText(record);
          const commission=record.validatedAt ? money(getCommissionRate()) : 'S/ 0.00';
          return `<tr>
            <td>${esc(record.cliente || '-')}</td>
            <td>${esc(record.dni || '-')}</td>
            <td>${record.tipo==='operacion'?'Operacion':'Registro'}</td>
            <td>${record.modalidad==='presencial'?'Presencial':'Virtual'}</td>
            <td>${record.plataforma==='drive'?'Drive':'Web'}</td>
            <td>${fmt(record.fecha)}</td>
            <td>${fmt(record.fechaOperacion)}</td>
            <td>${status.label}</td>
            <td>${record.rejectionReason ? esc(record.rejectionReason) : '-'}</td>
            <td>${commission}</td>
          </tr>`;
        }).join('');
      const referralRows=reportBundle.referrals
        .slice()
        .sort((a,b)=>String(b.createdAt || '').localeCompare(String(a.createdAt || '')))
        .map(referral=>`<tr><td>${esc(referral.cliente || '-')}</td><td>${esc(referral.dni || '-')}</td><td>${fmtDateTime(referral.createdAt)}</td><td>${referral.bankLabel || referral.bank || '-'}</td><td>${money(referral.amount || 0)}</td><td>${reportReferralStatusLabel(referral)}</td><td>${referral.validatedAt ? money(referral.referralCommission || 0) : 'S/ 0.00'}</td></tr>`).join('');
      const wrongCardRows=reportBundle.wrongCards
        .slice()
        .sort((a,b)=>String(b.createdAt || '').localeCompare(String(a.createdAt || '')))
        .map(report=>`<tr><td>${esc(report.cliente || '-')}</td><td>${esc(report.dni || '-')}</td><td>${fmt(report.detectedDate)}</td><td>${reportDecisionStatusLabel(report)}</td><td>${report.rejectionReason ? esc(report.rejectionReason) : '-'}</td><td>${(report.status==='APPROVED' || report.validatedAt) ? money(report.bonusAmount || 0) : 'S/ 0.00'}</td></tr>`).join('');
      const callRows=reportBundle.calls
        .slice()
        .sort((a,b)=>String(b.createdAt || '').localeCompare(String(a.createdAt || '')))
        .map(report=>`<tr><td>${esc(report.cliente || '-')}</td><td>${esc(report.dni || '-')}</td><td>${fmtDateTime(report.createdAt)}</td><td>${reportDecisionStatusLabel(report)}</td><td>${report.rejectionReason ? esc(report.rejectionReason) : '-'}</td><td>${(report.status==='APPROVED' || report.validatedAt) ? money(report.bonusAmount || 0) : 'S/ 0.00'}</td></tr>`).join('');
      const ratingRows=reportBundle.ratings
        .slice()
        .sort((a,b)=>String(b.date || b.rawDate || '').localeCompare(String(a.date || a.rawDate || '')))
        .map(row=>`<tr><td>${fmtDateTime(row.date || row.rawDate)}</td><td>${esc(row.dni || '-')}</td><td>${row.rating || '-'} estrella(s)</td><td>${esc(row.comment || '-')}</td><td>${reportRatingStatusLabel(row)}</td><td>${row.payable ? money(row.amount || 0) : 'S/ 0.00'}</td></tr>`).join('');
      const penaltyRows=reportBundle.penalties
        .slice()
        .sort((a,b)=>String(b.decidedAt || b.createdAt || '').localeCompare(String(a.decidedAt || a.createdAt || '')))
        .map(report=>`<tr><td>${esc(report.penaltyLabel || 'Penalidad')}</td><td>${esc(report.clientName || '-')}</td><td>${fmtDateTime(report.decidedAt || report.createdAt)}</td><td>${report.status==='APPROVED'?'Aprobada':report.status==='REJECTED'?'Rechazada':'Pendiente'}</td><td>${esc(report.decisionReason || report.reason || '-')}</td><td>${report.status==='APPROVED' ? `-${money(report.penaltyAmount || 0)}` : 'S/ 0.00'}</td></tr>`).join('');
      const paidDays=salaryPerson ? salaryPerson.dayPayments.filter(day=>Number(day.dailyPay || 0)>0).length : 0;
      const regularPay=Number((salaryPerson?.dayPayments || []).reduce((sum, day)=>sum + Number(day.regularPay || 0), 0));
      const overtimePay=Number((salaryPerson?.dayPayments || []).reduce((sum, day)=>sum + Number(day.overtimePay || 0), 0));
      const latePenalty=Number(salaryPerson?.totalLatePenalty || 0);
      const earlyLeavePenalty=Number(salaryPerson?.totalEarlyLeavePenalty || 0);
      const penaltyReportDiscount=Number(salaryPerson?.penaltyReportDiscount || 0);
      const paymentAuditManagerDiscount=Number(salaryPerson?.paymentAuditManagerDiscount || 0);
      const totalDiscounts=latePenalty + earlyLeavePenalty + penaltyReportDiscount + paymentAuditManagerDiscount;
      const previousMonthOvertimePay=Number(salaryPerson?.previousMonthExtraPay || 0);
      const grossSalaryWorked=regularPay + overtimePay + previousMonthOvertimePay;
      const commissionsPay=Number(salaryPerson?.commissionsPay || 0);
      const grossMonthTotal=grossSalaryWorked + commissionsPay;
      const isManagerSalaryRole=(salaryPerson?.payrollRole || '')==='Jefe de Sede';
      const managerPunctualStaffDetail=(salaryPerson?.managerPunctualStaffList || [])
        .map((item, index)=>`${index + 1}. ${item.personName || 'Sin nombre'}${Number(item.share || 1)<0.999?` - ${item.workedDays || 0} dia(s) - ${(Number(item.share || 0)*100).toFixed(1)}%`:''}`)
        .join('<br>');
      const paymentBreakdownRows=salaryPerson ? [
        `<tr class="section-row"><td colspan="2">Pago 1 - Sueldo</td></tr>`,
        `<tr><td>Sueldo base mensual referencial</td><td>${money(salaryPerson.monthlySalary || 0)}</td></tr>`,
        `<tr class="plus-row"><td>Horas normales trabajadas</td><td>+ ${money(regularPay)}</td></tr>`,
        `<tr class="plus-row"><td>Pago por horas extra</td><td>+ ${money(overtimePay)}</td></tr>`,
        previousMonthOvertimePay>0 ? `<tr class="plus-row"><td>Horas extra del mes pasado (${minutesLabel(salaryPerson.previousMonthExtraMinutes)})</td><td>+ ${money(previousMonthOvertimePay)}</td></tr>` : '',
        `<tr class="subtotal-row"><td>Sueldo ganado antes de descuentos</td><td>${money(grossSalaryWorked)}</td></tr>`,
        `<tr class="section-row"><td colspan="2">Descuentos del pago sueldo</td></tr>`,
        `<tr class="minus-row"><td>Descuento por tardanzas</td><td>- ${money(latePenalty)}</td></tr>`,
        `<tr class="minus-row"><td>${earlyLeavePolicyLabel(salaryPerson?.salaryMonthKey || reportMonthKey())}</td><td>- ${money(earlyLeavePenalty)}</td></tr>`,
        `<tr class="minus-row"><td>Penalidades aprobadas</td><td>- ${money(penaltyReportDiscount)}</td></tr>`,
        paymentAuditManagerDiscount>0 ? `<tr class="minus-row"><td>Auditorías de Pagos aprobadas</td><td>- ${money(paymentAuditManagerDiscount)}</td></tr>` : '',
        `<tr class="subtotal-row"><td>Total descuentos aplicados al sueldo</td><td>- ${money(totalDiscounts)}</td></tr>`,
        `<tr class="total-row"><td>Total pago 1 - Sueldo neto</td><td>${money(salaryPerson.salaryPay || 0)}</td></tr>`,
        `<tr class="section-row"><td colspan="2">Pago 2 - Comisiones y bonos</td></tr>`,
        `<tr class="plus-row"><td>Registros validados (${salaryPerson.approvedRecords?.length || 0})</td><td>+ ${money(salaryPerson.recordCommission || 0)}</td></tr>`,
        `<tr class="plus-row"><td>Bono puntualidad</td><td>+ ${money(salaryPerson.bonusAmount || 0)}</td></tr>`,
        `<tr class="plus-row"><td>Bonos extra</td><td>+ ${money(salaryPerson.extraBonusAmount || 0)}</td></tr>`,
        `<tr class="plus-row"><td>Referidos aprobados (${salaryPerson.approvedReferrals?.length || 0})</td><td>+ ${money(salaryPerson.referralBonus || 0)}</td></tr>`,
        `<tr class="plus-row"><td>Tarjetas erroneas aprobadas (${salaryPerson.approvedWrongCards?.length || 0})</td><td>+ ${money(salaryPerson.wrongCardBonus || 0)}</td></tr>`,
        `<tr class="plus-row"><td>Llamadas aprobadas (${salaryPerson.approvedCalls?.length || 0})</td><td>+ ${money(salaryPerson.callBonus || 0)}</td></tr>`,
        `<tr class="plus-row"><td>Calificaciones aprobadas (${salaryPerson.approvedRatings?.length || 0})</td><td>+ ${money(salaryPerson.ratingBonus || 0)}</td></tr>`,
        salaryPerson.safetypaySharedBonus>0 ? `<tr class="plus-row"><td>Bono sede Safetypay compartido</td><td>+ ${money(salaryPerson.safetypaySharedBonus || 0)}</td></tr>` : '',
        isManagerSalaryRole ? `<tr class="plus-row"><td>Comision por operaciones aprobadas (${salaryPerson.approvedRecordValidations?.length || 0})</td><td>+ ${money(salaryPerson.recordValidationBonus || 0)}</td></tr>` : '',
        isManagerSalaryRole ? `<tr class="plus-row"><td>Comision por calificaciones aprobadas (${salaryPerson.approvedRatingDecisions?.length || 0})</td><td>+ ${money(salaryPerson.ratingDecisionBonus || 0)}</td></tr>` : '',
        isManagerSalaryRole ? `<tr class="plus-row"><td>Bono Safetypay jefe</td><td>+ ${money(salaryPerson.safetypayManagerBonus || 0)}</td></tr>` : '',
        isManagerSalaryRole ? `<tr class="plus-row"><td>Bono personal puntual (${salaryPerson.managerPunctualStaffCount || 0})</td><td>+ ${money(salaryPerson.managerPunctualStaffBonus || 0)}</td></tr>` : '',
        (isManagerSalaryRole && managerPunctualStaffDetail)
          ? `<tr><td>Personal que genera el bono puntual</td><td>${managerPunctualStaffDetail}</td></tr>`
          : '',
        `<tr class="total-row"><td>Total pago 2 - Comisiones</td><td>${money(commissionsPay)}</td></tr>`,
        `<tr class="section-row"><td colspan="2">Resumen financiero final</td></tr>`,
        `<tr><td>Total pago 1 - Sueldo neto</td><td>${money(salaryPerson.salaryPay || 0)}</td></tr>`,
        `<tr><td>Total pago 2 - Comisiones</td><td>${money(commissionsPay)}</td></tr>`,
        `<tr class="final-row"><td>Total general del mes</td><td>${money(salaryPerson.estimatedSalary || 0)}</td></tr>`
      ].filter(Boolean).join('') : '';
      w.document.write(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>Reporte integral - ${esc(selectedUser.name || 'Colaborador')}</title><style>:root{color-scheme:light}body{font-family:Arial,sans-serif;padding:24px;color:#14213d;background:linear-gradient(180deg,#eef4ff 0%,#f6f8fc 42%,#eef6f3 100%)}h1,h2,h3{margin:0}p{margin:0;color:#5f708a}.hero{background:radial-gradient(circle at top right,rgba(96,165,250,.35),transparent 30%),linear-gradient(135deg,#0f172a,#172554 48%,#0f766e 100%);color:#fff;border:1px solid rgba(255,255,255,.08);box-shadow:0 20px 45px rgba(15,23,42,.18);border-radius:24px;padding:26px 28px;margin-bottom:18px}.hero p{color:#dbe8ff}.hero-grid{display:grid;grid-template-columns:2fr 1fr;gap:16px;align-items:start}.meta{display:flex;gap:8px;flex-wrap:wrap;margin-top:14px}.chip{display:inline-flex;align-items:center;padding:7px 12px;border-radius:999px;background:rgba(255,255,255,.1);border:1px solid rgba(255,255,255,.18);font-size:12px;backdrop-filter:blur(8px)}.grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px;margin:18px 0}.card{background:linear-gradient(180deg,#ffffff,#f5f8ff);border:1px solid #d9e5f4;box-shadow:0 10px 30px rgba(37,99,235,.08);border-radius:18px;padding:16px}.card:nth-child(1){background:linear-gradient(180deg,#effcf5,#ffffff)}.card:nth-child(2){background:linear-gradient(180deg,#eff6ff,#ffffff)}.card:nth-child(3){background:linear-gradient(180deg,#f5f3ff,#ffffff)}.card:nth-child(4){background:linear-gradient(180deg,#fff7ed,#ffffff)}.label{font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:#64748b;margin-bottom:8px}.value{font-size:24px;font-weight:700;color:#0f172a}.sub{font-size:12px;color:#64748b;margin-top:6px;line-height:1.45}.section{margin-top:18px}.panel{background:linear-gradient(180deg,rgba(255,255,255,.96),rgba(246,250,255,.98));border:1px solid #dbe3f0;box-shadow:0 14px 34px rgba(15,23,42,.08);border-radius:20px;padding:16px;margin-bottom:16px}.panel h2{font-size:17px;color:#0f172a;margin-bottom:12px;padding-bottom:10px;border-bottom:1px solid #e4ebf5}.two-col{display:grid;grid-template-columns:1.15fr .85fr;gap:16px}.mini-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px}.mini{background:linear-gradient(180deg,#f8fbff,#eef6ff);border:1px solid #dce8f7;border-radius:16px;padding:14px}.mini strong{display:block;font-size:18px;color:#0f172a}.mini span{display:block;font-size:12px;color:#64748b;margin-bottom:6px}table{width:100%;border-collapse:separate;border-spacing:0;background:rgba(255,255,255,.96);border:1px solid #dbe3f0;border-radius:16px;overflow:hidden}th,td{border-bottom:1px solid #e4ebf5;padding:9px 10px;font-size:11px;text-align:left;vertical-align:top}tbody tr:nth-child(even) td{background:#f8fbff}tbody tr:last-child td{border-bottom:none}th{background:linear-gradient(180deg,#dbeafe,#eff6ff);color:#334155;font-size:10px;letter-spacing:.06em;text-transform:uppercase}.section-row td{background:linear-gradient(180deg,#dbeafe,#eff6ff) !important;color:#1e3a8a;font-size:10px;font-weight:800;letter-spacing:.08em;text-transform:uppercase}.plus-row td:last-child{color:#15803d;font-weight:700}.minus-row td:last-child{color:#b91c1c;font-weight:700}.subtotal-row td{background:#f8fafc !important;font-weight:700}.total-row td{background:#effcf5 !important;font-weight:800;color:#166534}.final-row td{background:linear-gradient(180deg,#dcfce7,#ecfdf5) !important;font-size:13px;font-weight:800;color:#166534}td:first-child,th:first-child{border-left:none}.empty{padding:18px;text-align:center;color:#64748b}.good{color:#15803d;font-weight:700}.bad{color:#b91c1c;font-weight:700}.note{font-size:11px;color:#64748b;margin-top:8px;padding:10px 12px;background:#f8fbff;border:1px solid #e2e8f0;border-radius:12px}@media print{body{background:#fff;padding:0}.hero,.panel,.card,table{break-inside:avoid}.grid{grid-template-columns:repeat(4,minmax(0,1fr))}.panel,.card{box-shadow:none}}</style></head><body><div class="hero"><div class="hero-grid"><div><p>Reporte integral del colaborador</p><h1>${esc(selectedUser.name || 'Colaborador')}</h1><div class="meta"><span class="chip">${selectedUser.role==='manager'?'Jefe de sede':'Atencion al cliente'}</span><span class="chip">Sede ${esc(userSede(selectedUser) || 'Sin sede')}</span><span class="chip">@${esc(selectedUser.username || '-')}</span></div></div><div><p>Generado por ${esc((generatedByUser?.name || state.currentUser.name || '-'))}</p><p>${new Date().toLocaleString()}</p><p style="margin-top:10px">Incluye asistencia, registros, calificaciones, bonos, descuentos y pagos del mes visible.</p></div></div></div><div class="grid"><div class="card"><div class="label">Pago 1</div><div class="value">${money(reportBundle.salaryPerson?.salaryPay || 0)}</div><div class="sub">Sueldo neto con horas extra y descuentos</div></div><div class="card"><div class="label">Pago 2</div><div class="value">${money(reportBundle.salaryPerson?.commissionsPay || totalCommission || 0)}</div><div class="sub">Comisiones, bonos e incentivos</div></div><div class="card"><div class="label">Total del mes</div><div class="value">${money(reportBundle.salaryPerson?.estimatedSalary || totalCommission || 0)}</div><div class="sub">${reportBundle.salaryPerson?.salaryPaid ? `Pagado ${fmtDateTime(reportBundle.salaryPerson.salaryPaidAt)}` : 'Pendiente de pago'}</div></div><div class="card"><div class="label">Horas extra / tardanzas</div><div class="value">${minutesLabel(reportBundle.salaryPerson?.totalExtraMinutes || 0)}</div><div class="sub">${Number(reportBundle.salaryPerson?.lateEntries || 0)} tardanza(s) - ${minutesLabel(reportBundle.salaryPerson?.totalLateMinutes || 0)} tarde</div></div></div><div class="section two-col"><div class="panel"><h2>Resumen laboral</h2><div class="mini-grid"><div class="mini"><span>Dias pagables</span><strong>${paidDays}</strong></div><div class="mini"><span>Registros</span><strong>${reportBundle.records.length}</strong></div><div class="mini"><span>Calificaciones</span><strong>${reportBundle.ratings.length}</strong></div><div class="mini"><span>Referidos</span><strong>${reportBundle.referrals.length}</strong></div><div class="mini"><span>Llamadas</span><strong>${reportBundle.calls.length}</strong></div><div class="mini"><span>Tarjetas erroneas</span><strong>${reportBundle.wrongCards.length}</strong></div></div></div><div class="panel"><h2>Pagos del mes (${paymentBreakdownRows ? 'detalle completo' : '0'})</h2><table><thead><tr><th>Concepto</th><th>Monto</th></tr></thead><tbody>${paymentBreakdownRows || '<tr><td colspan="2" class="empty">No hay informacion de sueldos cargada.</td></tr>'}</tbody></table><div class="note">Pago 1: sueldo con horas extra y descuentos. Pago 2: comisiones, bonos y variables del mes.</div></div></div><div class="section panel"><h2>Asistencia del mes (${(salaryPerson?.dayPayments || []).length})</h2><table><thead><tr><th>Fecha</th><th>Entrada</th><th>Salida</th><th>Estado</th><th>Tardanza</th><th>Horas extra</th><th>Pago normal</th><th>Pago extra</th><th>Pago dia</th></tr></thead><tbody>${attendanceRows || '<tr><td colspan="9" class="empty">Sin asistencias cargadas para este colaborador.</td></tr>'}</tbody></table></div><div class="section panel"><h2>Registros del colaborador (${reportBundle.records.length})</h2><table><thead><tr><th>Cliente</th><th>DNI</th><th>Tipo</th><th>Modalidad</th><th>Plataforma</th><th>Fecha registro</th><th>Fecha operacion</th><th>Estado</th><th>Motivo</th><th>Comision</th></tr></thead><tbody>${recordRows || '<tr><td colspan="10" class="empty">Sin registros visibles.</td></tr>'}</tbody></table></div><div class="section two-col"><div class="panel"><h2>Calificaciones (${reportBundle.ratings.length})</h2><table><thead><tr><th>Fecha</th><th>DNI</th><th>Rating</th><th>Comentario</th><th>Estado</th><th>Monto</th></tr></thead><tbody>${ratingRows || '<tr><td colspan="6" class="empty">Sin calificaciones para este colaborador.</td></tr>'}</tbody></table></div><div class="panel"><h2>Referidos (${reportBundle.referrals.length})</h2><table><thead><tr><th>Cliente</th><th>DNI</th><th>Fecha</th><th>Banco</th><th>Monto</th><th>Estado</th><th>Comision</th></tr></thead><tbody>${referralRows || '<tr><td colspan="7" class="empty">Sin referidos registrados.</td></tr>'}</tbody></table></div></div><div class="section two-col"><div class="panel"><h2>Tarjetas erroneas (${reportBundle.wrongCards.length})</h2><table><thead><tr><th>Cliente</th><th>DNI</th><th>Fecha</th><th>Estado</th><th>Motivo</th><th>Bono</th></tr></thead><tbody>${wrongCardRows || '<tr><td colspan="6" class="empty">Sin tarjetas erroneas registradas.</td></tr>'}</tbody></table></div><div class="panel"><h2>Llamadas (${reportBundle.calls.length})</h2><table><thead><tr><th>Cliente</th><th>DNI</th><th>Fecha</th><th>Estado</th><th>Motivo</th><th>Bono</th></tr></thead><tbody>${callRows || '<tr><td colspan="6" class="empty">Sin llamadas registradas.</td></tr>'}</tbody></table></div></div><div class="section panel"><h2>Penalidades y descuentos aprobados (${reportBundle.penalties.length})</h2><table><thead><tr><th>Penalidad</th><th>Cliente</th><th>Fecha</th><th>Estado</th><th>Motivo</th><th>Descuento</th></tr></thead><tbody>${penaltyRows || '<tr><td colspan="6" class="empty">Sin penalidades registradas.</td></tr>'}</tbody></table></div><script>window.onload=()=>window.print();<\/script></body></html>`);
  w.document.close();
  return true;
}

function exportSalaryReceiptPdf(person){
  if(!person) return;
  const month=person.salaryMonthKey || salaryViewMonthKey();
  const reportPerson=salaryPersonToReportPerson(person);
  const reportBundle=getReportPersonBundle(reportPerson,month);
  // The paid salary already shown on screen is the authoritative receipt.
  // Never replace it with a recalculation from the Reports default period.
  if(!reportBundle){appAlert('No se pudieron preparar los datos de la boleta. Vuelve a intentarlo.','Error');return;}
  reportBundle.salaryPerson=person;
  reportBundle.month=month;
  if(!exportIndividualReportPdf(reportBundle, reportPerson, state.currentUser)){
    appAlert('No se pudo generar la boleta con formato de reporte. Actualiza la pagina e intenta otra vez.', 'Error');
  }
}
function salaryPersonToReportPerson(person){
  const linkedUser=userForAttendancePerson(person);
  return {
    id:'person:' + person.personId,
    personId:person.personId,
    name:person.personName,
    role:linkedUser?.role || (person.payrollRole==='Jefe de Sede' ? 'manager' : 'employee'),
    sede:getPersonSede(person) || userSede(linkedUser) || '',
    department:person.department || '',
    linkedUserId:linkedUser?.id || null
  };
}
function buildSalaryDetailedExportSections(people, month, options={}){
  const isExcel=!!options.excel;
  const moneyValue=value=>isExcel ? Number(value || 0).toFixed(2) : money(value || 0);
  return (people || []).map(person=>{
    const reportPerson=salaryPersonToReportPerson(person);
    const bundle=getReportPersonBundle(reportPerson, month) || {};
    const salaryPerson=bundle.salaryPerson || person;
    const paidDays=(salaryPerson.dayPayments || []).filter(day=>Number(day.dailyPay || 0)>0).length;
    const regularPay=(salaryPerson.dayPayments || []).reduce((sum, day)=>sum + Number(day.regularPay || 0), 0);
    const overtimePay=(salaryPerson.dayPayments || []).reduce((sum, day)=>sum + Number(day.overtimePay || 0), 0);
    const discounts=Number(salaryPerson.totalDiscounts || 0);
    const paymentRows=[
      { label:'Pago 1 - Sueldo', cls:'section-row', section:true },
      { label:'Sueldo base mensual', amount:salaryPerson.monthlySalary, cls:'neutral-row' },
      { label:'Horas normales trabajadas', amount:regularPay, cls:'plus-row', prefix:'+' },
      { label:'Horas extra', amount:overtimePay, cls:'plus-row', prefix:'+' },
      { label:`Horas extra del mes pasado (${minutesLabel(salaryPerson.previousMonthExtraMinutes||0)})`, amount:salaryPerson.previousMonthExtraPay, cls:'plus-row', prefix:'+' },
      { label:'Descuentos totales', amount:discounts, cls:'minus-row', prefix:'-' },
      { label:'Pago 1 - Sueldo neto', amount:salaryPerson.salaryPay, cls:'total-row' },
      { label:'Pago 2 - Comisiones y bonos', cls:'section-row', section:true },
      { label:'Registros validados', amount:salaryPerson.recordCommission, cls:'plus-row', prefix:'+' },
      { label:'Bono puntualidad', amount:salaryPerson.bonusAmount, cls:'plus-row', prefix:'+' },
      { label:'Bonos extra', amount:salaryPerson.extraBonusAmount, cls:'plus-row', prefix:'+' },
      { label:`Referidos aprobados (${salaryPerson.approvedReferrals?.length || 0})`, amount:salaryPerson.referralBonus, cls:'plus-row', prefix:'+' },
      { label:`Tarjetas erroneas aprobadas (${salaryPerson.approvedWrongCards?.length || 0})`, amount:salaryPerson.wrongCardBonus, cls:'plus-row', prefix:'+' },
      { label:`Llamadas aprobadas (${salaryPerson.approvedCalls?.length || 0})`, amount:salaryPerson.callBonus, cls:'plus-row', prefix:'+' },
      { label:`Calificaciones aprobadas (${salaryPerson.approvedRatings?.length || 0})`, amount:salaryPerson.ratingBonus, cls:'plus-row', prefix:'+' },
      { label:'Bono sede Safetypay compartido', amount:salaryPerson.safetypaySharedBonus, cls:'plus-row', prefix:'+' },
      { label:'Bono Safetypay jefe', amount:salaryPerson.safetypayManagerBonus, cls:'plus-row', prefix:'+' },
      { label:`Comision por operaciones aprobadas (${salaryPerson.approvedRecordValidations?.length || 0})`, amount:salaryPerson.recordValidationBonus, cls:'plus-row', prefix:'+' },
      { label:`Bono personal puntual (${salaryPerson.managerPunctualStaffCount || 0})`, amount:salaryPerson.managerPunctualStaffBonus, cls:'plus-row', prefix:'+' },
      { label:'Pago 2 - Comisiones', amount:salaryPerson.commissionsPay, cls:'total-row' },
      { label:'Resumen final', cls:'section-row', section:true },
      { label:'Total general', amount:salaryPerson.estimatedSalary, cls:'final-row' }
    ].filter(row=>row.section || row.label.includes('Pago') || row.label==='Total general' || Number(row.amount || 0)!==0)
      .map(row=>row.section
        ? `<tr class="${row.cls}"><td colspan="2">${esc(row.label)}</td></tr>`
        : `<tr class="${row.cls}"><td>${esc(row.label)}</td><td>${row.prefix ? row.prefix + ' ' : ''}${moneyValue(row.amount)}</td></tr>`)
      .join('');
    const attendanceRows=(salaryPerson.dayPayments || []).slice().sort((a,b)=>String(a.date||'').localeCompare(String(b.date||''))).map(day=>`<tr><td>${fmt(day.date)}</td><td>${shortTime(day.entryTime)}</td><td>${shortTime(day.exitTime)}</td><td>${attendanceStatusMeta(day).label}</td><td>${minutesLabel(day.lateMinutes||0)}</td><td>${minutesLabel(day.overtimeMinutes||0)}</td><td>${moneyValue(day.dailyPay||0)}</td></tr>`).join('');
    const recordRows=(bundle.records || []).slice().sort((a,b)=>String(b.createdAt || b.fechaOperacion || b.fecha || '').localeCompare(String(a.createdAt || a.fechaOperacion || a.fecha || ''))).map(record=>`<tr><td>${esc(record.cliente || '-')}</td><td>${esc(record.dni || '-')}</td><td>${record.tipo==='operacion'?'Operacion':'Registro'}</td><td>${fmt(record.fecha)}</td><td>${fmt(record.fechaOperacion)}</td><td>${validationText(record).label}</td><td>${record.validatedAt ? moneyValue(getCommissionRate()) : moneyValue(0)}</td></tr>`).join('');
    const ratingRows=(bundle.ratings || []).slice().sort((a,b)=>String(b.date || b.rawDate || '').localeCompare(String(a.date || a.rawDate || ''))).map(row=>`<tr><td>${fmtDateTime(row.date || row.rawDate)}</td><td>${esc(row.dni || '-')}</td><td>${row.rating || '-'}</td><td>${esc(row.comment || '-')}</td><td>${reportRatingStatusLabel(row)}</td><td>${row.payable ? moneyValue(row.amount || 0) : moneyValue(0)}</td></tr>`).join('');
    const referralRows=(bundle.referrals || []).slice().sort((a,b)=>String(b.createdAt || '').localeCompare(String(a.createdAt || ''))).map(item=>`<tr><td>${esc(item.cliente || '-')}</td><td>${esc(item.dni || '-')}</td><td>${fmtDateTime(item.createdAt)}</td><td>${reportReferralStatusLabel(item)}</td><td>${item.validatedAt ? moneyValue(item.referralCommission || 0) : moneyValue(0)}</td></tr>`).join('');
    const wrongRows=(bundle.wrongCards || []).slice().sort((a,b)=>String(b.createdAt || '').localeCompare(String(a.createdAt || ''))).map(item=>`<tr><td>${esc(item.cliente || '-')}</td><td>${esc(item.dni || '-')}</td><td>${fmt(item.detectedDate)}</td><td>${reportDecisionStatusLabel(item)}</td><td>${(item.status==='APPROVED' || item.validatedAt) ? moneyValue(item.bonusAmount || 0) : moneyValue(0)}</td></tr>`).join('');
    const callRows=(bundle.calls || []).slice().sort((a,b)=>String(b.createdAt || '').localeCompare(String(a.createdAt || ''))).map(item=>`<tr><td>${esc(item.cliente || '-')}</td><td>${esc(item.dni || '-')}</td><td>${fmtDateTime(item.createdAt)}</td><td>${reportDecisionStatusLabel(item)}</td><td>${(item.status==='APPROVED' || item.validatedAt) ? moneyValue(item.bonusAmount || 0) : moneyValue(0)}</td></tr>`).join('');
    const penaltyRows=(bundle.penalties || []).slice().sort((a,b)=>String(b.decidedAt || b.createdAt || '').localeCompare(String(a.decidedAt || a.createdAt || ''))).map(item=>`<tr class="${item.status==='APPROVED'?'minus-row':''}"><td>${esc(item.penaltyLabel || 'Penalidad')}</td><td>${esc(item.clientName || '-')}</td><td>${fmtDateTime(item.decidedAt || item.createdAt)}</td><td>${item.status==='APPROVED'?'Aprobada':item.status==='REJECTED'?'Rechazada':'Pendiente'}</td><td>${item.status==='APPROVED' ? '-' + moneyValue(item.penaltyAmount || 0) : moneyValue(0)}</td></tr>`).join('');
    return `<section class="employee-report">
      <div class="employee-hero"><div><p>Reporte integral del colaborador</p><h2>${esc(reportPerson.name || 'Colaborador')}</h2><span>${esc(reportPerson.sede || 'Sin sede')} - ${esc(person.payrollRole || 'Sin cargo')}</span></div><strong>${moneyValue(salaryPerson.estimatedSalary || 0)}</strong></div>
      <div class="mini-grid"><div><span>Dias pagables</span><strong>${paidDays}</strong></div><div><span>Registros</span><strong>${(bundle.records||[]).length}</strong></div><div><span>Calificaciones</span><strong>${(bundle.ratings||[]).length}</strong></div><div><span>Horas extra</span><strong>${minutesLabel(salaryPerson.totalExtraMinutes||0)}</strong></div></div>
      <h3>Pagos</h3><table><thead><tr><th>Concepto</th><th>Monto</th></tr></thead><tbody>${paymentRows || '<tr><td colspan="2">Sin pagos.</td></tr>'}</tbody></table>
      <h3>Asistencia</h3><table><thead><tr><th>Fecha</th><th>Entrada</th><th>Salida</th><th>Estado</th><th>Tardanza</th><th>Extra</th><th>Pago dia</th></tr></thead><tbody>${attendanceRows || '<tr><td colspan="7">Sin asistencia.</td></tr>'}</tbody></table>
      <h3>Registros</h3><table><thead><tr><th>Cliente</th><th>DNI</th><th>Tipo</th><th>Registro</th><th>Operacion</th><th>Estado</th><th>Comision</th></tr></thead><tbody>${recordRows || '<tr><td colspan="7">Sin registros.</td></tr>'}</tbody></table>
      <h3>Calificaciones</h3><table><thead><tr><th>Fecha</th><th>DNI</th><th>Rating</th><th>Comentario</th><th>Estado</th><th>Monto</th></tr></thead><tbody>${ratingRows || '<tr><td colspan="6">Sin calificaciones.</td></tr>'}</tbody></table>
      <h3>Referidos</h3><table><thead><tr><th>Cliente</th><th>DNI</th><th>Fecha</th><th>Estado</th><th>Comision</th></tr></thead><tbody>${referralRows || '<tr><td colspan="5">Sin referidos.</td></tr>'}</tbody></table>
      <h3>Tarjetas erroneas</h3><table><thead><tr><th>Cliente</th><th>DNI</th><th>Fecha</th><th>Estado</th><th>Bono</th></tr></thead><tbody>${wrongRows || '<tr><td colspan="5">Sin tarjetas erroneas.</td></tr>'}</tbody></table>
      <h3>Llamadas</h3><table><thead><tr><th>Cliente</th><th>DNI</th><th>Fecha</th><th>Estado</th><th>Bono</th></tr></thead><tbody>${callRows || '<tr><td colspan="5">Sin llamadas.</td></tr>'}</tbody></table>
      <h3>Penalidades</h3><table><thead><tr><th>Penalidad</th><th>Cliente</th><th>Fecha</th><th>Estado</th><th>Descuento</th></tr></thead><tbody>${penaltyRows || '<tr><td colspan="5">Sin penalidades.</td></tr>'}</tbody></table>
    </section>`;
  }).join('');
}
function attendanceBadgeClass(kind){
  if(kind==='good') return 'ok';
  if(kind==='warn') return 'warn';
  if(kind==='danger') return 'danger';
  return 'done';
}
function attendanceStatusMeta(day){
  if(day.absence) return {cls:'expired',label:'Sin marcaje'};
  if(day.calendarException){
    const rule=day.calendarException;
    return {cls:rule.kind==='SPECIAL_SHIFT'?'web':'ok',label:(rule.kind==='PAID_REST'?'Descanso pagado':rule.kind==='UNPAID_REST'?'Descanso sin pago':'Jornada especial')+' · '+rule.reason};
  }
  if(day.holiday || peruNationalHoliday(day.date)) return { cls:'ok', label:'Feriado nacional' };
  if(day.justifiedDay) return { cls:'ok', label:'Dia justificado' };
  if(day.autoMonthEndExit) return { cls:'done', label:'Completo - cierre mes' };
  if(day.entryTime && day.exitTime) return { cls:'done', label:'Completo' };
  if(day.entryTime && !day.exitTime) return { cls:'warn', label:'Falta salida' };
  if(!day.entryTime && day.exitTime) return { cls:'danger', label:'Falta entrada' };
  return { cls:'expired', label:'Sin marcaje' };
}
function getAttendanceRows(source=ATTENDANCE){
  if(!source?.people?.length) return [];
  let rows=source.people.filter(person=>!isInactiveCollaborator(person) && (state.view!=='asistencia' || !state.attendanceSede || getPersonSede(person)===state.attendanceSede)).flatMap(person=>
    person.days.map(day=>{
      const normalizedDay=recomputeDisplayedAttendanceDay(day, person);
      return {
      ...normalizedDay,
      personId:person.personId,
      personName:person.personName,
      department:person.department,
      totalDays:person.totalDays,
      lateEntries:person.lateEntries,
      missingExits:person.missingExits
    };
    })
  );
  if(state.attendanceSearch){
    const q=state.attendanceSearch.toLowerCase();
    rows=rows.filter(row=>
      row.personName.toLowerCase().includes(q) ||
      row.personId.toLowerCase().includes(q)
    );
  }
  if(state.attendanceDate){
    rows=rows.filter(row=>row.date===state.attendanceDate);
  }
  if(state.attendancePerson){
    rows=rows.filter(row=>row.personId===state.attendancePerson);
  }
  if(state.attendanceDepartment){
    rows=rows.filter(row=>matchesAttendanceDepartment(row, state.attendanceDepartment));
  }
  rows.sort((a,b)=>`${b.date} ${b.entryTime||b.exitTime||''}`.localeCompare(`${a.date} ${a.entryTime||a.exitTime||''}`) || a.personName.localeCompare(b.personName));
  return rows;
}
function attendanceSummaryFromRows(rows){
  const peopleIds=new Set(rows.map(row=>row.personId).filter(Boolean));
  return rows.reduce((summary,row)=>{
    const isNonWorkingDay=isCalendarRest(row) || !!row.justifiedDay || !!(row.holiday || peruNationalHoliday(row.date));
    summary.totalDays+=1;
    if(row.entryTime && row.exitTime) summary.completeDays+=1;
    if(Number(row.lateMinutes || 0)>0) summary.lateEntries+=1;
    if(!isNonWorkingDay && !row.entryTime && row.exitTime) summary.missingEntries+=1;
    if(!isNonWorkingDay && row.entryTime && !row.exitTime) summary.missingExits+=1;
    return summary;
  }, {
    totalPeople:peopleIds.size,
    totalDays:0,
    completeDays:0,
    lateEntries:0,
    missingEntries:0,
    missingExits:0
  });
}
function getAttendancePeople(source=ATTENDANCE){
  if(!source?.people?.length) return [];
  const people=source.people.filter(person=>!isInactiveCollaborator(person) && (state.view!=='asistencia' || !state.attendanceSede || getPersonSede(person)===state.attendanceSede));
  const filtered = state.attendanceDepartment
    ? people.filter(person=>matchesAttendanceDepartment(person, state.attendanceDepartment))
    : people;
  filtered.sort((a,b)=>String(a.personName||'').trim().localeCompare(String(b.personName||'').trim(), 'es', { sensitivity:'base' }));
  return filtered;
}
function getAttendanceDepartments(source=ATTENDANCE){
  if(!source?.people?.length) return [];
  const detected=new Set(source.people.map(person=>collaboratorAreaForPerson(person)).filter(Boolean));
  return COLLABORATOR_AREA_OPTIONS.filter(area=>detected.has(area));
}
function csvEscape(value){
  const text=String(value ?? '');
  return /[",\n]/.test(text) ? `"${text.replace(/"/g,'""')}"` : text;
}
function compactPersonCell(name,id){
  return `<div style="min-width:180px;max-width:220px" title="${name}">
    <div style="font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${name}</div>
    <div style="font-size:11px;color:var(--text3);margin-top:3px">${id}</div>
  </div>`;
}
function renderBankAccountRows(person){
  const accounts=getBankAccounts(person);
  const rows=[0,1,2].map(index=>accounts[index] || {});
  return `<div class="bank-account-box">
    <div class="bank-account-title">Cuentas para deposito</div>
    ${rows.map((account,index)=>`<div class="bank-account-row">
      <select class="filter-select" data-bank-account-bank="${person.personId}" data-bank-index="${index}">
        <option value="">Banco</option>
        ${BANK_ACCOUNT_OPTIONS.map(bank=>`<option value="${bank}"${account.bank===bank?' selected':''}>${bank}</option>`).join('')}
      </select>
      <select class="filter-select" data-bank-account-type="${person.personId}" data-bank-index="${index}">
        ${['Cuenta','CCI'].map(type=>`<option value="${type}"${(account.type||'Cuenta')===type?' selected':''}>${type}</option>`).join('')}
      </select>
      <input class="search-input" data-bank-account-number="${person.personId}" data-bank-index="${index}" placeholder="${index===0?'Numero de cuenta':'Otra cuenta'}" value="${esc(account.number || '')}"/>
    </div>`).join('')}
    <div class="bank-account-hint">Puedes dejar filas vacias. Se guardan solo las cuentas con banco y numero.</div>
  </div>`;
}
function collaboratorHistoryRows(person){
  const personId=String(person?.personId || '').trim();
  if(!personId) return [];
  const hireDate=hireDateForPerson(person);
  const hireMonth=monthKeyFromDate(hireDate);
  const months=[...new Set([
    ...getDataMonthKeys([...(ATTENDANCE?.availableDates || []), ...MONTHLY_CLOSURES.map(item=>item.month)]),
    ...(/^\d{4}-\d{2}$/.test(hireMonth) ? monthKeysFromRange(hireMonth, salaryMonthKey()) : [])
  ])]
    .filter(month=>!/^\d{4}-\d{2}$/.test(hireMonth) || month>=hireMonth)
    .sort((a,b)=>b.localeCompare(a));
  return months.map(month=>{
    const salaryData=getSalaryPeople({ ignoreFilters:true, date:monthDateFromKey(month) }) || {};
    const monthPerson=(salaryData.people || []).find(item=>String(item.personId || '').trim()===personId);
    if(!monthPerson) return null;
    const dayPayments=monthPerson.dayPayments || [];
    const workedDays=Number(monthPerson.workedDays || dayPayments.filter(day=>Number(day.dailyPay || 0)>0 || attendanceDayWorked(day)).length);
    const missingDays=Number(monthPerson.missingDays || 0);
    const completeDays=dayPayments.filter(day=>day.entryTime && day.exitTime).length;
    const lateEntries=Number(monthPerson.lateEntries || 0);
    const lateMinutes=Number(monthPerson.totalLateMinutes || 0);
    const extraMinutes=Number(monthPerson.totalExtraMinutes || 0);
    const salaryPay=Number(monthPerson.salaryPay || 0);
    const commissionsPay=Number(monthPerson.commissionsPay || 0);
    return {
      month,
      closed:!!monthPerson.closedSnapshot || isClosedMonth(month),
      workedDays,
      expectedWorkdays:Number(monthPerson.expectedWorkdays || salaryData.workdays || workedDays || 0),
      missingDays,
      completeDays,
      lateEntries,
      lateMinutes,
      extraMinutes,
      salaryPay,
      commissionsPay,
      totalPay:Number(monthPerson.estimatedSalary || salaryPay + commissionsPay)
    };
  }).filter(Boolean);
}
function renderCollaboratorHistoryContent(person){
  const rows=collaboratorHistoryRows(person);
  const hireDate=hireDateForPerson(person);
  const totals=rows.reduce((acc,row)=>{
    acc.workedDays+=Number(row.workedDays||0);
    acc.missingDays+=Number(row.missingDays||0);
    acc.lateEntries+=Number(row.lateEntries||0);
    acc.lateMinutes+=Number(row.lateMinutes||0);
    acc.extraMinutes+=Number(row.extraMinutes||0);
    acc.totalPay+=Number(row.totalPay||0);
    return acc;
  }, { workedDays:0, missingDays:0, lateEntries:0, lateMinutes:0, extraMinutes:0, totalPay:0 });
  return `<div class="collaborator-footer-note" style="margin:-4px 0 10px">Ingreso a empresa: ${hireDate ? fmt(hireDate) : 'sin fecha registrada'}. Antes de junio 2026 se considera asistencia completa desde su ingreso.</div>
    <div class="collaborator-edit-grid collaborator-history-summary" style="margin-bottom:12px">
      <div class="collaborator-summary-item"><span>Dias trabajados</span><strong>${totals.workedDays}</strong></div>
      <div class="collaborator-summary-item"><span>Dias no trabajados</span><strong>${totals.missingDays}</strong></div>
      <div class="collaborator-summary-item"><span>Tardanzas</span><strong>${totals.lateEntries}</strong></div>
      <div class="collaborator-summary-item"><span>Minutos tarde</span><strong>${minutesLabel(totals.lateMinutes)}</strong></div>
      <div class="collaborator-summary-item"><span>Horas extra</span><strong>${minutesLabel(totals.extraMinutes)}</strong></div>
      <div class="collaborator-summary-item"><span>Total historico</span><strong>${money(totals.totalPay)}</strong></div>
    </div>
    <div class="table-wrap collaborator-history-table" style="margin:0">
      <table><thead><tr><th>Mes</th><th>Trab.</th><th>No trab.</th><th>Completos</th><th>Tard.</th><th>Min tarde</th><th>Extra</th><th>Sueldo</th><th>Comisiones</th><th>Total</th><th>Estado</th></tr></thead><tbody>
        ${rows.map(row=>`<tr>
          <td>${monthLabelFromKey(row.month)}</td>
          <td>${row.workedDays}</td>
          <td style="color:${row.missingDays>0?'var(--red)':'var(--text2)'};font-weight:700">${row.missingDays}</td>
          <td>${row.completeDays}</td>
          <td style="color:${row.lateEntries>0?'var(--amber)':'var(--text2)'};font-weight:700">${row.lateEntries}</td>
          <td>${minutesLabel(row.lateMinutes)}</td>
          <td style="color:${row.extraMinutes>0?'var(--green)':'var(--text2)'};font-weight:700">${minutesLabel(row.extraMinutes)}</td>
          <td>${money(row.salaryPay)}</td>
          <td>${money(row.commissionsPay)}</td>
          <td style="color:var(--green);font-weight:800">${money(row.totalPay)}</td>
          <td><span class="days-chip ${row.closed?'ok':'warn'}">${row.closed?'Cerrado':'Abierto'}</span></td>
        </tr>`).join('') || '<tr><td colspan="11"><div class="empty-state"><p>Sin historial para este colaborador.</p></div></td></tr>'}
      </tbody></table>
    </div>`;
}
function renderCollaboratorHistory(person){
  const hireDate=hireDateForPerson(person);
  return `<div class="bank-account-box" style="margin-top:14px">
    <div class="collaborator-section-title"><span></span>Historico por persona</div>
    <div id="collaboratorHistoryBox" data-history-person="${person.personId}">
      <div class="collaborator-footer-note" style="margin:-4px 0 10px">Ingreso a empresa: ${hireDate ? fmt(hireDate) : 'sin fecha registrada'}. El historico se calcula cuando lo necesitas para que editar abra rapido.</div>
      <button class="btn-sm" type="button" data-collaborator-history-load="${person.personId}">Cargar historico</button>
    </div>
  </div>`;
}
function employmentTypeLabelForValue(value){
  return EMPLOYMENT_TYPE_OPTIONS.find(option=>option.value===value)?.label || 'Sin definir';
}
function partTimeModeLabelForValue(value){
  return PART_TIME_MODE_OPTIONS.find(option=>option.value===value)?.label || 'Sin definir';
}
function collectBankAccounts(personId){
  const accounts=[];
  [0,1,2].forEach(index=>{
    const bank=document.querySelector(`[data-bank-account-bank="${personId}"][data-bank-index="${index}"]`)?.value || '';
    const type=document.querySelector(`[data-bank-account-type="${personId}"][data-bank-index="${index}"]`)?.value || 'Cuenta';
    const number=document.querySelector(`[data-bank-account-number="${personId}"][data-bank-index="${index}"]`)?.value.trim() || '';
    if(bank && number){
      accounts.push({ bank, type, number });
    }
  });
  return accounts;
}
function paginateRows(key, rows, size=PAGE_SIZE){
  if(!state.pages) state.pages={};
  const total=rows.length;
  const totalPages=Math.max(1, Math.ceil(total / size));
  const current=Math.min(Math.max(1, Number(state.pages[key] || 1)), totalPages);
  state.pages[key]=current;
  const start=(current-1)*size;
  return { key, rows:rows.slice(start, start+size), total, totalPages, current, start, size, end:Math.min(total, start+size) };
}
function renderPagination(page){
  if(!page || page.totalPages<=1) return '';
  const pages=[];
  const min=Math.max(1, page.current-2);
  const max=Math.min(page.totalPages, page.current+2);
  if(min>1) pages.push(1);
  if(min>2) pages.push('...');
  for(let i=min;i<=max;i++) pages.push(i);
  if(max<page.totalPages-1) pages.push('...');
  if(max<page.totalPages) pages.push(page.totalPages);
  return `<div class="pager">
    <div class="pager-info">Mostrando ${page.start+1}-${page.end} de ${page.total}</div>
    <div class="pager-actions">
      <button class="pager-btn" data-page-key="${page.key}" data-page="${page.current-1}" ${page.current<=1?'disabled':''}>Anterior</button>
      ${pages.map(item=>item==='...'?`<span class="pager-dots">...</span>`:`<button class="pager-btn${item===page.current?' active':''}" data-page-key="${page.key}" data-page="${item}">${item}</button>`).join('')}
      <button class="pager-btn" data-page-key="${page.key}" data-page="${page.current+1}" ${page.current>=page.totalPages?'disabled':''}>Siguiente</button>
    </div>
  </div>`;
}
function resetPageKeys(...keys){
  if(!state.pages) state.pages={};
  keys.forEach(key=>{ state.pages[key]=1; });
}

function renderAtkLogo(mode='compact'){
  return `<div class="brand-shell ${mode}">
    <div class="brand-shine"></div>
    <div class="brand-content">
      <div class="brand-atk"><span class="gold">A</span>TK</div>
      <div class="brand-subtitle">ALTOQUE PERU <span>WK</span></div>
    </div>
  </div>`;
}

function preserveMainScroll(callback){
  const main=document.querySelector('.main');
  const scrollTop=main ? main.scrollTop : 0;
  const rootScrollTop=document.documentElement.scrollTop || document.body.scrollTop || 0;
  callback();
  const restore=()=>{
    const nextMain=document.querySelector('.main');
    if(nextMain) nextMain.scrollTop=scrollTop;
    document.documentElement.scrollTop=rootScrollTop;
    document.body.scrollTop=rootScrollTop;
  };
  requestAnimationFrame(()=>{
    restore();
    setTimeout(restore, 0);
  });
}

function renderPreservingField(fieldId){
  const active=document.getElementById(fieldId);
  const selectionStart=active && typeof active.selectionStart==='number' ? active.selectionStart : null;
  const selectionEnd=active && typeof active.selectionEnd==='number' ? active.selectionEnd : null;
  const main=document.querySelector('.main');
  const scrollTop=main ? main.scrollTop : 0;
  const rootScrollTop=document.documentElement.scrollTop || document.body.scrollTop || 0;
  preserveMainScroll(()=>render());
  requestAnimationFrame(()=>{
    const next=document.getElementById(fieldId);
    if(!next) return;
    try{
      next.focus({ preventScroll:true });
    }catch(error){
      next.focus();
    }
    if(selectionStart!==null && typeof next.setSelectionRange==='function'){
      next.setSelectionRange(selectionStart, selectionEnd ?? selectionStart);
    }
    const nextMain=document.querySelector('.main');
    if(nextMain) nextMain.scrollTop=scrollTop;
    document.documentElement.scrollTop=rootScrollTop;
    document.body.scrollTop=rootScrollTop;
  });
}

function captureViewPresentation(){
  const main=document.querySelector('.main');
  if(!main || main.dataset.view!==state.view) return null;
  const disclosureKey=(node,index)=>node.id || [node.closest('.worker-card')?.querySelector('.worker-name,.worker-identity')?.textContent?.trim()||'',node.querySelector(':scope > summary')?.textContent?.trim().replace(/\s+/g,' ')||'',node.closest('tr')?.textContent?.trim()||''].join('|');
  const disclosure=[...document.querySelectorAll('details')].map((node,index)=>({key:disclosureKey(node,index),open:node.open}));
  const selectors=['.main','.nav','.ui-table-scroll','.fx-scroll','.fx-stats-table-scroll','.modal','.fx-salary-detail'];
  const scroll=selectors.flatMap(selector=>[...document.querySelectorAll(selector)].map((node,index)=>({selector,index,top:node.scrollTop,left:node.scrollLeft})));
  return {view:state.view,disclosure,scroll,disclosureKey,rootTop:document.documentElement.scrollTop||document.body.scrollTop||0};
}
function restoreViewPresentation(saved){
  if(!saved || saved.view!==state.view) return;
  const disclosures=new Map(saved.disclosure.map(item=>[item.key,item.open]));
  document.querySelectorAll('details').forEach((node,index)=>{const key=saved.disclosureKey(node,index);if(disclosures.has(key))node.open=disclosures.get(key);});
  saved.scroll.forEach(item=>{const node=document.querySelectorAll(item.selector)[item.index];if(node){node.scrollTop=item.top;node.scrollLeft=item.left;}});
  document.documentElement.scrollTop=saved.rootTop;document.body.scrollTop=saved.rootTop;
}
// RENDER
function render(){
  const presentation=captureViewPresentation();
  const R=document.getElementById('root');
  const navScrollTop=document.querySelector('.nav')?.scrollTop || 0;
  const hasOpenModal=state.modal!==null || state.attendanceEdit || state.ratingEdit || state.safetypayEdit || state.collaboratorEditId || (state.salaryDetailId && (state.view!=='sueldos' || state.fxSalaryFull)) || state.newModal || state.dashboardUserId;
  document.body.classList.toggle('modal-open', !!hasOpenModal);
  if(state.currentUser && state.view!=='login' && state.view!=='force-password') startAutoRefresh();
  else stopAutoRefresh();
  if(BOOTING){ R.innerHTML='<div class="login-wrap"><div class="login-card"><div class="section-spinner" role="status" aria-label="Cargando"></div><div class="page-title">Cargando...</div><div class="page-sub" style="margin-top:8px">Preparando el sistema compartido</div></div></div>'; return; }
  if(state.view==='login'){ R.innerHTML=renderLogin(); bindLogin(); return; }
  if(state.view==='system-choice'){ R.innerHTML=renderSystemChoice(); bindSystemChoice(); return; }
  if(state.view==='force-password'){ R.innerHTML=renderForcePassword(); bindForcePassword(); return; }
  try{
    R.innerHTML=renderApp();
    rememberTabView();
  }catch(error){
    window.__lastRenderError = error?.message || String(error);
    R.innerHTML=`<div class="app">${renderSidebar()}<main class="main"><div class="alert-banner"><div class="ab-icon">!</div><div class="ab-text"><strong>No se pudo abrir esta seccion.</strong> ${esc(window.__lastRenderError)}</div></div></main></div>`;
  }
  bindApp();
  if(typeof decorateRedesign==='function'){ try{ decorateRedesign(); }catch(error){ console.warn('No se pudo completar la presentación visual.',error?.message||''); } }
  if(state.modal!==null){ document.getElementById('mr').innerHTML=renderModal(); bindModal(); }
  else if(state.attendanceEdit){ document.getElementById('mr').innerHTML=renderAttendanceEditModal(); bindAttendanceEditModal(); }
  else if(state.ratingEdit){ document.getElementById('mr').innerHTML=renderRatingEditModal(); bindRatingEditModal(); }
  else if(state.safetypayEdit){ document.getElementById('mr').innerHTML=renderSafetypayEditModal(); bindSafetypayEditModal(); }
  else if(state.collaboratorEditId){
    try{
      document.getElementById('mr').innerHTML=renderCollaboratorEditModal();
      bindCollaboratorEditModal();
    }catch(error){
      console.error('Error al abrir colaborador', error);
      document.getElementById('mr').innerHTML=`<div class="modal-overlay" id="collaboratorEditOverlay"><div class="modal collaborator-edit-modal"><h3>Editar colaborador</h3><p class="page-sub">No se pudo abrir el colaborador: ${esc(error?.message || 'error desconocido')}</p><div class="modal-actions"><button class="btn-cancel" data-collaborator-close>Cerrar</button></div></div></div>`;
      bindCollaboratorEditModal();
    }
  }
  else if(state.salaryDetailId && (!document.querySelector('.fx-salary-detail') || state.fxSalaryFull)){
    try{
      document.getElementById('mr').innerHTML=renderSalaryDetailModal();
      bindSalaryDetailModal();
    }catch(error){
      console.error('Error al abrir detalle de sueldo', error);
      document.getElementById('mr').innerHTML=`<div class="modal-overlay" id="salaryDetailOverlay"><div class="modal salary-modal"><h3>Detalle de sueldo</h3><p class="page-sub">No se pudo abrir el detalle: ${esc(error?.message || 'error desconocido')}</p><div class="modal-actions"><button class="btn-cancel" id="salaryDetailClose">Cerrar</button></div></div></div>`;
      bindSalaryDetailModal();
    }
  }
  else if(state.dashboardUserId){ document.getElementById('mr').innerHTML=renderDashboardDetailModal(); bindDashboardDetailModal(); }
  else if(state.newModal){ document.getElementById('mr').innerHTML=renderNuevoModal(); bindNuevoModal(); }
  if(typeof applyMobileLayout==='function') applyMobileLayout();
  restoreViewPresentation(presentation);
  const renderedMain=document.querySelector('.main');
  requestAnimationFrame(()=>{
    if(document.querySelector('.main')!==renderedMain) return;
    restoreViewPresentation(presentation);
    const nav=document.querySelector('.nav');
    if(nav) nav.scrollTop=navScrollTop;
  });
}

async function boot(){
  if(!tabSessionToken()){ BOOTING=false; state.view='login'; render(); return; }
  try{
    await refreshState(false, CORE_STATE_MODULES, true);
    restoreTabView();
  }catch(error){
    resetSessionViewState();
    state.currentUser=null;
    state.resetUserId=null;
    state.view='login';
    SESSION_WARMUP_KEY='';
  }finally{
    BOOTING=false;
    render();
  }
}
function renderLogin(){
  return `<main class="login-wrap turnos-login"><div class="login-shell">
    <div class="login-brand"><img src="/brands/atk-peru-wk.png" alt="ATK Altoque Perú WK"/><p>Registros ATK</p></div>
    <section class="login-card"><h2>Inicia sesión</h2><p class="login-intro">Ingresa con tu usuario y contraseña para continuar.</p>
      <form id="loginForm">
        <label for="lu">Usuario<input id="lu" name="username" type="text" placeholder="Ingresa tu usuario" autocomplete="username" spellcheck="false" required/></label>
        <label for="lp">Contraseña<span class="password-wrap"><input id="lp" name="password" type="password" placeholder="Ingresa tu contraseña" autocomplete="current-password" required/><button type="button" id="tp" class="password-toggle" aria-label="Mostrar contraseña" title="Mostrar contraseña"><svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/><path class="password-eye-slash" d="m3 3 18 18" hidden/></svg></button></span></label>
        <button class="login-submit" id="lb" type="submit">Iniciar sesión</button>
      </form>
      <button type="button" class="login-forgot" id="loginForgot">¿Olvidaste tu contraseña?</button>
      <p class="login-help" id="loginHelp" role="status" hidden>Para recuperar tu contraseña, comunícate con el administrador de Registros ATK.</p>
      <div id="le" class="err-msg" role="alert"></div>
    </section>
  </div></main>`;
}
function bindLogin(){
  const userInput=document.getElementById('lu'),passInput=document.getElementById('lp'),err=document.getElementById('le'),form=document.getElementById('loginForm'),toggleBtn=document.getElementById('tp'),submit=document.getElementById('lb');
  let submitting=false;
  form.onsubmit=async event=>{
    event.preventDefault();
    if(submitting || !form.reportValidity()) return;
    submitting=true; submit.disabled=true; submit.textContent='Ingresando…'; err.style.display='none';
    const username=userInput.value.trim(),password=passInput.value;
    try{
      const payload=await apiFetch('/api/auth/login',{method:'POST',body:JSON.stringify({username,password}),busyMessage:'Ingresando al sistema...'});
      if(!payload.sessionToken) throw new Error('No se pudo crear la sesión. Vuelve a intentarlo.');
      try{ sessionStorage.setItem(TAB_SESSION_KEY,payload.sessionToken); }catch{ throw new Error('Permite el almacenamiento de esta pestaña para iniciar sesión.'); }
      state.sessionPassword=password;
      state.currentUser=mapUser(payload.currentUser);
      state.resetUserId=state.currentUser.forcePasswordReset?state.currentUser.id:null;
      PORTAL_GRANT=payload.portalGrant||'';
      PORTAL_TURNOS_URL=payload.turnosUrl||'';
      state.view=state.currentUser.forcePasswordReset?'force-password':'system-choice';
      render();
    }catch(error){
      err.textContent=error?.status===401 ? 'Usuario o contraseña incorrectos' : (error?.message || 'No se pudo conectar al sistema. Intenta de nuevo.'); err.style.display='block';
    }finally{ submitting=false; submit.disabled=false; submit.textContent='Iniciar sesión'; }
  };
  [userInput,passInput].forEach(input=>{ input.oninput=()=>{ err.style.display='none'; }; });
  toggleBtn.onclick=()=>{
    const reveal=passInput.type==='password'; passInput.type=reveal?'text':'password';
    toggleBtn.setAttribute('aria-label',reveal?'Ocultar contraseña':'Mostrar contraseña'); toggleBtn.title=toggleBtn.getAttribute('aria-label');
    toggleBtn.querySelector('.password-eye-slash').style.display=reveal?'block':'none'; passInput.focus();
  };
  document.getElementById('loginForgot').onclick=()=>{ document.getElementById('loginHelp').hidden=false; };
}

function renderSystemChoice(){
  const userName=esc(state.currentUser?.name||'');
  return `<main class="login-wrap turnos-login"><div class="login-shell system-choice-shell"><div class="login-brand"><img src="/brands/atk-peru-wk.png" alt="ATK Altoque Perú WK"/><p>Portal de acceso</p></div><section class="system-choice-panel"><div class="system-choice-heading"><span class="system-choice-kicker">SISTEMAS ATK</span><h1>Hola, ${userName}</h1><p>¿A qué plataforma deseas ingresar?</p></div><div class="system-choice-actions"><button type="button" class="system-choice-card" id="openRecords"><span class="system-choice-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v16H6.5A2.5 2.5 0 0 0 4 21z"/><path d="M4 5.5v13A2.5 2.5 0 0 1 6.5 16H20M8 7h8M8 10h6"/></svg></span><span class="system-choice-copy"><strong>Registros ATK</strong><small>Registros, seguimiento y gestión</small></span><span class="system-choice-arrow" aria-hidden="true">→</span></button><button type="button" class="system-choice-card" id="openTurnos"><span class="system-choice-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="17" rx="2"/><path d="M16 2v4M8 2v4M3 9h18M8 13h3v3H8zM14 13h3M14 17h3"/></svg></span><span class="system-choice-copy"><strong>Turnos ATK</strong><small>Cola, atención y tickets</small></span><span class="system-choice-arrow" aria-hidden="true">→</span></button></div><div id="systemChoiceError" class="err-msg" role="alert"></div><button type="button" class="login-forgot" id="chooseAnotherAccount">Cerrar sesión</button></section></div></main>`;
}
function bindSystemChoice(){
  const records=document.getElementById('openRecords'),turnos=document.getElementById('openTurnos'),error=document.getElementById('systemChoiceError');
  records.onclick=async()=>{
    records.disabled=true;turnos.disabled=true;records.textContent='Cargando Registros ATK…';
    BOOTING=true;state.view='login';render();
    try{await refreshState(false,CORE_STATE_MODULES,true);}
    catch(e){BOOTING=false;state.view='system-choice';render();document.getElementById('systemChoiceError').textContent=e?.message||'No se pudo cargar Registros ATK. Intenta nuevamente.';return;}
    BOOTING=false;PORTAL_GRANT='';history.replaceState(null,'',location.pathname);render();
  };
  turnos.onclick=()=>{
    if(!PORTAL_GRANT||!PORTAL_TURNOS_URL){error.textContent='No se pudo preparar el acceso a Turnos. Vuelve a iniciar sesión.';return;}
    const form=document.createElement('form');form.method='POST';form.action=PORTAL_TURNOS_URL.replace(/\/$/,'')+'/api/auth/sso';
    const code=document.createElement('input');code.type='hidden';code.name='grant';code.value=PORTAL_GRANT;form.appendChild(code);document.body.appendChild(form);turnos.disabled=true;turnos.textContent='Abriendo Turnos ATK…';form.submit();
  };
  document.getElementById('chooseAnotherAccount').onclick=()=>{clearTabSession();location.reload();};
}

function bindForcePassword(){
  const form=document.getElementById('resetForm');
  const err=document.getElementById('re');
  if(!form||!err) return;
  form.onsubmit=async e=>{
    e.preventDefault();
    const p1=document.getElementById('rp1').value;
    const p2=document.getElementById('rp2').value;
    if(p1.length<6){ err.textContent='La contrasena debe tener al menos 6 caracteres'; err.style.display='block'; return; }
    if(p1!==p2){ err.textContent='Las contrasenas no coinciden'; err.style.display='block'; return; }
    try{
      await apiFetch('/api/settings/password', {
        method:'POST',
        body:JSON.stringify({ currentPassword: state.sessionPassword, newPassword:p1, repeatPassword:p2 })
      });
      state.sessionPassword=p1;
      if(state.currentUser){
        state.currentUser.forcePasswordReset=false;
      }
      state.resetUserId=null;
      state.view=state.currentUser?.role==='admin'?'dashboard':'mis-registros';
      try{
        await refreshState(true, CORE_STATE_MODULES);
      }catch(error){
        // If the state refresh fails, don't trap the user in the first-login screen.
      }
      render();
    }catch(error){
      err.textContent=error.message || 'No se pudo actualizar la contrasena';
      err.style.display='block';
    }
  };
}

function renderForcePassword(){
  const u=USERS.find(x=>x.id===state.resetUserId)||state.currentUser||{name:'Usuario'};
  return `<div class="login-wrap"><div class="login-card">
    <div class="login-logo">
      <div class="icon-wrap">ATK</div>
      <div class="brand">Primer ingreso</div>
      <div class="sub">${u.name}</div>
    </div>
    <form id="resetForm">
      <div class="field"><label>Nueva contrasena</label><input id="rp1" type="password" placeholder="minimo 6 caracteres" autocomplete="new-password"/></div>
      <div class="field"><label>Repetir contrasena</label><input id="rp2" type="password" placeholder="repite la contrasena" autocomplete="new-password"/></div>
      <div id="re" class="err-msg">Las contrasenas no coinciden</div>
      <button class="btn-primary" id="rb" type="submit">Guardar y entrar</button>
    </form>
  </div></div>`;
}

function sidebarBadgeCounts(){
  const month=activeMonthKey(state.recordsMonth);
  const visibleRecords=getVisibleRecords().filter(record=>recordAccountingMonthKey(record)===month);
  const duplicateCount=duplicateGroups(visibleRecords.filter(record=>!record.rejectedAt), { includeRejected:false, includeMarked:true }).length;
  const alertCount=
    visibleRecords.filter(record=>record.tipo==='registro'&&daysSince(record.fecha)>=WARN_DAY).length +
    duplicateCount +
    REFERRALS.filter(report=>!report.validatedAt&&!report.rejectedAt&&monthKeyFromDate(report.createdAt)===activeMonthKey(state.referralMonth)).length +
    WRONG_CARDS.filter(report=>report.status==='PENDING'&&monthKeyFromDate(report.detectedDate||report.createdAt)===activeMonthKey(state.wrongCardMonth)).length +
    CALL_REPORTS.filter(report=>report.status==='PENDING'&&monthKeyFromDate(report.createdAt)===activeMonthKey(state.callMonth)).length +
    PENALTY_REPORTS.filter(report=>report.status==='PENDING'&&monthKeyFromDate(report.createdAt)===activeMonthKey(state.penaltyMonth)).length;
  return {
    alertas: alertCount,
    llamadas: CALL_REPORTS.filter(report=>report.status==='PENDING' && monthKeyFromDate(report.createdAt)===activeMonthKey(state.callMonth)).length,
    penalidades: PENALTY_REPORTS.filter(report=>report.status==='PENDING' && monthKeyFromDate(report.createdAt)===activeMonthKey(state.penaltyMonth)).length
  };
}

function sidebarSectionsForCurrentUser(){
  if(isManager()){
    return [
      { title:'GENERAL', items:[{id:'dashboard',label:'Dashboard'},{id:'estadisticas',label:'Estadisticas'}] },
      { title:'PERSONAL', items:[{id:'mis-registros',label:'Mis Registros'},{id:'mis-comisiones',label:'Mis Comisiones'},{id:'asistencia',label:'Asistencia'},{id:'calificaciones',label:'Calificaciones'}] },
      { title:'OPERACIONES', items:[{id:'safetypay',label:'Safetypay'},{id:'referidos',label:'Referidos'},{id:'llamadas',label:'Llamadas'},{id:'tarjetas',label:'Tarjetas erroneas'},{id:'todos',label:'Todos los Registros'}] },
      { title:'CONTROL', items:[{id:'penalidades',label:'Reportes de penalidad'},{id:'auditoria-pagos',label:'Auditoría de pagos'},{id:'alertas',label:'Alertas'}] },
      { title:'EQUIPO', items:[{id:'admin',label:'Mi equipo'}] }
    ];
  }
  if(isAdmin()){
    return [
      { title:'GENERAL', items:[{id:'dashboard',label:'Dashboard'},{id:'estadisticas',label:'Estadisticas'}] },
      { title:'PERSONAL', items:[{id:'asistencia',label:'Asistencia'},{id:'sueldos',label:'Sueldos'},{id:'colaboradores',label:'Colaboradores'},{id:'calificaciones',label:'Calificaciones'}] },
      { title:'OPERACIONES', items:[{id:'safetypay',label:'Safetypay'},{id:'referidos',label:'Referidos'},{id:'llamadas',label:'Llamadas'},{id:'tarjetas',label:'Tarjetas erroneas'},{id:'todos',label:'Todos los Registros'}] },
      { title:'CONTROL', items:[{id:'penalidades',label:'Reportes de penalidad'},{id:'auditoria-pagos',label:'Auditoría de pagos'},{id:'cierre',label:'Cierre mensual'},{id:'archivo-cierres',label:'Archivo mensual'},{id:'alertas',label:'Alertas'}] },
      { title:'SISTEMA', items:[{id:'admin',label:'Administracion'},{id:'grupos',label:'Grupos por DNI'},{id:'historial',label:'Historial de cambios'},{id:'reportes',label:'Reportes'}] }
    ];
  }
  return [
    { title:'PERSONAL', items:[{id:'mis-registros',label:'Mis Registros'},{id:'mis-comisiones',label:'Mis Comisiones'},{id:'calificaciones',label:'Calificaciones'}] },
    { title:'OPERACIONES', items:[{id:'safetypay',label:'Safetypay'},{id:'referidos',label:'Referidos'},{id:'llamadas',label:'Llamadas'},{id:'tarjetas',label:'Tarjetas erroneas'}] },
    { title:'CONTROL', items:[{id:'penalidades',label:'Mis penalidades'},...(isPaymentAuditReporter()?[{id:'auditoria-pagos',label:'Auditoría de pagos'}]:[]),{id:'alertas',label:'Alertas'}] }
  ];
}

function viewAllowedForCurrentUser(view){
  if(view==='historial' && !isAdmin()) return false;
  if(isManager() && ['admin','reportes'].includes(view)) return false;
  if(canPreviewAllSedesAsManager() && view==='penalidades') return false;
  if(view==='auditoria-pagos' && !canAccessPaymentAudits()) return false;
  return true;
}

function renderSidebar(){
  const u=state.currentUser;
  const cleanIcons={
    'dashboard':'&#128202;',
    'estadisticas':'&#128200;',
    'asistencia':'&#128345;',
    'calificaciones':'&#11088;',
    'safetypay':'&#127974;',
    'penalidades':'&#128681;',
    'auditoria-pagos':'&#128269;',
    'sueldos':'&#128188;',
    'colaboradores':'&#128101;',
    'cierre':'&#129534;',
    'archivo-cierres':'&#128451;',
    'mis-registros':'&#128203;',
    'referidos':'&#129309;',
    'llamadas':'&#9742;',
    'tarjetas':'&#128179;',
    'todos':'&#128209;',
    'alertas':'&#128276;',
    'mis-comisiones':'&#128176;',
    'admin':'&#9881;',
    'grupos':'&#128101;',
    'historial':'&#128221;',
    'reportes':'&#128196;'
  };
  const badgeCounts=sidebarBadgeCounts();
  const roleLabel=u.role==='admin'?'Admin General':u.role==='manager'?'Jefe de sede':'Atencion al cliente';
  const sections=sidebarSectionsForCurrentUser().map(section=>({
    ...section,
    items: section.items.map(item=>({
      ...item,
      icon: cleanIcons[item.id] || '&#8226;',
      badge: badgeCounts[item.id] || 0
    }))
  }));
  const collapsed=state.sidebarCollapsed;
  return `<aside class="sidebar${collapsed?' collapsed':''}">
    <div class="sidebar-head">
      <div class="sidebar-logo" aria-label="Altoque Peru WK"><div class="brand">LINCE</div><div class="sub">Comisiones</div></div>
      <button type="button" class="sidebar-toggle" data-sidebar-toggle aria-label="${collapsed?'Expandir menu':'Colapsar menu'}" title="${collapsed?'Expandir menu':'Colapsar menu'}">${collapsed?'&#8250;':'&#8249;'}</button>
    </div>
    <div class="sidebar-top-actions"><button type="button" class="logout-btn top" data-logout title="Cerrar sesion">${collapsed?'&#10162;':'Cerrar sesion'}</button></div>
    <nav class="nav">${sections.map(section=>`
      <section class="nav-section">
        <div class="nav-section-title">${section.title}</div>
        <div class="nav-section-items">${section.items.map(item=>`
          <div class="nav-item${state.view===item.id?' active':''}" data-nav="${item.id}" data-tooltip="${item.label}" title="${item.label}">
            <span class="nav-icon">${item.icon}</span>
            <span class="nav-label">${item.label}</span>
            ${item.badge?`<span class="nav-badge">${item.badge}</span>`:''}
          </div>`).join('')}
        </div>
      </section>`).join('')}</nav>
    <div class="sidebar-footer">
      <div class="user-badge" title="${u.name} - ${roleLabel} - ${userSede(u)}">${avatar(u,32,11)}<div class="user-meta"><div class="user-name">${u.name}</div><div class="user-role">${roleLabel} - ${userSede(u)}</div></div></div>
      <div class="logout-btn bottom" data-logout title="Cerrar sesion">${collapsed?'Salir':'Cerrar sesion'}</div>
      <div class="app-version">v2.1</div>
    </div>
  </aside>`;
}

async function loadChangeLogs(force=false){
  if(!isAdmin() || (CHANGE_LOGS && !force) || (CHANGE_LOGS_LOADING && !force)) return;
  const revision=++CHANGE_LOGS_REVISION;
  CHANGE_LOGS_LOADING=true;
  render();
  try{
    const params=new URLSearchParams({limit:'40',page:String(state.historyPage||1),group:state.historyGroup||'all',module:state.historyModule||'',q:state.historySearch||'',from:state.historyFrom||'',to:state.historyTo||''});
    const payload=await apiFetch('/api/change-log?'+params, { method:'GET', silent:true });
    if(revision!==CHANGE_LOGS_REVISION)return;
    CHANGE_LOGS=Array.isArray(payload.logs) ? payload.logs : [];
    CHANGE_LOGS_META={total:payload.total||0,page:payload.page||1,limit:payload.limit||40};
  }catch(error){
    if(revision!==CHANGE_LOGS_REVISION)return;
    CHANGE_LOGS=[];
    await appAlert(error.message || 'No se pudo cargar el historial.', 'Error');
  }finally{
    if(revision===CHANGE_LOGS_REVISION){CHANGE_LOGS_LOADING=false;render();}
  }
}

function renderAuditChange(item){
  const labels={entry:'Entrada',exit:'Salida',requestedEntry:'Entrada solicitada',requestedExit:'Salida solicitada',date:'Fecha',state:'Estado',status:'Estado',justifiedDay:'Día justificado',justifiedEntry:'Ingreso justificado',justifiedExit:'Salida justificada',absence:'Falta sin pago',reason:'Motivo',decisionReason:'Motivo de decisión',decision:'Decisión',monthlySalary:'Sueldo mensual',payrollRole:'Cargo',salaryEffectiveMonth:'Vigente desde',clientName:'Cliente',dni:'DNI',amount:'Monto',bank:'Banco',comment:'Comentario',advisor:'Asesor',rating:'Estrellas',name:'Nombre',username:'Usuario',sede:'Sede',paid:'Pagado',month:'Mes',validatedAt:'Fecha de aprobación',rejectedAt:'Fecha de rechazo',operationDate:'Fecha de operación',registrationDate:'Fecha de registro',type:'Tipo',mode:'Modalidad',notes:'Observaciones',bonusDisabled:'Bono desactivado'};
  const aliases={entryTime:'entry',exitTime:'exit',currentEntry:'entry',currentExit:'exit'};
  const ignored=new Set(['id','updatedAt','createdAt','punches','manualEntry','manualExit','entryStatus','exitStatus','lateLabel','lateMinutes','earlyLeaveLabel','earlyLeaveMinutes','overtimeLabel','overtimeMinutes','calendarException','status']);
  const normalize=value=>{
    const out={};
    for(const [key,data] of Object.entries(value&&typeof value==='object'&&!Array.isArray(value)?value:{value})){
      if(key==='updatedAt'||key==='id'||(item.module==='Asistencia'&&ignored.has(key)))continue;
      out[aliases[key]||key]=data;
    }
    return out;
  };
  let before=normalize(item.before),after=normalize(item.after);
  if(item.module==='Asistencia'&&['EDITAR','FALTA','QUITAR_FALTA'].includes(item.action)){
    after={...before,...after};
    for(const data of [before,after]){
      if(data.justifiedDay){if(/^00:00/.test(data.entry||''))data.entry=null;if(/^00:00/.test(data.exit||''))data.exit=null;}
      data.state=data.absence?'Falta — sin marcaje':data.justifiedDay?'Día justificado':data.entry&&data.exit?'Completo':data.entry?'Falta salida':data.exit?'Falta entrada':'Sin marcaje';
      delete data.justifiedDay;
    }
  }
  const flatten=(data,prefix='',out={})=>{
    for(const [key,value] of Object.entries(data)){const field=prefix?prefix+'.'+key:key;if(value&&typeof value==='object'&&!Array.isArray(value))flatten(value,field,out);else out[field]=value;}
    return out;
  };
  before=flatten(before);after=flatten(after);
  const keys=item.after==null?Object.keys(before):Object.keys(after);
  const words={APPROVED:'Aprobado',REJECTED:'Rechazado',PENDING:'Pendiente',approve:'Aprobado',validate:'Aprobado',reject:'Rechazado',pending:'Pendiente',FULL_TIME:'Tiempo completo',PART_TIME:'Tiempo parcial',OPERACION:'Operación',REGISTRO:'Registro',PRESENCIAL:'Presencial',VIRTUAL:'Virtual'};
  const text=(value,key)=>{
    if(value==null||value==='')return /(^|\.)(entry|exit|requestedEntry|requestedExit)$/.test(key)?'Sin marcaje':'Sin registro';
    if(typeof value==='boolean')return value?'Sí':'No';
    if(Array.isArray(value))return value.length?value.map(v=>typeof v==='object'?'Elemento registrado':String(v)).join(' · '):'Sin elementos';
    if(/Salary|amount|commission|bonusAmount|baseSalary/i.test(key)&&typeof value==='number')return money(value);
    if(/^\d{4}-\d{2}-\d{2}T/.test(String(value)))return fmtDateTime(value);
    if(/^\d{4}-\d{2}-\d{2}$/.test(String(value)))return fmt(value);
    if(/^(\d{2}:\d{2})(:\d{2})?$/.test(String(value)))return String(value).slice(0,5);
    return words[value]||String(value);
  };
  const changed=keys.filter(key=>JSON.stringify(before[key]??null)!==JSON.stringify(after[key]??null)||item.before==null||item.after==null);
  if(!changed.length)return '<div class="audit-change-note">No hay diferencias de valores registradas para esta acción.</div>';
  return `<details class="audit-change"><summary>Ver cambio</summary><div class="audit-change-content"><table class="audit-change-table"><thead><tr><th>Dato</th><th>Antes</th><th>${item.action==='SOLICITAR_CAMBIO'?'Solicitado':'Después'}</th></tr></thead><tbody>${changed.map(key=>`<tr><td>${esc(key.split('.').map(part=>labels[part]||part.replace(/^__/, '').replace(/([a-z])([A-Z])/g,'$1 $2')).join(' · '))}</td><td>${esc(text(before[key],key))}</td><td>${esc(item.after==null?'Eliminado':text(after[key],key))}</td></tr>`).join('')}</tbody></table></div></details>`;
}
function renderChangeHistory(){
  if(!isAdmin()) return '<div class="empty-state"><p>No tienes permiso para ver el historial.</p></div>';
  if(!CHANGE_LOGS && !CHANGE_LOGS_LOADING){ setTimeout(()=>loadChangeLogs(), 0); }
  if(CHANGE_LOGS_LOADING || !CHANGE_LOGS) return renderSectionLoading('Historial de cambios', 'Cargando auditoría del sistema...');
  const actionLabel={ CREAR:'Creó', EDITAR:'Editó', ELIMINAR:'Eliminó', CAMBIAR_PAGO:'Cambió pago',APROBAR:'Aprobó',RECHAZAR:'Rechazó',SOLICITAR_CAMBIO:'Solicitó cambio',APROBAR_SOLICITUD:'Aprobó solicitud',RECHAZAR_SOLICITUD:'Rechazó solicitud',PENDIENTE:'Volvió a pendiente',FALTA:'Marcó falta',QUITAR_FALTA:'Retiró falta',PERFIL_SALARIAL:'Cambió perfil salarial' };
  const groups=[['all','General'],['attendance','Asistencias'],['approved','Aprobados'],['rejected','Rechazados'],['created','Creados'],['edited','Modificados'],['deleted','Eliminados'],['system','Sistema']];
  const modules=['Asistencia','Registros','Calificaciones','Referidos','Llamadas','Tarjetas erróneas','Penalidades','Auditoría de pagos','Safetypay','Colaboradores','Sueldos','Usuarios','Grupos','Calendario laboral','Configuración','Cierres mensuales'];
  const pages=Math.max(1,Math.ceil(CHANGE_LOGS_META.total/CHANGE_LOGS_META.limit));
  return `<div class="page-header"><div class="page-title">Historial de cambios</div><div class="page-sub">Acciones por usuario y sección. Se excluyen las realizadas por Admin General. Los eventos automáticos están en Sistema.</div></div>
    <div class="tabs" style="flex-wrap:wrap">${groups.map(([key,label])=>`<button class="tab${(state.historyGroup||'all')===key?' active':''}" data-history-group="${key}">${label}</button>`).join('')}</div>
    <div class="table-wrap"><div class="table-header" style="flex-wrap:wrap;gap:8px"><select class="filter-select" id="historyModule"><option value="">Todas las secciones</option>${modules.map(module=>`<option${state.historyModule===module?' selected':''}>${esc(module)}</option>`).join('')}</select><input class="search-input" id="historySearch" placeholder="Usuario, detalle o código..." value="${esc(state.historySearch||'')}"/><input class="filter-select" type="date" id="historyFrom" aria-label="Desde" value="${esc(state.historyFrom||'')}"/><input class="filter-select" type="date" id="historyTo" aria-label="Hasta" value="${esc(state.historyTo||'')}"/><button class="btn-sm" id="historyApply">Buscar</button><button class="btn-sm" id="changeLogRefresh">Actualizar</button></div>
    <table class="audit-history-table"><thead><tr><th>Fecha</th><th>Usuario</th><th>Módulo</th><th>Acción</th><th>Detalle</th><th>Sede</th></tr></thead><tbody>
      ${CHANGE_LOGS.map(item=>`<tr><td style="white-space:nowrap">${fmtDateTime(item.createdAt)}</td><td>${esc(item.actor?.name || 'Sistema')}<small style="display:block;color:var(--text3)">${esc(item.actor?.username||'')}</small></td><td><span class="badge web">${esc(item.module)}</span></td><td>${esc(actionLabel[item.action] || item.action)}</td><td>${esc(item.summary)}${item.before!=null||item.after!=null?renderAuditChange(item):''}${item.targetType==='RatingDeletion' && item.action==='ELIMINAR'?`<button class="btn-sm" data-rating-restore="${esc(item.targetId)}">Restaurar calificación</button><button class="btn-sm" data-rating-purge="${esc(item.targetId)}">Eliminar definitivamente</button>`:''}</td><td>${esc(item.sede || '-')}</td></tr>`).join('') || '<tr><td colspan="6"><div class="empty-state"><p>Sin cambios para estos filtros.</p></div></td></tr>'}
    </tbody></table><div class="table-header"><span>${CHANGE_LOGS_META.total} cambios · Página ${CHANGE_LOGS_META.page} de ${pages}</span><div><button class="btn-sm" data-history-page="${CHANGE_LOGS_META.page-1}" ${CHANGE_LOGS_META.page<=1?'disabled':''}>Anterior</button> <button class="btn-sm" data-history-page="${CHANGE_LOGS_META.page+1}" ${CHANGE_LOGS_META.page>=pages?'disabled':''}>Siguiente</button></div></div></div>`;
}

async function loadWorkGroups(force=false){
  if(!isAdmin() || (WORK_GROUPS && !force) || WORK_GROUPS_LOADING) return;
  WORK_GROUPS_LOADING=true;
  try{
    const payload=await apiFetch('/api/groups', { method:'GET', silent:true });
    WORK_GROUPS=Array.isArray(payload.groups) ? payload.groups : [];
  }catch(error){
    WORK_GROUPS=[];
    await appAlert(error.message || 'No se pudieron cargar los grupos.', 'Error');
  }finally{
    WORK_GROUPS_LOADING=false;
    if(state.view==='grupos') render();
  }
}

function renderGroups(){
  if(!isAdmin()) return '<div class="empty-state"><p>No tienes permiso para administrar grupos.</p></div>';
  if(WORK_GROUPS===null && !WORK_GROUPS_LOADING){ setTimeout(()=>loadWorkGroups(),0); }
  if(WORK_GROUPS_LOADING || WORK_GROUPS===null) return renderSectionLoading('Grupos por DNI', 'Cargando grupos y responsables...');
  const cards=WORK_GROUPS.map((group,index)=>{
    const memberDnis=(group.members||[]).map(member=>member.dni).join(', ');
    return `<article class="table-wrap" style="padding:1rem;margin:0">
      <div class="table-header" style="padding:0 0 .85rem"><div class="table-title">Grupo ${index+1}</div><button class="btn-sm danger" type="button" data-remove-work-group="${index}">Quitar</button></div>
      <div class="form-grid">
        <div class="form-group"><label class="form-label">Nombre del grupo</label><input class="form-input" data-work-group-name="${index}" value="${esc(group.name||'')}"></div>
        <div class="form-group"><label class="form-label">DNI del jefe</label><input class="form-input" inputmode="numeric" data-work-group-chief="${index}" value="${esc(group.chiefDni||'')}"></div>
        <div class="form-group full"><label class="form-label">DNIs de miembros</label><textarea class="form-input" rows="3" data-work-group-members="${index}" placeholder="Separados por coma o salto de línea">${esc(memberDnis)}</textarea><small style="color:var(--text3);margin-top:5px">Un DNI solo puede pertenecer a un grupo. Las calificaciones continúan por nombre.</small></div>
      </div>
    </article>`;
  }).join('');
  return `<div class="page-header"><div class="page-title">Grupos por DNI</div><div class="page-sub">Organiza grupos, responsables y miembros sin cambiar roles, sueldos ni historial.</div></div>
    <div class="table-wrap" style="padding:1rem;margin-bottom:1rem"><div style="color:var(--text2);font-size:12px;line-height:1.5">Cada usuario puede tener su DNI único. Aquí puedes cambiar el jefe, editar los grupos y mover integrantes colocando su DNI en el grupo destino.</div></div>
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(310px,1fr));gap:1rem">${cards}</div>
    <div style="display:flex;gap:.75rem;flex-wrap:wrap;margin-top:1rem"><button class="btn-sm" type="button" id="addWorkGroup">+ Agregar grupo</button><button class="btn-primary" type="button" id="saveWorkGroups" style="width:auto;padding:10px 20px">Guardar grupos</button></div>`;
}

function renderApp(){
  let content='';
  let v=state.view;
  if(!viewAllowedForCurrentUser(v)){
    state.view='dashboard';
    v='dashboard';
  }
  const neededModules=getViewStateModules(v);
  startViewDataLoads(v);
  if(stateModuleErrorFor(neededModules)){
    content=renderStateLoadError(neededModules);
  }
  else if(neededModules.length && ensureStateModulesLoaded(neededModules)){
    content=renderSectionLoading('Cargando', 'Preparando solo los datos de esta pagina...');
  }
  else if(v==='dashboard') content=renderDashboard();
  else if(v==='estadisticas') content=renderEstadisticas();
  else if(v==='asistencia') content=renderAsistencia();
  else if(v==='sueldos') content=renderSueldos();
  else if(v==='colaboradores') content=renderColaboradores();
  else if(v==='cierre') content=renderCierreMensual();
  else if(v==='archivo-cierres') content=renderArchivoMensual();
  else if(v==='calificaciones') content=renderCalificaciones();
  else if(v==='safetypay') content=renderSafetypay();
  else if(v==='penalidades') content=renderPenalidades();
  else if(v==='auditoria-pagos') content=renderPaymentAudits();
  else if(v==='todos') content=renderTodos();
  else if(v==='referidos') content=renderReferidos();
  else if(v==='llamadas') content=renderLlamadas();
  else if(v==='tarjetas') content=renderTarjetasErroneas();
  else if(v==='alertas') content=renderAlertas();
  else if(v==='admin') content=renderAdmin();
  else if(v==='grupos') content=renderGroups();
  else if(v==='historial') content=renderChangeHistory();
  else if(v==='reportes') content=renderReportes();
  else if(v==='mis-registros') content=renderMisRegistros();
  else if(v==='mis-comisiones') content=renderMisComisiones();
  const previewSedeBar=canPreviewAllSedesAsManager()
    ? `<div class="manager-preview-bar"><div><strong>Vista temporal de jefe</strong><span>Elige la sede que quieres revisar.</span></div><select class="filter-select" id="managerViewSede"><option value=""${!state.managerViewSede?' selected':''}>Todas las sedes</option>${SEDES.map(sede=>`<option value="${sede}"${state.managerViewSede===sede?' selected':''}>${sede}</option>`).join('')}</select></div>`
    : '';
  return `<div class="app${state.sidebarCollapsed?' sidebar-collapsed':''}">${renderSidebar()}<main class="main">${previewSedeBar}${content}</main></div><div id="mr"></div>`;
}

function dashboardLocalDateKey(value=new Date()){
  const date=value instanceof Date ? value : new Date(value);
  return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
}
function dashboardWeekStartKey(value=new Date()){
  const date=value instanceof Date ? new Date(value) : new Date(value);
  const weekday=(date.getDay()+6)%7;
  date.setDate(date.getDate()-weekday);
  return dashboardLocalDateKey(date);
}
function managerReportPeriod(){
  const today=dashboardLocalDateKey();
  const mode=state.managerReportPeriod || 'day';
  const reference=String(state.managerReportFrom || today).slice(0,10);
  if(mode==='week'){
    const start=dashboardWeekStartKey(reference);
    const endDate=new Date(`${start}T12:00:00`); endDate.setDate(endDate.getDate()+6);
    return { mode, from:start, to:dashboardLocalDateKey(endDate), label:`Semana del ${fmt(start)} al ${fmt(dashboardLocalDateKey(endDate))}` };
  }
  if(mode==='range'){
    const from=reference;
    const to=String(state.managerReportTo || from).slice(0,10);
    const start=from<=to ? from : to;
    const end=from<=to ? to : from;
    return { mode, from:start, to:end, label:start===end ? fmt(start) : `Del ${fmt(start)} al ${fmt(end)}` };
  }
  return { mode:'day', from:reference, to:reference, label:fmt(reference) };
}
function managerRegistrationActivityRows(month=activeMonthKey(state.dashboardMonth), period=managerReportPeriod(), ratingRows=MANAGER_REPORT_RATINGS){
  const records=getVisibleRecords();
  return getVisibleUsers().filter(user=>user.role!=='admin' && Number(user.id)!==Number(state.currentUser?.id)).map(user=>{
    const ownRecords=records.filter(record=>Number(record.userId)===Number(user.id) && !record.rejectedAt);
    const countModes=items=>({ total:items.length, presencial:items.filter(item=>String(item.modalidad || '').toLowerCase()==='presencial').length, virtual:items.filter(item=>String(item.modalidad || '').toLowerCase()!=='presencial').length });
    const dateFor=record=>isoDate(record.fecha || record.registrationDate || record.createdAt);
    const selected=ownRecords.filter(record=>{ const date=dateFor(record); return date>=period.from && date<=period.to; });
    const ratings=(ratingRows || []).filter(row=>Number(row.matchedUserId)===Number(user.id) && (()=>{ const date=isoDate(row.date || row.rawDate || row.approvedAt); return date>=period.from && date<=period.to; })());
    return { user, activity:countModes(selected), ratings:ratings.length };
  }).sort((a,b)=>b.activity.total-a.activity.total || b.ratings-a.ratings || a.user.name.localeCompare(b.user.name));
}
function managerRegistrationActivityDailyRows(period=managerReportPeriod(), ratingRows=MANAGER_REPORT_RATINGS){
  const dates=[];
  const cursor=new Date(`${period.from}T12:00:00`);
  const end=new Date(`${period.to}T12:00:00`);
  while(cursor<=end){ dates.push(dashboardLocalDateKey(cursor)); cursor.setDate(cursor.getDate()+1); }
  const records=getVisibleRecords();
  const users=getVisibleUsers().filter(user=>user.role!=='admin' && Number(user.id)!==Number(state.currentUser?.id));
  const rows=[];
  users.forEach(user=>{
    dates.forEach(date=>{
      const dayRecords=records.filter(record=>Number(record.userId)===Number(user.id) && !record.rejectedAt && isoDate(record.fecha || record.registrationDate || record.createdAt)===date);
      const presencial=dayRecords.filter(record=>String(record.modalidad || '').toLowerCase()==='presencial').length;
      const virtual=dayRecords.length-presencial;
      const ratings=(ratingRows||[]).filter(row=>Number(row.matchedUserId)===Number(user.id) && isoDate(row.date || row.rawDate || row.approvedAt)===date).length;
      rows.push({ user, date, total:dayRecords.length, presencial, virtual, ratings });
    });
  });
  return rows;
}
function renderDashboard(){
  const dashboardMonth=activeMonthKey(state.dashboardMonth);
  if(!ratingsLoadedFor(dashboardMonth)){
    if(!RATINGS_LOADING) setTimeout(()=>loadRatings(false, false, dashboardMonth), 0);
    return renderSectionLoading('Dashboard', 'Cargando calificaciones para mostrar comisiones completas...');
  }
  if(isManager() && ensureAttendanceLoaded()){
    return renderSectionLoading('Dashboard', 'Cargando asistencia para calcular el bono de puntualidad...');
  }
  const managerActivityPeriod=managerReportPeriod();
  const managerReportRatingsKey=`${getSessionScopeKey()}|${managerActivityPeriod.from}|${managerActivityPeriod.to}`;
  if(isManager() && MANAGER_REPORT_RATINGS_KEY!==managerReportRatingsKey){
    if(!MANAGER_REPORT_RATINGS_LOADING) setTimeout(()=>loadManagerReportRatings(managerActivityPeriod),0);
    return renderSectionLoading('Dashboard', 'Cargando calificaciones del período del reporte...');
  }
  const visibleRecords=getVisibleRecords();
  const visibleMonthRecords=visibleRecords.filter(record=>recordAccountingMonthKey(record)===dashboardMonth);
  const duplicateAlerts=duplicateGroups(
    visibleMonthRecords.filter(record=>!record.rejectedAt),
    { includeRejected:false, includeMarked:true }
  );
  const alerts=[];
  const expired=[];
  const pendingValidation=[];
  const regs=[];
  visibleMonthRecords.forEach(r=>{
    const age=daysSince(r.fecha);
    if(canValidateOrReject(r)) pendingValidation.push(r);
    if(r.tipo==='registro'){
      if(age===WARN_DAY) alerts.push(r);
      if(age>EXPIRE_DAY) expired.push(r);
      if(age<=EXPIRE_DAY) regs.push(r);
    }
  });
  const now=new Date();
  const todayLabel=new Intl.DateTimeFormat('es-PE',{ day:'numeric', month:'short', year:'numeric' }).format(now);
  const teamUsers=getVisibleUsers().filter(u=>u.role!=='admin');
  const teamEarnings=teamUsers.reduce((sum,u)=>sum+getTotalIncentiveForUser(u, dashboardMonth),0);
  const dashboardUsers=getVisibleUsers().filter(u=>u.role!=='admin'&&(!isManager()||u.id!==state.currentUser.id));
  const roleLabel=state.currentUser.role==='admin'?'Admin General':state.currentUser.role==='manager'?'Jefe de sede':'Atencion al cliente';
  const ownRecords=RECORDS.filter(r=>Number(r.userId)===Number(state.currentUser.id) && recordAccountingMonthKey(r)===dashboardMonth);
  const ownValidated=ownRecords.filter(r=>!!r.validatedAt).length;
  const ownPending=ownRecords.filter(r=>isPendingApproval(r)).length;
  const userSummaries=dashboardUsers.map(u=>{
    const userRecords=visibleMonthRecords.filter(r=>r.userId===u.id);
    const commission=getTotalIncentiveForUser(u, dashboardMonth);
    const validated=userRecords.filter(r=>!!r.validatedAt).length;
    const pending=userRecords.filter(r=>r.tipo==='registro'&&daysSince(r.fecha)<=EXPIRE_DAY).length;
    const totalTracked=Math.max(1, validated + pending);
    const progress=Math.max(4, Math.min(100, Math.round((validated/totalTracked)*100)));
    return { user:u, commission, validated, pending, progress };
  }).sort((a,b)=>b.commission-a.commission || b.validated-a.validated || a.user.name.localeCompare(b.user.name));
  const topUsers=userSummaries.slice(0,5);
  const managerActivityRows=isManager()?managerRegistrationActivityRows(dashboardMonth, managerActivityPeriod):[];
  const ownManagerSalary=ATTENDANCE && isManager() ? (getSalaryPeople({ date:monthDateFromKey(dashboardMonth) }).people||[]).find(person=>Number(userForAttendancePerson(person)?.id||0)===Number(state.currentUser.id)) : null;
  const punctualDetail=managerPunctualStaffRows(ownManagerSalary, { compact:true });

  let h=`<section class="dashboard-shell">
    <div class="dashboard-user-hero">
      <div class="dashboard-user-hero-main">
        <div class="dashboard-user-avatar">${avatar(state.currentUser,72,24)}</div>
        <div class="dashboard-user-copy">
          <div class="dashboard-user-kicker">Panel de trabajo</div>
          <div class="dashboard-user-title">Hola ${state.currentUser.name}</div>
          <div class="dashboard-user-chips">
            <span class="hero-chip"><span class="hero-chip-label">Sede</span><strong>${userSede(state.currentUser)}</strong></span>
            <span class="hero-chip"><span class="hero-chip-label">Cargo</span><strong>${roleLabel}</strong></span>
          </div>
        </div>
      </div>
      <div class="dashboard-user-stats">
        <div class="dashboard-user-stats-top">
          <div class="dashboard-date-chip">
            <strong>Hoy, ${todayLabel}</strong>
          </div>
        </div>
        <div class="dashboard-user-stats-grid">
          <div class="dashboard-user-stat-card blue">
            <div class="dashboard-user-stat-icon">&#128504;</div>
            <div>
              <div class="dashboard-user-stat-label">Validaciones</div>
              <div class="dashboard-user-stat-value">${ownValidated}</div>
              <div class="dashboard-user-stat-sub">Pendientes: ${ownPending}</div>
            </div>
          </div>
        </div>
      </div>
    </div>`;
  if(alerts.length>0) h+=`<div class="dashboard-banner warn">
    <div class="dashboard-banner-icon">&#9888;</div>
    <div class="dashboard-banner-copy"><strong>${alerts.length} cliente(s) en dia 6</strong> - manana vence el plazo. Informar a las empleadas para actualizar si ya operaron.</div>
    <button class="dashboard-banner-action" data-nav="alertas">Ver detalle &rarr;</button>
  </div>`;
  if(pendingValidation.length>0) h+=`<div class="dashboard-banner success">
    <div class="dashboard-banner-icon">&#10003;</div>
    <div class="dashboard-banner-copy"><strong>${pendingValidation.length} registro(s) listos para validar</strong> - operaron dentro de los 7 dias y ya puedes validarlos en cualquier momento.</div>
    <button class="dashboard-banner-action" data-nav="todos">Ir a validaciones &rarr;</button>
  </div>`;
  if(isManager()) h+=`<div class="table-wrap dashboard-compact-panel" style="margin:0 0 1rem">
    <div class="table-header"><div><div class="table-title">Reporte de avance de mis asesores</div><div class="page-sub">${managerActivityPeriod.label} · Registros y calificaciones subidas por asesor.</div></div><button class="btn-sm" id="downloadManagerActivityExcel">Descargar Excel</button></div>
    <div style="display:flex;gap:8px;flex-wrap:wrap;padding:0 1rem 1rem;align-items:end"><label style="display:grid;gap:5px;font-size:11px;color:var(--text3)">Período<select class="filter-select" id="managerReportPeriod"><option value="day"${managerActivityPeriod.mode==='day'?' selected':''}>Por día</option><option value="week"${managerActivityPeriod.mode==='week'?' selected':''}>Por semana</option><option value="range"${managerActivityPeriod.mode==='range'?' selected':''}>Entre fechas</option></select></label><label style="display:grid;gap:5px;font-size:11px;color:var(--text3)">${managerActivityPeriod.mode==='week'?'Fecha de la semana':'Desde'}<input class="filter-select" type="date" id="managerReportFrom" value="${esc(state.managerReportFrom || dashboardLocalDateKey())}" /></label>${managerActivityPeriod.mode==='range'?`<label style="display:grid;gap:5px;font-size:11px;color:var(--text3)">Hasta<input class="filter-select" type="date" id="managerReportTo" value="${esc(state.managerReportTo || state.managerReportFrom || dashboardLocalDateKey())}" /></label>`:''}</div>
    <table class="dashboard-compact-table"><thead><tr><th>Asesor</th><th>Registros</th><th>Presencial</th><th>Virtual</th><th>Calificaciones</th></tr></thead><tbody>
      ${managerActivityRows.map(row=>`<tr class="click-row" data-dashboard-user="${row.user.id}"><td>${compactPersonCell(row.user.name, '@'+row.user.username)}</td><td><strong>${row.activity.total}</strong></td><td>${row.activity.presencial}</td><td>${row.activity.virtual}</td><td><strong>${row.ratings}</strong></td></tr>`).join('') || '<tr><td colspan="5"><div class="empty-state"><p>No hay asesores activos en tu sede.</p></div></td></tr>'}
    </tbody></table>
  </div>`;
  if(isManager() && ownManagerSalary && Number(ownManagerSalary.managerPunctualStaffBonus||0)>0) h+=`<div class="table-wrap dashboard-compact-panel" style="margin:0 0 1rem"><div class="table-header"><div><div class="table-title">Bono por puntualidad de asesores</div><div class="page-sub">Total ganado: ${money(ownManagerSalary.managerPunctualStaffBonus)} · ${ownManagerSalary.managerPunctualStaffCount||0} colaborador(es) que cumplen</div></div></div><div class="salary-detail-lines" style="padding:0 1rem 1rem"><div class="salary-detail-lines-inner">${punctualDetail || '<div><span>Sin colaboradores que cumplan la condición</span><strong>S/ 0.00</strong></div>'}</div></div></div>`;
  h+=`<div class="dashboard-summary-grid">
    <div class="dashboard-summary-card green">
      <div>
        <div class="dashboard-summary-label">${isManager()?'Ganancia equipo sede':'Ganancia total equipo'}</div>
        <div class="dashboard-summary-value">${money(teamEarnings)}</div>
        <div class="dashboard-summary-sub">${teamUsers.length} colaborador(es) considerados</div>
      </div>
      <div class="dashboard-summary-icon">&#128179;</div>
    </div>
    <div class="dashboard-summary-card amber">
      <div>
        <div class="dashboard-summary-label">Pendientes en plazo</div>
        <div class="dashboard-summary-value">${regs.length}</div>
        <div class="dashboard-summary-sub">Potencial S/ ${(regs.length*getCommissionRate()).toFixed(2)}</div>
      </div>
      <div class="dashboard-summary-icon">&#128339;</div>
    </div>
    <div class="dashboard-summary-card blue">
      <div>
        <div class="dashboard-summary-label">Pendientes de aprobacion</div>
        <div class="dashboard-summary-value">${pendingValidation.length}</div>
        <div class="dashboard-summary-sub">Esperando revision</div>
      </div>
      <div class="dashboard-summary-icon">&#128196;</div>
    </div>
    <div class="dashboard-summary-card red" data-duplicate-alerts="${dashboardMonth}" title="Ver DNIs duplicados">
      <div>
        <div class="dashboard-summary-label">Duplicados</div>
        <div class="dashboard-summary-value">${duplicateAlerts.length}</div>
        <div class="dashboard-summary-sub">DNIs repetidos</div>
      </div>
      <div class="dashboard-summary-icon">&#128209;</div>
    </div>
    <div class="dashboard-summary-card purple">
      <div>
        <div class="dashboard-summary-label">Expirados sin operacion</div>
        <div class="dashboard-summary-value">${expired.length}</div>
        <div class="dashboard-summary-sub">Sin comision</div>
      </div>
      <div class="dashboard-summary-icon">&#128467;</div>
    </div>
  </div>
  <div class="table-wrap dashboard-compact-panel" style="margin-bottom:1rem">
    <div class="table-header">
      <div>
        <div class="table-title">${isAdmin()?'Comisiones por usuario':'Comisiones de tu sede'}</div>
        <div class="page-sub">Mes visible: ${monthLabelFromKey(dashboardMonth)}</div>
      </div>
      ${monthFilterSelectHtml('dashboardMonth', dashboardMonth, { includeEmpty:false, count:24, extraValues: MONTHLY_CLOSURES.map(item=>item.month) })}
    </div>
    ${topUsers.length?`<div class="dashboard-top-strip">${topUsers.map((item,index)=>`<button class="dashboard-top-pill" data-dashboard-user="${item.user.id}" type="button"><span>#${index+1}</span>${avatar(item.user,30,10)}<strong>${esc(item.user.name)}</strong><em>${money(item.commission)}</em></button>`).join('')}</div>`:''}
    <table class="dashboard-compact-table">
      <thead><tr><th>Colaborador</th><th>Sede</th><th>Comision</th><th>Validadas</th><th>Pendientes</th><th>Avance</th><th></th></tr></thead>
      <tbody>
        ${userSummaries.map(item=>`<tr class="click-row" data-dashboard-user="${item.user.id}">
          <td><div class="dashboard-compact-person">${avatar(item.user,34,11)}<div><strong>${esc(item.user.name)}</strong><span>@${esc(item.user.username)}</span></div></div></td>
          <td>${esc(userSede(item.user))}</td>
          <td class="dashboard-compact-money">${money(item.commission)}</td>
          <td>${item.validated}</td>
          <td>${item.pending}</td>
          <td><div class="dashboard-compact-progress"><span style="width:${item.progress}%"></span></div></td>
          <td><button class="pill-action" type="button">Ver</button></td>
        </tr>`).join('') || '<tr><td colspan="7"><div class="empty-state"><div class="es-icon">&#128202;</div><p>No hay usuarios visibles para mostrar en el dashboard.</p></div></td></tr>'}
      </tbody>
    </table>
  </div>
  <div class="dashboard-note"><span>&#9432;</span>Los montos mostrados corresponden a comisiones confirmadas de ${monthLabelFromKey(dashboardMonth)}.</div>
  </section>`;
  return h;
}

function renderLimitedDashboardRows(items, renderItem, emptyHtml){
  if(!items.length) return emptyHtml;
  const first=items.slice(0,5).map(renderItem).join('');
  const rest=items.slice(5).map(renderItem).join('');
  if(!rest) return first;
  return `${first}<details class="dashboard-more"><summary>Ver m-s (${items.length-5})</summary><div class="dashboard-more-list">${rest}</div></details>`;
}

function dashboardMetricCard(icon, label, value, tone='green'){
  return `<div class="dashboard-metric-card ${tone}">
    <div class="dashboard-metric-icon">${icon}</div>
    <div>
      <div class="dashboard-metric-label">${label}</div>
      <div class="dashboard-metric-value">${value}</div>
    </div>
  </div>`;
}

function dashboardLine(label, value, tone=''){
  return `<div class="dashboard-line"><span>${label}</span><strong class="${tone}">${value}</strong></div>`;
}

function managerPunctualStaffRows(person, { compact=false }={}){
  const rows=Array.isArray(person?.managerPunctualStaffList) ? person.managerPunctualStaffList : [];
  const rate=Number(person?.managerPunctualStaffBonusRate || DEFAULT_MANAGER_PUNCTUAL_STAFF_BONUS);
  return rows.map(item=>{
    const share=Number(item.share || 1);
    const amount=Number((rate * share).toFixed(2));
    const daysText=Number(item.workedDays || 0) ? ` - ${item.workedDays} dia(s) puntuales` : '';
    const shareText=share<0.999 ? ` - ${(share*100).toFixed(0)}%` : '';
    const label=`${item.personName || 'Sin nombre'}${daysText}${shareText}`;
    return compact
      ? `<div><span>${esc(label)}</span><strong>${money(amount)}</strong></div>`
      : `<div class="dashboard-line tiny"><span>${esc(label)}</span><strong>${money(amount)}</strong></div>`;
  }).join('');
}

function dashboardDetailList(title, count, rowsHtml){
  return `<details class="dashboard-nested-list">
    <summary>${title} (${count})</summary>
    <div class="dashboard-nested-body">${rowsHtml}</div>
  </details>`;
}

function dashboardSectionCard(icon, title, rowsHtml, tone='', extraHtml=''){
  return `<section class="dashboard-section-card ${tone}">
    <div class="dashboard-section-head">
      <div class="dashboard-section-icon">${icon}</div>
      <h4>${title}</h4>
    </div>
    <div class="dashboard-section-body">
      ${rowsHtml}
      ${extraHtml}
    </div>
  </section>`;
}

function renderDashboardDetailModal(){
  const selectedUser=getVisibleUsers().find(u=>String(u.id)===String(state.dashboardUserId));
  if(!selectedUser){
    return `<div class="modal-overlay" id="dashboardDetailOverlay"><div class="modal dashboard-detail-modal"><h3>Detalle de colaborador</h3><p class="page-sub">No se encontro el colaborador seleccionado.</p><div class="modal-actions"><button class="btn-cancel" data-dashboard-close>Cerrar</button></div></div></div>`;
  }
  const detailMonth=activeMonthKey(state.dashboardMonth);
  const visibleRecords=getVisibleRecords().filter(record=>recordAccountingMonthKey(record)===detailMonth);
  const userRecords=visibleRecords.filter(r=>r.userId===selectedUser.id);
  const userRatings=RATINGS.filter(row=>Number(row.matchedUserId)===Number(selectedUser.id) && monthKeyFromDate(row.approvedAt || row.date || row.rawDate)===detailMonth);
  const userPenalties=PENALTY_REPORTS.filter(report=>Number(report.workerUserId)===Number(selectedUser.id) && monthKeyFromDate(report.decidedAt || report.createdAt)===detailMonth);
  const userCalls=CALL_REPORTS.filter(report=>Number(report.userId)===Number(selectedUser.id) && monthKeyFromDate(report.validatedAt || report.createdAt)===detailMonth);
  const attendancePerson=ATTENDANCE?.people?.find(person=>userForAttendancePerson(person)?.id===selectedUser.id);
  const salaryData=ATTENDANCE ? getSalaryPeople({ date:monthDateFromKey(detailMonth) }) : null;
  const salaryPerson=salaryData ? (salaryData.people||[]).find(person=>Number(userForAttendancePerson(person)?.id || 0)===Number(selectedUser.id || 0)) : null;
  const validatedRecords=userRecords.filter(record=>record.validatedAt).length;
  const pendingRecords=userRecords.filter(record=>!record.validatedAt && !record.rejectedAt).length;
  const rejectedRecords=userRecords.filter(record=>record.rejectedAt).length;
  const approvedRatings=userRatings.filter(row=>row.payable).length;
  const pendingRatings=userRatings.filter(row=>row.approvalStatus==='PENDING').length;
  const rejectedRatings=userRatings.filter(row=>row.approvalStatus==='REJECTED' || row.approvalStatus==='AUTO_REJECTED').length;
  const approvedPenalties=userPenalties.filter(report=>report.status==='APPROVED').length;
  const pendingPenalties=userPenalties.filter(report=>report.status==='PENDING').length;
  const rejectedPenalties=userPenalties.filter(report=>report.status==='REJECTED').length;
  const approvedCalls=userCalls.filter(call=>call.status==='APPROVED').length;
  const pendingCalls=userCalls.filter(call=>call.status==='PENDING').length;
  const rejectedCalls=userCalls.filter(call=>call.status==='REJECTED').length;
  const attendanceRows=salaryPerson?.dayPayments || [];
  const attendedDays=attendanceRows.filter(day=>Number(day.dailyPay || 0)>0 || attendanceDayWorked(day)).length;
  const absentDays=attendanceRows.filter(day=>
    day.entryStatus==='Sin entrada' &&
    day.exitStatus==='Sin salida' &&
    !day.justifiedDay &&
    !isPaidNationalHoliday(day) &&
    !peruNationalHoliday(day.date) &&
    Number(day.dailyPay || 0)<=0
  ).length;
  const attendanceBase=attendedDays + absentDays;
  const attendancePct=attendanceBase?`${Math.round((attendedDays/attendanceBase)*100)}%`:'-';
  const attendanceSectionRows=ATTENDANCE_LOADING && !ATTENDANCE
    ? '<div class="dashboard-line"><span>Cargando asistencia</span><strong>...</strong></div>'
    : attendancePerson ? [
        dashboardLine('Dias asistidos', attendedDays, attendedDays?'green':'muted'),
        dashboardLine('Dias ausentes', absentDays, absentDays?'red':'muted'),
        dashboardLine('Porcentaje de asistencia', attendancePct, ''),
        dashboardLine('Pago calculado', salaryPerson?money(salaryPerson.estimatedSalary):'Cargando', 'green')
      ].join('')
    : '<div class="dashboard-line"><span>Sin asistencia cargada</span><strong>-</strong></div>';
  const recordDetails=dashboardDetailList('Ver registros', userRecords.length, renderLimitedDashboardRows(
    userRecords,
    record=>`<div class="dashboard-line tiny"><span>${esc(record.cliente)} - DNI ${esc(record.dni)} - ${record.validatedAt?'Validado':record.rejectedAt?'Rechazado':'Pendiente'}</span><strong>${record.validatedAt?money(getCommissionRate()):'S/ 0.00'}</strong></div>`,
    '<div class="dashboard-line tiny"><span>Sin registros</span><strong>-</strong></div>'
  ));
  const ratingDetails=dashboardDetailList('Ver calificaciones', userRatings.length, renderLimitedDashboardRows(
    userRatings,
    row=>`<div class="dashboard-line tiny"><span>${fmtDateTime(row.date || row.rawDate)} - ${row.rating} estrella(s) - ${row.approvalStatus}</span><strong>${row.payable?money(row.amount):'S/ 0.00'}</strong></div>`,
    '<div class="dashboard-line tiny"><span>Sin calificaciones</span><strong>-</strong></div>'
  ));
  const penaltyDetails=dashboardDetailList('Ver reportes', userPenalties.length, renderLimitedDashboardRows(
    userPenalties,
    report=>`<div class="dashboard-line tiny"><span>${esc(report.penaltyLabel)} - ${esc(report.clientName)} - ${report.status}</span><strong>${money(report.penaltyAmount)}</strong></div>`,
    '<div class="dashboard-line tiny"><span>Sin reportes</span><strong>-</strong></div>'
  ));
  const callDetails=dashboardDetailList('Ver llamadas', userCalls.length, renderLimitedDashboardRows(
    userCalls,
    call=>`<div class="dashboard-line tiny"><span>${esc(call.cliente)} - ${fmtDateTime(call.createdAt)} - ${call.status}</span><strong>${call.status==='APPROVED'?money(call.bonusAmount):'S/ 0.00'}</strong></div>`,
    '<div class="dashboard-line tiny"><span>Sin llamadas</span><strong>-</strong></div>'
  ));
  const managerPunctualRows=managerPunctualStaffRows(salaryPerson);
  const managerPunctualSection=salaryPerson && Number(salaryPerson.managerPunctualStaffBonus || 0)>0
    ? dashboardSectionCard('&#9200;','Bono por personal puntual', [
        dashboardLine('Total ganado', money(salaryPerson.managerPunctualStaffBonus), 'green'),
        dashboardLine('Monto por persona', money(salaryPerson.managerPunctualStaffBonusRate || DEFAULT_MANAGER_PUNCTUAL_STAFF_BONUS), ''),
        dashboardLine('Personal que aplica', salaryPerson.managerPunctualStaffCount || 0, '')
      ].join(''), 'teal wide', dashboardDetailList('Ver personal puntual', salaryPerson.managerPunctualStaffCount || 0, managerPunctualRows || '<div class="dashboard-line tiny"><span>Sin personal puntual</span><strong>-</strong></div>'))
    : '';
  return `<div class="modal-overlay dashboard-detail-overlay" id="dashboardDetailOverlay">
    <div class="modal dashboard-detail-modal">
      <div class="dashboard-modal-head">
        <div>
          <div class="dialog-kicker">Detalle del colaborador</div>
          <h3>${esc(selectedUser.name)}</h3>
          <div class="page-sub">@${esc(selectedUser.username)} - ${userSede(selectedUser)}</div>
        </div>
        <button class="btn-sm" data-dashboard-close>Cerrar</button>
      </div>
      <div class="dashboard-modal-stats">
        ${dashboardMetricCard('&#10003;','Registros validados',validatedRecords,'blue')}
        ${dashboardMetricCard('&#9733;','Calificaciones aprobadas',approvedRatings,'purple')}
        ${dashboardMetricCard('&#9888;','Penalidades aprobadas',approvedPenalties,'red')}
        ${dashboardMetricCard('&#9742;','Llamadas aprobadas',approvedCalls,'teal')}
      </div>
      <div class="dashboard-detail-grid">
        ${dashboardSectionCard('&#128196;','Registros', [
          dashboardLine('Registros validados', validatedRecords, 'green'),
          dashboardLine('Registros pendientes', pendingRecords, 'muted'),
          dashboardLine('Registros rechazados', rejectedRecords, 'red')
        ].join(''), 'blue', recordDetails)}
        ${dashboardSectionCard('&#128337;','Asistencia', attendanceSectionRows, 'teal')}
        ${dashboardSectionCard('&#9733;','Calificaciones', [
          dashboardLine('Calificaciones aprobadas', approvedRatings, 'green'),
          dashboardLine('Calificaciones pendientes', pendingRatings, 'muted'),
          dashboardLine('Calificaciones rechazadas', rejectedRatings, 'red')
        ].join(''), 'purple', ratingDetails)}
        ${dashboardSectionCard('&#9888;','Reportes / penalidades', [
          dashboardLine('Penalidades aprobadas', approvedPenalties, 'red'),
          dashboardLine('Penalidades pendientes', pendingPenalties, 'muted'),
          dashboardLine('Penalidades rechazadas', rejectedPenalties, 'muted')
        ].join(''), 'red', penaltyDetails)}
        ${dashboardSectionCard('&#9742;','Llamadas', [
          dashboardLine('Llamadas aprobadas', approvedCalls, 'green'),
          dashboardLine('Llamadas pendientes', pendingCalls, 'muted'),
          dashboardLine('Llamadas rechazadas', rejectedCalls, 'red')
        ].join(''), 'teal wide', callDetails)}
        ${managerPunctualSection}
      </div>
    </div>
  </div>`;
}

function bindDashboardDetailModal(){
  const close=()=>{
    state.dashboardUserId=null;
    render();
  };
  const overlay=document.getElementById('dashboardDetailOverlay');
  document.querySelectorAll('[data-dashboard-close]').forEach(btn=>{ btn.onclick=close; });
  if(overlay){
    overlay.onclick=e=>{ if(e.target===overlay) close(); };
  }
  document.onkeydown=e=>{
    if(e.key==='Escape' && state.dashboardUserId) close();
  };
}

function buildStatsRankingRows(users, month, sedeFilter=''){
  const scopedUsers=users.filter(user=>!sedeFilter || userSede(user)===sedeFilter);
  const salaryPeople=ATTENDANCE ? ((getSalaryPeople({ ignoreFilters:true, date:monthDateFromKey(month) }) || {}).people || []) : [];
  const salaryByUserId=new Map();
  salaryPeople.forEach(person=>{
    const linkedUser=userForAttendancePerson(person);
    if(linkedUser) salaryByUserId.set(Number(linkedUser.id), person);
  });
  return scopedUsers.map(user=>{
    const salaryPerson=salaryByUserId.get(Number(user.id)) || null;
    const userRecords=RECORDS.filter(record=>Number(record.userId)===Number(user.id) && recordAccountingMonthKey(record)===month);
    const validatedRecords=userRecords.filter(record=>!!record.validatedAt);
    const calls=CALL_REPORTS.filter(report=>Number(report.userId)===Number(user.id) && (report.status==='APPROVED' || report.validatedAt) && monthKeyFromDate(report.validatedAt || report.createdAt)===month);
    const referrals=REFERRALS.filter(referral=>Number(referral.userId)===Number(user.id) && !!referral.validatedAt && monthKeyFromDate(referral.validatedAt || referral.createdAt)===month);
    const wrongCards=WRONG_CARDS.filter(report=>Number(report.userId)===Number(user.id) && (report.status==='APPROVED' || report.validatedAt) && monthKeyFromDate(report.validatedAt || report.detectedDate || report.createdAt)===month);
    const ratings=RATINGS.filter(row=>Number(row.matchedUserId)===Number(user.id) && row.payable && monthKeyFromDate(row.approvedAt || row.date || row.rawDate)===month);
    const registrations=userRecords.filter(record=>record.tipo==='registro');
    const operationsWithinSeven=userRecords.filter(record=>record.tipo==='operacion' && operatedWithinWindow(record));
    return {
      user,
      sede:userSede(user),
      records:registrations.length,
      operations:operationsWithinSeven.length,
      validated:validatedRecords.length,
      pending:userRecords.filter(record=>isPendingApproval(record)).length,
      calls:calls.length,
      ratings:ratings.length,
      referrals:referrals.length,
      wrongCards:wrongCards.length,
      workedDays:Number(salaryPerson?.workedDays || 0),
      lateEntries:Number(salaryPerson?.lateEntries || 0),
      lateMinutes:Number(salaryPerson?.totalLateMinutes || 0),
      punctual:Number(salaryPerson?.workedDays || 0)>0 && Number(salaryPerson?.lateEntries || 0)===0 ? Number(salaryPerson?.workedDays || 0) : 0,
      totalIncentive:getTotalIncentiveForUser(user, month)
    };
  });
}
function topStatsRows(rows, key, limit=5){
  return rows
    .filter(row=>Number(row[key] || 0)>0)
    .slice()
    .sort((a,b)=>Number(b[key]||0)-Number(a[key]||0) || Number(b.totalIncentive||0)-Number(a.totalIncentive||0) || a.user.name.localeCompare(b.user.name))
    .slice(0, limit);
}
function renderStatsRankingColumn(title, rows, key, formatter=value=>String(value)){
  return `<section class="stats-rank-card">
    <div class="stats-rank-card-title">${title}</div>
    <div class="stats-rank-list">
      ${rows.length ? rows.map((row,index)=>`<div class="stats-rank-item">
        <div class="stats-rank-pos">${index+1}</div>
        ${avatar(row.user,32,11)}
        <div class="stats-rank-person"><strong>${esc(row.user.name)}</strong><span>${esc(row.sede)} - @${esc(row.user.username)}</span></div>
        <div class="stats-rank-value">${formatter(row[key], row)}</div>
      </div>`).join('') : `<div class="empty-state compact"><div class="es-icon">-</div><p>Sin datos</p></div>`}
    </div>
  </section>`;
}

function renderEstadisticas(){
  const statsMonth=activeMonthKey(state.recordsMonth);
  if(!ratingsLoadedFor(statsMonth)){
    if(!RATINGS_LOADING) setTimeout(()=>loadRatings(false, false, statsMonth), 0);
  }
  if(!ATTENDANCE && !ATTENDANCE_LOADING){
    setTimeout(()=>loadAttendance(false), 0);
  }
  const selectedStatsSede=(isAdmin() || canPreviewAllSedesAsManager()) ? (state.statsSede || state.managerViewSede || '') : userSede(state.currentUser);
  const trendMonths=String(state.statsTrendMonths)==='6' ? 6 : 3;
  const trendKey=statsTrendCacheKey(statsMonth, selectedStatsSede, trendMonths);
  if(STATS_TREND_KEY!==trendKey && !STATS_TREND_LOADING) setTimeout(()=>loadStatsTrend(statsMonth, selectedStatsSede, trendMonths), 0);
  const archivedRecords=visibleArchivedRecordsForMonth(statsMonth);
  const periodRecords=(archivedRecords.length ? archivedRecords : getVisibleRecords())
    .filter(record=>recordAccountingMonthKey(record)===statsMonth)
    .filter(record=>!selectedStatsSede || getItemSede(record)===selectedStatsSede);
  const allPeriodRecords=(archivedRecords.length ? archivedRecords : getVisibleRecords())
    .filter(record=>recordAccountingMonthKey(record)===statsMonth);
  const visibleRecords=periodRecords;
  const visibleUsers=getVisibleUsers().filter(u=>u.role!=='admin' && (!selectedStatsSede || userSede(u)===selectedStatsSede));
  const totalRecords=visibleRecords.length;
  const virtualCount=visibleRecords.filter(r=>(r.modalidad||'virtual')==='virtual').length;
  const presencialCount=visibleRecords.filter(r=>r.modalidad==='presencial').length;
  const validatedCount=visibleRecords.filter(r=>!!r.validatedAt).length;
  const pendingApprovalCount=visibleRecords.filter(r=>isPendingApproval(r)).length;
  const operationCount=visibleRecords.filter(r=>r.tipo==='operacion').length;
  const registrationCount=visibleRecords.filter(r=>r.tipo==='registro').length;
  const expiredWithoutOperationCount=visibleRecords.filter(record=>
    record.tipo==='registro' && !record.fechaOperacion && !record.rejectedAt && daysSince(record.fecha || record.registrationDate || record.createdAt)>EXPIRE_DAY
  ).length;
  const virtualPct=totalRecords?((virtualCount/totalRecords)*100):0;
  const presencialPct=totalRecords?((presencialCount/totalRecords)*100):0;
  const avgPerUser=visibleUsers.length?(totalRecords/visibleUsers.length):0;
  const monthStart=`${statsMonth}-01`;
  const monthEnd=monthLastDateKey(statsMonth);
  const todayKey=dashboardLocalDateKey();
  const visibleEnd=statsMonth===todayKey.slice(0,7) ? todayKey : monthEnd;
  const statsDates=[];
  for(let cursor=new Date(`${monthStart}T12:00:00`), end=new Date(`${visibleEnd}T12:00:00`); cursor<=end; cursor.setDate(cursor.getDate()+1)) statsDates.push(dashboardLocalDateKey(cursor));
  const selectedRatings=RATINGS.filter(row=>{
    const date=isoDate(row.date || row.rawDate || row.approvedAt);
    if(date<monthStart || date>visibleEnd) return false;
    return !selectedStatsSede || normalizeSede(row.sede)===selectedStatsSede;
  });
  const dailyStatsRows=statsDates.map(date=>{
    const rows=visibleRecords.filter(record=>isoDate(record.fecha || record.registrationDate || record.createdAt)===date);
    return {
      date,
      total:rows.length,
      virtual:rows.filter(record=>(record.modalidad||'virtual')==='virtual').length,
      presencial:rows.filter(record=>record.modalidad==='presencial').length,
      validated:rows.filter(record=>!!record.validatedAt).length,
      ratings:selectedRatings.filter(row=>isoDate(row.date || row.rawDate || row.approvedAt)===date).length
    };
  });
  const calendarDays=Math.max(1, statsDates.length);
  const activeDays=dailyStatsRows.filter(row=>row.total>0 || row.ratings>0).length;
  const averagePerDay={
    records:totalRecords/calendarDays,
    virtual:virtualCount/calendarDays,
    presencial:presencialCount/calendarDays,
    validated:validatedCount/calendarDays,
    ratings:selectedRatings.length/calendarDays
  };
  const rankingRows=buildStatsRankingRows(getVisibleUsers().filter(u=>u.role!=='admin'), statsMonth, selectedStatsSede);
  const ranking=visibleUsers.map(user=>{
    const userRecords=visibleRecords.filter(r=>r.userId===user.id);
    const validated=userRecords.filter(r=>!!r.validatedAt).length;
    const pending=userRecords.filter(r=>isPendingApproval(r)).length;
    return {
      user,
      total:userRecords.length,
      validated,
      pending,
      commission:calcUserCommission(user, statsMonth),
      virtual:userRecords.filter(r=>(r.modalidad||'virtual')==='virtual').length,
      presencial:userRecords.filter(r=>r.modalidad==='presencial').length
    };
  }).sort((a,b)=>b.total-a.total || b.validated-a.validated || a.user.name.localeCompare(b.user.name));
  const updatedLabel=`Hoy, ${new Intl.DateTimeFormat('es-PE',{ day:'numeric', month:'short', year:'numeric', hour:'numeric', minute:'2-digit' }).format(new Date())}`;
  const sparkline=(points, tone='blue')=>`<div class="stats-sparkline ${tone}"><span style="clip-path:polygon(${points.map((value,index)=>`${(index/(Math.max(points.length-1,1)))*100}% ${100-Math.max(10, Math.min(86, value))}%`).join(',')},100% 100%,0 100%)"></span></div>`;
  const topMetricContributors=(predicate)=>visibleUsers.map(user=>({
    user,
    count:visibleRecords.filter(record=>Number(record.userId)===Number(user.id) && predicate(record)).length
  })).filter(row=>row.count>0).sort((a,b)=>b.count-a.count || a.user.name.localeCompare(b.user.name)).slice(0,3);
  const metricParameters=(rows, unit, predicate)=>{
    const scopeRecords=(isAdmin() || canPreviewAllSedesAsManager()) ? allPeriodRecords : visibleRecords;
    const sedeRows=SEDES.map(sede=>{
      const count=scopeRecords.filter(record=>getItemSede(record)===sede && predicate(record)).length;
      return { sede, count };
    }).filter(row=>row.count>0);
    const total=sedeRows.reduce((sum,row)=>sum+row.count,0);
    return `<details class="stats-card-parameters"><summary>Parámetros</summary><div class="stats-card-parameters-list">
      <div class="stats-card-parameter-row" style="font-weight:800;color:var(--text2)"><span class="stats-card-parameter-name">Por sede</span><span class="stats-card-parameter-value">Cantidad · %</span></div>
      ${sedeRows.length ? sedeRows.map(row=>`<div class="stats-card-parameter-row"><span class="stats-card-parameter-name">${esc(row.sede)}</span><span class="stats-card-parameter-value">${row.count} ${unit} · ${total?((row.count/total)*100).toFixed(1):'0.0'}%</span></div>`).join('') : '<div class="stats-card-parameter-row" style="color:var(--text3)">Sin datos por sede en este período.</div>'}
      ${rows.length ? `<div class="stats-card-parameter-row" style="margin-top:8px;font-weight:800;color:var(--text2)"><span class="stats-card-parameter-name">Principales colaboradores</span><span></span></div>${rows.map((row,index)=>`<div class="stats-card-parameter-row"><span class="stats-card-parameter-position">${index+1}.</span>${avatar(row.user,20,8)}<span class="stats-card-parameter-name">${esc(row.user.name)}</span><span class="stats-card-parameter-value">${row.count} ${unit}</span></div>`).join('')}` : ''}
    </div></details>`;
  };
  const summaryCards=[
    { tone:'purple', icon:'&#128196;', label:'Registros totales', value:totalRecords, sub:`${visibleUsers.length} usuario(s) visibles`, detail:metricParameters(topMetricContributors(()=>true), 'reg.', ()=>true) },
    { tone:'green', icon:'&#128187;', label:'Virtuales', value:virtualCount, sub:`${virtualPct.toFixed(1)}% del total`, detail:metricParameters(topMetricContributors(record=>(record.modalidad||'virtual')==='virtual'), 'virt.', record=>(record.modalidad||'virtual')==='virtual') },
    { tone:'amber', icon:'&#128100;', label:'Presenciales', value:presencialCount, sub:`${presencialPct.toFixed(1)}% del total`, detail:metricParameters(topMetricContributors(record=>record.modalidad==='presencial'), 'pres.', record=>record.modalidad==='presencial') },
    { tone:'blue', icon:'&#10003;', label:'Validados', value:validatedCount, sub:`${pendingApprovalCount} pendientes de aprobacion`, detail:metricParameters(topMetricContributors(record=>!!record.validatedAt), 'val.', record=>!!record.validatedAt) },
    { tone:'pink', icon:'&#9888;', label:'Registros sin operacion', value:expiredWithoutOperationCount, sub:`Vencidos: mas de ${EXPIRE_DAY} dias sin efectivizar`, detail:metricParameters(topMetricContributors(record=>record.tipo==='registro' && !record.fechaOperacion && !record.rejectedAt && daysSince(record.fecha || record.registrationDate || record.createdAt)>EXPIRE_DAY), 'pend.', record=>record.tipo==='registro' && !record.fechaOperacion && !record.rejectedAt && daysSince(record.fecha || record.registrationDate || record.createdAt)>EXPIRE_DAY) }
  ];

  let h=`<section class="stats-shell">
  <div class="page-header"><div class="page-title">Estadisticas</div><div class="page-sub">${selectedStatsSede?`Resumen de sede ${selectedStatsSede}`:'Resumen general de todas las sedes'} - ${monthLabelFromKey(statsMonth)}</div></div>
  <div class="table-wrap" style="margin-bottom:1rem"><div class="table-header"><div class="table-title">Filtros de estadisticas</div>${monthFilterSelectHtml('recordsMonth', statsMonth, { includeEmpty:false, count:24, extraValues: MONTHLY_CLOSURES.map(item=>item.month) })}${(isAdmin()||canPreviewAllSedesAsManager())?`<select class="filter-select" id="statsSede"><option value="">Todas las sedes</option>${SEDES.map(sede=>`<option value="${sede}"${selectedStatsSede===sede?' selected':''}>${sede}</option>`).join('')}</select>`:`<span class="days-chip ok">${selectedStatsSede}</span>`}</div></div>
  <div class="stats-card-grid">${summaryCards.map(card=>`<article class="stats-summary-card ${card.tone}">
    <div class="stats-summary-icon">${card.icon}</div>
    <div class="stats-summary-label">${card.label}</div>
    <div class="stats-summary-value">${card.value}</div>
    <div class="stats-summary-sub">${card.sub}</div>
    ${card.detail}
  </article>`).join('')}</div>`;

  if(isAdmin() || canPreviewAllSedesAsManager()){
    const compareSedeA=state.statsCompareSedeA || SEDES[0] || '';
    const compareSedeB=state.statsCompareSedeB || SEDES.find(sede=>sede!==compareSedeA) || compareSedeA;
    const selectedCompareSedes=[compareSedeA, compareSedeB].filter((sede,index,list)=>sede && list.indexOf(sede)===index);
    const compareRows=selectedCompareSedes.map(sede=>{
      const rows=allPeriodRecords.filter(record=>getItemSede(record)===sede);
      const virtual=rows.filter(record=>(record.modalidad||'virtual')==='virtual').length;
      const presencial=rows.filter(record=>record.modalidad==='presencial').length;
      const validated=rows.filter(record=>!!record.validatedAt).length;
      return { sede, records:rows.length, virtual, presencial, validated, validationRate:rows.length?(validated/rows.length)*100:0 };
    });
    const comparedTotal=compareRows.reduce((sum,row)=>sum+row.records,0);
    h+=`<section class="stats-section-panel" style="margin:1.25rem 0 1.5rem">
      <div class="stats-section-head"><div><div class="stats-section-title">&#8644; Comparar entre sedes</div><div class="stats-section-sub">Elige dos sedes para ver sus resultados y la participación que representa cada una en el período.</div></div></div>
      <div class="stats-compare-filters" style="display:flex;gap:.75rem;flex-wrap:wrap;margin:0 0 1rem"><label style="display:grid;gap:.35rem;font-size:12px;color:var(--text2)">Primera sede<select class="filter-select" id="statsCompareSedeA">${SEDES.map(sede=>`<option value="${sede}"${compareSedeA===sede?' selected':''}>${sede}</option>`).join('')}</select></label><label style="display:grid;gap:.35rem;font-size:12px;color:var(--text2)">Segunda sede<select class="filter-select" id="statsCompareSedeB">${SEDES.map(sede=>`<option value="${sede}"${compareSedeB===sede?' selected':''}>${sede}</option>`).join('')}</select></label></div>
      ${compareRows.length===2 ? `<div class="table-wrap stats-table-wrap"><table><thead><tr><th>Sede</th><th>Registros</th><th>% entre elegidas</th><th>Virtuales</th><th>Presenciales</th><th>Validados</th><th>% validación</th></tr></thead><tbody>${compareRows.map(row=>`<tr><td><strong>${esc(row.sede)}</strong></td><td>${row.records}</td><td><span class="stats-commission-pill">${comparedTotal?((row.records/comparedTotal)*100).toFixed(1):'0.0'}%</span></td><td>${row.virtual} <small style="color:var(--text3)">${row.records?((row.virtual/row.records)*100).toFixed(1):'0.0'}%</small></td><td>${row.presencial} <small style="color:var(--text3)">${row.records?((row.presencial/row.records)*100).toFixed(1):'0.0'}%</small></td><td class="stats-good">${row.validated}</td><td>${row.validationRate.toFixed(1)}%</td></tr>`).join('')}<tr style="font-weight:800"><td>Total comparado</td><td>${comparedTotal}</td><td>100.0%</td><td>${compareRows.reduce((sum,row)=>sum+row.virtual,0)}</td><td>${compareRows.reduce((sum,row)=>sum+row.presencial,0)}</td><td>${compareRows.reduce((sum,row)=>sum+row.validated,0)}</td><td>-</td></tr></tbody></table></div>` : '<div class="empty-state"><p>Selecciona dos sedes distintas para compararlas.</p></div>'}
    </section>`;
  }

  const trendRows=STATS_TREND_KEY===trendKey ? STATS_TREND : [];
  const trendDelta=(value, previous)=>{
    if(previous===null || previous===undefined) return '<span class="stats-muted">Mes base</span>';
    const diff=Number(value||0)-Number(previous||0);
    const percent=previous ? (diff/previous)*100 : (value ? 100 : 0);
    const cls=diff>0?'stats-good':diff<0?'stats-warn':'stats-muted';
    const arrow=diff>0?'↑':diff<0?'↓':'→';
    return `<span class="${cls}">${arrow} ${diff>0?'+':''}${diff} (${percent>0?'+':''}${percent.toFixed(1)}%)</span>`;
  };
  const trendAverage=(key)=>trendRows.length ? trendRows.reduce((sum,row)=>sum+Number(row[key]||0),0)/trendRows.length : 0;
  h+=`<section class="stats-section-panel" style="margin:1.25rem 0 1.5rem">
    <div class="stats-section-head"><div><div class="stats-section-title">↕ Comparativo con meses anteriores</div><div class="stats-section-sub">Mira si el resultado subió o bajó respecto al mes anterior.</div></div><select class="filter-select" id="statsTrendMonths"><option value="3"${trendMonths===3?' selected':''}>Últimos 3 meses</option><option value="6"${trendMonths===6?' selected':''}>Últimos 6 meses</option></select></div>
    ${STATS_TREND_LOADING && !trendRows.length ? '<div class="empty-state"><p>Cargando comparación mensual...</p></div>' : STATS_TREND_ERROR && !trendRows.length ? `<div class="empty-state"><p>${STATS_TREND_ERROR}</p></div>` : `<div class="stats-compact-grid">
      ${[
        {tone:'purple',label:'Promedio registros / mes',value:trendAverage('records').toFixed(1)},
        {tone:'green',label:'Promedio virtuales / mes',value:trendAverage('virtual').toFixed(1)},
        {tone:'amber',label:'Promedio presenciales / mes',value:trendAverage('presencial').toFixed(1)},
        {tone:'blue',label:'Promedio validados / mes',value:trendAverage('validated').toFixed(1)},
        {tone:'pink',label:'Promedio calificaciones / mes',value:trendAverage('ratings').toFixed(1)}
      ].map(item=>`<article class="stats-compact-card ${item.tone}"><div class="stats-summary-label">${item.label}</div><div class="stats-summary-value">${item.value}</div><div class="stats-summary-sub">Promedio de ${trendMonths} meses</div></article>`).join('')}
    </div><div class="table-wrap stats-table-wrap"><table class="stats-trend-table"><thead><tr><th>Mes</th><th>Registros</th><th>Virtuales</th><th>Presenciales</th><th>Validados</th><th>Calificaciones</th></tr></thead><tbody>
      ${trendRows.map((row,index)=>{ const previous=trendRows[index-1]; const metric=(value,old)=>`<span class="stats-trend-value">${value}</span><span class="stats-trend-change">${trendDelta(value,old)}</span>`; return `<tr><td><strong>${monthLabelFromKey(row.month)}</strong>${index===trendRows.length-1?'<div style="font-size:11px;color:var(--accent);margin-top:3px">Mes seleccionado</div>':''}</td><td>${metric(row.records,previous?.records)}</td><td>${metric(row.virtual,previous?.virtual)}</td><td>${metric(row.presencial,previous?.presencial)}</td><td>${metric(row.validated,previous?.validated)}</td><td>${metric(row.ratings,previous?.ratings)}</td></tr>`; }).join('') || '<tr><td colspan="6"><div class="empty-state"><p>Sin datos para comparar.</p></div></td></tr>'}
    </tbody></table></div>`}
  </section>`;

  h+=`<section class="stats-section-panel" style="margin:1.25rem 0 1.5rem">
    <div class="stats-section-head"><div class="stats-section-title">&#128197; Promedios diarios del período</div><div class="stats-section-sub">${calendarDays} día(s) calendario · ${activeDays} día(s) con actividad</div></div>
    <div class="stats-card-grid">
      ${[
        {tone:'purple',icon:'&#128196;',label:'Registros por día',value:averagePerDay.records.toFixed(1),sub:`${totalRecords} en total`},
        {tone:'green',icon:'&#128187;',label:'Virtuales por día',value:averagePerDay.virtual.toFixed(1),sub:`${virtualCount} en total`},
        {tone:'amber',icon:'&#128100;',label:'Presenciales por día',value:averagePerDay.presencial.toFixed(1),sub:`${presencialCount} en total`},
        {tone:'blue',icon:'&#10003;',label:'Validados por día',value:averagePerDay.validated.toFixed(1),sub:`${validatedCount} en total`},
        {tone:'pink',icon:'&#9733;',label:'Calificaciones por día',value:averagePerDay.ratings.toFixed(1),sub:`${selectedRatings.length} en total`}
      ].map(card=>`<article class="stats-summary-card ${card.tone}"><div class="stats-summary-icon">${card.icon}</div><div class="stats-summary-label">${card.label}</div><div class="stats-summary-value">${card.value}</div><div class="stats-summary-sub">${card.sub}</div></article>`).join('')}
    </div>
  </section>`;

  h+=`<section class="stats-section-panel" style="margin-bottom:1.5rem">
    <div class="stats-section-head"><div class="stats-section-title">&#128202; Distribucion de modalidad</div></div>
    <div class="stats-bar-group">
      <div class="stats-bar-row"><div class="stats-bar-label">&#128187; Virtual</div><div class="stats-bar-metric">${virtualCount} <span>${virtualPct.toFixed(1)}%</span></div></div>
      <div class="stats-bar-track"><span class="virtual" style="width:${virtualPct.toFixed(1)}%"></span></div>
    </div>
    <div class="stats-bar-group">
      <div class="stats-bar-row"><div class="stats-bar-label">&#128101; Presencial</div><div class="stats-bar-metric">${presencialCount} <span class="amber">${presencialPct.toFixed(1)}%</span></div></div>
      <div class="stats-bar-track"><span class="presencial" style="width:${presencialPct.toFixed(1)}%"></span></div>
    </div>
  </section>`;

  h+=`<section class="stats-section-panel" style="margin-bottom:1.5rem"><div class="stats-section-head"><div class="stats-section-title">&#128202; Detalle día por día</div><div class="stats-section-sub">${monthLabelFromKey(statsMonth)}</div></div>
    <div class="table-wrap stats-table-wrap"><table><thead><tr><th>Día</th><th>Registros</th><th>Virtual</th><th>Presencial</th><th>Validados</th><th>Calificaciones</th></tr></thead><tbody>
      ${dailyStatsRows.map(row=>`<tr><td><strong>${fmt(row.date)}</strong></td><td>${row.total}</td><td>${row.virtual}</td><td>${row.presencial}</td><td class="stats-good">${row.validated}</td><td>${row.ratings}</td></tr>`).join('') || '<tr><td colspan="6"><div class="empty-state"><p>Sin días disponibles para este período.</p></div></td></tr>'}
      <tr style="font-weight:800"><td>TOTAL / PROMEDIO</td><td>${totalRecords} <small style="color:var(--text3)">(${averagePerDay.records.toFixed(1)}/día)</small></td><td>${virtualCount} <small style="color:var(--text3)">(${averagePerDay.virtual.toFixed(1)}/día)</small></td><td>${presencialCount} <small style="color:var(--text3)">(${averagePerDay.presencial.toFixed(1)}/día)</small></td><td>${validatedCount} <small style="color:var(--text3)">(${averagePerDay.validated.toFixed(1)}/día)</small></td><td>${selectedRatings.length} <small style="color:var(--text3)">(${averagePerDay.ratings.toFixed(1)}/día)</small></td></tr>
    </tbody></table></div></section>`;

  const rankingCards=[
    renderStatsRankingColumn('Mas registros subidos', topStatsRows(rankingRows, 'records'), 'records', value=>`${value} registro(s)`),
    renderStatsRankingColumn('Mas operaciones efectivizadas (≤ 7 días)', topStatsRows(rankingRows, 'operations'), 'operations', value=>`${value} operación(es)`),
    renderStatsRankingColumn('Mas llamadas', topStatsRows(rankingRows, 'calls'), 'calls', value=>`${value}`),
    renderStatsRankingColumn('Mas calificaciones', topStatsRows(rankingRows, 'ratings'), 'ratings', value=>`${value}`),
    renderStatsRankingColumn('Mas referidos', topStatsRows(rankingRows, 'referrals'), 'referrals', value=>`${value}`),
    renderStatsRankingColumn('Mas tarjetas erroneas', topStatsRows(rankingRows, 'wrongCards'), 'wrongCards', value=>`${value}`),
    renderStatsRankingColumn('Puntuales', topStatsRows(rankingRows, 'punctual'), 'punctual', (value,row)=>`${row.workedDays} dia(s)`),
    renderStatsRankingColumn('Mas tardanzas acumuladas', topStatsRows(rankingRows, 'lateMinutes'), 'lateMinutes', (value,row)=>`${minutesLabel(value)} - ${row.lateEntries} vez/veces`),
    renderStatsRankingColumn('Mayor ganancia', topStatsRows(rankingRows, 'totalIncentive'), 'totalIncentive', value=>money(value))
  ].join('');
  h+=`<section class="stats-section-panel" style="margin-bottom:1.5rem">
    <div class="stats-section-head"><div class="stats-section-title">&#127942; Rankings por productividad</div><div class="stats-section-sub">${selectedStatsSede?`Sede ${selectedStatsSede}`:'General - todas las sedes'}</div></div>
    <div class="stats-ranking-grid">${rankingCards}</div>
  </section>`;

  if(!selectedStatsSede){
    const sedeRows=SEDES.map(sede=>{
      const rows=rankingRows.filter(row=>row.sede===sede);
      return {
        sede,
        users:rows.length,
        records:rows.reduce((sum,row)=>sum+row.records,0),
        operations:rows.reduce((sum,row)=>sum+row.operations,0),
        calls:rows.reduce((sum,row)=>sum+row.calls,0),
        ratings:rows.reduce((sum,row)=>sum+row.ratings,0),
        totalIncentive:rows.reduce((sum,row)=>sum+row.totalIncentive,0)
      };
    });
    h+=`<section class="stats-section-panel" style="margin-bottom:1.5rem"><div class="stats-section-head"><div class="stats-section-title">&#127970; Comparativo por sede</div></div>
    <div class="table-wrap stats-table-wrap"><table><thead><tr><th>Sede</th><th>Colaboradores</th><th>Registros</th><th>Operaciones</th><th>Llamadas</th><th>Calificaciones</th><th>Ganancia</th></tr></thead><tbody>
      ${sedeRows.map(row=>`<tr><td><strong>${row.sede}</strong></td><td>${row.users}</td><td>${row.records}</td><td>${row.operations}</td><td>${row.calls}</td><td>${row.ratings}</td><td><span class="stats-commission-pill">${money(row.totalIncentive)}</span></td></tr>`).join('')}
    </tbody></table></div></section>`;
  }

  h+=`<section class="stats-section-panel"><div class="stats-section-head"><div class="stats-section-title">&#127942; Ranking de atencion al cliente con m-s registros</div></div>
  <div class="table-wrap stats-table-wrap"><table><thead><tr><th>#</th><th>Atencion al cliente</th><th>Sede</th><th>Total Registros</th><th>Virtual</th><th>Presencial</th><th>Validados</th><th>Pendientes Aprobacion</th><th>Comision</th></tr></thead><tbody>`;
  ranking.forEach((row,index)=>{
    h+=`<tr>
      <td class="stats-rank-index">${index+1}</td>
      <td><div class="stats-user-cell">${avatar(row.user,38,12)}<div><div class="stats-user-name">${row.user.name}</div><div class="stats-user-handle">@${row.user.username}</div></div></div></td>
      <td>${userSede(row.user)}</td>
      <td style="font-weight:700">${row.total}</td>
      <td>${row.virtual}</td>
      <td>${row.presencial}</td>
      <td class="stats-good">${row.validated}</td>
      <td class="${row.pending?'stats-warn':'stats-muted'}">${row.pending}</td>
      <td><span class="stats-commission-pill">S/ ${row.commission.toFixed(2)}</span></td>
    </tr>`;
  });
  if(!ranking.length) h+=`<tr><td colspan="9"><div class="empty-state"><div class="es-icon">-</div><p>Aun no hay atencion al cliente con registros visibles para mostrar estadisticas.</p></div></td></tr>`;
  h+=`</tbody></table></div></section>
  <div class="stats-footer-note"><span>&#9432;</span><div>Los datos se actualizan en tiempo real.</div><strong>Ultima actualizacion: ${updatedLabel}</strong></div>
  </section>`;
  return h;
}

function getPenaltyWorkersForTarget(){
  const target=state.penaltySede || (isManager()?SEDES.find(s=>s!==userSede(state.currentUser)):'Lince') || 'Lince';
  return PENALTY_REPORT_USERS
    .filter(user=>user.role!=='admin' && userSede(user)===target)
    .sort((a,b)=>a.name.localeCompare(b.name));
}
function getFilteredPenaltyReports(){
  const month=activeMonthKey(state.penaltyMonth);
  let rows=[...PENALTY_REPORTS].filter(report=>!isPaymentAuditReport(report));
  rows=rows.filter(r=>monthKeyFromDate(r.decidedAt || r.createdAt)===month);
  rows=rows.filter(r=>dateMatchesQuickPeriod(r.createdAt || r.decidedAt));
  if(!isAdmin() && !isManager()){
    rows=rows.filter(r=>Number(r.workerUserId)===Number(state.currentUser.id));
  }else if(state.penaltyTab==='received'){
    rows=isAdmin()?rows.filter(r=>r.status==='PENDING'):rows.filter(r=>r.targetSede===userSede(state.currentUser));
  }else if(state.penaltyTab==='sent'){
    rows=rows.filter(r=>r.sentById===state.currentUser.id);
  }else if(state.penaltyTab==='history'){
    rows=rows.filter(r=>r.status!=='PENDING');
  }
  if(state.penaltyStatus) rows=rows.filter(r=>r.status===state.penaltyStatus);
  if(state.penaltySede && state.penaltyTab!=='new') rows=rows.filter(r=>r.targetSede===state.penaltySede || r.workerSede===state.penaltySede);
  if(state.penaltyWorker) rows=rows.filter(r=>String(r.workerUserId||'')===String(state.penaltyWorker));
  if(state.penaltySearch){
    const q=state.penaltySearch.toLowerCase();
    rows=rows.filter(r=>
      r.clientDni.toLowerCase().includes(q) ||
      r.clientName.toLowerCase().includes(q) ||
      r.workerName.toLowerCase().includes(q) ||
      r.penaltyLabel.toLowerCase().includes(q) ||
      r.reason.toLowerCase().includes(q)
    );
  }
  rows.sort((a,b)=>Number(b.id)-Number(a.id));
  return rows;
}
function renderPenaltyReportRow(report){
  const status=penaltyStatusMeta(report.status);
  const canDecide=
    canEditMonth(monthKeyFromDate(report.decidedAt || report.createdAt)) &&
    (isAdmin() || (isManager() && report.targetSede===userSede(state.currentUser))) &&
    report.status==='PENDING';
  const actions=[
    canDecide ? `<button class="pill-action success" data-penalty-approve="${report.id}">Aprobar</button>` : '',
    canDecide ? `<button class="pill-action danger" data-penalty-reject="${report.id}">Rechazar</button>` : '',
    isAdmin() ? `<button class="pill-action danger ghost" data-penalty-delete="${report.id}">Eliminar</button>` : ''
  ].filter(Boolean).join('');
  return `<tr>
    <td><strong>${report.clientName}</strong><div style="font-size:11px;color:var(--text3);margin-top:3px">DNI ${report.clientDni}</div></td>
    <td>${compactPersonCell(report.workerName, report.workerSede)}</td>
    <td><span class="badge drive">${report.penaltyLabel}</span></td>
    <td><div style="max-width:340px;line-height:1.35">${report.reason}</div></td>
    <td><div>${report.sentBy?.name || 'Jefe de sede'}</div><div style="font-size:11px;color:var(--text3);margin-top:3px">${report.sentBy?userSede(report.sentBy):'-'} ? ${report.targetSede}</div></td>
    <td><span class="days-chip ${status.cls}">${status.label}</span>${report.decisionReason?`<div style="font-size:11px;color:var(--text2);margin-top:5px">${report.decisionReason}</div>`:''}</td>
    <td>${fmtDateTime(report.createdAt)}</td>
    <td>${actions?`<div class="inline-actions">${actions}</div>`:'Bloqueado'}</td>
  </tr>`;
}
function renderEmployeePenaltyRow(report){
  return `<tr>
    <td><strong>${report.clientName}</strong><div style="font-size:11px;color:var(--text3);margin-top:3px">DNI ${report.clientDni}</div></td>
    <td><span class="badge drive">${report.penaltyLabel}</span></td>
    <td><div style="max-width:420px;line-height:1.35">${report.reason}</div></td>
    <td>${fmtDateTime(report.decidedAt || report.createdAt)}</td>
  </tr>`;
}
function renderPenalidades(){
  if((isAdmin() || isManager()) && ensureStateModulesLoaded(['penaltyReportUsers'])) return `<div class="page-header"><div class="page-title">Reportes de penalidad</div><div class="page-sub">Cargando equipo y reportes...</div></div><div class="table-wrap"><div class="empty-state"><div class="section-spinner" role="status" aria-label="Cargando"></div><p>Preparando penalidades...</p></div></div>`;
  if(!isAdmin() && !isManager()){
    const rows=getFilteredPenaltyReports().filter(report=>report.status==='APPROVED');
    const page=paginateRows('penaltiesEmployee', rows);
    let h=`<div class="page-header"><div class="page-title">Mis penalidades</div><div class="page-sub">Penalidades reportadas por tu jefe de sede o por otra sede.</div></div>
    <details class="table-wrap" open>
      <summary class="table-header" style="cursor:pointer">
        <div class="table-title">Penalidades aprobadas (${rows.length})</div>
        <span class="days-chip warn">Ver / ocultar</span>
      </summary>
      <div class="table-header" style="border-top:1px solid var(--border)">
      <input class="search-input" id="penaltySearch" placeholder="Cliente, DNI, penalidad..." value="${state.penaltySearch}" style="width:220px"/>
      </div>
      <table><thead><tr><th>Cliente</th><th>Penalidad</th><th>Motivo</th><th>Fecha aprobada</th></tr></thead><tbody>`;
    page.rows.forEach(row=>{ h+=renderEmployeePenaltyRow(row); });
    if(!rows.length) h+=`<tr><td colspan="4"><div class="empty-state"><div class="es-icon">-</div><p>No tienes penalidades aprobadas.</p></div></td></tr>`;
    h+=`</tbody></table>${renderPagination(page)}</details>`;
    return h;
  }
  const penaltyMonth=activeMonthKey(state.penaltyMonth);
  const monthPenaltyReports=PENALTY_REPORTS.filter(r=>monthKeyFromDate(r.decidedAt || r.createdAt)===penaltyMonth);
  const pendingInbox=getPenaltyInboxReports().filter(r=>monthKeyFromDate(r.decidedAt || r.createdAt)===penaltyMonth).length;
  const sentPending=monthPenaltyReports.filter(r=>r.sentById===state.currentUser.id && r.status==='PENDING').length;
  const approved=monthPenaltyReports.filter(r=>r.status==='APPROVED').length;
  const rejected=monthPenaltyReports.filter(r=>r.status==='REJECTED').length;
  const tab=state.penaltyTab || 'received';
  let h=`<div class="page-header"><div class="page-title">Reportes de penalidad</div><div class="page-sub">Cruce entre sedes para reportar errores de Atencion al cliente y que la sede responsable apruebe o rechace.</div></div>
  <div class="stat-grid">
    <div class="stat-card"><div class="stat-label">Recibidos pendientes</div><div class="stat-value amber">${pendingInbox}</div><div class="stat-sub">Esperando decision</div></div>
    <div class="stat-card"><div class="stat-label">Enviados pendientes</div><div class="stat-value amber">${sentPending}</div><div class="stat-sub">Bloqueados hasta respuesta</div></div>
    <div class="stat-card"><div class="stat-label">Aprobados</div><div class="stat-value green">${approved}</div><div class="stat-sub">Penalidades aceptadas</div></div>
    <div class="stat-card"><div class="stat-label">Rechazados</div><div class="stat-value red">${rejected}</div><div class="stat-sub">Con motivo de rechazo</div></div>
  </div>
  <div class="tabs">
    <div class="tab${tab==='received'?' active':''}" data-ptab="received">Recibidos</div>
    <div class="tab${tab==='sent'?' active':''}" data-ptab="sent">Enviados</div>
    <div class="tab${tab==='new'?' active':''}" data-ptab="new">Nuevo reporte</div>
    <div class="tab${tab==='history'?' active':''}" data-ptab="history">Historial</div>
  </div>`;

  if(tab==='new'){
    const availableSedes=SEDES;
    if(!state.penaltySede || !availableSedes.includes(state.penaltySede)) state.penaltySede=availableSedes[0] || 'Lince';
    const workers=getPenaltyWorkersForTarget();
    const selectedWorker=workers.find(user=>String(user.id)===String(state.penaltyWorker));
    const penalties=getPenaltyRules();
    const selectedPenalty=penalties.find(item=>item.code===PENALTY_REPORT_DRAFT.penaltyCode) || penalties[0];
    h+=`<div class="alert-banner"><div class="ab-icon">!</div><div class="ab-text"><strong>Importante:</strong> si envias a tu misma sede queda aprobado directo como penalidad interna. Si envias a otra sede, el jefe receptor debe aprobar o rechazar con motivo.</div></div>
    <div class="form-card" style="max-width:860px">
      <form id="penaltyReportForm">
        <div class="form-grid">
          <div class="form-group"><label class="form-label">Sede destino</label><select class="form-select" id="penaltyTargetSede">${availableSedes.map(s=>`<option value="${s}"${state.penaltySede===s?' selected':''}>${s}</option>`).join('')}</select></div>
          <div class="form-group"><label class="form-label">Trabajador de esa sede</label><select class="form-select" id="penaltyWorker"><option value="">Selecciona trabajador</option>${workers.map(user=>`<option value="${user.id}"${state.penaltyWorker==user.id?' selected':''}>${user.name}</option>`).join('')}</select></div>
          <div class="form-group"><label class="form-label">DNI del cliente</label><input class="form-input" id="penaltyClientDni" placeholder="DNI del cliente" inputmode="numeric" value="${PENALTY_REPORT_DRAFT.clientDni}"/></div>
          <div class="form-group"><label class="form-label">Nombre del cliente</label><input class="form-input" id="penaltyClientName" placeholder="Nombre del cliente" value="${PENALTY_REPORT_DRAFT.clientName}"/></div>
          <div class="form-group full"><label class="form-label">Penalidad Atencion al cliente</label><select class="form-select" id="penaltyCode">${penalties.map(p=>`<option value="${p.code}"${selectedPenalty?.code===p.code?' selected':''}>${p.label}</option>`).join('')}</select></div>
          <div class="form-group full"><label class="form-label">Por que estas enviando este reporte</label><textarea class="form-input" id="penaltyReason" rows="4" placeholder="Explica el error, contexto, evidencia o donde lo detectaste.">${PENALTY_REPORT_DRAFT.reason}</textarea></div>
        </div>
        <button class="submit-btn" id="penaltySubmit" type="submit">Enviar reporte bloqueado</button>
      </form>
    </div>`;
    if(selectedWorker){
      h+=`<div class="alert-banner" style="margin-top:1rem"><div class="ab-icon">!</div><div class="ab-text"><strong>Trabajador seleccionado:</strong> ${selectedWorker.name} - ${userSede(selectedWorker)}. El reporte ira al jefe de esa sede.</div></div>`;
    }
    return h;
  }

  const rows=getFilteredPenaltyReports();
  const page=paginateRows(`penalties_${tab}`, rows);
  const peopleForFilter=PENALTY_REPORT_USERS.filter(user=>user.role!=='admin');
  h+=`<div class="table-wrap"><div class="table-header">
    <div class="table-title">${tab==='received'?'Reportes recibidos':tab==='sent'?'Reportes enviados':'Historial de decisiones'} (${rows.length})</div>
    <input class="search-input" id="penaltySearch" placeholder="Cliente, DNI, trabajador..." value="${state.penaltySearch}" style="width:220px"/>
    ${monthFilterSelectHtml('penaltyMonth', penaltyMonth, { includeEmpty:false, count:24, extraValues: PENALTY_REPORTS.map(row=>row.decidedAt || row.createdAt) })}
    <select class="filter-select" id="penaltySede"><option value="">Todas las sedes</option>${SEDES.map(s=>`<option value="${s}"${state.penaltySede===s?' selected':''}>${s}</option>`).join('')}</select>
    <select class="filter-select" id="penaltyStatus"><option value="">Todo estado</option><option value="PENDING"${state.penaltyStatus==='PENDING'?' selected':''}>Pendiente</option><option value="APPROVED"${state.penaltyStatus==='APPROVED'?' selected':''}>Aprobado</option><option value="REJECTED"${state.penaltyStatus==='REJECTED'?' selected':''}>Rechazado</option></select>
    <select class="filter-select" id="penaltyWorkerFilter"><option value="">Todo trabajador</option>${peopleForFilter.map(user=>`<option value="${user.id}"${state.penaltyWorker==user.id?' selected':''}>${user.name}</option>`).join('')}</select>
    ${periodFilterHtml()}
  </div>
  <table><thead><tr><th>Cliente</th><th>Trabajador</th><th>Penalidad</th><th>Motivo enviado</th><th>Enviado por</th><th>Estado</th><th>Fecha</th><th></th></tr></thead><tbody>`;
  page.rows.forEach(row=>{ h+=renderPenaltyReportRow(row); });
  if(!rows.length) h+=`<tr><td colspan="8"><div class="empty-state"><div class="es-icon">-</div><p>No hay reportes de penalidad con esos filtros.</p></div></td></tr>`;
  h+=`</tbody></table>${renderPagination(page)}</div>`;
  return h;
}

function renderPaymentAuditRow(report){
  const status=penaltyStatusMeta(report.status);
  const canDecide=report.status==='PENDING' && canEditMonth(monthKeyFromDate(report.createdAt)) &&
    (isAdmin() || (isManager() && normalizeSede(report.targetSede)===userSede(state.currentUser)));
  const actions=[
    report.evidenceImage ? `<button class="pill-action" data-payment-audit-evidence="${report.id}">Ver captura</button>` : '',
    canDecide ? `<button class="pill-action success" data-penalty-approve="${report.id}">Aprobar</button>` : '',
    canDecide ? `<button class="pill-action danger" data-penalty-reject="${report.id}">Rechazar</button>` : ''
  ].filter(Boolean).join('');
  return `<tr>
    <td>${compactPersonCell(report.workerName, report.targetSede)}</td>
    <td><div>${esc(report.reason)}</div>${report.evidenceImage?'<div style="font-size:11px;color:var(--text3);margin-top:4px">Captura adjunta</div>':''}</td>
    <td>${report.sentBy?.name || '-'}</td>
    <td><div>${report.receiver?.name || 'Jefa de sede'}</div><div style="font-size:11px;color:var(--text3);margin-top:3px">${esc(report.targetSede)}</div></td>
    <td><span class="days-chip ${status.cls}">${status.label}</span>${report.decisionReason?`<div style="font-size:11px;color:var(--text2);margin-top:5px">${esc(report.decisionReason)}</div>`:''}</td>
    <td>${fmtDateTime(report.createdAt)}</td>
    <td>${actions?`<div class="inline-actions">${actions}</div>`:'-'}</td>
  </tr>`;
}
function renderPaymentAudits(){
  if(!canAccessPaymentAudits()) return `<div class="page-header"><div class="page-title">Auditoría de pagos</div><div class="page-sub">No tienes acceso a esta sección.</div></div>`;
  const month=activeMonthKey(state.paymentAuditMonth);
  let rows=PENALTY_REPORTS.filter(report=>isPaymentAuditReport(report) && monthKeyFromDate(report.decidedAt || report.createdAt)===month);
  if(state.paymentAuditSearch){
    const q=state.paymentAuditSearch.toLowerCase();
    rows=rows.filter(report=>`${report.workerName} ${report.reason} ${report.sentBy?.name||''} ${report.targetSede}`.toLowerCase().includes(q));
  }
  rows.sort((a,b)=>Number(b.id)-Number(a.id));
  const pending=rows.filter(report=>report.status==='PENDING').length;
  const approved=rows.filter(report=>report.status==='APPROVED').length;
  const canCreate=isPaymentAuditReporter();
  const advisors=PENALTY_REPORT_USERS.filter(user=>user.role==='employee').sort((a,b)=>a.name.localeCompare(b.name));
  const selected=advisors.find(user=>String(user.id)===String(PAYMENT_AUDIT_DRAFT.workerUserId));
  const page=paginateRows('paymentAudits', rows);
  let h=`<div class="page-header"><div class="page-title">Auditoría de pagos</div><div class="page-sub">Los errores reportados por Pagos requieren la aprobación de la jefa de sede del asesor.</div></div>
  <div class="stat-grid">
    <div class="stat-card"><div class="stat-label">Pendientes</div><div class="stat-value amber">${pending}</div><div class="stat-sub">Esperando decisión de sede</div></div>
    <div class="stat-card"><div class="stat-label">Aprobadas</div><div class="stat-value green">${approved}</div><div class="stat-sub">Aplicadas al cierre</div></div>
    <div class="stat-card"><div class="stat-label">Regla al aprobar</div><div class="stat-value">S/ 1.00</div><div class="stat-sub">Bono para quien reportó</div></div>
    <div class="stat-card"><div class="stat-label">Descuento</div><div class="stat-value red">S/ 2.00</div><div class="stat-sub">Según tipo de error</div></div>
  </div>`;
  if(canCreate){
    h+=`<div class="form-card" style="max-width:920px"><div class="table-title" style="margin-bottom:14px">Reportar error de pago</div>
      <div class="alert-banner" style="margin-bottom:14px"><div class="ab-icon">!</div><div class="ab-text">La solicitud se envía a la <strong>jefa de sede actual</strong> del asesor. Al aprobar: <strong>error de datos</strong> descuenta S/ 2.00 solo al asesor; <strong>abandono de chat</strong> descuenta S/ 2.00 al asesor y a su jefa. Quien reporta recibe S/ 1.00.</div></div>
      <form id="paymentAuditForm"><div class="form-grid">
        <div class="form-group full"><label class="form-label">Asesor con el error</label><select class="form-select" id="paymentAuditWorker"><option value="">Selecciona al asesor</option>${advisors.map(user=>`<option value="${user.id}"${String(PAYMENT_AUDIT_DRAFT.workerUserId)===String(user.id)?' selected':''}>${esc(user.name)} — ${esc(userSede(user))}</option>`).join('')}</select></div>
        <div class="form-group full"><label class="form-label">Tipo de penalidad</label><select class="form-select" id="paymentAuditType"><option value="DATA_ERROR"${PAYMENT_AUDIT_DRAFT.type==='DATA_ERROR'?' selected':''}>Error de datos — S/ 2.00 al colaborador</option><option value="CHAT_ABANDONMENT"${PAYMENT_AUDIT_DRAFT.type==='CHAT_ABANDONMENT'?' selected':''}>Abandono de chat — S/ 2.00 al colaborador y a la jefa</option></select></div>
        <div class="form-group full"><label class="form-label">Explicación del error</label><textarea class="form-input" id="paymentAuditReason" rows="4" placeholder="Describe el error detectado y cómo se corrigió.">${esc(PAYMENT_AUDIT_DRAFT.reason)}</textarea></div>
        <div class="form-group full"><label class="form-label">Captura del error</label><div id="paymentAuditPaste" tabindex="0" style="border:1px dashed var(--accent);border-radius:10px;padding:16px;cursor:pointer;outline:none">Haz clic aquí y pega la captura con <strong>Ctrl + V</strong>, o selecciona un archivo de imagen.<input id="paymentAuditEvidenceFile" type="file" accept="image/png,image/jpeg,image/webp" style="display:block;margin-top:10px"/></div>
          ${PAYMENT_AUDIT_DRAFT.evidenceImage?`<div style="margin-top:12px"><img src="${esc(PAYMENT_AUDIT_DRAFT.evidenceImage)}" alt="Vista previa de captura" style="max-width:100%;max-height:270px;border-radius:8px;border:1px solid var(--border)"/><div><button type="button" class="pill-action danger ghost" id="paymentAuditEvidenceClear" style="margin-top:8px">Quitar captura</button></div></div>`:''}
        </div>
      </div><button class="submit-btn" id="paymentAuditSubmit" type="submit">Enviar solicitud a jefa de sede</button></form>
    </div>`;
    if(selected) h+=`<div class="alert-banner" style="margin-top:1rem"><div class="ab-icon">i</div><div class="ab-text">Se enviará a la jefa de sede de <strong>${esc(userSede(selected))}</strong>.</div></div>`;
  }else if(isManager()){
    h+=`<div class="alert-banner"><div class="ab-icon">i</div><div class="ab-text">Aquí puedes revisar y decidir las solicitudes enviadas a tu sede.</div></div>`;
  }
  h+=`<div class="table-wrap" style="margin-top:1rem"><div class="table-header"><div class="table-title">Solicitudes visibles (${rows.length})</div><input class="search-input" id="paymentAuditSearch" placeholder="Asesor, motivo o reportante..." value="${esc(state.paymentAuditSearch)}" style="width:260px"/>${monthFilterSelectHtml('paymentAuditMonth', month, {includeEmpty:false,count:24,extraValues:rows.map(report=>report.decidedAt||report.createdAt)})}</div>
    <table><thead><tr><th>Asesor</th><th>Error reportado</th><th>Enviado por</th><th>Jefa responsable</th><th>Estado</th><th>Fecha</th><th></th></tr></thead><tbody>`;
  page.rows.forEach(report=>{ h+=renderPaymentAuditRow(report); });
  if(!rows.length) h+=`<tr><td colspan="7"><div class="empty-state"><div class="es-icon">-</div><p>No hay solicitudes de auditoría de pagos para este mes.</p></div></td></tr>`;
  h+=`</tbody></table>${renderPagination(page)}</div>`;
  return h;
}

function attendanceReviewPatterns(requests,history,people,month){
  const groups=new Map(),managers=new Map(),seen=new Set();
  for(const req of [...requests,...history].sort((a,b)=>String(b.createdAt||'').localeCompare(String(a.createdAt||'')))){
    if(!String(req.date||'').startsWith(month) || seen.has(String(req.id))) continue;
    seen.add(String(req.id));
    const person=people.find(p=>String(p.personId)===String(req.personId));
    const current=timeMinutesOrNull(req.currentEntry),requested=timeMinutesOrNull(req.requestedEntry);
    const late=person&&current!==null?Number(recomputeDisplayedAttendanceDay({date:req.date,entryTime:req.currentEntry,exitTime:req.currentExit,justifiedEntry:false,justifiedDay:false},person).lateMinutes||0):0;
    const flags=[];
    if(!req.currentEntry&&!req.currentExit&&(req.requestedEntry||req.requestedExit||req.justifiedDay)) flags.push(req.justifiedDay?'Día justificado sin marcajes visibles':'Jornada solicitada sin marcajes visibles');
    else if(!req.currentEntry&&req.requestedEntry) flags.push('Entrada solicitada sin marcaje visible');
    if(late>0&&((requested!==null&&requested<current)||req.justifiedEntry||req.justifiedDay)) flags.push('Reduce o justifica tardanza');
    const linked=person?userForAttendancePerson(person):null;
    const own=linked&&Number(linked.id)===Number(req.requestedBy?.id);
    const tokens=normalizePersonName(req.requestedBy?.name).split(' ').filter(t=>t.length>=3);
    const possibleOwn=!linked&&tokens.length>=2&&tokens.every(t=>normalizePersonName(req.personName).split(' ').includes(t));
    if(own) flags.push('Solicita cambio de su asistencia vinculada');
    else if(possibleOwn) flags.push('Posible solicitud propia: verificar vínculo');
    if(!flags.length) continue;
    const key=String(req.personId);if(!groups.has(key)) groups.set(key,{name:req.personName,items:[],days:new Set(),self:false,rejected:0});
    const group=groups.get(key),rejected=req.status==='REJECTED';
    group.items.push({req,flags});
    if(rejected){group.rejected++;continue;}
    group.days.add(req.date);group.self=group.self||!!own||!!possibleOwn;
    if(req.requestedBy?.id){const id=String(req.requestedBy.id);if(!managers.has(id))managers.set(id,{name:req.requestedBy.name,days:new Set(),people:new Set()});const manager=managers.get(id);manager.days.add(key+'|'+req.date);manager.people.add(key);}
  }
  return {people:[...groups.values()].filter(g=>g.days.size>=3||g.self),managers:[...managers.values()].filter(g=>g.days.size>=3&&g.people.size>=2)};
}
function renderAttendanceReviewAlerts(requests,history,people,month){
  if(!isAdmin()) return '';
  const review=attendanceReviewPatterns(requests,history,people,month);
  if(!review.people.length&&!review.managers.length) return '';
  return '<details class="attendance-review-alerts"><summary>⚠ Revisión de cambios de asistencia · '+esc(month)+' ('+(review.people.length+review.managers.length)+')</summary><p>Señales para revisión, no conclusiones de irregularidad. Cuenta días distintos con solicitudes pendientes o aprobadas; los reenvíos del mismo día cuentan una vez. Las rechazadas se muestran aparte. El administrador decide cada caso.</p>'+review.people.map(group=>'<details class="attendance-review-case"><summary>'+esc(group.name)+' · '+group.days.size+' día(s) para revisar'+(group.self?' · solicitud propia o vínculo por verificar':'')+'</summary><p>'+group.rejected+' rechazada(s), fuera del umbral. Las horas son las guardadas al solicitar el cambio; contrástalas con el registro original de Zlink.</p><div class="ui-table-scroll"><table><thead><tr><th>Fecha</th><th>Solicitante</th><th>Hora al solicitar</th><th>Cambio pedido</th><th>Señales</th><th>Estado</th><th>Motivo</th></tr></thead><tbody>'+group.items.map(({req,flags})=>'<tr><td>'+esc(req.date)+'</td><td>'+esc(req.requestedBy?.name||'-')+'</td><td>'+esc(shortTime(req.currentEntry))+' – '+esc(shortTime(req.currentExit))+'</td><td>'+esc(shortTime(req.requestedEntry))+' – '+esc(shortTime(req.requestedExit))+'</td><td>'+esc(flags.join(' · '))+'</td><td>'+esc(req.status==='APPROVED'?'Aprobada':req.status==='REJECTED'?'Rechazada':'Pendiente')+'</td><td>'+esc(req.reason||'-')+'</td></tr>').join('')+'</tbody></table></div></details>').join('')+review.managers.map(manager=>'<p><strong>'+esc(manager.name)+'</strong>: '+manager.days.size+' días con cambios señalados, para '+manager.people.size+' colaboradores. Revisar el conjunto de solicitudes.</p>').join('')+'</details>';
}

function renderAsistencia(){
  const attendanceMonth=activeMonthKey(state.attendanceMonth);
  const archivedAttendance=archivedAttendanceForMonth(attendanceMonth);
  const attendanceSource=archivedAttendance || ATTENDANCE;
  const changeRequests=attendanceSource?.changeRequests || [];
  const changeRequestHistory=attendanceSource?.changeRequestHistory || [];
  const attendanceView=state.attendanceTab || 'resumen';
  let h=`<section class="attendance-shell"><div class="attendance-hero">
    <div class="attendance-hero-copy">
      <div class="attendance-hero-icon">AS</div>
      <div>
        <div class="page-title">Control de Asistencia</div>
        <div class="page-sub">Resumen local del Excel de marcajes de toda la empresa</div>
      </div>
    </div>
  </div>`;
  if(!archivedAttendance && ensureAttendanceLoaded()){
    return h + `<div class="table-wrap"><div class="empty-state"><div class="section-spinner" role="status" aria-label="Cargando"></div><p>Cargando asistencias...</p></div></div></section>`;
  }
  if(!archivedAttendance && ATTENDANCE_LOADING && !ATTENDANCE){
    return h + `<div class="table-wrap"><div class="empty-state"><div class="section-spinner" role="status" aria-label="Cargando"></div><p>Cargando asistencias...</p></div></div></section>`;
  }
  if(!archivedAttendance && ATTENDANCE_ERROR){
    return h + `<div class="alert-banner"><div class="ab-icon">!</div><div class="ab-text"><strong>No se pudo cargar la asistencia.</strong> ${ATTENDANCE_ERROR}</div></div></section>`;
  }
  if(!attendanceSource || !attendanceSource.people?.length){
    return h + `<div class="table-wrap"><div class="empty-state"><div class="es-icon">-</div><p>Aun no hay asistencias importadas.</p></div></div></section>`;
  }

  const rows=getAttendanceRows(attendanceSource).filter(row=>String(row.date || '').startsWith(attendanceMonth));
  const people=getAttendancePeople(attendanceSource);
  const departments=getAttendanceDepartments(attendanceSource);
  h+=`<div class="attendance-source-card">
    <div class="attendance-source-icon">XLS</div>
    <div class="attendance-source-copy">
      <div class="attendance-source-title">${archivedAttendance?'Archivo archivado del cierre':'Archivo local'}: ${attendanceSource.sourceFile || 'Cierre mensual'}</div>
      <div class="attendance-source-meta"><strong>Importado:</strong> ${fmtDateTime(attendanceSource.importedAt)} <span>-</span> <strong>Horario base:</strong> ${attendanceSource.schedule?.entry || '09:00'} a ${attendanceSource.schedule?.exit || '18:00'} <span>-</span> <strong>Tolerancia:</strong> ${attendanceSource.schedule?.entryToleranceMinutes||5} min</div>
    </div>
  </div>`;
  if(archivedAttendance){
    h+=`<div class="alert-banner"><div class="ab-icon">i</div><div class="ab-text"><strong>Vista archivada:</strong> esta asistencia viene del cierre mensual o del JSON cargado. No se edita desde aqui.</div></div>`;
  }
  h+=`<div class="tabs" style="margin-bottom:1.5rem">
    <div class="tab${attendanceView==='resumen'?' active':''}" data-attendance-tab="resumen">Resumen</div>
    <div class="tab${attendanceView==='historial'?' active':''}" data-attendance-tab="historial">Historial${changeRequestHistory.length?` (${changeRequestHistory.length})`:''}</div>
  </div>`;
  h+=renderAttendanceReviewAlerts(changeRequests,changeRequestHistory,attendanceSource.people,attendanceMonth);
  if(attendanceView==='historial'){
    if(changeRequestHistory.length){
      h+=`<div class="table-wrap" style="margin-bottom:1.5rem"><div class="table-header"><div class="table-title">Historial de aprobaciones y rechazos (${changeRequestHistory.length})</div></div>
      <table><thead><tr><th>Fecha</th><th>Persona</th><th>Solicitado por</th><th>Cambio pedido</th><th>Estado</th><th>Decidido por</th><th>Fecha decision</th><th>Motivo</th></tr></thead><tbody>`;
      changeRequestHistory.forEach(req=>{
        const status=req.status==='APPROVED'
          ? `<span class="days-chip ok">Aprobada</span>`
          : `<span class="days-chip danger">Rechazada</span>`;
        const decisionText=req.decisionReason || req.reason || '-';
        h+=`<tr>
          <td>${fmt(req.date)}</td>
          <td>${compactPersonCell(req.personName, req.personId)}</td>
          <td>${req.requestedBy?.name || 'Jefe de sede'}</td>
          <td>Entrada ${shortTime(req.requestedEntry)} - Salida ${shortTime(req.requestedExit)}${req.justifiedDay?' - Dia justificado':''}${req.justifiedEntry?' - Ingreso justificado':''}${req.justifiedExit?' - Salida justificada':''}</td>
          <td>${status}</td>
          <td>${req.decidedBy?.name || 'Admin'}</td>
          <td>${req.decidedAt ? fmtDateTime(req.decidedAt) : '-'}</td>
          <td>${decisionText}</td>
        </tr>`;
      });
      h+=`</tbody></table></div>`;
    }else{
      h+=`<div class="table-wrap"><div class="empty-state"><div class="es-icon">-</div><p>Aun no hay historial de aprobaciones o rechazos en asistencia.</p></div></div>`;
    }
    return h + `</section>`;
  }
  if(changeRequests.length){
    const visibleRequestIds=new Set(changeRequests.map(req=>Number(req.id)));
    ATTENDANCE_SELECTED_REQUEST_IDS=new Set([...ATTENDANCE_SELECTED_REQUEST_IDS].filter(id=>visibleRequestIds.has(id)));
    const selectedRequestCount=ATTENDANCE_SELECTED_REQUEST_IDS.size;
    const allRequestsSelected=changeRequests.length>0 && selectedRequestCount===changeRequests.length;
    h+=`<div class="table-wrap" style="margin-bottom:1.5rem"><div class="table-header"><div class="table-title">${isAdmin()?'Solicitudes pendientes de asistencia':'Solicitudes pendientes de tu sede'} (${changeRequests.length})</div>${isAdmin()?`<div class="inline-actions"><button class="btn-sm success" id="approveSelectedAttendanceRequests" ${selectedRequestCount?'':'disabled'}>Aprobar seleccionadas (${selectedRequestCount})</button><button class="btn-sm danger" id="deleteSelectedAttendanceRequests" ${selectedRequestCount?'':'disabled'}>Eliminar seleccionadas (${selectedRequestCount})</button></div>`:''}</div>
    <table><thead><tr>${isAdmin()?`<th style="width:42px"><input type="checkbox" id="selectAllAttendanceRequests" ${allRequestsSelected?'checked':''} aria-label="Seleccionar todas las solicitudes"/></th>`:''}<th>Fecha</th><th>Persona</th><th>Solicitado por</th><th>Actual</th><th>Cambio pedido</th><th>Motivo</th>${isAdmin()?'<th></th>':''}</tr></thead><tbody>`;
    changeRequests.forEach(req=>{
      h+=`<tr>
        ${isAdmin()?`<td><input type="checkbox" data-attendance-request-select="${req.id}" ${ATTENDANCE_SELECTED_REQUEST_IDS.has(Number(req.id))?'checked':''} aria-label="Seleccionar solicitud ${req.id}"/></td>`:''}
        <td>${fmt(req.date)}</td>
        <td>${compactPersonCell(req.personName, req.personId)}</td>
        <td>${req.requestedBy?.name || 'Jefe de sede'}</td>
        <td>Entrada ${shortTime(req.currentEntry)} - Salida ${shortTime(req.currentExit)}</td>
        <td>Entrada ${shortTime(req.requestedEntry)} - Salida ${shortTime(req.requestedExit)}${req.justifiedDay?' - Dia justificado':''}${req.justifiedEntry?' - Ingreso justificado':''}${req.justifiedExit?' - Salida justificada':''}</td>
        <td>${req.reason}</td>
        ${isAdmin()?`<td><div class="inline-actions"><button class="pill-action success" data-attendance-approve="${req.id}">Aprobar</button><button class="pill-action danger" data-attendance-reject="${req.id}">Rechazar</button></div></td>`:''}
      </tr>`;
    });
    h+=`</tbody></table></div>`;
  }
  h+=`<div class="table-wrap" style="margin-bottom:1.5rem"><div class="table-header">
    <div class="table-title">Asistencia por dia (${rows.length})</div>
    ${monthFilterSelectHtml('attendanceMonth', attendanceMonth, { includeEmpty:false, count:24, extraValues: MONTHLY_CLOSURES.map(item=>item.month) })}
    <input class="search-input" id="attendanceSearch" placeholder="Nombre o DNI..." value="${state.attendanceSearch}" style="width:190px"/>
    <select class="filter-select" id="attendanceSede" aria-label="Sede">
      <option value="">Todas las sedes</option>
      ${SEDES.map(sede=>`<option value="${sede}"${state.attendanceSede===sede?' selected':''}>${sede}</option>`).join('')}
    </select>
    <select class="filter-select" id="attendanceDepartment">
      <option value="">Todas las Areas</option>
      ${departments.map(department=>`<option value="${department}"${state.attendanceDepartment===department?' selected':''}>${department}</option>`).join('')}
    </select>
    <select class="filter-select" id="attendancePerson">
      <option value="">Todo el personal</option>
      ${people.map(person=>`<option value="${person.personId}"${state.attendancePerson===person.personId?' selected':''}>${person.personName}</option>`).join('')}
    </select>
    <select class="filter-select" id="attendanceDate">
      <option value="">Todas las fechas</option>
      ${(attendanceSource.availableDates||[]).filter(date=>String(date).startsWith(attendanceMonth)).map(date=>`<option value="${date}"${state.attendanceDate===date?' selected':''}>${fmt(date)}</option>`).join('')}
    </select>
  </div>
  ${isAdmin()?`<div style="padding:8px 16px;color:var(--text3);font-size:12px">${esc(ZLINK_SYNC_MESSAGE || 'Los nuevos marcajes recibidos de Zlink aparecen automaticamente. Esta pantalla se actualiza cada 15 segundos.')}</div>`:''}
  <table><thead><tr><th>Fecha</th><th>Persona</th><th>Entrada</th><th>Estado entrada</th><th>Salida</th><th>Estado salida</th><th>Tardanza</th><th>Minutos extra</th><th>Estado del dia</th><th></th></tr></thead><tbody>`;
  rows.forEach(row=>{
    const canEditAttendance=isAdmin() || isManager() || !(row.entryTime && row.exitTime);
    const holidayRest=!!(row.holiday || peruNationalHoliday(row.date));
    const entryClass=attendanceBadgeClass(row.entryTime ? (row.lateMinutes>0?'warn':'good') : 'danger');
    const effectiveEntryClass=(holidayRest || isCalendarRest(row))?'holiday':(row.justifiedEntry || row.justifiedDay)?'done':entryClass;
    const exitClass=attendanceBadgeClass(row.exitTime ? 'done' : 'danger');
    const effectiveExitClass=(holidayRest || isCalendarRest(row))?'holiday':(row.justifiedExit || row.justifiedDay)?'done':exitClass;
    const dayState=attendanceStatusMeta(row);
    const entryStatusLabel=holidayRest?'Descanso':row.entryStatus;
    const exitStatusLabel=holidayRest?'Descanso':row.exitStatus;
    const manualBadgeVisible=!isAdmin();
    const entryCell=`<div class="attendance-time-cell"><span class="${Number(row.lateMinutes||0)>0?'attendance-entry-late':''}" style="font-family:var(--font2);font-weight:700">${shortTime(row.entryTime)}</span>${manualBadgeVisible && !row.justifiedDay && row.manualEntry?'<span class="badge drive">Manual</span>':''}${row.justifiedEntry?'<span class="badge operacion">Justificada</span>':''}${row.justifiedDay?'<span class="badge registro">Dia justificado</span>':''}</div>`;
    const exitCell=`<div class="attendance-time-cell"><span style="font-family:var(--font2);font-weight:700">${shortTime(row.exitTime)}</span>${manualBadgeVisible && !row.justifiedDay && row.manualExit?'<span class="badge drive">Manual</span>':''}${row.justifiedExit?'<span class="badge operacion">Justificada</span>':''}${row.justifiedDay?'<span class="badge registro">Dia justificado</span>':''}</div>`;
    const editPayload=encodeURIComponent(JSON.stringify({personId:row.personId,personName:row.personName,date:row.date,entryTime:row.entryTime||'',exitTime:row.exitTime||'',justifiedEntry:!!row.justifiedEntry,justifiedExit:!!row.justifiedExit,justifiedDay:!!row.justifiedDay,absence:!!row.absence}));
    h+=`<tr${holidayRest?' class="holiday-row"':''}>
      <td style="white-space:nowrap">${fmt(row.date)}</td>
      <td>${compactPersonCell(row.personName, row.personId)}</td>
      <td>${entryCell}</td>
      <td><span class="days-chip ${effectiveEntryClass}">${entryStatusLabel}</span></td>
      <td>${exitCell}</td>
      <td><span class="days-chip ${effectiveExitClass}">${exitStatusLabel}</span></td>
      <td style="color:${row.lateMinutes>0?'var(--amber)':'var(--text2)'};font-weight:${row.lateMinutes>0?'700':'500'}">${minutesLabel(row.lateMinutes)}</td>
      <td style="color:${row.overtimeMinutes>0?'var(--green)':'var(--text2)'};font-weight:${row.overtimeMinutes>0?'700':'500'}">${minutesLabel(row.overtimeMinutes)}</td>
      <td><span class="days-chip ${dayState.cls}">${dayState.label}</span></td>
      <td>${canEditAttendance ? `<button class="action-btn" data-attendance-edit="${editPayload}">${isManager()&&!isAdmin()?'Solicitar':'Editar'}</button>` : `<span style="color:var(--text3);font-size:12px">Bloqueado</span>`}</td>
    </tr>`;
  });
  if(!rows.length) h+=`<tr><td colspan="10"><div class="empty-state"><div class="es-icon">-</div><p>No hay asistencias con esos filtros.</p></div></td></tr>`;
  h+=`</tbody></table></div>`;

  return h + `</section>`;
}

function renderColaboradores(){
  let h=`<div class="page-header"><div class="page-title">Gestión de trabajadores</div><div class="page-sub">Consulta y administra la información de tu equipo.</div></div>`;
  if(!isAdmin() && !isManager()){
    return h + `<div class="alert-banner"><div class="ab-icon">!</div><div class="ab-text"><strong>Acceso restringido.</strong> Solo administracion y jefes de sede pueden editar colaboradores.</div></div>`;
  }
  if(ensureAttendanceLoaded()){
    return h + `<div class="table-wrap"><div class="empty-state"><div class="section-spinner" role="status" aria-label="Cargando"></div><p>Cargando colaboradores...</p></div></div>`;
  }
  if(ATTENDANCE_LOADING && !ATTENDANCE){
    return h + `<div class="table-wrap"><div class="empty-state"><div class="section-spinner" role="status" aria-label="Cargando"></div><p>Cargando colaboradores...</p></div></div>`;
  }
  if(ATTENDANCE_ERROR){
    return h + `<div class="alert-banner"><div class="ab-icon">!</div><div class="ab-text"><strong>No se pudo cargar asistencia.</strong> ${ATTENDANCE_ERROR}</div></div>`;
  }
  if(!ATTENDANCE || !ATTENDANCE.people?.length){
    return h + `<div class="table-wrap"><div class="table-header"><div class="table-title">Usuarios del sistema</div><button class="btn-sm" id="createLooseUserBtn">Crear usuario</button></div><div class="empty-state"><div class="es-icon">-</div><p>Primero sube un Excel de asistencia para detectar colaboradores. Igual puedes crear usuarios y conectarlos despues.</p></div></div>${renderUnlinkedSystemUsers([])}`;
  }

  const rawSalaryData=getSalaryPeople({ ignoreFilters:true });
  const allPeople=(rawSalaryData.people||[]).filter(person=>!isInactiveCollaborator(person));
  const query=normalizePersonName(state.collaboratorSearch||'');
  const salaryPeople=allPeople.filter(person=>{
    const linked=userForAttendancePerson(person);
    const text=normalizePersonName(`${person.personName} ${person.personId} ${linked?.name||''} ${linked?.username||''}`);
    return (!query || text.includes(query)) && (!state.collaboratorRole || person.payrollRole===state.collaboratorRole) && (!state.collaboratorSede || getPersonSede(person)===state.collaboratorSede);
  });
  const roles=[...new Set(allPeople.map(person=>person.payrollRole||'Sin definir'))].sort((a,b)=>a.localeCompare(b,'es'));
  const page=paginateRows('workers',salaryPeople,8);
  h=`<section class="workers-panel"><div class="workers-toolbar">
    <div class="workers-heading"><h1>Gestión de trabajadores</h1><p>Consulta y administra la información de tu equipo.</p></div>
    <div class="workers-filters">
      <input class="search-input" id="collaboratorSearch" aria-label="Buscar trabajadores" placeholder="Buscar por nombre, usuario o código..." value="${esc(state.collaboratorSearch||'')}"/>
      <select class="filter-select" id="collaboratorRole" aria-label="Cargo"><option value="">Todos los cargos</option>${roles.map(role=>`<option value="${esc(role)}"${state.collaboratorRole===role?' selected':''}>${esc(role)}</option>`).join('')}</select>
      <select class="filter-select" id="collaboratorSede" aria-label="Sede"><option value="">Todas las sedes</option>${SEDES.map(sede=>`<option value="${sede}"${state.collaboratorSede===sede?' selected':''}>${sede}</option>`).join('')}</select>
      <button class="btn-primary" id="createLooseUserBtn">＋ Nuevo trabajador</button><button class="btn-sm workers-refresh" id="attendanceRefresh" title="Actualizar datos" aria-label="Actualizar datos">↻</button>
    </div>
  </div><div class="workers-grid">`;
  page.rows.forEach(person=>{
    const linked=userForAttendancePerson(person);
    const accounts=getBankAccounts(person);
    const partTime=person.employmentType==='PART_TIME';
    const fact=(icon,label,value)=>`<div class="worker-fact">${workerCardIcon(icon)}<div><span>${label}</span><strong>${esc(value)}</strong></div></div>`;
    h+=`<article class="worker-card">
      <header class="worker-head"><div class="worker-identity">${avatar({name:person.personName,color:'#22c97a'},48,16)}<div><h3>${esc(person.personName)}</h3><p>${esc(person.personId)} · ${esc(displayDepartmentForPerson(person))}</p></div></div><button class="worker-more" data-collaborator-open="${esc(person.personId)}" aria-label="Ver ficha de ${esc(person.personName)}" title="Ver ficha">⋮</button></header>
      <div class="worker-facts">
        ${fact('briefcase','Cargo',person.payrollRole||'Sin definir')}
        ${fact('coins','Sueldo mensual',money(Number(person.configuredSalary||person.monthlySalary||0)))}
        ${fact('pin','Sede',getPersonSede(person)||'Sin sede')}
        ${fact('clock','Jornada',employmentTypeLabelForValue(person.employmentType||'FULL_TIME'))}
      </div>
      <details class="worker-details"><summary>Ver más detalles</summary><div class="worker-extra">
        ${fact('person','Usuario del sistema',linked?`${linked.name} · @${linked.username}`:'Sin usuario conectado')}
        ${fact('clock','Penalidad por minuto tarde',money(getPenaltyPerMinute(person)))}
        ${fact('coins','Bono puntualidad',money(getBonusAmount(person)))}
        ${partTime?fact('clock','Modalidad part time',partTimeModeLabelForValue(person.partTimeMode||'MORNING')):''}
        ${(person.payrollRole||'')==='Jefe de Sede'?fact('coins','Bono de personal puntual',money(person.managerPunctualStaffBonus||0)):''}
      </div></details>
      <details class="worker-bank"><summary>${workerCardIcon('bank')}<span>Cuenta bancaria <small>· ${accounts.length} registrada${accounts.length===1?'':'s'}</small></span></summary><div class="worker-bank-content">${accounts.length?accounts.map(account=>`<div><span>${esc(account.bank)} · ${esc(account.type||'Cuenta')}</span><strong>${esc(account.number)}</strong></div>`).join(''):'Sin cuentas registradas'}</div></details>
      <footer class="worker-actions">
        ${isAdmin()?`<button class="btn-sm danger" data-collaborator-terminate="${esc(person.personId)}" data-collaborator-name="${esc(person.personName)}">${workerCardIcon('alert')} Renuncia</button><button class="btn-sm danger ghost" data-collaborator-delete="${esc(person.personId)}" data-collaborator-name="${esc(person.personName)}">${workerCardIcon('person')} Inactivar</button>`:''}
        <button class="btn-sm worker-edit" data-collaborator-open="${esc(person.personId)}">${workerCardIcon('edit')} Ver / Editar</button>
      </footer>
    </article>`;
  });
  if(!salaryPeople.length) h+=`<div class="empty-state workers-empty"><div class="es-icon">⌕</div><p>No hay trabajadores con esos filtros.</p></div>`;
  h+=`</div>${page.totalPages>1?renderPagination(page):`<div class="workers-page-info">Mostrando ${page.total?1:0}-${page.total} de ${page.total} trabajadores</div>`}</section>`;
  const unlinked=renderUnlinkedSystemUsers(allPeople);
  return h+(unlinked?`<details class="workers-unlinked"><summary>Usuarios pendientes de conectar con una ficha</summary>${unlinked}</details>`:'');
}

function workerCardIcon(name){
  const paths={briefcase:'<rect x="3" y="7" width="18" height="14" rx="2"/><path d="M8 7V4h8v3M3 12a24 24 0 0 0 18 0M10 13h4"/>',coins:'<ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v5c0 4 16 4 16 0V5M4 10v5c0 4 16 4 16 0v-5M4 15v4c0 4 16 4 16 0v-4"/>',pin:'<path d="M20 10c0 6-8 12-8 12S4 16 4 10a8 8 0 1 1 16 0Z"/><circle cx="12" cy="10" r="2.5"/>',clock:'<circle cx="12" cy="12" r="9"/><path d="M12 6v6l4 2"/>',person:'<circle cx="12" cy="7" r="4"/><path d="M4 22v-3a8 8 0 0 1 16 0v3"/>',bank:'<path d="m2 9 10-6 10 6ZM3 22h18M5 12v7m7-7v7m7-7v7"/>',alert:'<circle cx="12" cy="12" r="9"/><path d="M12 7v6m0 3v1"/>',edit:'<path d="m15 4 5 5M4 20l5-1L21 7a2 2 0 0 0-5-5L4 15Z"/>'};
  return `<svg class="worker-icon" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name]||paths.person}</svg>`;
}

function renderUnlinkedSystemUsers(people=[]){
  const linkedIds=new Set((people||[]).map(person=>Number(userForAttendancePerson(person)?.id || 0)).filter(Boolean));
  const rows=manageableUsersForCollaborator().filter(user=>!linkedIds.has(Number(user.id)) && user.role!=='admin');
  if(!rows.length) return '';
  return `<div class="table-wrap" style="margin-top:1rem"><div class="table-header"><div class="table-title">Usuarios sin ficha de asistencia (${rows.length})</div><button class="btn-sm" id="createLooseUserBtn2">Crear usuario</button></div>
    <table><thead><tr><th>Usuario</th><th>Rol</th><th>Sede</th><th>Estado</th></tr></thead><tbody>
      ${rows.map(user=>`<tr><td>${compactPersonCell(user.name, '@' + user.username)}</td><td>${user.role==='manager'?'Jefe de sede':user.role==='admin'?'Admin general':'Atencion al cliente'}</td><td>${userSede(user)}</td><td><span class="days-chip warn">Pendiente conectar con Excel</span></td></tr>`).join('')}
    </tbody></table>
  </div>`;
}

function renderCollaboratorEditModal(){
  const salaryData=getSalaryPeople({ ignoreFilters:true, date:salaryViewMonthDate() });
  const salaryPerson=(salaryData.people||[]).find(item=>String(item.personId)===String(state.collaboratorEditId));
  const livePerson=(ATTENDANCE?.people||[]).find(item=>String(item.personId)===String(state.collaboratorEditId));
  const person=livePerson?{...salaryPerson,...livePerson,configuredSalary:livePerson.monthlySalary}:salaryPerson;
  if(!person){
    return `<div class="modal-overlay collaborator-edit-overlay" id="collaboratorEditOverlay"><div class="modal collaborator-edit-modal"><h3>Editar colaborador</h3><p class="page-sub">No se encontro el colaborador seleccionado.</p><div class="modal-actions"><button class="btn-cancel" data-collaborator-close>Cerrar</button></div></div></div>`;
  }
  const employmentType=person.employmentType||'FULL_TIME';
  const partTimeMode=person.partTimeMode||'MORNING';
  const linkedUser=userForAttendancePerson(person);
  const currentSede=getPersonSede(person) || 'Lince';
  const lastTransfer=getPersonTransferHistory(person).slice(-1)[0];
  const transferDate=lastTransfer?.to===currentSede ? lastTransfer.effectiveDate : '';
  const sectionArea=displayDepartmentForPerson(person);
  const isManagerRole=(person.payrollRole||'')==='Jefe de Sede';
  const userOptions=manageableUsersForCollaborator();
  const selectedLinkedId=linkedUser?.id || '';
  const roleOptions=(isAdmin()?['admin','manager','employee']:['employee']);
  const defaultUserRole=(person.payrollRole||'')==='Jefe de Sede' && isAdmin() ? 'manager' : 'employee';
  const inactive=isInactiveCollaborator(person);
  const currentRoleLabel=person.payrollRole || 'Colaborador';
  const areaLabel=sectionArea || displayDepartmentForPerson(person) || 'Sin area';
  return `<div class="modal-overlay collaborator-edit-overlay" id="collaboratorEditOverlay">
    <div class="modal collaborator-edit-modal">
      <div class="collaborator-edit-head">
        <div class="collaborator-ident">
          ${avatar({name:person.personName,color:'#22c97a'},74,24)}
          <div>
            <h3>${person.personName}</h3>
            <div class="page-sub">${person.personId} - ${areaLabel}${inactive?` - Inactivo desde ${fmt(inactiveCollaboratorDate(person))}`:''}</div>
          </div>
        </div>
        <div class="collaborator-edit-role">
          <span class="collaborator-card-icon">US</span>
          <div><strong>${esc(currentRoleLabel)}</strong><span>${esc(currentSede || 'Sin sede')}</span></div>
        </div>
      </div>
      ${inactive?`<div class="alert-banner"><div class="ab-icon">!</div><div class="ab-text"><strong>Colaborador inactivo.</strong> Se conserva su historial, asistencia y pagos anteriores para consulta.</div></div>`:''}
      <div class="collaborator-edit-body">
<div class="collaborator-edit-column">
      <section class="collaborator-edit-card">
        <div class="collaborator-card-title"><span class="collaborator-card-icon collaborator-section-icon" aria-hidden="true"><svg viewBox="0 0 28 28" width="28" height="28" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="4"/><path d="M4 22v-3a8 8 0 0 1 16 0v3"/></svg></span>Acceso al sistema</div>
        <div class="collaborator-edit-grid collaborator-user-grid">
          <label class="collaborator-edit-field collaborator-full-field"><span>Usuario existente</span><select class="filter-select" data-linked-user="${person.personId}">
            <option value="">Sin usuario conectado</option>
            ${userOptions.map(user=>`<option value="${user.id}"${Number(selectedLinkedId)===Number(user.id)?' selected':''}>${esc(user.name)} - @${esc(user.username)} - ${esc(userSede(user))}</option>`).join('')}
          </select></label>
          <label class="collaborator-edit-field"><span>Nombre en sistema</span><input class="search-input" data-user-name="${person.personId}" value="${esc(linkedUser?.name || person.personName || '')}"/></label>
          <label class="collaborator-edit-field"><span>Usuario</span><input class="search-input" data-user-username="${person.personId}" value="${esc(linkedUser?.username || defaultUsernameForPerson(person))}"/></label>
        </div><details class="collaborator-access-settings"><summary>Configuración de acceso</summary><div class="collaborator-edit-grid">
          <div class="collaborator-user-mode collaborator-full-field"><select class="filter-select" data-user-action="${person.personId}">
            <option value="link">Solo conectar / actualizar usuario</option>
            <option value="create">Crear nuevo usuario conectado</option>
          </select></div>
          <label class="collaborator-edit-field collaborator-full-field"><span>Nueva contrasena</span><input class="search-input" data-user-password="${person.personId}" type="text" placeholder="${linkedUser?'Opcional: deja vacio para mantener':'Minimo 6 caracteres'}"/></label>
          <label class="collaborator-edit-field"><span>Rol de acceso</span><select class="filter-select" data-user-role="${person.personId}">
            ${roleOptions.map(role=>`<option value="${role}"${(linkedUser?.role || defaultUserRole)===role?' selected':''}>${role==='admin'?'Admin':role==='manager'?'Jefe de sede':'Colaborador'}</option>`).join('')}
          </select></label>
        </div>
        </details>
        <div class="collaborator-footer-note">${linkedUser?`Conectado actualmente a ${esc(linkedUser.name)} (@${esc(linkedUser.username)}).`:'Todavia no hay usuario conectado para iniciar sesion con este personal.'}</div>
      </section>
      <section class="collaborator-edit-card small">
        <div class="collaborator-card-title"><span class="collaborator-card-icon collaborator-section-icon" aria-hidden="true"><svg viewBox="0 0 28 28" width="28" height="28" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="22" height="21" rx="3"/><path d="M9 2v6m10-6v6M3 12h22"/></svg></span>Fechas y vigencia</div>
        <div class="collaborator-edit-grid">
        <label class="collaborator-edit-field"><span>Ingreso a empresa</span><input class="search-input" data-collaborator-hire-date="${person.personId}" type="date" value="${hireDateForPerson(person)}"/></label>
        <label class="collaborator-edit-field"><span>Cuenta desde</span><input class="search-input" data-collaborator-transfer-date="${person.personId}" type="date" value="${transferDate}"/></label>
        </div>
      </section>
</div>
<div class="collaborator-edit-column">
      <section class="collaborator-edit-card">
        <div class="collaborator-card-title"><span class="collaborator-card-icon collaborator-section-icon" aria-hidden="true"><svg viewBox="0 0 28 28" width="28" height="28" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="7" width="22" height="17" rx="3"/><path d="M9 7V4h10v3M3 13a27 27 0 0 0 22 0M12 14h4"/></svg></span>Información laboral</div>
        <div class="collaborator-edit-grid">
        <label class="collaborator-edit-field"><span>Cargo</span><select class="filter-select" data-payroll-role="${person.personId}">${PAYROLL_ROLE_OPTIONS.map(option=>`<option value="${option}"${(person.payrollRole||'Sin definir')===option?' selected':''}>${option}</option>`).join('')}</select></label>
        <label class="collaborator-edit-field"><span>Sueldo mensual efectivo</span><div class="money-input"><span class="money-prefix">S/</span><input class="search-input" data-payroll-salary="${person.personId}" type="number" min="0" step="0.01" value="${getEditableMonthlySalary(person).toFixed(2)}"/></div></label>
        <label class="collaborator-edit-field"><span>Sueldo vigente desde</span><input class="search-input" type="month" data-salary-effective-month="${person.personId}" value="${limaTodayKey().slice(0,7)}" max="${limaTodayKey().slice(0,7)}"/><small>Aplica desde este mes; conserva los sueldos anteriores.</small></label>
        <details class="collaborator-edit-field collaborator-full-field"><summary>Historial de sueldos</summary>${(person.extraBonuses?.__salaryHistory||[]).map(entry=>`<div>${entry.effectiveMonth==='0001-01'?'Anterior, vigencia por confirmar':esc(entry.effectiveMonth)} · ${money(entry.monthlySalary)}</div>`).join('')||'<small>Sin cambios fechados anteriores. Los próximos cambios quedarán registrados.</small>'}</details>
        <label class="collaborator-edit-field"><span>Penalidad min. tarde</span><input class="search-input" data-payroll-penalty="${person.personId}" type="number" min="0" step="0.01" value="${getPenaltyPerMinute(person).toFixed(2)}"/></label>
        <label class="collaborator-edit-field"><span>Bono puntualidad</span><input class="search-input" data-payroll-bonus="${person.personId}" type="number" min="0" step="0.01" value="${getBonusAmount(person).toFixed(2)}"/></label>

        <label class="collaborator-edit-field"><span>Jornada</span><select class="filter-select" data-employment-type="${person.personId}">${EMPLOYMENT_TYPE_OPTIONS.map(option=>`<option value="${option.value}"${employmentType===option.value?' selected':''}>${option.label}</option>`).join('')}</select></label>
        <label class="collaborator-edit-field"><span>Modalidad part time</span><select class="filter-select" data-part-time-mode="${person.personId}" ${employmentType==='PART_TIME'?'':'disabled'}>${PART_TIME_MODE_OPTIONS.map(option=>`<option value="${option.value}"${partTimeMode===option.value?' selected':''}>${option.label}</option>`).join('')}</select></label>
        <label class="collaborator-edit-field"><span>Sede actual</span><select class="filter-select" data-collaborator-sede="${person.personId}">${SEDES.map(option=>`<option value="${option}"${currentSede===option?' selected':''}>${option}</option>`).join('')}</select></label>

        <div class="collaborator-edit-field collaborator-full-field collaborator-commissions"><span>Comisiones y pagos variables</span><label class="rating-check" style="margin-top:8px"><input type="checkbox" data-commissions-enabled="${person.personId}" ${!blocksVariablePay(person)?'checked':''}/> <span>Comisiona por registros, calificaciones y demas variables</span></label><small style="display:block;margin-top:7px;color:var(--text3)">Si se desactiva, conserva solo sueldo, horas extra y bono de puntualidad.</small></div>
      </div>
      </section>
      <section class="collaborator-edit-card">
        <div class="collaborator-card-title"><span class="collaborator-card-icon collaborator-section-icon" aria-hidden="true"><svg viewBox="0 0 28 28" width="28" height="28" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="m2 10 12-7 12 7ZM4 25h20M6 13v9m8-9v9m8-9v9"/></svg></span>Cuentas para deposito</div>
        ${renderBankAccountRows(person)}
      </section>
</div>
      <details class="collaborator-edit-card wide collaborator-history-details"><summary>Historial y bonos adicionales</summary>
      <label class="collaborator-manager-field ${isManagerRole?'':'soft-hidden'}">
        <span>Bono por personal puntual</span>
        <input class="search-input" data-manager-punctual-bonus="${person.personId}" type="number" min="0" step="0.01" value="${getManagerPunctualStaffBonusRate(person).toFixed(2)}"/>
      </label>
      ${isManagerRole?`<div class="manager-punctual-preview"><strong>${money(person.managerPunctualStaffBonus || 0)}</strong><span>${person.managerPunctualStaffCount || 0} personal(es) puntuales este mes - minimo ${MIN_MANAGER_PUNCTUAL_STAFF_DAYS} dias - ${money(person.managerPunctualStaffBonusRate || DEFAULT_MANAGER_PUNCTUAL_STAFF_BONUS)} c/u</span></div>`:''}
      ${renderCollaboratorHistory(person)}
      </details>
      </div>
      <div class="modal-actions">
        <button class="btn-cancel" data-collaborator-close>Cancelar</button>
        <button class="btn-primary" data-collaborator-modal-save="${person.personId}">Guardar cambios</button>
      </div>
    </div>
  </div>`;
}

function renderSueldos(){
  let h=`<div class="page-header"><div class="page-title">Sueldos</div><div class="page-sub">Separado en dos pagos: sueldo por asistencia, tardanzas y horas extra; comisiones por bonos, calificaciones, referidos y demas variables</div></div>`;
  try{
    if(ensureStateModulesLoaded(['safetypayCodes'])){
      return h + `<div class="table-wrap"><div class="empty-state"><div class="section-spinner" role="status" aria-label="Cargando"></div><p>Cargando Safetypay para calcular bonos...</p></div></div>`;
    }
    const selectedMonth=salaryViewMonthKey();
    const selectedClosure=getClosure(selectedMonth);
    const closedSalaryData=closedSalaryDataFromClosure(selectedMonth);
    if(!ratingsLoadedFor(selectedMonth) && !RATINGS_LOADING){
      setTimeout(()=>loadRatings(false, true, selectedMonth), 0);
    }
    if(!closedSalaryData && ensureAttendanceLoaded()){
      return h + `<div class="table-wrap"><div class="empty-state"><div class="section-spinner" role="status" aria-label="Cargando"></div><p>Cargando sueldos...</p></div></div>`;
    }
    if(!closedSalaryData && ATTENDANCE_LOADING && !ATTENDANCE){
      return h + `<div class="table-wrap"><div class="empty-state"><div class="section-spinner" role="status" aria-label="Cargando"></div><p>Cargando sueldos...</p></div></div>`;
    }
    if(!closedSalaryData && ATTENDANCE_ERROR){
      return h + `<div class="alert-banner"><div class="ab-icon">!</div><div class="ab-text"><strong>No se pudo cargar la asistencia.</strong> ${ATTENDANCE_ERROR}</div></div>`;
    }
    if(!closedSalaryData && (!ATTENDANCE || !ATTENDANCE.people?.length)){
      return h + `<div class="table-wrap"><div class="empty-state"><div class="es-icon">-</div><p>Aun no hay asistencias importadas.</p></div></div>`;
    }

    const people=(closedSalaryData ? closedSalaryData.people : getAttendancePeople())
      .filter(person=>!state.salarySede || normalizeSede(person.closedSnapshot ? person.sede : getPersonSede(person))===state.salarySede)
      .sort((a,b)=>String(a.personName||'').localeCompare(String(b.personName||''), 'es', { sensitivity:'base' }));
    const departments=closedSalaryData ? [...new Set(closedSalaryData.people.map(person=>person.department).filter(Boolean))].sort() : getAttendanceDepartments();
    const salaryData=getSalaryPeople({ date:salaryViewMonthDate() });

    h+=`<div class="table-wrap" style="margin-bottom:1rem"><div class="table-header"><div class="table-title">Mes visible: ${monthLabelFromKey(selectedMonth)}</div>${monthFilterSelectHtml('salaryMonth', selectedMonth, { includeEmpty:false, count:24, extraValues: MONTHLY_CLOSURES.map(item=>item.month) })}<span class="days-chip ${selectedClosure?.status==='CLOSED'?'ok':'warn'}">${selectedClosure?.status==='CLOSED'?'Mes cerrado':'Mes abierto'}</span></div></div>`;
    h+=closedSalaryData
      ? `<div class="alert-banner"><div class="ab-icon">i</div><div class="ab-text"><strong>Vista congelada del cierre:</strong> estos montos vienen del cierre mensual guardado. El detalle diario solo aparece si la asistencia de ese mes sigue cargada o desde el JSON archivado.</div></div>`
      : '';

    h+=`<div class="table-wrap" style="margin-bottom:1.5rem"><div class="table-header">
    <div class="table-title">Pagos estimados de ${salaryData.monthLabel}</div>
    <input class="search-input" id="attendanceSearch" placeholder="Nombre o DNI..." value="${state.attendanceSearch}" style="width:190px"/>
    <select class="filter-select" id="salarySede" aria-label="Sede">
      <option value="">Todas las sedes</option>
      ${SEDES.map(sede=>`<option value="${sede}"${state.salarySede===sede?' selected':''}>${sede}</option>`).join('')}
    </select>
    <select class="filter-select" id="attendanceDepartment">
      <option value="">Todas las Areas</option>
      ${departments.map(department=>`<option value="${department}"${state.attendanceDepartment===department?' selected':''}>${department}</option>`).join('')}
    </select>
    <select class="filter-select" id="attendancePerson">
      <option value="">Todo el personal</option>
      ${people.map(person=>`<option value="${person.personId}"${state.attendancePerson===person.personId?' selected':''}>${person.personName}</option>`).join('')}
    </select>
    <select class="filter-select" id="salaryExportFormat" style="width:115px">
      <option value="pdf">PDF</option>
      <option value="excel">Excel</option>
    </select>
    <button class="btn-sm" id="exportSalariesBtn">Descargar</button>
    ${isAdmin()&&!closedSalaryData?`<button class="btn-sm success" id="payAllSalariesBtn">Pagar todos los pendientes (${salaryData.people.filter(person=>!person.salaryPaid).length})</button>`:''}
    ${isAdmin()&&!closedSalaryData?`<button class="btn-sm success" id="payAllCommissionsBtn">Pagar todas las comisiones (${salaryData.people.filter(person=>person.salaryPaid && !person.commissionsPaid).length})</button>`:''}
    <button class="btn-sm danger" id="resetAttendanceBtn">Borrar mes</button>
    <button class="btn-sm" id="attendanceRefresh">Actualizar</button>
  </div>
  <table><thead><tr><th>Persona</th><th>Cargo</th><th>Dias pagables</th><th>Tardanzas</th><th>Penalidades</th><th>Min extra</th><th>Sueldo</th><th>Comisiones</th><th>Total</th><th>Pago</th><th></th></tr></thead><tbody>`;
  salaryData.people.forEach(person=>{
    h+=`<tr class="click-row" data-salary-detail="${person.personId}">
      <td>${compactPersonCell(person.personName, person.personId)}</td>
      <td>${person.payrollRole||'Sin definir'}<div style="font-size:11px;color:var(--text3);margin-top:4px">${person.closedSnapshot?'Cierre mensual congelado':getAttendanceSchedule(person).label}</div></td>
      <td style="font-weight:700;color:var(--green)">${person.dayPayments.filter(day=>Number(day.dailyPay||0)>0).length}</td>
      <td style="font-weight:700;color:${person.lateEntries>0?'var(--amber)':'var(--text2)'}">${person.lateEntries}</td>
      <td style="font-weight:700;color:${person.totalDiscounts>0?'var(--red)':'var(--text2)'}">${money(person.totalDiscounts)}</td>
      <td style="font-weight:700;color:${person.totalExtraMinutes>0?'var(--green)':'var(--text2)'}">${minutesLabel(person.totalExtraMinutes)}</td>
      <td style="font-weight:700;color:${Number(person.salaryPay||0)>0?'var(--green)':'var(--text2)'}">${money(person.salaryPay||0)}</td>
      <td style="font-weight:700;color:${Number(person.commissionsPay||0)>0?'var(--green)':'var(--text2)'}">${money(person.commissionsPay||0)}</td>
      <td style="font-family:var(--font2);font-size:18px;font-weight:700;color:var(--green)">S/ ${Number(person.estimatedSalary || 0).toFixed(2)}</td>
      <td><div style="display:grid;gap:5px"><span class="days-chip ${person.salaryPaid?'ok':'warn'}">${person.salaryPaid?'Sueldo pagado':'Sueldo pendiente'}</span>${Number(person.commissionsPay||0)>0?`<span class="days-chip ${person.commissionsPaid?'ok':'warn'}">${person.commissionsPaid?'Comisiones pagadas':person.salaryPaid?'Comisiones pendientes':'Primero sueldo'}</span>`:'<span class="days-chip muted">Sin comisiones</span>'}</div></td>
      <td><button class="action-btn" data-salary-detail-btn="${person.personId}">Ver detalle</button></td>
    </tr>`;
  });
  if(!salaryData.people.length) h+=`<tr><td colspan="11"><div class="empty-state"><div class="es-icon">-</div><p>No hay personas para calcular sueldo con esos filtros.</p></div></td></tr>`;
  h+=`</tbody></table></div>`;
  if(!salaryHistoryRequested() || ATTENDANCE_OWNER_KEY!==attendanceCacheKey()){
    return h + '<div class="table-wrap" style="padding:1rem"><div class="table-title">Gratificación estimada</div><p style="color:var(--text2)">El historial del semestre se carga al consultar la gratificación.</p><button class="btn-sm" id="salaryLoadGratification">Ver gratificación</button></div>';
  }
  const gratificationRows=buildGratificationRows(salaryData.people, selectedMonth);
  const gratificationContextInfo=gratificationContext(selectedMonth);
  const gratificationTotal=gratificationRows.reduce((sum,row)=>sum+Number(row.total||0),0);
  h+=`<div class="table-wrap" style="margin-bottom:1.5rem"><div class="table-header">
    <div class="table-title">Gratificacion estimada - ${gratificationContextInfo.label}</div>
    <div style="color:var(--text2);font-size:12px">Periodo ${gratificationContextInfo.periodLabel} - MYPE 50% - sin bono ni EPS</div>
  </div>
  <table><thead><tr><th>Colaborador</th><th>Ingreso</th><th>Sueldo base</th><th>Variable promedio</th><th>Meses equivalentes</th><th>Horas sistema</th><th>Grati base</th><th>MYPE 50%</th><th>Total grati</th></tr></thead><tbody>
    ${gratificationRows.map(row=>`<tr>
      <td>${compactPersonCell(row.person.personName, row.person.personId)}</td>
      <td>${row.hireDate ? fmt(row.hireDate) : '<span style="color:var(--amber);font-weight:700">Sin fecha</span>'}</td>
      <td>${money(row.baseSalary)}${row.salaryHistoryUnverified?'<div style="font-size:11px;color:var(--amber)">Revisar vigencias salariales históricas</div>':''}</td>
      <td>${money(row.variableAverage)}<div style="font-size:11px;color:var(--text3);margin-top:3px">Comisiones: ${row.commissionMonths}/6 · HE: ${row.overtimeMonths}/6 (regular: mínimo 3 por concepto)</div></td>
      <td style="font-weight:800">${row.monthsWorked.toFixed(2)}/6${row.nonComputableDays?`<div style="font-size:11px;color:var(--text3)">${row.nonComputableDays} día(s) no computable(s)</div>`:''}${row.unverifiedDays || !row.hireDate?`<div style="font-size:11px;color:var(--amber)">${!row.hireDate?'Falta fecha de ingreso':row.unverifiedDays+' día(s) por verificar'}</div>`:''}</td>
      <td>${row.credits.reduce((sum,item)=>sum+item.workedHours,0).toFixed(1)} / ${row.credits.reduce((sum,item)=>sum+item.expectedHours,0).toFixed(1)} h</td>
      <td>${money(row.fullRegimeGratification)}</td>
      <td>${money(row.gratification)}</td>
      <td style="font-family:var(--font2);font-size:18px;font-weight:800;color:var(--green)">${money(row.total)}</td>
    </tr>`).join('') || '<tr><td colspan="9"><div class="empty-state"><p>No hay colaboradores para estimar gratificacion.</p></div></td></tr>'}
    <tr><td colspan="8" style="text-align:right;font-weight:800">Total estimado</td><td style="font-family:var(--font2);font-size:18px;font-weight:900;color:var(--green)">${money(gratificationTotal)}</td></tr>
  </tbody></table>
  <div style="padding:0 1rem 1rem;color:var(--text2);font-size:12px">Sueldo de referencia: ${gratificationContextInfo.baseSalaryMonth}${gratificationContextInfo.baseSalaryMonth>limaTodayKey().slice(0,7)?" (proyectado con el historial conocido)":""}. ${gratificationContextInfo.periodLabel}: se computan meses calendario completos hasta ${fmt(limaTodayKey())}, con reducción de 1/30 de mes por día no computable registrado. Las tardanzas y horas extra no modifican el tiempo computable. Las horas mostradas suman todo el semestre y son informativas. Comisiones y horas extra (incluidas las del mes anterior pagaderas en este período) requieren regularidad de al menos 3 meses por concepto. Los datos faltantes o días justificados sin clasificación de pago requieren revisión. Estimación MYPE 50%, sin bonificación extraordinaria ni EPS.</div>
  </div>`;
  return h;
  }catch(error){
    console.error('Error al renderizar sueldos', error);
    return h + `<div class="alert-banner"><div class="ab-icon">!</div><div class="ab-text"><strong>No se pudo mostrar sueldos.</strong> ${esc(error?.message || 'Actualiza la pagina e intenta otra vez.')}</div></div>`;
  }
}

function buildMonthlyClosureSnapshot(month=getSelectedClosureMonth()){
  const salaryData=getSalaryPeople({ date:monthDateFromKey(month) });
  const people=salaryData.people || [];
  const records=RECORDS.filter(record=>recordAccountingMonthKey(record)===month);
  const referrals=REFERRALS.filter(referral=>monthKeyFromDate(referral.createdAt)===month);
  const commissionTotal=records.filter(record=>record.validatedAt).length * getCommissionRate();
  const referralTotal=referrals.filter(referral=>referral.validatedAt).reduce((sum, referral)=>sum+Number(referral.referralCommission||0),0);
  const salaryTotal=people.reduce((sum, person)=>sum+Number(person.estimatedSalary||0),0);
  const bonusTotal=people.reduce((sum, person)=>sum+Number(person.bonusAmount||0)+Number(person.extraBonusAmount||0)+Number(person.penaltyIssuerBonus||0)+Number(person.ratingDecisionBonus||0)+Number(person.recordValidationBonus||0)+Number(person.wrongCardBonus||0)+Number(person.callBonus||0)+Number(person.safetypaySharedBonus||0)+Number(person.safetypayManagerBonus||0)+Number(person.managerPunctualStaffBonus||0)+Number(person.ratingBonus||0)+Number(person.referralBonus||0),0);
  const discountTotal=people.reduce((sum, person)=>sum+Number(person.totalDiscounts||0),0);
  const pendingRecords=records.filter(record=>canValidateOrReject(record)).length;
  const pendingReferrals=referrals.filter(referral=>!referral.validatedAt&&!referral.rejectedAt).length;
  const pendingAttendance=(ATTENDANCE?.changeRequests||[]).length;
  const unpaidSalaries=people.filter(person=>!person.salaryPaid).length;
  const unpaidCommissions=people.filter(person=>Number(person.commissionsPay||0)>0 && !person.commissionsPaid).length;
  const details=people.map(person=>{
    const user=USERS.find(item=>String(item.name||'').toLowerCase()===String(person.personName||'').toLowerCase());
    const userRecords=user ? records.filter(record=>record.userId===user.id&&record.validatedAt).length : 0;
    const userReferrals=user ? referrals.filter(referral=>referral.userId===user.id&&referral.validatedAt).reduce((sum, referral)=>sum+Number(referral.referralCommission||0),0) : 0;
    return {
      personId: person.personId,
      personName: person.personName,
      department: person.department,
      payrollRole: person.payrollRole,
      salary: Number(person.estimatedSalary||0),
      bonus: Number(person.bonusAmount||0)+Number(person.extraBonusAmount||0)+Number(person.penaltyIssuerBonus||0)+Number(person.ratingDecisionBonus||0)+Number(person.recordValidationBonus||0)+Number(person.wrongCardBonus||0)+Number(person.callBonus||0)+Number(person.safetypaySharedBonus||0)+Number(person.safetypayManagerBonus||0)+Number(person.managerPunctualStaffBonus||0)+Number(person.ratingBonus||0)+Number(person.referralBonus||0),
      discounts: Number(person.totalDiscounts||0),
      overtimeMinutes: Number(person.totalExtraMinutes||0),
      paid: !!person.salaryPaid,
      commissionsPaid: !!person.commissionsPaid || Number(person.commissionsPay||0)<=0,
      commissionPaidMonth: person.commissionPaidMonth || null,
      commissionPaidAt: person.commissionPaidAt || null,
      commission: userRecords * getCommissionRate(),
      referralCommission: userReferrals,
    };
  });
  return {
    month,
    summary:{
      monthLabel: monthLabelFromKey(month),
      collaborators: people.length,
      salaryTotal,
      bonusTotal,
      discountTotal,
      commissionTotal,
      referralTotal,
      totalToPay: salaryTotal + commissionTotal,
    },
    pending:{ pendingRecords, pendingReferrals, pendingAttendance, unpaidSalaries, unpaidCommissions },
    details,
  };
}

function renderCierreMensual(){
  let h=`<div class="page-header"><div class="page-title">Cierre mensual</div><div class="page-sub">Congela el mes, revisa pendientes y guarda una foto final para pagos y auditoria</div></div>`;
  if(!isAdmin()) return h + `<div class="alert-banner"><div class="ab-icon">!</div><div class="ab-text">Solo el admin puede cerrar meses.</div></div>`;
  if(ensureStateModulesLoaded(['monthlyClosures'])) return h + `<div class="table-wrap"><div class="empty-state"><div class="section-spinner" role="status" aria-label="Cargando"></div><p>Preparando cierres...</p></div></div>`;
  if(ensureAttendanceLoaded()) return h + `<div class="table-wrap"><div class="empty-state"><div class="section-spinner" role="status" aria-label="Cargando"></div><p>Cargando cierre...</p></div></div>`;
  if(ATTENDANCE_LOADING && !ATTENDANCE) return h + `<div class="table-wrap"><div class="empty-state"><div class="section-spinner" role="status" aria-label="Cargando"></div><p>Cargando cierre...</p></div></div>`;
  const month=getSelectedClosureMonth();
  const snapshot=buildMonthlyClosureSnapshot(month);
  const closure=getClosure(month);
  const pendingTotal=Object.values(snapshot.pending).reduce((sum,value)=>sum+Number(value||0),0);
  const paymentBlockers=Number(snapshot.pending.unpaidSalaries||0) + Number(snapshot.pending.unpaidCommissions||0);
  h+=`<div class="table-wrap closure-panel"><div class="table-header">
    <div class="table-title">Mes a cerrar</div>
    ${monthFilterSelectHtml('closureMonth', month, { includeEmpty:false, count:24, extraValues: MONTHLY_CLOSURES.map(item=>item.month) })}
    <button class="btn-sm" id="closureRefresh">Actualizar</button>
    <button class="btn-sm" id="closurePdf">Descargar PDF</button>
  </div></div>`;
  h+=`<div class="stat-grid">
    <div class="stat-card"><div class="stat-label">Estado</div><div class="stat-value ${closure?.status==='CLOSED'?'green':'amber'}">${closure?.status==='CLOSED'?'Cerrado':'Abierto'}</div><div class="stat-sub">${monthLabelFromKey(month)}</div></div>
    <div class="stat-card"><div class="stat-label">Sueldos</div><div class="stat-value green">${money(snapshot.summary.salaryTotal)}</div><div class="stat-sub">${snapshot.summary.collaborators} colaboradores</div></div>
    <div class="stat-card"><div class="stat-label">Comisiones</div><div class="stat-value green">${money(snapshot.summary.commissionTotal)}</div><div class="stat-sub">Registros validados</div></div>
    <div class="stat-card"><div class="stat-label">Referidos</div><div class="stat-value green">${money(snapshot.summary.referralTotal)}</div><div class="stat-sub">Referidos validados</div></div>
    <div class="stat-card"><div class="stat-label">Total general</div><div class="stat-value green">${money(snapshot.summary.totalToPay)}</div><div class="stat-sub">Sueldos + comisiones + referidos</div></div>
  </div>`;
  h+=`<div class="closure-grid">
    <div class="table-wrap"><div class="table-header"><div class="table-title">Pendientes antes de cerrar</div></div>
      <div class="closure-checks">
        <div><span>Registros pendientes</span><strong class="${snapshot.pending.pendingRecords?'bad':'ok'}">${snapshot.pending.pendingRecords}</strong></div>
        <div><span>Referidos pendientes</span><strong class="${snapshot.pending.pendingReferrals?'bad':'ok'}">${snapshot.pending.pendingReferrals}</strong></div>
        <div><span>Solicitudes asistencia</span><strong class="${snapshot.pending.pendingAttendance?'bad':'ok'}">${snapshot.pending.pendingAttendance}</strong></div>
        <div><span>Sueldos sin marcar sueldo pagado</span><strong class="${snapshot.pending.unpaidSalaries?'bad':'ok'}">${snapshot.pending.unpaidSalaries}</strong></div>
        <div><span>Comisiones sin marcar pagadas</span><strong class="${snapshot.pending.unpaidCommissions?'bad':'ok'}">${snapshot.pending.unpaidCommissions}</strong></div>
      </div>
      <div class="modal-actions" style="padding:0 1rem 1rem">
        ${closure?.status==='CLOSED'
          ? `<button class="btn-sm danger" id="reopenMonth">Reabrir mes</button>`
          : `<button class="btn-sm success" id="closeMonth" ${paymentBlockers?'disabled title="Primero paga sueldos y comisiones"':''}${pendingTotal&&!paymentBlockers?'':' style="font-weight:800"'}>Cerrar mes</button>`}
      </div>
      ${paymentBlockers?`<div class="alert-banner" style="margin:0 1rem 1rem"><div class="ab-icon">!</div><div class="ab-text"><strong>Cierre bloqueado.</strong> Primero marca todos los sueldos pagados y luego todas las comisiones pagadas.</div></div>`:''}
    </div>
    <div class="table-wrap"><div class="table-header"><div class="table-title">Resumen de dinero</div></div>
      <div class="closure-checks">
        <div><span>Bonos incluidos</span><strong class="ok">${money(snapshot.summary.bonusTotal)}</strong></div>
        <div><span>Descuentos y penalidades</span><strong class="${snapshot.summary.discountTotal?'bad':'ok'}">${money(snapshot.summary.discountTotal)}</strong></div>
        <div><span>Total a pagar</span><strong class="ok">${money(snapshot.summary.totalToPay)}</strong></div>
      </div>
    </div>
  </div>`;
  h+=`<div class="table-wrap"><div class="table-header"><div class="table-title">Detalle congelable del mes</div></div>
    <table><thead><tr><th>Colaborador</th><th>Cargo</th><th>Sueldo</th><th>Bono</th><th>Descuentos</th><th>Comision</th><th>Referidos</th><th>Estado pagos</th></tr></thead><tbody>`;
  snapshot.details.forEach(row=>{
    h+=`<tr><td>${compactPersonCell(row.personName,row.personId)}</td><td>${row.payrollRole||'-'}</td><td>${money(row.salary)}</td><td>${money(row.bonus)}</td><td>${money(row.discounts)}</td><td>${money(row.commission)}</td><td>${money(row.referralCommission)}</td><td><div style="display:grid;gap:5px"><span class="days-chip ${row.paid?'ok':'warn'}">${row.paid?'Sueldo pagado':'Sueldo pendiente'}</span><span class="days-chip ${row.commissionsPaid?'ok':'warn'}">${row.commissionsPaid?'Comisiones pagadas':'Comisiones pendientes'}</span></div></td></tr>`;
  });
  if(!snapshot.details.length) h+=`<tr><td colspan="8"><div class="empty-state"><p>No hay detalle para este mes.</p></div></td></tr>`;
  h+=`</tbody></table></div>`;
  h+=`<div class="table-wrap"><div class="table-header"><div class="table-title">Historial de cierres</div></div>
    <table><thead><tr><th>Mes</th><th>Estado</th><th>Cerrado por</th><th>Fecha cierre</th><th>Total</th><th>Reapertura</th></tr></thead><tbody>`;
  MONTHLY_CLOSURES.forEach(item=>{
    const summary=item.summary||{};
    h+=`<tr><td>${monthLabelFromKey(item.month)}</td><td><span class="days-chip ${item.status==='CLOSED'?'ok':'warn'}">${item.status==='CLOSED'?'Cerrado':'Reabierto'}</span></td><td>${item.closedBy?.name||'-'}</td><td>${fmtDateTime(item.closedAt)}</td><td>${money(summary.totalToPay)}</td><td>${item.reopenReason||'-'}</td></tr>`;
  });
  if(!MONTHLY_CLOSURES.length) h+=`<tr><td colspan="6"><div class="empty-state"><p>Aun no hay cierres guardados.</p></div></td></tr>`;
  h+=`</tbody></table></div>`;
  return h;
}

function renderSalaryDetailModal(){
  const salaryData=getSalaryPeople({ ignoreFilters:true, date:salaryViewMonthDate() });
  const person=getSalaryPersonById(state.salaryDetailId);
  if(!person){
    return `<div class="modal-overlay" id="salaryDetailOverlay"><div class="modal salary-modal"><h3>Detalle de sueldo</h3><p class="page-sub">No se encontro a la persona seleccionada.</p><div class="modal-actions"><button class="btn-cancel" id="salaryDetailClose">Cerrar</button></div></div></div>`;
  }
  const schedule=getAttendanceSchedule(person);
  const isManagerSalaryRole=(person?.payrollRole || '')==='Jefe de Sede';
  const regularPay=person.dayPayments.reduce((sum, day)=>sum + Number(day.regularPay || 0), 0);
  const overtimePay=person.dayPayments.reduce((sum, day)=>sum + Number(day.overtimePay || 0), 0);
  const latePenalty=Number(person.totalLatePenalty || 0);
  const earlyLeavePenalty=Number(person.totalEarlyLeavePenalty || 0);
  const penaltyReportDiscount=Number(person.penaltyReportDiscount || 0);
  const paymentAuditManagerDiscount=Number(person.paymentAuditManagerDiscount || 0);
  const paymentAuditReporterBonus=Number(person.paymentAuditReporterBonus || 0);
  const paidHolidayDays=Number(person.paidHolidayDays || 0);
  const bonusAmount=Number(person.bonusAmount || 0);
  const extraBonusAmount=Number(person.extraBonusAmount || 0);
  const otherExtraBonusAmount=extraBonusAmount;
  const penaltyIssuerBonus=Number(person.penaltyIssuerBonus || 0);
  const ratingDecisionBonus=Number(person.ratingDecisionBonus || 0);
  const recordValidationBonus=Number(person.recordValidationBonus || 0);
  const wrongCardBonus=Number(person.wrongCardBonus || 0);
  const callBonus=Number(person.callBonus || 0);
  const ratingBonus=Number(person.ratingBonus || 0);
  const referralBonus=Number(person.referralBonus || 0);
  const managerPunctualStaffBonus=Number(person.managerPunctualStaffBonus || 0);
  const recordCommission=Number(person.recordCommission || 0);
  const salaryPay=Number(person.salaryPay || 0);
  const commissionsPay=Number(person.commissionsPay || 0);
  const hideBonusRowsForManagerViewer=isManager() && !isAdmin();
  const hiddenBonusTotal=hideBonusRowsForManagerViewer
    ? (person.hasBonus ? bonusAmount : 0) +
      otherExtraBonusAmount +
      Number(person.safetypaySharedBonus || 0) +
      Number(person.safetypayManagerBonus || 0) +
      managerPunctualStaffBonus
    : 0;
  const visibleCommissionsPay=Math.max(0, commissionsPay - hiddenBonusTotal);
  const visibleTotalPay=Math.max(0, Number(person.estimatedSalary || 0) - hiddenBonusTotal);
  const paidDays=person.dayPayments.filter(day=>Number(day.dailyPay||0)>0).length;
  const unpaidDays=person.dayPayments.filter(day=>attendanceDayWorked(day) && Number(day.dailyPay||0)<=0).length;
  const bonusStatus=person.hasBonus ? `Aplica ${money(person.bonusAmount)}` : (person.bonusDisabled ? `Quitado: ${person.bonusBlockedReason}` : (person.lateEntries>0 ? 'No aplica por tardanza' : 'No aplica'));
  const paidLabel=person.salaryPaid ? `Sueldo pagado${person.salaryPaidAt ? ` el ${fmtDateTime(person.salaryPaidAt)}` : ''}` : 'Sueldo pendiente';
  const commissionPaidLabel=visibleCommissionsPay<=0 ? 'Sin comisiones por pagar' : person.commissionsPaid ? `Comisiones pagadas${person.commissionPaidAt ? ` el ${fmtDateTime(person.commissionPaidAt)}` : ''}` : person.salaryPaid ? 'Comisiones pendientes de pago' : 'Primero marca sueldo pagado';
  const managerPunctualStaffDetailRows=managerPunctualStaffRows(person, { compact:true });
  const rows=person.dayPayments
    .slice()
    .sort((a,b)=>a.date.localeCompare(b.date))
    .map(day=>{
      const status=attendanceStatusMeta(day);
      return `<tr>
        <td>${fmt(day.date)}</td>
        <td>${shortTime(day.entryTime)}</td>
        <td>${shortTime(day.exitTime)}</td>
        <td><span class="days-chip ${status.cls}">${status.label}</span></td>
        <td>${money(day.regularPay)}</td>
        <td style="color:${Number(day.overtimePay||0)>0?'var(--green)':'var(--text2)'}">${money(day.overtimePay)}</td>
        <td style="color:${Number(day.latePenalty||0)+Number(day.earlyLeavePenalty||0)>0?'var(--red)':'var(--text2)'}">${money(Number(day.latePenalty||0)+Number(day.earlyLeavePenalty||0))}</td>
        <td style="font-weight:800;color:${Number(day.dailyPay||0)>0?'var(--green)':'var(--text2)'}">${money(day.dailyPay)}</td>
      </tr>`;
    }).join('');
  return `<div class="modal-overlay" id="salaryDetailOverlay">
    <div class="modal salary-modal">
      <div class="salary-detail-head">
        <div>
          <div class="dialog-kicker">Detalle de sueldo</div>
          <h3>${person.personName}</h3>
          <div class="page-sub">${person.personId} - ${person.payrollRole||'Sin definir'} - ${schedule.label}</div>
          <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px">
            ${hideBonusRowsForManagerViewer?'':`<span class="days-chip ${person.hasBonus?'ok':'danger'}">Bono puntualidad: ${bonusStatus}</span>`}
            <span class="days-chip ${person.salaryPaid?'ok':'warn'}">${paidLabel}</span>
            <span class="days-chip ${visibleCommissionsPay>0?'warn':'muted'}">${commissionPaidLabel}</span>
          </div>
        </div>
        <div class="salary-total-box salary-summary-box">
          <div class="salary-summary-item">
            <span>Sueldo</span>
            <strong>${money(salaryPay)}</strong>
          </div>
          <div class="salary-summary-item">
            <span>Comisiones</span>
            <strong>${money(visibleCommissionsPay)}</strong>
          </div>
          <div class="salary-summary-item is-total">
            <span>Total del mes</span>
            <strong>${money(visibleTotalPay)}</strong>
          </div>
        </div>
      </div>

      <div class="salary-detail-grid">
        <div class="salary-mini-card"><span>Sueldo base mensual${person.salaryHistoryUnverified?" · vigencia histórica por confirmar":""}</span><strong>${money(person.monthlySalary)}</strong></div>
        <div class="salary-mini-card"><span>Dias laborables del mes</span><strong>${salaryData.workdays}</strong></div>
        <div class="salary-mini-card"><span>Dias pagables</span><strong>${paidDays}</strong></div>
        <div class="salary-mini-card"><span>Feriados pagados</span><strong>${paidHolidayDays}</strong></div>
      </div>

      <div class="salary-breakdown">
        <div class="salary-break-card positive">
          <div class="salary-break-title">Pago sueldo</div>
          <div><span>Horas normales trabajadas</span><strong>${money(regularPay)}</strong></div>
          <div><span>Horas extra (${Math.floor(Number(person.totalExtraMinutes || 0)/60)} h ${Number(person.totalExtraMinutes || 0)%60} min)</span><strong>${money(overtimePay)}</strong></div>
          ${person.previousMonthExtraMinutes>0?`<div class="salary-previous-overtime"><span>Horas extra del mes pasado (${minutesLabel(person.previousMonthExtraMinutes)}) · ${fmt(person.previousMonthExtraDate)}</span><strong>${money(person.previousMonthExtraPay)}</strong></div>`:''}
          ${person.deferredExtraMinutes>0?`<div><span>Horas extra para el próximo pago (${minutesLabel(person.deferredExtraMinutes)})</span><strong>Se pagan el mes siguiente</strong></div>`:''}
          ${person.dayPayments.some(day=>day.payrollEstimatedExit)?`<div><span>Jornada del último día</span><strong>Salida prevista ${shortTime(person.dayPayments.find(day=>day.payrollEstimatedExit).payrollEstimatedExit)} · marcaje pendiente</strong></div>`:''}
          <div><span>Tardanzas (${person.lateEntries || 0}) · ${minutesLabel(person.totalLateMinutes || 0)}</span><strong style="color:var(--red)">-${money(latePenalty)}</strong></div>
          <div><span>${earlyLeavePolicyLabel(person.salaryMonthKey)} (${minutesLabel(person.totalEarlyLeaveMinutes || 0)})</span><strong style="color:var(--red)">-${money(earlyLeavePenalty)}</strong></div>
          <div><span>Penalidades aprobadas (${person.approvedPenalties.length})</span><strong style="color:var(--red)">-${money(penaltyReportDiscount)}</strong></div>
          ${paymentAuditManagerDiscount>0?`<div><span>Auditorías de Pagos aprobadas</span><strong style="color:var(--red)">-${money(paymentAuditManagerDiscount)}</strong></div>`:''}
          <div><span>Dias sin pago detectados</span><strong>${unpaidDays}</strong></div>
          <div class="salary-break-total"><span>Total sueldo</span><strong>${money(salaryPay)}</strong></div>
        </div>
        <div class="salary-break-card positive">
          <div class="salary-break-title">Pago comisiones</div>
          <div><span>Registros validados (${person.approvedRecords?.length || 0})</span><strong>${money(recordCommission)}</strong></div>
          ${hideBonusRowsForManagerViewer?'':`<div><span>Bono puntualidad</span><strong>${person.hasBonus ? money(bonusAmount) : 'S/ 0.00'}</strong></div>`}
          ${!hideBonusRowsForManagerViewer && otherExtraBonusAmount>0 ? `<div><span>Bonos aprobados</span><strong>${money(otherExtraBonusAmount)}</strong></div>` : ''}
          ${penaltyIssuerBonus>0 ? `<div><span>Comision por reportes aprobados (${person.approvedSentPenalties?.length || 0})</span><strong>${money(penaltyIssuerBonus)}</strong></div>` : ''}
          ${paymentAuditReporterBonus>0 ? `<div><span>Bonos por auditorías de Pagos (${person.approvedPaymentAuditsSent?.length || 0})</span><strong>${money(paymentAuditReporterBonus)}</strong></div>` : ''}
          ${isManagerSalaryRole ? `<div><span>Comision por operaciones aprobadas (${person.approvedRecordValidations?.length || 0})</span><strong>${money(recordValidationBonus)}</strong></div>` : ''}
          ${ratingDecisionBonus>0 ? `<div><span>Comision por calificaciones aprobadas (${person.approvedRatingDecisions?.length || 0})</span><strong>${money(ratingDecisionBonus)}</strong></div>` : ''}
          <div><span>Tarjetas erroneas aprobadas (${person.approvedWrongCards?.length || 0})</span><strong>${money(wrongCardBonus)}</strong></div>
          <div><span>Llamadas aprobadas (${person.approvedCalls?.length || 0})</span><strong>${money(callBonus)}</strong></div>
          <div><span>Calificaciones aprobadas (${person.approvedRatings?.length || 0})</span><strong>${money(ratingBonus)}</strong></div>
          ${referralBonus>0?`<div><span>Referidos aprobados (${person.approvedReferrals?.length || 0})</span><strong>${money(referralBonus)}</strong></div>`:''}
          ${!hideBonusRowsForManagerViewer && person.safetypaySharedBonus>0?`<div><span>Bono sede Safetypay compartido</span><strong>${money(person.safetypaySharedBonus)}</strong></div>`:''}
          ${!hideBonusRowsForManagerViewer && person.safetypayManagerBonus>0?`<div><span>Bono jefe meta Safetypay</span><strong>${money(person.safetypayManagerBonus)}</strong></div>`:''}
          ${!hideBonusRowsForManagerViewer && managerPunctualStaffBonus>0?`<div><span>Bono personal puntual a cargo (${person.managerPunctualStaffCount || 0})</span><strong>${money(managerPunctualStaffBonus)}</strong></div>`:''}
          ${!hideBonusRowsForManagerViewer && managerPunctualStaffBonus>0 && managerPunctualStaffDetailRows ? `<div class="salary-detail-lines" style="grid-column:1/-1;margin-top:4px"><div class="salary-detail-lines-inner"><div><span style="font-weight:800;color:var(--text)">Colaboradores que generan este bono</span><strong>${person.managerPunctualStaffCount || 0}</strong></div>${managerPunctualStaffDetailRows}</div></div>` : ''}
          <div class="salary-break-total"><span>Total comisiones</span><strong>${money(visibleCommissionsPay)}</strong></div>
        </div>
      </div>

      <div class="salary-breakdown">
        <details class="salary-break-card negative">
          <summary class="salary-break-title" style="cursor:pointer;display:flex;justify-content:space-between;align-items:center">
            <span>Descuentos del sueldo</span>
            <strong style="color:var(--red)">-${money(latePenalty + earlyLeavePenalty + penaltyReportDiscount + paymentAuditManagerDiscount)}</strong>
          </summary>
          <div class="salary-detail-lines"><div class="salary-detail-lines-inner">
            <div><span>Tardanzas del mes (${person.lateEntries || 0})</span><strong style="color:var(--red)">-${money(latePenalty)}</strong></div>
            <div><span>Minutos tarde acumulados</span><strong>${minutesLabel(person.totalLateMinutes || 0)}</strong></div>
            <div><span>${earlyLeavePolicyLabel(person.salaryMonthKey)}</span><strong style="color:var(--red)">-${money(earlyLeavePenalty)}</strong></div>
            <div><span>Minutos de salida anticipada</span><strong>${minutesLabel(person.totalEarlyLeaveMinutes || 0)}</strong></div>
            <div><span>Dias sin pago detectados</span><strong>${unpaidDays}</strong></div>
            ${person.approvedPenalties.length ? person.approvedPenalties.map(report=>`<div><span>${report.penaltyLabel} - ${report.clientName}</span><strong style="color:var(--red)">-${money(report.penaltyAmount)}</strong></div>`).join('') : '<div><span>Sin penalidades aprobadas</span><strong>S/ 0.00</strong></div>'}
            ${paymentAuditManagerDiscount>0?`<div><span>${person.approvedPaymentAuditsAsManager?.length || 0} auditoría(s) de Pagos aprobada(s)</span><strong style="color:var(--red)">-${money(paymentAuditManagerDiscount)}</strong></div>`:''}
          </div></div>
        </details>
        <details class="salary-break-card positive">
          <summary class="salary-break-title" style="cursor:pointer;display:flex;justify-content:space-between;align-items:center">
            <span>Detalle de comisiones</span>
            <strong>${money(visibleCommissionsPay)}</strong>
          </summary>
          <div class="salary-detail-lines"><div class="salary-detail-lines-inner">
            <div><span>Registros validados (${person.approvedRecords?.length || 0})</span><strong>${money(recordCommission)}</strong></div>
            ${hideBonusRowsForManagerViewer?'':`<div><span>Bono puntualidad mensual</span><strong>${person.hasBonus ? money(bonusAmount) : 'S/ 0.00'}</strong></div>`}
            ${hideBonusRowsForManagerViewer?'':(person.extraBonusBreakdown.length ? person.extraBonusBreakdown.map(bonus=>`<div><span>${bonus.label}${bonus.automatic?' - automatico':bonus.quantity?` - x${bonus.quantity}`:''}</span><strong>${money(bonus.amount)}</strong></div>`).join('') : '<div><span>Sin bonos extra</span><strong>S/ 0.00</strong></div>')}
            ${person.penaltyIssuerBonus>0?`<div><span>${person.approvedSentPenalties.length} penalidad(es) aprobadas enviadas</span><strong>${money(person.penaltyIssuerBonus)}</strong></div>`:''}
            ${paymentAuditReporterBonus>0?`<div><span>${person.approvedPaymentAuditsSent?.length || 0} auditoría(s) de Pagos aprobada(s)</span><strong>${money(paymentAuditReporterBonus)}</strong></div>`:''}
            ${isManagerSalaryRole?`<div><span>${person.approvedRecordValidations.length} registro(s) aprobados por jefe</span><strong>${money(person.recordValidationBonus)}</strong></div>`:''}
            ${person.ratingDecisionBonus>0?`<div><span>${person.approvedRatingDecisions.length} calificacion(es) aprobadas por jefe</span><strong>${money(person.ratingDecisionBonus)}</strong></div>`:''}
            ${person.wrongCardBonus>0?`<div><span>${person.approvedWrongCards.length} tarjeta(s) erronea(s) aprobadas</span><strong>${money(person.wrongCardBonus)}</strong></div>`:''}
            ${person.callBonus>0?`<div><span>${person.approvedCalls.length} llamada(s) aprobadas</span><strong>${money(person.callBonus)}</strong></div>`:''}
            ${person.ratingBonus>0?`<div><span>${person.approvedRatings.length} calificacion(es) aprobadas</span><strong>${money(person.ratingBonus)}</strong></div>`:''}
            ${person.referralBonus>0?`<div><span>${person.approvedReferrals.length} referido(s) aprobado(s)</span><strong>${money(person.referralBonus)}</strong></div>`:''}
            ${!hideBonusRowsForManagerViewer && person.safetypaySharedBonus>0?`<div><span>Bono sede Safetypay repartido</span><strong>${money(person.safetypaySharedBonus)}</strong></div>`:''}
            ${!hideBonusRowsForManagerViewer && person.safetypayManagerBonus>0?`<div><span>Bono jefe por meta Safetypay 100%</span><strong>${money(person.safetypayManagerBonus)}</strong></div>`:''}
            ${!hideBonusRowsForManagerViewer && managerPunctualStaffBonus>0?`<div><span>${person.managerPunctualStaffCount || 0} personal(es) puntuales a cargo - ${money(person.managerPunctualStaffBonusRate)} c/u</span><strong>${money(managerPunctualStaffBonus)}</strong></div>`:''}
            ${!hideBonusRowsForManagerViewer && managerPunctualStaffBonus>0 && managerPunctualStaffDetailRows ? managerPunctualStaffDetailRows : ''}
          </div></div>
        </details>
      </div>

      <div class="table-wrap salary-detail-table">
        <div class="table-header"><div class="table-title">Detalle por dia</div><div class="page-sub">${salaryData.monthLabel}</div></div>
        <table><thead><tr><th>Fecha</th><th>Entrada</th><th>Salida</th><th>Estado</th><th>Pago normal</th><th>Horas extra</th><th>Descuento</th><th>Pago dia</th></tr></thead><tbody>
          ${rows || `<tr><td colspan="8"><div class="empty-state"><p>No hay dias registrados este mes.</p></div></td></tr>`}
        </tbody></table>
      </div>

      <div class="salary-final-row">
        <span>Total general: sueldo + comisiones<br><small style="color:var(--text3);font-weight:600">Pago 1: ${person.salaryPaid?'sueldo pagado':'sueldo pendiente'} - Pago 2: ${visibleCommissionsPay>0?'comisiones pendientes':'sin comisiones'}</small></span>
        <strong>${money(visibleTotalPay)}</strong>
      </div>
      <div class="modal-actions">
        ${person.closedSnapshot || hideBonusRowsForManagerViewer?'':`<button class="btn-cancel" id="salaryExtraBonusEdit">Editar bonos</button>
        <button class="btn-cancel" id="salaryBonusToggle">${person.bonusDisabled?'Restaurar bono':'Quitar bono mensual'}</button>
        <button type="button" class="btn-primary" id="salaryPaidToggle" data-payment-action="salary" style="width:auto;padding:9px 18px">${person.salaryPaid?'Marcar sueldo pendiente':'Marcar sueldo pagado'}</button>`}
        ${person.closedSnapshot || hideBonusRowsForManagerViewer || visibleCommissionsPay<=0?'':`<button type="button" class="btn-primary" id="commissionPaidToggle" data-payment-action="commissions" style="width:auto;padding:9px 18px" ${person.salaryPaid?'':'disabled'}>${person.commissionsPaid?'Marcar comisiones pendientes':'Marcar comisiones pagadas'}</button>`}
        <button class="btn-cancel" id="salaryDetailClose">Cerrar</button>
      </div>
    </div>
  </div>`;
}

function bindSalaryDetailModal(){
  const close=()=>{ state.salaryDetailId=null; state.fxSalaryFull=false; render(); };
  const overlay=document.getElementById('salaryDetailOverlay');
  const btn=document.getElementById('salaryDetailClose');
  const bonusBtn=document.getElementById('salaryBonusToggle');
  const extraBonusBtn=document.getElementById('salaryExtraBonusEdit');
  const paidBtn=document.getElementById('salaryPaidToggle');
  const commissionPaidBtn=document.getElementById('commissionPaidToggle');
  if(overlay) overlay.onclick=e=>{ if(e.target===overlay) close(); };
  if(btn) btn.onclick=close;
  if(extraBonusBtn) extraBonusBtn.onclick=async()=>{
    const person=getSalaryPersonById(state.salaryDetailId);
    if(!person) return;
    const manualBonuses=Object.entries(EXTRA_BONUS_CONFIG).filter(([,config])=>config.manual && extraBonusAppliesToPerson(config, person, person.payrollRole||'Sin definir'));
    if(!manualBonuses.length){
      await appAlert('Este cargo no tiene bonos manuales configurables.', 'Bonos');
      return;
    }
    const overlay=document.createElement('div');
    overlay.className='dialog-overlay';
    overlay.innerHTML=`<div class="dialog-card bonus-editor-card" role="dialog" aria-modal="true">
      <div class="dialog-kicker">Altoque Peru WK</div>
      <div class="dialog-title">Editar bonos</div>
      <div class="dialog-message">Configura cuantas veces aplica cada bono para ${person.personName}.</div>
      <div class="bonus-editor-list">
        ${manualBonuses.map(([key,config])=>{
          const current=Object.prototype.hasOwnProperty.call(person.extraBonuses || {}, key)
            ? (person.extraBonuses?.[key]===true ? 1 : Number(person.extraBonuses?.[key] || 0))
            : Number(config.defaultQuantity || 0);
          return `<label class="bonus-editor-row">
            <span><strong>${config.label}</strong><small>${money(extraBonusUnitAmount(config, person.payrollRole||'Sin definir'))} por unidad${config.max?` - m-ximo ${config.max}`:''}</small></span>
            <input class="form-input" data-bonus-edit-key="${key}" type="number" min="0" max="${config.max||99}" step="1" value="${Number.isFinite(current)?current:0}"/>
          </label>`;
        }).join('')}
      </div>
      <div class="dialog-actions">
        <button class="dialog-btn" id="bonusEditCancel">Cancelar</button>
        <button class="dialog-btn primary" id="bonusEditSave">Guardar bonos</button>
      </div>
    </div>`;
    document.body.appendChild(overlay);
    const cleanup=()=>overlay.remove();
    overlay.querySelector('#bonusEditCancel').onclick=cleanup;
    overlay.onclick=e=>{ if(e.target===overlay) cleanup(); };
    overlay.querySelector('#bonusEditSave').onclick=async()=>{
      const extraBonuses={...(person.extraBonuses || {})};
      overlay.querySelectorAll('[data-bonus-edit-key]').forEach(input=>{
        const key=input.dataset.bonusEditKey;
        const config=EXTRA_BONUS_CONFIG[key];
        const value=Math.max(0, Math.min(Number(config?.max || 99), Number(input.value || 0)));
        extraBonuses[key]=Number.isFinite(value) ? value : 0;
      });
      try{
        const payrollProfile=(ATTENDANCE?.people||[]).find(item=>String(item.personId)===String(person.personId))||person;
        setAttendancePayload(await apiFetch('/api/attendance', {
          method:'POST',
          body:JSON.stringify({
            action:'profile',
            personId:person.personId,
            payrollRole:payrollProfile.payrollRole || 'Sin definir',
            monthlySalary:Number(payrollProfile.configuredSalary ?? payrollProfile.monthlySalary ?? 0),
            penaltyPerMinute:getPenaltyPerMinute(person),
            bonusAmount:getBonusAmount(person),
            extraBonuses,
            employmentType:payrollProfile.employmentType || 'FULL_TIME',
            partTimeMode:payrollProfile.employmentType==='PART_TIME' ? (payrollProfile.partTimeMode || 'MORNING') : null
          }),
          busyMessage:'Guardando bonos...'
        }));
        cleanup();
        render();
      }catch(error){
        await appAlert(error.message || 'No se pudieron guardar los bonos.', 'Error');
      }
    };
  };
  if(bonusBtn) bonusBtn.onclick=async()=>{
    const person=getSalaryPersonById(state.salaryDetailId);
    if(!person) return;
    let reason=null;
    const disable=!person.bonusDisabled;
    if(disable){
      reason=await appPrompt('Motivo para quitar el bono mensual:', { title:'Quitar bono', defaultValue:person.bonusBlockedReason||'Indisciplina', confirmText:'Quitar bono', danger:true });
      if(reason===null) return;
    }
    try{
      setAttendancePayload(await apiFetch('/api/attendance', {
        method:'POST',
        body:JSON.stringify({ action:'bonus', personId:person.personId, bonusDisabled:disable, bonusDisabledReason:reason }),
        busyMessage:disable?'Quitando bono...':'Restaurando bono...'
      }));
      render();
    }catch(error){
      await appAlert(error.message || 'No se pudo actualizar el bono.', 'Error');
    }
  };
  if(paidBtn) paidBtn.onclick=async(event)=>{
    event.preventDefault();
    event.stopPropagation();
    if(paidBtn.dataset.paymentAction!=='salary') return;
    const person=getSalaryPersonById(state.salaryDetailId);
    if(!person) return;
    paidBtn.disabled=true;
    if(commissionPaidBtn) commissionPaidBtn.disabled=true;
    try{
      setAttendancePayload(await apiFetch('/api/attendance', {
        method:'POST',
        body:JSON.stringify({ action:'mark-paid', personId:person.personId, salaryPaidMonth:person.salaryMonthKey, paid:!person.salaryPaid }),
        busyMessage:person.salaryPaid?'Marcando sueldo pendiente...':'Marcando sueldo pagado...'
      }));
      render();
    }catch(error){
      paidBtn.disabled=false;
      if(commissionPaidBtn) commissionPaidBtn.disabled=!person.salaryPaid;
      await appAlert(error.message || 'No se pudo actualizar el pago.', 'Error');
    }
  };
  if(commissionPaidBtn) commissionPaidBtn.onclick=async(event)=>{
    event.preventDefault();
    event.stopPropagation();
    if(commissionPaidBtn.dataset.paymentAction!=='commissions') return;
    const person=getSalaryPersonById(state.salaryDetailId);
    if(!person) return;
    if(!person.salaryPaid){
      await appAlert('Primero marca el sueldo como pagado. Despues podras marcar comisiones.', 'Pago pendiente');
      return;
    }
    try{
      setAttendancePayload(await apiFetch('/api/attendance', {
        method:'POST',
        body:JSON.stringify({ action:'mark-commissions-paid', personId:person.personId, commissionPaidMonth:person.salaryMonthKey, paid:!person.commissionsPaid }),
        busyMessage:person.commissionsPaid?'Marcando comisiones pendientes...':'Marcando comisiones pagadas...'
      }));
      render();
    }catch(error){
      await appAlert(error.message || 'No se pudo actualizar el pago de comisiones.', 'Error');
    }
  };
}

function renderAttendanceEditModal(){
  const item=state.attendanceEdit;
  if(!item) return '';
  const managerRequest=isManager()&&!isAdmin();
  return `<div class="modal-overlay" id="aoverlay">
    <div class="modal">
      <h3>${managerRequest?'Solicitar cambio de asistencia':'Editar asistencia'}</h3>
      <div class="form-grid">
        <div class="form-group full"><label class="form-label">Atencion al cliente</label><input class="form-input" value="${item.personName}" disabled/></div>
        <div class="form-group"><label class="form-label">Fecha</label><input class="form-input" value="${fmt(item.date)}" disabled/></div>
        <div class="form-group"><label class="form-label">DNI</label><input class="form-input" value="${item.personId}" disabled/></div>
        <div class="form-group"><label class="form-label">Entrada</label><input class="form-input" id="attendanceEntryEdit" placeholder="HH:MM" value="${item.justifiedDay?'00:00':(item.entryTime ? String(item.entryTime).slice(0,5) : '')}" ${item.justifiedDay?'disabled':''}/></div>
        <div class="form-group"><label class="form-label">Salida</label><input class="form-input" id="attendanceExitEdit" placeholder="HH:MM" value="${item.justifiedDay?'00:00':(item.exitTime ? String(item.exitTime).slice(0,5) : '')}" ${item.justifiedDay?'disabled':''}/></div>
        <div class="form-group"><label class="form-label">Ingreso justificado</label><select class="form-select" id="attendanceEntryJustified" ${item.justifiedDay?'disabled':''}><option value="0"${(!item.justifiedEntry||item.justifiedDay)?' selected':''}>No</option><option value="1"${item.justifiedEntry&&!item.justifiedDay?' selected':''}>S-</option></select></div>
        <div class="form-group"><label class="form-label">Salida justificada</label><select class="form-select" id="attendanceExitJustified" ${item.justifiedDay?'disabled':''}><option value="0"${(!item.justifiedExit||item.justifiedDay)?' selected':''}>No</option><option value="1"${item.justifiedExit&&!item.justifiedDay?' selected':''}>S-</option></select></div>
        <div class="form-group full"><label class="form-label">Dia justificado</label><select class="form-select" id="attendanceDayJustified"><option value="0"${item.justifiedDay?'':' selected'}>No</option><option value="1"${item.justifiedDay?' selected':''}>S-</option></select></div>
        <div class="form-group full"><label class="form-label">Falta (día sin pago)</label><select class="form-select" id="attendanceDayAbsent"><option value="0"${item.absence?'':' selected'}>No</option><option value="1"${item.absence?' selected':''}>Sí — mostrar sin marcaje</option></select><small style="color:var(--text3)">No contará como día trabajado ni pagado. Se conservan los marcajes originales.</small></div>
        ${managerRequest?'<div class="form-group full"><label class="form-label">Motivo del cambio</label><textarea class="form-input" id="attendanceChangeReason" rows="3" placeholder="Explica por que se debe corregir esta asistencia"></textarea></div>':''}
      </div>
      <div class="modal-actions">
        <button class="btn-cancel" id="attendanceEditClose">Cancelar</button>
        <button class="btn-primary" id="attendanceEditSave" style="width:auto;padding:9px 20px">${managerRequest?'Enviar solicitud':'Guardar'}</button>
      </div>
    </div>
  </div>`;
}

function renderRatingEditModal(){
  const item=state.ratingEdit;
  if(!item) return '';
  return `<div class="modal-overlay" id="ratingEditOverlay">
    <div class="modal">
      <h3>Editar calificacion</h3>
      <div class="form-grid">
        <div class="form-group"><label class="form-label">Fecha</label><input class="form-input" value="${fmtDateTime(item.date || item.rawDate)}" disabled/></div>
        <div class="form-group"><label class="form-label">Estrellas</label><input class="form-input" value="${item.rating}" disabled/></div>
        <div class="form-group full"><label class="form-label">Nombre / Asesor</label><input class="form-input" id="ratingEditAdvisor" value="${esc(item.advisor || item.matchedUserName || '')}"/></div>
        <div class="form-group"><label class="form-label">DNI</label><input class="form-input" id="ratingEditDni" inputmode="numeric" value="${esc(item.dni || '')}"/></div>
        <div class="form-group"><label class="form-label">Sede</label><input class="form-input" value="${esc(item.sede || '-')}" disabled/></div>
        <div class="form-group full"><label class="form-label">Comentario</label><textarea class="form-input" id="ratingEditComment" rows="4">${esc(item.comment || '')}</textarea></div>
      </div>
      <div class="modal-actions">
        <button class="btn-cancel" id="ratingEditClose">Cancelar</button>
        <button class="btn-primary" id="ratingEditSave" style="width:auto;padding:9px 20px">Guardar</button>
      </div>
    </div>
  </div>`;
}

function dayChip(r){
  if(r.tipo==='operacion' && r.fechaOperacion) return `<span class="days-chip done">Opero en ${fmt(r.fechaOperacion)}</span>`;
  const d=recordAge(r);
  if(d>EXPIRE_DAY) return `<span class="days-chip expired">? Expirado (${d}d)</span>`;
  if(d>=WARN_DAY) return `<span class="days-chip danger">Dia ${d}</span>`;
  return `<span class="days-chip ok">Dia ${d}</span>`;
}

function renderTodos(){
  const visibleMonth=activeMonthKey(state.recordsMonth);
  const archivedRecords=visibleArchivedRecordsForMonth(visibleMonth);
  const visibleRecords=archivedRecords.length ? archivedRecords : getVisibleRecords();
  const dups=getDups(visibleRecords);
  let rr=visibleRecords.filter(record=>recordAccountingMonthKey(record)===visibleMonth);
  if(state.ft){ const q=state.ft.toLowerCase(); rr=rr.filter(r=>r.dni.includes(q)||(r.cliente||'').toLowerCase().includes(q)||getItemOwner(r).name.toLowerCase().includes(q)); }
  if(state.fUser) rr=rr.filter(r=>r.userId==state.fUser);
  if(state.fSede) rr=rr.filter(r=>getItemSede(r)===state.fSede);
  if(state.fTipo) rr=rr.filter(r=>r.tipo===state.fTipo);
  if(state.fApproval) rr=rr.filter(r=>state.fApproval==='pending'?isPendingApproval(r):state.fApproval==='validated'?!!r.validatedAt:state.fApproval==='rejected'?!!r.rejectedAt:true);
  if(state.fDesde) rr=rr.filter(r=>r.fecha>=state.fDesde);
  if(state.fHasta) rr=rr.filter(r=>r.fecha<=state.fHasta);
  rr.sort((a,b)=>b.fecha.localeCompare(a.fecha));
  const page=paginateRows('recordsAll', rr);

  let h=`<div class="page-header"><div class="page-title">${isEmployee()?'Mis Registros con Alertas':'Todos los Registros'}</div><div class="page-sub">${isAdmin()?'Vista global':isManager()?'Registros visibles de tu sede':'Tus registros con alertas, duplicados y seguimiento automatico'}</div></div>
  <div class="table-wrap">
    <div class="table-header">
      <div class="table-title">Registros (${rr.length})</div>
      <input class="search-input" id="ft" placeholder="DNI o nombre..." value="${state.ft}" style="width:170px"/>
      ${(isAdmin()||isManager())?`<select class="filter-select" id="fu"><option value="">${isAdmin()?'Todo el equipo':'Toda tu sede'}</option>${getVisibleUsers().filter(u=>u.role!=='admin'&&u.id!==state.currentUser.id).map(u=>`<option value="${u.id}"${state.fUser==u.id?' selected':''}>${u.name}</option>`).join('')}</select>`:''}
      ${(isAdmin()||canPreviewAllSedesAsManager())?`<select class="filter-select" id="fs"><option value="">Todas las sedes</option>${SEDES.map(s=>`<option value="${s}"${state.fSede===s?' selected':''}>${s}</option>`).join('')}</select>`:''}
      ${monthFilterSelectHtml('recordsMonth', visibleMonth, { includeEmpty:false, count:24, extraValues: MONTHLY_CLOSURES.map(item=>item.month) })}
      <select class="filter-select" id="ftp"><option value="">Todos los tipos</option><option value="registro"${state.fTipo==='registro'?' selected':''}>Registro</option><option value="operacion"${state.fTipo==='operacion'?' selected':''}>Operacion</option></select>
      ${(isAdmin()||isManager())?`<select class="filter-select" id="fap"><option value="">Toda aprobacion</option><option value="pending"${state.fApproval==='pending'?' selected':''}>Pendientes</option><option value="validated"${state.fApproval==='validated'?' selected':''}>Validados</option><option value="rejected"${state.fApproval==='rejected'?' selected':''}>Rechazados</option></select>`:''}
      <input class="search-input" id="fd" type="date" value="${state.fDesde}" style="width:135px" title="Desde"/>
      <input class="search-input" id="fh" type="date" value="${state.fHasta}" style="width:135px" title="Hasta"/>
    </div>
    <table><thead><tr><th>Cliente</th><th>DNI</th>${!isEmployee()?'<th>Atencion al cliente</th>':''}<th>Tipo</th><th>Modalidad</th><th>Fecha</th><th>Estado</th><th>Aprobacion</th><th>Plataforma</th>${!isEmployee()?'<th>Subido</th>':''}<th>Notas</th><th></th></tr></thead><tbody>`;
  page.rows.forEach(r=>{
    const dup=dups.has(r.id);
    const u=getItemOwner(r);
    const d=recordAge(r);
    const isAlert=r.tipo==='registro'&&d===WARN_DAY;
    const row=dup?'dup-row':isAlert?'alert-row':'';
    const validation=validationText(r);
    h+=`<tr class="${row}">
      <td>${r.cliente||'-'}</td>
      <td><span style="font-family:var(--font2);font-weight:600">${r.dni}</span>${dup?' <span class="badge dup">DUP</span>':''}${dupDetailsHtml(r)}</td>
      ${!isEmployee()?`<td><div style="display:flex;align-items:center;gap:6px">${avatar(u,24,9)}${u.name}</div></td>`:''}
      <td><span class="badge ${r.tipo}">${r.tipo==='registro'?'Registro':'Operacion'}</span></td>
      <td><span class="badge ${r.modalidad==='presencial'?'drive':'web'}">${r.modalidad==='presencial'?'Presencial':'Virtual'}</span></td>
      <td>${fmt(r.fecha)}</td>
      <td>${dayChip(r)}</td>
      <td><span class="days-chip ${validation.cls}">${validation.label}</span></td>
      <td><span class="badge ${r.plataforma}">${r.plataforma==='drive'?'Drive':'Web'}</span></td>
      ${!isEmployee()?`<td>${fmtDateTime(r.createdAt)}</td>`:''}
      <td style="color:var(--text2);max-width:110px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${r.rejectedAt&&r.rejectionReason?r.rejectionReason:(r.notas||'-')}</td>
      <td><button class="action-btn" data-edit="${r.id}">${canEditRecordFields(r)?'Editar':'Ver'}</button></td>
    </tr>`;
  });
  if(!rr.length) h+=`<tr><td colspan="${isEmployee()?'10':'12'}"><div class="empty-state"><div class="es-icon">-</div><p>Sin resultados con estos filtros</p></div></td></tr>`;
  h+=`</tbody></table>${renderPagination(page)}</div>`;
  return h;
}

function renderAlertas(){
  const visibleMonth=activeMonthKey(state.recordsMonth);
  const archivedRecords=visibleArchivedRecordsForMonth(visibleMonth);
  const sourceRecords=archivedRecords.length ? archivedRecords : (isEmployee()?RECORDS.filter(r=>r.userId===state.currentUser.id):getVisibleRecords());
  const base=sourceRecords
    .filter(record=>recordAccountingMonthKey(record)===visibleMonth);
  const dups=getDups(base);
  const warns=base.filter(r=>r.tipo==='registro'&&daysSince(r.fecha)===WARN_DAY);
  const expired=base.filter(r=>r.tipo==='registro'&&daysSince(r.fecha)>EXPIRE_DAY);
  const dupGroups=duplicateGroups(base.filter(record=>!record.rejectedAt), { includeRejected:false, includeMarked:true });
  const dupRecs=base.filter(r=>dups.has(r.id));
  const pendingRecords=base.filter(record=>isPendingApproval(record)).length;
  const pendingReferrals=REFERRALS.filter(item=>!item.validatedAt&&!item.rejectedAt&&monthKeyFromDate(item.createdAt)===visibleMonth).length;
  const pendingWrongCards=WRONG_CARDS.filter(item=>item.status==='PENDING'&&monthKeyFromDate(item.detectedDate||item.createdAt)===visibleMonth).length;
  const pendingCalls=CALL_REPORTS.filter(item=>item.status==='PENDING'&&monthKeyFromDate(item.createdAt)===visibleMonth).length;
  const pendingPenalties=PENALTY_REPORTS.filter(item=>item.status==='PENDING'&&monthKeyFromDate(item.createdAt)===visibleMonth).length;
  const t=state.alertTab;
  const show=t==='expired'?expired:t==='dups'?dupRecs:warns;

  let h=`<div class="page-header"><div class="page-title">Centro de Alertas</div><div class="page-sub">${isEmployee()?'Tus clientes que requieren atencion inmediata':'Clientes visibles que requieren atencion inmediata'} - ${monthLabelFromKey(visibleMonth)}</div></div>
  <div class="table-wrap" style="margin-bottom:1rem"><div class="table-header"><div class="table-title">Mes visible</div>${monthFilterSelectHtml('recordsMonth', visibleMonth, { includeEmpty:false, count:24, extraValues: MONTHLY_CLOSURES.map(item=>item.month) })}</div></div>`;
  const approvalAlerts=[
    { label:'Registros pendientes', value:pendingRecords, view:'todos' },
    { label:'Referidos pendientes', value:pendingReferrals, view:'referidos' },
    { label:'Tarjetas pendientes', value:pendingWrongCards, view:'tarjetas' },
    { label:'Llamadas pendientes', value:pendingCalls, view:'llamadas' },
    { label:'Penalidades pendientes', value:pendingPenalties, view:'penalidades' }
  ].filter(item=>item.value>0);
  if(approvalAlerts.length) h+=`<div class="stat-grid" style="margin-bottom:1rem">${approvalAlerts.map(item=>`<button class="stat-card" type="button" data-nav="${item.view}" style="text-align:left;cursor:pointer"><div class="stat-label">${item.label}</div><div class="stat-value amber">${item.value}</div><div class="stat-sub">Presiona para revisar</div></button>`).join('')}</div>`;
  if(warns.length>0) h+=`<div class="alert-banner"><div class="ab-icon">!</div><div class="ab-text"><strong>Urgente! ${warns.length} cliente(s) en dia 6</strong> - manana vence el plazo de 7 dias.${isEmployee()?' Actualiza si ya hicieron la operacion.':' Revisa con el usuario correspondiente.'}</div></div>`;
  h+=`<div class="tabs">
    <div class="tab${t==='warn'?' active':''}" data-atab="warn">? Dia 6 (${warns.length})</div>
    <div class="tab${t==='expired'?' active':''}" data-atab="expired">? Expirados (${expired.length})</div>
    <div class="tab${t==='dups'?' active':''}" data-atab="dups">Duplicados (${dupGroups.length})</div>
  </div>`;
  if(t==='dups'){
    h+=`<div class="duplicate-board">`;
    dupGroups.forEach(group=>{
      const rejectedHistory=base.filter(item=>String(item.dni || '').trim()===group.dni && item.rejectedAt);
      h+=`<section class="duplicate-card">
        <div class="duplicate-card-head">
          <div>
            <div class="duplicate-dni">DNI ${esc(group.dni)}</div>
            <div class="duplicate-sub">${group.records.length} registro(s) visible(s) con riesgo de duplicado${rejectedHistory.length?` - ${rejectedHistory.length} ya rechazado(s)`:''}</div>
          </div>
          <span class="days-chip danger">Resolver antes de validar</span>
        </div>
        <div class="table-wrap duplicate-table"><table><thead><tr><th>Cliente</th>${!isEmployee()?'<th>Colaborador</th><th>Sede</th>':''}<th>Registro</th><th>Operacion</th><th>Tipo</th><th>Estado</th><th>Accion</th></tr></thead><tbody>`;
      group.records.forEach(r=>{
        const u=getItemOwner(r);
        h+=`<tr>
          <td><strong>${esc(r.cliente || '-')}</strong><div class="duplicate-muted">#${r.id} - Subido ${fmtDateTime(r.createdAt)}</div>${dupDetailsHtml(r)}</td>
          ${!isEmployee()?`<td><div style="display:flex;align-items:center;gap:6px">${avatar(u,24,9)}${esc(u.name || '-')}</div></td><td>${esc(getItemSede(r) || '-')}</td>`:''}
          <td>${fmt(r.fecha)}</td>
          <td>${r.fechaOperacion ? fmt(r.fechaOperacion) : '-'}</td>
          <td><span class="badge ${r.tipo}">${r.tipo==='registro'?'Registro':'Operacion'}</span></td>
          <td>${duplicateStatusChip(r)}</td>
          <td><div class="duplicate-actions">
            ${canValidateOrReject(r)?`<button class="btn-sm" data-dup-keep="${r.id}">Mantener este</button><button class="btn-sm danger" data-dup-reject="${r.id}">Rechazar duplicado</button>`:''}
            <button class="btn-sm outline" data-edit="${r.id}">Ver</button>
          </div></td>
        </tr>`;
      });
      h+=`</tbody></table></div>`;
      if(rejectedHistory.length){
        h+=`<details class="duplicate-history"><summary>Ver rechazados del mismo DNI</summary>${rejectedHistory.map(r=>`<div>${fmt(r.fecha)} - ${esc(r.cliente || '-')} - ${esc(getItemOwner(r).name || '-')} - ${esc(r.rejectionReason || 'Rechazado')}</div>`).join('')}</details>`;
      }
      h+=`</section>`;
    });
    if(!dupGroups.length) h+=`<div class="table-wrap"><div class="empty-state"><div class="es-icon">OK</div><p>No hay DNIs duplicados activos en ${monthLabelFromKey(visibleMonth)}.</p></div></div>`;
    h+=`</div>`;
    return h;
  }
  h+=`<div class="table-wrap"><table><thead><tr><th>Cliente</th><th>DNI</th>${!isEmployee()?'<th>Atencion al cliente</th>':''}<th>Fecha Registro</th><th>Dias</th><th>Modalidad</th><th>Plataforma</th></tr></thead><tbody>`;
  show.forEach(r=>{
    const u=getItemOwner(r);
    const d=daysSince(r.fecha);
    h+=`<tr><td>${r.cliente||'-'}</td><td><span style="font-family:var(--font2);font-weight:600">${r.dni}</span>${t==='dups'?dupDetailsHtml(r):''}</td>
      ${!isEmployee()?`<td><div style="display:flex;align-items:center;gap:6px">${avatar(u,24,9)}${u.name}</div></td>`:''}
      <td>${fmt(r.fecha)}</td>
      <td><span class="days-chip ${d>7?'expired':'danger'}">Dia ${d}</span></td>
      <td><span class="badge ${r.modalidad==='presencial'?'drive':'web'}">${r.modalidad==='presencial'?'Presencial':'Virtual'}</span></td>
      <td><span class="badge ${r.plataforma}">${r.plataforma==='drive'?'Drive':'Web'}</span></td></tr>`;
  });
  if(!show.length) h+=`<tr><td colspan="${isEmployee()?'6':'7'}"><div class="empty-state"><div class="es-icon">-</div><p>Sin alertas en esta categoria!</p></div></td></tr>`;
  h+='</tbody></table></div>';
  return h;
}

function renderArchivoMensual(){
  let h=`<div class="page-header"><div class="page-title">Archivo mensual</div><div class="page-sub">Sube un JSON archivado del cierre para revisar ese mes fuera del flujo diario.</div></div>`;
  if(!isAdmin()) return h + `<div class="alert-banner"><div class="ab-icon">!</div><div class="ab-text">Solo el admin puede ver archivos mensuales.</div></div>`;
  const archive=state.archiveViewer;
  h+=`<div class="form-card" style="margin-bottom:1.25rem">
    <div class="form-grid">
      <div class="form-group full">
        <label class="form-label">JSON archivado del mes</label>
        <div style="display:flex;gap:.75rem;flex-wrap:wrap;align-items:center">
          <input type="file" id="archiveJsonInput" accept=".json,application/json" />
          ${archive?`<button class="btn-sm" id="clearArchiveViewer">Limpiar visor</button>`:''}
        </div>
      </div>
    </div>
    <div style="margin-top:10px;color:var(--text2);font-size:12px">Formato esperado: archivo generado desde <strong>Archivar y limpiar mes</strong>.</div>
  </div>`;
  if(!archive){
    h+=`<div class="table-wrap"><div class="empty-state"><div class="es-icon">-</div><p>Sube un JSON archivado para visualizar el mes.</p></div></div>`;
    return h;
  }
  const closure=archive.closure || {};
  const summary=closure.summary || {};
  const details=Array.isArray(closure.details) ? closure.details : [];
  const modules=archive.modules || {};
  const attendancePeople=Array.isArray(modules.attendance?.people) ? modules.attendance.people.length : 0;
  const attendanceDays=Array.isArray(modules.attendance?.people)
    ? modules.attendance.people.reduce((sum, person)=>sum + Number((person.days || []).length || 0), 0)
    : 0;
  const moduleCounts=[
    ['Registros', Array.isArray(modules.records) ? modules.records.length : 0],
    ['Referidos', Array.isArray(modules.referrals) ? modules.referrals.length : 0],
    ['Llamadas', Array.isArray(modules.callReports) ? modules.callReports.length : 0],
    ['Tarjetas erroneas', Array.isArray(modules.wrongCards) ? modules.wrongCards.length : 0],
    ['Safetypay', Array.isArray(modules.safetypayCodes) ? modules.safetypayCodes.length : 0],
    ['Penalidades', Array.isArray(modules.penaltyReports) ? modules.penaltyReports.length : 0],
    ['Calificaciones', Array.isArray(modules.ratingApprovals) ? modules.ratingApprovals.length : 0],
    ['Asistencia', attendanceDays]
  ];
  h+=`<div class="alert-banner"><div class="ab-icon">!</div><div class="ab-text"><strong>Mes archivado:</strong> ${summary.monthLabel || monthLabelFromKey(archive.month || '')} - <strong>Exportado:</strong> ${fmtDateTime(archive.exportedAt)}${closure.closedBy?.name?` - <strong>Cerrado por:</strong> ${closure.closedBy.name}`:''}</div></div>`;
  h+=`<div class="stat-grid">
    <div class="stat-card"><div class="stat-label">Sueldos</div><div class="stat-value green">${money(summary.salaryTotal || 0)}</div><div class="stat-sub">${summary.collaborators || details.length || 0} colaborador(es)</div></div>
    <div class="stat-card"><div class="stat-label">Comisiones</div><div class="stat-value green">${money(summary.commissionTotal || 0)}</div><div class="stat-sub">Registros validados</div></div>
    <div class="stat-card"><div class="stat-label">Referidos</div><div class="stat-value green">${money(summary.referralTotal || 0)}</div><div class="stat-sub">Monto archivado</div></div>
    <div class="stat-card"><div class="stat-label">Total general</div><div class="stat-value green">${money(summary.totalToPay || 0)}</div><div class="stat-sub">Foto final del mes</div></div>
  </div>`;
  h+=`<div class="table-wrap" style="margin-bottom:1rem"><div class="table-header"><div class="table-title">Conteo de modulos archivados</div></div>
    <table><thead><tr><th>Modulo</th><th>Elementos</th></tr></thead><tbody>
      ${moduleCounts.map(([label,count])=>`<tr><td>${label}</td><td style="font-weight:700;color:var(--text)">${count}</td></tr>`).join('')}
      <tr><td>Personas en asistencia</td><td style="font-weight:700;color:var(--text)">${attendancePeople}</td></tr>
    </tbody></table>
  </div>`;
  h+=`<div class="table-wrap"><div class="table-header"><div class="table-title">Detalle de pagos archivado</div></div>
    <table><thead><tr><th>Colaborador</th><th>Cargo</th><th>Sueldo</th><th>Bono</th><th>Descuentos</th><th>Comision</th><th>Referidos</th><th>Pagado</th></tr></thead><tbody>`;
  details.forEach(row=>{
    h+=`<tr>
      <td>${row.personName || '-'}</td>
      <td>${row.payrollRole || '-'}</td>
      <td style="color:var(--green);font-weight:700">${money(row.salary || 0)}</td>
      <td>${money(row.bonus || 0)}</td>
      <td style="color:${Number(row.discounts||0)>0?'var(--red)':'var(--text2)'};font-weight:700">${money(row.discounts || 0)}</td>
      <td>${money(row.commission || 0)}</td>
      <td>${money(row.referralCommission || 0)}</td>
      <td><span class="days-chip ${row.paid?'valid':'warn'}">${row.paid?'Pagado':'Pendiente'}</span></td>
    </tr>`;
  });
  if(!details.length) h+=`<tr><td colspan="8"><div class="empty-state"><div class="es-icon">-</div><p>Este archivo no trae detalle de pagos.</p></div></td></tr>`;
  h+=`</tbody></table></div>`;
  return h;
}

function renderRatingValiditySettings(){
  const requiredFields=RATING_SETTINGS.requiredFields || ['dni'];
  return `<section class="payout-card wide" id="ratingValiditySettings">
    <h3>Configuración de validez de calificaciones</h3>
    <p>Elige qué respuestas deben estar llenas para que una calificación de 4 o 5 estrellas pague ${money(getRatingCommission())}.</p>
    <div class="rating-config-grid">
      ${(RATING_SETTINGS.fieldOptions||[]).map(field=>`<label class="rating-check"><input type="checkbox" data-rating-required="${field.key}" ${requiredFields.includes(field.key)?'checked':''}/> <span>${field.label} obligatorio</span></label>`).join('')}
    </div>
    <button class="submit-btn" id="saveRatingSettingsBtn" style="max-width:260px">Guardar configuración</button>
  </section>`;
}


function limaTodayKey(){ return new Intl.DateTimeFormat('en-CA',{timeZone:'America/Lima',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date()); }
function isCalendarRest(day){ return !!day?.calendarException && day.calendarException.kind!=='SPECIAL_SHIFT'; }
function calendarForPerson(person,date){
  if(!ATTENDANCE?.workCalendar?.length) return null;
  const hire=hireDateForPerson(person);
  if(hire && date<hire) return null;
  return WorkCalendar.resolveWorkCalendar(ATTENDANCE?.workCalendar || [],person || {},date,getPersonSedeAt(person,date));
}
async function loadWorkCalendar(){
  if(WORK_CALENDAR_LOADING) return;
  const scope=getSessionScopeKey(); WORK_CALENDAR_LOADING=true; WORK_CALENDAR_ERROR='';
  try{ const payload=await apiFetch('/api/settings/work-calendar',{silent:true}); if(scope===getSessionScopeKey()) WORK_CALENDAR=payload.rules || []; }
  catch(error){ if(scope===getSessionScopeKey()) WORK_CALENDAR_ERROR=error.message || 'No se pudo cargar el calendario.'; }
  finally{ WORK_CALENDAR_LOADING=false; if(scope===getSessionScopeKey() && state.view==='admin' && state.adminTab==='calendar') render(); }
}
function captureWorkCalendarDraft(){
  const d=WORK_CALENDAR_DRAFT;
  ['date','reason','scope','sede','kind','entry','exit','breakMinutes','additionalPercent'].forEach(key=>{const field=document.getElementById('calendar-'+key);if(field)d[key]=['breakMinutes','additionalPercent'].includes(key)?Number(field.value):field.value;});
  if(document.getElementById('calendar-people')) d.personIds=[...document.querySelectorAll('[data-calendar-person]:checked')].map(field=>field.value);
  return d;
}
function renderWorkCalendar(){
  if(WORK_CALENDAR===null && !WORK_CALENDAR_LOADING && !WORK_CALENDAR_ERROR) setTimeout(loadWorkCalendar,0);
  const d=WORK_CALENDAR_DRAFT;
  const people=(ATTENDANCE?.people || []).filter(person=>!isInactiveCollaborator(person)).sort((a,b)=>a.personName.localeCompare(b.personName));
  const labels={PAID_REST:'Descanso pagado',UNPAID_REST:'Descanso sin pago',SPECIAL_SHIFT:'Jornada especial'};
  const selected=(value,current)=>value===current?' selected':'';
  const affected=d.date?people.filter(person=>WorkCalendar.resolveWorkCalendar([{...d,id:d.id || 'draft'}],person,d.date,getPersonSedeAt(person,d.date))):[];
  return `<div class="payout-settings-board work-calendar-board">
    <section class="payout-card wide"><h3>Calendario laboral</h3><p>Registra aniversarios, cierres y horarios excepcionales sin cambiar los turnos habituales. No modifica los marcajes originales. Una excepción individual tiene prioridad sobre la sede y la sede sobre toda la empresa.</p>
      <p>Los descansos no generan faltas ni tardanzas. El descanso pagado conserva el pago del día y la puntualidad. Los meses cerrados deben reabrirse antes de hacer cambios.</p>
    </section>
    <section class="payout-card wide"><h3>${d.id?'Editar excepción':'Nueva excepción'}</h3>
      <div class="form-grid">
        <label class="form-group"><span class="form-label">Fecha *</span><input class="form-input" id="calendar-date" type="date" value="${esc(d.date)}"/></label>
        <label class="form-group"><span class="form-label">Motivo *</span><input class="form-input" id="calendar-reason" maxlength="200" placeholder="Ej. Aniversario de la empresa" value="${esc(d.reason)}"/></label>
        <label class="form-group"><span class="form-label">Aplica a</span><select class="form-select" id="calendar-scope"><option value="ALL"${selected('ALL',d.scope)}>Toda la empresa</option><option value="SEDE"${selected('SEDE',d.scope)}>Una sede</option><option value="PEOPLE"${selected('PEOPLE',d.scope)}>Colaboradores específicos</option></select></label>
        <label class="form-group"><span class="form-label">Tratamiento</span><select class="form-select" id="calendar-kind">${Object.entries(labels).map(([value,label])=>`<option value="${value}"${selected(value,d.kind)}>${label}</option>`).join('')}</select></label>
        ${d.scope==='SEDE'?`<label class="form-group"><span class="form-label">Sede *</span><select class="form-select" id="calendar-sede"><option value="">Seleccionar sede</option>${SEDES.map(sede=>`<option${selected(sede,d.sede)}>${esc(sede)}</option>`).join('')}</select></label>`:''}
        ${d.kind==='SPECIAL_SHIFT'?`<label class="form-group"><span class="form-label">Entrada *</span><input class="form-input" id="calendar-entry" type="time" value="${esc(d.entry)}"/></label><label class="form-group"><span class="form-label">Salida *</span><input class="form-input" id="calendar-exit" type="time" value="${esc(d.exit)}"/></label><label class="form-group"><span class="form-label">Refrigerio (minutos)</span><input class="form-input" id="calendar-breakMinutes" type="number" min="0" max="240" step="1" value="${d.breakMinutes}"/></label>`:
          `<label class="form-group"><span class="form-label">Adicional si trabaja (% de su valor por hora)</span><input class="form-input" id="calendar-additionalPercent" type="number" min="0" max="300" step="1" value="${d.additionalPercent}"/></label>`}
      </div>
      ${d.scope==='PEOPLE'?`<div id="calendar-people" style="max-height:230px;overflow:auto;display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:12px;margin:16px 0">${people.map(person=>`<label style="display:flex;gap:8px;align-items:center"><input type="checkbox" data-calendar-person value="${esc(person.personId)}"${d.personIds.includes(person.personId)?' checked':''}/><span>${esc(person.personName)} · ${esc(getPersonSede(person))}</span></label>`).join('') || '<p>Cargando colaboradores...</p>'}</div>`:''}
      <p>${d.kind==='SPECIAL_SHIFT'?'La jornada completa conserva el pago diario; las tardanzas se calculan con este horario.':'El adicional se calcula únicamente con entrada y salida reales o corregidas, sin inventar marcajes. Usa 0 % si no corresponde adicional.'}</p>
      <p>${d.date?`Alcance seleccionado: ${affected.length} colaborador(es).`:'Selecciona la fecha para revisar el alcance.'}</p>
      <div style="display:flex;gap:12px;flex-wrap:wrap"><button class="submit-btn" id="calendar-save" style="max-width:250px"${WORK_CALENDAR===null?' disabled':''}>${d.id?'Guardar cambios':'Guardar excepción'}</button><button class="btn-sm" id="calendar-cancel">${d.id?'Cancelar edición':'Limpiar formulario'}</button></div>
    </section>
    <section class="payout-card wide"><div style="display:flex;justify-content:space-between;gap:12px"><h3>Excepciones registradas</h3><button class="btn-sm" id="calendar-refresh">Actualizar calendario</button></div>
      ${WORK_CALENDAR_ERROR?`<p style="color:var(--danger)">${esc(WORK_CALENDAR_ERROR)}</p>`:''}
      <div class="table-wrap"><table><thead><tr><th>Fecha</th><th>Motivo</th><th>Alcance</th><th>Tratamiento</th><th>Horario / adicional</th><th>Acciones</th></tr></thead><tbody>
        ${(WORK_CALENDAR || []).map(rule=>`<tr><td>${fmt(rule.date)}</td><td>${esc(rule.reason)}</td><td>${rule.scope==='ALL'?'Toda la empresa':rule.scope==='SEDE'?esc(rule.sede):esc(rule.personIds.map(id=>people.find(person=>person.personId===id)?.personName || id).join(', '))}</td><td>${labels[rule.kind]}</td><td>${rule.kind==='SPECIAL_SHIFT'?esc(rule.entry+' – '+rule.exit)+' · '+rule.breakMinutes+' min refrigerio':rule.additionalPercent+' % adicional por hora trabajada'}</td><td><button class="btn-sm" data-calendar-edit="${rule.id}">Editar</button><button class="btn-sm" data-calendar-remove="${rule.id}">Retirar</button></td></tr>`).join('') || `<tr><td colspan="6">${WORK_CALENDAR_LOADING?'Cargando calendario...':'No hay excepciones registradas.'}</td></tr>`}
      </tbody></table></div>
    </section>
  </div>`;
}
function bindWorkCalendar(){
  ['date','reason','scope','sede','kind','entry','exit','breakMinutes','additionalPercent'].forEach(key=>{const field=document.getElementById('calendar-'+key);if(field){if(['date','scope','sede','kind'].includes(key))field.onchange=()=>{captureWorkCalendarDraft();preserveMainScroll(()=>render());};else field.oninput=()=>captureWorkCalendarDraft();}});
  document.querySelectorAll('[data-calendar-person]').forEach(field=>{field.onchange=()=>{captureWorkCalendarDraft();render();};});
  const clear=document.getElementById('calendar-cancel');if(clear)clear.onclick=()=>{WORK_CALENDAR_DRAFT=newWorkCalendarDraft();render();};
  const refresh=document.getElementById('calendar-refresh');if(refresh)refresh.onclick=()=>{captureWorkCalendarDraft();loadWorkCalendar();};
  const save=document.getElementById('calendar-save');if(save)save.onclick=async()=>{
    const draft={...captureWorkCalendarDraft()};if(!draft.id)delete draft.id;
    if(!draft.date || draft.reason.trim().length<3){await appAlert('Completa la fecha y un motivo de al menos 3 caracteres.');return;}
    if(new Date(draft.date+'T12:00:00Z').getUTCDay()===0){await appAlert('El calendario actual trabaja de lunes a sábado. Elige un día laboral.');return;}
    if(!await appConfirm('Se recalcularán la asistencia y el pago de los colaboradores del alcance seleccionado para el '+fmt(draft.date)+'. ¿Guardar esta excepción?'))return;
    try{const payload=await apiFetch('/api/settings/work-calendar',{method:'POST',body:JSON.stringify(draft)});WORK_CALENDAR=payload.rules;WORK_CALENDAR_DRAFT=newWorkCalendarDraft();CHANGE_LOGS=null;await loadAttendance(true,true);render();await appAlert('Excepción guardada. Asistencia y sueldos actualizados.');}catch(error){await appAlert(error.message || 'No se pudo guardar la excepción.');}
  };
  document.querySelectorAll('[data-calendar-edit]').forEach(button=>{button.onclick=()=>{const rule=WORK_CALENDAR.find(rule=>rule.id===button.dataset.calendarEdit);if(rule){WORK_CALENDAR_DRAFT={...rule,personIds:[...rule.personIds]};render();}};});
  document.querySelectorAll('[data-calendar-remove]').forEach(button=>{button.onclick=async()=>{
    const rule=WORK_CALENDAR.find(rule=>rule.id===button.dataset.calendarRemove);if(!rule)return;
    if(!await appConfirm('¿Retirar '+rule.reason+' del '+fmt(rule.date)+'? Se volverá a calcular el día con el horario habitual.'))return;
    try{const payload=await apiFetch('/api/settings/work-calendar',{method:'DELETE',body:JSON.stringify({id:rule.id})});WORK_CALENDAR=payload.rules;if(WORK_CALENDAR_DRAFT.id===rule.id)WORK_CALENDAR_DRAFT=newWorkCalendarDraft();CHANGE_LOGS=null;await loadAttendance(true,true);render();}catch(error){await appAlert(error.message || 'No se pudo retirar la excepción.');}
  };});
}

function renderAdmin(){
  const visibleUsers=getVisibleUsers();
  if(isAdmin() && !['payout','calendar'].includes(state.adminTab)) state.adminTab='payout';
  let h=`<div class="page-header"><div class="page-title">${isAdmin()?'Administracion':'Mi Equipo'}</div><div class="page-sub">${isAdmin()?'Calendario laboral, parámetros de pagos, bonos y metas del sistema.':`Gestion de atencion al cliente de sede ${userSede(state.currentUser)}`}</div>${isManager()?'<button class="btn-sm" data-atab2="add">Crear atención al cliente</button>':''}</div>`;
  if(isAdmin()) h+=`<div style="margin-bottom:16px"><button class="btn-sm" id="downloadFullBackup">Descargar respaldo completo cifrado</button></div>`;
  if(isAdmin()) h+=`<div class="tabs work-calendar-tabs"><button class="tab${state.adminTab==='payout'?' active':''}" data-atab2="payout">Pagos y parámetros</button><button class="tab${state.adminTab==='calendar'?' active':''}" data-atab2="calendar">Calendario laboral</button></div>`;
  if(state.adminTab==='calendar' && isAdmin()){
    return h+renderWorkCalendar();
  }
  if(state.adminTab==='add'){
    h+=`<div class="form-card"><div class="form-grid">
      <div class="form-group"><label class="form-label">Nombre completo</label><input class="form-input" id="an" placeholder="Nombre Apellido"/></div>
      <div class="form-group"><label class="form-label">Usuario</label><input class="form-input" id="au" placeholder="usuario"/></div>
      <div class="form-group"><label class="form-label">Contrasena</label><input class="form-input" id="ap" type="password" placeholder="contrasena"/></div>
      <div class="form-group"><label class="form-label">Rol</label><select class="form-select" id="ar">${isAdmin()?'<option value="employee">Atencion al cliente</option><option value="manager">Jefe de sede</option><option value="admin">Admin General</option>':'<option value="employee">Atencion al cliente</option>'}</select></div>
      <div class="form-group"><label class="form-label">Sede</label><select class="form-select" id="as">${(isAdmin()?SEDES:[userSede(state.currentUser)]).map(s=>`<option value="${s}">${s}</option>`).join('')}</select></div>
    </div><button class="submit-btn" id="saveUserBtn">${isAdmin()?'Crear usuario':'Crear atencion al cliente'}</button></div>`;
  } else if(state.adminTab==='payout' && isAdmin()){
    const payout={...DEFAULT_PAYOUT_SETTINGS, ...(SETTINGS.payoutSettings || {})};
    const payoutInput=(key,label,step='0.01',suffix='S/')=>`<div class="payout-field"><label>${label}</label><div class="payout-input-wrap"><span>${suffix}</span><input class="form-input" data-payout-input="${key}" type="number" min="0" step="${step}" value="${Number(payout[key] ?? 0)}"/></div></div>`;
    const percentInput=(key,label)=>`<div class="payout-field"><label>${label}</label><div class="payout-input-wrap percent"><input class="form-input" data-payout-percent-input="${key}" type="number" min="0" max="100" step="0.01" value="${Number((payout[key] ?? 0) * 100).toFixed(2)}"/><span>%</span></div></div>`;
    const safetypayGoals=getSafetypaySedeGoals();
    h+=`<div class="payout-settings-board">
    ${renderRatingValiditySettings()}
    <section class="payout-card wide">
      <h3>Parametros generales de pago</h3>
      <p>Estos valores alimentan sueldos, reportes, comisiones y vistas del colaborador. Los meses cerrados mantienen su cierre congelado.</p>
      <div class="payout-grid">
        <div class="payout-field"><label>Registro valido</label><div class="payout-input-wrap"><span>S/</span><input class="form-input" id="commissionRate" type="number" min="0" step="0.01" value="${getCommissionRate().toFixed(2)}"/></div></div>
        ${payoutInput('callCommission','Llamada aprobada','0.01')}
        ${payoutInput('ratingCommission','Calificacion aprobada','0.01')}
        ${payoutInput('wrongCardBonus','Tarjeta erronea aprobada','0.01')}
      </div>
    </section>
    <section class="payout-card">
      <h3>Bonos de jefatura y SafetyPay</h3>
      <p>Montos automáticos para jefes y reparto cuando la sede llega a la meta.</p>
      <div class="payout-grid">
        ${payoutInput('managerRatingApprovalCommission','Jefe: aprobar calificacion','0.01')}
        ${payoutInput('managerRecordValidationCommission','Jefe: validar operacion','0.01')}
        ${payoutInput('managerPenaltyApprovalCommission','Jefe: penalidad aprobada','0.01')}
        ${percentInput('safetypaySharedThreshold','SafetyPay minimo compartido')}
        ${payoutInput('safetypaySharedBonusPool','Bolsa compartida','0.01')}
        ${payoutInput('safetypayManagerBonus','Bono jefe 100%','0.01')}
      </div>
    </section>
    <section class="payout-card wide">
      <h3>Metas SafetyPay por sede</h3>
      <p>Meta mensual usada para progreso, bono compartido y bono de jefe.</p>
      <div class="payout-grid">
        ${SEDES.map(sede=>`<div class="payout-field"><label>Meta ${sede}</label><div class="payout-input-wrap"><span>S/</span><input class="form-input" data-safetypay-goal-input="${sede}" type="number" min="1" step="0.01" value="${Number(safetypayGoals[sede] || DEFAULT_SAFETYPAY_MONTHLY_GOAL).toFixed(2)}"/></div></div>`).join('')}
      </div>
    </section>
    <section class="payout-card wide">
      <h3>Valores por cargo</h3>
      <p>Referencia base para nuevos cambios de cargo. Si un colaborador ya tiene sueldo editado en su ficha, se mantiene ese valor individual.</p>
      <div class="table-wrap" style="margin:0"><table><thead><tr><th>Cargo</th><th>Sueldo base</th><th>Penalidad tardanza</th><th>Bono puntualidad default</th><th>Bono por cuadre</th><th>Nota</th></tr></thead><tbody>
        ${Object.entries(getPayrollRoleDefaults()).filter(([role])=>role!=='Sin definir').map(([role,config])=>`<tr>
          <td>${role}</td>
          <td><div class="payout-input-wrap compact"><span>S/</span><input class="form-input" data-role-default="${role}" data-role-default-field="baseSalary" type="number" min="0" step="0.01" value="${Number(config.baseSalary || 0).toFixed(2)}"/></div></td>
          <td><div class="payout-input-wrap compact per-minute"><span>S/</span><input class="form-input" data-role-default="${role}" data-role-default-field="penaltyPerMinute" type="number" min="0" step="0.01" value="${Number(config.penaltyPerMinute || 0).toFixed(2)}"/><span>/ min</span></div></td>
          <td><div class="payout-input-wrap compact"><span>S/</span><input class="form-input" data-role-default="${role}" data-role-default-field="bonus" type="number" min="0" step="0.01" value="${Number(config.bonus || 0).toFixed(2)}"/></div></td>
          <td><div class="payout-input-wrap compact"><span>S/</span><input class="form-input" data-role-default="${role}" data-role-default-field="balanceBonus" type="number" min="0" step="0.01" value="${Number(config.balanceBonus || 0).toFixed(2)}"/></div></td>
          <td>No pisa sueldos personalizados</td>
        </tr>`).join('')}
      </tbody></table></div>
    </section>
    <section class="payout-card wide">
      <h3>Penalidades de atencion al cliente</h3>
      <p>Montos usados cuando se crean nuevos reportes de penalidad. Las penalidades ya creadas conservan el monto con el que fueron reportadas.</p>
      <div class="table-wrap" style="margin:0"><table><thead><tr><th>Penalidad</th><th>Monto</th><th>Descripcion</th></tr></thead><tbody>
        ${getPenaltyRules().map(rule=>`<tr>
          <td><strong>${esc(rule.label)}</strong><div style="font-size:11px;color:var(--text3);margin-top:3px">${esc(rule.code)}</div></td>
          <td><div class="payout-input-wrap compact"><span>S/</span><input class="form-input" data-penalty-rule="${esc(rule.code)}" data-penalty-rule-field="amount" type="number" min="0" step="0.01" value="${Number(rule.amount || 0).toFixed(2)}"/></div></td>
          <td><input class="form-input" data-penalty-rule="${esc(rule.code)}" data-penalty-rule-field="description" value="${esc(rule.description || '')}"/></td>
        </tr>`).join('')}
      </tbody></table></div>
    </section>
    <section class="payout-card wide">
      <h3>Contrasena del administrador</h3>
      <p>Cambia la clave de la cuenta con la que has iniciado sesion. La nueva contrasena debe tener al menos 6 caracteres.</p>
      <div class="form-grid">
        <div class="form-group"><label class="form-label">Contrasena actual</label><input class="form-input" id="adminCurrentPass" type="password" autocomplete="current-password" placeholder="Contrasena actual"/></div>
        <div class="form-group"><label class="form-label">Nueva contrasena</label><input class="form-input" id="adminNewPass" type="password" autocomplete="new-password" placeholder="Minimo 6 caracteres"/></div>
        <div class="form-group"><label class="form-label">Repetir nueva contrasena</label><input class="form-input" id="adminRepeatPass" type="password" autocomplete="new-password" placeholder="Repite la nueva contrasena"/></div>
      </div>
      <button class="submit-btn" id="saveAdminPasswordBtn" style="max-width:290px">Cambiar contrasena</button>
    </section>
    </div>
    <div class="payout-actions"><button class="submit-btn" id="savePayoutSettingsBtn" style="max-width:260px;margin-top:0">Guardar parametros</button></div>`;
  } else {
    if(isManager()){
      h+=`<div class="form-card" style="margin-bottom:1.25rem"><div class="page-title" style="font-size:16px;margin-bottom:.45rem">Agregar colaborador a ${esc(userSede(state.currentUser))}</div><div class="page-sub" style="margin-bottom:1rem">El usuario se creará como atención al cliente y quedará asignado automáticamente a tu sede.</div><button class="submit-btn" id="managerCreateUserBtn" style="max-width:300px;margin-top:0">Crear colaborador</button></div>`;
    }
    if(isAdmin()){
      h+=`<div class="form-card" style="margin-bottom:1.5rem"><div class="form-grid">
        <div class="form-group"><label class="form-label">Contrasena actual</label><input class="form-input" id="adminCurrentPass" type="password" placeholder="Contrasena actual"/></div>
        <div class="form-group"><label class="form-label">Nueva contrasena</label><input class="form-input" id="adminNewPass" type="password" placeholder="M-nimo 6 caracteres"/></div>
        <div class="form-group"><label class="form-label">Repetir nueva contrasena</label><input class="form-input" id="adminRepeatPass" type="password" placeholder="Repite la nueva contrasena"/></div>
      </div><button class="submit-btn" id="saveAdminPasswordBtn">Cambiar contrasena de admin</button></div>`;
    }
    h+=`<div class="alert-banner"><div class="ab-icon">i</div><div class="ab-text"><strong>Usuarios movidos a Colaboradores.</strong> Para editar rol, sede, usuario, contrasena o conectar una persona del Excel, entra a la ficha del colaborador.</div></div>
    <div class="table-wrap"><div class="empty-state"><div class="es-icon">#</div><p>La lista de usuarios ya no se edita aqui.</p><button class="btn-primary" data-nav="colaboradores">Ir a Colaboradores</button></div></div>`;
    return h;
    h+=`<div class="users-grid">`;
    visibleUsers.filter(u=>u.id!==state.currentUser.id||isAdmin()).filter(u=>u.role!=='admin' || isAdmin()).forEach(u=>{
      const userRecords=getVisibleRecords().filter(r=>r.userId===u.id);
      const o=userRecords.filter(r=>!!r.validatedAt).length;
      const pv=userRecords.filter(r=>isPendingApproval(r)).length;
      const rr=userRecords.filter(r=>r.tipo==='registro'&&daysSince(r.fecha)<=EXPIRE_DAY).length;
      const c=calcUserCommission(u);
      h+=`<div class="user-card"><div class="uc-top">${avatar(u,40,14)}<div><div class="uc-name">${u.name}</div><div class="uc-username">@${u.username}</div></div></div>
        <div class="uc-stat"><span>Rol</span><span>${u.role==='manager'?'Jefe de sede':u.role==='admin'?'Admin general':'Atencion al cliente'}</span></div>
        <div class="uc-stat"><span>Sede</span><span>${userSede(u)}</span></div>
        <div class="uc-stat"><span>Operaciones validadas</span><span style="color:var(--green)">${o}</span></div>
        <div class="uc-stat"><span>Pendientes aprobacion</span><span style="color:var(--amber)">${pv}</span></div>
        <div class="uc-stat"><span>Registros pendientes</span><span style="color:var(--amber)">${rr}</span></div>
        <div class="uc-stat"><span>Comisiones</span><span style="color:var(--green)">S/ ${c.toFixed(2)}</span></div>
        <div style="margin-top:10px;display:flex;gap:6px">
          ${canManageUser(u)?`<button class="btn-sm" data-eu="${u.id}">Editar</button><button class="btn-sm danger" data-del="${u.id}">Eliminar</button><button class="btn-sm" data-rp="${u.id}" title="Cambiar contrasena">Reset pass</button>`:''}
        </div></div>`;
    });
    h+='</div>';
  }
  return h;
}

function renderReportes(){
  const visibleReportMonth=reportMonthKey();
  // El panel financiero depende de asistencia y calificaciones, que no vienen
  // en la carga ligera inicial del sistema. No renderizar totales en cero
  // mientras esas fuentes aun no se hayan sincronizado.
  if(ensureAttendanceLoaded() || ATTENDANCE_LOADING){
    return `<div class="page-header"><div class="page-title">Reportes</div><div class="page-sub">Preparando el reporte financiero de ${monthLabelFromKey(visibleReportMonth)}...</div></div><div class="table-wrap"><div class="empty-state"><div class="section-spinner" role="status" aria-label="Cargando"></div><p>Cargando asistencia y colaboradores para el reporte...</p></div></div>`;
  }
  if(!ratingsLoadedFor(visibleReportMonth)){
    if(!RATINGS_LOADING) setTimeout(()=>loadRatings(false, false, visibleReportMonth), 0);
    return `<div class="page-header"><div class="page-title">Reportes</div><div class="page-sub">Preparando el reporte financiero de ${monthLabelFromKey(visibleReportMonth)}...</div></div><div class="table-wrap"><div class="empty-state"><div class="section-spinner" role="status" aria-label="Cargando"></div><p>Cargando calificaciones para el reporte...</p></div></div>`;
  }
  const visibleReportDate=monthDateFromKey(visibleReportMonth);
  const selectedReportSede=getReportSelectedSede();
  const reportUsers=getReportCollaborators();
  const reportRecords=getReportRecords(visibleReportMonth);
  const summaryUsers=getReportSummaryUsers();
  const selectedUser=reportUsers.find(u=>u.id==state.reportUser);
  const financialPeople=getFinancialReportPeople(visibleReportDate);
  const totalCommission=state.reportMode==='all'
    ? financialPeople.reduce((sum,person)=>sum+Number(person.commissionsPay||0),0)
    : Number(getReportPersonBundle(selectedUser, visibleReportMonth)?.salaryPerson?.commissionsPay || 0);
  const totalSalary=state.reportMode==='all'
    ? financialPeople.reduce((sum,person)=>sum+Number(person.salaryPay||0),0)
    : Number(getReportPersonBundle(selectedUser, visibleReportMonth)?.salaryPerson?.salaryPay || 0);
  const totalDiscounts=state.reportMode==='all'
    ? financialPeople.reduce((sum,person)=>sum+Number(person.totalDiscounts||0),0)
    : Number(getReportPersonBundle(selectedUser, visibleReportMonth)?.salaryPerson?.totalDiscounts || 0);
  const totalPayable=state.reportMode==='all'
    ? financialPeople.reduce((sum,person)=>sum+Number(person.estimatedSalary||0),0)
    : Number(getReportPersonBundle(selectedUser, visibleReportMonth)?.salaryPerson?.estimatedSalary || 0);
  const reportClosure=getClosure(visibleReportMonth);
  let h=`<div class="page-header"><div class="page-title">Reportes</div><div class="page-sub">Genera un PDF financiero con sueldos, comisiones, tardanzas, descuentos y total pagado de ${monthLabelFromKey(visibleReportMonth)}.</div></div>
  <div class="form-card" style="margin-bottom:1.25rem">
    <div class="alert-banner" style="margin-bottom:1rem"><div class="ab-icon">i</div><div class="ab-text"><strong>Mes del reporte:</strong> ${monthLabelFromKey(visibleReportMonth)}${isManager()&&!isAdmin()&&!state.reportMonth?' - los jefes de sede ven automaticamente el mes cerrado anterior para auditoria.':''}</div></div>
    <div class="form-grid">
      <div class="form-group"><label class="form-label">Tipo de reporte</label><select class="form-select" id="reportMode"><option value="all"${state.reportMode==='all'?' selected':''}>General financiero</option><option value="user"${state.reportMode==='user'?' selected':''}>Por colaborador</option></select></div>
      <div class="form-group"><label class="form-label">Mes a ver</label>${monthFilterSelectHtml('reportMonth', visibleReportMonth, { includeEmpty:false, count:24, extraValues: MONTHLY_CLOSURES.map(item=>item.month) })}<div style="margin-top:6px"><span class="days-chip ${reportClosure?.status==='CLOSED'?'ok':'warn'}">${reportClosure?.status==='CLOSED'?'Mes cerrado':'Mes abierto'}</span></div></div>
      ${state.reportMode==='all'?`<div class="form-group"><label class="form-label">Sede del reporte</label><select class="form-select" id="reportSede"${(isAdmin()||canPreviewAllSedesAsManager())?'':' disabled'}>${(isAdmin()||canPreviewAllSedesAsManager())?`<option value="">Todas las sedes</option>${SEDES.map(sede=>`<option value="${sede}"${selectedReportSede===sede?' selected':''}>${sede}</option>`).join('')}`:`<option value="${userSede(state.currentUser)}">${userSede(state.currentUser)}</option>`}</select></div>`:''}
      ${state.reportMode==='user'?`<div class="form-group"><label class="form-label">Colaborador</label><select class="form-select" id="reportUser"><option value="">Selecciona un colaborador</option>${reportUsers.map(u=>`<option value="${u.id}"${state.reportUser==u.id?' selected':''}>${u.name} - ${u.sede} - ${u.role==='manager'?'Jefe de sede':'Colaborador'}</option>`).join('')}</select></div>`:''}
      <div class="form-group"><label class="form-label">Total sueldo</label><input class="form-input" disabled value="${money(totalSalary)}"/></div>
      <div class="form-group"><label class="form-label">Total comisiones</label><input class="form-input" disabled value="${money(totalCommission)}"/></div>
      <div class="form-group"><label class="form-label">Descuentos</label><input class="form-input" disabled value="${money(totalDiscounts)}"/></div>
      <div class="form-group"><label class="form-label">Total a pagar</label><input class="form-input" disabled value="${money(totalPayable)}"/></div>
    </div>
    <div style="margin-top:1rem;display:flex;justify-content:flex-end"><button class="btn-primary" id="exportPdfBtn" style="width:auto;padding:12px 20px">Descargar reporte PDF</button></div>
  </div>`;
  if(state.reportMode==='all'){
    const reportMonth=visibleReportMonth;
    const allReportRecords=getVisibleRecords().filter(record=>recordAccountingMonthKey(record)===reportMonth && reportSedeMatches(getItemSede(record)));
    const approvedRecords=reportRecords;
    const registrationOnlyCount=allReportRecords.filter(record=>record.tipo==='registro').length;
    const operationCount=allReportRecords.filter(record=>record.tipo==='operacion').length;
    const newClientCount=registrationOnlyCount + operationCount;
    const conversionRate=newClientCount ? ((operationCount / newClientCount) * 100).toFixed(1) : '0.0';
    const pendingCount=allReportRecords.filter(record=>isPendingApproval(record)).length;
    const rejectedCount=allReportRecords.filter(record=>record.rejectedAt).length;
    const openCount=Math.max(0, allReportRecords.length - approvedRecords.length - pendingCount - rejectedCount);
    const paidDays=financialPeople.reduce((sum,person)=>sum + (person.dayPayments||[]).filter(day=>Number(day.dailyPay||0)>0).length,0);
    const lateEntries=financialPeople.reduce((sum,person)=>sum + Number(person.lateEntries||0),0);
    const extraMinutes=financialPeople.reduce((sum,person)=>sum + Number(person.totalExtraMinutes||0),0);
    const punctualPeople=financialPeople.filter(person=>Number(person.lateEntries||0)===0 && (person.dayPayments||[]).some(day=>Number(day.dailyPay||0)>0)).length;
    const monthRatings=RATINGS.filter(row=>monthKeyFromDate(row.date || row.rawDate)===reportMonth && reportSedeMatches(row.sede));
    const approvedRatings=monthRatings.filter(row=>row.payable || row.approvalStatus==='APPROVED').length;
    const avgRating=approvedRatings
      ? (monthRatings.filter(row=>row.payable || row.approvalStatus==='APPROVED').reduce((sum,row)=>sum+Number(row.rating||0),0)/approvedRatings).toFixed(1)
      : '0.0';
    const paymentParts=[
      { label:'Sueldo neto', value:totalSalary, color:'#2563eb' },
      { label:'Comisiones', value:totalCommission, color:'#16a34a' },
      { label:'Descuentos', value:totalDiscounts, color:'#ef4444' }
    ];
    const statusParts=[
      { label:'Validados', value:approvedRecords.length, color:'#16a34a' },
      { label:'Pendientes', value:pendingCount, color:'#f59e0b' },
      { label:'Rechazados', value:rejectedCount, color:'#ef4444' },
      { label:'Abiertos', value:openCount, color:'#64748b' }
    ];
    const registrationVsParts=[
      { label:'Solo registro', value:registrationOnlyCount, color:'#ef4444' },
      { label:'Operacion', value:operationCount, color:'#16a34a' }
    ];
    const pieStyle=(parts)=>{
      const total=parts.reduce((sum,item)=>sum+Number(item.value||0),0);
      if(total<=0) return 'background:#e5e7eb';
      let cursor=0;
      const stops=parts.map(item=>{
        const start=cursor;
        cursor += (Number(item.value||0) / total) * 100;
        return `${item.color} ${start.toFixed(2)}% ${cursor.toFixed(2)}%`;
      }).join(',');
      return `background:conic-gradient(${stops})`;
    };
    const chartTotal=parts=>parts.reduce((sum,item)=>sum+Number(item.value||0),0);
    const chartCenterLabel=(parts, isMoney=false)=>{
      const total=chartTotal(parts);
      if(isMoney) return total>=1000 ? `S/ ${(total/1000).toFixed(1)}k` : money(total);
      return new Intl.NumberFormat('es-PE').format(total);
    };
    const donut=(parts, label, caption='total')=>`<div class="pie-chart" style="${pieStyle(parts)}"><div class="pie-center"><strong>${label}</strong><span>${caption}</span></div></div>`;
    const legend=(parts, formatValue=value=>value)=>{
      const total=chartTotal(parts);
      return parts.map(item=>{
        const percentage=total ? ((Number(item.value||0)/total)*100).toFixed(1) : '0.0';
        return `<div class="chart-legend-row"><span><i style="background:${item.color}"></i>${item.label}</span><strong>${formatValue(item.value)}<small>${percentage}%</small></strong></div>`;
      }).join('');
    };
    const sedeStats=SEDES.map(sede=>{
      const sedePeople=financialPeople.filter(person=>getReportPersonSede(person, reportMonth)===sede);
      const sedeRecords=allReportRecords.filter(record=>getItemSede(record)===sede);
      const sedeOperations=sedeRecords.filter(record=>record.tipo==='operacion').length;
      const sedeRegistrations=sedeRecords.filter(record=>record.tipo==='registro').length;
      const sedeNewClients=sedeRegistrations + sedeOperations;
      const sedeTotal=sedePeople.reduce((sum,person)=>sum+Number(person.estimatedSalary||0),0);
      const sedeCommission=sedePeople.reduce((sum,person)=>sum+Number(person.commissionsPay||0),0);
      const sedePaidDays=sedePeople.reduce((sum,person)=>sum+(person.dayPayments||[]).filter(day=>Number(day.dailyPay||0)>0).length,0);
      return {
        sede,
        people:sedePeople.length,
        records:sedeRegistrations,
        operations:sedeOperations,
        newClients:sedeNewClients,
        conversion:sedeNewClients ? ((sedeOperations / sedeNewClients) * 100).toFixed(1) : '0.0',
        paidDays:sedePaidDays,
        commission:sedeCommission,
        total:sedeTotal
      };
    });
    const sedeParts=sedeStats.map((row,index)=>({ label:row.sede, value:row.records + row.operations, color:COLORS[index % COLORS.length] }));
    const maxSedeProductivity=Math.max(1, ...sedeStats.map(row=>row.records + row.operations));
    const productivityRows=financialPeople.map(person=>{
      const linkedUser=userForAttendancePerson(person);
      const grossSalary=Number((person.dayPayments||[]).reduce((sum, day)=>sum + Number(day.regularPay || 0) + Number(day.overtimePay || 0),0));
      const recordsForUser=linkedUser ? allReportRecords.filter(record=>Number(record.userId)===Number(linkedUser.id)) : [];
      const registrations=recordsForUser.filter(record=>record.tipo==='registro').length;
      const operations=recordsForUser.filter(record=>record.tipo==='operacion').length;
      const userNewClients=registrations + operations;
      const ratings=ratingRowsForPerson(person, reportMonth).length;
      const referrals=approvedReferralsForPerson(person, reportMonth).length;
      const wrongCards=approvedWrongCardsForPerson(person, reportMonth).length;
      const calls=approvedCallsForPerson(person, reportMonth).length;
      const productivity=operations + ratings + referrals + wrongCards + calls;
      return {
        person,
        linkedUser,
        grossSalary,
        records:registrations,
        operations,
        conversion:userNewClients ? ((operations / userNewClients) * 100).toFixed(1) : '0.0',
        ratings,
        referrals,
        wrongCards,
        calls,
        productivity
      };
    }).sort((a,b)=>b.productivity-a.productivity || Number(b.person.estimatedSalary||0)-Number(a.person.estimatedSalary||0));
    const maxProductivity=Math.max(1, ...productivityRows.map(row=>row.productivity));
    h+=`<div class="report-dashboard">
      <div class="dash-grid">
        <div class="dash-card"><div class="label">Clientes nuevos</div><div class="value">${newClientCount}</div><div class="mini-text">${operationCount} efectivizados - ${registrationOnlyCount} solo registrados</div></div>
        <div class="dash-card"><div class="label">Efectivizacion</div><div class="value">${conversionRate}%</div><div class="mini-text">operaciones dentro de 7 dias vs solo registros</div></div>
        <div class="dash-card"><div class="label">Productividad</div><div class="value">${productivityRows.reduce((sum,row)=>sum+row.productivity,0)}</div><div class="mini-text">${approvedRatings} calificaciones aprobadas - promedio ${avgRating}</div></div>
        <div class="dash-card"><div class="label">Puntualidad</div><div class="value">${punctualPeople}/${financialPeople.length || 0}</div><div class="mini-text">${lateEntries} tardanza(s) - ${minutesLabel(extraMinutes)} extra</div></div>
        <div class="dash-card"><div class="label">Asistencia</div><div class="value">${paidDays}</div><div class="mini-text">dias pagables acumulados</div></div>
      </div>
      <div class="chart-grid">
        <div class="table-wrap chart-panel"><div class="table-header"><div class="table-title">Distribucion de pagos</div></div><div class="chart-body">${donut(paymentParts, chartCenterLabel(paymentParts, true), 'total del mes')}<div class="chart-legend">${legend(paymentParts, value=>money(value))}</div></div></div>
        <div class="table-wrap chart-panel"><div class="table-header"><div class="table-title">Registro vs operacion</div></div><div class="chart-body">${donut(registrationVsParts, chartCenterLabel(registrationVsParts), 'clientes')}<div class="chart-legend">${legend(registrationVsParts)}<div class="chart-note">Registro: cliente nuevo que no efectivizo en 7 dias. Operacion: cliente nuevo que si efectivizo en 7 dias.</div></div></div></div>
        <div class="table-wrap chart-panel"><div class="table-header"><div class="table-title">Productividad por sede</div></div><div class="chart-body">${donut(sedeParts, chartCenterLabel(sedeParts), 'clientes')}<div class="chart-legend">${legend(sedeParts)}</div></div></div>
      </div>
      <div class="table-wrap"><div class="table-header"><div class="table-title">Resumen por sede</div></div>
        <table><thead><tr><th>Sede</th><th>Colaboradores</th><th>Solo registro</th><th>Operacion</th><th>Clientes nuevos</th><th>Efectivizacion</th><th>Comisiones</th><th>Total pagar</th><th>Actividad</th></tr></thead><tbody>
          ${sedeStats.map(row=>`<tr><td>${row.sede}</td><td>${row.people}</td><td>${row.records}</td><td>${row.operations}</td><td>${row.newClients}</td><td>${row.conversion}%</td><td style="color:var(--green);font-weight:700">${money(row.commission)}</td><td style="color:var(--green);font-weight:800">${money(row.total)}</td><td><div class="mini-bar"><span style="width:${Math.max(6, ((row.records + row.operations)/maxSedeProductivity)*100)}%"></span></div></td></tr>`).join('')}
        </tbody></table>
      </div>
      <div class="table-wrap"><div class="table-header"><div class="table-title">Productividad por colaborador</div></div>
        <table><thead><tr><th>Colaborador</th><th>Sede</th><th>Solo registro</th><th>Operacion</th><th>Efectivizacion</th><th>Calificaciones</th><th>Extras</th><th>Puntaje</th><th>Avance</th></tr></thead><tbody>
          ${productivityRows.map(row=>`<tr><td>${row.person.personName}</td><td>${getReportPersonSede(row.person, reportMonth) || 'Sin sede'}</td><td>${row.records}</td><td>${row.operations}</td><td>${row.conversion}%</td><td>${row.ratings}</td><td>${row.referrals + row.wrongCards + row.calls}</td><td style="font-weight:800;color:var(--green)">${row.productivity}</td><td><div class="mini-bar"><span style="width:${Math.max(6, (row.productivity/maxProductivity)*100)}%"></span></div></td></tr>`).join('') || '<tr><td colspan="9"><div class="empty-state"><p>No hay productividad para mostrar.</p></div></td></tr>'}
        </tbody></table>
      </div>
      <div class="table-wrap"><div class="table-header"><div class="table-title">Resumen financiero por colaborador</div></div>
        <table><thead><tr><th>Colaborador</th><th>Rol</th><th>Area</th><th>Sede</th><th>Sueldo bruto</th><th>Descuentos</th><th>Sueldo neto</th><th>Comisiones</th><th>Total pagar</th></tr></thead><tbody>
          ${productivityRows.map(row=>`<tr><td>${row.person.personName}</td><td>${row.person.payrollRole || (row.linkedUser?.role==='manager'?'Jefe de sede':'Colaborador')}</td><td>${row.person.department || 'Sin Area'}</td><td>${getReportPersonSede(row.person, reportMonth) || 'Sin sede'}</td><td>${money(row.grossSalary)}</td><td style="color:var(--red);font-weight:700">-${money(row.person.totalDiscounts||0)}</td><td>${money(row.person.salaryPay||0)}</td><td style="color:var(--green);font-weight:700">${money(row.person.commissionsPay||0)}</td><td style="color:var(--green);font-weight:800">${money(row.person.estimatedSalary||0)}</td></tr>`).join('') || '<tr><td colspan="9"><div class="empty-state"><p>No hay personas visibles para exportar en el reporte financiero.</p></div></td></tr>'}
        </tbody></table>
      </div>
    </div>`;
    return h;
  }
  h+=`<div class="table-wrap"><div class="table-header"><div class="table-title">Detalle del colaborador</div></div>
  <table><thead><tr><th>Cliente</th><th>DNI</th>${state.reportMode==='all'?'<th>Colaborador</th><th>Sede</th>':''}<th>Registro</th><th>Operacion</th><th>Validado</th><th>Modalidad</th><th>Plataforma</th><th>Comision</th></tr></thead><tbody>`;
  reportRecords.forEach(r=>{
    const u=getItemOwner(r);
    h+=`<tr><td>${r.cliente||'-'}</td><td>${r.dni}</td>${state.reportMode==='all'?`<td>${u.name}</td><td>${getItemSede(r)}</td>`:''}<td>${fmt(r.fecha)}</td><td>${fmt(r.fechaOperacion)}</td><td>${fmt(r.validatedAt)}</td><td>${r.modalidad==='presencial'?'Presencial':'Virtual'}</td><td>${r.plataforma==='drive'?'Drive':'Web'}</td><td style="color:var(--green);font-weight:700">S/ ${getCommissionRate().toFixed(2)}</td></tr>`;
  });
  if(!reportRecords.length) h+=`<tr><td colspan="${state.reportMode==='all'?10:8}"><div class="empty-state"><div class="es-icon">-</div><p>No hay registros validados para este reporte.</p></div></td></tr>`;
  h+='</tbody></table></div>';
  return h;
}

function renderMisRegistros(){
  const u=state.currentUser;
  const visibleMonth=activeMonthKey(state.recordsMonth);
  const dups=getDups(RECORDS);
  let rr=RECORDS.filter(r=>r.userId===u.id && recordAccountingMonthKey(r)===visibleMonth);
  if(state.ft){ const q=state.ft.toLowerCase(); rr=rr.filter(r=>r.dni.includes(state.ft)||(r.cliente||'').toLowerCase().includes(q)); }
  if(state.fTipo) rr=rr.filter(r=>r.tipo===state.fTipo);
  if(state.fApproval) rr=rr.filter(r=>state.fApproval==='pending'?isPendingApproval(r):state.fApproval==='validated'?!!r.validatedAt:state.fApproval==='rejected'?!!r.rejectedAt:true);
  if(state.fDesde) rr=rr.filter(r=>r.fecha>=state.fDesde);
  if(state.fHasta) rr=rr.filter(r=>r.fecha<=state.fHasta);
  rr.sort((a,b)=>b.fecha.localeCompare(a.fecha));
  const page=paginateRows('recordsMine', rr);
  const alerts=rr.filter(r=>r.tipo==='registro'&&daysSince(r.fecha)===WARN_DAY);
  const pendingApproval=rr.filter(r=>isPendingApproval(r));

  let h=`<div class="page-header"><div class="page-title">Mis Registros</div><div class="page-sub">Tus clientes y su estado de comision</div></div>`;
  if(alerts.length>0) h+=`<div class="alert-banner"><div class="ab-icon">!</div><div class="ab-text"><strong>${alerts.length} cliente(s) en dia 6</strong> - manana vence el plazo! Actualiza si ya hicieron la operacion.</div></div>`;
  if(pendingApproval.length>0) h+=`<div class="alert-banner"><div class="ab-icon">!</div><div class="ab-text"><strong>${pendingApproval.length} registro(s) pendientes de aprobacion</strong> - tu cliente opero dentro de los 7 dias y ahora queda esperando la validacion.</div></div>`;
  h+=`<div style="margin-bottom:1rem;display:flex;justify-content:flex-end"><button class="btn-sm success" id="goNuevo">? Nuevo registro</button></div>
  <div class="table-wrap">
    <div class="table-header">
      <div class="table-title">Mis registros (${rr.length})</div>
      <input class="search-input" id="ft" placeholder="Buscar DNI o nombre..." value="${state.ft}" style="width:180px"/>
      ${monthFilterSelectHtml('recordsMonth', visibleMonth, { includeEmpty:false, count:24, extraValues: MONTHLY_CLOSURES.map(item=>item.month) })}
      <select class="filter-select" id="ftp"><option value="">Todos</option><option value="registro"${state.fTipo==='registro'?' selected':''}>Registro</option><option value="operacion"${state.fTipo==='operacion'?' selected':''}>Operacion</option></select>
      <select class="filter-select" id="fap"><option value="">Toda aprobacion</option><option value="pending"${state.fApproval==='pending'?' selected':''}>Pendientes</option><option value="validated"${state.fApproval==='validated'?' selected':''}>Validados</option><option value="rejected"${state.fApproval==='rejected'?' selected':''}>Rechazados</option></select>
      <input class="search-input" id="fd" type="date" value="${state.fDesde}" style="width:130px" title="Desde"/>
      <input class="search-input" id="fh" type="date" value="${state.fHasta}" style="width:130px" title="Hasta"/>
    </div>
    <table><thead><tr><th>Cliente</th><th>DNI</th><th>Tipo</th><th>Modalidad</th><th>Fecha</th><th>Estado</th><th>Aprobacion</th><th>Plataforma</th><th>Comision</th><th>Notas</th><th></th></tr></thead><tbody>`;
  page.rows.forEach(r=>{
    const dup=dups.has(r.id);
    const d=recordAge(r);
    const isAlert=r.tipo==='registro'&&d===WARN_DAY;
    const validation=validationText(r);
    const comm=r.validatedAt?`<span style="color:var(--green);font-weight:700">+S/ ${getCommissionRate().toFixed(2)}</span>`:r.rejectedAt?`<span style="color:var(--red);font-size:11px">Rechazado</span>`:isPendingApproval(r)?`<span style="color:var(--amber);font-size:11px">Pendiente de aprobacion</span>`:d>EXPIRE_DAY?`<span style="color:var(--red);font-size:11px">Sin comision</span>`:`<span style="color:var(--text3);font-size:11px">Pendiente</span>`;
    h+=`<tr class="${dup?'dup-row':isAlert?'alert-row':''}">
      <td>${r.cliente||'-'}</td>
      <td><span style="font-family:var(--font2);font-weight:600">${r.dni}</span>${dup?' <span class="badge dup">DUP</span>':''}${dupDetailsHtml(r)}</td>
      <td><span class="badge ${r.tipo}">${r.tipo==='registro'?'Registro':'Operacion'}</span></td>
      <td><span class="badge ${r.modalidad==='presencial'?'drive':'web'}">${r.modalidad==='presencial'?'Presencial':'Virtual'}</span></td>
      <td>${fmt(r.fecha)}</td>
      <td>${dayChip(r)}</td>
      <td><span class="days-chip ${validation.cls}">${validation.label}</span></td>
      <td><span class="badge ${r.plataforma}">${r.plataforma==='drive'?'Drive':'Web'}</span></td>
      <td>${comm}</td>
      <td style="color:var(--text2);max-width:100px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${r.rejectedAt&&r.rejectionReason?r.rejectionReason:(r.notas||'-')}</td>
      <td><button class="action-btn" data-edit="${r.id}">${canEditRecordFields(r)?'Editar':'Ver'}</button></td>
    </tr>`;
  });
  if(!rr.length) h+=`<tr><td colspan="11"><div class="empty-state"><div class="es-icon">-</div><p>Sin registros. Sube tu primer registro!</p></div></td></tr>`;
  h+=`</tbody></table>${renderPagination(page)}</div>`;
  return h;
}

function referralStatusHtml(r){
  if(r.validatedAt) return `<span class="days-chip valid">Validado ${fmt(r.validatedAt)}</span>`;
  if(r.rejectedAt) return `<span class="days-chip expired">Rechazado</span>`;
  return `<span class="days-chip warn">Pendiente de aprobacion</span>`;
}

function canValidateReferralLocal(r){
  if(!r || r.validatedAt || r.rejectedAt || !canEditMonth(monthKeyFromDate(r.createdAt))) return false;
  if(isAdmin()) return true;
  if(canPreviewAllSedesAsManager()) return false;
  if(isManager()){
    if(isPaymentsSupervisor()) return isPaymentsTeamMember(getItemOwner(r));
    if(isPaymentsTeamMember(getItemOwner(r))) return false;
    return getItemSede(r)===userSede(state.currentUser);
  }
  return false;
}

function renderSafetypayEditModal(){
  const entry=SAFETYPAY_CODES.find(item=>Number(item.id)===Number(SAFETYPAY_EDIT_ID));
  if(!entry) return `<div class="modal-overlay" id="safetypayEditOverlay"><div class="modal"><h3>Editar código Safetypay</h3><p class="page-sub">No se encontró el código seleccionado.</p><div class="modal-actions"><button class="btn-cancel" id="safetypayEditClose">Cerrar</button></div></div></div>`;
  const owner=entry.user || getUserById(entry.userId);
  return `<div class="modal-overlay" id="safetypayEditOverlay">
    <div class="modal" style="max-width:760px">
      <h3>Editar código Safetypay</h3>
      <p class="page-sub" style="margin-top:-6px;margin-bottom:16px">Registrado por <strong>${esc(owner.name || '-')}</strong> · ${esc(getItemSede(entry))} · ${fmtDateTime(entry.createdAt)}</p>
      <div class="form-grid">
        <div class="form-group"><label class="form-label">DNI del cliente</label><input class="form-input" id="safetypayEditDni" inputmode="numeric" value="${esc(SAFETYPAY_DRAFT.clientDni)}"/></div>
        <div class="form-group"><label class="form-label">Nro. tarjeta (4 últimos dígitos)</label><input class="form-input" id="safetypayEditCard" maxlength="4" inputmode="numeric" value="${esc(SAFETYPAY_DRAFT.cardLast4)}"/></div>
        <div class="form-group"><label class="form-label">Código cliente (6 dígitos)</label><input class="form-input" id="safetypayEditCustomerCode" maxlength="6" inputmode="numeric" value="${esc(SAFETYPAY_DRAFT.customerCode)}"/></div>
        <div class="form-group"><label class="form-label">Banco</label><select class="form-select" id="safetypayEditBank">${SAFETYPAY_BANKS.map(bank=>`<option value="${bank}"${SAFETYPAY_DRAFT.bank===bank?' selected':''}>${bank}</option>`).join('')}</select></div>
        <div class="form-group"><label class="form-label">Código</label><select class="form-select" id="safetypayEditCode">${SAFETYPAY_CODE_OPTIONS.map(code=>`<option value="${code}"${SAFETYPAY_DRAFT.code===code?' selected':''}>${code}</option>`).join('')}</select></div>
        <div class="form-group"><label class="form-label">Monto</label><input class="form-input" id="safetypayEditAmount" type="number" min="1" step="0.01" value="${esc(SAFETYPAY_DRAFT.amount)}"/></div>
        <div class="form-group full"><label class="form-label">Nro. operación</label><input class="form-input" id="safetypayEditOperation" value="${esc(SAFETYPAY_DRAFT.operationNumber)}"/></div>
      </div>
      <div class="modal-actions"><button class="btn-cancel" id="safetypayEditClose">Cancelar</button><button class="btn-primary" id="safetypayEditSave" style="width:auto;padding:9px 20px">Guardar cambios</button></div>
    </div>
  </div>`;
}

function canDeleteReferralLocal(r){
  if(!r) return false;
  if(isAdmin()) return true;
  if(canPreviewAllSedesAsManager()) return false;
  if(isPaymentsSupervisor()) return isPaymentsTeamMember(getItemOwner(r));
  if(isPaymentsTeamMember(getItemOwner(r))) return false;
  if(isManager()) return getItemSede(r)===userSede(state.currentUser);
  return r.userId===state.currentUser.id && !r.validatedAt;
}

function getReferralRows(){
  const month=activeMonthKey(state.referralMonth);
  let rows=[...REFERRALS];
  rows=rows.filter(r=>monthKeyFromDate(r.validatedAt || r.createdAt)===month);
  rows=rows.filter(r=>dateMatchesQuickPeriod(r.createdAt));
  if(isEmployee()) rows=rows.filter(r=>r.userId===state.currentUser.id);
  if(state.referralSearch){
    const q=state.referralSearch.toLowerCase();
    rows=rows.filter(r=>r.dni.includes(q)||(r.cliente||'').toLowerCase().includes(q)||getItemOwner(r).name.toLowerCase().includes(q));
  }
  if(state.referralUser) rows=rows.filter(r=>r.userId==state.referralUser);
  if(state.referralStatus){
    rows=rows.filter(r=>state.referralStatus==='pending'?(!r.validatedAt&&!r.rejectedAt):state.referralStatus==='validated'?!!r.validatedAt:state.referralStatus==='rejected'?!!r.rejectedAt:true);
  }
  return rows;
}

function renderReferidos(){
  const rows=getReferralRows();
  const page=paginateRows('referrals', rows);
  const totalValidated=rows.filter(r=>!!r.validatedAt).reduce((sum,r)=>sum+r.referralCommission,0);
  const pendingCount=rows.filter(r=>!r.validatedAt&&!r.rejectedAt).length;
  const historyByDni=REFERRALS.reduce((acc,r)=>{ acc[r.dni]=(acc[r.dni]||0)+1; return acc; },{});
  let h=`<div class="page-header"><div class="page-title">Referidos</div><div class="page-sub">Solo Jhonatan y los administradores pueden aprobar o rechazar referidos.</div>${isAdmin() && activeMonthKey(state.referralMonth)===limaTodayKey().slice(0,7)?'<button class="btn-sm" id="resetReferralMonth">Restablecer este mes a pendientes</button>':''}</div>
  <div class="alert-banner"><div class="ab-icon">!</div><div class="ab-text"><strong>Importante antes de registrar:</strong> no aplica para pago de tarjeta, tarjetas comerciales ni personas con otra comision que no sea 1%.</div></div>
  <div class="stat-grid">
    <div class="stat-card"><div class="stat-label">Referidos visibles</div><div class="stat-value">${rows.length}</div><div class="stat-sub">${pendingCount} pendientes de aprobacion</div></div>
    <div class="stat-card"><div class="stat-label">Comision validada</div><div class="stat-value green">S/ ${totalValidated.toFixed(2)}</div><div class="stat-sub">0.4% del monto efectivizado</div></div>
  </div>`;

  h+=`<div class="form-card" style="margin-bottom:1.25rem">
    <div class="form-grid">
      <div class="form-group"><label class="form-label">Nombre del referido *</label><input class="form-input" id="refName" placeholder="Nombre completo" value="${REFERRAL_DRAFT.clientName}"/></div>
      <div class="form-group"><label class="form-label">DNI *</label><input class="form-input" id="refDni" placeholder="12345678" maxlength="15" value="${REFERRAL_DRAFT.dni}"/></div>
      <div class="form-group"><label class="form-label">Monto efectivizado *</label><input class="form-input" id="refAmount" type="number" min="1" step="0.01" placeholder="Monto en soles" value="${REFERRAL_DRAFT.amount}"/></div>
      <div class="form-group"><label class="form-label">Banco *</label><select class="form-select" id="refBank">
        <option value="BBVA"${REFERRAL_DRAFT.bank==='BBVA'?' selected':''}>BBVA</option>
        <option value="BCP"${REFERRAL_DRAFT.bank==='BCP'?' selected':''}>BCP</option>
        <option value="SCOTIABANK"${REFERRAL_DRAFT.bank==='SCOTIABANK'?' selected':''}>Scotiabank</option>
        <option value="INTERBANK"${REFERRAL_DRAFT.bank==='INTERBANK'?' selected':''}>Interbank</option>
      </select></div>
      <div class="form-group full"><label class="form-label">Notas</label><input class="form-input" id="refNotes" placeholder="Opcional" value="${REFERRAL_DRAFT.notes}"/></div>
    </div>
    <div id="refCalcPreview" style="margin-top:10px;color:var(--text2);font-size:12px">Monto base: S/ ${calcReferralBankCommission(REFERRAL_DRAFT.bank, Number(REFERRAL_DRAFT.amount||0)).toFixed(2)} - Comision referido: S/ ${calcReferralCommission(REFERRAL_DRAFT.bank, Number(REFERRAL_DRAFT.amount||0)).toFixed(2)}</div>
    <button class="submit-btn" id="saveReferralBtn">Guardar referido</button>
  </div>`;

  h+=`<div class="table-wrap">
    <div class="table-header">
      <div class="table-title">Referidos (${rows.length})</div>
      <input class="search-input" id="referralSearch" placeholder="DNI, nombre o usuario..." value="${state.referralSearch}" style="width:210px"/>
      ${(isAdmin()||isManager())?`<select class="filter-select" id="referralUser"><option value="">${isAdmin()?'Todo el equipo':'Toda tu sede'}</option>${getVisibleUsers().filter(u=>u.role!=='admin').map(u=>`<option value="${u.id}"${state.referralUser==u.id?' selected':''}>${u.name}</option>`).join('')}</select>`:''}
      <select class="filter-select" id="referralStatus"><option value="">Todo estado</option><option value="pending"${state.referralStatus==='pending'?' selected':''}>Pendientes</option><option value="validated"${state.referralStatus==='validated'?' selected':''}>Validados</option><option value="rejected"${state.referralStatus==='rejected'?' selected':''}>Rechazados</option></select>
      ${periodFilterHtml()}
      ${monthFilterSelectHtml('referralMonth', activeMonthKey(state.referralMonth), { includeEmpty:false, count:24, extraValues: rows.map(row=>row.createdAt) })}
    </div>
    <div class="referrals-table-scroll"><table class="referrals-table${isEmployee()?' referrals-table-employee':''}"><colgroup><col style="width:180px"/><col style="width:150px"/>${!isEmployee()?'<col style="width:210px"/>':''}<col style="width:90px"/><col style="width:110px"/><col style="width:105px"/><col style="width:175px"/><col style="width:135px"/><col style="width:110px"/><col style="width:360px"/></colgroup><thead><tr><th>Referido</th><th>DNI</th>${!isEmployee()?'<th>Subido por</th>':''}<th>Banco</th><th>Monto efectivizado</th><th>Comision referido</th><th>Estado</th><th>Subido</th><th>Notas</th><th></th></tr></thead><tbody>`;
  page.rows.forEach(r=>{
    const u=getItemOwner(r);
    const historyCount=historyByDni[r.dni]||1;
    h+=`<tr>
      <td title="${esc(r.cliente||'-')}">${esc(r.cliente||'-')}</td>
      <td><span style="font-family:var(--font2);font-weight:600">${r.dni}</span>${historyCount>1?`<div style="margin-top:4px;color:var(--text3);font-size:11px">Historial: ${historyCount} efectivizaciones</div>`:''}</td>
      ${!isEmployee()?`<td title="${esc(u.name)} - ${esc(userSede(u))}"><div class="referral-owner">${avatar(u,24,9)}<span class="referral-owner-name">${esc(u.name)}</span><span style="color:var(--text3);font-size:11px">- ${esc(userSede(u))}</span></div></td>`:''}
      <td><span class="badge web">${r.bankLabel}</span></td>
      <td>S/ ${r.amount.toFixed(2)}</td>
      <td style="color:var(--green);font-weight:700">S/ ${r.referralCommission.toFixed(2)}</td>
      <td>${referralStatusHtml(r)}</td>
      <td>${fmtDateTime(r.createdAt)}</td>
      <td style="color:var(--text2);max-width:130px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${r.rejectedAt&&r.rejectionReason?r.rejectionReason:(r.notes||'-')}</td>
      <td class="referral-actions-cell"><div class="referral-actions">
        ${canValidateReferralLocal(r)?`<div class="inline-actions compact"><button class="pill-action success" data-ref-validate="${r.id}">Validar</button><button class="pill-action danger" data-ref-reject="${r.id}">Rechazar</button></div>`:''}
        <button class="action-btn" data-ref-repeat="${r.id}">Agregar efect.</button>
        ${canDeleteReferralLocal(r)?`<button class="action-btn danger" data-ref-delete="${r.id}">Eliminar</button>`:''}
      </div></td>
    </tr>`;
  });
  if(!rows.length) h+=`<tr><td colspan="${isEmployee()?'9':'10'}"><div class="empty-state"><div class="es-icon">-</div><p>Aun no hay referidos con esos filtros.</p></div></td></tr>`;
  h+=`</tbody></table></div>${renderPagination(page)}</div>`;
  return h;
}

function distributionSlices(items, keyFn, valueFn=()=>1){
  const totals={};
  items.forEach(item=>{
    const key=keyFn(item) || 'Otros';
    totals[key]=(totals[key]||0)+Number(valueFn(item)||0);
  });
  return Object.entries(totals).sort((a,b)=>b[1]-a[1]);
}
function percentFormatter(entries){
  const total=entries.reduce((sum, item)=>sum+Number(item[1]||0),0) || 1;
  return value=>`${((Number(value||0)/total)*100).toFixed(1)}%`;
}
function pieStyle(entries){
  const colors=['#22c97a','#4f8ef7','#f5a623','#f472b6','#a78bfa','#2dd4bf'];
  const total=entries.reduce((sum,item)=>sum+item[1],0)||1;
  let acc=0;
  const parts=entries.map((entry,index)=>{
    const start=(acc/total)*100;
    acc+=entry[1];
    const end=(acc/total)*100;
    return `${colors[index%colors.length]} ${start}% ${end}%`;
  });
  return `background:conic-gradient(${parts.join(',') || '#25314a 0 100%'});`;
}
function renderPieCard(title, entries, formatter=value=>String(value)){
  return `<div class="stat-card pie-card">
    <div class="stat-label">${title}</div>
    <div class="pie-wrap">
      <div class="pie-chart" style="${pieStyle(entries)}"></div>
      <div class="pie-legend">
        ${entries.length?entries.map(([label,value])=>`<div><span>${label}</span><strong>${formatter(value)}</strong></div>`).join(''):'<div><span>Sin datos</span><strong>-</strong></div>'}
      </div>
    </div>
  </div>`;
}
function renderSafetypayGoalCards(month){
  const sedes=(isAdmin() || canManageSafetypayPayments() || canPreviewAllSedesAsManager()) ? SEDES : [userSede(state.currentUser)];
  return `<div class="safetypay-goal-grid">${sedes.map(sede=>{
    const progress=safetypayProgress(getSafetypaySedeRows(sede, month), sede, month);
    const isSelected=state.safetypaySede===sede || (!isAdmin() && !canManageSafetypayPayments() && !canPreviewAllSedesAsManager() && userSede(state.currentUser)===sede);
    const clickable=isAdmin() || canManageSafetypayPayments() || canPreviewAllSedesAsManager();
    return `<div class="safetypay-goal-card compact${isSelected?' active':''}${clickable?' clickable':''}" ${clickable?`data-safetypay-goal="${sede}"`:''}>
      <div>
        <div class="stat-label">Meta ${sede} - ${monthLabelFromKey(month)}</div>
        <div class="goal-big">${money(progress.total)}</div>
        <div class="goal-target">Meta mensual: ${money(progress.goal)}</div>
        <div class="goal-message">${clickable?'Presiona para ver esta sede - ':''}${progress.message}</div>
      </div>
      <div class="goal-ring"><strong>${progress.pct.toFixed(1)}%</strong></div>
      <div class="goal-bar"><span style="width:${progress.pct}%"></span></div>
    </div>`;
  }).join('')}</div>`;
}
function safetypayAuditStatusLabel(status){
  return status==='VALID' ? 'Valido' : 'Observado';
}
function safetypayAuditExcelMoney(value){
  if(value==null || value==='') return '';
  return Number(value || 0).toFixed(2);
}
function downloadSafetypayAuditExcel(){
  const audit=SAFETYPAY_AUDIT;
  if(!audit){
    appAlert('Primero sube el Excel mensual para generar la auditoria.', 'Sin auditoria');
    return;
  }
  const summary=audit.summary || {};
  const month=audit.month || safetypayMonthKey();
  const generatedAt=fmtDateTime(new Date().toISOString());
  const details=(audit.details || []).slice().sort((a,b)=>{
    if(a.status!==b.status) return a.status==='OBSERVED' ? -1 : 1;
    return String(a.user?.name || '').localeCompare(String(b.user?.name || ''));
  });
  const excelOnly=(audit.excelOnly || []).slice();
  const statusClass=item=>item.status==='VALID'?'ok':'bad';
  const html=`<!doctype html><html><head><meta charset="utf-8">
    <style>
      body{font-family:Arial,sans-serif;color:#0f172a}
      h1{font-size:22px;margin:0 0 6px;color:#0f172a}
      h2{font-size:16px;margin:22px 0 8px;color:#1e3a8a}
      p{margin:0 0 12px;color:#475569}
      table{border-collapse:collapse;width:100%;margin-bottom:14px}
      th{background:#dbeafe;color:#1e3a8a;font-weight:700;text-align:left}
      th,td{border:1px solid #cbd5e1;padding:7px 9px;font-size:12px;vertical-align:top}
      .ok{color:#15803d;font-weight:700;background:#dcfce7}
      .bad{color:#b91c1c;font-weight:700;background:#fee2e2}
      .warn{color:#92400e;font-weight:700;background:#fef3c7}
      .num{text-align:right;mso-number-format:"0.00"}
      .text{mso-number-format:"\\@"}
    </style>
  </head><body>
    <h1>Auditoria mensual Safetypay</h1>
    <p>Archivo: ${esc(audit.fileName || '-')} | Mes: ${esc(monthLabelFromKey(month))} | Generado: ${esc(generatedAt)}</p>
    <h2>Resumen</h2>
    <table>
      <tr><th>Concepto</th><th>Cantidad</th></tr>
      <tr><td>Registros del sistema auditados</td><td class="num">${Number(summary.systemRows || details.length)}</td></tr>
      <tr><td>Filas encontradas en Excel</td><td class="num">${Number(summary.excelRows || 0)}</td></tr>
      <tr><td>Validos</td><td class="num ok">${Number(summary.valid || 0)}</td></tr>
      <tr><td>Observados</td><td class="num ${Number(summary.observed || 0)?'bad':'ok'}">${Number(summary.observed || 0)}</td></tr>
      <tr><td>Solo en Excel</td><td class="num ${Number(summary.excelOnly || 0)?'warn':'ok'}">${Number(summary.excelOnly || 0)}</td></tr>
    </table>
    <h2>Comparativo completo</h2>
    <table>
      <thead><tr>
        <th>#</th><th>Estado</th><th>Motivo</th><th>Codigo cliente sistema</th><th>ID operacion Excel</th><th>ID transaccion Excel</th>
        <th>Monto sistema</th><th>Importe venta Excel</th><th>Diferencia</th><th>Operacion sistema</th>
        <th>DNI cliente</th><th>Banco</th><th>Colaborador</th><th>Sede</th><th>Fecha sistema</th><th>Fila Excel</th>
      </tr></thead>
      <tbody>
        ${details.map((item,index)=>{
          const systemAmount=Number(item.amount || 0);
          const excelAmount=item.excelAmount==null ? null : Number(item.excelAmount || 0);
          const diff=excelAmount==null ? '' : (systemAmount-excelAmount).toFixed(2);
          return `<tr>
            <td>${index+1}</td>
            <td class="${statusClass(item)}">${safetypayAuditStatusLabel(item.status)}</td>
            <td>${esc(item.reason || '-')}</td>
            <td class="text">${esc(item.customerCode || '-')}</td>
            <td class="text">${esc(item.excelOperationId || '-')}</td>
            <td class="text">${esc(item.excelTransactionId || '-')}</td>
            <td class="num">${safetypayAuditExcelMoney(systemAmount)}</td>
            <td class="num">${excelAmount==null?'':safetypayAuditExcelMoney(excelAmount)}</td>
            <td class="num ${diff && Number(diff)!==0?'bad':'ok'}">${diff}</td>
            <td class="text">${esc(item.operationNumber || '-')}</td>
            <td class="text">${esc(item.clientDni || '-')}</td>
            <td>${esc(item.bank || '-')}</td>
            <td>${esc(item.user?.name || '-')}</td>
            <td>${esc(item.sede || '-')}</td>
            <td>${esc(fmtDateTime(item.createdAt))}</td>
            <td>${item.excelRow || ''}</td>
          </tr>`;
        }).join('') || '<tr><td colspan="16">Sin codigos para auditar.</td></tr>'}
      </tbody>
    </table>
    <h2>Movimientos solo en Excel</h2>
    <table>
      <thead><tr><th>#</th><th>Fila Excel</th><th>ID de operacion</th><th>ID de transaccion</th><th>Importe de la venta</th><th>Estado Excel</th></tr></thead>
      <tbody>
        ${excelOnly.map((item,index)=>`<tr>
          <td>${index+1}</td>
          <td>${item.rowNumber || ''}</td>
          <td class="text">${esc(item.operationId || item.orderCode || '-')}</td>
          <td class="text">${esc(item.transactionId || '-')}</td>
          <td class="num">${safetypayAuditExcelMoney(item.amount || 0)}</td>
          <td>${esc(item.status || '-')}</td>
        </tr>`).join('') || '<tr><td colspan="6">No hay movimientos sueltos en Excel.</td></tr>'}
      </tbody>
    </table>
  </body></html>`;
  const blob=new Blob([html], { type:'application/vnd.ms-excel;charset=utf-8' });
  downloadBlobFile(`Auditoria_Safetypay_${month}.xls`, blob);
}
function renderSafetypayAuditPanel(month){
  if(!isAdmin()) return '';
  const audit=SAFETYPAY_AUDIT;
  const summary=audit?.summary || null;
  return `<div class="form-card" style="margin-bottom:1.25rem">
    <div class="table-header" style="padding:0;border:0;margin-bottom:12px">
      <div>
        <div class="page-title" style="font-size:16px">Auditoria mensual Safetypay</div>
        <div class="page-sub">Compara Codigo cliente (6 digitos) con Id. de operacion, y Monto con Importe de la venta del Excel.</div>
      </div>
      <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
        <input type="file" id="safetypayAuditFile" accept=".xlsx,.xls" style="display:none"/>
        <button class="btn-sm" id="safetypayAuditUpload">Subir Excel</button>
        ${audit?'<button class="btn-sm success" id="safetypayAuditDownload" type="button">Descargar Excel comparativo</button>':''}
        ${audit?'<button class="btn-cancel" id="safetypayAuditClear" type="button">Limpiar auditoria</button>':''}
      </div>
    </div>
    ${summary?`<div class="stat-grid" style="margin-bottom:12px">
      <div class="stat-card"><div class="stat-label">Archivo</div><div class="stat-value" style="font-size:18px">${esc(audit.fileName || '-')}</div><div class="stat-sub">Mes ${audit.month || month}</div></div>
      <div class="stat-card"><div class="stat-label">Validos</div><div class="stat-value green">${summary.valid}</div><div class="stat-sub">Codigo, ID e importe coinciden</div></div>
      <div class="stat-card"><div class="stat-label">Observados</div><div class="stat-value ${summary.observed?'red':'green'}">${summary.observed}</div><div class="stat-sub">Falta codigo, no aparece o importe distinto</div></div>
      <div class="stat-card"><div class="stat-label">Solo en Excel</div><div class="stat-value ${summary.excelOnly?'amber':'green'}">${summary.excelOnly}</div><div class="stat-sub">IDs de operacion no registrados aqui</div></div>
    </div>
    <div class="alert-banner" style="margin-bottom:12px"><div class="ab-icon">↓</div><div class="ab-text"><strong>Detalle completo listo para descargar.</strong> El Excel incluye todos los registros del sistema, los IDs del Excel, diferencias de monto, observaciones y movimientos que solo estan en el Excel.</div></div>
    `:`<div class="alert-banner" style="margin-bottom:0"><div class="ab-icon">i</div><div class="ab-text"><strong>Sin auditoria cargada.</strong> Sube el ReporteTransaccionesMP del mes para validar codigos e importes.</div></div>`}
  </div>`;
}
function renderCalificaciones(){
  const month=ratingMonthKey();
  if(!ratingsLoadedFor(month) && !RATINGS_LOADING){
    setTimeout(()=>loadRatings(true, false, month), 0);
  }
  const rows=getRatingRows();
  const page=paginateRows('ratings', rows);
  const validRows=rows.filter(row=>row.valid);
  const approvedRows=rows.filter(row=>row.payable);
  const pendingRows=rows.filter(row=>row.approvalStatus==='PENDING');
  const invalidRows=rows.filter(row=>!row.valid);
  const ratingUsers=getVisibleUsers().filter(user=>user.role!=='admin');
  const requiredFields=RATING_SETTINGS.requiredFields || ['dni'];
  const fieldLabels={ dni:'DNI', comment:'Comentario', advisor:'Asesor' };
  const ranking=distributionSlices(validRows, row=>row.matchedUserName || row.advisor, row=>1).slice(0,6);
  const starDist=distributionSlices(rows, row=>`${row.rating || '-'} estrella(s)`, row=>1);

  let h=`<div class="page-header"><div class="page-title">Calificaciones</div><div class="page-sub">${isEmployee()?`Tus calificaciones validas suman ${money(getRatingCommission())} cada una`:'Calificaciones del formulario conectadas por asesor y sede'}</div></div>`;
  if(RATINGS_LOADING && !ratingsLoadedFor(month)){
    return h + `<div class="table-wrap"><div class="empty-state"><div class="section-spinner" role="status" aria-label="Cargando"></div><p>Cargando calificaciones...</p></div></div>`;
  }
  if(RATINGS_ERROR){
    h+=`<div class="alert-banner"><div class="ab-icon">!</div><div class="ab-text"><strong>No se pudo cargar calificaciones.</strong> ${esc(RATINGS_ERROR)}</div></div>`;
  }
  h+=`<div class="stat-grid">
    <div class="stat-card"><div class="stat-label">Calificaciones visibles</div><div class="stat-value">${rows.length}</div></div>
    <div class="stat-card"><div class="stat-label">Pendientes aprobacion</div><div class="stat-value amber">${pendingRows.length}</div></div>
    <div class="stat-card"><div class="stat-label">Aprobadas</div><div class="stat-value green">${approvedRows.length}</div></div>
    <div class="stat-card"><div class="stat-label">Ganancia aprobada</div><div class="stat-value green">${money(approvedRows.reduce((total,row)=>total+Number(row.amount||0),0))}</div></div>
  </div>`;
  h+=`<div class="stat-grid">${renderPieCard('Ranking por calificaciones aprobadas', distributionSlices(approvedRows, row=>row.matchedUserName || row.advisor, row=>1).slice(0,6), value=>`${value} calif.`)}${renderPieCard('Distribucion de estrellas', starDist, value=>`${value} respuesta(s)`)}</div>`;
  h+=`<div class="table-wrap"><div class="table-header">
    <div class="table-title">Calificaciones (${rows.length})</div>
    <input class="search-input" id="ratingSearch" placeholder="Asesor, DNI, comentario..." value="${esc(state.ratingSearch)}" style="width:230px"/>
    ${(isAdmin()||isManager())?`<select class="filter-select" id="ratingUser"><option value="">${isAdmin()?'Todo el equipo':'Toda tu sede'}</option>${ratingUsers.map(user=>`<option value="${user.id}"${state.ratingUser==user.id?' selected':''}>${esc(user.name)}</option>`).join('')}</select>`:''}
    <select class="filter-select" id="ratingStars"><option value="">Todas las estrellas</option>${[1,2,3,4,5].map(stars=>`<option value="${stars}"${Number(state.ratingStars)===stars?' selected':''}>${'★'.repeat(stars)} ${stars} estrella${stars===1?'':'s'}</option>`).join('')}</select>
    <select class="filter-select" id="ratingStatus"><option value="">Todo estado</option><option value="pending"${state.ratingStatus==='pending'?' selected':''}>Pendientes</option><option value="approved"${state.ratingStatus==='approved'?' selected':''}>Aprobadas</option><option value="rejected"${state.ratingStatus==='rejected'?' selected':''}>Rechazadas</option><option value="invalid"${state.ratingStatus==='invalid'?' selected':''}>No validas</option></select>
    ${periodFilterHtml()}
    ${monthFilterSelectHtml('ratingMonth', month, { includeEmpty:false, count:24, extraValues: rows.map(row=>row.date || row.rawDate), showRecent:true })}
    <button class="btn-sm" id="refreshRatingsBtn">Actualizar</button>
  </div><table><thead><tr><th>Fecha</th><th>Asesor</th><th>Sede</th><th>Estrellas</th><th>DNI</th><th>Comentario</th><th>Estado</th><th>Ganancia</th></tr></thead><tbody>`;
  page.rows.forEach(row=>{
    const autoRejectedMissingDni=row.approvalStatus==='REJECTED' && row.missingFields?.includes('dni');
    const missing=row.missingFields?.length ? `Falta ${row.missingFields.map(field=>fieldLabels[field]||field).join(', ')}` : (!row.matchedUserId?'Sin colaborador vinculado':row.rating<4?'Menos de 4 estrellas':'No valida');
    const lowStarRating=Number(row.rating)<4;
    const statusLabel=row.duplicateOfRowNumber ? `Duplicada de fila ${row.duplicateOfRowNumber}` : autoRejectedMissingDni ? 'Rechazada: falta DNI' : lowStarRating ? 'Nula: menos de 4 estrellas' : !row.valid ? missing : row.approvalStatus==='APPROVED' ? 'Aprobada' : row.approvalStatus==='REJECTED' ? 'Rechazada' : 'Pendiente';
    const statusClass=autoRejectedMissingDni || lowStarRating ? 'danger' : !row.valid ? 'warn' : row.approvalStatus==='APPROVED' ? 'ok' : row.approvalStatus==='REJECTED' ? 'danger' : 'warn';
    const canManageRating=(isAdmin() || isManager()) && canEditMonth(monthKeyFromDate(row.approvedAt || row.date || row.rawDate));
    const ratingActions=(canManageRating && row.valid ? `
      <div class="inline-actions compact" style="margin-top:6px">
        <button class="pill-action" data-rating-edit="${encodeURIComponent(row.rowKey)}">Editar</button>
        ${row.approvalStatus!=='APPROVED'?`<button class="pill-action success" data-rating-approve="${encodeURIComponent(row.rowKey)}">Aprobar</button>`:''}
        ${row.approvalStatus!=='REJECTED'?`<button class="pill-action danger" data-rating-reject="${encodeURIComponent(row.rowKey)}">Rechazar</button>`:''}
        ${row.approvalStatus!=='PENDING'?`<button class="pill-action ghost" data-rating-pending="${encodeURIComponent(row.rowKey)}">Volver pendiente</button>`:''}
      </div>` : '') + (isAdmin()?`<button class="pill-action danger" data-rating-delete="${encodeURIComponent(row.rowKey)}">Eliminar</button>`:'');
    h+=`<tr>
      <td>${fmtDateTime(row.date || row.rawDate)}</td>
      <td><div style="display:flex;align-items:center;gap:8px">${avatar({name:row.matchedUserName || row.advisor, color:row.matchedUserColor || '#4f8ef7'},26,9)}<div><strong>${esc(row.matchedUserName || row.advisor || '-')}</strong><div style="font-size:11px;color:var(--text3)">Hoja: ${esc(row.advisor || '-')}</div></div></div></td>
      <td>${esc(row.sede || '-')}</td>
      <td><span class="rating-stars">${ratingStarsHtml(row.rating)}</span></td>
      <td>${esc(row.dni || '-')}</td>
      <td style="max-width:260px;white-space:normal;color:var(--text2)">${esc(row.comment || '-')}</td>
      <td><span class="days-chip ${statusClass}">${esc(statusLabel)}</span>${row.decisionReason?`<div style="font-size:11px;color:var(--text3);margin-top:4px">${esc(row.decisionReason)}</div>`:''}${ratingActions}</td>
      <td style="font-weight:800;color:${row.payable?'var(--green)':'var(--text2)'}">${money(row.amount)}</td>
    </tr>`;
  });
  if(!rows.length) h+=`<tr><td colspan="8"><div class="empty-state"><div class="es-icon">-</div><p>No hay calificaciones con esos filtros.</p></div></td></tr>`;
  h+=`</tbody></table>${renderPagination(page)}</div>`;
  return h;
}
function renderSafetypay(){
  if(ensureStateModulesLoaded(['safetypayCodes'])) return `<div class="page-header"><div class="page-title">Safetypay</div><div class="page-sub">Cargando codigos y avance mensual...</div></div><div class="table-wrap"><div class="empty-state"><div class="section-spinner" role="status" aria-label="Cargando"></div><p>Preparando Safetypay...</p></div></div>`;
  const month=safetypayMonthKey();
  const cmrSummaryKey=`${getSessionScopeKey()}|${month}`;
  if(isAdmin() && SAFETYPAY_CMR_SUMMARY_KEY!==cmrSummaryKey && !SAFETYPAY_CMR_SUMMARY_LOADING) setTimeout(()=>loadSafetypayCmrSummary(month), 0);
  const currentSedeLabel=(isAdmin() || canPreviewAllSedesAsManager()) ? (state.safetypaySede || 'Todas las sedes') : userSede(state.currentUser);
  const rows=safetypayVisibleRows(month);
  const canCreateSafetypay=canCreateSafetypayCodes() && canEditMonth(month);
  const canEditSafetypay=canEditSafetypayCodes() && canEditMonth(month);
  const canDeleteSafetypay=isAdmin();
  const hasActionColumn=canEditSafetypay || canDeleteSafetypay;
  const isEditingSafetypay=Number.isFinite(Number(SAFETYPAY_EDIT_ID)) && Number(SAFETYPAY_EDIT_ID)>0;
  const page=paginateRows('safetypay', rows);
  const duplicateIds=getSafetypayDuplicateIds(rows);
  const duplicateCount=duplicateIds.size;
  const selectedSedeForSummary=(isAdmin() || canManageSafetypayPayments() || canPreviewAllSedesAsManager()) ? (state.safetypaySede || state.managerViewSede || '') : userSede(state.currentUser);
  const progressRows=selectedSedeForSummary ? getSafetypaySedeRows(selectedSedeForSummary, month) : [];
  const progress=selectedSedeForSummary ? safetypayProgress(progressRows, selectedSedeForSummary, month) : null;
  const sharedBonusReady=progress ? progress.pct>=getSafetypaySharedThreshold()*100 : false;
  const managerBonusReady=progress ? progress.pct>=100 : false;
  const canViewManagerBonusCard=isAdmin() || isManager();
  const ranking=distributionSlices(rows, entry=>entry.user?.name || getUserById(entry.userId).name, entry=>1).slice(0,6);
  const bankDist=distributionSlices(rows, entry=>entry.bank, entry=>entry.amount);
  const codeDist=isAdmin() ? distributionSlices(rows, entry=>entry.code, entry=>entry.amount) : distributionSlices(rows, entry=>entry.code, entry=>1);
  const totalRowsAmount=rows.reduce((sum, entry)=>sum+Number(entry.amount||0),0);
  const safetypayGoals=getSafetypaySedeGoals(month);
  const cmrSummary=SAFETYPAY_CMR_SUMMARY_KEY===cmrSummaryKey ? SAFETYPAY_CMR_SUMMARY : null;
  const cmrComparison=(()=>{
    if(!cmrSummary) return SAFETYPAY_CMR_SUMMARY_LOADING ? 'Calculando comparación mensual...' : 'Sin comparación disponible.';
    const difference=Number(cmrSummary.difference||0);
    const cls=difference>0?'up':difference<0?'down':'equal';
    const arrow=difference>0?'↑':difference<0?'↓':'→';
    const percent=cmrSummary.percent===null || cmrSummary.percent===undefined ? (difference?'Sin base previa':'0.0%') : `${difference>0?'+':''}${Number(cmrSummary.percent).toFixed(1)}%`;
    return `<strong class="${cls}">${arrow} ${difference>0?'+':''}${money(difference)} (${percent})</strong> frente a ${monthLabelFromKey(cmrSummary.priorMonth)}`;
  })();
  let h=`<div class="page-header"><div class="page-title">Safetypay</div><div class="page-sub">Registro de codigos CMR / IBK / IO y avance mensual con meta individual por sede.</div></div>
  ${isAdmin()?`<div class="safetypay-admin-overview"><section class="safetypay-settings-card"><div><h3>Metas por sede</h3><p>Configura las metas de ${esc(monthLabelFromKey(month))} desde Ajustes, sin recargar esta pantalla de controles.</p></div><button class="btn-sm" id="openSafetypayGoalSettings" type="button">⚙ Ajustes de metas</button></section><button class="safetypay-cmr-card" data-safetypay-cmr-total type="button" title="Ver códigos CMR e IO"><img class="safetypay-cmr-logo" src="/brands/safetypay.png" alt="SafetyPay" width="160" height="54"/><div class="safetypay-cmr-title">Total SafetyPay · todas las sedes</div><div class="safetypay-cmr-total">${cmrSummary?money(cmrSummary.currentTotal):'—'}</div><div class="safetypay-cmr-comparison">${cmrComparison}</div></button></div>`:''}
  ${renderSafetypayGoalCards(month)}
  ${renderSafetypayAuditPanel(month)}
  <div class="stat-grid">
    <div class="stat-card"><div class="stat-label">Codigos visibles</div><div class="stat-value">${rows.length}</div><div class="stat-sub">${money(totalRowsAmount)} en monto registrado</div></div>
    <button class="stat-card" type="button" data-safetypay-duplicates style="text-align:left;cursor:${duplicateCount?'pointer':'default'}" ${duplicateCount?'title="Ver solo duplicados"':''}><div class="stat-label">Duplicados de riesgo</div><div class="stat-value ${duplicateCount?'red':'green'}">${duplicateCount}</div><div class="stat-sub">${duplicateCount?(state.safetypayDuplicatesOnly?'Mostrando solo duplicados':'Presiona para ver los duplicados'):'Sin duplicados detectados'}</div></button>
    <div class="stat-card"><div class="stat-label">Sede en detalle</div><div class="stat-value ${selectedSedeForSummary?'green':'amber'}">${selectedSedeForSummary || 'Elige arriba'}</div><div class="stat-sub">${selectedSedeForSummary?`Resumen de ${selectedSedeForSummary}`:'Toca una tarjeta grande para ver una sede'}</div></div>
    <div class="stat-card"><div class="stat-label">Bono sede 80%</div><div class="stat-value ${selectedSedeForSummary?(sharedBonusReady?'green':'amber'):'amber'}">${selectedSedeForSummary?(sharedBonusReady?'Meta lograda':'En progreso'):'Sin sede'}</div><div class="stat-sub">${selectedSedeForSummary?(progress?.message || 'Sin avance'):'Selecciona una sede para ver su avance real'}</div></div>
    ${canViewManagerBonusCard?`<div class="stat-card"><div class="stat-label">Bono jefe 100%</div><div class="stat-value ${selectedSedeForSummary?(managerBonusReady?'green':'amber'):'amber'}">${selectedSedeForSummary?(managerBonusReady?money(getSafetypayManagerBonus()):'Pendiente'):'Sin sede'}</div><div class="stat-sub">${selectedSedeForSummary?'Se aplica automatico al jefe de sede':'Primero elige la sede a revisar'}</div></div>`:''}
  </div>`;
  if(duplicateCount){
    h+=`<div class="alert-banner" style="margin-bottom:1.1rem"><div class="ab-icon">!</div><div class="ab-text"><strong>Duplicidad detectada.</strong> Hay ${duplicateCount} codigo(s) Safetypay con el mismo codigo cliente el mismo dia o el mismo numero de operacion. Revisa las filas en rojo antes de pagar.</div></div>`;
  }
  h+=canCreateSafetypay?`<div class="form-card" style="margin-bottom:1.25rem">
    <div class="page-title" style="font-size:16px;margin-bottom:1rem">Subir codigo Safetypay</div>
    <div class="form-grid">
      <div class="form-group"><label class="form-label">DNI del cliente</label><input class="form-input" id="spDni" placeholder="DNI del cliente" inputmode="numeric" value="${esc(SAFETYPAY_DRAFT.clientDni)}"/></div>
      <div class="form-group"><label class="form-label">Nro tarjeta (4 -ltimos digitos)</label><input class="form-input" id="spCard" placeholder="1234" maxlength="4" inputmode="numeric" value="${esc(SAFETYPAY_DRAFT.cardLast4)}"/></div>
      <div class="form-group"><label class="form-label">Codigo cliente (6 digitos)</label><input class="form-input" id="spCustomerCode" placeholder="595259" maxlength="6" inputmode="numeric" value="${esc(SAFETYPAY_DRAFT.customerCode)}"/></div>
      <div class="form-group"><label class="form-label">Banco</label><select class="form-select" id="spBank">${SAFETYPAY_BANKS.map(bank=>`<option value="${bank}"${SAFETYPAY_DRAFT.bank===bank?' selected':''}>${bank}</option>`).join('')}</select></div>
      <div class="form-group"><label class="form-label">Codigo</label><select class="form-select" id="spCode">${SAFETYPAY_CODE_OPTIONS.map(code=>`<option value="${code}"${SAFETYPAY_DRAFT.code===code?' selected':''}>${code}</option>`).join('')}</select></div>
      <div class="form-group"><label class="form-label">Monto</label><input class="form-input" id="spAmount" type="number" min="1" step="0.01" placeholder="Monto en soles" value="${esc(SAFETYPAY_DRAFT.amount)}"/></div>
      <div class="form-group"><label class="form-label">Nro operacion</label><input class="form-input" id="spOperation" placeholder="Numero de operacion" value="${esc(SAFETYPAY_DRAFT.operationNumber)}"/></div>
    </div>
    <div class="modal-actions" style="justify-content:flex-start;margin-top:1rem">
      <button class="submit-btn" id="saveSafetypayBtn" style="margin-top:0">Guardar codigo</button>
    </div>
  </div>`:`<div class="alert-banner"><div class="ab-icon">!</div><div class="ab-text"><strong>No tienes permiso para registrar codigos.</strong> Aqui puedes revisar el avance y los codigos visibles de tu sede.</div></div>`;
  h+=`<div class="stat-grid">${
    isAdmin()
      ? `${renderPieCard('Bancos por monto', bankDist, money)}${renderPieCard('Codigos por monto', codeDist, money)}${renderPieCard('Ranking por cantidad', ranking, value=>`${value} codigo(s)`)}`
      : `${renderPieCard('Bancos por monto', bankDist, percentFormatter(bankDist))}${renderPieCard('Colaboradores por codigos', ranking, percentFormatter(ranking))}${renderPieCard('Codigos por cantidad', codeDist, percentFormatter(codeDist))}`
  }</div>`;
  h+=`<div class="table-wrap"><div class="table-header">
    <div class="table-title">${state.safetypayDuplicatesOnly?'Duplicados Safetypay':state.safetypayCmrTotalOnly?'Codigos CMR + IO · todas las sedes':'Codigos Safetypay'} (${rows.length})</div>
    <input class="search-input" id="safetypaySearch" placeholder="DNI, tarjeta, operacion..." value="${state.safetypaySearch}" style="width:220px"/>
    ${(isAdmin()||isManager())?`<select class="filter-select" id="safetypaySede">${(isAdmin()||canPreviewAllSedesAsManager())?`<option value=""${!state.safetypaySede?' selected':''}>Todas las sedes</option>`:''}${((isAdmin()||canPreviewAllSedesAsManager())?SEDES:[userSede(state.currentUser)]).map(s=>`<option value="${s}"${currentSedeLabel===s?' selected':''}>${s}</option>`).join('')}</select>`:''}
    ${periodFilterHtml()}
    ${monthFilterSelectHtml('safetypayMonth', month, { extraValues: rows.map(row=>row.createdAt) })}
    ${(isAdmin()||isManager()||canManageSafetypayPayments())?'<button class="btn-sm success" id="downloadSafetypayPaymentExcel" type="button">Descargar Excel</button>':''}
    ${state.safetypayDuplicatesOnly?'<button class="btn-sm" id="clearSafetypayDuplicates" type="button">Ver todos</button>':''}
    ${state.safetypayCmrTotalOnly?'<button class="btn-sm" id="clearSafetypayCmrTotal" type="button">Ver todos los códigos</button>':''}
  </div>${state.safetypayCmrTotalOnly?'<div class="table-header" style="border-top:1px solid var(--border);font-size:12px;color:var(--text2)">Los códigos del admin se muestran para auditoría como <strong>Sin sede (no computa)</strong>; no forman parte del total SafetyPay, metas ni bonos.</div>':''}<table><thead><tr><th>Cliente</th><th>Codigo cliente</th><th>Tarjeta</th><th>Banco</th><th>Codigo</th><th>Monto</th><th>Operacion</th><th>Colaborador</th><th>Fecha</th>${hasActionColumn?'<th>Acciones</th>':''}</tr></thead><tbody>`;
  page.rows.forEach(entry=>{
    const owner=entry.user || getUserById(entry.userId);
    const isDuplicate=duplicateIds.has(Number(entry.id));
    h+=`<tr${isDuplicate?' style="background:rgba(239,68,68,0.10)"':''}>
      <td><strong>DNI ${entry.clientDni}</strong></td>
      <td><strong>${entry.customerCode || '-'}</strong></td>
      <td>---- ${entry.cardLast4}</td>
      <td><span class="badge ${isDuplicate?'danger':'web'}">${entry.bank}</span></td>
      <td><span class="badge ${isDuplicate?'danger':'drive'}">${entry.code}</span></td>
      <td style="color:${isDuplicate?'var(--red)':'var(--green)'};font-weight:800">${money(entry.amount)}</td>
      <td><strong style="color:${isDuplicate?'var(--red)':'var(--text)'}">${entry.operationNumber}</strong>${isDuplicate?'<div style="font-size:11px;color:var(--red);font-weight:700;margin-top:3px">Duplicado: mismo codigo el mismo dia u operacion</div>':''}</td>
      <td><div style="display:flex;align-items:center;gap:6px">${avatar(owner,24,9)}${owner.name}<span style="color:var(--text3);font-size:11px">- ${isAdminSafetypayEntry(entry)?'Sin sede (no computa)':userSede(owner)}</span></div></td>
      <td>${fmtDateTime(entry.createdAt)}</td>
      ${hasActionColumn?`<td class="actions-cell"><div class="inline-actions compact">${canEditSafetypay?`<button class="pill-action" data-safetypay-edit="${entry.id}">Editar</button>`:''}${canDeleteSafetypay?`<button class="pill-action danger" data-safetypay-delete="${entry.id}">Eliminar</button>`:''}</div></td>`:''}
    </tr>`;
  });
  if(!rows.length) h+=`<tr><td colspan="${hasActionColumn?10:9}"><div class="empty-state"><div class="es-icon">-</div><p>No hay codigos Safetypay con esos filtros.</p></div></td></tr>`;
  h+=`</tbody></table>${renderPagination(page)}</div>`;
  return h;
}

function getWrongCardRows(){
  const month=activeMonthKey(state.wrongCardMonth);
  let rows=[...WRONG_CARDS];
  rows=rows.filter(r=>monthKeyFromDate(r.detectedDate || r.validatedAt || r.createdAt)===month);
  rows=rows.filter(r=>dateMatchesQuickPeriod(r.detectedDate || r.createdAt));
  if(state.wrongCardSearch){
    const q=state.wrongCardSearch.toLowerCase();
    rows=rows.filter(r=>r.cliente.toLowerCase().includes(q)||r.dni.toLowerCase().includes(q)||getItemOwner(r).name.toLowerCase().includes(q));
  }
  if(state.wrongCardStatus){
    rows=rows.filter(r=>state.wrongCardStatus==='pending'?r.status==='PENDING':state.wrongCardStatus==='approved'?r.status==='APPROVED':state.wrongCardStatus==='rejected'?r.status==='REJECTED':true);
  }
  return rows.sort((a,b)=>String(b.createdAt||'').localeCompare(String(a.createdAt||'')));
}
function canValidateWrongCardLocal(report){
  if(report.status!=='PENDING') return false;
  if(!canEditMonth(monthKeyFromDate(report.detectedDate || report.validatedAt || report.createdAt))) return false;
  if(isAdmin()) return true;
  if(canPreviewAllSedesAsManager()) return false;
  if(isPaymentsSupervisor()) return isPaymentsTeamMember(getItemOwner(report));
  if(isPaymentsTeamMember(getItemOwner(report))) return false;
  return isManager() && getItemSede(report)===userSede(state.currentUser);
}
function callStatusMeta(report){
  if(report.status==='APPROVED' || report.validatedAt) return { cls:'ok', label:`Aprobada ${fmt(report.validatedAt)}` };
  if(report.status==='REJECTED' || report.rejectedAt) return { cls:'danger', label:'Rechazada' };
  return { cls:'warn', label:'Pendiente' };
}
function getCallRows(){
  const month=activeMonthKey(state.callMonth);
  let rows=[...CALL_REPORTS];
  rows=rows.filter(report=>monthKeyFromDate(report.validatedAt || report.createdAt)===month);
  rows=rows.filter(report=>dateMatchesQuickPeriod(report.createdAt));
  if(isEmployee()) rows=rows.filter(report=>Number(report.userId)===Number(state.currentUser.id));
  if(state.callSearch){
    const q=state.callSearch.toLowerCase();
    rows=rows.filter(report=>
      report.cliente.toLowerCase().includes(q) ||
      report.dni.toLowerCase().includes(q) ||
      getItemOwner(report).name.toLowerCase().includes(q)
    );
  }
  if(state.callStatus){
    rows=rows.filter(report=>state.callStatus==='pending'?report.status==='PENDING':state.callStatus==='approved'?report.status==='APPROVED':state.callStatus==='rejected'?report.status==='REJECTED':true);
  }
  return rows.sort((a,b)=>String(b.createdAt||'').localeCompare(String(a.createdAt||'')));
}
function canValidateCallLocal(report){
  if(report.status!=='PENDING') return false;
  if(!canEditMonth(monthKeyFromDate(report.validatedAt || report.createdAt))) return false;
  const owner=report.user || getUserById(report.userId);
  if(isAdmin()) return true;
  if(canPreviewAllSedesAsManager()) return false;
  if(isPaymentsSupervisor()) return isPaymentsTeamMember(owner);
  if(isPaymentsTeamMember(owner)) return false;
  return isManager() && userSede(owner)===userSede(state.currentUser);
}
function renderLlamadas(){
  const rows=getCallRows();
  const page=paginateRows('calls', rows);
  const approvedTotal=rows.filter(report=>report.status==='APPROVED').reduce((sum, report)=>sum+Number(report.bonusAmount||getCallCommission()),0);
  let h=`<div class="page-header"><div class="page-title">Llamadas</div><div class="page-sub">Registra llamadas contestadas. Si el jefe lo aprueba, suma ${money(getCallCommission())} al colaborador.</div></div>
  <div class="stat-grid">
    <div class="stat-card"><div class="stat-label">Pendientes</div><div class="stat-value amber">${rows.filter(report=>report.status==='PENDING').length}</div><div class="stat-sub">Esperando revision</div></div>
    <div class="stat-card"><div class="stat-label">Aprobadas</div><div class="stat-value green">${rows.filter(report=>report.status==='APPROVED').length}</div><div class="stat-sub">${money(approvedTotal)} acumulado</div></div>
    <div class="stat-card"><div class="stat-label">Rechazadas</div><div class="stat-value red">${rows.filter(report=>report.status==='REJECTED').length}</div><div class="stat-sub">Con motivo</div></div>
  </div>`;
  h+=`<div class="form-card" style="max-width:760px;margin-bottom:1.5rem">
    <div class="page-title" style="font-size:16px;margin-bottom:1rem">Registrar llamada</div>
    <div class="form-grid">
      <div class="form-group"><label class="form-label">DNI del cliente</label><input class="form-input" id="callDni" value="${esc(CALL_DRAFT.clientDni)}" placeholder="DNI del cliente" inputmode="numeric"/></div>
      <div class="form-group"><label class="form-label">Nombre del cliente</label><input class="form-input" id="callName" value="${esc(CALL_DRAFT.clientName)}" placeholder="Nombre del cliente"/></div>
    </div>
    <button class="submit-btn" id="saveCallBtn">Guardar llamada</button>
  </div>`;
  h+=`<div class="table-wrap"><div class="table-header">
    <div class="table-title">Llamadas registradas (${rows.length})</div>
    <input class="search-input" id="callSearch" placeholder="DNI, cliente o usuario..." value="${esc(state.callSearch)}" style="width:220px"/>
    <select class="filter-select" id="callStatus"><option value="">Todo estado</option><option value="pending"${state.callStatus==='pending'?' selected':''}>Pendientes</option><option value="approved"${state.callStatus==='approved'?' selected':''}>Aprobadas</option><option value="rejected"${state.callStatus==='rejected'?' selected':''}>Rechazadas</option></select>
    ${periodFilterHtml()}
    ${monthFilterSelectHtml('callMonth', activeMonthKey(state.callMonth), { includeEmpty:false, count:24, extraValues: rows.map(row=>row.createdAt || row.validatedAt) })}
  </div><table><thead><tr><th>Cliente</th><th>DNI</th><th>Registrado por</th><th>Fecha</th><th>Comision</th><th>Estado</th><th></th></tr></thead><tbody>`;
  page.rows.forEach(report=>{
    const owner=report.user || getUserById(report.userId);
    const status=callStatusMeta(report);
    h+=`<tr>
      <td><strong>${esc(report.cliente)}</strong></td>
      <td><span style="font-family:var(--font2);font-weight:700">${esc(report.dni)}</span></td>
      <td><div style="display:flex;align-items:center;gap:6px">${avatar(owner,24,9)}${esc(owner.name)}<span style="color:var(--text3);font-size:11px">- ${userSede(owner)}</span></div></td>
      <td>${fmtDateTime(report.createdAt)}</td>
      <td style="color:${report.status==='APPROVED'?'var(--green)':'var(--text2)'};font-weight:800">${report.status==='APPROVED'?money(report.bonusAmount):'Pendiente'}</td>
      <td><span class="days-chip ${status.cls}">${status.label}</span>${report.rejectionReason?`<div style="font-size:11px;color:var(--red);margin-top:4px">${esc(report.rejectionReason)}</div>`:''}</td>
      <td>${canValidateCallLocal(report)?`<div class="inline-actions compact"><button class="pill-action success" data-call-validate="${report.id}">Aprobar</button><button class="pill-action danger" data-call-reject="${report.id}">Rechazar</button></div>`:'Bloqueado'}</td>
    </tr>`;
  });
  if(!rows.length) h+=`<tr><td colspan="7"><div class="empty-state"><div class="es-icon">-</div><p>No hay llamadas con esos filtros.</p></div></td></tr>`;
  h+=`</tbody></table>${renderPagination(page)}</div>`;
  return h;
}
function renderTarjetasErroneas(){
  const rows=getWrongCardRows();
  const page=paginateRows('wrongCards', rows);
  const approvedTotal=rows.filter(r=>r.status==='APPROVED').reduce((sum,r)=>sum+Number(r.bonusAmount||getWrongCardBonus()),0);
  const today=todayStr();
  let h=`<div class="page-header"><div class="page-title">Tarjetas erroneas</div><div class="page-sub">Registro de tarjetas de terceros detectadas. Si el jefe lo aprueba, suma S/ 10 al sueldo.</div></div>
  <div class="stat-grid">
    <div class="stat-card"><div class="stat-label">Pendientes</div><div class="stat-value amber">${rows.filter(r=>r.status==='PENDING').length}</div><div class="stat-sub">Esperando revision</div></div>
    <div class="stat-card"><div class="stat-label">Aprobadas</div><div class="stat-value green">${rows.filter(r=>r.status==='APPROVED').length}</div><div class="stat-sub">${money(approvedTotal)} en bonos</div></div>
    <div class="stat-card"><div class="stat-label">Rechazadas</div><div class="stat-value red">${rows.filter(r=>r.status==='REJECTED').length}</div><div class="stat-sub">Con motivo</div></div>
  </div>`;
  h+=`<div class="form-card" style="max-width:780px;margin-bottom:1.5rem">
    <div class="page-title" style="font-size:16px;margin-bottom:1rem">Subir tarjeta de terceros</div>
    <div class="form-grid">
      <div class="form-group"><label class="form-label">DNI del cliente</label><input class="form-input" id="wcDni" placeholder="DNI del cliente" inputmode="numeric"/></div>
      <div class="form-group"><label class="form-label">Nombre del cliente</label><input class="form-input" id="wcName" placeholder="Nombre del cliente"/></div>
      <div class="form-group"><label class="form-label">Fecha detectada</label><input class="form-input" id="wcDate" type="date" value="${today}"/></div>
      <div class="form-group"><label class="form-label">Tipo</label><input class="form-input" value="Tarjeta de terceros" disabled/></div>
      <div class="form-group full"><label class="form-label">Notas</label><input class="form-input" id="wcNotes" placeholder="Opcional: contexto, donde se detecto, evidencia..."/></div>
    </div>
    <button class="submit-btn" id="saveWrongCardBtn">Guardar tarjeta</button>
  </div>`;
  h+=`<div class="table-wrap"><div class="table-header">
    <div class="table-title">Tarjetas reportadas (${rows.length})</div>
    <input class="search-input" id="wrongCardSearch" placeholder="DNI, cliente o usuario..." value="${state.wrongCardSearch}" style="width:220px"/>
    <select class="filter-select" id="wrongCardStatus"><option value="">Todo estado</option><option value="pending"${state.wrongCardStatus==='pending'?' selected':''}>Pendientes</option><option value="approved"${state.wrongCardStatus==='approved'?' selected':''}>Aprobadas</option><option value="rejected"${state.wrongCardStatus==='rejected'?' selected':''}>Rechazadas</option></select>
    ${periodFilterHtml()}
    ${monthFilterSelectHtml('wrongCardMonth', activeMonthKey(state.wrongCardMonth), { includeEmpty:false, count:24, extraValues: rows.map(row=>row.detectedDate || row.createdAt) })}
  </div><table><thead><tr><th>Cliente</th><th>DNI</th><th>Detectado por</th><th>Fecha detectada</th><th>Bono</th><th>Estado</th><th>Notas</th><th></th></tr></thead><tbody>`;
  page.rows.forEach(report=>{
    const owner=getItemOwner(report);
    const status=wrongCardStatusMeta(report);
    h+=`<tr>
      <td>${report.cliente}</td>
      <td><span style="font-family:var(--font2);font-weight:700">${report.dni}</span></td>
      <td><div style="display:flex;align-items:center;gap:6px">${avatar(owner,24,9)}${owner.name}<span style="color:var(--text3);font-size:11px">- ${userSede(owner)}</span></div></td>
      <td>${fmt(report.detectedDate)}</td>
      <td style="color:var(--green);font-weight:800">${money(report.bonusAmount)}</td>
      <td><span class="days-chip ${status.cls}">${status.label}</span>${report.rejectionReason?`<div style="font-size:11px;color:var(--red);margin-top:4px">${report.rejectionReason}</div>`:''}</td>
      <td style="color:var(--text2);max-width:170px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${report.notes||'-'}</td>
      <td>${canValidateWrongCardLocal(report)?`<div class="inline-actions compact"><button class="pill-action success" data-wc-validate="${report.id}">Aprobar</button><button class="pill-action danger" data-wc-reject="${report.id}">Rechazar</button></div>`:'Bloqueado'}</td>
    </tr>`;
  });
  if(!rows.length) h+=`<tr><td colspan="8"><div class="empty-state"><div class="es-icon">-</div><p>No hay tarjetas con esos filtros.</p></div></td></tr>`;
  h+=`</tbody></table>${renderPagination(page)}</div>`;
  return h;
}

function renderNuevo(){
  const today=new Date().toISOString().split('T')[0];
  return `<div class="form-card">
    <div class="form-grid">
      <div class="form-group"><label class="form-label">Nombre del Cliente *</label><input class="form-input" id="nc" placeholder="Nombre completo"/></div>
      <div class="form-group"><label class="form-label">DNI del Cliente *</label><input class="form-input" id="nd" placeholder="12345678" maxlength="15"/></div>
      <div class="form-group"><label class="form-label">Fecha de Registro *</label><input class="form-input" id="nf" type="date" value="${today}"/></div>
      <div class="form-group"><label class="form-label">Tipo *</label>
        <select class="form-select" id="nt">
          <option value="registro">Registro (pendiente de operacion)</option>
          <option value="operacion">Operacion (ya efectivizo)</option>
        </select>
      </div>
      <div class="form-group"><label class="form-label">Fecha de Operacion</label><input class="form-input" id="no" type="date" value=""/></div>
      <div class="form-group"><label class="form-label">Modalidad *</label>
        <select class="form-select" id="nm">
          <option value="virtual">Virtual</option>
          <option value="presencial">Presencial</option>
        </select>
      </div>
      <div class="form-group"><label class="form-label">Donde se subi- *</label>
        <select class="form-select" id="np">
          <option value="web">Pagina Web</option>
          <option value="drive">Google Drive</option>
        </select>
      </div>
      <div class="form-group full"><label class="form-label">Notas (opcional)</label><input class="form-input" id="nn" placeholder="Cualquier anotacion adicional..."/></div>
    </div>
    <div id="nerr" style="font-size:12px;color:var(--red);margin-top:10px;display:none"></div>
    <button class="submit-btn" id="nsub">Guardar Registro</button>
  </div>`;
}

function renderNuevoModal(){
  return `<div class="modal-overlay" id="noverlay">
    <div class="modal" style="max-width:620px">
      <h3>? Nuevo Registro</h3>
      ${renderNuevo()}
      <div class="modal-actions">
        <button class="btn-cancel" id="nclose">Cancelar</button>
      </div>
    </div>
  </div>`;
}

function syncNuevoForm(){
  const tipoNuevo=document.getElementById('nt');
  const fechaOpNueva=document.getElementById('no');
  if(tipoNuevo&&fechaOpNueva){
    const run=()=>{
      if(tipoNuevo.value==='registro') fechaOpNueva.value='';
    };
    tipoNuevo.onchange=run;
    run();
  }
}

async function submitNuevoRegistro(){
  if(NEW_RECORD_SUBMITTING) return;
  const c=document.getElementById('nc')?.value.trim()||'';
  const d=document.getElementById('nd')?.value.trim()||'';
  const f=document.getElementById('nf')?.value||'';
  const fo=document.getElementById('no')?.value||'';
  const err=document.getElementById('nerr');
  const submitBtn=document.getElementById('nsub');
  const tipoSelect=document.getElementById('nt');
  const t=fo?'operacion':(tipoSelect?tipoSelect.value:'registro');
  if(!err) return;
  if(!c){ err.textContent='El nombre del cliente es obligatorio'; err.style.display='block'; return; }
  if(!d||d.length<6){ err.textContent='El DNI debe tener al menos 6 caracteres'; err.style.display='block'; return; }
  if(!f){ err.textContent='La fecha es obligatoria'; err.style.display='block'; return; }
  NEW_RECORD_SUBMITTING = true;
  if(submitBtn){
    submitBtn.disabled = true;
    submitBtn.textContent = 'Guardando...';
    submitBtn.style.opacity = '0.7';
    submitBtn.style.cursor = 'wait';
  }
  try{
    await apiFetch('/api/records', {
      method:'POST',
      body:JSON.stringify({
        clientName:c,
        dni:d,
        registrationDate:f,
        operationDate:t==='operacion' ? fo || null : null,
        type:localToType(t),
        mode:localToMode(document.getElementById('nm').value),
        uploadPlatform:localToPlatform(document.getElementById('np').value),
        notes:document.getElementById('nn').value.trim() || null
      })
    });
    state.ft='';
    state.fTipo='';
    state.fDesde='';
    state.fHasta='';
    state.fApproval='';
    state.recordsMonth=monthKeyFromDate(f) || salaryMonthKey();
    state.view='mis-registros';
    await refreshState(false, [...new Set([...CORE_STATE_MODULES, 'records'])]);
    state.newModal=false;
    render();
  }catch(error){
    err.textContent=error.message || 'No se pudo guardar el registro';
    err.style.display='block';
  } finally {
    NEW_RECORD_SUBMITTING = false;
    if(submitBtn){
      submitBtn.disabled = false;
      submitBtn.textContent = 'Guardar Registro';
      submitBtn.style.opacity = '';
      submitBtn.style.cursor = '';
    }
  }
}

function commissionChipSummary(items, options={}){
  const {
    emptyText='Sin movimientos aprobados',
    titleText='movimientos aprobados',
    mapper=item=>String(item || ''),
    max=6
  }=options;
  if(!items.length) return `<span class="commission-detail-empty">${esc(emptyText)}</span>`;
  const visible=items.slice(0, max);
  const hidden=items.length - visible.length;
  return `<div class="commission-detail-box">
    <div class="commission-detail-title">${items.length} ${esc(titleText)}</div>
    <div class="commission-detail-chips">
      ${visible.map(item=>`<span class="commission-detail-chip">${mapper(item)}</span>`).join('')}
      ${hidden>0?`<span class="commission-detail-chip muted">+${hidden} mas</span>`:''}
    </div>
  </div>`;
}

function commissionGroupedSummary(items, options={}){
  const {
    emptyText='Sin movimientos aprobados',
    titleText='movimientos aprobados',
    labelFor=item=>String(item || 'Sin nombre'),
    dateFor=null,
    max=7
  }=options;
  if(!items.length) return `<span class="commission-detail-empty">${esc(emptyText)}</span>`;
  const groups=new Map();
  const dates=[];
  items.forEach(item=>{
    const label=String(labelFor(item) || 'Sin nombre').trim() || 'Sin nombre';
    groups.set(label, (groups.get(label)||0)+1);
    if(dateFor){
      const raw=dateFor(item);
      const date=raw ? new Date(raw) : null;
      if(date && !Number.isNaN(date.getTime())) dates.push(date);
    }
  });
  const rows=[...groups.entries()].sort((a,b)=>b[1]-a[1] || a[0].localeCompare(b[0])).slice(0,max);
  const hidden=Math.max(0, groups.size - rows.length);
  dates.sort((a,b)=>a-b);
  const range=dates.length ? `${fmt(dates[0].toISOString())} a ${fmt(dates[dates.length-1].toISOString())}` : '';
  return `<div class="commission-detail-box grouped">
    <div class="commission-detail-title">${items.length} ${esc(titleText)}</div>
    ${range?`<div class="commission-detail-sub">${range}</div>`:''}
    <div class="commission-detail-chips">
      ${rows.map(([label,count])=>`<span class="commission-detail-chip">${esc(label)} <strong>${count}</strong></span>`).join('')}
      ${hidden>0?`<span class="commission-detail-chip muted">+${hidden} personas</span>`:''}
    </div>
  </div>`;
}

function renderMisComisiones(){
  ensureAttendanceLoaded();
  const commissionMonth=salaryViewMonthKey();
  if(!ratingsLoadedFor(commissionMonth)){
    if(RATINGS_ERROR){
      return `<section class="commissions-shell">
        <div class="page-header">
          <div class="page-title">Mis Comisiones</div>
          <div class="page-sub">No se pudieron cargar las calificaciones, y sin eso el total podria salir incompleto.</div>
        </div>
        <div class="table-wrap"><div class="empty-state"><div class="es-icon">!</div><p>${esc(RATINGS_ERROR)}</p><button class="btn-primary" id="retryMyCommissionsRatings">Reintentar</button></div></div>
      </section>`;
    }
    if(!RATINGS_LOADING) setTimeout(()=>loadRatings(false, false, commissionMonth), 0);
    return renderSectionLoading('Mis Comisiones', 'Cargando comisiones completas...');
  }
  const u=state.currentUser;
  const commissionsEnabled=userCanReceiveCommissions(u);
  const my=(isManager()?getCommissionableRecordsForUser(u):RECORDS.filter(r=>r.userId===u.id))
    .filter(r=>recordAccountingMonthKey(r)===commissionMonth);
  const ops=my.filter(r=>!!r.validatedAt);
  const opsPending=isManager()?[]:my.filter(r=>isPendingApproval(r));
  const regs=isManager()?[]:my.filter(r=>r.tipo==='registro');
  const expired=regs.filter(r=>daysSince(r.fecha)>EXPIRE_DAY);
  const pending=regs.filter(r=>daysSince(r.fecha)<=EXPIRE_DAY);
  const recordTotal=calcUserCommission(u, commissionMonth);
  const myReferrals=commissionsEnabled ? REFERRALS.filter(r=>r.userId===u.id && !!r.validatedAt && monthKeyFromDate(r.validatedAt || r.createdAt)===commissionMonth) : [];
  const referralTotal=myReferrals.reduce((sum,r)=>sum+Number(r.referralCommission||0),0);
  const myWrongCards=commissionsEnabled ? WRONG_CARDS.filter(r=>r.userId===u.id && (r.status==='APPROVED' || r.validatedAt) && monthKeyFromDate(r.detectedDate || r.validatedAt || r.createdAt)===commissionMonth) : [];
  const wrongCardTotal=myWrongCards.reduce((sum,r)=>sum+Number(r.bonusAmount||getWrongCardBonus()),0);
  const myRatings=commissionsEnabled ? RATINGS.filter(row=>row.payable && row.matchedUserId===u.id && monthKeyFromDate(row.date || row.rawDate)===commissionMonth) : [];
  const ratingTotal=myRatings.reduce((sum,row)=>sum+Number(row.amount||getRatingCommission()),0);
  const managerRatingDecisions=commissionsEnabled&&isManager()?approvedRatingsDecidedByUser(u, commissionMonth):[];
  const managerRatingTotal=managerRatingDecisions.length * getManagerRatingCommission();
  const managerRecordValidations=commissionsEnabled&&isManager()?approvedRecordsValidatedByUser(u, commissionMonth):[];
  const managerRecordValidationTotal=managerRecordValidations.length * getManagerRecordValidationCommission();
  const managerSentPenalties=commissionsEnabled&&isManager()?approvedPenaltyReportsSentByUser(u, commissionMonth):[];
  const managerPenaltyTotal=managerSentPenalties.length * getManagerPenaltyCommission();
  const paymentAuditBonuses=commissionsEnabled ? approvedPaymentAuditReportsSentByUserFromRows(u, PENALTY_REPORTS, commissionMonth) : [];
  const paymentAuditBonusTotal=paymentAuditBonuses.reduce((sum,report)=>sum+Number(report.reporterBonusAmount||1),0);
  const myCalls=commissionsEnabled ? CALL_REPORTS.filter(report=>Number(report.userId)===Number(u.id) && (report.status==='APPROVED' || report.validatedAt) && monthKeyFromDate(report.validatedAt || report.createdAt)===commissionMonth) : [];
  const callTotal=myCalls.reduce((sum,report)=>sum+Number(report.bonusAmount||getCallCommission()),0);
  const total=recordTotal + referralTotal + wrongCardTotal + ratingTotal + managerRatingTotal + managerRecordValidationTotal + managerPenaltyTotal + paymentAuditBonusTotal + callTotal;
  const salaryPerson=ATTENDANCE ? getCurrentUserSalaryPerson() : null;
  const lateEntries=Number(salaryPerson?.lateEntries || 0);
  const lateMinutes=Number(salaryPerson?.totalLateMinutes || 0);
  const lateDiscount=Number(salaryPerson?.totalLatePenalty || 0);
  const salaryDiscounts=Number(salaryPerson?.totalDiscounts || 0);
  const approvedPenaltyDiscount=Number(salaryPerson?.penaltyReportDiscount || 0);
  const extraMinutes=Number(salaryPerson?.totalExtraMinutes || 0);
  const extraPay=Number((salaryPerson?.dayPayments || []).reduce((sum, day)=>sum + Number(day.overtimePay || 0), 0));
  const salarySummaryTitle=isManager()?'Resumen de tu sueldo como jefe de sede':'Resumen de tu sueldo';
  const penaltyPreview=(salaryPerson?.approvedPenalties || []).slice(0,4);
  const pendingPotential=(pending.length * getCommissionRate()) + (opsPending.length * getCommissionRate());
  const validatedCount=ops.length + myReferrals.length + myWrongCards.length + myCalls.length + myRatings.length + managerRatingDecisions.length + managerRecordValidations.length + managerSentPenalties.length + paymentAuditBonuses.length;
  const monthlyObjective=Math.max(50, Math.ceil((total + pendingPotential) / 10) * 10 || 50);
  const progress=Math.max(0, Math.min(100, monthlyObjective ? (total / monthlyObjective) * 100 : 0));
  const latestOps=[...ops]
    .sort((a,b)=>String(b.validatedAt || b.fechaOperacion || b.fecha || '').localeCompare(String(a.validatedAt || a.fechaOperacion || a.fecha || '')))
    .slice(0, 5);
  const paidSalaryMonths=salaryPerson?.salaryPaid ? [] : paidSalaryMonthsForCurrentUser();
  const paidMonthHint=paidSalaryMonths.find(month=>month!==commissionMonth);
  const salaryReceiptHtml=ATTENDANCE_LOADING && !ATTENDANCE
    ? `<div class="commission-receipt-card is-loading"><div class="commission-receipt-icon">S/</div><div><div class="commission-receipt-title">Boleta de sueldo</div><div class="commission-receipt-text">Cargando estado de pago...</div></div></div>`
    : salaryPerson?.salaryPaid
      ? `<div class="commission-receipt-card is-paid"><div class="commission-receipt-icon">PDF</div><div class="commission-receipt-copy"><div class="commission-receipt-title">Boleta de sueldo</div><div class="commission-receipt-text">Ya puedes descargar tu reporte de sueldo de ${monthLabelFromKey(commissionMonth)}${salaryPerson.salaryPaidAt?` - pagado ${fmtDateTime(salaryPerson.salaryPaidAt)}`:''}.</div></div><button class="btn-sm" id="downloadOwnSalaryPdf">Descargar PDF</button></div>`
      : `<div class="commission-receipt-card"><div class="commission-receipt-icon">S/</div><div><div class="commission-receipt-title">Boleta de sueldo</div><div class="commission-receipt-text">${paidMonthHint?`Tienes boleta pagada en ${monthLabelFromKey(paidMonthHint)}. Cambia el mes para descargarla.`:`Disponible cuando administracion marque tu sueldo como pagado para ${monthLabelFromKey(commissionMonth)}.`}</div></div></div>`;

  let h=`<section class="commissions-shell">
  <div class="commission-topbar">
    <div class="page-header" style="margin:0">
      <div class="page-title">Mis Comisiones</div>
      <div class="page-sub">Resumen de ${monthLabelFromKey(commissionMonth)}. Cambia el mes solo si quieres revisar un periodo anterior.</div>
    </div>
    ${monthFilterSelectHtml('salaryMonth', commissionMonth, { includeEmpty:false, count:24, extraValues:[
      ...RECORDS.filter(r=>r.userId===u.id).map(r=>recordAccountingMonthKey(r)),
      ...REFERRALS.filter(r=>r.userId===u.id).map(r=>r.validatedAt || r.createdAt),
      ...WRONG_CARDS.filter(r=>r.userId===u.id).map(r=>r.detectedDate || r.validatedAt || r.createdAt),
      ...CALL_REPORTS.filter(r=>Number(r.userId)===Number(u.id)).map(r=>r.validatedAt || r.createdAt),
      ...RATINGS.filter(row=>row.matchedUserId===u.id).map(row=>row.date || row.rawDate),
      ...(salaryPerson?.salaryPaidMonth ? [salaryPerson.salaryPaidMonth] : []),
      ...paidSalaryMonths
    ] })}
    ${salaryReceiptHtml}
  </div>
  ${!commissionsEnabled?`<div class="alert-banner" style="margin-bottom:1rem"><div class="ab-icon">i</div><div class="ab-text"><strong>Comisiones desactivadas para este colaborador.</strong> Este mes no se generan pagos por registros, calificaciones, referidos ni otros variables. El bono de puntualidad se mantiene.</div></div>`:''}
  <div class="commission-overview">
    <div class="commission-overview-main">
      <div class="commission-overview-icon">S/</div>
      <div class="commission-overview-copy">
        <div class="commission-overview-label">${isManager()?'Ganancia jefe de sede':'Total ganado'}</div>
        <div class="commission-overview-value">${money(total)}</div>
        <div class="commission-overview-sub">${isManager()?'Tus comisiones aprobadas como jefe de sede.':'Registros, referidos, tarjetas, llamadas, calificaciones y aprobaciones.'}</div>
      </div>
    </div>
    <div class="commission-overview-side">
      <div class="commission-progress-head">
        <div class="commission-progress-label">Objetivo mensual: ${money(monthlyObjective)}</div>
        <div class="commission-progress-value">${Math.round(progress)}%</div>
      </div>
      <div class="commission-progress-track"><span style="width:${progress.toFixed(1)}%"></span></div>
      <div class="commission-overview-stats">
        <div class="commission-overview-stat">
          <span class="commission-mini-icon success">OK</span>
          <div><strong>${validatedCount}</strong><span>Validadas</span></div>
        </div>
        <div class="commission-overview-stat">
          <span class="commission-mini-icon amber">%</span>
          <div><strong>${opsPending.length}</strong><span>Pendientes</span></div>
        </div>
        <div class="commission-overview-stat">
          <span class="commission-mini-icon purple">#</span>
          <div><strong>${money(pendingPotential)}</strong><span>Potencial</span></div>
        </div>
      </div>
      <div class="commission-overview-actions">
        <button class="btn-sm outline" data-commission-jump="commissionsValidatedTable">Ver detalle</button>
      </div>
    </div>
  </div>
  <div class="commission-section-heading">Resumen de actividad</div>
  <div class="commission-summary-grid">
    <div class="commission-summary-card">
      <div class="commission-summary-top">
        <div class="commission-summary-icon green">S/</div>
        <div>
          <div class="commission-summary-title">Actividad</div>
          <div class="commission-summary-sub">Registros, referidos y llamadas</div>
        </div>
      </div>
      <div class="commission-summary-list">
        <div class="commission-summary-row"><span>Registros</span><strong class="green">${ops.length}</strong></div>
        <div class="commission-summary-row"><span>Referidos</span><strong>${myReferrals.length}</strong></div>
        <div class="commission-summary-row"><span>Llamadas</span><strong>${myCalls.length}</strong></div>
      </div>
      <button class="commission-link-btn" data-commission-jump="commissionsValidatedTable">Ver detalles ?</button>
    </div>
    <div class="commission-summary-card">
      <div class="commission-summary-top">
        <div class="commission-summary-icon purple">#</div>
        <div>
          <div class="commission-summary-title">Calidad</div>
          <div class="commission-summary-sub">Calificaciones y aprobaciones</div>
        </div>
      </div>
      <div class="commission-summary-list">
        <div class="commission-summary-row"><span>Calificaciones</span><strong>${myRatings.length}</strong></div>
        <div class="commission-summary-row"><span>Aprobaciones</span><strong>${managerRatingDecisions.length + managerRecordValidations.length}</strong></div>
        <div class="commission-summary-row"><span>Reportes / auditorías</span><strong>${managerSentPenalties.length + paymentAuditBonuses.length}</strong></div>
      </div>
      <button class="commission-link-btn" data-commission-jump="commissionsApprovedTable">Ver detalles ?</button>
    </div>
    <div class="commission-summary-card">
      <div class="commission-summary-top">
        <div class="commission-summary-icon amber">%</div>
        <div>
          <div class="commission-summary-title">Estado</div>
          <div class="commission-summary-sub">Pendientes y vencimientos</div>
        </div>
      </div>
      <div class="commission-summary-list">
        <div class="commission-summary-row"><span>Pendientes de aprobacion</span><strong class="amber">${opsPending.length}</strong></div>
        <div class="commission-summary-row"><span>Registros en plazo</span><strong class="green">${pending.length}</strong></div>
        <div class="commission-summary-row"><span>Registros expirados</span><strong class="red">${expired.length}</strong></div>
      </div>
      <button class="commission-link-btn" data-commission-jump="commissionsApprovedTable">Ver detalles ?</button>
    </div>
    ${salaryPerson?`<div class="commission-summary-card commission-summary-card-pay">
      <div class="commission-summary-top">
        <div class="commission-summary-icon red">!</div>
        <div>
          <div class="commission-summary-title">${salarySummaryTitle}</div>
          <div class="commission-summary-sub">Horas extra, tardanzas y descuentos aplicados a tu sueldo</div>
        </div>
      </div>
      <div class="commission-summary-list">
        <div class="commission-summary-row"><span>Tardanzas</span><strong class="${lateEntries>0?'red':''}">${lateEntries}</strong></div>
        <div class="commission-summary-row"><span>Minutos tarde</span><strong class="${lateMinutes>0?'amber':''}">${minutesLabel(lateMinutes)}</strong></div>
        <div class="commission-summary-row"><span>Horas extra</span><strong class="${extraMinutes>0?'green':''}">${minutesLabel(extraMinutes)}</strong></div>
        <div class="commission-summary-row"><span>Pago horas extra</span><strong class="${extraPay>0?'green':''}">${money(extraPay)}</strong></div>
        <div class="commission-summary-row"><span>Descuento tardanza</span><strong class="${lateDiscount>0?'red':''}">-${money(lateDiscount)}</strong></div>
        <div class="commission-summary-row"><span>Total descuentos</span><strong class="${salaryDiscounts>0?'red':''}">-${money(salaryDiscounts)}</strong></div>
      </div>
      <button class="commission-link-btn" data-commission-jump="commissionsSalaryBlock">Ver detalle ?</button>
    </div>`:''}
  </div>
  ${salaryPerson?`<div class="commission-pay-panel" id="commissionsSalaryBlock">
    <div class="commission-pay-head">
      <div>
        <div class="commission-table-title">${salarySummaryTitle}</div>
        <div class="commission-table-sub">Vista r-pida de horas extra y descuentos del periodo actual.</div>
      </div>
    </div>
    <div class="commission-pay-grid">
      <div class="commission-pay-card positive">
        <div class="commission-pay-label">Horas extra</div>
        <div class="commission-pay-value">${minutesLabel(extraMinutes)}</div>
        <div class="commission-pay-sub">${extraPay>0?`${money(extraPay)} acumulado`:'Sin pago extra acumulado'}</div>
      </div>
      <div class="commission-pay-card negative">
        <div class="commission-pay-label">Tardanzas</div>
        <div class="commission-pay-value">${lateEntries}</div>
        <div class="commission-pay-sub">${lateMinutes>0?`${minutesLabel(lateMinutes)} acumulados`:'Sin minutos tarde acumulados'}</div>
      </div>
      <div class="commission-pay-card negative">
        <div class="commission-pay-label">Descuento tardanza</div>
        <div class="commission-pay-value">${lateDiscount>0?`-${money(lateDiscount)}`:'S/ 0.00'}</div>
        <div class="commission-pay-sub">Descuento aplicado por minutos tarde</div>
      </div>
      <div class="commission-pay-card ${salaryDiscounts>0?'negative':'positive'}">
        <div class="commission-pay-label">Total descuentos</div>
        <div class="commission-pay-value">${salaryDiscounts>0?`-${money(salaryDiscounts)}`:'S/ 0.00'}</div>
        <div class="commission-pay-sub">${approvedPenaltyDiscount>0?`Incluye ${money(approvedPenaltyDiscount)} en penalidades`:'Sin penalidades aprobadas'}</div>
      </div>
    </div>
    <div class="commission-pay-list">
      <div class="commission-pay-line">
        <span>Pago por horas extra</span>
        <strong class="${extraPay>0?'green':''}">${money(extraPay)}</strong>
      </div>
      <div class="commission-pay-line">
        <span>Descuento por tardanza</span>
        <strong class="${lateDiscount>0?'red':''}">${lateDiscount>0?`-${money(lateDiscount)}`:'S/ 0.00'}</strong>
      </div>
      <div class="commission-pay-line">
        <span>Penalidades aprobadas</span>
        <strong class="${approvedPenaltyDiscount>0?'red':''}">${approvedPenaltyDiscount>0?`-${money(approvedPenaltyDiscount)}`:'S/ 0.00'}</strong>
      </div>
      <div class="commission-pay-line total">
        <span>Ajuste neto visible</span>
        <strong class="${(extraPay - salaryDiscounts)>=0?'green':'red'}">${extraPay - salaryDiscounts >= 0 ? money(extraPay - salaryDiscounts) : `-${money(Math.abs(extraPay - salaryDiscounts))}`}</strong>
      </div>
    </div>
    ${penaltyPreview.length?`<div class="commission-pay-penalties">
      <div class="commission-pay-penalties-title">Ultimas penalidades aprobadas</div>
      <div class="commission-pay-penalties-list">
        ${penaltyPreview.map(report=>`<div class="commission-pay-penalty"><span>${esc(report.penaltyLabel)} - ${esc(report.clientName)}</span><strong>-${money(report.penaltyAmount)}</strong></div>`).join('')}
      </div>
    </div>`:''}
  </div>`:''}
  <div class="commission-section-heading">Ultimas operaciones validadas</div>
  <div class="table-wrap commissions-table-card" id="commissionsValidatedTable">
    <div class="commission-table-head">
      <div class="commission-table-meta">
        <div class="commission-table-icon">OK</div>
        <div>
          <div class="commission-table-title">${ops.length} operacion${ops.length===1?'':'es'} validada${ops.length===1?'':'s'}</div>
          <div class="commission-table-sub">Mostrando las Ultimas operaciones confirmadas.</div>
        </div>
      </div>
      <button class="btn-sm outline" data-commission-jump="commissionsApprovedTable">Ver comisiones</button>
    </div>
    <table><thead><tr><th>DNI</th><th>Registro</th><th>Operacion</th><th>Modalidad</th><th>Plataforma</th><th>Comision</th></tr></thead><tbody>`;
  latestOps.forEach(r=>{ h+=`<tr><td><span style="font-family:var(--font2);font-weight:600">${r.dni}</span></td><td>${fmt(r.fecha)}</td><td>${fmt(r.fechaOperacion)}</td><td>${r.modalidad==='presencial'?'Presencial':'Virtual'}</td><td><span class="badge ${r.plataforma}">${r.plataforma==='drive'?'Drive':'Web'}</span></td><td style="color:var(--green);font-weight:700;font-family:var(--font2)">+${money(getCommissionRate())}</td></tr>`; });
  if(!latestOps.length) h+=`<tr><td colspan="6"><div class="empty-state"><div class="es-icon">-</div><p>Aun no tienes operaciones validadas. Sigue adelante!</p></div></td></tr>`;
  h+=`</tbody></table></div>
  <div class="table-wrap" id="commissionsApprovedTable" style="margin-top:1.1rem"><div class="table-header"><div class="table-title">Detalle de comisiones aprobadas</div></div>
  <table><thead><tr><th>Concepto</th><th>Detalle</th><th>Cantidad</th><th>Ganancia</th></tr></thead><tbody>
    <tr><td>Referidos aprobados</td><td>${commissionChipSummary(myReferrals,{emptyText:'Sin referidos aprobados',titleText:'referidos aprobados',mapper:r=>`${esc(r.cliente)} <strong>${money(r.referralCommission)}</strong>`})}</td><td>${myReferrals.length}</td><td style="color:var(--green);font-weight:800">${money(referralTotal)}</td></tr>
    <tr><td>Tarjetas erroneas aprobadas</td><td>${commissionChipSummary(myWrongCards,{emptyText:'Sin tarjetas aprobadas',titleText:'tarjetas aprobadas',mapper:r=>`${esc(r.cliente)} <strong>${fmt(r.detectedDate)}</strong>`})}</td><td>${myWrongCards.length}</td><td style="color:var(--green);font-weight:800">${money(wrongCardTotal)}</td></tr>
    <tr><td>Llamadas aprobadas</td><td>${commissionChipSummary(myCalls,{emptyText:'Sin llamadas aprobadas',titleText:'llamadas aprobadas',mapper:r=>`${esc(r.cliente)} <strong>${fmtDateTime(r.createdAt)}</strong>`})}</td><td>${myCalls.length}</td><td style="color:var(--green);font-weight:800">${money(callTotal)}</td></tr>
    <tr><td>Calificaciones aprobadas</td><td>${RATINGS_LOADING&&!ratingsLoadedFor(commissionMonth)?'<span class="commission-detail-empty">Cargando calificaciones...</span>':commissionChipSummary(myRatings,{emptyText:'Sin calificaciones aprobadas',titleText:'calificaciones aprobadas',mapper:r=>`${fmtDateTime(r.date || r.rawDate)} <strong>${Number(r.rating||0)} estrellas</strong>`})}</td><td>${myRatings.length}</td><td style="color:var(--green);font-weight:800">${money(ratingTotal)}</td></tr>
    ${paymentAuditBonuses.length?`<tr><td>Auditorías de Pagos aprobadas</td><td>${commissionGroupedSummary(paymentAuditBonuses,{emptyText:'Sin auditorías aprobadas',titleText:'auditorías aprobadas',labelFor:r=>r.workerName || 'Asesor',dateFor:r=>r.decidedAt || r.createdAt,max:5})}</td><td>${paymentAuditBonuses.length}</td><td style="color:var(--green);font-weight:800">${money(paymentAuditBonusTotal)}</td></tr>`:''}
    ${isManager()?`<tr><td>Aprobaciones de operaciones</td><td>${commissionGroupedSummary(managerRecordValidations,{emptyText:'Sin operaciones aprobadas por ti',titleText:'operaciones aprobadas por ti',labelFor:r=>r.cliente || r.dni || 'Sin nombre',dateFor:r=>r.validatedAt || r.fechaOperacion || r.fecha})}</td><td>${managerRecordValidations.length}</td><td style="color:var(--green);font-weight:800">${money(managerRecordValidationTotal)}</td></tr>
    <tr><td>Aprobaciones de calificaciones</td><td>${commissionGroupedSummary(managerRatingDecisions,{emptyText:'Sin aprobaciones propias',titleText:'aprobaciones propias',labelFor:r=>r.matchedUserName || r.advisor || 'Sin nombre',dateFor:r=>r.approvedAt || r.date})}</td><td>${managerRatingDecisions.length}</td><td style="color:var(--green);font-weight:800">${money(managerRatingTotal)}</td></tr>
    <tr><td>Reportes de penalidad aprobados</td><td>${commissionGroupedSummary(managerSentPenalties,{emptyText:'Sin reportes aprobados',titleText:'reportes aprobados',labelFor:r=>r.workerName || r.penaltyLabel || 'Sin nombre',dateFor:r=>r.approvedAt || r.createdAt || r.date,max:5})}</td><td>${managerSentPenalties.length}</td><td style="color:var(--green);font-weight:800">${money(managerPenaltyTotal)}</td></tr>`:''}
  </tbody></table></div>
  <div class="commission-footnote"><span>i</span><div>Los montos mostrados corresponden a comisiones confirmadas de ${monthLabelFromKey(commissionMonth)}.</div></div>
  </section>`;
  return h;
}

function renderModal(){
  const r=RECORDS.find(x=>x.id===state.modal);
  if(!r || !canViewRecord(r)) return '';
  const locked=isApprovalLocked(r);
  const monthEditable=canEditMonth(recordAccountingMonthKey(r));
  const canEdit=monthEditable && (isAdmin()||r.userId===state.currentUser.id) && !locked;
  const canEditMode=monthEditable && (isAdmin()||isManager()||r.userId===state.currentUser.id);
  const canEditFields=canEdit || (locked && canEditMode);
  const canDelete=canDeleteRecord(r);
  const dis=canEdit?'':'disabled';
  const editFieldDis=canEditFields?'':'disabled';
  const modeDis=canEditMode?'':'disabled';
  const validation=validationText(r);
  return `<div class="modal-overlay" id="moverlay">
    <div class="modal">
      <h3>${canEditFields?'Editar Registro':'Ver Registro'} - DNI ${r.dni}</h3>
      <div class="form-grid">
        <div class="form-group"><label class="form-label">Nombre del Cliente</label><input class="form-input" id="ec" value="${r.cliente||''}" disabled/></div>
        <div class="form-group"><label class="form-label">DNI</label><input class="form-input" id="ed" value="${r.dni}" disabled/></div>
        <div class="form-group"><label class="form-label">Fecha de Registro</label><input class="form-input" type="date" id="ef" value="${r.fecha}" disabled/></div>
        <div class="form-group"><label class="form-label">Tipo</label>
          <select class="form-select" id="et" ${editFieldDis}>
            <option value="registro"${r.tipo==='registro'?' selected':''}>Registro</option>
            <option value="operacion"${r.tipo==='operacion'?' selected':''}>Operacion</option>
          </select>
        </div>
        <div class="form-group"><label class="form-label">Fecha de Operacion</label><input class="form-input" type="date" id="eo" value="${r.fechaOperacion||''}" ${editFieldDis}/></div>
        <div class="form-group"><label class="form-label">Modalidad</label>
          <select class="form-select" id="em" ${modeDis}>
            <option value="virtual"${r.modalidad==='virtual'?' selected':''}>Virtual</option>
            <option value="presencial"${r.modalidad==='presencial'?' selected':''}>Presencial</option>
          </select>
        </div>
        <div class="form-group"><label class="form-label">Plataforma</label>
          <select class="form-select" id="ep" ${editFieldDis}>
            <option value="web"${r.plataforma==='web'?' selected':''}>Web</option>
            <option value="drive"${r.plataforma==='drive'?' selected':''}>Drive</option>
          </select>
        </div>
        <div class="form-group full"><label class="form-label">Notas</label><input class="form-input" id="en" value="${r.notas}" ${editFieldDis}/></div>
      </div>
      <div style="margin-top:12px;font-size:12px;color:var(--text2)">Estado de validacion: <span class="days-chip ${validation.cls}">${validation.label}</span></div>
      ${r.rejectedAt&&r.rejectionReason?`<div style="margin-top:8px;font-size:12px;color:var(--red)">Motivo de rechazo: ${r.rejectionReason}</div>`:''}
      ${state.currentUser.role==='admin'?`<div style="margin-top:8px;font-size:12px;color:var(--text2)">Subido: ${fmtDateTime(r.createdAt)}</div>`:''}
      <div class="modal-actions">
        <button class="btn-cancel" id="mclose">Cancelar</button>
        ${canDelete?`<button class="btn-sm danger" id="mdel">Eliminar</button>`:''}
        ${canValidateOrReject(r)?`<div class="inline-actions compact"><button class="pill-action danger" id="mreject">Rechazar</button><button class="pill-action success" id="mvalidate">Validar</button></div>`:''}
        ${canEditFields?`<button class="btn-primary" id="msave" style="width:auto;padding:9px 20px">Guardar</button>`:''}
      </div>
    </div>
  </div>`;
}

function resetSafetypayDraft(){
  SAFETYPAY_EDIT_ID=null;
  state.safetypayEdit=false;
  SAFETYPAY_DRAFT_DIRTY=false;
  SAFETYPAY_DRAFT={ clientDni:'', cardLast4:'', customerCode:'', bank:'CMR', code:'ATK1', amount:'', operationNumber:'' };
}

// BIND
function bindApp(){
  const gratificationLoad=document.getElementById('salaryLoadGratification');
  if(gratificationLoad) gratificationLoad.onclick=()=>requestSalaryHistory();
  bindWorkCalendar();
  const deletedRatingsHistory=document.getElementById('deletedRatingsHistory');
  if(deletedRatingsHistory) deletedRatingsHistory.onclick=async()=>{
    try{ const payload=await apiFetch('/api/ratings/deletions'); CHANGE_LOGS=payload.logs || []; render(); }
    catch(error){ await appAlert(error.message || 'No se pudieron cargar las calificaciones eliminadas.'); }
  };
  document.querySelectorAll('[data-rating-restore]').forEach(el=>{ el.onclick=async()=>{
    try{ await apiFetch('/api/ratings/deletions',{method:'POST',body:JSON.stringify({deletionKey:el.dataset.ratingRestore})}); RATINGS_LOADED=false; await loadChangeLogs(true); }
    catch(error){ await appAlert(error.message || 'No se pudo restaurar la calificación.'); }
  }; });
  document.querySelectorAll('[data-rating-purge]').forEach(el=>{ el.onclick=async()=>{
    if(!await appConfirm('¿Borrar definitivamente esta calificación y su historial? No se podrá restaurar.')) return;
    try{ const result=await apiFetch('/api/ratings/deletions',{method:'PATCH',body:JSON.stringify({deletionKey:el.dataset.ratingPurge})}); RATINGS_LOADED=false; const payload=await apiFetch('/api/ratings/deletions'); CHANGE_LOGS=payload.logs || []; render(); await appAlert('Borrado definitivo completado: '+result.removed.snapshots+' registro(s), '+result.removed.approvals+' aprobación(es) y '+result.removed.history+' copia(s) del historial eliminadas.'); }
    catch(error){ await appAlert(error.message || 'No se pudo borrar definitivamente.'); }
  }; });
  const changeLogRefresh=document.getElementById('changeLogRefresh');
  if(changeLogRefresh) changeLogRefresh.onclick=()=>loadChangeLogs(true);
  const applyHistoryFilters=()=>{
    state.historyModule=document.getElementById('historyModule')?.value||'';
    state.historySearch=document.getElementById('historySearch')?.value.trim()||'';
    state.historyFrom=document.getElementById('historyFrom')?.value||'';
    state.historyTo=document.getElementById('historyTo')?.value||'';
    state.historyPage=1;loadChangeLogs(true);
  };
  document.querySelectorAll('[data-history-group]').forEach(button=>{button.onclick=()=>{state.historyGroup=button.dataset.historyGroup;state.historyPage=1;if(['attendance','system'].includes(state.historyGroup))state.historyModule='';loadChangeLogs(true);};});
  document.querySelectorAll('[data-history-page]').forEach(button=>{button.onclick=()=>{state.historyPage=Number(button.dataset.historyPage);loadChangeLogs(true);};});
  const historyApply=document.getElementById('historyApply');if(historyApply)historyApply.onclick=applyHistoryFilters;
  const historyModule=document.getElementById('historyModule');if(historyModule)historyModule.onchange=applyHistoryFilters;
  const historySearch=document.getElementById('historySearch');if(historySearch)historySearch.onkeydown=event=>{if(event.key==='Enter'){event.preventDefault();applyHistoryFilters();}};
  const addWorkGroup=document.getElementById('addWorkGroup');
  if(addWorkGroup) addWorkGroup.onclick=()=>{
    WORK_GROUPS=[...(WORK_GROUPS||[]), { name:'Nuevo grupo', chiefDni:null, members:[] }];
    render();
  };
  document.querySelectorAll('[data-remove-work-group]').forEach(button=>{
    button.onclick=()=>{
      const index=Number(button.dataset.removeWorkGroup);
      WORK_GROUPS=(WORK_GROUPS||[]).filter((_,itemIndex)=>itemIndex!==index);
      render();
    };
  });
  const saveWorkGroups=document.getElementById('saveWorkGroups');
  if(saveWorkGroups) saveWorkGroups.onclick=async()=>{
    const groups=(WORK_GROUPS||[]).map((group,index)=>{
      const name=document.querySelector(`[data-work-group-name="${index}"]`)?.value.trim() || '';
      const chiefDni=document.querySelector(`[data-work-group-chief="${index}"]`)?.value.trim() || null;
      const rawMembers=document.querySelector(`[data-work-group-members="${index}"]`)?.value || '';
      return { name, chiefDni, memberDnis:rawMembers.split(/[\\s,;]+/).filter(Boolean) };
    });
    if(groups.some(group=>!group.name)){ await appAlert('Todos los grupos necesitan un nombre.', 'Falta información'); return; }
    const seen=new Set();
    const duplicate=groups.flatMap(group=>group.memberDnis).find(dni=>seen.has(dni) ? true : (seen.add(dni),false));
    if(duplicate){ await appAlert(`El DNI ${duplicate} aparece en más de un grupo.`, 'No se puede guardar'); return; }
    try{
      await apiFetch('/api/groups', { method:'PUT', body:JSON.stringify({groups}), busyMessage:'Guardando grupos...' });
      await loadWorkGroups(true);
      await appAlert('Grupos guardados correctamente.', 'Listo');
    }catch(error){ await appAlert(error.message || 'No se pudieron guardar los grupos.', 'Error'); }
  };
  document.querySelectorAll('[data-nav]').forEach(el=>{
    el.onclick=()=>withLoadingFrame('Abriendo '+el.textContent.trim()+'...',()=>{
      state.view=el.dataset.nav;
      if(state.view==='historial') CHANGE_LOGS=null;
      state.newModal=false; state.attendanceEdit=null; state.salaryDetailId=null;
      if(state.view!=='referidos'){
        REFERRAL_DRAFT_DIRTY=false;
        REFERRAL_DRAFT={ clientName:'', dni:'', amount:'', bank:'BBVA', notes:'' };
      }
      state.ft=''; state.fUser=''; state.fTipo=''; state.fDesde=''; state.fHasta=''; state.fApproval=''; state.fSede=''; state.recordsMonth='';
      state.attendanceSearch=''; state.attendanceDate=''; state.attendancePerson=''; state.attendanceDepartment=''; state.attendanceSede=''; state.salarySede='';
      state.attendanceTab='resumen';
      state.adminTab='users'; state.alertTab='warn';
      render();
    });
  });
  const doLogout=async()=>{
    if(LOGOUT_SUBMITTING) return;
    LOGOUT_SUBMITTING = true;
    clearTabSession();
    stopAutoRefresh();
    SESSION_WARMUP_KEY='';
    resetSessionViewState();
    state.currentUser=null;
    state.resetUserId=null;
    state.sessionPassword='';
    state.view='login';
    render();
    showBusy('Cerrando sesion...');
    try{
      await fetch('/api/auth/logout', { method:'POST', credentials:'same-origin', cache:'no-store' });
    } catch(error){
      // Even if the request fails visually, clear the local session state and force a fresh login load.
    } finally {
      hideBusy();
      window.location.replace('/login');
    }
  };
  document.querySelectorAll('[data-logout]').forEach(btn=>{ btn.onclick=doLogout; });
  document.querySelectorAll('[data-page-key]').forEach(btn=>{
    btn.onclick=()=>{
      const key=btn.dataset.pageKey;
      const page=Number(btn.dataset.page);
      if(!key || !Number.isFinite(page) || page<1) return;
      if(!state.pages) state.pages={};
      state.pages[key]=page;
      preserveMainScroll(()=>render());
    };
  });
  document.querySelectorAll('[data-dashboard-user]').forEach(card=>{
    card.onclick=async()=>{
      state.dashboardUserId=card.dataset.dashboardUser;
      preserveMainScroll(()=>render());
      if(!ATTENDANCE && !ATTENDANCE_LOADING){
        await loadAttendance(false);
      }
    };
  });
  document.querySelectorAll('[data-dashboard-close]').forEach(btn=>{
    btn.onclick=()=>{
      state.dashboardUserId=null;
      preserveMainScroll(()=>render());
    };
  });
  document.querySelectorAll('[data-duplicate-alerts]').forEach(card=>{
    card.onclick=()=>{
      state.view='alertas';
      state.alertTab='dups';
      state.recordsMonth=card.dataset.duplicateAlerts || state.recordsMonth;
      preserveMainScroll(()=>render());
    };
  });
  document.querySelectorAll('[data-dup-keep]').forEach(btn=>{
    btn.onclick=async()=>{
      await keepDuplicateRecord(Number(btn.dataset.dupKeep));
    };
  });
  document.querySelectorAll('[data-dup-reject]').forEach(btn=>{
    btn.onclick=async()=>{
      await rejectDuplicateRecord(Number(btn.dataset.dupReject));
    };
  });
  document.querySelectorAll('[data-sidebar-toggle]').forEach(btn=>{
    btn.onclick=()=>{
      state.sidebarCollapsed=!state.sidebarCollapsed;
      localStorage.setItem(SIDEBAR_COLLAPSED_KEY, state.sidebarCollapsed?'1':'0');
      render();
    };
  });
  document.querySelectorAll('[data-safetypay-goal]').forEach(card=>{
    card.onclick=()=>{
      state.safetypaySede=card.dataset.safetypayGoal || '';
      state.safetypayCmrTotalOnly=false;
      resetPageKeys('safetypay');
      FILTER_INTERACTION_UNTIL=Date.now()+1800;
      preserveMainScroll(()=>render());
    };
  });
  const openSafetypayGoalSettings=document.getElementById('openSafetypayGoalSettings');
  if(openSafetypayGoalSettings) openSafetypayGoalSettings.onclick=()=>{
    state.view='admin';
    state.adminTab='payout';
    preserveMainScroll(()=>render());
  };
  const safetypayCmrTotal=document.querySelector('[data-safetypay-cmr-total]');
  if(safetypayCmrTotal) safetypayCmrTotal.onclick=()=>{
    state.safetypaySede='';
    state.safetypayCmrTotalOnly=true;
    state.safetypayDuplicatesOnly=false;
    state.safetypaySearch='';
    resetPageKeys('safetypay');
    FILTER_INTERACTION_UNTIL=Date.now()+1800;
    preserveMainScroll(()=>render());
  };
  const clearSafetypayCmrTotal=document.getElementById('clearSafetypayCmrTotal');
  if(clearSafetypayCmrTotal) clearSafetypayCmrTotal.onclick=()=>{
    state.safetypayCmrTotalOnly=false;
    resetPageKeys('safetypay');
    preserveMainScroll(()=>render());
  };
  const safetypayDuplicatesCard=document.querySelector('[data-safetypay-duplicates]');
  if(safetypayDuplicatesCard) safetypayDuplicatesCard.onclick=()=>{
    if(!getSafetypayDuplicateIds(safetypayVisibleRows()).size) return;
    state.safetypayDuplicatesOnly=!state.safetypayDuplicatesOnly;
    state.safetypaySearch='';
    resetPageKeys('safetypay');
    FILTER_INTERACTION_UNTIL=Date.now()+1800;
    preserveMainScroll(()=>render());
  };
  const clearSafetypayDuplicates=document.getElementById('clearSafetypayDuplicates');
  if(clearSafetypayDuplicates) clearSafetypayDuplicates.onclick=()=>{
    state.safetypayDuplicatesOnly=false;
    resetPageKeys('safetypay');
    preserveMainScroll(()=>render());
  };
  const safetypayAuditUpload=document.getElementById('safetypayAuditUpload');
  const safetypayAuditFile=document.getElementById('safetypayAuditFile');
  if(safetypayAuditUpload && safetypayAuditFile){
    safetypayAuditUpload.onclick=()=>safetypayAuditFile.click();
    safetypayAuditFile.onchange=async()=>{
      const file=safetypayAuditFile.files && safetypayAuditFile.files[0];
      if(!file) return;
      const form=new FormData();
      form.append('file', file);
      form.append('month', safetypayMonthKey());
      showBusy('Auditando Safetypay...');
      try{
        const response=await fetch('/api/safetypay/audit', {
          method:'POST',
          headers:sessionRequestHeaders(),
          credentials:'same-origin',
          cache:'no-store',
          body:form
        });
        const payload=await response.json().catch(()=>({}));
        if(!response.ok) throw new Error(payload.error || 'No se pudo auditar el Excel.');
        SAFETYPAY_AUDIT=payload;
        render();
      }catch(error){
        await appAlert(error.message || 'No se pudo auditar el Excel.', 'Error');
      }finally{
        hideBusy();
        safetypayAuditFile.value='';
      }
    };
  }
  const safetypayAuditClear=document.getElementById('safetypayAuditClear');
  if(safetypayAuditClear) safetypayAuditClear.onclick=()=>{
    SAFETYPAY_AUDIT=null;
    render();
  };
  const safetypayAuditDownload=document.getElementById('safetypayAuditDownload');
  if(safetypayAuditDownload) safetypayAuditDownload.onclick=()=>downloadSafetypayAuditExcel();
  const downloadSafetypayPaymentExcelBtn=document.getElementById('downloadSafetypayPaymentExcel');
  if(downloadSafetypayPaymentExcelBtn) downloadSafetypayPaymentExcelBtn.onclick=()=>downloadSafetypayPaymentExcel();
  // filters
  const pageKeysForFilter={
    ft:['recordsAll','recordsMine'], fu:['recordsAll'], fs:['recordsAll'], recordsMonth:['recordsAll','recordsMine'], ftp:['recordsAll','recordsMine'], fap:['recordsAll'], fd:['recordsAll','recordsMine'], fh:['recordsAll','recordsMine'],
    referralSearch:['referrals'], referralUser:['referrals'], referralStatus:['referrals'], referralMonth:['referrals'],
    wrongCardSearch:['wrongCards'], wrongCardStatus:['wrongCards'], wrongCardMonth:['wrongCards'],
    callSearch:['calls'], callStatus:['calls'], callMonth:['calls'],
    safetypaySearch:['safetypay'], safetypaySede:['safetypay'], safetypayMonth:['safetypay'],
    ratingSearch:['ratings'], ratingUser:['ratings'], ratingStatus:['ratings'], ratingStars:['ratings'], ratingMonth:['ratings'],
    penaltySearch:['penaltiesEmployee','penalties_received','penalties_sent','penalties_history'], penaltyMonth:['penaltiesEmployee','penalties_received','penalties_sent','penalties_history'], penaltySede:['penalties_received','penalties_sent','penalties_history'], penaltyStatus:['penalties_received','penalties_sent','penalties_history'], penaltyWorker:['penalties_received','penalties_sent','penalties_history'],
    paymentAuditSearch:['paymentAudits'], paymentAuditMonth:['paymentAudits'],
    periodScope:['referrals','wrongCards','calls','safetypay','ratings','penaltiesEmployee','penalties_received','penalties_sent','penalties_history'],
    managerViewSede:['recordsAll','recordsMine','referrals','wrongCards','calls','safetypay','ratings','salaryPeople','reportPeople','statsRankings'],
    dashboardMonth:[],
    collaboratorSearch:['workers'], collaboratorRole:['workers'], collaboratorSede:['workers'],
    statsSede:['statsRankings'], statsTrendMonths:[],
    reportMonth:['recordsReport','reportPeople'],
    salaryMonth:['salaryPeople'],
    attendanceMonth:[]
  };
  const bindFilter=(id,key)=>{
    const el=document.getElementById(id);
    if(!el) return;
    const touch=()=>{ FILTER_INTERACTION_UNTIL=Date.now()+1800; };
    const apply=(debounced=false)=>{
      touch();
      state[key]=el.value;
      if(key==='safetypayMonth'){
        const module='safetypayCodes';
        const moduleKey=stateModuleLoadKey(module);
        STATE_MODULES_LOADED.delete(moduleKey);
        STATE_MODULES_LOADING.delete(moduleKey);
        delete STATE_MODULE_ERRORS[moduleKey];
      }
      if(key==='safetypaySede') state.safetypayCmrTotalOnly=false;
      resetPageKeys(...(pageKeysForFilter[key]||[]));
      if(debounced){
        clearTimeout(FILTER_RENDER_TIMER);
        FILTER_RENDER_TIMER=setTimeout(()=>renderPreservingField(id), 220);
      }else{
        renderPreservingField(id);
      }
    };
    el.onfocus=touch;
    el.onpointerdown=touch;
    if((el.tagName||'').toUpperCase()==='SELECT'){
      el.onchange=()=>apply(false);
    }else{
      el.oninput=()=>apply(true);
      el.onchange=()=>apply(false);
    }
  };
  bindFilter('managerViewSede','managerViewSede');
  bindFilter('ft','ft'); bindFilter('fu','fUser'); bindFilter('ftp','fTipo');
  bindFilter('fap','fApproval'); bindFilter('fs','fSede');
  bindFilter('recordsMonth','recordsMonth');
  bindFilter('fd','fDesde'); bindFilter('fh','fHasta');
  bindFilter('referralSearch','referralSearch');
  bindFilter('referralUser','referralUser');
  bindFilter('referralStatus','referralStatus');
  bindFilter('referralMonth','referralMonth');
  bindFilter('wrongCardSearch','wrongCardSearch');
  bindFilter('wrongCardStatus','wrongCardStatus');
  bindFilter('wrongCardMonth','wrongCardMonth');
  bindFilter('callSearch','callSearch');
  bindFilter('callStatus','callStatus');
  bindFilter('callMonth','callMonth');
  bindFilter('safetypaySearch','safetypaySearch');
  bindFilter('safetypaySede','safetypaySede');
  bindFilter('safetypayMonth','safetypayMonth');
  bindFilter('ratingSearch','ratingSearch');
  bindFilter('ratingUser','ratingUser');
  bindFilter('ratingStars','ratingStars');
  bindFilter('ratingStatus','ratingStatus');
  bindFilter('ratingMonth','ratingMonth');
  bindFilter('penaltySearch','penaltySearch');
  bindFilter('penaltySede','penaltySede');
  bindFilter('penaltyStatus','penaltyStatus');
  bindFilter('penaltyMonth','penaltyMonth');
  bindFilter('penaltyWorkerFilter','penaltyWorker');
  bindFilter('paymentAuditSearch','paymentAuditSearch');
  bindFilter('paymentAuditMonth','paymentAuditMonth');
  bindFilter('periodScope','periodScope');
  bindFilter('dashboardMonth','dashboardMonth');
  ['managerReportPeriod','managerReportFrom','managerReportTo'].forEach(id=>{
    const el=document.getElementById(id);
    if(!el) return;
    const key=id;
    const apply=()=>{ FILTER_INTERACTION_UNTIL=Date.now()+1800; state[key]=el.value; renderPreservingField(id); };
    el.onchange=apply;
  });
  bindFilter('statsSede','statsSede');
  bindFilter('statsTrendMonths','statsTrendMonths');
  bindFilter('statsCompareSedeA','statsCompareSedeA');
  bindFilter('statsCompareSedeB','statsCompareSedeB');
  bindFilter('attendanceSearch','attendanceSearch');
  bindFilter('attendanceDate','attendanceDate');
  bindFilter('attendanceMonth','attendanceMonth');
  bindFilter('attendancePerson','attendancePerson');
  bindFilter('collaboratorStatus','collaboratorStatus');
  bindFilter('collaboratorSearch','collaboratorSearch');
  bindFilter('collaboratorRole','collaboratorRole');
  bindFilter('collaboratorSede','collaboratorSede');
  bindFilter('closureMonth','closureMonth');
  bindFilter('reportMonth','reportMonth');
  bindFilter('salaryMonth','salaryMonth');
  const salarySedeEl=document.getElementById('salarySede');
  if(salarySedeEl) salarySedeEl.onchange=()=>{
    state.salarySede=salarySedeEl.value;
    state.attendancePerson='';
    renderPreservingField('salarySede');
  };
  const attendanceSedeEl=document.getElementById('attendanceSede');
  if(attendanceSedeEl) attendanceSedeEl.onchange=()=>{
    state.attendanceSede=attendanceSedeEl.value;
    if(state.attendancePerson && !getAttendancePeople().some(person=>person.personId===state.attendancePerson)) state.attendancePerson='';
    renderPreservingField('attendanceSede');
  };
  const attendanceDepartmentEl=document.getElementById('attendanceDepartment');
  if(attendanceDepartmentEl) attendanceDepartmentEl.onchange=()=>{
    state.attendanceDepartment=attendanceDepartmentEl.value;
    if(state.attendancePerson){
      const stillVisible=getAttendancePeople().some(person=>person.personId===state.attendancePerson);
      if(!stillVisible) state.attendancePerson='';
    }
    renderPreservingField('attendanceDepartment');
  };
  const refreshRatingsBtn=document.getElementById('refreshRatingsBtn');
  if(refreshRatingsBtn) refreshRatingsBtn.onclick=async()=>{ await loadRatings(true); render(); };
  document.querySelectorAll('[data-rating-edit]').forEach(el=>{
    el.onclick=()=>{
      const rowKey=decodeURIComponent(el.dataset.ratingEdit);
      const row=RATINGS.find(item=>item.rowKey===rowKey);
      if(!row) return;
      state.ratingEdit={ ...row };
      render();
    };
  });
  document.querySelectorAll('[data-rating-delete]').forEach(el=>{ el.onclick=async()=>{
    const rowKey=decodeURIComponent(el.dataset.ratingDelete);
    const row=RATINGS.find(item=>item.rowKey===rowKey);
    if(!row) return;
    if(!await appConfirm(`Eliminar la calificación de ${row.matchedUserName || row.advisor} del ${fmtDateTime(row.date || row.rawDate)}? Podrás restaurarla desde Historial de cambios.`,{title:'Eliminar calificación',confirmText:'Eliminar',danger:true})) return;
    try{ await apiFetch('/api/ratings/deletions',{method:'DELETE',body:JSON.stringify({rowKey,month:ratingMonthKey()})}); CHANGE_LOGS=null; await loadRatings(true); render(); }
    catch(error){ await appAlert(error.message || 'No se pudo eliminar la calificación.'); }
  }; });
  const saveRatingSettingsBtn=document.getElementById('saveRatingSettingsBtn');
  if(saveRatingSettingsBtn) saveRatingSettingsBtn.onclick=async()=>{
    const requiredFields=Array.from(document.querySelectorAll('[data-rating-required]'))
      .filter(el=>el.checked)
      .map(el=>el.dataset.ratingRequired);
    saveRatingSettingsBtn.disabled=true;
    try{
      const payload=await apiFetch('/api/settings/ratings', {
        method:'POST',
        body:JSON.stringify({ requiredFields }),
        busyMessage:'Guardando configuracion...'
      });
      RATING_SETTINGS=payload.settings || RATING_SETTINGS;
      await loadRatings(true);
      await appAlert('Configuracion de calificaciones guardada.', 'Listo');
      render();
    }catch(error){
      await appAlert(error.message || 'No se pudo guardar la configuracion.', 'Error');
      saveRatingSettingsBtn.disabled=false;
    }
  };
  document.querySelectorAll('[data-rating-approve]').forEach(el=>{
    el.onclick=async()=>{
      const rowKey=decodeURIComponent(el.dataset.ratingApprove);
      if(!await appConfirm(`Aprobar esta calificacion? Recien con aprobacion suma ${money(getRatingCommission())} al sueldo.`, { title:'Aprobar calificacion', confirmText:'Aprobar' })) return;
      await submitRatingDecision(rowKey,'approve');
    };
  });
  document.querySelectorAll('[data-rating-reject]').forEach(el=>{
    el.onclick=async()=>{
      const rowKey=decodeURIComponent(el.dataset.ratingReject);
      const reason=await appPrompt('Motivo del rechazo:', { title:'Rechazar calificacion', confirmText:'Rechazar', danger:true });
      if(reason===null) return;
      await submitRatingDecision(rowKey,'reject',reason.trim());
    };
  });
  document.querySelectorAll('[data-rating-pending]').forEach(el=>{
    el.onclick=async()=>{
      const rowKey=decodeURIComponent(el.dataset.ratingPending);
      if(!await appConfirm('Volver esta calificacion a pendiente para revisarla otra vez?', { title:'Volver a pendiente', confirmText:'Volver a pendiente' })) return;
      await submitRatingDecision(rowKey,'pending');
    };
  });
  document.querySelectorAll('[data-attendance-tab]').forEach(el=>{ el.onclick=()=>{ state.attendanceTab=el.dataset.attendanceTab; render(); }; });
  document.querySelectorAll('[data-ptab]').forEach(el=>{ el.onclick=()=>{
    state.penaltyTab=el.dataset.ptab;
    state.penaltyStatus='';
    state.penaltyWorker='';
    state.penaltySearch='';
    PENALTY_REPORT_DRAFT_DIRTY=false;
    render();
  }; });
  const penaltyTargetSede=document.getElementById('penaltyTargetSede');
  if(penaltyTargetSede) penaltyTargetSede.onchange=()=>{
    state.penaltySede=penaltyTargetSede.value;
    state.penaltyWorker='';
    PENALTY_REPORT_DRAFT_DIRTY=true;
    renderPreservingField('penaltyTargetSede');
  };
  const penaltyWorker=document.getElementById('penaltyWorker');
  if(penaltyWorker) penaltyWorker.onchange=()=>{
    state.penaltyWorker=penaltyWorker.value;
    PENALTY_REPORT_DRAFT_DIRTY=true;
  };
  const penaltyCode=document.getElementById('penaltyCode');
  if(penaltyCode) penaltyCode.onchange=()=>{
    PENALTY_REPORT_DRAFT.penaltyCode=penaltyCode.value;
    PENALTY_REPORT_DRAFT_DIRTY=true;
  };
  [
    ['penaltyClientDni','clientDni'],
    ['penaltyClientName','clientName'],
    ['penaltyReason','reason']
  ].forEach(([id,key])=>{
    const el=document.getElementById(id);
    if(el) el.oninput=()=>{ PENALTY_REPORT_DRAFT[key]=el.value; PENALTY_REPORT_DRAFT_DIRTY=true; };
  });
  const penaltyForm=document.getElementById('penaltyReportForm');
  if(penaltyForm) penaltyForm.onsubmit=async e=>{
    e.preventDefault();
    const btn=document.getElementById('penaltySubmit');
    if(btn?.disabled) return;
    const workerId=Number(document.getElementById('penaltyWorker')?.value || 0);
    const worker=PENALTY_REPORT_USERS.find(user=>user.id===workerId);
    const payload={
      targetSede:document.getElementById('penaltyTargetSede')?.value || state.penaltySede,
      workerUserId:workerId || null,
      workerName:worker?.name || '',
      clientDni:document.getElementById('penaltyClientDni')?.value?.trim() || '',
      clientName:document.getElementById('penaltyClientName')?.value?.trim() || '',
      penaltyCode:document.getElementById('penaltyCode')?.value || '',
      reason:document.getElementById('penaltyReason')?.value?.trim() || ''
    };
    if(!payload.workerUserId){ await appAlert('Selecciona el trabajador de la sede destino.', 'Falta trabajador'); return; }
    if(!payload.clientDni || payload.clientDni.length<6){ await appAlert('Ingresa el DNI del cliente.', 'Falta DNI'); return; }
    if(!payload.clientName || payload.clientName.length<2){ await appAlert('Ingresa el nombre del cliente.', 'Falta cliente'); return; }
    if(!payload.reason || payload.reason.length<8){ await appAlert('Explica por que estas enviando esta penalidad.', 'Falta motivo'); return; }
    if(!await appConfirm('El reporte se enviara bloqueado y ya no podr- editarse. -Enviar ahora?', { title:'Enviar penalidad', confirmText:'Enviar reporte' })) return;
    if(btn) btn.disabled=true;
    try{
      const result=await apiFetch('/api/penalty-reports', {
        method:'POST',
        body:JSON.stringify(payload),
        busyMessage:'Enviando reporte de penalidad...'
      });
      const rule=getPenaltyRules().find(item=>item.code===payload.penaltyCode);
      const sameSede=payload.targetSede===userSede(state.currentUser);
      const localReport=mapPenaltyReport({
        ...(result.report||{}),
        id:result.report?.id || Date.now(),
        clientDni:payload.clientDni,
        clientName:payload.clientName,
        workerUserId:payload.workerUserId,
        workerName:payload.workerName,
        workerSede:payload.targetSede,
        targetSede:payload.targetSede,
        penaltyCode:payload.penaltyCode,
        penaltyLabel:rule?.label || 'Penalidad',
        penaltyAmount:rule?.amount || 0,
        reason:payload.reason,
        status:sameSede?'APPROVED':'PENDING',
        sentById:state.currentUser.id,
        sentBy:state.currentUser,
        receiver:null,
        decidedBy:sameSede?state.currentUser:null,
        decidedAt:sameSede?new Date().toISOString():'',
        decisionReason:sameSede?'Penalidad interna de la misma sede.':'',
        createdAt:new Date().toISOString()
      });
      PENALTY_REPORTS=[localReport, ...PENALTY_REPORTS.filter(item=>item.id!==localReport.id)];
      PENALTY_REPORT_DRAFT_DIRTY=false;
      state.penaltyTab='sent';
      state.penaltyStatus='';
      state.penaltyWorker='';
      state.penaltySearch='';
      PENALTY_REPORT_DRAFT={ clientDni:'', clientName:'', reason:'', penaltyCode:'' };
      render();
    }catch(error){
      if(btn) btn.disabled=false;
      await appAlert(error.message || 'No se pudo enviar el reporte.', 'Error');
    }
  };
  const paymentAuditWorker=document.getElementById('paymentAuditWorker');
  if(paymentAuditWorker) paymentAuditWorker.onchange=()=>{ PAYMENT_AUDIT_DRAFT.workerUserId=paymentAuditWorker.value; renderPreservingField('paymentAuditWorker'); };
  const paymentAuditType=document.getElementById('paymentAuditType');
  if(paymentAuditType) paymentAuditType.onchange=()=>{ PAYMENT_AUDIT_DRAFT.type=paymentAuditType.value; };
  const paymentAuditReason=document.getElementById('paymentAuditReason');
  if(paymentAuditReason) paymentAuditReason.oninput=()=>{ PAYMENT_AUDIT_DRAFT.reason=paymentAuditReason.value; };
  const applyPaymentAuditEvidence=file=>{
    if(!file) return;
    if(!['image/png','image/jpeg','image/webp'].includes(file.type)){
      appAlert('Usa una imagen PNG, JPG o WEBP.', 'Formato no válido');
      return;
    }
    if(file.size>2*1024*1024){
      appAlert('La captura debe pesar como máximo 2 MB.', 'Captura muy pesada');
      return;
    }
    const reader=new FileReader();
    reader.onload=()=>{
      PAYMENT_AUDIT_DRAFT.evidenceImage=String(reader.result||'');
      render();
    };
    reader.readAsDataURL(file);
  };
  const paymentAuditFile=document.getElementById('paymentAuditEvidenceFile');
  if(paymentAuditFile) paymentAuditFile.onchange=()=>applyPaymentAuditEvidence(paymentAuditFile.files?.[0]);
  const paymentAuditPaste=document.getElementById('paymentAuditPaste');
  if(paymentAuditPaste){
    paymentAuditPaste.onpaste=event=>{
      const items=Array.from(event.clipboardData?.items||[]);
      const item=items.find(candidate=>candidate.type.startsWith('image/'));
      if(!item) return;
      event.preventDefault();
      applyPaymentAuditEvidence(item.getAsFile());
    };
    paymentAuditPaste.ondragover=event=>event.preventDefault();
    paymentAuditPaste.ondrop=event=>{
      event.preventDefault();
      applyPaymentAuditEvidence(event.dataTransfer?.files?.[0]);
    };
  }
  const paymentAuditEvidenceClear=document.getElementById('paymentAuditEvidenceClear');
  if(paymentAuditEvidenceClear) paymentAuditEvidenceClear.onclick=()=>{ PAYMENT_AUDIT_DRAFT.evidenceImage=''; render(); };
  const paymentAuditForm=document.getElementById('paymentAuditForm');
  if(paymentAuditForm) paymentAuditForm.onsubmit=async event=>{
    event.preventDefault();
    const button=document.getElementById('paymentAuditSubmit');
    const payload={
      workerUserId:Number(PAYMENT_AUDIT_DRAFT.workerUserId || 0),
      type:PAYMENT_AUDIT_DRAFT.type || 'DATA_ERROR',
      reason:String(document.getElementById('paymentAuditReason')?.value||'').trim(),
      evidenceImage:PAYMENT_AUDIT_DRAFT.evidenceImage
    };
    if(!payload.workerUserId){ await appAlert('Selecciona el asesor con el error.', 'Falta asesor'); return; }
    if(payload.reason.length<8){ await appAlert('Explica el error con un poco más de detalle.', 'Falta motivo'); return; }
    if(!payload.evidenceImage){ await appAlert('Pega la captura con Ctrl + V o selecciona una imagen.', 'Falta captura'); return; }
    if(!await appConfirm('La solicitud se enviará a la jefa de sede del asesor. El descuento y bono solo se aplicarán si ella la aprueba.', { title:'Enviar auditoría de pagos', confirmText:'Enviar solicitud' })) return;
    if(button) button.disabled=true;
    try{
      const result=await apiFetch('/api/payment-audits', { method:'POST', body:JSON.stringify(payload), busyMessage:'Enviando solicitud de auditoría...' });
      const target=PENALTY_REPORT_USERS.find(user=>Number(user.id)===payload.workerUserId);
      const report=mapPenaltyReport({
        ...(result.report||{}), id:result.report?.id||Date.now(), clientDni:'AUDITORIA-PAGOS', clientName:target?.name||'',
        workerUserId:payload.workerUserId, workerName:target?.name||'', workerSede:target?userSede(target):'', targetSede:target?userSede(target):'',
        penaltyCode:payload.type==='CHAT_ABANDONMENT'?'PAYMENT_AUDIT_CHAT_ABANDONMENT':'PAYMENT_AUDIT_DATA_ERROR', penaltyLabel:payload.type==='CHAT_ABANDONMENT'?'Abandono de chat':'Error de datos', penaltyAmount:2, category:'PAYMENT_AUDIT',
        evidenceImage:payload.evidenceImage, managerPenaltyAmount:payload.type==='CHAT_ABANDONMENT'?2:0, reporterBonusAmount:1, reason:payload.reason, status:'PENDING',
        sentById:state.currentUser.id, sentBy:state.currentUser, receiver:null, createdAt:new Date().toISOString()
      });
      PENALTY_REPORTS=[report,...PENALTY_REPORTS.filter(item=>Number(item.id)!==Number(report.id))];
      PAYMENT_AUDIT_DRAFT={ workerUserId:'', type:'DATA_ERROR', reason:'', evidenceImage:'' };
      state.paymentAuditSearch='';
      render();
    }catch(error){
      if(button) button.disabled=false;
      await appAlert(error.message||'No se pudo enviar la solicitud.', 'Error');
    }
  };
  document.querySelectorAll('[data-payment-audit-evidence]').forEach(element=>{
    element.onclick=()=>{
      const report=PENALTY_REPORTS.find(item=>Number(item.id)===Number(element.dataset.paymentAuditEvidence));
      if(report?.evidenceImage) window.open(report.evidenceImage, '_blank', 'noopener');
    };
  });
  const saveSafetypayBtn=document.getElementById('saveSafetypayBtn');
  const syncSafetypayDraft=()=>{
    SAFETYPAY_DRAFT={
      clientDni:document.getElementById('spDni')?.value || '',
      cardLast4:document.getElementById('spCard')?.value || '',
      customerCode:document.getElementById('spCustomerCode')?.value || '',
      bank:document.getElementById('spBank')?.value || 'CMR',
      code:document.getElementById('spCode')?.value || 'ATK1',
      amount:document.getElementById('spAmount')?.value || '',
      operationNumber:document.getElementById('spOperation')?.value || ''
    };
    SAFETYPAY_DRAFT_DIRTY=true;
  };
  ['spDni','spCard','spCustomerCode','spAmount','spOperation'].forEach(id=>{
    const el=document.getElementById(id);
    if(el) el.oninput=syncSafetypayDraft;
  });
  ['spBank','spCode'].forEach(id=>{
    const el=document.getElementById(id);
    if(el) el.onchange=syncSafetypayDraft;
  });
  if(saveSafetypayBtn) saveSafetypayBtn.onclick=async()=>{
    syncSafetypayDraft();
    const payload={
      clientDni:document.getElementById('spDni')?.value?.trim() || '',
      cardLast4:document.getElementById('spCard')?.value?.trim() || '',
      customerCode:document.getElementById('spCustomerCode')?.value?.trim() || '',
      bank:document.getElementById('spBank')?.value || 'CMR',
      code:document.getElementById('spCode')?.value || 'ATK1',
      amount:Number(document.getElementById('spAmount')?.value || 0),
      operationNumber:document.getElementById('spOperation')?.value?.trim() || ''
    };
    if(payload.clientDni.length<6){ await appAlert('Ingresa el DNI del cliente.', 'Falta DNI'); return; }
    if(!/^\d{4}$/.test(payload.cardLast4)){ await appAlert('Ingresa los 4 -ltimos digitos de la tarjeta.', 'Falta tarjeta'); return; }
    if(!/^\d{6}$/.test(payload.customerCode)){ await appAlert('Ingresa el codigo de 6 digitos que se le dio al cliente.', 'Falta codigo cliente'); return; }
    if(!payload.amount || payload.amount<=0){ await appAlert('Ingresa un monto valido.', 'Falta monto'); return; }
    if(payload.operationNumber.length<3){ await appAlert('Ingresa el numero de operacion.', 'Falta operacion'); return; }
    const isEditing=Number.isFinite(Number(SAFETYPAY_EDIT_ID)) && Number(SAFETYPAY_EDIT_ID)>0;
    const duplicates=findSafetypayDraftDuplicates(payload, isEditing ? Number(SAFETYPAY_EDIT_ID) : null);
    if(duplicates.length){
      const reasons=[...new Set(duplicates.flatMap(item=>[
        item.sameCode ? 'codigo cliente' : '',
        item.sameOperation ? 'numero de operacion' : ''
      ]).filter(Boolean))].join(' y ');
      const preview=duplicates.slice(0,3).map(item=>{
        const entry=item.entry;
        const owner=entry.user || getUserById(entry.userId);
        return `${entry.customerCode || '-'} / ${entry.operationNumber || '-'} - ${owner.name} - ${money(entry.amount)}`;
      }).join('\n');
      const shouldContinue=await appConfirm(`Ya existe Safetypay con el mismo ${reasons} en este mes:\n\n${preview}${duplicates.length>3?`\n... y ${duplicates.length-3} mas`:''}\n\nQuieres guardarlo de todas formas?`, { title:'SafetyPay duplicado', confirmText:'Guardar igual', danger:true });
      if(!shouldContinue) return;
    }
    saveSafetypayBtn.disabled=true;
    try{
      const requestBody=isEditing ? { id:Number(SAFETYPAY_EDIT_ID), ...payload } : payload;
      const result=await apiFetch('/api/safetypay', {
        method:isEditing?'PATCH':'POST',
        body:JSON.stringify(requestBody),
        busyMessage:isEditing?'Actualizando codigo Safetypay...':'Guardando codigo Safetypay...'
      });
      const mappedEntry=mapSafetypayCode({
        ...(result.entry||{}),
        userId:result.entry?.userId || state.currentUser.id,
        user:result.entry?.user || state.currentUser,
        createdAt:result.entry?.createdAt || new Date().toISOString(),
        ...payload
      });
      if(isEditing){
        SAFETYPAY_CODES=SAFETYPAY_CODES.map(item=>Number(item.id)===Number(mappedEntry.id)?mappedEntry:item);
      }else{
        SAFETYPAY_CODES=[mappedEntry, ...SAFETYPAY_CODES];
      }
      resetSafetypayDraft();
      await appAlert(isEditing?'Codigo Safetypay actualizado.':'Codigo Safetypay guardado.', 'Listo');
      render();
    }catch(error){
      saveSafetypayBtn.disabled=false;
      await appAlert(error.message || 'No se pudo guardar el codigo.', 'Error');
    }
  };
  const cancelSafetypayEdit=document.getElementById('cancelSafetypayEdit');
  if(cancelSafetypayEdit) cancelSafetypayEdit.onclick=()=>{
    resetSafetypayDraft();
    render();
  };
  document.querySelectorAll('[data-safetypay-edit]').forEach(el=>{
    el.onclick=()=>{
      const id=Number(el.dataset.safetypayEdit);
      const entry=SAFETYPAY_CODES.find(item=>Number(item.id)===id);
      if(!entry) return;
      SAFETYPAY_EDIT_ID=id;
      SAFETYPAY_DRAFT={
        clientDni:String(entry.clientDni || ''),
        cardLast4:String(entry.cardLast4 || ''),
        customerCode:String(entry.customerCode || ''),
        bank:String(entry.bank || 'CMR'),
        code:String(entry.code || 'ATK1'),
        amount:String(entry.amount || ''),
        operationNumber:String(entry.operationNumber || '')
      };
      SAFETYPAY_DRAFT_DIRTY=false;
      state.safetypayEdit=true;
      render();
      document.getElementById('safetypayEditDni')?.focus();
    };
  });
  document.querySelectorAll('[data-safetypay-delete]').forEach(el=>{
    el.onclick=async()=>{
      const id=Number(el.dataset.safetypayDelete);
      const entry=SAFETYPAY_CODES.find(item=>Number(item.id)===id);
      const label=entry ? `${entry.bank} ${entry.code} - ${money(entry.amount)}` : 'este codigo';
      if(!await appConfirm(`Eliminar ${label}? Esta accion quitar- el monto de la meta Safetypay.`, { title:'Eliminar codigo CMR', confirmText:'Eliminar', danger:true })) return;
      try{
        SUPPRESSED_SAFETYPAY_NOTIFY_IDS.add(id);
        await apiFetch(`/api/safetypay?id=${encodeURIComponent(id)}`, {
          method:'DELETE',
          busyMessage:'Eliminando codigo Safetypay...'
        });
        SAFETYPAY_CODES=SAFETYPAY_CODES.filter(item=>Number(item.id)!==id);
        if(Number(SAFETYPAY_EDIT_ID)===id) resetSafetypayDraft();
        render();
      }catch(error){
        await appAlert(error.message || 'No se pudo eliminar el codigo.', 'Error');
      }
    };
  });
  document.querySelectorAll('[data-penalty-approve]').forEach(el=>{
    el.onclick=async()=>{
      if(!await appConfirm('Aprobar esta penalidad? Quedara aceptada por la sede responsable.', { title:'Aprobar penalidad', confirmText:'Aprobar' })) return;
      await apiFetch(`/api/penalty-reports/${el.dataset.penaltyApprove}/decision`, {
        method:'POST',
        body:JSON.stringify({ action:'approve' }),
        busyMessage:'Aprobando penalidad...'
      });
      PENALTY_REPORTS=PENALTY_REPORTS.map(report=>report.id==el.dataset.penaltyApprove ? {
        ...report,
        status:'APPROVED',
        pendingApproval:false,
        decidedBy:state.currentUser,
        decidedById:state.currentUser.id,
        decidedAt:new Date().toISOString(),
        decisionReason:''
      } : report);
      render();
    };
  });
  document.querySelectorAll('[data-penalty-reject]').forEach(el=>{
    el.onclick=async()=>{
      const reason=await appPrompt('Motivo del rechazo:', { title:'Rechazar penalidad', confirmText:'Rechazar', danger:true });
      if(reason===null) return;
      if(!reason.trim()){ await appAlert('Debes escribir el motivo del rechazo.', 'Falta motivo'); return; }
      await apiFetch(`/api/penalty-reports/${el.dataset.penaltyReject}/decision`, {
        method:'POST',
        body:JSON.stringify({ action:'reject', reason:reason.trim() }),
        busyMessage:'Rechazando penalidad...'
      });
      PENALTY_REPORTS=PENALTY_REPORTS.map(report=>report.id==el.dataset.penaltyReject ? {
        ...report,
        status:'REJECTED',
        pendingApproval:false,
        decidedBy:state.currentUser,
        decidedById:state.currentUser.id,
        decidedAt:new Date().toISOString(),
        decisionReason:reason.trim()
      } : report);
      render();
    };
  });
  document.querySelectorAll('[data-penalty-delete]').forEach(el=>{
    el.onclick=async()=>{
      const report=PENALTY_REPORTS.find(item=>item.id==el.dataset.penaltyDelete);
      const label=report ? `${report.penaltyLabel} de ${report.workerName}` : 'esta penalidad';
      if(!await appConfirm(`Eliminar ${label}? Esta accion solo la puede hacer el admin.`, { title:'Eliminar penalidad', confirmText:'Eliminar', danger:true })) return;
      await apiFetch(`/api/penalty-reports/${el.dataset.penaltyDelete}`, {
        method:'DELETE',
        busyMessage:'Eliminando penalidad...'
      });
      PENALTY_REPORTS=PENALTY_REPORTS.filter(item=>item.id!=el.dataset.penaltyDelete);
      render();
    };
  });
  document.querySelectorAll('[data-salary-detail], [data-salary-detail-btn]').forEach(el=>{
    el.onclick=e=>{
      e.preventDefault();
      e.stopPropagation();
      openSalaryDetail(el.dataset.salaryDetail || el.dataset.salaryDetailBtn);
    };
  });
  const reportModeEl=document.getElementById('reportMode');
  if(reportModeEl) reportModeEl.onchange=()=>{
    state.reportMode=reportModeEl.value;
    if(state.reportMode==='all') state.reportUser='';
    renderPreservingField('reportMode');
  };
  const reportUserEl=document.getElementById('reportUser');
  if(reportUserEl) reportUserEl.onchange=()=>{ state.reportUser=reportUserEl.value; renderPreservingField('reportUser'); };
  const reportSedeEl=document.getElementById('reportSede');
  if(reportSedeEl) reportSedeEl.onchange=()=>{
    state.reportSede=reportSedeEl.value;
    renderPreservingField('reportSede');
  };

  const closureRefresh=document.getElementById('closureRefresh');
  if(closureRefresh) closureRefresh.onclick=async()=>{ await refreshState(true); await loadAttendance(true); preserveMainScroll(()=>render()); };
  const closeMonth=document.getElementById('closeMonth');
  if(closeMonth) closeMonth.onclick=async()=>{
    const snapshot=buildMonthlyClosureSnapshot();
    if(Number(snapshot.pending.unpaidSalaries||0)>0){
      await appAlert('Primero marca todos los sueldos como pagados antes de cerrar el mes.', 'Cierre bloqueado');
      return;
    }
    if(Number(snapshot.pending.unpaidCommissions||0)>0){
      await appAlert('Faltan comisiones por marcar como pagadas. Paga/completa el Pago 2 antes de cerrar el mes.', 'Cierre bloqueado');
      return;
    }
    const pendingTotal=Object.values(snapshot.pending).reduce((sum,value)=>sum+Number(value||0),0);
    const message=pendingTotal
      ? `Hay ${pendingTotal} pendiente(s). Puedes cerrar igual, pero quedar-n guardados en el cierre. Cerrar ${snapshot.summary.monthLabel}?`
      : `Cerrar ${snapshot.summary.monthLabel}? El mes quedar- bloqueado para ediciones.`;
    if(!await appConfirm(message, { title:'Cerrar mes', confirmText:'Cerrar mes', danger:!!pendingTotal })) return;
    try{
      const payload=await apiFetch('/api/monthly-closures', {
        method:'POST',
        body:JSON.stringify({ action:'close', month:snapshot.month, summary:snapshot.summary, details:snapshot.details, pending:snapshot.pending }),
        busyMessage:'Cerrando mes...'
      });
      MONTHLY_CLOSURES=payload.closures||[];
      render();
    }catch(error){
      await appAlert(error.message || 'No se pudo cerrar el mes.', 'Error');
    }
  };
  const reopenMonth=document.getElementById('reopenMonth');
  if(reopenMonth) reopenMonth.onclick=async()=>{
    const month=getSelectedClosureMonth();
    const reason=await appPrompt('Motivo para reabrir el mes:', { title:'Reabrir mes', confirmText:'Reabrir', danger:true });
    if(reason===null) return;
    try{
      const payload=await apiFetch('/api/monthly-closures', {
        method:'POST',
        body:JSON.stringify({ action:'reopen', month, reason }),
        busyMessage:'Reabriendo mes...'
      });
      MONTHLY_CLOSURES=payload.closures||[];
      render();
    }catch(error){
      await appAlert(error.message || 'No se pudo reabrir el mes.', 'Error');
    }
  };
  const closurePdf=document.getElementById('closurePdf');
  if(closurePdf) closurePdf.onclick=()=>{
    const snapshot=buildMonthlyClosureSnapshot();
    const rows=snapshot.details.map(row=>`<tr><td>${row.personName}<br><small>${row.personId}</small></td><td>${row.payrollRole||'-'}</td><td>${money(row.salary)}</td><td>${money(row.bonus)}</td><td>${money(row.discounts)}</td><td>${money(row.commission)}</td><td>${money(row.referralCommission)}</td><td>${row.paid?'Sueldo pagado':'Sueldo pendiente'}</td></tr>`).join('');
    const w=window.open('', '_blank');
    if(!w) return;
    w.document.write(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>Cierre ${snapshot.summary.monthLabel}</title><style>body{margin:0;font-family:Segoe UI,Arial,sans-serif;background:#090d16;color:#e5eefc;padding:28px}.hero{background:linear-gradient(135deg,#172033,#101827);border:1px solid #2a3550;border-radius:22px;padding:24px;margin-bottom:18px}h1{margin:0;font-size:30px}.sub{color:#9aa7c7;margin-top:6px}.grid{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:18px}.card{background:#1a1f30;border:1px solid #2a3550;border-radius:16px;padding:16px}.label{font-size:11px;text-transform:uppercase;color:#7f8baa;letter-spacing:.08em}.value{font-size:24px;color:#22c97a;font-weight:800;margin-top:8px}table{width:100%;border-collapse:collapse;background:#1a1f30;border-radius:16px;overflow:hidden}th,td{border-bottom:1px solid #2a3550;padding:10px;text-align:left;font-size:12px}th{background:#111520;color:#7f8baa;text-transform:uppercase;letter-spacing:.05em}@media print{body{background:#fff;color:#111;padding:0}.hero,.card,table{break-inside:avoid}}</style></head><body><div class="hero"><h1>Cierre mensual ${snapshot.summary.monthLabel}</h1><div class="sub">Generado por ${state.currentUser.name} - ${new Date().toLocaleString()}</div></div><div class="grid"><div class="card"><div class="label">Sueldos</div><div class="value">${money(snapshot.summary.salaryTotal)}</div></div><div class="card"><div class="label">Comisiones</div><div class="value">${money(snapshot.summary.commissionTotal)}</div></div><div class="card"><div class="label">Referidos</div><div class="value">${money(snapshot.summary.referralTotal)}</div></div><div class="card"><div class="label">Total</div><div class="value">${money(snapshot.summary.totalToPay)}</div></div></div><table><thead><tr><th>Colaborador</th><th>Cargo</th><th>Sueldo</th><th>Bono</th><th>Desc.</th><th>Comision</th><th>Referidos</th><th>Pago</th></tr></thead><tbody>${rows||'<tr><td colspan="8">Sin detalle.</td></tr>'}</tbody></table><script>window.onload=()=>window.print();<\/script></body></html>`);
    w.document.close();
  };
  const archiveJsonInput=document.getElementById('archiveJsonInput');
  if(archiveJsonInput) archiveJsonInput.onchange=async()=>{
    const file=archiveJsonInput.files && archiveJsonInput.files[0];
    if(!file) return;
    try{
      const raw=await file.text();
      const parsed=JSON.parse(raw);
      if(!parsed || !parsed.month || !parsed.closure || !parsed.modules){
        throw new Error('El JSON no tiene el formato esperado del archivo mensual.');
      }
      state.archiveViewer=parsed;
      render();
    }catch(error){
      await appAlert(error.message || 'No se pudo leer el archivo JSON.', 'Error');
      archiveJsonInput.value='';
    }
  };
  const clearArchiveViewer=document.getElementById('clearArchiveViewer');
  if(clearArchiveViewer) clearArchiveViewer.onclick=()=>{
    state.archiveViewer=null;
    render();
  };

  // alert tabs
  document.querySelectorAll('[data-atab]').forEach(el=>{ el.onclick=()=>{ state.alertTab=el.dataset.atab; render(); }; });
  document.querySelectorAll('[data-atab2]').forEach(el=>{ el.onclick=()=>{ state.adminTab=el.dataset.atab2; render(); }; });
  const backupButton=document.getElementById('downloadFullBackup');
  if(backupButton) backupButton.onclick=async()=>{
    backupButton.disabled=true;showBusy('Creando respaldo completo cifrado...');
    try{
      const response=await fetch('/api/admin/full-backup',{method:'POST',credentials:'same-origin',cache:'no-store',headers:sessionRequestHeaders()});
      if(!response.ok){ const payload=await response.json().catch(()=>({})); throw new Error(payload.error||'No se pudo completar el respaldo.'); }
      const url=URL.createObjectURL(await response.blob()),link=document.createElement('a');link.href=url;link.download='registros-atk-respaldo-completo.atkbackup';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
    }catch(error){await appAlert(error.message,'Respaldo');}finally{backupButton.disabled=false;hideBusy();}
  };
  document.querySelectorAll('[data-retry-modules]').forEach(el=>{
    el.onclick=()=>{
      String(el.dataset.retryModules || '').split(',').filter(Boolean).forEach(module=>{
        const key=stateModuleLoadKey(module);
        delete STATE_MODULE_ERRORS[key];
        STATE_MODULES_LOADING.delete(key);
      });
      render();
    };
  });
  const retryMyCommissionsRatings=document.getElementById('retryMyCommissionsRatings');
  if(retryMyCommissionsRatings) retryMyCommissionsRatings.onclick=async()=>{
    RATINGS_ERROR='';
    await loadRatings(true);
    render();
  };

  // edit btns
  document.querySelectorAll('[data-edit]').forEach(el=>{ el.onclick=()=>{ state.modal=parseInt(el.dataset.edit); render(); }; });
  document.querySelectorAll('[data-validate]').forEach(el=>{ el.onclick=async()=>{ await validateRecord(parseInt(el.dataset.validate)); render(); }; });
  document.querySelectorAll('[data-reject]').forEach(el=>{ el.onclick=async()=>{ const reason=await appPrompt('Escribe el motivo del rechazo:', { title:'Rechazar registro', confirmText:'Rechazar', danger:true }); if(reason&&reason.trim()){ await rejectRecord(parseInt(el.dataset.reject), reason.trim()); render(); } }; });
  document.querySelectorAll('[data-ref-validate]').forEach(el=>{ el.onclick=async()=>{ await validateReferral(parseInt(el.dataset.refValidate)); render(); }; });
  document.querySelectorAll('[data-ref-reject]').forEach(el=>{ el.onclick=async()=>{ const reason=await appPrompt('Escribe el motivo del rechazo:', { title:'Rechazar referido', confirmText:'Rechazar', danger:true }); if(reason&&reason.trim()){ await rejectReferral(parseInt(el.dataset.refReject), reason.trim()); render(); } }; });
  document.querySelectorAll('[data-ref-delete]').forEach(el=>{ el.onclick=async()=>{ if(!await appConfirm('Eliminar este referido?', { title:'Eliminar referido', confirmText:'Eliminar', danger:true })) return; try{ await apiFetch(`/api/referrals/${el.dataset.refDelete}`, { method:'DELETE', busyMessage:'Eliminando referido...' }); await refreshState(false, [...new Set([...CORE_STATE_MODULES, 'referrals'])]); render(); }catch(error){ await appAlert(error.message||'No se pudo eliminar el referido.', 'Error'); } }; });
  const syncCallDraft=()=>{
    CALL_DRAFT={
      clientDni:document.getElementById('callDni')?.value || '',
      clientName:document.getElementById('callName')?.value || ''
    };
    CALL_DRAFT_DIRTY=true;
  };
  ['callDni','callName'].forEach(id=>{
    const el=document.getElementById(id);
    if(el) el.oninput=syncCallDraft;
  });
  const saveCallBtn=document.getElementById('saveCallBtn');
  if(saveCallBtn) saveCallBtn.onclick=async()=>{
    syncCallDraft();
    const payload={
      clientDni:document.getElementById('callDni')?.value?.trim() || '',
      clientName:document.getElementById('callName')?.value?.trim() || ''
    };
    if(payload.clientDni.length<6){ await appAlert('Ingresa el DNI del cliente.', 'Falta DNI'); return; }
    if(payload.clientName.length<2){ await appAlert('Ingresa el nombre del cliente.', 'Falta cliente'); return; }
    saveCallBtn.disabled=true;
    try{
      const result=await apiFetch('/api/calls', {
        method:'POST',
        body:JSON.stringify(payload),
        busyMessage:'Guardando llamada...'
      });
      CALL_REPORTS=[mapCallReport({
        ...(result.report||{}),
        id:result.report?.id || Date.now(),
        userId:state.currentUser.id,
        user:state.currentUser,
        clientDni:payload.clientDni,
        clientName:payload.clientName,
        status:'PENDING',
        bonusAmount:getCallCommission(),
        createdAt:new Date().toISOString()
      }), ...CALL_REPORTS];
      CALL_DRAFT_DIRTY=false;
      CALL_DRAFT={ clientDni:'', clientName:'' };
      render();
    }catch(error){
      saveCallBtn.disabled=false;
      await appAlert(error.message || 'No se pudo guardar la llamada.', 'Error');
    }
  };
  document.querySelectorAll('[data-call-validate]').forEach(el=>{
    el.onclick=async()=>{
      await apiFetch(`/api/calls/${el.dataset.callValidate}/decision`, {
        method:'POST',
        body:JSON.stringify({ action:'validate' }),
        busyMessage:'Aprobando llamada...'
      });
      CALL_REPORTS=CALL_REPORTS.map(report=>report.id==el.dataset.callValidate?{...report,status:'APPROVED',validatedAt:todayStr(),pendingApproval:false}:report);
      preserveMainScroll(()=>render());
    };
  });
  document.querySelectorAll('[data-call-reject]').forEach(el=>{
    el.onclick=async()=>{
      const reason=await appPrompt('Motivo del rechazo:', { title:'Rechazar llamada', confirmText:'Rechazar', danger:true });
      if(reason===null) return;
      if(!reason.trim()){ await appAlert('Debes escribir el motivo del rechazo.', 'Falta motivo'); return; }
      await apiFetch(`/api/calls/${el.dataset.callReject}/decision`, {
        method:'POST',
        body:JSON.stringify({ action:'reject', reason:reason.trim() }),
        busyMessage:'Rechazando llamada...'
      });
      CALL_REPORTS=CALL_REPORTS.map(report=>report.id==el.dataset.callReject?{...report,status:'REJECTED',rejectedAt:todayStr(),rejectionReason:reason.trim(),pendingApproval:false}:report);
      preserveMainScroll(()=>render());
    };
  });
  const saveWrongCardBtn=document.getElementById('saveWrongCardBtn');
  if(saveWrongCardBtn) saveWrongCardBtn.onclick=async()=>{
    const payload={
      clientDni:document.getElementById('wcDni')?.value?.trim() || '',
      clientName:document.getElementById('wcName')?.value?.trim() || '',
      detectedDate:document.getElementById('wcDate')?.value || todayStr(),
      notes:document.getElementById('wcNotes')?.value?.trim() || ''
    };
    if(payload.clientDni.length<6){ await appAlert('Ingresa el DNI del cliente.', 'Falta DNI'); return; }
    if(payload.clientName.length<2){ await appAlert('Ingresa el nombre del cliente.', 'Falta cliente'); return; }
    saveWrongCardBtn.disabled=true;
    try{
      const result=await apiFetch('/api/wrong-cards', {
        method:'POST',
        body:JSON.stringify(payload),
        busyMessage:'Guardando tarjeta...'
      });
      WRONG_CARDS=[mapWrongCard({
        ...(result.report||{}),
        id:result.report?.id || Date.now(),
        userId:state.currentUser.id,
        clientDni:payload.clientDni,
        clientName:payload.clientName,
        detectedDate:payload.detectedDate,
        notes:payload.notes,
        status:'PENDING',
        bonusAmount:10,
        createdAt:new Date().toISOString()
      }), ...WRONG_CARDS];
      render();
    }catch(error){
      saveWrongCardBtn.disabled=false;
      await appAlert(error.message || 'No se pudo guardar la tarjeta.', 'Error');
    }
  };
  document.querySelectorAll('[data-wc-validate]').forEach(el=>{
    el.onclick=async()=>{
      await apiFetch(`/api/wrong-cards/${el.dataset.wcValidate}/decision`, {
        method:'POST',
        body:JSON.stringify({ action:'validate' }),
        busyMessage:'Aprobando tarjeta...'
      });
      WRONG_CARDS=WRONG_CARDS.map(report=>report.id==el.dataset.wcValidate?{...report,status:'APPROVED',validatedAt:todayStr(),pendingApproval:false}:report);
      render();
    };
  });
  document.querySelectorAll('[data-wc-reject]').forEach(el=>{
    el.onclick=async()=>{
      const reason=await appPrompt('Motivo del rechazo:', { title:'Rechazar tarjeta', confirmText:'Rechazar', danger:true });
      if(reason===null) return;
      if(!reason.trim()){ await appAlert('Debes escribir el motivo del rechazo.', 'Falta motivo'); return; }
      await apiFetch(`/api/wrong-cards/${el.dataset.wcReject}/decision`, {
        method:'POST',
        body:JSON.stringify({ action:'reject', reason:reason.trim() }),
        busyMessage:'Rechazando tarjeta...'
      });
      WRONG_CARDS=WRONG_CARDS.map(report=>report.id==el.dataset.wcReject?{...report,status:'REJECTED',rejectedAt:todayStr(),rejectionReason:reason.trim(),pendingApproval:false}:report);
      render();
    };
  });
  document.querySelectorAll('[data-ref-repeat]').forEach(el=>{
    el.onclick=()=>{
      const referral=REFERRALS.find(r=>r.id===parseInt(el.dataset.refRepeat));
      if(!referral) return;
      const nameEl=document.getElementById('refName');
      const dniEl=document.getElementById('refDni');
      const amountEl=document.getElementById('refAmount');
      const bankEl=document.getElementById('refBank');
      const notesEl=document.getElementById('refNotes');
      if(nameEl) nameEl.value=referral.cliente;
      if(dniEl) dniEl.value=referral.dni;
      if(amountEl) amountEl.value='';
      if(bankEl) bankEl.value=referral.bank;
      if(notesEl) notesEl.value='Nueva efectivizacion';
      REFERRAL_DRAFT_DIRTY=true;
      REFERRAL_DRAFT={ clientName:referral.cliente, dni:referral.dni, amount:'', bank:referral.bank, notes:'Nueva efectivizacion' };
      const main=document.querySelector('.main');
      if(main) main.scrollTop=0;
      if(amountEl) amountEl.focus();
      const preview=document.getElementById('refCalcPreview');
      if(preview) preview.textContent='Monto base: S/ 0.00 - Comision referido: S/ 0.00';
    };
  });

  const refAmount=document.getElementById('refAmount');
  const refBank=document.getElementById('refBank');
  const refPreview=document.getElementById('refCalcPreview');
  const syncReferralDraft=()=>{
    REFERRAL_DRAFT={
      clientName:document.getElementById('refName')?.value || '',
      dni:document.getElementById('refDni')?.value || '',
      amount:document.getElementById('refAmount')?.value || '',
      bank:document.getElementById('refBank')?.value || 'BBVA',
      notes:document.getElementById('refNotes')?.value || ''
    };
    REFERRAL_DRAFT_DIRTY=true;
  };
  const updateReferralPreview=()=>{
    if(!refAmount||!refBank||!refPreview) return;
    syncReferralDraft();
    const amount=Number(refAmount.value||0);
    const bankCommission=calcReferralBankCommission(refBank.value, amount);
    const referralCommission=calcReferralCommission(refBank.value, amount);
    refPreview.textContent=`Monto base: S/ ${bankCommission.toFixed(2)} - Comision referido: S/ ${referralCommission.toFixed(2)}`;
  };
  ['refName','refDni','refNotes'].forEach(id=>{
    const el=document.getElementById(id);
    if(el) el.oninput=syncReferralDraft;
  });
  if(refAmount) refAmount.oninput=updateReferralPreview;
  if(refBank) refBank.onchange=updateReferralPreview;
  const resetReferralMonth=document.getElementById('resetReferralMonth');
  if(resetReferralMonth) resetReferralMonth.onclick=async()=>{
    resetReferralMonth.disabled=true;
    try{
      const preview=await apiFetch('/api/referrals/reset');
      if(preview.month!==activeMonthKey(state.referralMonth)){await appAlert('Selecciona el mes actual para restablecer sus referidos.');return;}
      if(!preview.approved && !preview.rejected){await appAlert('Todos los referidos de este mes ya están pendientes.');return;}
      if(!await appConfirm('Se restablecerán '+(preview.approved+preview.rejected)+' referido(s) de '+monthLabelFromKey(preview.month)+' a pendientes. Solo Jhonatan o un administrador podrán aprobarlos nuevamente. Los meses anteriores no cambiarán. ¿Continuar?'))return;
      const result=await apiFetch('/api/referrals/reset',{method:'POST',body:JSON.stringify({month:preview.month,revision:preview.revision,confirm:'RESET_CURRENT_MONTH'})});
      CHANGE_LOGS=null;
      await refreshState(true,['referrals']);
      render();
      await appAlert(result.changed+' referido(s) restablecidos. '+result.pending+' pendientes en '+monthLabelFromKey(result.month)+'.');
    }catch(error){await appAlert(error.message || 'No se pudieron restablecer los referidos.');}
    finally{resetReferralMonth.disabled=false;}
  };
  const saveReferralBtn=document.getElementById('saveReferralBtn');
  if(saveReferralBtn) saveReferralBtn.onclick=async()=>{
    const clientName=document.getElementById('refName').value.trim();
    const dni=document.getElementById('refDni').value.trim();
    const amount=Number(document.getElementById('refAmount').value||0);
    const bank=document.getElementById('refBank').value;
    const notes=document.getElementById('refNotes').value.trim();
    if(!clientName||!dni||!amount){ await appAlert('Completa nombre, DNI y monto.'); return; }
    saveReferralBtn.disabled=true;
    saveReferralBtn.textContent='Guardando...';
    try{
      await apiFetch('/api/referrals', {
        method:'POST',
        body:JSON.stringify({ clientName, dni, amount, bank, notes }),
        busyMessage:'Guardando referido...'
      });
      await refreshState(false, [...new Set([...CORE_STATE_MODULES, 'referrals'])]);
      REFERRAL_DRAFT_DIRTY=false;
      REFERRAL_DRAFT={ clientName:'', dni:'', amount:'', bank:'BBVA', notes:'' };
      state.referralStatus='';
      render();
    }catch(error){
      await appAlert(error.message||'No se pudo guardar el referido.', 'Error');
    }finally{
      saveReferralBtn.disabled=false;
      saveReferralBtn.textContent='Guardar referido';
    }
  };

  // go nuevo
  const gn=document.getElementById('goNuevo');
  if(gn) gn.onclick=()=>{ state.newModal=true; render(); };

  // admin: save user
  const su=document.getElementById('saveUserBtn');
  if(su) su.onclick=async()=>{
    if(!canManageUsers()) return;
    const n=document.getElementById('an').value.trim();
    const u=document.getElementById('au').value.trim();
    const p=document.getElementById('ap').value.trim();
    const role=document.getElementById('ar').value;
    const sede=isAdmin()?document.getElementById('as').value:userSede(state.currentUser);
    if(!n||!u||!p) return;
    if(!canManageUserRole(role)) return;
    try{
      await apiFetch('/api/users', {
        method:'POST',
        body:JSON.stringify({ name:n, username:u, password:p, role:localToRole(role), sede })
      });
      await refreshState(false, CORE_STATE_MODULES);
      state.adminTab='users';
      render();
    }catch(error){
      await appAlert(error.message || 'No se pudo crear la atencion al cliente.', 'Error');
    }
  };

  const managerCreateUserBtn=document.getElementById('managerCreateUserBtn');
  if(managerCreateUserBtn) managerCreateUserBtn.onclick=()=>{
    state.adminTab='add';
    render();
  };

  const sc=document.getElementById('saveCommissionBtn');
  if(sc) sc.onclick=async()=>{
    const rate=Number(document.getElementById('commissionRate').value);
    if(Number.isNaN(rate) || rate<0) return;
    try{
      await apiFetch('/api/settings/commission', {
        method:'POST',
        body:JSON.stringify({ commissionPerRecord: rate })
      });
      await refreshState(false, CORE_STATE_MODULES);
      render();
    }catch(error){
      await appAlert(error.message || 'No se pudo guardar la comision.', 'Error');
    }
  };

  const savePayoutSettingsBtn=document.getElementById('savePayoutSettingsBtn');
  if(savePayoutSettingsBtn) savePayoutSettingsBtn.onclick=async()=>{
    const readInput=(key)=>{
      const input=document.querySelector(`[data-payout-input="${key}"]`);
      return Number(input?.value || 0);
    };
    const readPercent=(key)=>{
      const input=document.querySelector(`[data-payout-percent-input="${key}"]`);
      return Number(input?.value || 0) / 100;
    };
    const commissionPerRecord=Number(document.getElementById('commissionRate')?.value || 0);
    const roleDefaults=getPayrollRoleDefaults();
    for(const input of Array.from(document.querySelectorAll('[data-role-default]'))){
      const role=input.dataset.roleDefault;
      const field=input.dataset.roleDefaultField;
      if(!role || !field || !roleDefaults[role]) continue;
      roleDefaults[role][field]=Number(input.value || 0);
    }
    const penaltyRules=getPenaltyRules().map(rule=>({ ...rule }));
    for(const input of Array.from(document.querySelectorAll('[data-penalty-rule]'))){
      const code=input.dataset.penaltyRule;
      const field=input.dataset.penaltyRuleField;
      const rule=penaltyRules.find(item=>item.code===code);
      if(!rule || !field) continue;
      if(field==='amount') rule.amount=Number(input.value || 0);
      if(field==='description') rule.description=String(input.value || '').trim();
    }
    const payoutSettings={
      callCommission:readInput('callCommission'),
      ratingCommission:readInput('ratingCommission'),
      wrongCardBonus:readInput('wrongCardBonus'),
      managerRatingApprovalCommission:readInput('managerRatingApprovalCommission'),
      managerRecordValidationCommission:readInput('managerRecordValidationCommission'),
      managerPenaltyApprovalCommission:readInput('managerPenaltyApprovalCommission'),
      safetypaySharedThreshold:readPercent('safetypaySharedThreshold'),
      safetypaySharedBonusPool:readInput('safetypaySharedBonusPool'),
      safetypayManagerBonus:readInput('safetypayManagerBonus'),
      commercialCardCommissionRate:getPayoutSetting('commercialCardCommissionRate'),
      commercialCardMinimumCommission:getPayoutSetting('commercialCardMinimumCommission'),
      commercialCardMinimumThreshold:getPayoutSetting('commercialCardMinimumThreshold'),
      roleDefaults,
      customerServicePenalties:penaltyRules
    };
    const payoutNumbers=Object.entries(payoutSettings).filter(([key])=>key!=='roleDefaults').map(([,value])=>value);
    const roleNumbers=Object.values(roleDefaults).flatMap(config=>[config.baseSalary, config.penaltyPerMinute, config.bonus, config.balanceBonus]);
    const penaltyNumbers=penaltyRules.map(rule=>Number(rule.amount || 0));
    if(!Number.isFinite(commissionPerRecord) || commissionPerRecord<0 || [...payoutNumbers.filter(value=>typeof value==='number'), ...roleNumbers, ...penaltyNumbers].some(value=>!Number.isFinite(value) || value<0)){
      await appAlert('Revisa los montos. No pueden estar vacios ni ser negativos.', 'Valores invalidos');
      return;
    }
    if(payoutSettings.safetypaySharedThreshold>1 || payoutSettings.commercialCardCommissionRate>1){
      await appAlert('Los porcentajes no pueden superar 100%.', 'Valores invalidos');
      return;
    }
    const safetypaySedeGoals={};
    for(const input of Array.from(document.querySelectorAll('[data-safetypay-goal-input]'))){
      const sede=input.dataset.safetypayGoalInput;
      const goal=Number(input.value || 0);
      if(!sede || !Number.isFinite(goal) || goal<=0){
        await appAlert('Ingresa metas Safetypay validas para cada sede.', 'Meta invalida');
        return;
      }
      safetypaySedeGoals[sede]=goal;
    }
    try{
      await apiFetch('/api/settings/commission', {
        method:'POST',
        body:JSON.stringify({ commissionPerRecord }),
        busyMessage:'Guardando parametros...'
      });
      await apiFetch('/api/settings/payout', {
        method:'POST',
        body:JSON.stringify(payoutSettings),
        busyMessage:'Guardando parametros...'
      });
      await apiFetch('/api/settings/safetypay-goal', {
        method:'POST',
        body:JSON.stringify({ safetypaySedeGoals }),
        busyMessage:'Guardando metas...'
      });
      await refreshState(false, CORE_STATE_MODULES);
      await loadRatings(true);
      await appAlert('Parametros de pago actualizados.', 'Listo');
      render();
    }catch(error){
      await appAlert(error.message || 'No se pudieron guardar los parametros.', 'Error');
    }
  };

  const saveSafetypayGoalBtn=document.getElementById('saveSafetypayGoalBtn');
  if(saveSafetypayGoalBtn) saveSafetypayGoalBtn.onclick=async()=>{
    const inputs=Array.from(document.querySelectorAll('[data-safetypay-goal-input]'));
    const safetypaySedeGoals={};
    for(const input of inputs){
      const sede=input.dataset.safetypayGoalInput;
      const goal=Number(input.value || 0);
      if(!sede || !Number.isFinite(goal) || goal<=0){
        await appAlert('Ingresa metas Safetypay validas para cada sede.', 'Meta invalida');
        return;
      }
      safetypaySedeGoals[sede]=goal;
    }
    try{
      await apiFetch('/api/settings/safetypay-goal', {
        method:'POST',
        body:JSON.stringify({ month:activeMonthKey(state.safetypayMonth), safetypaySedeGoals })
      });
      await refreshState(false, CORE_STATE_MODULES);
      await appAlert('Metas Safetypay actualizadas por sede.', 'Listo');
      render();
    }catch(error){
      await appAlert(error.message || 'No se pudieron guardar las metas Safetypay.', 'Error');
    }
  };

  const sap=document.getElementById('saveAdminPasswordBtn');
  if(sap) sap.onclick=async()=>{
    const current=document.getElementById('adminCurrentPass').value;
    const next=document.getElementById('adminNewPass').value;
    const repeat=document.getElementById('adminRepeatPass').value;
    try{
      await apiFetch('/api/settings/password', {
        method:'POST',
        body:JSON.stringify({ currentPassword:current, newPassword:next, repeatPassword:repeat })
      });
      state.sessionPassword=next;
      await refreshState(false, CORE_STATE_MODULES);
      await appAlert('Contrasena de admin actualizada.', 'Listo');
      render();
    }catch(error){
      await appAlert(error.message || 'No se pudo cambiar la contrasena.', 'Error');
    }
  };

  document.querySelectorAll('[data-eu]').forEach(el=>{
    el.onclick=async()=>{
      const user=USERS.find(x=>x.id==el.dataset.eu);
      if(!user || !canManageUser(user)) return;
      const newName=await appPrompt('Editar nombre:', { title:'Editar atencion al cliente', defaultValue:user.name });
      if(!newName) return;
      let role=user.role;
      let sede=user.sede;
      if(isAdmin()){
        const newRole=await appPrompt('Rol (admin, manager o employee):', { title:'Editar rol', defaultValue:user.role });
        if(newRole==='admin' || newRole==='manager' || newRole==='employee') role=newRole;
        const newSede=await appPrompt(`Sede (${SEDES.join(', ')}):`, { title:'Editar sede', defaultValue:user.sede });
        if(newSede && SEDES.includes(newSede)) sede=newSede;
      }
      let transferEffectiveDate='';
      if(isAdmin() && sede!==user.sede){
        transferEffectiveDate=await appPrompt('Desde que fecha cuenta la nueva sede? (deja vacio para mover solo futuros cambios)', { title:'Fecha de traslado', defaultValue:todayStr() }) || '';
      }
      try{
        await apiFetch(`/api/users/${user.id}`, {
          method:'PATCH',
          body:JSON.stringify({ name:newName.trim()||user.name, role:localToRole(role), sede, transferEffectiveDate, previousSede:user.sede })
        });
        await refreshState(false, CORE_STATE_MODULES);
        render();
      }catch(error){
        await appAlert(error.message || 'No se pudo editar la atencion al cliente.', 'Error');
      }
    };
  });

  // admin: delete user
  document.querySelectorAll('[data-del]').forEach(el=>{
    el.onclick=async()=>{ if(await appConfirm('Eliminar esta atencion al cliente?', { title:'Eliminar usuario', confirmText:'Eliminar', danger:true })){ try{ await apiFetch(`/api/users/${el.dataset.del}`, { method:'DELETE' }); await refreshState(false, CORE_STATE_MODULES); render(); }catch(error){ await appAlert(error.message || 'No se pudo eliminar la atencion al cliente.', 'Error'); } } };
  });

  // admin: reset pass
  document.querySelectorAll('[data-rp]').forEach(el=>{
    el.onclick=async()=>{
      const uid=parseInt(el.dataset.rp);
      const np=await appPrompt('Nueva contrasena:', { title:'Resetear contrasena', confirmText:'Actualizar' });
      if(np){
        try{
          await apiFetch(`/api/users/${uid}/password`, {
            method:'POST',
            body:JSON.stringify({ password: np })
          });
          await refreshState(false, CORE_STATE_MODULES);
          await appAlert('Contrasena actualizada', 'Listo');
          render();
        }catch(error){
          await appAlert(error.message || 'No se pudo cambiar la contrasena.', 'Error');
        }
      }
    };
  });

  const exportBtn=document.getElementById('exportPdfBtn');
  if(exportBtn) exportBtn.onclick=async()=>{
    if(state.reportMode==='user' && !state.reportUser){
      await appAlert('Selecciona una atencion al cliente para descargar el reporte individual.');
      return;
    }
    if(!ATTENDANCE && !ATTENDANCE_LOADING){
      await loadAttendance(false);
    }
    const visibleReportMonth=reportMonthKey();
    if(!ratingsLoadedFor(visibleReportMonth) && !RATINGS_LOADING){
      await loadRatings(false, false, visibleReportMonth);
    }
    const visibleReportDate=monthDateFromKey(visibleReportMonth);
    const selectedReportSede=getReportSelectedSede();
    const records=getReportRecords(visibleReportMonth);
    const summaryUsers=getReportSummaryUsers();
    const selectedUser=getReportCollaborators().find(u=>u.id==state.reportUser);
    const reportBundle=state.reportMode==='user' ? getReportPersonBundle(selectedUser, visibleReportMonth) : null;
    const financialPeople=getFinancialReportPeople(visibleReportDate);
    const totalCommission=state.reportMode==='all'
      ? financialPeople.reduce((sum,person)=>sum+Number(person.commissionsPay||0),0)
      : Number(reportBundle?.salaryPerson?.commissionsPay || 0);
    const rows=records.map(r=>{
      const u=getItemOwner(r);
      return `<tr><td>${r.cliente||'-'}</td><td>${r.dni}</td>${state.reportMode==='all'?`<td>${u.name}</td><td>${getItemSede(r)}</td>`:''}<td>${fmt(r.fecha)}</td><td>${fmt(r.fechaOperacion)}</td><td>${fmt(r.validatedAt)}</td><td>${r.modalidad==='presencial'?'Presencial':'Virtual'}</td><td>${r.plataforma==='drive'?'Drive':'Web'}</td><td>S/ ${getCommissionRate().toFixed(2)}</td></tr>`;
    }).join('');
    const summaryRows=summaryUsers.map(u=>`<tr><td>${u.name}</td><td>${u.role==='manager'?'Jefe de sede':'Colaborador'}</td><td>${userSede(u)}</td><td>${getCommissionableRecordsForUser(u).filter(record=>recordAccountingMonthKey(record)===visibleReportMonth).length}</td><td>S/ ${calcUserCommission(u, visibleReportMonth).toFixed(2)}</td></tr>`).join('');
    const title=state.reportMode==='all'?'Reporte General Financiero':'Reporte Individual de Comisiones';
    const subtitle=state.reportMode==='all'
      ? `Consolidado financiero ${selectedReportSede ? `de sede ${selectedReportSede}` : 'de todas las sedes'} - ${monthLabelFromKey(visibleReportMonth)}`
      : `Detalle de ${selectedUser?.name||'Colaborador'} - ${selectedUser?.sede||''} - ${monthLabelFromKey(visibleReportMonth)}`;
    const w=window.open('','_blank');
    if(!w) return;
    if(state.reportMode==='user' && reportBundle){
      const salaryPerson=reportBundle.salaryPerson;
      const attendanceRows=(salaryPerson?.dayPayments || [])
        .slice()
        .sort((a,b)=>String(a.date || '').localeCompare(String(b.date || '')))
        .map(day=>{
          const status=attendanceStatusMeta(day);
          return `<tr>
            <td>${fmt(day.date)}</td>
            <td>${shortTime(day.entryTime)}</td>
            <td>${shortTime(day.exitTime)}</td>
            <td>${status.label}</td>
            <td>${minutesLabel(day.lateMinutes || 0)}</td>
            <td>${minutesLabel(day.overtimeMinutes || 0)}</td>
            <td>${money(day.regularPay || 0)}</td>
            <td>${money(day.overtimePay || 0)}</td>
            <td>${money(day.dailyPay || 0)}</td>
          </tr>`;
        }).join('');
      const recordRows=reportBundle.records
        .slice()
        .sort((a,b)=>String(b.createdAt || b.fechaOperacion || b.fecha || '').localeCompare(String(a.createdAt || a.fechaOperacion || a.fecha || '')))
        .map(record=>{
          const status=validationText(record);
          const commission=record.validatedAt ? money(getCommissionRate()) : 'S/ 0.00';
          return `<tr>
            <td>${esc(record.cliente || '-')}</td>
            <td>${esc(record.dni || '-')}</td>
            <td>${record.tipo==='operacion'?'Operacion':'Registro'}</td>
            <td>${record.modalidad==='presencial'?'Presencial':'Virtual'}</td>
            <td>${record.plataforma==='drive'?'Drive':'Web'}</td>
            <td>${fmt(record.fecha)}</td>
            <td>${fmt(record.fechaOperacion)}</td>
            <td>${status.label}</td>
            <td>${record.rejectionReason ? esc(record.rejectionReason) : '-'}</td>
            <td>${commission}</td>
          </tr>`;
        }).join('');
      const referralRows=reportBundle.referrals
        .slice()
        .sort((a,b)=>String(b.createdAt || '').localeCompare(String(a.createdAt || '')))
        .map(referral=>`<tr><td>${esc(referral.cliente || '-')}</td><td>${esc(referral.dni || '-')}</td><td>${fmtDateTime(referral.createdAt)}</td><td>${referral.bankLabel || referral.bank || '-'}</td><td>${money(referral.amount || 0)}</td><td>${reportReferralStatusLabel(referral)}</td><td>${referral.validatedAt ? money(referral.referralCommission || 0) : 'S/ 0.00'}</td></tr>`).join('');
      const wrongCardRows=reportBundle.wrongCards
        .slice()
        .sort((a,b)=>String(b.createdAt || '').localeCompare(String(a.createdAt || '')))
        .map(report=>`<tr><td>${esc(report.cliente || '-')}</td><td>${esc(report.dni || '-')}</td><td>${fmt(report.detectedDate)}</td><td>${reportDecisionStatusLabel(report)}</td><td>${report.rejectionReason ? esc(report.rejectionReason) : '-'}</td><td>${(report.status==='APPROVED' || report.validatedAt) ? money(report.bonusAmount || 0) : 'S/ 0.00'}</td></tr>`).join('');
      const callRows=reportBundle.calls
        .slice()
        .sort((a,b)=>String(b.createdAt || '').localeCompare(String(a.createdAt || '')))
        .map(report=>`<tr><td>${esc(report.cliente || '-')}</td><td>${esc(report.dni || '-')}</td><td>${fmtDateTime(report.createdAt)}</td><td>${reportDecisionStatusLabel(report)}</td><td>${report.rejectionReason ? esc(report.rejectionReason) : '-'}</td><td>${(report.status==='APPROVED' || report.validatedAt) ? money(report.bonusAmount || 0) : 'S/ 0.00'}</td></tr>`).join('');
      const ratingRows=reportBundle.ratings
        .slice()
        .sort((a,b)=>String(b.date || b.rawDate || '').localeCompare(String(a.date || a.rawDate || '')))
        .map(row=>`<tr><td>${fmtDateTime(row.date || row.rawDate)}</td><td>${esc(row.dni || '-')}</td><td>${row.rating || '-'} estrella(s)</td><td>${esc(row.comment || '-')}</td><td>${reportRatingStatusLabel(row)}</td><td>${row.payable ? money(row.amount || 0) : 'S/ 0.00'}</td></tr>`).join('');
      const penaltyRows=reportBundle.penalties
        .slice()
        .sort((a,b)=>String(b.decidedAt || b.createdAt || '').localeCompare(String(a.decidedAt || a.createdAt || '')))
        .map(report=>`<tr><td>${esc(report.penaltyLabel || 'Penalidad')}</td><td>${esc(report.clientName || '-')}</td><td>${fmtDateTime(report.decidedAt || report.createdAt)}</td><td>${report.status==='APPROVED'?'Aprobada':report.status==='REJECTED'?'Rechazada':'Pendiente'}</td><td>${esc(report.decisionReason || report.reason || '-')}</td><td>${report.status==='APPROVED' ? `-${money(report.penaltyAmount || 0)}` : 'S/ 0.00'}</td></tr>`).join('');
      const paidDays=salaryPerson ? salaryPerson.dayPayments.filter(day=>Number(day.dailyPay || 0)>0).length : 0;
      const regularPay=Number((salaryPerson?.dayPayments || []).reduce((sum, day)=>sum + Number(day.regularPay || 0), 0));
      const overtimePay=Number((salaryPerson?.dayPayments || []).reduce((sum, day)=>sum + Number(day.overtimePay || 0), 0));
      const latePenalty=Number(salaryPerson?.totalLatePenalty || 0);
      const earlyLeavePenalty=Number(salaryPerson?.totalEarlyLeavePenalty || 0);
      const penaltyReportDiscount=Number(salaryPerson?.penaltyReportDiscount || 0);
      const paymentAuditManagerDiscount=Number(salaryPerson?.paymentAuditManagerDiscount || 0);
      const totalDiscounts=latePenalty + earlyLeavePenalty + penaltyReportDiscount + paymentAuditManagerDiscount;
      const grossSalaryWorked=regularPay + overtimePay;
      const commissionsPay=Number(salaryPerson?.commissionsPay || 0);
      const grossMonthTotal=grossSalaryWorked + commissionsPay;
      const isManagerSalaryRole=(salaryPerson?.payrollRole || '')==='Jefe de Sede';
      const managerPunctualStaffDetail=(salaryPerson?.managerPunctualStaffList || [])
        .map((item, index)=>`${index + 1}. ${item.personName || 'Sin nombre'}${Number(item.share || 1)<0.999?` - ${item.workedDays || 0} dia(s) - ${(Number(item.share || 0)*100).toFixed(1)}%`:''}`)
        .join('<br>');
      const paymentBreakdownRows=salaryPerson ? [
        `<tr class="section-row"><td colspan="2">Pago 1 - Sueldo</td></tr>`,
        `<tr><td>Sueldo base mensual referencial</td><td>${money(salaryPerson.monthlySalary || 0)}</td></tr>`,
        `<tr class="plus-row"><td>Horas normales trabajadas</td><td>+ ${money(regularPay)}</td></tr>`,
        `<tr class="plus-row"><td>Pago por horas extra</td><td>+ ${money(overtimePay)}</td></tr>`,
        `<tr class="subtotal-row"><td>Sueldo ganado antes de descuentos</td><td>${money(grossSalaryWorked)}</td></tr>`,
        `<tr class="section-row"><td colspan="2">Descuentos del pago sueldo</td></tr>`,
        `<tr class="minus-row"><td>Descuento por tardanzas</td><td>- ${money(latePenalty)}</td></tr>`,
        `<tr class="minus-row"><td>${earlyLeavePolicyLabel(salaryPerson?.salaryMonthKey || reportMonthKey())}</td><td>- ${money(earlyLeavePenalty)}</td></tr>`,
        `<tr class="minus-row"><td>Penalidades aprobadas</td><td>- ${money(penaltyReportDiscount)}</td></tr>`,
        paymentAuditManagerDiscount>0 ? `<tr class="minus-row"><td>Auditorías de Pagos aprobadas</td><td>- ${money(paymentAuditManagerDiscount)}</td></tr>` : '',
        `<tr class="subtotal-row"><td>Total descuentos aplicados al sueldo</td><td>- ${money(totalDiscounts)}</td></tr>`,
        `<tr class="total-row"><td>Total pago 1 - Sueldo neto</td><td>${money(salaryPerson.salaryPay || 0)}</td></tr>`,
        `<tr class="section-row"><td colspan="2">Pago 2 - Comisiones y bonos</td></tr>`,
        `<tr class="plus-row"><td>Registros validados (${salaryPerson.approvedRecords?.length || 0})</td><td>+ ${money(salaryPerson.recordCommission || 0)}</td></tr>`,
        `<tr class="plus-row"><td>Bono puntualidad</td><td>+ ${money(salaryPerson.bonusAmount || 0)}</td></tr>`,
        `<tr class="plus-row"><td>Bonos extra</td><td>+ ${money(salaryPerson.extraBonusAmount || 0)}</td></tr>`,
        `<tr class="plus-row"><td>Referidos aprobados (${salaryPerson.approvedReferrals?.length || 0})</td><td>+ ${money(salaryPerson.referralBonus || 0)}</td></tr>`,
        `<tr class="plus-row"><td>Tarjetas erroneas aprobadas (${salaryPerson.approvedWrongCards?.length || 0})</td><td>+ ${money(salaryPerson.wrongCardBonus || 0)}</td></tr>`,
        `<tr class="plus-row"><td>Llamadas aprobadas (${salaryPerson.approvedCalls?.length || 0})</td><td>+ ${money(salaryPerson.callBonus || 0)}</td></tr>`,
        `<tr class="plus-row"><td>Calificaciones aprobadas (${salaryPerson.approvedRatings?.length || 0})</td><td>+ ${money(salaryPerson.ratingBonus || 0)}</td></tr>`,
        salaryPerson.paymentAuditReporterBonus>0 ? `<tr class="plus-row"><td>Bonos por auditorías de Pagos (${salaryPerson.approvedPaymentAuditsSent?.length || 0})</td><td>+ ${money(salaryPerson.paymentAuditReporterBonus || 0)}</td></tr>` : '',
        salaryPerson.safetypaySharedBonus>0 ? `<tr class="plus-row"><td>Bono sede Safetypay compartido</td><td>+ ${money(salaryPerson.safetypaySharedBonus || 0)}</td></tr>` : '',
        isManagerSalaryRole ? `<tr class="plus-row"><td>Comision por operaciones aprobadas (${salaryPerson.approvedRecordValidations?.length || 0})</td><td>+ ${money(salaryPerson.recordValidationBonus || 0)}</td></tr>` : '',
        isManagerSalaryRole ? `<tr class="plus-row"><td>Comision por calificaciones aprobadas (${salaryPerson.approvedRatingDecisions?.length || 0})</td><td>+ ${money(salaryPerson.ratingDecisionBonus || 0)}</td></tr>` : '',
        isManagerSalaryRole ? `<tr class="plus-row"><td>Bono Safetypay jefe</td><td>+ ${money(salaryPerson.safetypayManagerBonus || 0)}</td></tr>` : '',
        isManagerSalaryRole ? `<tr class="plus-row"><td>Bono personal puntual (${salaryPerson.managerPunctualStaffCount || 0})</td><td>+ ${money(salaryPerson.managerPunctualStaffBonus || 0)}</td></tr>` : '',
        (isManagerSalaryRole && managerPunctualStaffDetail)
          ? `<tr><td>Personal que genera el bono puntual</td><td>${managerPunctualStaffDetail}</td></tr>`
          : '',
        `<tr class="total-row"><td>Total pago 2 - Comisiones</td><td>${money(commissionsPay)}</td></tr>`,
        `<tr class="section-row"><td colspan="2">Resumen financiero final</td></tr>`,
        `<tr><td>Total pago 1 - Sueldo neto</td><td>${money(salaryPerson.salaryPay || 0)}</td></tr>`,
        `<tr><td>Total pago 2 - Comisiones</td><td>${money(commissionsPay)}</td></tr>`,
        `<tr class="final-row"><td>Total general del mes</td><td>${money(salaryPerson.estimatedSalary || 0)}</td></tr>`
      ].filter(Boolean).join('') : '';
      w.document.write(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>Reporte integral - ${esc(selectedUser.name || 'Colaborador')}</title><style>:root{color-scheme:light}body{font-family:Arial,sans-serif;padding:24px;color:#14213d;background:linear-gradient(180deg,#eef4ff 0%,#f6f8fc 42%,#eef6f3 100%)}h1,h2,h3{margin:0}p{margin:0;color:#5f708a}.hero{background:radial-gradient(circle at top right,rgba(96,165,250,.35),transparent 30%),linear-gradient(135deg,#0f172a,#172554 48%,#0f766e 100%);color:#fff;border:1px solid rgba(255,255,255,.08);box-shadow:0 20px 45px rgba(15,23,42,.18);border-radius:24px;padding:26px 28px;margin-bottom:18px}.hero p{color:#dbe8ff}.hero-grid{display:grid;grid-template-columns:2fr 1fr;gap:16px;align-items:start}.meta{display:flex;gap:8px;flex-wrap:wrap;margin-top:14px}.chip{display:inline-flex;align-items:center;padding:7px 12px;border-radius:999px;background:rgba(255,255,255,.1);border:1px solid rgba(255,255,255,.18);font-size:12px;backdrop-filter:blur(8px)}.grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px;margin:18px 0}.card{background:linear-gradient(180deg,#ffffff,#f5f8ff);border:1px solid #d9e5f4;box-shadow:0 10px 30px rgba(37,99,235,.08);border-radius:18px;padding:16px}.card:nth-child(1){background:linear-gradient(180deg,#effcf5,#ffffff)}.card:nth-child(2){background:linear-gradient(180deg,#eff6ff,#ffffff)}.card:nth-child(3){background:linear-gradient(180deg,#f5f3ff,#ffffff)}.card:nth-child(4){background:linear-gradient(180deg,#fff7ed,#ffffff)}.label{font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:#64748b;margin-bottom:8px}.value{font-size:24px;font-weight:700;color:#0f172a}.sub{font-size:12px;color:#64748b;margin-top:6px;line-height:1.45}.section{margin-top:18px}.panel{background:linear-gradient(180deg,rgba(255,255,255,.96),rgba(246,250,255,.98));border:1px solid #dbe3f0;box-shadow:0 14px 34px rgba(15,23,42,.08);border-radius:20px;padding:16px;margin-bottom:16px}.panel h2{font-size:17px;color:#0f172a;margin-bottom:12px;padding-bottom:10px;border-bottom:1px solid #e4ebf5}.two-col{display:grid;grid-template-columns:1.15fr .85fr;gap:16px}.mini-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px}.mini{background:linear-gradient(180deg,#f8fbff,#eef6ff);border:1px solid #dce8f7;border-radius:16px;padding:14px}.mini strong{display:block;font-size:18px;color:#0f172a}.mini span{display:block;font-size:12px;color:#64748b;margin-bottom:6px}table{width:100%;border-collapse:separate;border-spacing:0;background:rgba(255,255,255,.96);border:1px solid #dbe3f0;border-radius:16px;overflow:hidden}th,td{border-bottom:1px solid #e4ebf5;padding:9px 10px;font-size:11px;text-align:left;vertical-align:top}tbody tr:nth-child(even) td{background:#f8fbff}tbody tr:last-child td{border-bottom:none}th{background:linear-gradient(180deg,#dbeafe,#eff6ff);color:#334155;font-size:10px;letter-spacing:.06em;text-transform:uppercase}.section-row td{background:linear-gradient(180deg,#dbeafe,#eff6ff) !important;color:#1e3a8a;font-size:10px;font-weight:800;letter-spacing:.08em;text-transform:uppercase}.plus-row td:last-child{color:#15803d;font-weight:700}.minus-row td:last-child{color:#b91c1c;font-weight:700}.subtotal-row td{background:#f8fafc !important;font-weight:700}.total-row td{background:#effcf5 !important;font-weight:800;color:#166534}.final-row td{background:linear-gradient(180deg,#dcfce7,#ecfdf5) !important;font-size:13px;font-weight:800;color:#166534}td:first-child,th:first-child{border-left:none}.empty{padding:18px;text-align:center;color:#64748b}.good{color:#15803d;font-weight:700}.bad{color:#b91c1c;font-weight:700}.note{font-size:11px;color:#64748b;margin-top:8px;padding:10px 12px;background:#f8fbff;border:1px solid #e2e8f0;border-radius:12px}@media print{body{background:#fff;padding:0}.hero,.panel,.card,table{break-inside:avoid}.grid{grid-template-columns:repeat(4,minmax(0,1fr))}.panel,.card{box-shadow:none}}</style></head><body><div class="hero"><div class="hero-grid"><div><p>Reporte integral del colaborador</p><h1>${esc(selectedUser.name || 'Colaborador')}</h1><div class="meta"><span class="chip">${selectedUser.role==='manager'?'Jefe de sede':'Atencion al cliente'}</span><span class="chip">Sede ${esc(userSede(selectedUser) || 'Sin sede')}</span><span class="chip">@${esc(selectedUser.username || '-')}</span></div></div><div><p>Generado por ${esc(state.currentUser.name)}</p><p>${new Date().toLocaleString()}</p><p style="margin-top:10px">Incluye asistencia, registros, calificaciones, bonos, descuentos y pagos del mes visible.</p></div></div></div><div class="grid"><div class="card"><div class="label">Pago 1</div><div class="value">${money(reportBundle.salaryPerson?.salaryPay || 0)}</div><div class="sub">Sueldo neto con horas extra y descuentos</div></div><div class="card"><div class="label">Pago 2</div><div class="value">${money(reportBundle.salaryPerson?.commissionsPay || totalCommission || 0)}</div><div class="sub">Comisiones, bonos e incentivos</div></div><div class="card"><div class="label">Total del mes</div><div class="value">${money(reportBundle.salaryPerson?.estimatedSalary || totalCommission || 0)}</div><div class="sub">${reportBundle.salaryPerson?.salaryPaid ? `Pagado ${fmtDateTime(reportBundle.salaryPerson.salaryPaidAt)}` : 'Pendiente de pago'}</div></div><div class="card"><div class="label">Horas extra / tardanzas</div><div class="value">${minutesLabel(reportBundle.salaryPerson?.totalExtraMinutes || 0)}</div><div class="sub">${Number(reportBundle.salaryPerson?.lateEntries || 0)} tardanza(s) - ${minutesLabel(reportBundle.salaryPerson?.totalLateMinutes || 0)} tarde</div></div></div><div class="section two-col"><div class="panel"><h2>Resumen laboral</h2><div class="mini-grid"><div class="mini"><span>Dias pagables</span><strong>${paidDays}</strong></div><div class="mini"><span>Registros</span><strong>${reportBundle.records.length}</strong></div><div class="mini"><span>Calificaciones</span><strong>${reportBundle.ratings.length}</strong></div><div class="mini"><span>Referidos</span><strong>${reportBundle.referrals.length}</strong></div><div class="mini"><span>Llamadas</span><strong>${reportBundle.calls.length}</strong></div><div class="mini"><span>Tarjetas erroneas</span><strong>${reportBundle.wrongCards.length}</strong></div></div></div><div class="panel"><h2>Pagos del mes (${paymentBreakdownRows ? 'detalle completo' : '0'})</h2><table><thead><tr><th>Concepto</th><th>Monto</th></tr></thead><tbody>${paymentBreakdownRows || '<tr><td colspan="2" class="empty">No hay informacion de sueldos cargada.</td></tr>'}</tbody></table><div class="note">Pago 1: sueldo con horas extra y descuentos. Pago 2: comisiones, bonos y variables del mes.</div></div></div><div class="section panel"><h2>Asistencia del mes (${(salaryPerson?.dayPayments || []).length})</h2><table><thead><tr><th>Fecha</th><th>Entrada</th><th>Salida</th><th>Estado</th><th>Tardanza</th><th>Horas extra</th><th>Pago normal</th><th>Pago extra</th><th>Pago dia</th></tr></thead><tbody>${attendanceRows || '<tr><td colspan="9" class="empty">Sin asistencias cargadas para este colaborador.</td></tr>'}</tbody></table></div><div class="section panel"><h2>Registros del colaborador (${reportBundle.records.length})</h2><table><thead><tr><th>Cliente</th><th>DNI</th><th>Tipo</th><th>Modalidad</th><th>Plataforma</th><th>Fecha registro</th><th>Fecha operacion</th><th>Estado</th><th>Motivo</th><th>Comision</th></tr></thead><tbody>${recordRows || '<tr><td colspan="10" class="empty">Sin registros visibles.</td></tr>'}</tbody></table></div><div class="section two-col"><div class="panel"><h2>Calificaciones (${reportBundle.ratings.length})</h2><table><thead><tr><th>Fecha</th><th>DNI</th><th>Rating</th><th>Comentario</th><th>Estado</th><th>Monto</th></tr></thead><tbody>${ratingRows || '<tr><td colspan="6" class="empty">Sin calificaciones para este colaborador.</td></tr>'}</tbody></table></div><div class="panel"><h2>Referidos (${reportBundle.referrals.length})</h2><table><thead><tr><th>Cliente</th><th>DNI</th><th>Fecha</th><th>Banco</th><th>Monto</th><th>Estado</th><th>Comision</th></tr></thead><tbody>${referralRows || '<tr><td colspan="7" class="empty">Sin referidos registrados.</td></tr>'}</tbody></table></div></div><div class="section two-col"><div class="panel"><h2>Tarjetas erroneas (${reportBundle.wrongCards.length})</h2><table><thead><tr><th>Cliente</th><th>DNI</th><th>Fecha</th><th>Estado</th><th>Motivo</th><th>Bono</th></tr></thead><tbody>${wrongCardRows || '<tr><td colspan="6" class="empty">Sin tarjetas erroneas registradas.</td></tr>'}</tbody></table></div><div class="panel"><h2>Llamadas (${reportBundle.calls.length})</h2><table><thead><tr><th>Cliente</th><th>DNI</th><th>Fecha</th><th>Estado</th><th>Motivo</th><th>Bono</th></tr></thead><tbody>${callRows || '<tr><td colspan="6" class="empty">Sin llamadas registradas.</td></tr>'}</tbody></table></div></div><div class="section panel"><h2>Penalidades y descuentos aprobados (${reportBundle.penalties.length})</h2><table><thead><tr><th>Penalidad</th><th>Cliente</th><th>Fecha</th><th>Estado</th><th>Motivo</th><th>Descuento</th></tr></thead><tbody>${penaltyRows || '<tr><td colspan="6" class="empty">Sin penalidades registradas.</td></tr>'}</tbody></table></div><script>window.onload=()=>window.print();<\/script></body></html>`);
    }else{
      const reportMonth=visibleReportMonth;
      const totalSalary=financialPeople.reduce((sum,person)=>sum + Number(person.salaryPay||0),0);
      const totalDiscounts=financialPeople.reduce((sum,person)=>sum + Number(person.totalDiscounts||0),0);
      const totalPayable=financialPeople.reduce((sum,person)=>sum + Number(person.estimatedSalary||0),0);
      const allReportRecords=getVisibleRecords().filter(record=>recordAccountingMonthKey(record)===reportMonth && reportSedeMatches(getItemSede(record)));
      const approvedRecords=records;
      const registrationOnlyCount=allReportRecords.filter(record=>record.tipo==='registro').length;
      const operationCount=allReportRecords.filter(record=>record.tipo==='operacion').length;
      const newClientCount=registrationOnlyCount + operationCount;
      const conversionRate=newClientCount ? ((operationCount / newClientCount) * 100).toFixed(1) : '0.0';
      const pendingCount=allReportRecords.filter(record=>isPendingApproval(record)).length;
      const rejectedCount=allReportRecords.filter(record=>record.rejectedAt).length;
      const openCount=Math.max(0, allReportRecords.length - approvedRecords.length - pendingCount - rejectedCount);
      const paidDays=financialPeople.reduce((sum,person)=>sum + (person.dayPayments||[]).filter(day=>Number(day.dailyPay||0)>0).length,0);
      const lateEntries=financialPeople.reduce((sum,person)=>sum + Number(person.lateEntries||0),0);
      const extraMinutes=financialPeople.reduce((sum,person)=>sum + Number(person.totalExtraMinutes||0),0);
      const punctualPeople=financialPeople.filter(person=>Number(person.lateEntries||0)===0 && (person.dayPayments||[]).some(day=>Number(day.dailyPay||0)>0)).length;
      const monthRatings=RATINGS.filter(row=>monthKeyFromDate(row.date || row.rawDate)===reportMonth && reportSedeMatches(row.sede));
      const approvedRatings=monthRatings.filter(row=>row.payable || row.approvalStatus==='APPROVED').length;
      const avgRating=approvedRatings
        ? (monthRatings.filter(row=>row.payable || row.approvalStatus==='APPROVED').reduce((sum,row)=>sum+Number(row.rating||0),0)/approvedRatings).toFixed(1)
        : '0.0';
      const paymentParts=[
        { label:'Sueldo neto', value:totalSalary, color:'#2563eb' },
        { label:'Comisiones', value:totalCommission, color:'#16a34a' },
        { label:'Descuentos', value:totalDiscounts, color:'#ef4444' }
      ];
      const statusParts=[
        { label:'Validados', value:approvedRecords.length, color:'#16a34a' },
        { label:'Pendientes', value:pendingCount, color:'#f59e0b' },
        { label:'Rechazados', value:rejectedCount, color:'#ef4444' },
        { label:'Abiertos', value:openCount, color:'#64748b' }
      ];
      const registrationVsParts=[
        { label:'Solo registro', value:registrationOnlyCount, color:'#ef4444' },
        { label:'Operacion', value:operationCount, color:'#16a34a' }
      ];
      const pieStyle=(parts)=>{
        const total=parts.reduce((sum,item)=>sum+Number(item.value||0),0);
        if(total<=0) return 'background:#e5e7eb';
        let cursor=0;
        return `background:conic-gradient(${parts.map(item=>{
          const start=cursor;
          cursor += (Number(item.value||0) / total) * 100;
          return `${item.color} ${start.toFixed(2)}% ${cursor.toFixed(2)}%`;
        }).join(',')})`;
      };
      const chartTotal=parts=>parts.reduce((sum,item)=>sum+Number(item.value||0),0);
      const chartCenterLabel=(parts,isMoney=false)=>{
        const total=chartTotal(parts);
        if(isMoney) return total>=1000 ? `S/ ${(total/1000).toFixed(1)}k` : money(total);
        return new Intl.NumberFormat('es-PE').format(total);
      };
      const donut=(parts,label,caption='total')=>`<div class="pie" style="${pieStyle(parts)}"><div class="pie-center"><strong>${label}</strong><span>${caption}</span></div></div>`;
      const legend=(parts, formatValue=value=>value)=>{
        const total=chartTotal(parts);
        return parts.map(item=>{
          const percentage=total ? ((Number(item.value||0)/total)*100).toFixed(1) : '0.0';
          return `<div class="legend-row"><span><i style="background:${item.color}"></i>${esc(item.label)}</span><strong>${formatValue(item.value)}<small>${percentage}%</small></strong></div>`;
        }).join('');
      };
      const sedeStats=SEDES.map((sede,index)=>{
        const sedePeople=financialPeople.filter(person=>getReportPersonSede(person, reportMonth)===sede);
        const sedeRecords=allReportRecords.filter(record=>getItemSede(record)===sede);
        const sedeOperations=sedeRecords.filter(record=>record.tipo==='operacion').length;
        const sedeRegistrations=sedeRecords.filter(record=>record.tipo==='registro').length;
        const sedeNewClients=sedeRegistrations + sedeOperations;
        return {
          sede,
          color:COLORS[index % COLORS.length],
          people:sedePeople.length,
          records:sedeRegistrations,
          operations:sedeOperations,
          newClients:sedeNewClients,
          conversion:sedeNewClients ? ((sedeOperations / sedeNewClients) * 100).toFixed(1) : '0.0',
          paidDays:sedePeople.reduce((sum,person)=>sum+(person.dayPayments||[]).filter(day=>Number(day.dailyPay||0)>0).length,0),
          commission:sedePeople.reduce((sum,person)=>sum+Number(person.commissionsPay||0),0),
          total:sedePeople.reduce((sum,person)=>sum+Number(person.estimatedSalary||0),0)
        };
      });
      const sedeParts=sedeStats.map(row=>({ label:row.sede, value:row.records + row.operations, color:row.color }));
      const maxSedeProductivity=Math.max(1, ...sedeStats.map(row=>row.records + row.operations));
      const productivityRows=financialPeople.map(person=>{
        const linkedUser=userForAttendancePerson(person);
        const grossSalary=Number((person.dayPayments||[]).reduce((sum, day)=>sum + Number(day.regularPay || 0) + Number(day.overtimePay || 0),0));
        const recordsForUser=linkedUser ? allReportRecords.filter(record=>Number(record.userId)===Number(linkedUser.id)) : [];
        const registrations=recordsForUser.filter(record=>record.tipo==='registro').length;
        const operations=recordsForUser.filter(record=>record.tipo==='operacion').length;
        const userNewClients=registrations + operations;
        const ratings=ratingRowsForPerson(person, reportMonth).length;
        const referrals=approvedReferralsForPerson(person, reportMonth).length;
        const wrongCards=approvedWrongCardsForPerson(person, reportMonth).length;
        const calls=approvedCallsForPerson(person, reportMonth).length;
        const productivity=operations + ratings + referrals + wrongCards + calls;
        return { person, linkedUser, grossSalary, records:registrations, operations, conversion:userNewClients ? ((operations / userNewClients) * 100).toFixed(1) : '0.0', ratings, extras:referrals + wrongCards + calls, productivity };
      }).sort((a,b)=>b.productivity-a.productivity || Number(b.person.estimatedSalary||0)-Number(a.person.estimatedSalary||0));
      const maxProductivity=Math.max(1, ...productivityRows.map(row=>row.productivity));
      const sedeRows=sedeStats.map(row=>`<tr><td>${esc(row.sede)}</td><td>${row.people}</td><td>${row.records}</td><td>${row.operations}</td><td>${row.newClients}</td><td>${row.conversion}%</td><td class="green">${money(row.commission)}</td><td class="green strong">${money(row.total)}</td><td><div class="bar"><span style="width:${Math.max(6, ((row.records + row.operations)/maxSedeProductivity)*100)}%"></span></div></td></tr>`).join('');
      const productivityTableRows=productivityRows.map(row=>`<tr><td>${esc(row.person.personName)}</td><td>${esc(getReportPersonSede(row.person, reportMonth) || 'Sin sede')}</td><td>${row.records}</td><td>${row.operations}</td><td>${row.conversion}%</td><td>${row.ratings}</td><td>${row.extras}</td><td class="green strong">${row.productivity}</td><td><div class="bar"><span style="width:${Math.max(6, (row.productivity/maxProductivity)*100)}%"></span></div></td></tr>`).join('');
      const financeRows=productivityRows.map(row=>`<tr>
          <td>${esc(row.person.personName)}</td>
          <td>${esc(row.person.payrollRole || (row.linkedUser?.role==='manager'?'Jefe de sede':'Colaborador'))}</td>
          <td>${esc(row.person.department || 'Sin Area')}</td>
          <td>${esc(getReportPersonSede(row.person, reportMonth) || 'Sin sede')}</td>
          <td>${money(row.grossSalary)}</td>
          <td class="red strong">-${money(row.person.totalDiscounts||0)}</td>
          <td>${money(row.person.salaryPay||0)}</td>
          <td class="green strong">${money(row.person.commissionsPay||0)}</td>
          <td class="green strong">${money(row.person.estimatedSalary||0)}</td>
        </tr>`).join('');
      const recordDetailRows=allReportRecords
        .slice()
        .sort((a,b)=>String(b.fechaOperacion || b.fecha || '').localeCompare(String(a.fechaOperacion || a.fecha || '')))
        .map(record=>{
          const owner=getItemOwner(record);
          const status=validationText(record);
          return `<tr><td>${esc(record.cliente || '-')}</td><td>${esc(record.dni || '-')}</td><td>${esc(owner?.name || '-')}</td><td>${esc(getItemSede(record))}</td><td>${record.tipo==='operacion'?'Operacion':'Registro'}</td><td>${fmt(record.fecha)}</td><td>${fmt(record.fechaOperacion)}</td><td>${status.label}</td><td>${record.validatedAt ? money(getCommissionRate()) : 'S/ 0.00'}</td></tr>`;
        }).join('');
      const ratingDetailRows=monthRatings
        .slice()
        .sort((a,b)=>String(b.date || b.rawDate || '').localeCompare(String(a.date || a.rawDate || '')))
        .map(row=>`<tr><td>${fmtDateTime(row.date || row.rawDate)}</td><td>${esc(row.matchedUserName || row.advisor || '-')}</td><td>${esc(row.sede || '-')}</td><td>${esc(row.dni || '-')}</td><td>${row.rating || '-'}</td><td>${reportRatingStatusLabel(row)}</td><td>${row.payable ? money(row.amount || 0) : 'S/ 0.00'}</td></tr>`)
        .join('');
      const referralDetailRows=REFERRALS
        .filter(item=>monthKeyFromDate(item.validatedAt || item.createdAt)===reportMonth && reportSedeMatches(getReportItemSede(item)))
        .sort((a,b)=>String(b.validatedAt || b.createdAt || '').localeCompare(String(a.validatedAt || a.createdAt || '')))
        .map(item=>`<tr><td>${esc(item.cliente || '-')}</td><td>${esc(item.dni || '-')}</td><td>${esc(getItemOwner(item)?.name || '-')}</td><td>${esc(getReportItemSede(item))}</td><td>${fmtDateTime(item.validatedAt || item.createdAt)}</td><td>${reportReferralStatusLabel(item)}</td><td>${item.validatedAt ? money(item.referralCommission || 0) : 'S/ 0.00'}</td></tr>`)
        .join('');
      const wrongCardDetailRows=WRONG_CARDS
        .filter(item=>monthKeyFromDate(item.validatedAt || item.detectedDate || item.createdAt)===reportMonth && reportSedeMatches(getReportItemSede(item)))
        .sort((a,b)=>String(b.validatedAt || b.detectedDate || b.createdAt || '').localeCompare(String(a.validatedAt || a.detectedDate || a.createdAt || '')))
        .map(item=>`<tr><td>${esc(item.cliente || '-')}</td><td>${esc(item.dni || '-')}</td><td>${esc(getItemOwner(item)?.name || '-')}</td><td>${esc(getReportItemSede(item))}</td><td>${fmt(item.detectedDate)}</td><td>${reportDecisionStatusLabel(item)}</td><td>${(item.status==='APPROVED' || item.validatedAt) ? money(item.bonusAmount || 0) : 'S/ 0.00'}</td></tr>`)
        .join('');
      const callDetailRows=CALL_REPORTS
        .filter(item=>monthKeyFromDate(item.validatedAt || item.createdAt)===reportMonth && reportSedeMatches(getReportItemSede(item)))
        .sort((a,b)=>String(b.validatedAt || b.createdAt || '').localeCompare(String(a.validatedAt || a.createdAt || '')))
        .map(item=>`<tr><td>${esc(item.cliente || '-')}</td><td>${esc(item.dni || '-')}</td><td>${esc(getItemOwner(item)?.name || '-')}</td><td>${esc(getReportItemSede(item))}</td><td>${fmtDateTime(item.createdAt)}</td><td>${reportDecisionStatusLabel(item)}</td><td>${(item.status==='APPROVED' || item.validatedAt) ? money(item.bonusAmount || 0) : 'S/ 0.00'}</td></tr>`)
        .join('');
      const penaltyDetailRows=PENALTY_REPORTS
        .filter(item=>monthKeyFromDate(item.decidedAt || item.createdAt)===reportMonth && reportSedeMatches(getReportItemSede(item)))
        .sort((a,b)=>String(b.decidedAt || b.createdAt || '').localeCompare(String(a.decidedAt || a.createdAt || '')))
        .map(item=>`<tr><td>${esc(item.penaltyLabel || 'Penalidad')}</td><td>${esc(item.workerName || item.receiver?.name || '-')}</td><td>${esc(getReportItemSede(item))}</td><td>${esc(item.clientName || '-')}</td><td>${fmtDateTime(item.decidedAt || item.createdAt)}</td><td>${item.status==='APPROVED'?'Aprobada':item.status==='REJECTED'?'Rechazada':'Pendiente'}</td><td>${item.status==='APPROVED' ? `-${money(item.penaltyAmount || 0)}` : 'S/ 0.00'}</td></tr>`)
        .join('');
      const detailTablesHtml=selectedReportSede ? `<h2>Registros (${allReportRecords.length})</h2><table><thead><tr><th>Cliente</th><th>DNI</th><th>Colaborador</th><th>Sede</th><th>Tipo</th><th>Registro</th><th>Operacion</th><th>Estado</th><th>Comision</th></tr></thead><tbody>${recordDetailRows || '<tr><td colspan="9" class="empty">Sin registros.</td></tr>'}</tbody></table><h2>Calificaciones (${monthRatings.length})</h2><table><thead><tr><th>Fecha</th><th>Colaborador</th><th>Sede</th><th>DNI</th><th>Rating</th><th>Estado</th><th>Monto</th></tr></thead><tbody>${ratingDetailRows || '<tr><td colspan="7" class="empty">Sin calificaciones.</td></tr>'}</tbody></table><h2>Referidos</h2><table><thead><tr><th>Cliente</th><th>DNI</th><th>Colaborador</th><th>Sede</th><th>Fecha</th><th>Estado</th><th>Comision</th></tr></thead><tbody>${referralDetailRows || '<tr><td colspan="7" class="empty">Sin referidos.</td></tr>'}</tbody></table><h2>Tarjetas erroneas</h2><table><thead><tr><th>Cliente</th><th>DNI</th><th>Colaborador</th><th>Sede</th><th>Fecha</th><th>Estado</th><th>Bono</th></tr></thead><tbody>${wrongCardDetailRows || '<tr><td colspan="7" class="empty">Sin tarjetas erroneas.</td></tr>'}</tbody></table><h2>Llamadas</h2><table><thead><tr><th>Cliente</th><th>DNI</th><th>Colaborador</th><th>Sede</th><th>Fecha</th><th>Estado</th><th>Bono</th></tr></thead><tbody>${callDetailRows || '<tr><td colspan="7" class="empty">Sin llamadas.</td></tr>'}</tbody></table><h2>Penalidades</h2><table><thead><tr><th>Penalidad</th><th>Colaborador</th><th>Sede</th><th>Cliente</th><th>Fecha</th><th>Estado</th><th>Descuento</th></tr></thead><tbody>${penaltyDetailRows || '<tr><td colspan="7" class="empty">Sin penalidades.</td></tr>'}</tbody></table>` : '';
      w.document.write(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>${title}</title><style>body{font-family:Arial,sans-serif;padding:26px;color:#14213d;background:linear-gradient(180deg,#eef4ff 0%,#f6f8fc 42%,#eef6f3 100%)}h1{margin:0 0 6px;font-size:30px;color:#0f172a}h2{margin:18px 0 10px;color:#0f172a}p{margin:0;color:#475569}.hero{background:radial-gradient(circle at top right,rgba(96,165,250,.35),transparent 30%),linear-gradient(135deg,#0f172a,#172554 48%,#0f766e 100%);color:#fff;border-radius:22px;padding:24px 26px;margin-bottom:18px}.hero p{color:#dbe8ff}.grid{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:12px;margin:18px 0}.card{background:#fff;border:1px solid #dbe3f0;border-radius:16px;padding:15px}.label{font-size:10px;letter-spacing:.08em;text-transform:uppercase;color:#64748b;margin-bottom:8px}.value{font-size:22px;font-weight:800;color:#0f172a}.sub{font-size:11px;color:#64748b;margin-top:6px}.green{color:#166534}.red{color:#b91c1c}.strong{font-weight:800}.charts{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:14px;margin:14px 0}.panel{background:#fff;border:1px solid #dbe3f0;border-radius:18px;padding:14px;margin-bottom:16px;break-inside:avoid}.panel h2{font-size:15px;margin:0 0 12px;color:#0f172a}.chart-body{display:grid;grid-template-columns:136px minmax(0,1fr);gap:14px;align-items:center}.pie{position:relative;display:grid;place-items:center;width:136px;height:136px;flex:0 0 auto;border-radius:50%;box-shadow:0 10px 24px rgba(15,23,42,.16)}.pie:before{content:"";position:absolute;inset:25%;border-radius:50%;background:#fff;box-shadow:inset 0 0 0 1px #e2e8f0}.pie-center{position:absolute;z-index:1;inset:0;display:flex;flex-direction:column;justify-content:center;align-items:center;text-align:center;pointer-events:none}.pie-center strong{max-width:78px;color:#0f172a;font-size:10px;line-height:1.1;white-space:nowrap}.pie-center span{margin-top:4px;color:#64748b;font-size:8px;letter-spacing:.04em;text-transform:uppercase}.legend-row{display:grid;grid-template-columns:minmax(0,1fr) auto;align-items:center;justify-content:space-between;gap:8px;font-size:11px;color:#475569;margin:8px 0}.legend-row span{display:inline-flex;align-items:center;gap:7px}.legend-row i{width:9px;height:9px;border-radius:50%;flex:0 0 auto}.legend-row strong{display:grid;justify-items:end;gap:2px;white-space:nowrap}.legend-row small{font-size:9px;color:#64748b;font-weight:600}.bar{height:9px;min-width:86px;border-radius:999px;background:#e2e8f0;overflow:hidden}.bar span{display:block;height:100%;border-radius:inherit;background:linear-gradient(90deg,#2563eb,#16a34a)}table{width:100%;border-collapse:separate;border-spacing:0;background:#fff;border:1px solid #dbe3f0;border-radius:16px;overflow:hidden;margin-bottom:16px}th,td{border-bottom:1px solid #dbe3f0;padding:9px 10px;font-size:11px;text-align:left;vertical-align:top}tbody tr:nth-child(even) td{background:#f8fbff}tbody tr:last-child td{border-bottom:none}th{background:#eaf2ff;color:#334155;font-size:10px;letter-spacing:.06em;text-transform:uppercase}.empty{color:#64748b;text-align:center;padding:14px}@media print{body{background:#fff;padding:0}.hero,.card,.panel,table{break-inside:avoid}.card{box-shadow:none}}</style></head><body><div class="hero"><h1>LINCE - ${title}</h1><p>${subtitle}</p><p>Generado por ${esc(state.currentUser.name)} - Sede del reporte: ${esc(selectedReportSede || 'Todas las sedes')} - ${new Date().toLocaleString()}</p></div><div class="grid"><div class="card"><div class="label">Colaboradores</div><div class="value">${financialPeople.length}</div><div class="sub">personal visible</div></div><div class="card"><div class="label">Sueldo neto</div><div class="value">${money(totalSalary)}</div><div class="sub">pago 1</div></div><div class="card"><div class="label">Comisiones</div><div class="value green">${money(totalCommission)}</div><div class="sub">pago 2</div></div><div class="card"><div class="label">Descuentos</div><div class="value red">-${money(totalDiscounts)}</div><div class="sub">tardanzas y penalidades</div></div><div class="card"><div class="label">Total a pagar</div><div class="value green">${money(totalPayable)}</div><div class="sub">cierre mensual</div></div></div><div class="grid"><div class="card"><div class="label">Clientes nuevos</div><div class="value">${newClientCount}</div><div class="sub">${operationCount} efectivizados - ${registrationOnlyCount} solo registrados</div></div><div class="card"><div class="label">Efectivizacion</div><div class="value">${conversionRate}%</div><div class="sub">operaciones dentro de 7 dias</div></div><div class="card"><div class="label">Productividad</div><div class="value">${productivityRows.reduce((sum,row)=>sum+row.productivity,0)}</div><div class="sub">${approvedRatings} calificaciones - promedio ${avgRating}</div></div><div class="card"><div class="label">Puntualidad</div><div class="value">${punctualPeople}/${financialPeople.length || 0}</div><div class="sub">${lateEntries} tardanza(s)</div></div><div class="card"><div class="label">Asistencia</div><div class="value">${paidDays}</div><div class="sub">dias pagables acumulados</div></div><div class="card"><div class="label">Horas extra</div><div class="value">${minutesLabel(extraMinutes)}</div><div class="sub">minutos extra acumulados</div></div></div><div class="charts"><div class="panel"><h2>Distribucion de pagos</h2><div class="chart-body">${donut(paymentParts, chartCenterLabel(paymentParts, true), 'total del mes')}<div>${legend(paymentParts, value=>money(value))}</div></div></div><div class="panel"><h2>Registro vs operacion</h2><div class="chart-body">${donut(registrationVsParts, chartCenterLabel(registrationVsParts), 'clientes')}<div>${legend(registrationVsParts)}<div style="font-size:10px;color:#64748b;margin-top:8px">Registro: cliente nuevo sin efectivizar en 7 dias. Operacion: cliente nuevo efectivizado en 7 dias.</div></div></div></div><div class="panel"><h2>Productividad por sede</h2><div class="chart-body">${donut(sedeParts, chartCenterLabel(sedeParts), 'clientes')}<div>${legend(sedeParts)}</div></div></div></div><h2>Resumen por sede</h2><table><thead><tr><th>Sede</th><th>Colaboradores</th><th>Solo registro</th><th>Operacion</th><th>Clientes nuevos</th><th>Efectivizacion</th><th>Comisiones</th><th>Total pagar</th><th>Actividad</th></tr></thead><tbody>${sedeRows || '<tr><td colspan="9" class="empty">Sin datos por sede.</td></tr>'}</tbody></table><h2>Productividad por colaborador</h2><table><thead><tr><th>Colaborador</th><th>Sede</th><th>Solo registro</th><th>Operacion</th><th>Efectivizacion</th><th>Calificaciones</th><th>Extras</th><th>Puntaje</th><th>Avance</th></tr></thead><tbody>${productivityTableRows || '<tr><td colspan="9" class="empty">Sin productividad para mostrar.</td></tr>'}</tbody></table><h2>Resumen financiero por colaborador</h2><table><thead><tr><th>Colaborador</th><th>Rol</th><th>Area</th><th>Sede</th><th>Sueldo bruto</th><th>Descuentos</th><th>Sueldo neto</th><th>Comisiones</th><th>Total pagar</th></tr></thead><tbody>${financeRows||'<tr><td colspan="9" class="empty">Sin colaboradores para exportar.</td></tr>'}</tbody></table>${detailTablesHtml}<script>window.onload=()=>window.print();<\/script></body></html>`);
    }
    w.document.close();
  };

  const attendanceRefresh=document.getElementById('attendanceRefresh');
  if(attendanceRefresh) attendanceRefresh.onclick=async()=>{ await loadAttendance(true); };
  const ownSalaryPdf=document.getElementById('downloadOwnSalaryPdf');
  if(ownSalaryPdf) ownSalaryPdf.onclick=async()=>{
    const visibleSalaryMonth=salaryViewMonthKey();
    const sessionScope=getSessionScopeKey();
    await loadAttendance(false);
    if(!ratingsLoadedFor(visibleSalaryMonth) && !RATINGS_LOADING) await loadRatings(false, false, visibleSalaryMonth);
    if(sessionScope!==getSessionScopeKey() || visibleSalaryMonth!==salaryViewMonthKey()) return;
    const person=getCurrentUserSalaryPerson();
    if(!person?.salaryPaid){
      await appAlert('Tu reporte de sueldo estara disponible cuando administracion marque tu sueldo como pagado.', 'Pendiente de pago');
      return;
    }
    exportSalaryReceiptPdf(person);
  };
  document.querySelectorAll('[data-commission-jump]').forEach(btn=>{
    btn.onclick=()=>{
      const target=document.getElementById(btn.dataset.commissionJump || '');
      if(!target) return;
      target.scrollIntoView({ behavior:'smooth', block:'start' });
    };
  });
  const exportSalariesBtn=document.getElementById('exportSalariesBtn');
  const downloadManagerActivityExcel=document.getElementById('downloadManagerActivityExcel');
  if(downloadManagerActivityExcel) downloadManagerActivityExcel.onclick=()=>{
    if(!isManager()) return;
    const month=activeMonthKey(state.dashboardMonth);
    const period=managerReportPeriod();
    const rows=managerRegistrationActivityRows(month, period);
    const dailyRows=managerRegistrationActivityDailyRows(period);
    const dailyRowsHtml=rows.map(summary=>{
      const personRows=dailyRows.filter(row=>Number(row.user.id)===Number(summary.user.id));
      const detail=personRows.map(row=>`<tr><td>${esc(summary.user.name)}</td><td>@${esc(summary.user.username)}</td><td>${esc(fmt(row.date))}</td><td>${row.total}</td><td>${row.presencial}</td><td>${row.virtual}</td><td>${row.ratings}</td></tr>`).join('');
      return detail + `<tr class="subtotal"><td colspan="3">Total ${esc(summary.user.name)}</td><td>${summary.activity.total}</td><td>${summary.activity.presencial}</td><td>${summary.activity.virtual}</td><td>${summary.ratings}</td></tr>`;
    }).join('');
    const grandTotal=rows.reduce((total,row)=>({ records:total.records+row.activity.total, presencial:total.presencial+row.activity.presencial, virtual:total.virtual+row.activity.virtual, ratings:total.ratings+row.ratings }),{records:0,presencial:0,virtual:0,ratings:0});
    const html=`<!doctype html><html><head><meta charset="utf-8"><style>table{border-collapse:collapse;font-family:Arial,sans-serif}th,td{border:1px solid #cbd5e1;padding:8px;text-align:left;font-size:12px}th{background:#172554;color:#fff;font-weight:700}.title{background:#dbeafe;font-weight:800}.subtotal td{background:#eff6ff;font-weight:800}.grand td{background:#dcfce7;font-weight:900}</style></head><body><table><tr class="title"><td colspan="7">Reporte diario de avance por asesor</td></tr><tr class="title"><td colspan="7">Período: ${esc(period.label)} · Generado: ${esc(new Date().toLocaleString())} · Sede: ${esc(userSede(state.currentUser))}</td></tr><tr><th>Asesor</th><th>Usuario</th><th>Día</th><th>Registros</th><th>Presencial</th><th>Virtual</th><th>Calificaciones</th></tr>${dailyRowsHtml || '<tr><td colspan="7">Sin asesores para mostrar</td></tr>'}<tr class="grand"><td colspan="3">TOTAL GENERAL DEL PERÍODO</td><td>${grandTotal.records}</td><td>${grandTotal.presencial}</td><td>${grandTotal.virtual}</td><td>${grandTotal.ratings}</td></tr></table></body></html>`;
    const blob=new Blob([html], { type:'application/vnd.ms-excel;charset=utf-8' });
    const url=URL.createObjectURL(blob);
    const link=document.createElement('a');
    link.href=url; link.download=`Reporte_asesores_${String(userSede(state.currentUser)).replace(/[^a-z0-9]+/gi,'_')}_${period.from}_${period.to}.xls`;
    document.body.appendChild(link); link.click(); link.remove();
    setTimeout(()=>URL.revokeObjectURL(url),1200);
  };
  const payAllCommissionsBtn=document.getElementById('payAllCommissionsBtn');
  if(payAllCommissionsBtn) payAllCommissionsBtn.onclick=async()=>{
    if(!isAdmin() || payAllCommissionsBtn.disabled) return;
    const month=salaryViewMonthKey();
    const people=getSalaryPeople({ date:salaryViewMonthDate() }).people||[];
    const pending=people.filter(person=>person.salaryPaid && !person.commissionsPaid);
    const unpaidSalaries=people.filter(person=>!person.salaryPaid && !person.commissionsPaid).length;
    if(!pending.length){ await appAlert('No hay comisiones pendientes con sueldo pagado en los filtros seleccionados. Primero marca los sueldos como pagados.', 'Comisiones'); return; }
    const total=pending.reduce((sum,person)=>sum+Number(person.commissionsPay||0),0);
    if(!await appConfirm(`¿Marcar las comisiones de ${pending.length} colaborador(es) como pagadas para ${monthLabelFromKey(month)}? Total: ${money(total)}. Se aplican los filtros actuales${state.salarySede?` de la sede ${state.salarySede}`:''}.${unpaidSalaries?` Se excluyen ${unpaidSalaries} colaborador(es) con sueldo pendiente.`:''}`, { title:'Pago masivo de comisiones', confirmText:'Marcar comisiones pagadas' })) return;
    payAllCommissionsBtn.disabled=true;
    try{
      setAttendancePayload(await apiFetch('/api/attendance', {
        method:'POST',
        body:JSON.stringify({ action:'mark-all-commissions-paid', commissionPaidMonth:month, personIds:pending.map(person=>person.personId) }),
        busyMessage:'Marcando comisiones pagadas...'
      }));
      render();
      await appAlert('Las comisiones seleccionadas quedaron marcadas como pagadas.', 'Pago registrado');
    }catch(error){
      await appAlert(error.message || 'No se pudieron marcar las comisiones.', 'Error');
    }finally{ payAllCommissionsBtn.disabled=false; }
  };
  const payAllSalariesBtn=document.getElementById('payAllSalariesBtn');
  if(payAllSalariesBtn) payAllSalariesBtn.onclick=async()=>{
    if(!isAdmin()) return;
    const month=salaryViewMonthKey();
    const pending=(getSalaryPeople({ date:salaryViewMonthDate() }).people||[]).filter(person=>!person.salaryPaid);
    if(!pending.length){ await appAlert('No hay sueldos pendientes en este mes.', 'Todo al día'); return; }
    if(!await appConfirm(`¿Marcar ${pending.length} sueldo(s) como pagados para ${monthLabelFromKey(month)}? Las comisiones seguirán pendientes hasta que las marques aparte.`, { title:'Pago masivo de sueldos', confirmText:'Marcar pagados' })) return;
    try{
      payAllSalariesBtn.disabled=true;
      setAttendancePayload(await apiFetch('/api/attendance', {
        method:'POST',
        body:JSON.stringify({ action:'mark-all-salaries-paid', salaryPaidMonth:month, personIds:pending.map(person=>person.personId) }),
        busyMessage:'Marcando sueldos pagados...'
      }));
      await appAlert(`${pending.length} sueldo(s) fueron marcados como pagados.`, 'Pago registrado');
      render();
    }catch(error){
      payAllSalariesBtn.disabled=false;
      await appAlert(error.message || 'No se pudieron marcar los sueldos.', 'Error');
    }
  };
  if(exportSalariesBtn) exportSalariesBtn.onclick=()=>{
    const salaryData=getSalaryPeople();
    const rows=(salaryData?.people||[]).map(person=>`<tr>
      <td>
        <div style="font-weight:700;color:#f8fafc">${person.personName}</div>
        <div style="font-size:11px;color:#94a3b8">${person.personId}</div>
      </td>
      <td>
        <div style="font-weight:600;color:#e2e8f0">${person.payrollRole || 'Sin definir'}</div>
        <div style="font-size:11px;color:#94a3b8">${person.department || ''}</div>
        <div style="font-size:11px;color:#64748b;margin-top:4px">${getAttendanceSchedule(person).label}</div>
      </td>
      <td style="color:#22c55e;font-weight:700">${person.dayPayments.filter(day=>Number(day.dailyPay||0)>0).length}</td>
      <td style="color:${person.lateEntries>0?'#f59e0b':'#94a3b8'};font-weight:700">${person.lateEntries}</td>
      <td style="color:${person.totalDiscounts>0?'#ef4444':'#94a3b8'};font-weight:700">S/ ${person.totalDiscounts.toFixed(2)}</td>
      <td style="color:${person.totalExtraMinutes>0?'#22c55e':'#94a3b8'};font-weight:700">${minutesLabel(person.totalExtraMinutes)}</td>
      <td style="color:${Number(person.salaryPay||0)>0?'#22c55e':'#94a3b8'};font-weight:700">${money(person.salaryPay||0)}</td>
      <td style="color:${Number(person.commissionsPay||0)>0?'#22c55e':'#94a3b8'};font-weight:700">${money(person.commissionsPay||0)}</td>
      <td style="color:#22c55e;font-weight:800;font-size:18px">S/ ${person.estimatedSalary.toFixed(2)}</td>
    </tr>`).join('');
    const totalGeneral=(salaryData?.people||[]).reduce((sum, person)=>sum + Number(person.estimatedSalary||0),0);
    const selectedDepartment=state.attendanceDepartment || 'Todas las Areas';
    const selectedPerson=state.attendancePerson
      ? ((salaryData?.people||[]).find(person=>person.personId===state.attendancePerson)?.personName || 'Personal filtrado')
      : 'Todo el personal';
    const exportFormat=document.getElementById('salaryExportFormat')?.value || 'pdf';
    const detailedSections=buildSalaryDetailedExportSections(salaryData?.people || [], salaryViewMonthKey(), { excel: exportFormat==='excel' });
    if(exportFormat==='excel'){
      const excelHtml=`<!doctype html><html><head><meta charset="utf-8">
        <style>
          table{border-collapse:collapse;font-family:Arial,sans-serif}
          th{background:#dbeafe;color:#0f172a;font-weight:700}
          th,td{border:1px solid #cbd5e1;padding:8px;text-align:left;font-size:12px}
          .meta td{background:#f8fafc;font-weight:700}
          .total td{background:#dcfce7;font-weight:800}
          .employee-hero td,.employee-hero{background:#172554;color:#ffffff;font-weight:800}
          .section-row td{background:#dbeafe;color:#1e3a8a;font-weight:800;text-transform:uppercase}
          .plus-row td:last-child{color:#15803d;font-weight:800}
          .minus-row td:last-child{color:#b91c1c;font-weight:800}
          .neutral-row td:last-child{color:#334155;font-weight:700}
          .total-row td{background:#effcf5;color:#166534;font-weight:800}
          .final-row td{background:#bbf7d0;color:#14532d;font-weight:900}
          .mini-grid{display:none}
          h2,h3{font-family:Arial,sans-serif}
        </style>
      </head><body>
        <table>
          <tr class="meta"><td colspan="16">Sueldos ${esc(salaryData?.monthLabel||'')}</td></tr>
          <tr class="meta"><td colspan="16">Area: ${esc(selectedDepartment)} | Personal: ${esc(selectedPerson)} | Generado: ${esc(new Date().toLocaleString())}</td></tr>
          <tr class="total"><td colspan="11">Total filtrado</td><td>${(salaryData?.people||[]).reduce((sum,person)=>sum+Number(person.salaryPay||0),0).toFixed(2)}</td><td>${(salaryData?.people||[]).reduce((sum,person)=>sum+Number(person.commissionsPay||0),0).toFixed(2)}</td><td>${totalGeneral.toFixed(2)}</td><td colspan="2"></td></tr>
        </table>
        ${detailedSections || '<p>Sin personas para exportar.</p>'}
      </body></html>`;
      const blob=new Blob([excelHtml], { type:'application/vnd.ms-excel;charset=utf-8' });
      const url=URL.createObjectURL(blob);
      const link=document.createElement('a');
      const safeMonth=String(salaryData?.monthLabel||'sueldos').replace(/[^\w\-]+/g,'_');
      link.href=url;
      link.download=`Sueldos_${safeMonth}.xls`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(()=>URL.revokeObjectURL(url), 1200);
      return;
    }
    const w=window.open('','_blank');
    if(!w) return;
    w.document.write(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>Reportes de sueldo ${salaryData?.monthLabel||''}</title><style>
      :root{color-scheme:light}
      body{font-family:Arial,sans-serif;padding:24px;color:#14213d;background:linear-gradient(180deg,#eef4ff 0%,#f6f8fc 42%,#eef6f3 100%)}
      h1,h2,h3{margin:0} h3{font-size:15px;margin:16px 0 8px;color:#0f172a}
      p{margin:0;color:#5f708a}.top{background:linear-gradient(135deg,#0f172a,#172554 48%,#0f766e 100%);color:#fff;border-radius:22px;padding:24px 26px;margin-bottom:18px}.top p{color:#dbe8ff}
      .employee-report{background:rgba(255,255,255,.92);border:1px solid #dbe3f0;border-radius:20px;padding:16px;margin-bottom:22px;break-inside:avoid}
      .employee-hero{display:flex;justify-content:space-between;gap:16px;align-items:flex-start;background:linear-gradient(135deg,#172554,#0f766e);color:#fff;border-radius:16px;padding:16px;margin-bottom:12px}
      .employee-hero p,.employee-hero span{color:#dbe8ff}.employee-hero h2{font-size:22px;margin:4px 0}.employee-hero strong{font-size:24px}
      .mini-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px;margin:12px 0}.mini-grid div{border:1px solid #dbe3f0;background:#f8fbff;border-radius:12px;padding:10px}.mini-grid span{display:block;font-size:11px;color:#64748b}.mini-grid strong{font-size:17px;color:#0f172a}
      table{width:100%;border-collapse:separate;border-spacing:0;background:#fff;border:1px solid #dbe3f0;border-radius:12px;overflow:hidden;margin-bottom:12px}
      th,td{border-bottom:1px solid #e4ebf5;padding:8px 9px;font-size:10.5px;text-align:left;vertical-align:top}tbody tr:nth-child(even) td{background:#f8fbff}tbody tr:last-child td{border-bottom:none}th{background:#eaf2ff;color:#334155;font-size:9.5px;letter-spacing:.05em;text-transform:uppercase}
      .section-row td{background:linear-gradient(180deg,#dbeafe,#eff6ff) !important;color:#1e3a8a;font-size:10px;font-weight:800;letter-spacing:.07em;text-transform:uppercase}
      .plus-row td:last-child{color:#15803d;font-weight:800}
      .minus-row td:last-child{color:#b91c1c;font-weight:800}
      .neutral-row td:last-child{color:#334155;font-weight:700}
      .total-row td{background:#effcf5 !important;color:#166534;font-weight:800}
      .final-row td{background:linear-gradient(180deg,#bbf7d0,#dcfce7) !important;color:#14532d;font-size:13px;font-weight:900}
      @media print{body{background:#fff;padding:0}.top,.employee-report,table{break-inside:avoid}}
    </style></head><body><div class="top"><p>Reporte integral de sueldos</p><h1>${esc(salaryData?.monthLabel||'Sueldos')}</h1><p>Area: ${esc(selectedDepartment)} - Personal: ${esc(selectedPerson)} - Generado: ${esc(new Date().toLocaleString())}</p></div>${detailedSections || '<p>Sin personas para exportar.</p>'}<script>window.onload=()=>window.print();<\/script></body></html>`);
    w.document.close();
    return;
  };
  const resetAttendanceBtn=document.getElementById('resetAttendanceBtn');
  if(resetAttendanceBtn) resetAttendanceBtn.onclick=async()=>{
    const confirmed=await appPrompt('Para borrar la asistencia del mes, escribe exactamente: BORRAR ASISTENCIA', { title:'Borrar asistencia del mes', confirmText:'Borrar', danger:true });
    if(confirmed===null) return;
    try{
      setAttendancePayload(await apiFetch('/api/attendance', {
        method:'POST',
        body:JSON.stringify({ action:'reset', confirmText:confirmed }),
        busyMessage:'Borrando asistencia del mes...'
      }));
      state.attendanceSearch='';
      state.attendanceDate='';
      state.attendancePerson='';
      state.attendanceDepartment='';
      render();
    }catch(error){
      await appAlert(error.message || 'No se pudo borrar la asistencia del mes.', 'Error');
    }
  };
  const zlinkSyncBtn=document.getElementById('attendanceZlinkSyncBtn');
  if(zlinkSyncBtn) zlinkSyncBtn.onclick=async()=>{
    try{
      const status=await apiFetch('/api/attendance/zlink/webhook',{method:'GET',busyMessage:'Consultando conexion Zlink...'});
      const last=status.lastEvent;
      await appAlert(last ? `${last.summary} Ultimo evento: ${fmtDateTime(last.createdAt)}.` : status.configured ? 'Receptor preparado. Todavia no se ha recibido un evento de asistencia.' : 'La conexion de eventos de Zlink esta pendiente de configuracion.', 'Estado de Zlink');
    }catch(error){ await appAlert(error.message || 'No se pudo consultar la conexion.', 'Estado de Zlink'); }
  };
  const attendanceUploadBtn=document.getElementById('attendanceUploadBtn');
  const attendanceFileInput=document.getElementById('attendanceFileInput');
  if(attendanceUploadBtn && attendanceFileInput){
    attendanceUploadBtn.onclick=()=> attendanceFileInput.click();
    attendanceFileInput.onchange=async()=> {
      const file=attendanceFileInput.files && attendanceFileInput.files[0];
      if(!file) return;
      try{
        await uploadAttendanceFile(file);
      }catch(error){
        await appAlert(error.message || 'No se pudo subir el Excel de asistencia.', 'Error');
      } finally {
        attendanceFileInput.value='';
      }
    };
  }

  document.querySelectorAll('[data-attendance-edit]').forEach(el=>{
    el.onclick=()=>{
      try{
        state.attendanceEdit=JSON.parse(decodeURIComponent(el.dataset.attendanceEdit));
        render();
      }catch(error){
        appAlert('No se pudo abrir la edicion de asistencia.', 'Error');
      }
    };
  });

  const attendanceRequestCheckboxes=[...document.querySelectorAll('[data-attendance-request-select]')];
  const selectAllAttendanceRequests=document.getElementById('selectAllAttendanceRequests');
  const approveSelectedAttendanceRequests=document.getElementById('approveSelectedAttendanceRequests');
  const deleteSelectedAttendanceRequests=document.getElementById('deleteSelectedAttendanceRequests');
  const refreshAttendanceRequestSelection=()=>{
    const selectedCount=attendanceRequestCheckboxes.filter(el=>el.checked).length;
    attendanceRequestCheckboxes.forEach(el=>{
      const id=Number(el.dataset.attendanceRequestSelect);
      if(el.checked) ATTENDANCE_SELECTED_REQUEST_IDS.add(id);
      else ATTENDANCE_SELECTED_REQUEST_IDS.delete(id);
    });
    if(selectAllAttendanceRequests){
      selectAllAttendanceRequests.checked=attendanceRequestCheckboxes.length>0 && selectedCount===attendanceRequestCheckboxes.length;
      selectAllAttendanceRequests.indeterminate=selectedCount>0 && selectedCount<attendanceRequestCheckboxes.length;
    }
    if(deleteSelectedAttendanceRequests){
      deleteSelectedAttendanceRequests.disabled=selectedCount===0;
      deleteSelectedAttendanceRequests.textContent=`Eliminar seleccionadas (${selectedCount})`;
    }
    if(approveSelectedAttendanceRequests){
      approveSelectedAttendanceRequests.disabled=selectedCount===0;
      approveSelectedAttendanceRequests.textContent=`Aprobar seleccionadas (${selectedCount})`;
    }
  };
  attendanceRequestCheckboxes.forEach(el=>{ el.onchange=refreshAttendanceRequestSelection; });
  if(selectAllAttendanceRequests) selectAllAttendanceRequests.onchange=()=>{
    attendanceRequestCheckboxes.forEach(el=>{ el.checked=selectAllAttendanceRequests.checked; });
    refreshAttendanceRequestSelection();
  };
  if(approveSelectedAttendanceRequests) approveSelectedAttendanceRequests.onclick=async()=>{
    refreshAttendanceRequestSelection();
    const requestIds=[...ATTENDANCE_SELECTED_REQUEST_IDS];
    if(!requestIds.length) return;
    if(!await appConfirm(`Aprobar ${requestIds.length} solicitud(es)? Se aplicaran todos los cambios pedidos a la asistencia.`, { title:'Aprobar solicitudes', confirmText:'Aprobar' })) return;
    try{
      setAttendancePayload(await apiFetch('/api/attendance', {
        method:'POST',
        body:JSON.stringify({ action:'approve-requests', requestIds }),
        busyMessage:'Aprobando solicitudes...'
      }));
      ATTENDANCE_SELECTED_REQUEST_IDS.clear();
      render();
    }catch(error){
      await appAlert(error.message || 'No se pudieron aprobar las solicitudes.', 'Error');
    }
  };
  if(deleteSelectedAttendanceRequests) deleteSelectedAttendanceRequests.onclick=async()=>{
    refreshAttendanceRequestSelection();
    const requestIds=[...ATTENDANCE_SELECTED_REQUEST_IDS];
    if(!requestIds.length) return;
    if(!await appConfirm(`Eliminar ${requestIds.length} solicitud(es) pendiente(s)? Esta accion no modifica las marcaciones.`, { title:'Eliminar solicitudes', confirmText:'Eliminar', danger:true })) return;
    try{
      setAttendancePayload(await apiFetch('/api/attendance', {
        method:'POST',
        body:JSON.stringify({ action:'delete-requests', requestIds }),
        busyMessage:'Eliminando solicitudes...'
      }));
      ATTENDANCE_SELECTED_REQUEST_IDS.clear();
      render();
    }catch(error){
      await appAlert(error.message || 'No se pudieron eliminar las solicitudes.', 'Error');
    }
  };

  document.querySelectorAll('[data-attendance-approve]').forEach(el=>{
    el.onclick=async()=>{
      try{
        setAttendancePayload(await apiFetch('/api/attendance', {
          method:'POST',
          body:JSON.stringify({ action:'approve-request', requestId:Number(el.dataset.attendanceApprove) }),
          busyMessage:'Aprobando solicitud...'
        }));
        render();
      }catch(error){
        await appAlert(error.message || 'No se pudo aprobar la solicitud.', 'Error');
      }
    };
  });

  document.querySelectorAll('[data-attendance-reject]').forEach(el=>{
    el.onclick=async()=>{
      const reason=await appPrompt('Motivo del rechazo:', { title:'Rechazar solicitud', confirmText:'Rechazar', danger:true }) || '';
      try{
        setAttendancePayload(await apiFetch('/api/attendance', {
          method:'POST',
          body:JSON.stringify({ action:'reject-request', requestId:Number(el.dataset.attendanceReject), decisionReason:reason }),
          busyMessage:'Rechazando solicitud...'
        }));
        render();
      }catch(error){
        await appAlert(error.message || 'No se pudo rechazar la solicitud.', 'Error');
      }
    };
  });

  document.querySelectorAll('[data-collaborator-open]').forEach(el=>{
    el.onclick=()=>{
      state.collaboratorEditId=el.dataset.collaboratorOpen;
      render();
    };
  });

  document.querySelectorAll('[data-collaborator-delete]').forEach(el=>{
    el.onclick=async()=>{
      if(!isAdmin()) return;
      const personId=el.dataset.collaboratorDelete;
      const personName=el.dataset.collaboratorName || 'este colaborador';
      const confirmText=await appPrompt(`Para inactivar a ${personName}, escribe INACTIVAR COLABORADOR. No se borraran sus historicos, asistencias ni comisiones anteriores.`, {
        title:'Inactivar colaborador',
        confirmText:'Inactivar',
        danger:true
      });
      if(confirmText===null) return;
      try{
        setAttendancePayload(await apiFetch('/api/attendance', {
          method:'POST',
          body:JSON.stringify({ action:'delete-collaborator', personId, confirmText }),
          busyMessage:'Inactivando colaborador...'
        }));
        state.collaboratorEditId=null;
        state.attendancePerson='';
        await refreshState(false, CORE_STATE_MODULES);
        preserveMainScroll(()=>render());
      }catch(error){
        await appAlert(error.message || 'No se pudo eliminar el colaborador.', 'Error');
      }
    };
  });

  document.querySelectorAll('[data-collaborator-terminate]').forEach(el=>{
    el.onclick=async()=>{
      if(!isAdmin()) return;
      const personId=el.dataset.collaboratorTerminate;
      const personName=el.dataset.collaboratorName || 'este colaborador';
      const lastWorkingDate=await appPrompt(`Último día trabajado por ${personName} (formato AAAA-MM-DD). Desde el día siguiente se congelan asistencia y comisiones.`, { title:'Registrar renuncia', confirmText:'Continuar', value:new Date().toISOString().slice(0,10), danger:true });
      if(lastWorkingDate===null) return;
      if(!/^\d{4}-\d{2}-\d{2}$/.test(lastWorkingDate.trim())){ await appAlert('Usa el formato AAAA-MM-DD, por ejemplo 2026-09-07.', 'Fecha inválida'); return; }
      const reason=await appPrompt('Motivo o nota de cese (opcional).', { title:'Registrar renuncia', confirmText:'Registrar' });
      if(reason===null) return;
      try{
        setAttendancePayload(await apiFetch('/api/attendance', {
          method:'POST',
          body:JSON.stringify({ action:'terminate-collaborator', personId, lastWorkingDate:lastWorkingDate.trim(), reason }),
          busyMessage:'Registrando cese y congelando cálculos...'
        }));
        state.collaboratorStatus='inactive';
        state.attendancePerson='';
        await loadAttendance(true);
        await refreshState(false, CORE_STATE_MODULES);
        preserveMainScroll(()=>render());
      }catch(error){ await appAlert(error.message || 'No se pudo registrar la renuncia.', 'Error'); }
    };
  });

  document.querySelectorAll('[data-collaborator-reactivate]').forEach(el=>{
    el.onclick=async()=>{
      if(!isAdmin()) return;
      const personId=el.dataset.collaboratorReactivate;
      const personName=el.dataset.collaboratorName || 'este colaborador';
      if(!await appConfirm(`¿Reactivar a ${personName}? Volverá a aparecer como activo y conservará todo su historial anterior.`, { title:'Reactivar colaborador', confirmText:'Reactivar' })) return;
      try{
        setAttendancePayload(await apiFetch('/api/attendance', {
          method:'POST',
          body:JSON.stringify({ action:'reactivate-collaborator', personId }),
          busyMessage:'Reactivando colaborador...'
        }));
        state.collaboratorStatus='active';
        state.attendancePerson='';
        await loadAttendance(true);
        await refreshState(false, CORE_STATE_MODULES);
        preserveMainScroll(()=>render());
      }catch(error){
        await appAlert(error.message || 'No se pudo reactivar el colaborador.', 'Error');
      }
    };
  });

  document.querySelectorAll('[data-inactive-user-delete]').forEach(el=>{
    el.onclick=async()=>{
      const userName=el.dataset.inactiveUserName || 'este usuario';
      if(!await appConfirm(`Eliminar el acceso de ${userName}? Solo se eliminará si no tiene registros ni otro historial.`, {
        title:'Eliminar usuario inactivo',
        confirmText:'Eliminar usuario',
        danger:true
      })) return;
      try{
        await apiFetch(`/api/users/${el.dataset.inactiveUserDelete}`, {
          method:'DELETE',
          body:JSON.stringify({ personId:el.dataset.inactivePersonId }),
          busyMessage:'Eliminando usuario...'
        });
        await refreshState(false, CORE_STATE_MODULES);
        preserveMainScroll(()=>render());
      }catch(error){
        await appAlert(error.message || 'No se pudo eliminar el usuario inactivo.', 'No se eliminó');
      }
    };
  });

  const createLooseUser=async()=>{
    const name=await appPrompt('Nombre completo del usuario:', { title:'Crear usuario', confirmText:'Continuar' });
    if(!name) return;
    const username=await appPrompt('Usuario para iniciar sesion:', { title:'Crear usuario', defaultValue:defaultUsernameForPerson({ personName:name }), confirmText:'Continuar' });
    if(!username) return;
    const password=await appPrompt('Contrasena inicial:', { title:'Crear usuario', confirmText:'Crear' });
    if(!password) return;
    if(password.length<6){ await appAlert('La contrasena debe tener al menos 6 caracteres.', 'Falta contrasena'); return; }
    const role=isAdmin()
      ? (await appPrompt('Rol: employee, manager o admin', { title:'Crear usuario', defaultValue:'employee', confirmText:'Crear' }) || 'employee')
      : 'employee';
    const sede=isAdmin()
      ? (await appPrompt(`Sede (${SEDES.join(', ')}):`, { title:'Crear usuario', defaultValue:userSede(state.currentUser) || 'Lince', confirmText:'Crear' }) || 'Lince')
      : userSede(state.currentUser);
    const cleanRole=['employee','manager','admin'].includes(role) ? role : 'employee';
    await apiFetch('/api/users', {
      method:'POST',
      body:JSON.stringify({ name:name.trim(), username:username.trim(), password, role:localToRole(cleanRole), sede:normalizeSede(sede) }),
      busyMessage:'Creando usuario...'
    });
    await refreshState(false, CORE_STATE_MODULES);
    render();
  };
  ['createLooseUserBtn','createLooseUserBtn2'].forEach(id=>{
    const btn=document.getElementById(id);
    if(btn) btn.onclick=createLooseUser;
  });

  document.querySelectorAll('[data-payroll-save]').forEach(el=>{
    el.onclick=async()=>{
      const personId=el.dataset.payrollSave;
      try{
        await saveCollaboratorProfile(personId);
        preserveMainScroll(()=>render());
      }catch(error){
        await appAlert(error.message || 'No se pudo guardar el cargo y sueldo.', 'Error');
      }
    };
  });

  document.querySelectorAll('[data-payroll-role]').forEach(el=>{
    el.onchange=()=>{
      const personId=el.dataset.payrollRole;
      const salaryEl=document.querySelector(`[data-payroll-salary="${personId}"]`);
      const penaltyEl=document.querySelector(`[data-payroll-penalty="${personId}"]`);
      const bonusEl=document.querySelector(`[data-payroll-bonus="${personId}"]`);
      const employmentTypeEl=document.querySelector(`[data-employment-type="${personId}"]`);
      const managerPunctualWrap=document.querySelector(`[data-manager-punctual-bonus="${personId}"]`)?.closest('label');
      const roleConfig=getPayrollRoleConfig(el.value);
      if(salaryEl){
        salaryEl.value=getSuggestedMonthlySalary(el.value, employmentTypeEl?.value || 'FULL_TIME').toFixed(2);
      }
      if(penaltyEl){
        penaltyEl.value=Number((employmentTypeEl?.value==='PART_TIME' ? Number(roleConfig.penaltyPerMinute || 0) * 0.5 : Number(roleConfig.penaltyPerMinute || 0))).toFixed(2);
      }
      if(bonusEl){
        bonusEl.value=Number((employmentTypeEl?.value==='PART_TIME' ? Number(roleConfig.bonus || 0) * 0.5 : Number(roleConfig.bonus || 0))).toFixed(2);
      }
      if(managerPunctualWrap){
        managerPunctualWrap.classList.toggle('soft-hidden', el.value!=='Jefe de Sede');
      }
    };
  });

  document.querySelectorAll('[data-employment-type]').forEach(el=>{
    el.onchange=()=>{
      const personId=el.dataset.employmentType;
      const modeEl=document.querySelector(`[data-part-time-mode="${personId}"]`);
      if(modeEl){
        modeEl.disabled = el.value !== 'PART_TIME';
      }
      const roleEl=document.querySelector(`[data-payroll-role="${personId}"]`);
      const salaryEl=document.querySelector(`[data-payroll-salary="${personId}"]`);
      const penaltyEl=document.querySelector(`[data-payroll-penalty="${personId}"]`);
      const bonusEl=document.querySelector(`[data-payroll-bonus="${personId}"]`);
      const roleConfig=getPayrollRoleConfig(roleEl?.value || 'Sin definir');
      if(salaryEl){
        salaryEl.value=getSuggestedMonthlySalary(roleEl?.value || 'Sin definir', el.value).toFixed(2);
      }
      if(penaltyEl){
        penaltyEl.value=Number(el.value==='PART_TIME' ? Number(roleConfig.penaltyPerMinute || 0) * 0.5 : Number(roleConfig.penaltyPerMinute || 0)).toFixed(2);
      }
      if(bonusEl){
        bonusEl.value=Number(el.value==='PART_TIME' ? Number(roleConfig.bonus || 0) * 0.5 : Number(roleConfig.bonus || 0)).toFixed(2);
      }
    };
  });
}

function bindAttendanceEditModal(){
  const overlay=document.getElementById('aoverlay');
  const close=document.getElementById('attendanceEditClose');
  const save=document.getElementById('attendanceEditSave');
  const dayJustified=document.getElementById('attendanceDayJustified');
  const dayAbsent=document.getElementById('attendanceDayAbsent');
  const syncJustifiedDay=()=>{
    const absence=dayAbsent?.value==='1';
    if(dayJustified){dayJustified.disabled=absence;if(absence) dayJustified.value='0';}
    const enabled=absence || dayJustified?.value==='1';
    const entry=document.getElementById('attendanceEntryEdit');
    const exit=document.getElementById('attendanceExitEdit');
    const justifiedEntry=document.getElementById('attendanceEntryJustified');
    const justifiedExit=document.getElementById('attendanceExitJustified');
    if(entry){ entry.disabled=enabled; if(enabled) entry.value=absence?'':'00:00'; }
    if(exit){ exit.disabled=enabled; if(enabled) exit.value=absence?'':'00:00'; }
    if(justifiedEntry){ justifiedEntry.disabled=enabled; if(enabled) justifiedEntry.value='0'; }
    if(justifiedExit){ justifiedExit.disabled=enabled; if(enabled) justifiedExit.value='0'; }
  };
  if(dayJustified) dayJustified.onchange=syncJustifiedDay;
  if(dayAbsent) dayAbsent.onchange=syncJustifiedDay;
  syncJustifiedDay();
  if(overlay) overlay.onclick=e=>{ if(e.target===overlay){ state.attendanceEdit=null; render(); } };
  if(close) close.onclick=()=>{ state.attendanceEdit=null; render(); };
  if(save) save.onclick=async()=>{
    const item=state.attendanceEdit;
    if(!item) return;
    const absence=dayAbsent?.value==='1';
    const absenceChanged=absence!==!!item.absence;
    const entry=document.getElementById('attendanceEntryEdit')?.value?.trim();
    const exit=document.getElementById('attendanceExitEdit')?.value?.trim();
    const justifiedDay=document.getElementById('attendanceDayJustified')?.value==='1';
    const justifiedEntry=justifiedDay ? false : document.getElementById('attendanceEntryJustified')?.value==='1';
    const justifiedExit=justifiedDay ? false : document.getElementById('attendanceExitJustified')?.value==='1';
    const originalEntry=(item.entryTime || '').slice(0,5);
    const originalExit=(item.exitTime || '').slice(0,5);
    const entryChanged=!!entry && entry!==originalEntry;
    const exitChanged=!!exit && exit!==originalExit;
    const justifiedEntryChanged=justifiedEntry !== !!item.justifiedEntry;
    const justifiedExitChanged=justifiedExit !== !!item.justifiedExit;
    const justifiedDayChanged=justifiedDay !== !!item.justifiedDay;
    const managerRequest=isManager()&&!isAdmin();
    const reason=document.getElementById('attendanceChangeReason')?.value?.trim() || '';
    if(!entry && !exit && !justifiedDay && !absence && !item.absence){
      await appAlert('Debes poner al menos una hora.');
      return;
    }
    if(managerRequest && !reason){
      await appAlert('Debes indicar el motivo del cambio.');
      return;
    }
    if(!absenceChanged && !entryChanged && !exitChanged && !justifiedEntryChanged && !justifiedExitChanged && !justifiedDayChanged){
      state.attendanceEdit=null;
      render();
      return;
    }
    try{
      setAttendancePayload(await apiFetch('/api/attendance', {
        method:'POST',
        body:JSON.stringify({
          action: managerRequest ? 'request-change' : undefined,
          ...(absenceChanged?{absence}:{}),
          personId:item.personId,
          date:item.date,
          ...(managerRequest && justifiedDay ? { entryTime:'00:00', exitTime:'00:00' } : {}),
          ...(managerRequest && !justifiedDay ? { entryTime:entry || null, exitTime:exit || null } : {}),
          ...(!managerRequest && justifiedDay ? { entryTime:'00:00', exitTime:'00:00' } : {}),
          ...(!managerRequest && !justifiedDay && entryChanged ? { entryTime:entry } : {}),
          ...(!managerRequest && !justifiedDay && exitChanged ? { exitTime:exit } : {}),
          justifiedEntry,
          justifiedExit,
          justifiedDay,
          reason
        }),
        busyMessage:managerRequest?'Enviando solicitud de asistencia...':'Guardando ajuste de asistencia...'
      }));
      state.attendanceEdit=null;
      render();
    }catch(error){
      await appAlert(error.message || 'No se pudo guardar la asistencia.', 'Error');
    }
  };
}

function bindRatingEditModal(){
  const overlay=document.getElementById('ratingEditOverlay');
  const close=document.getElementById('ratingEditClose');
  const save=document.getElementById('ratingEditSave');
  if(overlay) overlay.onclick=e=>{ if(e.target===overlay){ state.ratingEdit=null; render(); } };
  if(close) close.onclick=()=>{ state.ratingEdit=null; render(); };
  if(save) save.onclick=async()=>{
    const item=state.ratingEdit;
    if(!item) return;
    const advisor=document.getElementById('ratingEditAdvisor')?.value?.trim() || '';
    const dni=document.getElementById('ratingEditDni')?.value?.trim() || '';
    const comment=document.getElementById('ratingEditComment')?.value?.trim() || '';
    if(advisor.length<2){
      await appAlert('Ingresa el nombre o asesor.', 'Falta nombre');
      return;
    }
    await apiFetch('/api/ratings', {
      method:'PATCH',
      body:JSON.stringify({ rowKey:item.rowKey, advisor, dni, comment }),
      busyMessage:'Guardando edicion de calificacion...'
    });
    state.ratingEdit=null;
    await loadRatings(true);
    render();
  };
}

function bindSafetypayEditModal(){
  const overlay=document.getElementById('safetypayEditOverlay');
  const close=()=>{ resetSafetypayDraft(); render(); };
  const closeButton=document.getElementById('safetypayEditClose');
  const saveButton=document.getElementById('safetypayEditSave');
  if(overlay) overlay.onclick=event=>{ if(event.target===overlay) close(); };
  if(closeButton) closeButton.onclick=close;
  if(saveButton) saveButton.onclick=async()=>{
    // Los jefes de sede también pueden editar los códigos de su propia sede.
    // La API vuelve a validar la sede y nunca les permite editar los del admin.
    if(!canEditSafetypayCodes() || !SAFETYPAY_EDIT_ID) return;
    const payload={
      clientDni:document.getElementById('safetypayEditDni')?.value?.trim() || '',
      cardLast4:document.getElementById('safetypayEditCard')?.value?.trim() || '',
      customerCode:document.getElementById('safetypayEditCustomerCode')?.value?.trim() || '',
      bank:document.getElementById('safetypayEditBank')?.value || 'CMR',
      code:document.getElementById('safetypayEditCode')?.value || 'ATK1',
      amount:Number(document.getElementById('safetypayEditAmount')?.value || 0),
      operationNumber:document.getElementById('safetypayEditOperation')?.value?.trim() || ''
    };
    if(payload.clientDni.length<6){ await appAlert('Ingresa el DNI del cliente.', 'Falta DNI'); return; }
    if(!/^\d{4}$/.test(payload.cardLast4)){ await appAlert('Ingresa los 4 últimos dígitos de la tarjeta.', 'Falta tarjeta'); return; }
    if(!/^\d{6}$/.test(payload.customerCode)){ await appAlert('Ingresa el código cliente de 6 dígitos.', 'Falta código'); return; }
    if(!payload.amount || payload.amount<=0){ await appAlert('Ingresa un monto válido.', 'Falta monto'); return; }
    if(payload.operationNumber.length<3){ await appAlert('Ingresa el número de operación.', 'Falta operación'); return; }
    const duplicates=findSafetypayDraftDuplicates(payload, Number(SAFETYPAY_EDIT_ID));
    if(duplicates.length && !await appConfirm('Hay códigos similares en este mes. ¿Deseas guardar los cambios de todas formas?', { title:'SafetyPay duplicado', confirmText:'Guardar igual', danger:true })) return;
    saveButton.disabled=true;
    try{
      const result=await apiFetch('/api/safetypay', {
        method:'PATCH', body:JSON.stringify({ id:Number(SAFETYPAY_EDIT_ID), ...payload }), busyMessage:'Actualizando código Safetypay...'
      });
      const previous=SAFETYPAY_CODES.find(item=>Number(item.id)===Number(SAFETYPAY_EDIT_ID));
      const mappedEntry=mapSafetypayCode({ ...(previous||{}), ...(result.entry||{}), ...payload, user:result.entry?.user || previous?.user });
      SAFETYPAY_CODES=SAFETYPAY_CODES.map(item=>Number(item.id)===Number(mappedEntry.id)?mappedEntry:item);
      resetSafetypayDraft();
      await appAlert('Código Safetypay actualizado.', 'Listo');
      render();
    }catch(error){
      saveButton.disabled=false;
      await appAlert(error.message || 'No se pudo actualizar el código.', 'Error');
    }
  };
}

async function saveCollaboratorProfile(personId){
  const roleEl=document.querySelector(`[data-payroll-role="${personId}"]`);
  const salaryEl=document.querySelector(`[data-payroll-salary="${personId}"]`);
  const penaltyEl=document.querySelector(`[data-payroll-penalty="${personId}"]`);
  const bonusEl=document.querySelector(`[data-payroll-bonus="${personId}"]`);
  const commissionsEnabledEl=document.querySelector(`[data-commissions-enabled="${personId}"]`);
  const employmentTypeEl=document.querySelector(`[data-employment-type="${personId}"]`);
  const partTimeModeEl=document.querySelector(`[data-part-time-mode="${personId}"]`);
  const managerPunctualBonusEl=document.querySelector(`[data-manager-punctual-bonus="${personId}"]`);
  const sedeEl=document.querySelector(`[data-collaborator-sede="${personId}"]`);
  const hireDateEl=document.querySelector(`[data-collaborator-hire-date="${personId}"]`);
  const transferDateEl=document.querySelector(`[data-collaborator-transfer-date="${personId}"]`);
  const linkedUserEl=document.querySelector(`[data-linked-user="${personId}"]`);
  const userActionEl=document.querySelector(`[data-user-action="${personId}"]`);
  const userNameEl=document.querySelector(`[data-user-name="${personId}"]`);
  const usernameEl=document.querySelector(`[data-user-username="${personId}"]`);
  const userPasswordEl=document.querySelector(`[data-user-password="${personId}"]`);
  const userRoleEl=document.querySelector(`[data-user-role="${personId}"]`);
  if(!personId || !roleEl || !salaryEl || !penaltyEl || !bonusEl || !employmentTypeEl || !partTimeModeEl) return;
  const existingPerson=(ATTENDANCE?.people||[]).find(person=>person.personId===personId)||(getSalaryPeople().people||[]).find(person=>person.personId===personId);
  let linkedUser=userForAttendancePerson(existingPerson);
  const previousSede=getPersonSede(existingPerson);
  const nextSede=normalizeSede(sedeEl?.value || previousSede || '');
  const hireDate=(hireDateEl?.value || '').trim();
  const transferEffectiveDate=(transferDateEl?.value || '').trim();
  const userAction=userActionEl?.value || 'link';
  let linkedUserId=Number(linkedUserEl?.value || 0) || 0;
  if(linkedUserEl && !linkedUserEl.value) linkedUser=null;
  const userName=(userNameEl?.value || '').trim();
  const username=(usernameEl?.value || '').trim();
  const userPassword=(userPasswordEl?.value || '').trim();
  const userRole=userRoleEl?.value || 'employee';
  if(userAction==='create'){
    if(!userName || !username || userPassword.length<6){
      throw new Error('Para crear usuario completa nombre, usuario y clave inicial de minimo 6 caracteres.');
    }
    const payload=await apiFetch('/api/users', {
      method:'POST',
      body:JSON.stringify({ name:userName, username, password:userPassword, role:localToRole(userRole), sede:nextSede || 'Lince' }),
      busyMessage:'Creando usuario conectado...'
    });
    if(payload.user){
      linkedUser=mapUser(payload.user);
      linkedUserId=Number(linkedUser.id);
      USERS=[...USERS.filter(user=>Number(user.id)!==linkedUserId), linkedUser].sort((a,b)=>String(a.name||'').localeCompare(String(b.name||'')));
    }
  }else if(linkedUserId){
    linkedUser=USERS.find(user=>Number(user.id)===linkedUserId) || linkedUser;
    if(linkedUser && (userName || nextSede || userRole)){
      await apiFetch(`/api/users/${linkedUser.id}`, {
        method:'PATCH',
        body:JSON.stringify({
          name:userName || linkedUser.name,
          username:username || linkedUser.username,
          role:localToRole(userRole || linkedUser.role),
          sede:nextSede || userSede(linkedUser),
          transferEffectiveDate,
          previousSede:userSede(linkedUser)
        }),
        busyMessage:'Actualizando usuario conectado...'
      });
      if(userPassword){
        await apiFetch(`/api/users/${linkedUser.id}/password`, {
          method:'POST',
          body:JSON.stringify({ password:userPassword }),
          busyMessage:'Actualizando clave...'
        });
      }
    }
  }
  const existingTransfers=getPersonTransferHistory(existingPerson);
  const nextTransfers=[...existingTransfers];
  if(nextSede && previousSede && nextSede!==previousSede && /^\d{4}-\d{2}-\d{2}$/.test(transferEffectiveDate)){
    nextTransfers.push({ from:previousSede, to:nextSede, effectiveDate:transferEffectiveDate });
  }
  const extraBonuses={
    ...(existingPerson?.extraBonuses || {}),
    __bankAccounts: collectBankAccounts(personId),
    ...(nextSede ? { __currentSede:nextSede } : {}),
    ...(hireDate ? { __hireDate:hireDate } : {}),
    ...(previousSede ? { __baseSede:normalizeSede(existingPerson?.extraBonuses?.__baseSede || sedeFromDepartment(existingPerson?.department || '') || previousSede) } : {}),
    __linkedUserId: linkedUserId || null,
    __commissionsEnabled: commissionsEnabledEl ? !!commissionsEnabledEl.checked : !blocksVariablePay(existingPerson),
    __sedeTransfers: nextTransfers,
    managerPunctualStaffAmount: Number(managerPunctualBonusEl?.value || DEFAULT_MANAGER_PUNCTUAL_STAFF_BONUS)
  };
  if(nextSede && previousSede && nextSede!==previousSede && !/^\d{4}-\d{2}-\d{2}$/.test(transferEffectiveDate)){
    throw new Error('Indica la fecha desde la que cuenta la nueva sede.');
  }
  setAttendancePayload(await apiFetch('/api/attendance', {
    method:'POST',
    body:JSON.stringify({
      action:'profile',
      personId,
      payrollRole: roleEl.value,
      monthlySalary: Number(salaryEl.value || 0),
      salaryEffectiveMonth:document.querySelector(`[data-salary-effective-month="${personId}"]`)?.value || limaTodayKey().slice(0,7),
      penaltyPerMinute: Number(penaltyEl.value || 0),
      bonusAmount: Number(bonusEl.value || 0),
      extraBonuses,
      employmentType: employmentTypeEl.value,
      partTimeMode: employmentTypeEl.value==='PART_TIME' ? partTimeModeEl.value : null
    }),
    busyMessage:'Guardando colaborador...'
  }));
  if(userAction!=='create' && !linkedUserId && linkedUser && nextSede && (nextSede!==userSede(linkedUser) || (previousSede && previousSede!==nextSede && transferEffectiveDate))){
    await apiFetch(`/api/users/${linkedUser.id}`, {
      method:'PATCH',
      body:JSON.stringify({
        name:linkedUser.name,
        username:linkedUser.username,
        role:localToRole(linkedUser.role),
        sede:nextSede,
        transferEffectiveDate,
        previousSede
      }),
      busyMessage:'Actualizando sede del usuario...'
    });
  }
  await refreshState(false, CORE_STATE_MODULES);
}

function bindCollaboratorEditModal(){
  const overlay=document.getElementById('collaboratorEditOverlay');
  const close=()=>{ state.collaboratorEditId=null; render(); };
  if(overlay) overlay.onclick=e=>{ if(e.target===overlay) close(); };
  document.querySelectorAll('[data-collaborator-close]').forEach(el=>{ el.onclick=close; });
  document.querySelectorAll('[data-collaborator-history-load]').forEach(el=>{
    el.onclick=()=>{
      const box=document.getElementById('collaboratorHistoryBox');
      const personId=String(el.dataset.collaboratorHistoryLoad || '');
      if(!box || !personId) return;
      box.innerHTML='<div class="collaborator-footer-note">Calculando historico...</div>';
      setTimeout(()=>{
        try{
          const salaryData=getSalaryPeople({ ignoreFilters:true, date:salaryViewMonthDate() });
          const person=(salaryData.people||[]).find(item=>String(item.personId)===personId);
          if(!person) throw new Error('No se encontro el colaborador.');
          box.innerHTML=renderCollaboratorHistoryContent(person);
        }catch(error){
          box.innerHTML=`<div class="alert-banner"><div class="ab-icon">!</div><div class="ab-text"><strong>No se pudo cargar el historico.</strong> ${esc(error?.message || 'error desconocido')}</div></div>`;
        }
      }, 30);
    };
  });
  const save=document.querySelector('[data-collaborator-modal-save]');
  if(save) save.onclick=async()=>{
    const personId=save.dataset.collaboratorModalSave;
    try{
      await saveCollaboratorProfile(personId);
      state.collaboratorEditId=null;
      preserveMainScroll(()=>render());
    }catch(error){
      await appAlert(error.message || 'No se pudo guardar el colaborador.', 'Error');
    }
  };
}

function bindModal(){
  const ov=document.getElementById('moverlay');
  const mc=document.getElementById('mclose');
  const ms=document.getElementById('msave');
  const md=document.getElementById('mdel');
  const mv=document.getElementById('mvalidate');
  const mr=document.getElementById('mreject');
  const tipoEdit=document.getElementById('et');
  const fechaOpEdit=document.getElementById('eo');
  if(tipoEdit&&fechaOpEdit){
    const syncEdit=()=>{
      if(tipoEdit.value==='registro') fechaOpEdit.value='';
    };
    tipoEdit.onchange=syncEdit;
  }
  if(ov) ov.onclick=e=>{ if(e.target===ov){ state.modal=null; render(); } };
  if(mc) mc.onclick=()=>{ state.modal=null; render(); };
  if(ms) ms.onclick=async()=>{
    if(EDIT_RECORD_SUBMITTING) return;
    const current=RECORDS.find(r=>r.id===state.modal);
    if(!current) return;
    EDIT_RECORD_SUBMITTING = true;
    ms.disabled = true;
    ms.textContent = 'Guardando...';
    ms.style.opacity = '0.7';
    ms.style.cursor = 'wait';
    const locked=isApprovalLocked(current);
    const selectedTipo=document.getElementById('et').value;
    const fechaOperacion=document.getElementById('eo').value;
    const tipo=fechaOperacion?'operacion':selectedTipo;
    if(!locked && selectedTipo==='operacion'&&!fechaOperacion){
      await appAlert('Debes indicar la fecha de operacion para marcar este registro como operacion.');
      EDIT_RECORD_SUBMITTING = false;
      if(ms){
        ms.disabled = false;
        ms.textContent = 'Guardar';
        ms.style.opacity = '';
        ms.style.cursor = '';
      }
      return;
    }
    try{
      await apiFetch(`/api/records/${state.modal}`, {
        method:'PATCH',
        body:JSON.stringify({
          type:localToType(locked ? current.tipo : tipo),
          operationDate:locked ? (current.fechaOperacion || null) : (tipo==='operacion'?fechaOperacion || null:null),
          mode:localToMode(document.getElementById('em').value),
          uploadPlatform:localToPlatform(locked ? current.plataforma : document.getElementById('ep').value),
          notes:locked ? (current.notas || null) : (document.getElementById('en').value.trim() || null)
        })
      });
      await refreshState(false, [...new Set([...CORE_STATE_MODULES, 'records'])]);
      state.modal=null;
      render();
    }catch(error){
      await appAlert(error.message || 'No se pudo guardar el registro.', 'Error');
    } finally {
      EDIT_RECORD_SUBMITTING = false;
      if(ms){
        ms.disabled = false;
        ms.textContent = 'Guardar';
        ms.style.opacity = '';
        ms.style.cursor = '';
      }
    }
  };
  if(mv) mv.onclick=async()=>{ if(await validateRecord(state.modal)){ state.modal=null; render(); } };
  if(mr) mr.onclick=async()=>{
    const reason=await appPrompt('Motivo del rechazo:', { title:'Rechazar registro', confirmText:'Rechazar', danger:true });
    if(reason&&reason.trim()){ await rejectRecord(state.modal, reason.trim()); state.modal=null; render(); }
  };
  if(md) md.onclick=async()=>{
    const rec=RECORDS.find(r=>r.id===state.modal);
    if(!canDeleteRecord(rec)) return;
    if(await appConfirm('Eliminar este registro?', { title:'Eliminar registro', confirmText:'Eliminar', danger:true })){
      try{
        await apiFetch(`/api/records/${state.modal}`, { method:'DELETE', busyMessage:'Eliminando registro...' });
        await refreshState(false, [...new Set([...CORE_STATE_MODULES, 'records'])]);
        state.modal=null;
        render();
      }catch(error){
        await appAlert(error.message || 'No se pudo eliminar el registro.', 'Error');
      }
    }
  };
}

function bindNuevoModal(){
  const ov=document.getElementById('noverlay');
  const close=document.getElementById('nclose');
  const submit=document.getElementById('nsub');
  syncNuevoForm();
  if(ov) ov.onclick=e=>{ if(e.target===ov){ state.newModal=false; render(); } };
  if(close) close.onclick=()=>{ state.newModal=false; render(); };
  if(submit) submit.onclick=submitNuevoRegistro;
}

document.addEventListener('click', event=>{
  const salaryTarget=event.target?.closest?.('[data-salary-detail], [data-salary-detail-btn]');
  if(!salaryTarget) return;
  event.preventDefault();
  event.stopPropagation();
  openSalaryDetail(salaryTarget.dataset.salaryDetail || salaryTarget.dataset.salaryDetailBtn);
});

boot();







