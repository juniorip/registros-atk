const fs=require('node:fs'),vm=require('node:vm'),ts=require('typescript'),assert=require('node:assert/strict');
const source=JSON.parse(fs.readFileSync('src/data/payroll-carry-20260930.json','utf8'));
assert.equal(source.people.length,21);assert.equal(source.people.filter(p=>p.punches.length>1).length,19);
const tree=ts.createSourceFile('attendance.ts',fs.readFileSync('src/lib/attendance.ts','utf8'),ts.ScriptTarget.Latest,true);
const fn=tree.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text==='readAttendanceData');
const store={schedule:{},people:source.people.map(p=>({personId:p.personId,days:[{date:source.date,entryTime:p.punches[0],exitTime:null}]})),profiles:[],availableDates:[source.date]};
const before=JSON.stringify(store);
const ctx={exports:{},Date,Map,Object,septemberPayrollCarry:source,EMPTY_ATTENDANCE:{schedule:{},summary:{}},todayInLima:()=> '2026-10-31',readAttendanceStorePayload:async()=>store,readAttendanceOverrides:async()=>({}),readAttendanceProfiles:async()=>({}),readWorkCalendar:async()=>[],resolveWorkCalendar:()=>null,rebuildPayload:p=>structuredClone(p),recomputeDay:d=>d};
vm.createContext(ctx);vm.runInContext(ts.transpileModule(fn.getText(tree),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText,ctx);
// Exercise the real month-closing branch: normal reads retain the historical
// 18:00 projection, while only the supplied supplement preserves real exits.
const recompute=tree.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text==='recomputeDay');
Object.assign(ctx,{normalizeTime:x=>x||null,normalizeTimeToMinute:x=>x?.slice(0,5)||null,resolvePunchTimes:d=>({entryTime:d.entryTime,exitTime:d.exitTime}),getEffectiveSchedule:()=>({entry:'09:00:00',exit:'18:00:00'}),minutesFromTime:x=>x?Number(x.slice(0,2))*60+Number(x.slice(3,5)):null,shouldAutoCompleteHybridDay:()=>false,isMonthClosingWorkday:()=>true,formatMinutes:x=>x+' min'});
vm.runInContext(ts.transpileModule(recompute.getText(tree),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText,ctx);
const fixture={date:source.date,entryTime:'08:32:00',exitTime:'18:02:00'};
assert.equal(ctx.recomputeDay(fixture,{}).exitTime,'18:00:00');
assert.equal(ctx.recomputeDay(fixture,{},null,null,null,true).exitTime,'18:02:00');
assert.equal(ctx.recomputeDay(fixture,{},null,null,null,true).overtimeMinutes,2);
ctx.getEffectiveSchedule=()=>({entry:'09:30:00',exit:'18:30:00'});
assert.equal(ctx.recomputeDay({...fixture,date:'2026-10-31',exitTime:null},{}).exitTime,'18:30:00','closing projection uses configured shift');
assert.equal(ctx.recomputeDay({...fixture,date:'2026-10-31',exitTime:'19:00:00'},{}).exitTime,'19:00:00','real exit preserved for next payroll overtime');
ctx.getEffectiveSchedule=()=>({entry:'09:00:00',exit:'18:00:00'});
const payroll=fs.readFileSync('scripts/test-payroll-month-end.cjs','utf8').replace("console.log('PASS:","console.log('PASS:");
vm.runInNewContext(payroll+`
const supplement={date:'2026-09-30',entryTime:'08:32:00',exitTime:'18:02:00',entryStatus:'A tiempo',exitStatus:'Salida extendida'};
const sp={...person,payrollCarryDays:[supplement]};
const result=context.previousMonthOvertimeForPerson(sp,'2026-10');assert.equal(result.minutes,2);assert(result.amount>0);
assert.equal(context.previousMonthOvertimeForPerson(sp,'2026-11').minutes,0,'September never carried twice');
assert.equal(context.previousMonthOvertimeForPerson({...person,payrollCarryDays:[{...supplement,exitTime:null}]},'2026-10').minutes,0);
assert.equal(context.previousMonthOvertimeForPerson({...person,days:[supplement]},'2026-10').minutes,0,'only explicit supplement eligible');
assert.equal(context.computeAttendancePayment(supplement,person,26).overtimePay,result.amount,'September calculation is not rewritten');
`,{require,console,process},{filename:'september-payroll-regression.cjs'});
(async()=>{
  const october=await ctx.exports.readAttendanceData(false,'2026-10');
  assert.equal(october.people.filter(p=>p.payrollCarryDays?.length).length,19);
  assert.equal(october.people.find(p=>p.personId==='45862986').payrollCarryDays[0].exitTime,'18:02:00');
  assert(!october.people.find(p=>p.personId==='60698987').payrollCarryDays,'Danna missing exit');
  assert(!october.people.find(p=>p.personId==='72221020').payrollCarryDays,'Matias missing exit');
  const future=await ctx.exports.readAttendanceData(false,'2026-11');
  assert.equal(future.people.filter(p=>p.payrollCarryDays?.length).length,19,'October history retains supplement in future payroll views');
  const september=await ctx.exports.readAttendanceData(false,'2026-09');
  assert(!september.people.some(p=>p.payrollCarryDays),'closed source month unchanged');
  assert.equal(JSON.stringify(store),before,'no attendance store mutation');
  console.log('PASS: supplied September Excel context, 19 complete records, missing exits excluded, October-only supplement, source history preserved.');
})().catch(e=>{console.error(e);process.exitCode=1});
