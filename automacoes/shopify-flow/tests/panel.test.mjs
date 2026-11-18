import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
const require = createRequire(new URL('../../../package.json', import.meta.url));
const {ts} = require('ts-morph');

test('Painel atual com os cinco hooks tem sintaxe JSX valida', () => {
  const text=readFileSync(new URL('../validation/app-home/src/AppHome.jsx',import.meta.url),'utf8');
  const result=ts.transpileModule(text,{fileName:'AppHome.jsx',compilerOptions:{allowJs:true,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ESNext,module:ts.ModuleKind.ESNext},reportDiagnostics:true});
  assert.deepEqual(result.diagnostics,[]);
  assert.equal((text.match(/ponteFlow\.run\(/g)||[]).length,5);
});

test('Adapter preparado inicia desligado e nao acessa Shopify', async () => {
  const adapter=await import('../validation/app-home/src/flow-bridge-app.mjs');
  assert.equal(adapter.FLOW_BRIDGE_ENABLED,false);
  assert.equal(adapter.FLOW_SIGNALS_ENABLED,false);
  const previous=globalThis.shopify;
  globalThis.shopify={query:()=>{throw Error('Real Shopify access forbidden in test');}};
  try {assert.equal(await adapter.ponteFlow.run('gid://shopify/CompanyLocation/1',async()=>42),42);}
  finally {globalThis.shopify=previous;}
});

test('Painel de producao integrado tem sintaxe JSX valida e cinco hooks',()=>{
  const text=readFileSync(new URL('../../../extensions/app-home/src/AppHome.jsx',import.meta.url),'utf8');
  const result=ts.transpileModule(text,{fileName:'AppHome.jsx',compilerOptions:{allowJs:true,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ESNext,module:ts.ModuleKind.ESNext},reportDiagnostics:true});
  assert.deepEqual(result.diagnostics,[]);
  assert.equal((text.match(/ponteFlow\.run\(/g)||[]).length,5);
  for(const label of ['mensagens-whatsapp.mjs','cnpj-link.mjs','calcularPrazoPendente','vencidosPendentes','validarTravamento'])assert.ok(text.includes(label));
});
