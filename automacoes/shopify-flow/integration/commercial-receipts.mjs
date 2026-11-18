const receipts=new Map();
export function rememberDecision(record){const f=Object.fromEntries((record?.fields||[]).map(x=>[x.key,x.value]));if(f.local_id&&f.status&&f.alterado_em)receipts.set(f.local_id,record);}
export function latestDecision(id,record){const recent=receipts.get(id);if(!recent)return record;const version=x=>Date.parse(x?.fields?.find(f=>f.key==='alterado_em')?.value||'');return !record||version(recent)>version(record)?recent:record;}
export function decisionReceipts(){return [...receipts.values()];}
