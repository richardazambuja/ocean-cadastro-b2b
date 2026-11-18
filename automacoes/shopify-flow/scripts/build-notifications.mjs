import {mkdirSync,writeFileSync,readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
import {selectBuyer, classifyLocation} from '../../../extensions/app-home/src/regras.mjs';

mkdirSync('workflows',{recursive:true});
const eventScript=`export default function main(input) {
 const fields=input.metaobject?.localId ? {local_id:input.metaobject.localId,cycle_id:input.metaobject.cycleId,entered_at:input.metaobject.enteredAt} : Object.fromEntries((input.metaobject?.system?.fields||[]).map(f=>[f.key,f.value]));
 let config;try{config=JSON.parse(input.shop?.oceanRollout?.value||'{}');}catch{return {allowed:false,locationId:'',numericId:'',cycleId:'',enteredAt:'',requestId:'',runUrl:'',clock:'',debug:'invalid-config'};}
 const id=fields.local_id||'';
 const allowed=/^gid:\\/\\/shopify\\/CompanyLocation\\/\\d+$/.test(id) && /^[a-zA-Z0-9-]{1,80}$/.test(fields.cycle_id||'') && Number.isFinite(Date.parse(fields.entered_at)) && (['test','preparing'].includes(config.mode) && config.testLocationIds?.includes(id) || config.mode==='production' && config.productionApproved===true && Date.parse(fields.entered_at)>=Date.parse(config.cutover));
 return {allowed:Boolean(allowed),locationId:id,numericId:id.split('/').pop(),cycleId:fields.cycle_id||'',enteredAt:fields.entered_at||'',requestId:(input.getWorkflowRunData?.id||'').split('/').pop().replace(/[^a-zA-Z0-9-]/g,''),runUrl:input.getWorkflowRunData?.url||'',clock:input.getWorkflowRunData?.startedAt||'',debug:JSON.stringify({fields,allowed,runId:input.getWorkflowRunData?.id,configMode:config.mode})};
}`;
const eventOutput='type Output { allowed:Boolean! locationId:String! numericId:String! cycleId:String! enteredAt:String! requestId:String! runUrl:String! clock:String! debug:String! }';
const liveFields=`id name createdAt taxSettings { taxRegistrationId } company { id name oceanCnpj { value } mainContact { id } contacts { id customer { id } } } roleAssignments { id } metafields { namespace key value compareDigest updatedAt } oceanReview { value } oceanNotifications { value } oceanReady { value } oceanStatus { value } oceanCycle { value } oceanSince { value }`;
function guardScript(kind,verify=false){return `${selectBuyer.toString()}\n${classifyLocation.toString()}\nexport default function main(input) {
 const result={eligible:false,claimInputs:'{}',ackInputs:'{}',companyName:'',cnpj:'',enteredAt:'',locationId:'',cycleId:'',debug:'initial'};
 const ev=input.runCode;const rows=input.${verify?'getCompanyLocationData1':'getCompanyLocationData'}||[];
 const matches=rows.filter(x=>x.id===ev.locationId);if(matches.length!==1||!ev.requestId)return result;
 const loc=matches[0];result.debug=JSON.stringify({phase:'row',keys:Object.keys(loc),event:ev,rawFields:(loc.metafields||[]).map(x=>({namespace:x.namespace,key:x.key,hasDigest:Boolean(x.compareDigest)}))});for(const f of loc.metafields||[]){if(f.namespace==='ocean_b2b'&&f.key==='review')loc.oceanReview=f;if(f.namespace==='ocean_b2b'&&f.key==='notifications')loc.oceanNotifications=f;}let state,ledger;
 try{state=JSON.parse(loc.oceanReview?.value||'null');ledger=loc.oceanNotifications?JSON.parse(loc.oceanNotifications.value):null;}catch{return result;}
 result.debug=JSON.stringify({phase:'parsed',state,event:ev,reviewDigest:Boolean(loc.oceanReview?.compareDigest),ready:loc.oceanReady?.value,status:loc.oceanStatus?.value,cycle:loc.oceanCycle?.value,since:loc.oceanSince?.value});
 if(!state||state.schema!==1||state.locationId!==ev.locationId||!state.ready||!state.enrolled||state.operationId||state.status!=='pendente'||state.cycleId!==ev.cycleId||Date.parse(state.enteredAt)!==Date.parse(ev.enteredAt))return result;
 if((loc.oceanReady?.value!==true&&loc.oceanReady?.value!=='true')||loc.oceanStatus?.value!=='pendente'||loc.oceanCycle?.value!==ev.cycleId||Date.parse(loc.oceanSince?.value)!==Date.parse(ev.enteredAt))return result;
 const live={...loc,roleAssignments:{nodes:loc.roleAssignments||[],pageInfo:{hasNextPage:false}},company:{...loc.company,contacts:{nodes:loc.company?.contacts||[],pageInfo:{hasNextPage:(loc.company?.contacts||[]).length>=50}}}};
 if(classifyLocation(live)!=='pendente'||!loc.oceanReview?.compareDigest)return result;
 if(ledger&&ledger.schema!==1)return result;
 if(ledger?.cycleId!==ev.cycleId)ledger={schema:1,cycleId:ev.cycleId};
 const kind='${kind}';
 ${verify?`if(ledger[kind]?.state!=='claimed'||ledger[kind]?.requestId!==ev.requestId)return result;`:`if(ledger[kind])return result;`}
 ${kind==='vencido'?`if(ledger.novo?.state!=='sent'||!Number.isFinite(Date.parse(ev.clock))||Date.parse(ev.clock)+600000<Date.parse(ev.enteredAt)+600000)return result;`:''}
 const base={ownerId:loc.id,namespace:'ocean_b2b',type:'json'};
 const review={...base,key:'review',value:loc.oceanReview.value,compareDigest:loc.oceanReview.compareDigest};
 const claimed={...ledger,[kind]:{state:'claimed',requestId:ev.requestId,runUrl:ev.runUrl}};
 const confirmed={...ledger,[kind]:{...ledger[kind],state:'sent',requestId:ev.requestId,runUrl:ev.runUrl}};
 result.claimInputs=JSON.stringify({metafields:[review,{...base,key:'notifications',value:JSON.stringify(claimed),compareDigest:loc.oceanNotifications?.compareDigest||null}]});
 result.ackInputs=JSON.stringify({metafields:[review,{...base,key:'notifications',value:JSON.stringify(confirmed),compareDigest:loc.oceanNotifications?.compareDigest||null}]});
 return {...result,eligible:true,companyName:loc.company?.name||loc.name||'',cnpj:loc.company?.oceanCnpj?.value||loc.taxSettings?.taxRegistrationId||'Nao informado',enteredAt:ev.enteredAt,locationId:loc.id,cycleId:ev.cycleId};
}`;}
const guardOutput='type Output { eligible:Boolean! claimInputs:String! ackInputs:String! companyName:String! cnpj:String! enteredAt:String! locationId:String! cycleId:String! debug:String! }';
const task=(id,taskId,taskVersion,type,values={})=>({step_id:id,task_id:taskId,task_version:taskVersion,task_type:type,config_field_values:Object.entries(values).map(([config_field_id,value])=>({config_field_id,value}))});
const patches=[['Shop','oceanRollout','rollout'],['CompanyLocation','oceanReview','review'],['CompanyLocation','oceanNotifications','notifications'],['CompanyLocation','oceanReady','ready'],['CompanyLocation','oceanStatus','status'],['CompanyLocation','oceanCycle','cycle_id'],['CompanyLocation','oceanSince','pending_since']].map(([patched_type,handle,key])=>({field:'metafield',arguments:{namespace:'ocean_b2b',key},handle,patched_type}));
for(const kind of ['novo','vencido']){
 const steps=[task('cycle_created','shopify::admin::metaobject_created','0.1','TRIGGER',{type:'ocean_b2b_pending_cycle'}),task('run_identity','shopify::flow::get_workflow_run_data','0.1','ACTION'),task('check_rollout','shopify::flow::run_code','0.1','ACTION',{input:'query { metaobject { localId cycleId enteredAt } shop { oceanRollout { value } } getWorkflowRunData { id url startedAt } }',script:eventScript,output_schema:eventOutput}),task('allowed','shopify::flow::condition','0.1','CONDITION',{condition:'(runCode.allowed == true)'})];
 if(kind==='vencido')steps.splice(1,0,task('wait_ten_minutes','shopify::flow::wait','0.1','WAIT',{wait_duration:JSON.stringify({amount:'10',unit:'minutes'})}));
 steps.push(task('fresh_location','shopify::flow::fetch::company_locations','v1','ACTION',{sort_by:JSON.stringify({sortKey:'ID',order:'ASCENDING'}),max_root_records:'2',query:'ids:{{runCode.numericId}}'}),task('reserve_once','shopify::flow::run_code','0.1','ACTION',{input:`query { runCode { locationId cycleId enteredAt requestId runUrl clock } getCompanyLocationData { ${liveFields} } }`,script:guardScript(kind),output_schema:guardOutput}),task('eligible','shopify::flow::condition','0.1','CONDITION',{condition:'(runCode1.eligible == true)'}),task('claim_notification','shopify::admin::admin_api_operation','0.1','ACTION',{api_call:JSON.stringify({name:'metafieldsSet',blob:'{{runCode1.claimInputs}}'})}),task('revalidate_location','shopify::flow::fetch::company_locations','v1','ACTION',{sort_by:JSON.stringify({sortKey:'ID',order:'ASCENDING'}),max_root_records:'2',query:'ids:{{runCode.numericId}}'}),task('verify_claim','shopify::flow::run_code','0.1','ACTION',{input:`query { runCode { locationId cycleId enteredAt requestId runUrl clock } getCompanyLocationData1 { ${liveFields} } }`,script:guardScript(kind,true),output_schema:guardOutput}),task('still_pending','shopify::flow::condition','0.1','CONDITION',{condition:'(runCode2.eligible == true)'}),task('internal_email','shopify::flow::send_email','2.0','ACTION',{address:'cadastros@oceanjoiasbr.com',subject:kind==='novo'?'OCEAN B2B | NOVO CADASTRO PENDENTE | {{runCode2.companyName}}':'OCEAN B2B | CADASTRO VENCIDO | {{runCode2.companyName}}',message:'Empresa: {{runCode2.companyName}}\nCNPJ: {{runCode2.cnpj}}\nEntrada em Pendentes (UTC): {{runCode2.enteredAt}}\nLocal: {{runCode2.locationId}}\nCiclo de analise: {{runCode2.cycleId}}\n\nAguardando aprovacao comercial no aplicativo cadastro-b2b.\nExecucao: {{getWorkflowRunData.url}}'}),task('confirm_notification','shopify::admin::admin_api_operation','0.1','ACTION',{api_call:JSON.stringify({name:'metafieldsSet',blob:'{{runCode2.ackInputs}}'})}));
 const debugStep=(id,key,value)=>task(id,'shopify::admin::admin_api_operation','0.1','ACTION',{api_call:JSON.stringify({name:'metafieldsSet',blob:'{"metafields":[{"ownerId":"gid://shopify/CompanyLocation/8622571620","namespace":"ocean_b2b","key":"'+key+'","type":"single_line_text_field","value":'+value+'}]}'})});
 if(process.env.OCEAN_FLOW_DIAGNOSTICS==='true') {
   steps.splice(1,0,debugStep('debug_trigger','debug_'+kind+'_trigger',JSON.stringify('triggered')));
   let n=steps.findIndex(s=>s.step_id==='check_rollout');steps.splice(n+1,0,debugStep('debug_event','debug_'+kind+'_event','{{runCode.debug | json}}'));
   n=steps.findIndex(s=>s.step_id==='reserve_once');steps.splice(n+1,0,debugStep('debug_guard','debug_'+kind+'_guard','{{runCode1.debug | json}}'));
 }
 const links=[];for(let i=0;i<steps.length-1;i++)links.push({from_step_id:steps[i].step_id,from_port_id:steps[i].task_type==='CONDITION'?'true':'output',to_step_id:steps[i+1].step_id,to_port_id:'input'});
 const config={__metadata:{version:0.1},root:{steps,links,patched_fields:[...patches,{field:'metafield',arguments:{namespace:'custom',key:'cnpj'},handle:'oceanCnpj',patched_type:'Company'}]}};
 assert.equal(steps.filter(s=>s.task_type==='TRIGGER').length,1);assert.ok(steps.every(s=>s.config_field_values.every(v=>typeof v.value==='string')));
 writeFileSync(`workflows/${kind}.variables.json`,JSON.stringify({name:kind==='novo'?'OCEAN — NOVO CADASTRO B2B':'OCEAN — CADASTRO VENCIDO',configuration:config,note:'Implantacao Ocean: somente registros autorizados por ocean_b2b.rollout; criado desativado. Reserva CAS e revalidacao antes do email.'},null,2));
 writeFileSync(`workflows/${kind}-guard.mjs`,guardScript(kind));
}
writeFileSync('workflows/event-guard.mjs',eventScript);
console.log('Built 2 native workflows; test scope comes from shop ocean_b2b.rollout. Not activated.');
