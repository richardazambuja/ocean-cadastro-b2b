// Shared by the existing panel and the restricted production test. No B2B writes.
export async function rejectLocation(id,{getLocation,readDecision,saveDecision,classify,status}) {
  const [actual,decision]=await Promise.all([getLocation(id),readDecision(id)]);
  if(!['pendente','incompleto'].includes(status(actual,{[id]:decision}))) throw Error('Situacao modificada por outro vendedor. Atualize os dados.');
  if(classify(actual)==='erro') throw Error('Os dados do local estao incompletos para verificar as permissoes.');
  await saveDecision(id,'reprovado');
  return actual;
}
export async function reopenLocation(id,{getLocation,readDecision,saveDecision,status}) {
  const [actual,decision]=await Promise.all([getLocation(id),readDecision(id)]);
  if(status(actual,{[id]:decision})!=='reprovado') throw Error('Situacao modificada por outro vendedor. Atualize os dados.');
  await saveDecision(id,'reaberto');
  return actual;
}
