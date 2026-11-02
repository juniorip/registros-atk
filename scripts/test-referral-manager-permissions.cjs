const fs=require('node:fs'),ts=require('typescript'),vm=require('node:vm'),assert=require('node:assert/strict');
function extract(file,name){const tree=ts.createSourceFile(file,fs.readFileSync(file,'utf8'),ts.ScriptTarget.Latest,true);return ts.transpileModule(tree.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text===name).getText(tree).replace(/^export /,''),{compilerOptions:{target:ts.ScriptTarget.ES2020}}).outputText;}
const ctx={state:{},openMonth:true,isAdmin:u=>(u||ctx.state.currentUser).role==='ADMIN',isManager:u=>(u||ctx.state.currentUser).role==='MANAGER',canPreviewAllSedesAsManager:u=>(u||ctx.state.currentUser).username==='jefe.temporal',isPaymentsSupervisor:u=>(u||ctx.state.currentUser).username==='matias',isPaymentsTeamMember:u=>u?.username==='franco',normalizeSede:s=>s,ownedEntrySede:r=>r.historicalSede||r.user.sede,getItemSede:r=>r.historicalSede||r.user.sede,getItemOwner:r=>r.user,userSede:u=>u.sede,canEditMonth:()=>ctx.openMonth,monthKeyFromDate:d=>d?.slice(0,7)};
vm.createContext(ctx);vm.runInContext(extract('src/lib/domain.ts','canValidateReferral')+extract('public/legacy-app.js','canValidateReferralLocal'),ctx);
const pending={createdAt:'2026-10-31',user:{username:'colaborador',sede:'Norte'}};
function check(user,row,expected,label){ctx.state.currentUser=user;assert.equal(ctx.canValidateReferral(user,row),expected,'server: '+label);assert.equal(ctx.canValidateReferralLocal(row),expected,'client: '+label);}
const manager={role:'MANAGER',sede:'Norte',username:'jefe.norte'};
check(manager,pending,true,'own branch');check(manager,{...pending,user:{username:'colaborador',sede:'Sur'}},false,'other branch');
check(manager,{...pending,historicalSede:'Sur'},false,'historical branch enforced');
check({...manager,role:'EMPLOYEE'},pending,false,'employee');check({...manager,username:'jefe.temporal'},pending,false,'preview account');
check({...manager,role:'ADMIN',sede:'Sur'},pending,true,'admin all branches');
check(manager,{...pending,validatedAt:'2026-10-31'},false,'already approved');check(manager,{...pending,rejectedAt:'2026-10-31'},false,'already rejected');
check({...manager,sede:'Lince'},{...pending,user:{username:'franco',sede:'Lince'}},false,'payments separation');
check({...manager,username:'matias'},{...pending,user:{username:'franco',sede:'Lince'}},true,'payments supervisor existing scope');
ctx.state.currentUser=manager;ctx.openMonth=false;assert.equal(ctx.canValidateReferralLocal(pending),false,'closed month hidden');
console.log('PASS: manager own branch, other/historical branch denied, employees/preview denied, admin retained, finalized rows denied, closed-month UI and payments scopes preserved.');
