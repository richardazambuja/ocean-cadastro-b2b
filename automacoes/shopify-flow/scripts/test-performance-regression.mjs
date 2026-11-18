import {spawnSync} from 'node:child_process';
import {readdirSync,writeFileSync} from 'node:fs';
const root=new URL('../../../',import.meta.url),testDir=new URL('../tests/',import.meta.url);
const tests=[];
for(const file of readdirSync(testDir).filter(f=>f.endsWith('.test.mjs'))){
 const run=spawnSync(process.execPath,[new URL(file,testDir).pathname],{encoding:'utf8',cwd:root});
 const count=Number(run.stdout.match(/^# tests (\d+)/m)?.[1]||0),failed=Number(run.stdout.match(/^# fail (\d+)/m)?.[1]||0);
 tests.push({file,count,failed,passed:!run.error&&run.status===0&&count>0&&failed===0,output:run.stdout+run.stderr,error:run.error?.message});
 console.log(`${file}: ${count} tests, ${failed} failed`);
}
for(const [file,count] of [['testes-acesso.mjs',21],['testes-reprovados.mjs',24]]){
 const run=spawnSync(process.execPath,[new URL('extensions/app-home/src/'+file,root).pathname],{encoding:'utf8',cwd:root});
 tests.push({file,count,failed:run.status===0?0:1,passed:!run.error&&run.status===0,output:run.stdout+run.stderr,error:run.error?.message});console.log(`${file}: ${run.status===0?'PASS':'FAIL'}`);
}
const report={at:new Date().toISOString(),total:tests.reduce((n,t)=>n+t.count,0),passed:tests.every(t=>t.passed),tests};
writeFileSync(new URL('automacoes/shopify-flow/reports/browser-performance-regression.json',root),JSON.stringify(report,null,2));
if(!report.passed)process.exitCode=1;
