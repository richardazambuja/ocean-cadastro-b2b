import {readFileSync, writeFileSync, mkdirSync, copyFileSync, readdirSync} from 'node:fs';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';

const project = resolve('../..');
const source = resolve(project, 'extensions/app-home/src');
const target = resolve('validation/app-home/src');
mkdirSync(target, {recursive: true});
const hashes = {};
for (const name of readdirSync(source).filter(n => n.endsWith('.mjs') || n === 'AppHome.jsx')) {
  const content = readFileSync(resolve(source, name));
  hashes[name] = createHash('sha256').update(content).digest('hex');
  writeFileSync(resolve(target, name), content);
}
let panel = readFileSync(resolve(source, 'AppHome.jsx'), 'utf8');
panel = panel.replace("import {render} from 'preact';", "import {render} from 'preact';\nimport {ponteFlow} from './flow-bridge-app.mjs';");
const replacements = [
  ["const outcome = await approveLocation(selected.id,{\n        getLocation:fetchLocation,readDecision:lerReviewStatus,saveDecision:salvarReviewStatus\n      });", "const outcome = await ponteFlow.run(selected.id,()=>approveLocation(selected.id,{\n        getLocation:fetchLocation,readDecision:lerReviewStatus,saveDecision:salvarReviewStatus\n      }));"],
  ["const outcome=await releaseAccess(selected.id,{\n        getLocation:fetchLocation,readDecision:lerReviewStatus,assignRole:assignOrderRole\n      });", "const outcome=await ponteFlow.run(selected.id,()=>releaseAccess(selected.id,{\n        getLocation:fetchLocation,readDecision:lerReviewStatus,assignRole:assignOrderRole\n      }));"],
  ["const outcome=await lockAccess(selected.id,{\n        getLocation:fetchLocation,readDecision:lerReviewStatus,\n        saveDecision:salvarReviewStatus,revokeRole:revokeOrderRole\n      });", "const outcome=await ponteFlow.run(selected.id,()=>lockAccess(selected.id,{\n        getLocation:fetchLocation,readDecision:lerReviewStatus,\n        saveDecision:salvarReviewStatus,revokeRole:revokeOrderRole\n      }));"],
  ["const [actual,decisaoAtual] = await Promise.all([fetchLocation(selected.id),lerReviewStatus(selected.id)]);\n      if (!['pendente','incompleto'].includes(statusDoPainel(actual,{[selected.id]:decisaoAtual}))) throw new Error('Situacao modificada por outro vendedor. Atualize os dados.');\n      if (classifyLocation(actual)==='erro') throw new Error('Os dados do local estao incompletos para verificar as permissoes.');\n      await salvarReviewStatus(selected.id,'reprovado');", "const actual = await ponteFlow.run(selected.id,async()=>{\n        const [actual,decisaoAtual] = await Promise.all([fetchLocation(selected.id),lerReviewStatus(selected.id)]);\n        if (!['pendente','incompleto'].includes(statusDoPainel(actual,{[selected.id]:decisaoAtual}))) throw new Error('Situacao modificada por outro vendedor. Atualize os dados.');\n        if (classifyLocation(actual)==='erro') throw new Error('Os dados do local estao incompletos para verificar as permissoes.');\n        await salvarReviewStatus(selected.id,'reprovado');\n        return actual;\n      });"],
  ["const [actual,decisaoAtual] = await Promise.all([fetchLocation(selected.id),lerReviewStatus(selected.id)]);\n      if (statusDoPainel(actual,{[selected.id]:decisaoAtual})!=='reprovado') throw new Error('Situacao modificada por outro vendedor. Atualize os dados.');\n      await salvarReviewStatus(selected.id,'reaberto');", "const actual = await ponteFlow.run(selected.id,async()=>{\n        const [actual,decisaoAtual] = await Promise.all([fetchLocation(selected.id),lerReviewStatus(selected.id)]);\n        if (statusDoPainel(actual,{[selected.id]:decisaoAtual})!=='reprovado') throw new Error('Situacao modificada por outro vendedor. Atualize os dados.');\n        await salvarReviewStatus(selected.id,'reaberto');\n        return actual;\n      });"],
];
for (const [before, after] of replacements) {
  if (panel.split(before).length !== 2) throw Error('Arquivo local mudou: revisar integracao, sem substituir versao do painel.');
  panel = panel.replace(before, after);
}
writeFileSync(resolve(target, 'AppHome.jsx'), panel);
copyFileSync('integration/flow-bridge-app.mjs', resolve(target, 'flow-bridge-app.mjs'));
mkdirSync(resolve(target, 'flow-bridge'), {recursive: true});
for (const name of ['state.mjs', 'operations.mjs', 'bridge.mjs']) copyFileSync(resolve('src', name), resolve(target, 'flow-bridge', name));
mkdirSync('reports', {recursive: true});
writeFileSync('reports/local-source-hashes.json', JSON.stringify({source, hashes}, null, 2)+'\n');
const patch = spawnSync('diff', ['-u', '--label', 'a/extensions/app-home/src/AppHome.jsx', '--label', 'b/extensions/app-home/src/AppHome.jsx', resolve(source, 'AppHome.jsx'), resolve(target, 'AppHome.jsx')], {encoding: 'utf8'});
if (patch.error || ![0,1].includes(patch.status)) throw Error(patch.error?.message || patch.stderr);
writeFileSync('integration/panel.patch', patch.stdout);
console.log('Current local panel staged and five business actions wrapped. Original sources unchanged; flags disabled.');
