const fs=require('node:fs'),vm=require('node:vm'),ts=require('typescript'),assert=require('node:assert/strict');
let profile={personId:'fixture',extraBonuses:{__salaryHistory:[{effectiveMonth:'2026-10',monthlySalary:1300}],__bankAccounts:[{bank:'fixture'}]}},override={entryTime:'09:05:00',exitTime:'18:45:00'},writes=0,request;
const raw={date:'2026-10-31',entryTime:'09:05:00',exitTime:'18:45:00',punches:['09:05:00','18:45:00']},original=JSON.stringify(raw);
const c={logChange:async()=>{},toEmploymentType:x=>x,toPartTimeMode:x=>x,normalizeEmploymentType:x=>x||"FULL_TIME",normalizePartTimeMode:x=>x||null,exports:{},normalizeTime:x=>x||null,bootstrapAttendanceStore:async()=>{},AttendanceRequestStatus:{PENDING:'PENDING',APPROVED:'APPROVED',REJECTED:'REJECTED'},prisma:{attendanceProfile:{findUnique:async()=>profile,upsert:async({update})=>{profile={...profile,...update}}},attendanceOverride:{upsert:async({update})=>{writes++;override={...override,...update}}},attendanceChangeRequest:{create:async({data})=>{request={id:1,status:'PENDING',...data}},findUnique:async()=>request,update:async({data})=>{request={...request,...data}}}}};
vm.createContext(c);const tree=ts.createSourceFile('attendance.ts',fs.readFileSync('src/lib/attendance.ts','utf8'),99,true);
for(const name of ['writeAttendanceOverride','recomputeDay','createAttendanceChangeRequest','decideAttendanceChangeRequest']){const fn=tree.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text===name);vm.runInContext(ts.transpileModule(fn.getText(tree),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText,c);}
const app=ts.createSourceFile('app.js',fs.readFileSync('public/legacy-app.js','utf8'),99,true,1),front={SALARY_BASE_DAYS:30};vm.createContext(front);vm.runInContext(app.statements.filter(n=>ts.isFunctionDeclaration(n)&&['computeAttendancePayment','attendanceDayWorked','attendanceStatusMeta','recomputeDisplayedAttendanceDay'].includes(n.name?.text)).map(n=>n.getText(app)).join('\n'),front);
(async()=>{
 await c.exports.writeAttendanceOverride({personId:'fixture',date:raw.date,absence:true});assert.equal(writes,0,'absence cannot erase or replace manual punches');
 const day=c.recomputeDay(raw,{},profile);assert.equal(day.absence,true);assert.equal(day.entryTime,null);assert.equal(day.exitTime,null);assert.equal(JSON.stringify(raw),original,'original biometric day unchanged');
 assert.equal(front.computeAttendancePayment({...day,calendarException:{kind:'PAID_REST'}},{}).dailyPay,0,'absence prevents payment and month-close projection');
 assert.equal(front.attendanceDayWorked({...day,entryTime:'09:00'}),false);assert.equal(front.attendanceStatusMeta(day).label,'Sin marcaje');assert.equal(front.recomputeDisplayedAttendanceDay(day,{}).entryTime,null);
 assert.equal(profile.extraBonuses.__salaryHistory[0].monthlySalary,1300);assert.equal(profile.extraBonuses.__bankAccounts[0].bank,'fixture');
 await c.exports.writeAttendanceOverride({personId:'fixture',date:raw.date,absence:false});assert(!profile.extraBonuses.__attendanceAbsences[raw.date]);assert.equal(override.exitTime,'18:45:00','removing absence keeps prior correction');
 await c.exports.createAttendanceChangeRequest({personId:'fixture',personName:'Fixture',department:'Norte',date:raw.date,absence:true,reason:'No asistió',requestedById:2});assert(request.reason.startsWith('[FALTA] '));assert(!profile.extraBonuses.__attendanceAbsences[raw.date],'manager request alone does not apply absence');
 await c.exports.decideAttendanceChangeRequest({requestId:1,action:'approve',decidedById:1});assert(profile.extraBonuses.__attendanceAbsences[raw.date]);
 vm.runInNewContext(fs.readFileSync('scripts/test-gratification.cjs','utf8')+`today='2026-10-30';assert.equal(credit([{...absent,absence:true}]).nonComputableDays,1,'explicit absence is noncomputable');`,{require,console,process});
 console.log('PASS: absence zero pay/work, original punches and metadata preserved, reversible flag, manager approval workflow, month-close projection blocked, gratification noncomputable day.');
})().catch(e=>{console.error(e);process.exitCode=1});



