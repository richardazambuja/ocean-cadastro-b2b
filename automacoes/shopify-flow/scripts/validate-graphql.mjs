import {spawnSync} from 'node:child_process';
import {readFileSync, writeFileSync} from 'node:fs';
import {READ, SET, SIGNAL, REVIEW, READ_SIGNAL} from '../src/operations.mjs';
const tool='/home/richard-azambuja/.codex/plugins/cache/openai-curated-remote/shopify/4.1.3/skills/shopify/scripts/validate.mjs';
const records=[];
const privateApi=readFileSync('integration/reprovados-api.production.mjs','utf8');
const migration=readFileSync('integration/history-migration.mjs','utf8');
const operations=[...Object.entries({READ, SET, SIGNAL, REVIEW,READ_SIGNAL}), ['PRIVATE_WRITE',privateApi.match(/const M_SALVAR = `([\s\S]*?)`;/)[1]],['MIGRATION_READ',migration.match(/const Q=`([\s\S]*?)`;/)[1]], ['DEFINE_METAFIELD', readFileSync('graphql/create-metafield-definition.graphql','utf8')], ['DEFINE_CYCLE', readFileSync('graphql/create-cycle-definition.graphql','utf8')]];
for (const [name, code] of operations) {
  const result=spawnSync(process.execPath,[tool,'--api','admin','--version','2026-10','--code',code,'--artifact-id',`ocean-bridge-${name.toLowerCase()}`,'--revision','1','--model','gpt-6','--client-name','codex','--client-version','none'],{encoding:'utf8',env:{...process.env,OPT_OUT_INSTRUMENTATION:'true'}});
  const passed=!result.error && result.status===0 && result.stdout.includes('Overall Status:** ✅ VALID');
  records.push({name,passed,status:result.status,signal:result.signal,error:result.error?.message,details:(result.stdout||'')+(result.stderr||'')});
  console.log(`${name}: ${passed?'VALID':'FAILED'}`);
}
writeFileSync('reports/graphql-validation.json',JSON.stringify({apiVersion:'2026-10',executedMutations:0,operations:records},null,2)+'\n');
if(records.some(r=>!r.passed))process.exitCode=1;
