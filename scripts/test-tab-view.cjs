const fs=require('node:fs'),vm=require('node:vm'),ts=require('typescript'),assert=require('node:assert/strict');
const tree=ts.createSourceFile('app.js',fs.readFileSync('public/legacy-app.js','utf8'),ts.ScriptTarget.Latest,true);
const names=['tabSessionToken','clearTabSession','rememberTabView','restoreTabView','boot'];
const memory=new Map([['token','session']]);
const ctx={TAB_SESSION_KEY:'token',TAB_VIEW_KEY:'view',BOOTING:true,state:{currentUser:{id:1},view:'asistencia'},sessionStorage:{getItem:k=>memory.get(k),setItem:(k,v)=>memory.set(k,v),removeItem:k=>memory.delete(k)},sidebarSectionsForCurrentUser:()=>[{items:[{id:'dashboard'},{id:'asistencia'},{id:'referidos'}]}],viewAllowedForCurrentUser:()=>true,CORE_STATE_MODULES:[],refreshState:async()=>{ctx.state.view='dashboard'},render:()=>{},resetSessionViewState:()=>{}};
vm.createContext(ctx);vm.runInContext(tree.statements.filter(n=>ts.isFunctionDeclaration(n)&&names.includes(n.name?.text)).map(n=>n.getText(tree)).join('\n'),ctx);
(async()=>{
 ctx.rememberTabView();await ctx.boot();assert.equal(ctx.state.view,'asistencia','F5 restores attendance after authentication');
 ctx.state.view='referidos';ctx.rememberTabView();await ctx.boot();assert.equal(ctx.state.view,'referidos');
 ctx.state.currentUser={id:2};ctx.state.view='dashboard';ctx.restoreTabView();assert.equal(ctx.state.view,'dashboard','different account never inherits view');
 ctx.state.currentUser={id:1,forcePasswordReset:true};ctx.state.view='force-password';ctx.restoreTabView();assert.equal(ctx.state.view,'force-password');
 ctx.state.currentUser={id:1};ctx.state.view='dashboard';memory.set('view',JSON.stringify({userId:'1',view:'admin'}));ctx.restoreTabView();assert.equal(ctx.state.view,'dashboard','unavailable role view rejected');
 ctx.clearTabSession();assert(!memory.has('view'));assert(!memory.has('token'));
 ctx.state.view='login';ctx.rememberTabView();assert(!memory.has('view'),'logout remains login');
 console.log('PASS: reload restores last section, per-user/tab scope, role whitelist, password reset and logout protection.');
})().catch(e=>{console.error(e);process.exitCode=1});
