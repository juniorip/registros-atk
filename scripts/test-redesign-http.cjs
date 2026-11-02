const assert=require('node:assert/strict'),fs=require('node:fs');
const base='http://127.0.0.1:3100';
async function login(username){const r=await fetch(base+'/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username,password:'ATK-local-2026'})});assert.equal(r.status,200);const data=await r.json();return {cookie:r.headers.getSetCookie().map(v=>v.split(';')[0]).join('; '),Authorization:'Bearer '+data.sessionToken,'Content-Type':'application/json'};}
(async()=>{
 const admin=await login('vista.local'),paths=['/api/state?module=records&month=2026-10','/api/state?module=referrals&month=2026-10','/api/state?module=safetypayCodes&month=2026-10','/api/attendance?month=2026-10','/api/safetypay/summary?month=2026-10'];
 await Promise.all(paths.map(async path=>{const r=await fetch(base+path,{headers:admin});assert.equal(r.status,200,path);await r.json();}));
 const cookieOnly=await fetch(base+'/api/state?module=records',{headers:{cookie:admin.cookie}});assert.equal(cookieOnly.status,401);
 const manager=await login('vista.jefe'),decision=await fetch(base+'/api/referrals/1/decision',{method:'POST',headers:manager,body:JSON.stringify({decision:'APPROVE'})});assert.equal(decision.status,403);
 const production=await fetch('https://registros-atk.vercel.app/');assert.equal(production.status,503,'public maintenance must remain active');
 fs.writeFileSync('validation/redesign-http.json',JSON.stringify({testedAt:new Date().toISOString(),localOnly:true,concurrentReads:paths.length,managerApprovalDenied:true,cookieAloneDenied:true,publicMaintenanceStatus:production.status},null,2));
 console.log('PASS: five concurrent local API reads, role restriction, tab authentication and public maintenance. No records changed.');
})().catch(error=>{console.error(error.message);process.exitCode=1;});
