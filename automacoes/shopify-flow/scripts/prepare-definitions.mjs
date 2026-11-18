import {writeFileSync, mkdirSync} from 'node:fs';
import {NAMESPACE, EVENT_TYPE, STATUSES} from '../src/state.mjs';
mkdirSync('config', {recursive: true});
const fields = [
  ['review', 'Estado compartilhado de analise Ocean', 'json'],
  ['ready', 'Sincronizacao comercial confirmada', 'boolean'],
  ['status', 'Status comercial Ocean', 'single_line_text_field'],
  ['cycle_id', 'Ciclo de analise Ocean', 'single_line_text_field'],
  ['pending_since', 'Entrada em Pendentes Ocean', 'date_time'],
  ['notifications', 'Controle de avisos Ocean', 'json'],
];
for (const [key, name, type] of fields) {
  const definition = {name, namespace: NAMESPACE, key, type, ownerType: 'COMPANY_LOCATION'};
  if (key === 'status') definition.validations = [{name: 'choices', value: JSON.stringify(STATUSES)}];
  writeFileSync(`config/metafield-${key}.variables.json`, JSON.stringify({definition}, null, 2)+'\n');
}
writeFileSync('config/cycle-signal.variables.json', JSON.stringify({definition: {
  type: EVENT_TYPE,
  name: 'Ocean - Ciclo pendente para notificacao',
  description: 'Sinal nativo por ciclo; nao substitui a decisao comercial do cadastro-b2b.',
  displayNameKey: 'cycle_id',
  fieldDefinitions: [
    {key: 'local_id', name: 'ID do local B2B', type: 'single_line_text_field', required: true},
    {key: 'cycle_id', name: 'Ciclo de analise', type: 'single_line_text_field', required: true},
    {key: 'entered_at', name: 'Entrada em Pendentes', type: 'date_time', required: true},
  ],
}}, null, 2)+'\n');
console.log('Prepared 6 shared metafield definitions and 1 native cycle signal. Nothing submitted.');
