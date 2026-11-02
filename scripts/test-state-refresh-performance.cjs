const fs=require('fs'),vm=require('vm'),ts=require('typescript'),assert=require('node:assert/strict');
function load(file,imports){const ctx={exports:{},require:id=>imports[id]||require(id),URL,Intl,Date,console,process};vm.runInNewContext(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,ctx);return ctx.exports;}
const {Prisma}=require('@prisma/client');let rows=[{module:'records',count:'50',modified:'2026-10-31 09:00:00'}],sql;
const {stateRevision}=load('src/lib/state-revision.ts',{'@/lib/prisma':{prisma:{$queryRaw:async query=>{sql=query.sql;return rows.map(r=>({...r}));}}}});
(async()=>{
 const scope=[1,'ADMIN','Lince','2026-10'];const first=await stateRevision(scope,['records']);const query=sql;
 assert(query.includes('"Record"'));assert(query.includes('"AttendanceProfile"'));assert(!query.includes('"Referral"'));assert(!query.includes('SELECT *'));assert.equal(await stateRevision(scope,['records']),first);
 for(const field of ['count','modified']){const old=rows[0][field];rows[0][field]+='1';assert.notEqual(await stateRevision(scope,['records']),first);rows[0][field]=old;}
 assert.notEqual(await stateRevision([2,'MANAGER','Norte','2026-10'],['records']),first);
 let build=0,authError=null,scopes=[];
 const route=load('src/app/api/state/route.ts',{
 '@/lib/api-auth':{requireApiUser:async()=>authError?{error:authError}:{user:{id:1,role:'ADMIN',sede:'Lince',name:'Fixture',username:'fixture'}}},
 '@/lib/db-retry':{withDbRetry:f=>f()},'@/lib/domain':{isAdmin:()=>true},
 '@/lib/state-response':{STATE_MODULE_KEYS:['settings','users','records'],initialStateModules:()=>['settings','users','records'],buildStateResponse:async()=>{build++;return {currentUser:{id:1},records:Array.from({length:500},(_,id)=>({id,notes:'fixture'.repeat(40)}))};}},
 '@/lib/state-revision':{stateRevision:async(scope,modules)=>{scopes.push(scope);return JSON.stringify([scope,modules]);}}
 });
 let r=await route.GET(new Request('https://atkportal.app/api/state?module=records&month=2026-10'));const full=await r.text(),p=JSON.parse(full);assert.equal(build,1);
 r=await route.GET(new Request('https://atkportal.app/api/state?module=records&month=2026-10&since='+encodeURIComponent(p.revision)));const light=await r.text();assert.equal(JSON.parse(light).unchanged,true);assert.equal(build,1,'no row loading or recalculation on unchanged poll');
 await route.GET(new Request('https://atkportal.app/api/state?module=records&month=2026-09&since='+encodeURIComponent(p.revision)));assert.equal(build,2,'month invalidates');
 authError=new Response('{}',{status:401});r=await route.GET(new Request('https://atkportal.app/api/state?since='+encodeURIComponent(p.revision)));assert.equal(r.status,401);assert.equal(build,2);
 // Exercise the real client refresh function: skip apply on unchanged, invalidate on writes, reject stale reads.
 const app=ts.createSourceFile('app.js',fs.readFileSync('public/legacy-app.js','utf8'),99,true,1);let applied=0,version=0,answer={revision:'r1',currentUser:{id:1}},urls=[];
 const c={state:{},getSessionScopeKey:()=> 'one',stateModuleLoadKey:x=>x,scopedDataMonthForView:()=> '2026-10',STATE_MODULES_LOADING:new Set(),STATE_RESPONSE_REVISIONS:new Map(),STATE_RESPONSE_WRITE_VERSION:0,LOGOUT_SUBMITTING:false,buildStateUrl:()=>'/api/state?month=2026-10',apiFetch:async url=>{urls.push(url);return answer},hasPayloadKey:(p,k)=>Object.hasOwn(p,k),applyStatePayload:()=>applied++};vm.createContext(c);vm.runInContext(app.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text==='refreshState').getText(app),c);
 await c.refreshState(true,['records']);answer={unchanged:true,revision:'r1'};await c.refreshState(true,['records']);assert(urls[1].includes('since=r1'));assert.equal(applied,1);
 c.STATE_RESPONSE_REVISIONS.clear();await c.refreshState(true,['records']);assert(!urls.at(-1).includes('since='));
 answer={revision:'old'};c.apiFetch=async()=>{c.STATE_RESPONSE_WRITE_VERSION++;return answer};await c.refreshState(true,['records']);assert.equal(applied,1,'late response cannot undo a write');
 const summary={fullFixtureBytes:Buffer.byteLength(full),unchangedBytes:Buffer.byteLength(light),reductionPercent:+(100*(1-Buffer.byteLength(light)/Buffer.byteLength(full))).toFixed(1),fullBuildsSkipped:1,checks:['auth first','month/user scoped','updates/deletions invalidate','metadata only query','unchanged skips recalculation','write invalidation','stale response rejected'],realDataModified:0};
 fs.writeFileSync('validation/state-refresh-performance.json',JSON.stringify(summary,null,2));console.log('PASS',JSON.stringify(summary));
})();
