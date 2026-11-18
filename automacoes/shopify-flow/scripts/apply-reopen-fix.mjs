import {readFileSync,writeFileSync,copyFileSync} from 'node:fs';
const root='../..';const src=root+'/extensions/app-home/src';
for(const name of ['state','bridge','operations','uuid'])copyFileSync(`src/${name}.mjs`,`${src}/flow-bridge/${name}.mjs`);
for(const [from,to]of[['flow-bridge-production','flow-bridge-app'],['review-actions','review-actions'],['reopen-production-test','reopen-production-test']])copyFileSync(`integration/${from}.mjs`,`${src}/${to}.mjs`);
const path=src+'/AppHome.jsx';let text=readFileSync(path,'utf8');
function replace(before,after){if(!text.includes(before))throw Error('Current panel differs: '+before.slice(0,80));text=text.replace(before,after);}
replace("import {ponteFlow} from './flow-bridge-app.mjs';","import {ponteFlow,FLOW_BRIDGE_BUILD} from './flow-bridge-app.mjs';\nimport {rejectLocation,reopenLocation} from './review-actions.mjs';\nimport {runReopenProductionTest} from './reopen-production-test.mjs';");
replace('function App() {',"const REVIEW_DEPS={getLocation:fetchLocation,readDecision:lerReviewStatus,saveDecision:salvarReviewStatus,classify:classifyLocation,status:statusDoPainel};\n\nfunction App() {");
replace("  const [notice,setNotice] = useState('');","  const [notice,setNotice] = useState('');\n  const [testTools,setTestTools] = useState(false);");
replace('      // Falha ao ler as decisoes nao deve transformar reprovados em pendentes.','      setTestTools(await ponteFlow.testing());\n      // Falha ao ler as decisoes nao deve transformar reprovados em pendentes.');
replace(`const actual = await ponteFlow.run(selected.id,async()=>{
        const [actual,decisaoAtual] = await Promise.all([fetchLocation(selected.id),lerReviewStatus(selected.id)]);
        if (!['pendente','incompleto'].includes(statusDoPainel(actual,{[selected.id]:decisaoAtual}))) throw new Error('Situacao modificada por outro vendedor. Atualize os dados.');
        if (classifyLocation(actual)==='erro') throw new Error('Os dados do local estao incompletos para verificar as permissoes.');
        await salvarReviewStatus(selected.id,'reprovado');
        return actual;
      });`,`const actual = await ponteFlow.run(selected.id,()=>rejectLocation(selected.id,REVIEW_DEPS));`);
replace(`const actual = await ponteFlow.run(selected.id,async()=>{
        const [actual,decisaoAtual] = await Promise.all([fetchLocation(selected.id),lerReviewStatus(selected.id)]);
        if (statusDoPainel(actual,{[selected.id]:decisaoAtual})!=='reprovado') throw new Error('Situacao modificada por outro vendedor. Atualize os dados.');
        await salvarReviewStatus(selected.id,'reaberto');
        return actual;
      });`,`const actual = await ponteFlow.run(selected.id,()=>reopenLocation(selected.id,REVIEW_DEPS));`);
replace('  const STATUS = {',`  async function testReopening() {
    if(busy||loading)return;
    setBusy(true);setError('');setNotice('Teste de reabertura em andamento.');
    try {
      const result=await runReopenProductionTest(phase=>setNotice('Teste de reabertura: '+phase));
      await loadLocations();
      setNotice('Reaberturas e aprovacao comercial de teste confirmadas. Aguardando as execucoes do Flow ate '+new Date(result.deadline).toLocaleTimeString('pt-BR')+'. Cadastros reais continuam restritos.');
    } catch(e){setError('Teste de reabertura: '+e.message);}
    finally{setBusy(false);}
  }

  const STATUS = {`);
replace('        {error && <s-banner',`        <s-text color="subdued">Versao Ocean B2B: {FLOW_BRIDGE_BUILD}</s-text>
        {testTools && <s-button variant="secondary" disabled={busy||loading} onClick={testReopening}>Testar reabertura — somente cadastros de teste</s-button>}
        {error && <s-banner`);
writeFileSync(path,text);console.log('Applied reconciliation fix and restricted owner-auth test to current panel.');
