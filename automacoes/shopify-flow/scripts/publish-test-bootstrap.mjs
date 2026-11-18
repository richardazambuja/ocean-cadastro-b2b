import {spawnSync} from 'node:child_process';
import {readFileSync,writeFileSync} from 'node:fs';
function operation(file,vars,out,mutation=false){
 const result=spawnSync(process.execPath,['scripts/store-operation.mjs',file,vars,out,...(mutation?['--mutation']:[])],{encoding:'utf8'});
 if(result.status!==0)throw Error(result.stdout+result.stderr);
 return JSON.parse(readFileSync(out,'utf8'));
}
const current=operation('graphql/workflows-state.graphql','-','reports/bootstrap-before-company-test.json').automationWorkflows.nodes;
for(const kind of ['location','contact']){
 const prefix='bootstrap-'+kind;
 const desired=JSON.parse(readFileSync(`workflows/${prefix}.variables.json`));
 const found=current.find(x=>x.name===desired.name);
 if(!found||!found.id.startsWith('gid://shopify/AutomationWorkflow/01a1e9e'))throw Error('Unexpected target');
 const variables=`workflows/${prefix}.update.json`;
 writeFileSync(variables,JSON.stringify({id:found.id,version:found.version,configuration:desired.configuration}));
 const draft=operation('graphql/update-notification-workflow.graphql',variables,`reports/workflow-${prefix}-company-test-draft.json`,true).automationWorkflowUpdate;
 if(draft.userErrors.length||draft.automationWorkflow.validationErrors.length)throw Error(JSON.stringify(draft));
 const activation=`workflows/${prefix}.activate.json`;
 writeFileSync(activation,JSON.stringify({id:found.id,version:draft.automationWorkflow.version}));
 const active=operation('graphql/activate-notification-workflow.graphql',activation,`reports/workflow-${prefix}-company-test-active.json`,true).automationWorkflowActivate;
 if(active.userErrors.length||active.automationWorkflow.activeVersion!==draft.automationWorkflow.version)throw Error(JSON.stringify(active));
 console.log(JSON.stringify(active.automationWorkflow));
}
