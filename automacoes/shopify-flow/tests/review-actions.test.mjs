import test from 'node:test';
import assert from 'node:assert/strict';
import {rejectLocation,reopenLocation} from '../integration/review-actions.mjs';
import {classifyLocation} from '../../../extensions/app-home/src/regras.mjs';
import {statusDoPainel} from '../../../extensions/app-home/src/status.mjs';
const id='gid://shopify/CompanyLocation/1';
function fixture(privateStatus,assignments=[]){
 const location={id,roleAssignments:{nodes:assignments,pageInfo:{hasNextPage:false}},company:{mainContact:{id:'c'},contacts:{nodes:[{id:'c',customer:{id:'u'}}],pageInfo:{hasNextPage:false}}}};
 const writes=[];let decision=privateStatus;
 const deps={getLocation:async()=>structuredClone(location),readDecision:async()=>decision,saveDecision:async(_,value)=>{decision=value;writes.push(value);},classify:classifyLocation,status:statusDoPainel};
 return{deps,location,writes,decision:()=>decision};
}
test('Acao compartilhada rejeita somente pendentes/incompletos; aprovados sem acesso continuam aprovados',async()=>{
 for(const [status,roles]of[['aprovado_pendente',[]],[null,[{id:'permission'}]]]){const f=fixture(status,roles);await assert.rejects(rejectLocation(id,f.deps));assert.equal(f.writes.length,0);}
});
test('Reprovar e reabrir alteram apenas decisao comercial e conservam permissoes',async()=>{
 const f=fixture(null);const before=structuredClone(f.location.roleAssignments);
 await rejectLocation(id,f.deps);assert.equal(f.decision(),'reprovado');
 await reopenLocation(id,f.deps);assert.equal(f.decision(),'reaberto');
 assert.deepEqual(f.writes,['reprovado','reaberto']);assert.deepEqual(f.location.roleAssignments,before);
 await assert.rejects(reopenLocation(id,f.deps));assert.equal(f.writes.length,2);
});
