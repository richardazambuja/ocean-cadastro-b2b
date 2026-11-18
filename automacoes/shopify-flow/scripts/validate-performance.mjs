import {spawnSync} from 'node:child_process';
import {readFileSync,writeFileSync} from 'node:fs';
import {READ,READ_MANY,SET,SIGNAL,REVIEW,READ_SIGNAL} from '../../../extensions/app-home/src/flow-bridge/operations.mjs';
import {PANEL_QUERY} from '../../../extensions/app-home/src/panel-data.mjs';
const tool='/home/richard-azambuja/.codex/plugins/cache/openai-curated-remote/shopify/4.1.3/skills/shopify/scripts/validate.mjs';
const root=new URL('../../../',import.meta.url);
const records=[];
for(const [name,code] of Object.entries({READ,READ_MANY,SET,SIGNAL,REVIEW,READ_SIGNAL,PANEL_QUERY})){
 const result=spawnSync(process.execPath,[tool,'--api','admin','--version','2026-10','--code',code,'--artifact-id',`ocean-performance-${name.toLowerCase()}`,'--revision','1','--model','gpt-6','--client-name','codex','--client-version','none'],{encoding:'utf8',env:{...process.env,OPT_OUT_INSTRUMENTATION:'true'}});
 const passed=!result.error&&result.status===0&&result.stdout.includes('Overall Status:** ✅ VALID');
 records.push({name,passed,details:result.stdout+result.stderr});console.log(`${name}: ${passed?'VALID':'FAILED'}`);
}
const ui=spawnSync(process.execPath,[tool,'--api','polaris-admin-extensions','--version','2026-10','--target','admin.app.home.render','--file',new URL('extensions/app-home/src/AppHome.jsx',root).pathname,'--language','jsx','--artifact-id','ocean-performance-panel','--revision','3','--model','gpt-6','--client-name','codex','--client-version','none'],{encoding:'utf8',env:{...process.env,OPT_OUT_INSTRUMENTATION:'true'}});
records.push({name:'APP_HOME',passed:!ui.error&&ui.status===0&&ui.stdout.includes('Overall Status:** ✅ VALID'),details:ui.stdout+ui.stderr});console.log(`APP_HOME: ${records.at(-1).passed?'VALID':'FAILED'}`);
writeFileSync(new URL('automacoes/shopify-flow/reports/browser-performance-toolkit-validation.json',root),JSON.stringify({apiVersion:'2026-10',records},null,2));
if(records.some(r=>!r.passed))process.exitCode=1;
