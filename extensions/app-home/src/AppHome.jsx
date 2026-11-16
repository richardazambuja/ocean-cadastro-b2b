import {render} from 'preact';
import {useEffect, useMemo, useState} from 'preact/hooks';
import {fetchAllLocations, fetchLocation, assignOrderRole} from './api.mjs';
import {selectBuyer, selectOrderRole, formatCnpj, classifyLocation} from './regras.mjs';
import {approveLocation} from './aprovar.mjs';
import {ordenarPorCadastro, formatarDataCadastro} from './ordenacao.mjs';
import {statusDoPainel, totaisDoPainel, podeReprovar, podeReabrir} from './status.mjs';
import {fetchReviewStatuses, lerReviewStatus, salvarReviewStatus} from './reprovados-api.mjs';
import {telefoneDoCadastro, formatarTelefone, telefoneParaHref, instagramParaHref} from './contato-links.mjs';
import {cnpjParaHref} from './cnpj-link.mjs';

export default async function extension() {
  render(<App />, document.body);
}

function App() {
  const [locations,setLocations] = useState([]);
  const [decisions,setDecisions] = useState({});
  const [loading,setLoading] = useState(true);
  const [busy,setBusy] = useState(false);
  const [selected,setSelected] = useState(null);
  const [error,setError] = useState('');
  const [notice,setNotice] = useState('');
  const [search,setSearch] = useState('');
  const [filter,setFilter] = useState('pendente');
  const [sortOrder,setSortOrder] = useState('recentes');
  const [confirmingRejection,setConfirmingRejection] = useState(false);

  async function loadLocations() {
    setLoading(true);
    setError('');
    try {
      // Falha ao ler as decisoes nao deve transformar reprovados em pendentes.
      const [locais,decisoes] = await Promise.all([fetchAllLocations(),fetchReviewStatuses()]);
      setLocations(locais);
      setDecisions(decisoes);
    } catch (e) {setError(e.message || 'Falha ao consultar a Shopify.');}
    finally {setLoading(false);}
  }

  useEffect(()=>{void loadLocations();},[]);
  const stats = useMemo(()=>totaisDoPainel(locations,decisions),[locations,decisions]);
  const filtered = useMemo(()=>ordenarPorCadastro(locations.filter(item=>{
    const status = statusDoPainel(item,decisions);
    if (filter !== 'todos' && status !== filter) return false;
    const needle = search.trim().toLowerCase();
    return !needle || [item.company?.name,item.name,item.taxSettings?.taxRegistrationId,item.company?.cnpjCadastro?.value,
      ...((item.company?.contacts?.nodes || []).flatMap(c=>[
        c.customer?.displayName,c.customer?.defaultEmailAddress?.emailAddress
      ]))].filter(Boolean).join(' ').toLowerCase().includes(needle);
  }),sortOrder),[locations,decisions,filter,search,sortOrder]);

  async function review(id) {
    if (busy || loading) return;
    setBusy(true);setError('');setNotice('');setConfirmingRejection(false);
    try {
      // Verifica a Shopify e o estado interno no momento de abrir a analise.
      const [location,status] = await Promise.all([fetchLocation(id),lerReviewStatus(id)]);
      setDecisions(prev=>({...prev,[id]:status}));
      setSelected(location);
    } catch(e) {setError(e.message || 'Nao foi possivel abrir o cadastro.');}
    finally {setBusy(false);}
  }

  async function approve() {
    if (!selected || busy || loading || !podeReprovar(selected,decisions) || classifyLocation(selected)!=='pendente') return;
    setBusy(true);setError('');setNotice('');
    try {
      const latestStatus = await lerReviewStatus(selected.id);
      if (latestStatus === 'reprovado') throw new Error('Este local foi reprovado por outro vendedor. Reabra a analise antes de aprovar.');
      const outcome = await approveLocation(selected.id,{
        getLocation:fetchLocation,assignRole:assignOrderRole
      });
      if (outcome.status === 'ja_aprovado') {
        setNotice('Ja existe comprador atribuido a esse local. Nenhuma permissao foi alterada.');
      } else {
        setNotice(`${outcome.location.company.name}: comprador autorizado para pedidos no local ${outcome.location.name}.`);
        shopify.toast.show('Cadastro aprovado e permissao confirmada.');
      }
      setSelected(null);
      await loadLocations();
    } catch(e) {
      setError(e.message || 'Nao foi possivel aprovar o cadastro.');
    } finally {setBusy(false);}
  }

  async function reject() {
    if (!selected || busy || loading || !podeReprovar(selected,decisions) || !confirmingRejection) return;
    setBusy(true);setError('');setNotice('');
    try {
      // Revalida para nao marcar como reprovado um local ja autorizado.
      const actual = await fetchLocation(selected.id);
      if (classifyLocation(actual)==='aprovado') throw new Error('O local ja possui comprador autorizado. Nao e permitido reprovar pelo painel.');
      if (classifyLocation(actual)==='erro') throw new Error('Os dados do local estao incompletos para verificar as permissoes.');
      await salvarReviewStatus(selected.id,'reprovado');
      const companyName = actual.company.name;
      setSelected(null);setConfirmingRejection(false);setFilter('reprovado');
      await loadLocations();
      setNotice(`${companyName} movida para Reprovados. Nenhuma permissao B2B foi modificada.`);
      shopify.toast.show('Cadastro marcado como reprovado no painel.');
    } catch(e) {setError(e.message || 'Falha ao gravar a reprovacao.');}
    finally {setBusy(false);}
  }

  async function reopen() {
    if (!selected || busy || loading || !podeReabrir(selected,decisions)) return;
    setBusy(true);setError('');setNotice('');
    try {
      const actual = await fetchLocation(selected.id);
      if (classifyLocation(actual)==='aprovado') throw new Error('O local ja possui comprador autorizado; atualize os dados.');
      await salvarReviewStatus(selected.id,'reaberto');
      const companyName = actual.company.name;
      setSelected(null);setConfirmingRejection(false);
      const currentStatus = classifyLocation(actual);
      setFilter(currentStatus==='incompleto'?'incompleto':'pendente');
      await loadLocations();
      setNotice(`${companyName}: analise reaberta no painel.`);
    } catch(e) {setError(e.message || 'Falha ao reabrir o cadastro.');}
    finally {setBusy(false);}
  }

  const STATUS = {
    pendente:{label:'Pendente',tone:'warning'},
    aprovado:{label:'Aprovado',tone:'success'},
    incompleto:{label:'Incompleto',tone:'critical'},
    reprovado:{label:'Reprovado',tone:'critical'},
    erro:{label:'Revisar',tone:'critical'}
  };
  return (
    <s-page heading="Gestão de Cadastros">
      <s-stack direction="block" gap="base">
        {error && <s-banner tone="critical">{error}</s-banner>}
        {notice && <s-banner tone="success">{notice}</s-banner>}
        {!selected ? <>
          <s-section heading="Resumo dos cadastros B2B">
            <s-grid gridTemplateColumns="repeat(4, 1fr)" gap="base">
              <s-box padding="base" background="subdued" borderRadius="base">
                <s-stack gap="small-100"><s-heading fontSize="large-400">{stats.pendente}</s-heading><s-text fontSize="large-100">Pendentes</s-text></s-stack>
              </s-box>
              <s-box padding="base" background="subdued" borderRadius="base">
                <s-stack gap="small-100"><s-heading fontSize="large-400">{stats.aprovado}</s-heading><s-text fontSize="large-100">Aprovados</s-text></s-stack>
              </s-box>
              <s-box padding="base" background="subdued" borderRadius="base">
                <s-stack gap="small-100"><s-heading fontSize="large-400">{stats.reprovado}</s-heading><s-text fontSize="large-100">Reprovados</s-text></s-stack>
              </s-box>
              <s-box padding="base" background="subdued" borderRadius="base">
                <s-stack gap="small-100"><s-heading fontSize="large-400">{stats.incompleto+stats.erro}</s-heading><s-text fontSize="large-100">Sem contato / revisar</s-text></s-stack>
              </s-box>
            </s-grid>
            <s-stack direction="inline" alignItems="center" gap="small-200">
              <s-text>Empresas em tempo real da Shopify; reprovacoes internas do aplicativo.</s-text>
              <s-button variant="tertiary" onClick={loadLocations} disabled={loading||busy}>{loading?'Atualizando...':'Atualizar dados'}</s-button>
            </s-stack>
          </s-section>
          <s-section heading="Cadastros de empresas">
            <s-stack gap="base">
              <s-text-field icon="search" label="Buscar" placeholder="Empresa, local, contato ou CNPJ"
                value={search} onInput={e=>setSearch(e.currentTarget.value)}/>
              <s-stack direction="inline" gap="small-200">
                <s-button variant={filter==='pendente'?'primary':'secondary'} onClick={()=>setFilter('pendente')}>Pendentes</s-button>
                <s-button variant={filter==='aprovado'?'primary':'secondary'} onClick={()=>setFilter('aprovado')}>Aprovados</s-button>
                <s-button variant={filter==='incompleto'?'primary':'secondary'} onClick={()=>setFilter('incompleto')}>Incompletos</s-button>
                <s-button variant={filter==='reprovado'?'primary':'secondary'} onClick={()=>setFilter('reprovado')}>Reprovados</s-button>
                <s-button variant={filter==='todos'?'primary':'secondary'} onClick={()=>setFilter('todos')}>Todos</s-button>
              </s-stack>
              <s-stack direction="inline" alignItems="center" gap="small-200">
                <s-text>Ordenar por data do cadastro:</s-text>
                <s-button variant={sortOrder==='recentes'?'primary':'secondary'} onClick={()=>setSortOrder('recentes')}>Mais recentes</s-button>
                <s-button variant={sortOrder==='antigos'?'primary':'secondary'} onClick={()=>setSortOrder('antigos')}>Mais antigos</s-button>
              </s-stack>
              {loading && <s-text>Consultando empresas e decisoes do aplicativo...</s-text>}
              {!loading && !error && filtered.length===0 && <s-text>Nenhum local encontrado nesse filtro.</s-text>}
              {!loading && !error && filtered.map(item=>{
                const status=statusDoPainel(item,decisions);
                const buyer=selectBuyer(item.company);
                const customer=buyer.ok?buyer.contact.customer:null;
                const telefone=telefoneDoCadastro(item,customer);
                const telHref=telefoneParaHref(telefone);
                const instagram=item.company?.instagram?.value?.trim() || '';
                const instagramHref=instagramParaHref(instagram);
                const cnpjBruto=item.taxSettings?.taxRegistrationId || item.company?.cnpjCadastro?.value;
                const cnpjHref=cnpjParaHref(cnpjBruto);
                return <s-box key={item.id} border="base" borderRadius="base" padding="base">
                  <s-stack gap="base">
                    <s-stack direction="inline" alignItems="center" justifyContent="space-between" gap="base">
                      <s-heading fontSize="large-400">{item.company.name}</s-heading>
                      <s-badge tone={STATUS[status]?.tone||'critical'}>{STATUS[status]?.label||'Revisar'}</s-badge>
                    </s-stack>
                    <s-heading fontSize="large-200">Local: {item.name}</s-heading>
                    <s-heading fontSize="large-200">Cadastro: {formatarDataCadastro(item.createdAt)}</s-heading>
                    <s-stack direction="inline" alignItems="center" gap="small-200">
                      <s-heading fontSize="large-200">CNPJ:</s-heading>
                      <s-heading fontSize="large-200">
                        {cnpjHref ? <s-link href={cnpjHref} target="_blank">{formatCnpj(cnpjBruto)}</s-link> : formatCnpj(cnpjBruto)}
                      </s-heading>
                    </s-stack>
                    <s-heading fontSize="large-200">Contato: {customer?.displayName||'Sem contato elegível'}{customer?.defaultEmailAddress?.emailAddress?` — ${customer.defaultEmailAddress.emailAddress}`:''}</s-heading>
                    {telefone && <s-stack direction="inline" gap="small-200" alignItems="center">
                      <s-heading fontSize="large-200">WhatsApp:</s-heading>
                      <s-heading fontSize="large-200">{telHref ? <s-link href={telHref} target="_blank">{formatarTelefone(telefone)}</s-link> : formatarTelefone(telefone)}</s-heading>
                    </s-stack>}
                    {instagram && <s-stack direction="inline" gap="small-200" alignItems="center">
                      <s-heading fontSize="large-200">Instagram:</s-heading>
                      <s-heading fontSize="large-200">{instagramHref ? <s-link href={instagramHref} target="_blank">{instagram}</s-link> : instagram}</s-heading>
                    </s-stack>}
                    <s-button variant={status==='pendente'?'primary':'secondary'} disabled={busy} onClick={()=>review(item.id)}>
                      {status==='pendente'?'Analisar cadastro':'Ver detalhes'}
                    </s-button>
                  </s-stack>
                </s-box>;
              })}
            </s-stack>
          </s-section>
        </> : <Detail
          location={selected} decisions={decisions} busy={busy} confirming={confirmingRejection}
          onStartRejection={()=>setConfirmingRejection(true)}
          onCancelRejection={()=>setConfirmingRejection(false)}
          onBack={()=>{setSelected(null);setError('');setConfirmingRejection(false);}}
          onApprove={approve} onReject={reject} onReopen={reopen}
        />}
      </s-stack>
    </s-page>
  );
}

function Detail({location,decisions,busy,confirming,onStartRejection,onCancelRejection,onBack,onApprove,onReject,onReopen}) {
  const status=statusDoPainel(location,decisions);
  const buyer=selectBuyer(location.company);
  const contact=buyer.ok?buyer.contact.customer:null;
  const orderRole=selectOrderRole(location.company);
  const address=location.billingAddress;
  const telefone=telefoneDoCadastro(location,contact);
  const telHref=telefoneParaHref(telefone);
  const instagram=location.company?.instagram?.value?.trim() || '';
  const instagramHref=instagramParaHref(instagram);
  const segmento=location.company?.segmento?.value?.trim() || '';
  const faturamento=location.company?.faturamento?.value?.trim() || '';
  const cnpjBruto=location.taxSettings?.taxRegistrationId || location.company?.cnpjCadastro?.value;
  const cnpjHref=cnpjParaHref(cnpjBruto);
  return <s-section heading="Análise do cadastro">
    <s-stack gap="base">
      <s-button variant="tertiary" onClick={onBack} disabled={busy}>Voltar</s-button>
      <s-heading fontSize="large-400">{location.company.name}</s-heading>
      <s-badge tone={status==='pendente'?'warning':status==='aprovado'?'success':'critical'}>
        {status==='pendente'?'Aguardando aprovação':status==='aprovado'?'Aprovado':status==='reprovado'?'Reprovado no painel':'Revisão necessária'}
      </s-badge>
      <s-box border="base" borderRadius="base" padding="base">
        <s-stack gap="base">
          <s-heading fontSize="large-300">Dados da empresa</s-heading>
          <s-grid gridTemplateColumns="repeat(2, 1fr)" gap="large">
            <s-stack gap="small-200">
              <s-text fontSize="large-100" fontWeight="semibold" color="subdued">Empresa / razão social</s-text>
              <s-heading fontSize="large-300">{location.company.name}</s-heading>
            </s-stack>
            <s-stack gap="small-200">
              <s-text fontSize="large-100" fontWeight="semibold" color="subdued">CNPJ — consultar cadastro</s-text>
              <s-heading fontSize="large-300">{cnpjHref ? <s-link href={cnpjHref} target="_blank">{formatCnpj(cnpjBruto)}</s-link> : formatCnpj(cnpjBruto)}</s-heading>
            </s-stack>
            <s-stack gap="small-200">
              <s-text fontSize="large-100" fontWeight="semibold" color="subdued">Segmento de atuação</s-text>
              <s-heading fontSize="large-300">{segmento || 'Não informado'}</s-heading>
            </s-stack>
            <s-stack gap="small-200">
              <s-text fontSize="large-100" fontWeight="semibold" color="subdued">Faturamento mensal informado</s-text>
              <s-heading fontSize="large-300">{faturamento || 'Não informado'}</s-heading>
            </s-stack>
          </s-grid>
          <s-heading fontSize="large-200">Cadastro: {formatarDataCadastro(location.createdAt)}</s-heading>
        </s-stack>
      </s-box>
      <s-box border="base" borderRadius="base" padding="base">
        <s-stack gap="base">
          <s-heading fontSize="large-300">Contato do cadastro</s-heading>
          <s-heading fontSize="large-200">Responsável: {contact?.displayName || 'Não identificado'}</s-heading>
          <s-heading fontSize="large-200">E-mail: {contact?.defaultEmailAddress?.emailAddress || 'Não informado'}</s-heading>
          <s-stack direction="inline" gap="base" alignItems="center">
            <s-heading fontSize="large-200">WhatsApp:</s-heading>
            <s-heading fontSize="large-200">{telefone ? (telHref ? <s-link href={telHref} target="_blank">{formatarTelefone(telefone)}</s-link> : formatarTelefone(telefone)) : 'Não informado'}</s-heading>
          </s-stack>
          <s-stack direction="inline" gap="base" alignItems="center">
            <s-heading fontSize="large-200">Instagram:</s-heading>
            <s-heading fontSize="large-200">{instagram ? (instagramHref ? <s-link href={instagramHref} target="_blank">{instagram}</s-link> : instagram) : 'Não informado'}</s-heading>
          </s-stack>
        </s-stack>
      </s-box>
      <s-box border="base" borderRadius="base" padding="base">
        <s-stack gap="base">
          <s-heading fontSize="large-300">Local e faturamento</s-heading>
          <s-heading fontSize="large-200">Local: {location.name}</s-heading>
          <s-heading fontSize="large-200">Endereço: {[address?.address1,address?.address2,address?.city,address?.province,address?.country].filter(Boolean).join(', ') || 'Não informado'}</s-heading>
          <s-heading fontSize="large-200">CEP: {address?.zip || 'Não informado'}</s-heading>
        </s-stack>
      </s-box>
      <s-box border="base" borderRadius="base" padding="base">
        <s-stack gap="base">
          <s-heading fontSize="large-300">Permissões B2B</s-heading>
          <s-heading fontSize="large-200">Função concedida ao aprovar: Apenas pedidos</s-heading>
          <s-heading fontSize="large-200">Situação: {status==='aprovado'?'Comprador já atribuído':status==='pendente'?'Aguardando aprovação':status==='reprovado'?'Reprovado somente no painel':'Revisar cadastro'}</s-heading>
        </s-stack>
      </s-box>
      {!buyer.ok && status!=='reprovado' && status!=='aprovado' && <s-banner tone="critical">{buyer.reason}</s-banner>}
      {!orderRole && status==='pendente' && <s-banner tone="critical">Função "Apenas pedidos" indisponível nesta empresa.</s-banner>}
      {status==='aprovado' && <s-banner tone="success">Já existe comprador atribuído ao local. A reprovação pelo painel está indisponível.</s-banner>}
      {status==='reprovado' && <s-banner tone="info">Reprovado apenas no aplicativo. Os dados e as permissões B2B da empresa continuam inalterados.</s-banner>}
      {status==='pendente' && buyer.ok && orderRole && <s-banner tone="info">Aprovar libera "Apenas pedidos" neste local. Reprovar apenas organiza este cadastro dentro do aplicativo.</s-banner>}
      {status==='pendente' && buyer.ok && orderRole && <s-button variant="primary" disabled={busy||confirming} onClick={onApprove}>
        {busy?'Processando...':'Aprovar cadastro'}
      </s-button>}
      {podeReprovar(location,decisions) && !confirming && <s-button variant="secondary" tone="critical" disabled={busy} onClick={onStartRejection}>Reprovar cadastro</s-button>}
      {podeReprovar(location,decisions) && confirming && <s-box border="base" borderRadius="base" padding="base">
        <s-stack gap="small-200">
          <s-text>Confirmar reprovação? O cadastro irá para a aba Reprovados, sem bloquear o cliente na Shopify.</s-text>
          <s-stack direction="inline" gap="small-200">
            <s-button variant="primary" tone="critical" disabled={busy} onClick={onReject}>{busy?'Registrando...':'Confirmar reprovação'}</s-button>
            <s-button variant="secondary" disabled={busy} onClick={onCancelRejection}>Cancelar</s-button>
          </s-stack>
        </s-stack>
      </s-box>}
      {podeReabrir(location,decisions) && <s-button variant="secondary" disabled={busy} onClick={onReopen}>Reabrir análise</s-button>}
    </s-stack>
  </s-section>;
}
