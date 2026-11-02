const fs=require('node:fs'),ts=require('typescript'),vm=require('node:vm'),assert=require('node:assert/strict');
const server={exports:{}};vm.createContext(server);vm.runInContext(ts.transpileModule(fs.readFileSync('src/lib/salary-history.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText,server);
const historyFor=server.exports.salaryHistoryFor;
const source=ts.createSourceFile('app.js',fs.readFileSync('public/legacy-app.js','utf8'),99,true,1);
const ctx={ATTENDANCE:{people:[]},limaTodayKey:()=> '2026-10-31',getPayrollRoleConfig:()=>({baseSalary:2500})};vm.createContext(ctx);
vm.runInContext(source.statements.filter(n=>ts.isFunctionDeclaration(n)&&['salaryProfileForMonth','getEffectiveMonthlySalary'].includes(n.name?.text)).map(n=>n.getText(source)).join('\n'),ctx);
const franco={personId:'75348462',monthlySalary:2500,extraBonuses:{__salaryHistory:historyFor('75348462',{})}};ctx.ATTENDANCE.people=[franco];
assert.equal(ctx.salaryProfileForMonth(franco,'2026-09').monthlySalary,2000);
assert.equal(ctx.salaryProfileForMonth(franco,'2026-10').monthlySalary,2500);
assert.equal(ctx.salaryProfileForMonth(franco,'2026-06').salaryHistoryUnverified,true,'earlier unknown salary remains flagged');
assert.equal(ctx.salaryProfileForMonth({personId:franco.personId,monthlySalary:0,closedSnapshot:true},'2026-09').monthlySalary,2000,'closed snapshot base uses dated history, without rewriting its paid totals');
assert.equal(ctx.getEffectiveMonthlySalary({monthlySalary:0}),0,'explicit zero is not replaced with role default');
let stored={personId:'fixture',personName:'Fixture',payrollRole:'Personal Registro',monthlySalary:1000,employmentType:'FULL_TIME',partTimeMode:null,extraBonuses:{__bankAccounts:[{bank:'BCP',number:'fixture'}]},salaryPaidMonth:'2026-09'};
const tree=ts.createSourceFile('attendance.ts',fs.readFileSync('src/lib/attendance.ts','utf8'),99,true);
const writer=tree.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text==='writeAttendanceProfile');
const c={exports:{},salaryHistoryFor:historyFor,DEFAULT_ROLE_PENALTY:{},normalizeEmploymentType:x=>x||'FULL_TIME',normalizePartTimeMode:x=>x||null,defaultBonusForProfile:()=>0,toEmploymentType:x=>x,toPartTimeMode:x=>x,todayInLima:()=> '2026-10-31',bootstrapAttendanceStore:async()=>{},readAttendanceStorePayload:async()=>({people:[stored]}),prisma:{attendanceProfile:{findUnique:async()=>stored,upsert:async({update})=>{stored=JSON.parse(JSON.stringify({...stored,...update}));return stored}}}};
vm.createContext(c);vm.runInContext(ts.transpileModule(writer.getText(tree),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText,c);
(async()=>{
 const save=(salary,month,extra={})=>c.exports.writeAttendanceProfile({personId:'fixture',payrollRole:'Personal Registro',monthlySalary:salary,salaryEffectiveMonth:month,employmentType:'FULL_TIME',partTimeMode:null,actorId:1,extraBonuses:extra});
 await save(1200,'2026-10',{__attendanceAbsences:{'2026-10-31':true},__salaryHistory:[{effectiveMonth:'2026-01',monthlySalary:9999}]});
 assert.equal(stored.monthlySalary,1200);assert(!stored.extraBonuses.__attendanceAbsences['2026-10-31'],'profile editor cannot bypass absence approval');assert.equal(stored.extraBonuses.__salaryHistory.length,2);assert.equal(stored.extraBonuses.__salaryHistory[0].monthlySalary,1000,'previous amount retained');
 assert.equal(stored.extraBonuses.__salaryHistory[0].source,'prior-value-undated');assert.equal(stored.salaryPaidMonth,'2026-09');assert.equal(stored.extraBonuses.__bankAccounts[0].number,'fixture','unrelated metadata retained');
 await save(900,'2026-09');assert.equal(stored.monthlySalary,1200,'backdating never replaces latest salary');
 await save(1300,'2026-10');assert.equal(stored.monthlySalary,1300);assert.equal(stored.extraBonuses.__salaryHistory.filter(e=>e.effectiveMonth==='2026-10').length,1);
 await assert.rejects(()=>save(1400,'2026-11'),/vigencia/);await assert.rejects(()=>save(1400,'2026-99'),/vigencia/);
 const user={...stored,extraBonuses:stored.extraBonuses};ctx.ATTENDANCE.people=[user];assert.equal(ctx.salaryProfileForMonth(user,'2026-09').monthlySalary,900);assert.equal(ctx.salaryProfileForMonth(user,'2026-10').monthlySalary,1300);
 // Reuse the complete gratification regression, then verify that a December
 // raise cannot change the November reference salary for Christmas.
 vm.runInNewContext(fs.readFileSync('scripts/test-gratification.cjs','utf8')+`
 person.extraBonuses={__salaryHistory:[{effectiveMonth:'2026-06',monthlySalary:1500},{effectiveMonth:'2026-11',monthlySalary:2000},{effectiveMonth:'2026-12',monthlySalary:2500}]};person.monthlySalary=2500;
 c.ATTENDANCE.people=[person];row=c.buildGratificationRows([person],'2026-12')[0];assert.equal(row.baseSalary,2000,'November salary governs Christmas, not December raise');
 `,{require,console,process},{filename:'salary-history-gratification.cjs'});
 console.log('PASS: confirmed Franco periods, unknown history warnings, protected persistent history, backdating, future/month validation, metadata retention, and gratification reference salary.');
})().catch(e=>{console.error(e);process.exitCode=1});

