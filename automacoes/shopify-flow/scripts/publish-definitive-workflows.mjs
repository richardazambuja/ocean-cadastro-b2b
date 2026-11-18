import {spawnSync} from 'node:child_process';
import {readFileSync,writeFileSync} from 'node:fs';
function operation(file,vars,out,mutation=false){
 const r=spawnSync(process.execPath,['scripts/store-operation.mjs',file,vars,out,...(mutation?['--mutation']:[])],{encoding:'utf8',maxBuffer:30*1024*1024});if(r.status!==0)throw Error(r.stdout+r.stderr);return JSON.parse(readFileSync(out));
}
const before=operation('graphql/workflows-state.graphql','-','reports/definitive-workflows-pre-update.json').automationWorkflows.nodes;
for(const kind of ['novo','vencido','bootstrap-location','bootstrap-contact']){
 const desired=JSON.parse(readFileSync(`workflows/${kind}.variables.json`));const existing=before.find(x=>x.name===desired.name);
 if(!existing||!existing.id.includes('/01a1e9'))throw Error('Unexpected workflow target: '+kind);
 const update=`workflows/definitive-${kind}.update.json`;writeFileSync(update,JSON.stringify({id:existing.id,version:existing.version,configuration:desired.configuration}));
 const draft=operation('graphql/update-notification-workflow.graphql',update,`reports/definitive-${kind}-draft.json`,true).automationWorkflowUpdate;
 if(draft.userErrors.length||draft.automationWorkflow.validationErrors.length)throw Error(JSON.stringify(draft));
 const activation=`workflows/definitive-${kind}.activate.json`;writeFileSync(activation,JSON.stringify({id:existing.id,version:draft.automationWorkflow.version}));
 const active=operation('graphql/activate-notification-workflow.graphql',activation,`reports/definitive-${kind}-active.json`,true).automationWorkflowActivate;
 if(active.userErrors.length||active.automationWorkflow.activeVersion!==draft.automationWorkflow.version)throw Error(JSON.stringify(active));
 console.log(JSON.stringify(active.automationWorkflow));
}
