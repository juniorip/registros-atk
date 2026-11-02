const fs=require('node:fs'),ts=require('typescript'),vm=require('node:vm'),assert=require('node:assert/strict');
function moduleCode(file){return ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText;}
function fn(file,name){const tree=ts.createSourceFile(file,fs.readFileSync(file,'utf8'),99,true);return ts.transpileModule(tree.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text===name).getText(tree),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText;}
const query={exports:{}};vm.createContext(query);vm.runInContext(moduleCode('src/lib/audit-query.ts'),query);const build=q=>query.exports.auditQuery(new URLSearchParams(q));
function match(row,where){return Object.entries(where).every(([key,value])=>{
 if(key==='AND')return value.every(w=>match(row,w));if(key==='OR')return value.some(w=>match(row,w));
 const actual=row[key];if(value===null||typeof value!=='object')return actual===value;
 if('is'in value)return !!actual&&match(actual,value.is);
 return Object.entries(value).every(([op,wanted])=>op==='not'?actual!==null&&actual!==wanted:op==='in'?wanted.includes(actual):op==='contains'?String(actual||'').toLowerCase().includes(wanted.toLowerCase()):op==='gte'?new Date(actual)>=new Date(wanted):op==='lte'?new Date(actual)<=new Date(wanted):op==='mode'?true:false);
});}
const records=[{actorId:1,actor:{name:'Admin General'},module:'Asistencia',action:'APROBAR_SOLICITUD'}, {actorId:82,actor:{name:'Jhonatan'},module:'Asistencia',action:'APROBAR_SOLICITUD'}, {actorId:3,actor:{name:'Jefe Norte'},module:'Referidos',action:'RECHAZAR'}, {actorId:null,actor:null,module:'zlink-webhook',action:'receive'}];
for(const group of ['all','attendance','approved','rejected','created','edited','deleted','system'])assert(!records.filter(r=>match(r,build({group}).where)).some(r=>r.actorId===1),'Admin General excluded in every category');
assert.deepEqual(records.filter(r=>match(r,build({group:'approved'}).where)).map(r=>r.actorId),[82],'other admins remain visible');
assert.deepEqual(records.filter(r=>match(r,build({group:'rejected',module:'Referidos'}).where)).map(r=>r.actorId),[3]);
assert.deepEqual(records.filter(r=>match(r,build({group:'system'}).where)).map(r=>r.actorId),[null]);
assert.equal(build({limit:'999',page:'2'}).limit,100);assert.equal(build({page:'0'}).page,1);
const range=build({from:'2026-10-31',to:'2026-10-31'});assert(JSON.stringify(range.where).includes('2026-11-01T04:59:59.999Z'),'Lima end-of-day bound');
assert.throws(()=>build({from:'2026-02-30'}));assert.throws(()=>build({from:'2026-11-01',to:'2026-10-31'}));
const sanitizer={exports:{},require:name=>name==='@prisma/client'?{}:{prisma:{}}};vm.createContext(sanitizer);vm.runInContext(moduleCode('src/lib/change-log.ts'),sanitizer);
const clean=sanitizer.exports.sanitizeAuditValue({passwordHash:'secret',user:{name:'Jefe',accessToken:'secret'},evidenceImage:'base64',status:'APPROVED'});assert(!JSON.stringify(clean).includes('secret'));assert.equal(clean.user.name,'Jefe');
// Run an actual decision handler against isolated persistence: failures must
// never be logged as successful approvals or rejections.
let allowed=true,closed=false,fail=false;const events=[];const row={id:9,clientName:'Fixture',dni:'fixture',historicalSede:'Norte',validatedAt:null,rejectedAt:null};
const c={exports:{},NextResponse:{json:(body,opts={})=>({body,status:opts.status||200})},requireApiUser:async()=>({user:{id:3}}),decisionSchema:{safeParse:body=>({success:true,data:body})},canValidateOrReject:()=>allowed,recordAccountingMonth:()=> '2026-10',isMonthClosedForRole:async()=>closed,logChange:async log=>events.push(['log',log]),prisma:{record:{findUnique:async()=>row,findMany:async()=>[],update:async()=>{if(fail)throw Error('database failure');events.push(['write']);}}}};
vm.createContext(c);vm.runInContext(fn('src/app/api/records/[id]/decision/route.ts','POST'),c);
(async()=>{
 const post=action=>c.exports.POST({json:async()=>({action,reason:'motivo'})},{params:Promise.resolve({id:'9'})});
 assert.equal((await post('validate')).status,200);assert.equal(events[0][0],'write');assert.equal(events[1][1].action,'APROBAR');
 events.length=0;assert.equal((await post('reject')).status,200);assert.equal(events[1][1].action,'RECHAZAR');
 events.length=0;allowed=false;assert.equal((await post('validate')).status,403);assert.equal(events.length,0);
 allowed=true;closed=true;assert.equal((await post('validate')).status,403);assert.equal(events.length,0);
 closed=false;fail=true;await assert.rejects(()=>post('validate'));assert.equal(events.length,0);
 // Frontend result rendering escapes recorded text and exposes distinct tabs.
 const ui={CHANGE_LOGS:[{createdAt:'2026-10-31',actor:{name:'<script>'},module:'Registros',action:'APROBAR',summary:'fixture',before:{entry:'09:24'},after:{entry:'09:04'}}],CHANGE_LOGS_LOADING:false,CHANGE_LOGS_META:{total:200,page:1,limit:40},state:{historyGroup:'approved'},isAdmin:()=>true,fmtDateTime:x=>x,esc:x=>String(x??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;')};
 vm.createContext(ui);vm.runInContext(fn('public/legacy-app.js','renderAuditChange')+fn('public/legacy-app.js','renderChangeHistory'),ui);const html=ui.renderChangeHistory();assert(html.includes('Asistencias')&&html.includes('Rechazados')&&html.includes('Ver cambio'));assert(!html.includes('<script>'));assert(html.includes('Página 1 de 5'));
 const attendance=ui.renderAuditChange({module:'Asistencia',action:'EDITAR',before:{date:'2026-10-06',entryTime:null,exitTime:null,punches:[],justifiedDay:false},after:{date:'2026-10-06',entry:'00:00',exit:'00:00',justifiedDay:true}});
 assert(attendance.includes('Sin marcaje')&&attendance.includes('Día justificado'));assert(!attendance.includes('00:00')&&!attendance.includes('punches')&&!attendance.includes('<pre>'),'human-readable attendance summary, no JSON or fake midnight hours');
 const clocks=ui.renderAuditChange({module:'Asistencia',action:'EDITAR',before:{entryTime:'09:24:00',exitTime:'18:00:00'},after:{entry:'09:04'}});assert(clocks.includes('09:24')&&clocks.includes('09:04')&&clocks.includes('Entrada'));assert(!clocks.includes('Salida</td>'),'unchanged exit omitted');
 console.log('PASS: Admin General excluded, Jhonatan retained, module/action filters, Lima dates, pagination, secret redaction, success-only audit after persistence, permission/failure guards, and safe separated UI.');
})().catch(e=>{console.error(e);process.exitCode=1});

