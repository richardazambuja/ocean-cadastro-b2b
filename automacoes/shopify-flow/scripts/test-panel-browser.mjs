// Local real-Chrome DOM regression. All business data and API responses below
// are synthetic. This does not claim validation inside authenticated Admin.
import {createServer} from 'node:http';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {createRequire} from 'node:module';
import {resolve,extname} from 'node:path';
import assert from 'node:assert/strict';
const require=createRequire(import.meta.url),{ts}=require('ts-morph');
const root=new URL('../../../',import.meta.url).pathname.replace(/\/$/,'');
const out=root+'/automacoes/shopify-flow/reports/browser-ui';mkdirSync(out,{recursive:true});
const fixture=()=>{
 window.__uiTest={delayMs:80,failures:0,hang:false,syncDelayMs:1200,calls:0};window.__started=performance.now();
 const old=new Date(Date.now()-1200000).toISOString(),ids=[1,2,3,4].map(n=>'gid://shopify/CompanyLocation/'+n);
 const statuses=['pendente','aprovado_pendente','aprovado_liberado','reprovado'];
 const names=['Pendente','Aprovado pendente','Aprovado liberado','Reprovado'];
 const items=ids.map((id,i)=>({id,name:'Local de teste',createdAt:old,roleAssignments:{nodes:i===2?[{id:'role-assignment',role:{id:'role-1',name:'Apenas pedidos'},companyContact:{id:'contact-'+i}}]:[],pageInfo:{hasNextPage:false}},company:{id:'company-'+i,name:'Cliente de teste '+names[i],mainContact:{id:'contact-'+i},contacts:{nodes:[{id:'contact-'+i,customer:{id:'customer-'+i,displayName:'Contato sintetico'}}],pageInfo:{hasNextPage:false}},contactRoles:{nodes:[{id:'role-1',name:'Apenas pedidos'}]}}}));
 const records=[1,3].map(i=>({handle:'local-'+(i+1),fields:[{key:'local_id',value:ids[i]},{key:'status',value:statuses[i]},{key:'alterado_em',value:old}]}));
 const mirrors=items.map((l,i)=>{const state={schema:1,locationId:l.id,ready:true,operationId:null,status:statuses[i],cycleId:i===0?'cycle-1':null,enteredAt:i===0?old:null,enrolled:false,decisionVersion:[1,3].includes(i)?old:null,decisionStatus:[1,3].includes(i)?statuses[i]:null,signalPending:false};return {id:l.id,review:{type:'json',value:JSON.stringify(state),compareDigest:'digest'},ready:{type:'boolean',value:'true'},status:{type:'single_line_text_field',value:state.status},cycle:{value:state.cycleId||'none'},entered:state.enteredAt?{value:old}:null};});
 const sleep=ms=>new Promise(r=>setTimeout(r,ms));
 const answer=async(q,v)=>{
  if(/^\s*mutation/.test(q))throw Error('Synthetic UI tests forbid mutations');
  if(q.includes('OceanPanelSnapshot')){
   window.__uiTest.calls++;await sleep(window.__uiTest.delayMs);
   if(window.__uiTest.failures>0){window.__uiTest.failures--;return {http:503};}
   return {data:{companyLocations:{nodes:items,pageInfo:{hasNextPage:false}},metaobjects:{nodes:records,pageInfo:{hasNextPage:false}}}};
  }
  if(q.includes('OceanBridgeRollout')){await sleep(window.__uiTest.syncDelayMs);return {data:{shop:{myshopifyDomain:'mrdvrf-6a.myshopify.com',metafield:{value:JSON.stringify({mode:'production',cutover:old})}}}};}
  if(q.includes('OceanReadBridgeBatch'))return {data:{nodes:v.ids.map(id=>mirrors.find(l=>l.id===id))}};
  if(q.includes('query OceanLocation('))return {data:{companyLocation:items.find(l=>l.id===v.id)}};
  if(q.includes('OceanStatusLocal'))return {data:{metaobjectByHandle:records.find(r=>r.handle===v.handle.handle)||null}};
  throw Error('Unexpected synthetic query');
 };
 window.shopify={query:async(q,{variables={}}={})=>answer(q,variables),toast:{show:()=>{}}};
 const nativeFetch=window.fetch.bind(window);
 window.fetch=async(url,init)=>{
  if(!String(url).startsWith('shopify:admin/'))return nativeFetch(url,init);
  if(window.__uiTest.hang)return new Promise((_,reject)=>init.signal.addEventListener('abort',()=>reject(init.signal.reason),{once:true}));
  const {query,variables}=JSON.parse(init.body),body=await answer(query,variables);
  return {ok:!body.http,status:body.http||200,json:async()=>body};
 };
};
const html=`<!doctype html><meta charset="utf-8"><title>Ocean B2B — regressão local com dados sintéticos</title><style>body{font:15px system-ui;margin:24px;background:#f4f5f6;color:#202223}s-page,s-section,s-stack,s-heading,s-text,s-box,s-grid,s-banner{display:block}s-section{background:white;padding:16px;margin:12px 0}s-stack{margin:5px 0}s-box{border:1px solid #ccc;padding:12px;margin:8px 0}s-heading{font-weight:650}s-button{display:inline-block;padding:8px 12px;margin:4px;border:1px solid #aaa;border-radius:6px;cursor:pointer}s-button[disabled]{opacity:.5;pointer-events:none}s-banner{padding:10px;background:#fff1c9}s-banner[tone=critical]{background:#ffdfdf}s-grid{display:flex;gap:8px}s-badge{background:#ddd;padding:4px}s-text[color=subdued]{color:#666}</style><div>Teste local de interface • dados sintéticos • não é o Admin da Shopify</div><script>(${fixture.toString()})();</script><script type="module">import extension from '/extensions/app-home/src/AppHome.jsx';await extension();</script>`;
const server=createServer((req,res)=>{
 try{
  if(req.url==='/'){res.setHeader('Content-Type','text/html');res.end(html);return;}
  const path=new URL(req.url,'http://local').pathname;
  if(!path.startsWith('/extensions/app-home/src/')&&!path.startsWith('/node_modules/preact/')){res.writeHead(404);res.end();return;}
  const file=resolve(root,'.'+path);if(!file.startsWith(root+'/'))throw Error('Invalid path');
  let code=readFileSync(file,'utf8');
  if(extname(file)==='.jsx')code=ts.transpileModule(code,{fileName:file,compilerOptions:{jsx:ts.JsxEmit.ReactJSX,jsxImportSource:'preact',target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;
  code=code.replace(/from\s*(['"])preact\/jsx-runtime\1/g,"from '/node_modules/preact/jsx-runtime/dist/jsxRuntime.module.js'").replace(/from\s*(['"])preact\/hooks\1/g,"from '/node_modules/preact/hooks/dist/hooks.module.js'").replace(/from\s*(['"])preact\1/g,"from '/node_modules/preact/dist/preact.module.js'");
  res.setHeader('Content-Type','text/javascript');res.end(code);
 }catch(e){res.writeHead(500);res.end(e.message);}
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
async function connect(url){const ws=new WebSocket(url),pending=new Map();let id=0;const events=[];await new Promise((r,j)=>{ws.addEventListener('open',r,{once:true});ws.addEventListener('error',j,{once:true});});ws.addEventListener('message',event=>{const msg=JSON.parse(event.data);if(msg.id){const p=pending.get(msg.id);pending.delete(msg.id);msg.error?p.reject(Error(msg.error.message)):p.resolve(msg.result);}else events.push(msg);});return {send:(method,params={})=>new Promise((resolve,reject)=>{const serial=++id;pending.set(serial,{resolve,reject});ws.send(JSON.stringify({id:serial,method,params}));}),events,close:()=>ws.close()};}
const version=await (await fetch('http://127.0.0.1:9222/json/version')).json();const browser=await connect(version.webSocketDebuggerUrl);
const {targetId}=await browser.send('Target.createTarget',{url:'about:blank'});
const tab=await connect('ws://127.0.0.1:9222/devtools/page/'+targetId);
const evaluate=async expression=>{const result=await tab.send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(result.exceptionDetails)throw Error(result.exceptionDetails.text+': '+result.exceptionDetails.exception?.description);return result.result.value;};
const wait=async expression=>{const start=Date.now();while(Date.now()-start<16000){if(await evaluate(expression))return;await new Promise(r=>setTimeout(r,80));}throw Error('DOM condition timed out: '+expression);};
const click=async label=>{await wait(`Boolean([...document.querySelectorAll('s-button')].find(b=>b.textContent.trim()===${JSON.stringify(label)}&&!b.hasAttribute('disabled')))`);return evaluate(`(()=>{const b=[...document.querySelectorAll('s-button')].find(b=>b.textContent.trim()===${JSON.stringify(label)});b.click();return true;})()`);};
const checks=[];
try{
 await tab.send('Runtime.enable');await tab.send('Page.enable');await tab.send('Page.navigate',{url:'http://127.0.0.1:'+server.address().port+'/'});
 await wait(`document.body.textContent.includes('Cliente de teste Pendente')`);
 await evaluate('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');
 const initialMs=await evaluate('performance.now()-window.__started');
 assert.equal(await evaluate(`document.body.textContent.includes('Consultando empresas e decisoes')`),false);
 assert.equal(await evaluate(`document.body.textContent.includes('Sincronizando notificacoes em segundo plano')`),true);checks.push('initial list visible while notifications run');
 await evaluate(`window.__oldRow=[...document.querySelectorAll('s-heading')].find(e=>e.textContent==='Cliente de teste Pendente').closest('s-box');window.__uiTest.delayMs=450;window.__refreshStart=performance.now()`);
 await click('Atualizar dados');
 assert.equal(await evaluate(`window.__oldRow.isConnected&&document.body.textContent.includes('Atualizando...')`),true);
 await wait(`!document.body.textContent.includes('Atualizando...')`);
 assert.equal(await evaluate(`window.__oldRow===[...document.querySelectorAll('s-heading')].find(e=>e.textContent==='Cliente de teste Pendente').closest('s-box')`),true);checks.push('refresh keeps the same row DOM node');
 const refreshMs=await evaluate('performance.now()-window.__refreshStart');
 for(const label of ['Vencidos (1)','Aprovados — acesso pendente','Aprovados — acesso liberado','Reprovados','Pendentes']){await click(label);await new Promise(r=>setTimeout(r,30));}checks.push('all commercial tabs and overdue filter respond');
 await click('Analisar cadastro');await wait(`Boolean(document.querySelector('s-section[heading=\"Análise do cadastro\"]'))`);await click('Voltar');await wait(`document.body.textContent.includes('Cliente de teste Pendente')`);checks.push('customer details open and return');await evaluate(`window.__oldRow=[...document.querySelectorAll('s-heading')].find(e=>e.textContent==='Cliente de teste Pendente').closest('s-box')`);
 await evaluate('window.__uiTest.delayMs=30;window.__uiTest.failures=1');await click('Atualizar dados');await wait(`!document.body.textContent.includes('Atualizando...')`);assert.equal(await evaluate(`document.body.textContent.includes('nao representam o estado atual')`),false);checks.push('one simulated 503 recovers with list present');
 await evaluate('window.__uiTest.failures=3');await click('Atualizar dados');await wait(`document.body.textContent.includes('nao representam o estado atual')`);assert.equal(await evaluate('window.__oldRow.isConnected'),true);checks.push('exhausted 503 marks retained list stale and unlocks refresh');
 let shot=await tab.send('Page.captureScreenshot',{format:'png',captureBeyondViewport:true});writeFileSync(out+'/503-retained-list.png',Buffer.from(shot.data,'base64'));
 await evaluate('window.__uiTest.failures=0');await click('Atualizar dados');await wait(`!document.body.textContent.includes('nao representam o estado atual')&&!document.body.textContent.includes('Atualizando...')`);
 await evaluate('window.__uiTest.hang=true');await click('Atualizar dados');await wait(`document.body.textContent.includes('nao confirmou os dados no prazo')`);assert.equal(await evaluate(`document.body.textContent.includes('Atualizando...')`),false);checks.push('hung query times out with retained stale list and retry button');
 await evaluate('window.__uiTest.hang=false');await click('Atualizar dados');await wait(`!document.body.textContent.includes('nao representam o estado atual')&&!document.body.textContent.includes('Atualizando...')`);
 shot=await tab.send('Page.captureScreenshot',{format:'png',captureBeyondViewport:true});writeFileSync(out+'/list-after.png',Buffer.from(shot.data,'base64'));
 const exceptions=tab.events.filter(e=>e.method==='Runtime.exceptionThrown').map(e=>e.params.exceptionDetails.exception?.description||e.params.exceptionDetails.text);assert.deepEqual(exceptions,[]);
 const report={at:new Date().toISOString(),environment:'Real Chrome; local HTTP fixture; synthetic API; not authenticated Shopify Admin',initialFixtureRenderMs:Math.round(initialMs),refreshFixtureRenderMs:Math.round(refreshMs),checks,exceptions,productionBrowserValidated:false,renderCommits:tab.events.filter(e=>e.method==='Runtime.consoleAPICalled'&&e.params.args[0]?.value==='[ocean-b2b-panel]').map(e=>JSON.parse(e.params.args[1].value))};writeFileSync(out+'/result.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}finally{await browser.send('Target.closeTarget',{targetId});tab.close();browser.close();server.closeAllConnections();await new Promise(r=>server.close(r));}
