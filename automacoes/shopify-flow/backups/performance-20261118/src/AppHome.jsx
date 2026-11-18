import {render} from 'preact';
import {ponteFlow} from './flow-bridge-app.mjs';
import {rejectLocation,reopenLocation} from './review-actions.mjs';
import {useEffect, useMemo, useState} from 'preact/hooks';
import {fetchAllLocations, fetchLocation, assignOrderRole, revokeOrderRole} from './api.mjs';
import {selectBuyer, selectOrderRole, formatCnpj, classifyLocation} from './regras.mjs';
import {approveLocation, releaseAccess, lockAccess, validarTravamento} from './aprovar.mjs';
import {ordenarPorCadastro, formatarDataCadastro} from './ordenacao.mjs';
import {statusDoPainel, totaisDoPainel, podeReprovar, podeReabrir} from './status.mjs';
import {fetchReviewStatuses, lerReviewStatus, salvarReviewStatus} from './reprovados-api.mjs';
import {telefoneDoCadastro, formatarTelefone, telefoneParaHref, instagramParaHref} from './contato-links.mjs';
import {mensagemWhatsAppDoStatus, whatsappMensagemHref} from './mensagens-whatsapp.mjs'; // OCEAN_WHATSAPP_STATUS_V1
import {cnpjParaHref} from './cnpj-link.mjs';
import {calcularPrazoPendente} from './prazo-pendentes.mjs'; // OCEAN_PENDENTES_10M_V1

export default async function extension() {
  render(<App />, document.body);
}

const REVIEW_DEPS={getLocation:fetchLocation,readDecision:lerReviewStatus,saveDecision:salvarReviewStatus,classify:classifyLocation,status:statusDoPainel};

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
  const [confirmingLock,setConfirmingLock] = useState(false);
  const [agora,setAgora] = useState(Date.now());

  async function loadLocations() {
    setLoading(true);
    setError('');
    try {
      // Falha ao ler as decisoes nao deve transformar reprovados em pendentes.
      const [locais,decisoes] = await Promise.all([fetchAllLocations(),fetchReviewStatuses()]);
      setLocations(locais);
      setDecisions(decisoes);
      const syncWarnings=await ponteFlow.syncLoaded(locais,{fullInventory:true});
      if(syncWarnings.length) throw Error("Sincronizacao de avisos requer revisao: "+syncWarnings.join("; "));
    } catch (e) {setError(e.message || 'Falha ao consultar a Shopify.');}
    finally {setLoading(false);}
  }

  useEffect(()=>{void loadLocations();},[]);
  useEffect(()=>{
    const timer = setInterval(()=>setAgora(Date.now()),1000);
    return ()=>clearInterval(timer);
  },[]);
  const stats = useMemo(()=>totaisDoPainel(locations,decisions),[locations,decisions]);
  const vencidosPendentes=locations.filter(local=>statusDoPainel(local,decisions)==='pendente' && calcularPrazoPendente(local,decisions,agora).vencido).length;
  const filtered = useMemo(()=>ordenarPorCadastro(locations.filter(item=>{
    const status = statusDoPainel(item,decisions);
    if (filter === 'vencidos') {
      if (status !== 'pendente' || !calcularPrazoPendente(item,decisions,agora).vencido) return false;
    } else if (filter !== 'todos' && status !== filter) return false;
    const needle = search.trim().toLowerCase();
    return !needle || [item.company?.name,item.name,item.taxSettings?.taxRegistrationId,item.company?.cnpjCadastro?.value,
      ...((item.company?.contacts?.nodes || []).flatMap(c=>[
        c.customer?.displayName,c.customer?.defaultEmailAddress?.emailAddress
      ]))].filter(Boolean).join(' ').toLowerCase().includes(needle);
  }),sortOrder),[locations,decisions,filter,search,sortOrder,agora]);

  async function review(id, openLock=false) {
    if (busy || loading) return;
    setBusy(true);setError('');setNotice('');setConfirmingRejection(false);setConfirmingLock(false);
    try {
      // Verifica a Shopify e o estado interno no momento de abrir a analise.
      const [location,status] = await Promise.all([fetchLocation(id),lerReviewStatus(id)]);
      setDecisions(prev=>({...prev,[id]:status}));
      setSelected(location);
      setConfirmingLock(Boolean(openLock && statusDoPainel(location,{[id]:status})==='aprovado_liberado' && validarTravamento(location).ok));
    } catch(e) {setError(e.message || 'Nao foi possivel abrir o cadastro.');}
    finally {setBusy(false);}
  }

  // Aprovar significa SOMENTE aprovar comercialmente, sem liberar compra.
  async function approve() {
    if (!selected || busy || loading || statusDoPainel(selected,decisions)!=='pendente') return;
    setBusy(true);setError('');setNotice('');
    try {
      const outcome = await ponteFlow.run(selected.id,()=>approveLocation(selected.id,{
        getLocation:fetchLocation,readDecision:lerReviewStatus,saveDecision:salvarReviewStatus
      }));
      setSelected(null);setFilter('aprovado_pendente');
      await loadLocations();
      setNotice(`${outcome.location.company.name}: aprovada comercialmente. O acesso a pedidos continua bloqueado ate a liberacao.`);
      shopify.toast.show('Cadastro aprovado. Acesso pendente de liberacao.');
    } catch(e) {setError(e.message || 'Falha na aprovacao comercial.');}
    finally {setBusy(false);}
  }

  async function release() {
    if (!selected || busy || loading || statusDoPainel(selected,decisions)!=='aprovado_pendente') return;
    setBusy(true);setError('');setNotice('');
    try {
      const outcome=await ponteFlow.run(selected.id,()=>releaseAccess(selected.id,{
        getLocation:fetchLocation,readDecision:lerReviewStatus,assignRole:assignOrderRole
      }));
      setSelected(null);setFilter('aprovado_liberado');
      await loadLocations();
      setNotice(`${outcome.location.company.name}: acesso Apenas pedidos concedido e confirmado na Shopify.`);
      shopify.toast.show('Acesso a pedidos liberado.');
    } catch(e) {setError(e.message || 'Nao foi possivel liberar o acesso.');}
    finally {setBusy(false);}
  }

  async function lock() {
    if (!selected || busy || loading || !confirmingLock || statusDoPainel(selected,decisions)!=='aprovado_liberado') return;
    setBusy(true);setError('');setNotice('');
    try {
      const outcome=await ponteFlow.run(selected.id,()=>lockAccess(selected.id,{
        getLocation:fetchLocation,readDecision:lerReviewStatus,
        saveDecision:salvarReviewStatus,revokeRole:revokeOrderRole
      }));
      setSelected(null);setConfirmingLock(false);setFilter('aprovado_pendente');
      await loadLocations();
      setNotice(`${outcome.location.company.name}: funcao Apenas pedidos revogada e ausencia de acesso confirmada na Shopify.`);
      shopify.toast.show('Acesso de compra travado.');
    } catch(e) {setError(e.message || 'Nao foi possivel travar o acesso. Atualize a ficha antes de tentar novamente.');}
    finally {setBusy(false);}
  }

  async function reject() {
    if (!selected || busy || loading || !podeReprovar(selected,decisions) || !confirmingRejection) return;
    setBusy(true);setError('');setNotice('');
    try {
      // Revalida para nao marcar como reprovado um local ja autorizado.
      const actual = await ponteFlow.run(selected.id,()=>rejectLocation(selected.id,REVIEW_DEPS));
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
      const actual = await ponteFlow.run(selected.id,()=>reopenLocation(selected.id,REVIEW_DEPS));
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
    aprovado_pendente:{label:'Aprovado — acesso pendente',tone:'warning'},
    aprovado_liberado:{label:'Aprovado — acesso liberado',tone:'success'},
    incompleto:{label:'Incompleto',tone:'critical'},
    reprovado:{label:'Reprovado',tone:'critical'},
    erro:{label:'Revisar',tone:'critical'}
  };
  return (
    <s-page heading="Gestão de Cadastros">
      <s-stack direction="block" gap="base">
        {error && <s-banner tone="critical">{error}</s-banner>}
        {notice && <s-banner tone="success">{notice}</s-banner>}
        {/* OCEAN_FILTRO_VENCIDOS_10M_V2: botao independente e sempre visivel */}
        {!selected && !loading && vencidosPendentes>0 && <s-stack direction="block" gap="small-200">
          <s-banner tone="critical">Atenção: {vencidosPendentes} cadastro(s) da aba Pendentes excederam o prazo de 10 minutos para análise.</s-banner>
          <s-button variant="primary" onClick={()=>{setSearch('');setFilter('vencidos');}}>
            Ver cadastros vencidos ({vencidosPendentes})
          </s-button>
        </s-stack>}
        {!selected ? <>
          <s-section heading="Resumo dos cadastros B2B">
            <s-grid gridTemplateColumns="repeat(3, 1fr)" gap="base">
              <s-box padding="base" background="subdued" borderRadius="base">
                <s-stack gap="small-100"><s-heading fontSize="large-400">{stats.pendente}</s-heading><s-text fontSize="large-100">Pendentes</s-text></s-stack>
              </s-box>
              <s-box padding="base" background="subdued" borderRadius="base">
                <s-stack gap="small-100"><s-heading fontSize="large-400">{stats.aprovado_pendente}</s-heading><s-text fontSize="large-100">Aprovados — acesso pendente</s-text></s-stack>
              </s-box>
              <s-box padding="base" background="subdued" borderRadius="base">
                <s-stack gap="small-100"><s-heading fontSize="large-400">{stats.aprovado_liberado}</s-heading><s-text fontSize="large-100">Aprovados — acesso liberado</s-text></s-stack>
              </s-box>
              <s-box padding="base" background="subdued" borderRadius="base">
                <s-stack gap="small-100"><s-heading fontSize="large-400">{stats.reprovado}</s-heading><s-text fontSize="large-100">Reprovados</s-text></s-stack>
              </s-box>
              <s-box padding="base" background="subdued" borderRadius="base">
                <s-stack gap="small-100"><s-heading fontSize="large-400">{stats.incompleto+stats.erro}</s-heading><s-text fontSize="large-100">Sem contato / revisar</s-text></s-stack>
              </s-box>
            </s-grid>
            <s-stack direction="inline" alignItems="center" gap="small-200">
              <s-text>Permissoes de compra em tempo real na Shopify; decisoes comerciais no metaobjeto do app.</s-text>
              <s-button variant="tertiary" onClick={loadLocations} disabled={loading||busy}>{loading?'Atualizando...':'Atualizar dados'}</s-button>
            </s-stack>
          </s-section>
          <s-section heading={filter==='vencidos'?'Pendentes vencidos — análise necessária':'Cadastros de empresas'}>
            <s-stack gap="base">
              <s-text-field icon="search" label="Buscar" placeholder="Empresa, local, contato ou CNPJ"
                value={search} onInput={e=>setSearch(e.currentTarget.value)}/>
              <s-stack direction="inline" gap="small-200">
                <s-button variant={filter==='pendente'?'primary':'secondary'} onClick={()=>setFilter('pendente')}>Pendentes</s-button>
                <s-button variant={filter==='vencidos'?'primary':'secondary'} onClick={()=>{setSearch('');setFilter('vencidos');}}>Vencidos ({vencidosPendentes})</s-button>
                <s-button variant={filter==='aprovado_pendente'?'primary':'secondary'} onClick={()=>setFilter('aprovado_pendente')}>Aprovados — acesso pendente</s-button>
                <s-button variant={filter==='aprovado_liberado'?'primary':'secondary'} onClick={()=>setFilter('aprovado_liberado')}>Aprovados — acesso liberado</s-button>
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
              {!loading && !error && filtered.length===0 && <s-text>{filter==='vencidos'?'Nenhum cadastro pendente com prazo vencido.':'Nenhum local encontrado nesse filtro.'}</s-text>}
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
                const prazo=status==='pendente'?calcularPrazoPendente(item,decisions,agora):null;
                return <s-box key={item.id} border="base" borderRadius="base" padding="base">
                  <s-stack gap="base">
                    <s-stack direction="inline" alignItems="center" justifyContent="space-between" gap="base">
                      <s-heading fontSize="large-400">{item.company.name}</s-heading>
                      <s-badge tone={STATUS[status]?.tone||'critical'}>{STATUS[status]?.label||'Revisar'}</s-badge>
                    </s-stack>
                    <s-heading fontSize="large-200">Local: {item.name}</s-heading>
                    <s-heading fontSize="large-200">Cadastro: {formatarDataCadastro(item.createdAt)}</s-heading>
                    {prazo && <s-banner tone={prazo.vencido?'critical':'info'}>{prazo.texto}</s-banner>}
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
                    <s-stack direction="inline" gap="small-200">
                      <s-button variant={status==='pendente'?'primary':'secondary'} disabled={busy} onClick={()=>review(item.id)}>
                        {status==='pendente'?'Analisar cadastro':status==='aprovado_pendente'?'Analisar liberação':'Ver detalhes'}
                      </s-button>
                      {status==='aprovado_liberado' && <s-button variant="secondary" tone="critical" disabled={busy||!validarTravamento(item).ok} onClick={()=>review(item.id,true)}>
                        Travar acesso
                      </s-button>}
                    </s-stack>
                  </s-stack>
                </s-box>;
              })}
            </s-stack>
          </s-section>
        </> : <Detail
          location={selected} decisions={decisions} agora={agora} busy={busy} confirming={confirmingRejection} confirmingLock={confirmingLock}
          onStartRejection={()=>setConfirmingRejection(true)}
          onCancelRejection={()=>setConfirmingRejection(false)}
          onStartLock={()=>setConfirmingLock(true)}
          onCancelLock={()=>setConfirmingLock(false)}
          onBack={()=>{setSelected(null);setError('');setConfirmingRejection(false);setConfirmingLock(false);}}
          onApprove={approve} onRelease={release} onLock={lock} onReject={reject} onReopen={reopen}
        />}
      </s-stack>
    </s-page>
  );
}

function Detail({location,decisions,agora,busy,confirming,confirmingLock,onStartRejection,onCancelRejection,onStartLock,onCancelLock,onBack,onApprove,onRelease,onLock,onReject,onReopen}) {
  const status=statusDoPainel(location,decisions);
  const buyer=selectBuyer(location.company);
  const contact=buyer.ok?buyer.contact.customer:null;
  const orderRole=selectOrderRole(location.company);
  const locking=validarTravamento(location);
  const address=location.billingAddress;
  const telefone=telefoneDoCadastro(location,contact);
  const mensagemTipo=mensagemWhatsAppDoStatus(status);
  const mensagemHref=mensagemTipo ? whatsappMensagemHref(telefone,status) : null;
  const instagram=location.company?.instagram?.value?.trim() || '';
  const instagramHref=instagramParaHref(instagram);
  const segmento=location.company?.segmento?.value?.trim() || '';
  const faturamento=location.company?.faturamento?.value?.trim() || '';
  const cnpjBruto=location.taxSettings?.taxRegistrationId || location.company?.cnpjCadastro?.value;
  const cnpjHref=cnpjParaHref(cnpjBruto);
  const prazoPendente=status==='pendente'?calcularPrazoPendente(location,decisions,agora):null;
  return <s-section heading="Análise do cadastro">
    <s-stack gap="base">
      <s-button variant="tertiary" onClick={onBack} disabled={busy}>Voltar</s-button>
      <s-heading fontSize="large-400">{location.company.name}</s-heading>
      <s-badge tone={status==='aprovado_liberado'?'success':status==='pendente'||status==='aprovado_pendente'?'warning':'critical'}>
        {status==='pendente'?'Pendente de aprovação':status==='aprovado_pendente'?'Aprovado — acesso pendente':status==='aprovado_liberado'?'Aprovado — acesso liberado':status==='reprovado'?'Reprovado no painel':'Revisão necessária'}
      </s-badge>
      {prazoPendente && <s-banner tone={prazoPendente.vencido?'critical':'info'}>{prazoPendente.texto}</s-banner>}
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
            <s-heading fontSize="large-200">Instagram:</s-heading>
            <s-heading fontSize="large-200">{instagram ? (instagramHref ? <s-link href={instagramHref} target="_blank">{instagram}</s-link> : instagram) : 'Não informado'}</s-heading>
          </s-stack>
        </s-stack>
      </s-box>
      {mensagemTipo && <s-box border="base" borderRadius="base" padding="base">
        <s-stack gap="base">
          <s-heading fontSize="large-300">Enviar mensagem padrão</s-heading>
          <s-stack direction="inline" alignItems="center" justifyContent="space-between" gap="base">
            <s-heading fontSize="large-200">{telefone ? formatarTelefone(telefone) : 'Número não informado'}</s-heading>
            {mensagemHref && <s-button variant="primary" href={mensagemHref} target="_blank">Abrir WhatsApp</s-button>}
          </s-stack>
          <s-text color="subdued">WhatsApp com mensagem pré-definida — {mensagemTipo==='reprovacao'?'Reprovação':'Aprovação'}</s-text>
          {!mensagemHref && <s-text>Não foi possível abrir o WhatsApp: confira o número do cliente no cadastro.</s-text>}
        </s-stack>
      </s-box>}
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
          <s-heading fontSize="large-200">Função necessária para compra: Apenas pedidos</s-heading>
          <s-heading fontSize="large-200">Situação: {status==='aprovado_liberado'?'Permissão de compra existente no local':status==='aprovado_pendente'?'Aprovado comercialmente, aguardando liberar pedidos':status==='pendente'?'Aguardando aprovação comercial':status==='reprovado'?'Reprovado somente no painel':'Revisar cadastro'}</s-heading>
        </s-stack>
      </s-box>
      {!buyer.ok && status!=='reprovado' && <s-banner tone="critical">{buyer.reason}</s-banner>}
      {!orderRole && ['pendente','aprovado_pendente'].includes(status) && <s-banner tone="critical">Função "Apenas pedidos" indisponível nesta empresa.</s-banner>}
      {status==='pendente' && buyer.ok && orderRole && <s-banner tone="info">Aprovar cadastro altera somente o status comercial. O cliente NÃO recebe permissão de pedidos ainda.</s-banner>}
      {status==='pendente' && buyer.ok && orderRole && <s-button variant="primary" disabled={busy||confirming} onClick={onApprove}>
        {busy?'Processando...':'Aprovar cadastro'}
      </s-button>}
      {status==='aprovado_pendente' && <s-banner tone="info">Cadastro aprovado, mas sem função de comprador neste local. Use Liberar acesso para permitir pedidos.</s-banner>}
      {status==='aprovado_pendente' && buyer.ok && orderRole && <s-button variant="primary" disabled={busy} onClick={onRelease}>
        {busy?'Liberando...':'Liberar acesso de compra'}
      </s-button>}
      {status==='aprovado_liberado' && <s-banner tone="success">O local possui atribuição de função B2B. O bloqueio depende da revogação confirmada na Shopify.</s-banner>}
      {status==='aprovado_liberado' && !locking.ok && <s-banner tone="critical">Travar indisponível: {locking.reason}</s-banner>}
      {status==='aprovado_liberado' && locking.ok && !confirmingLock && <s-button variant="secondary" tone="critical" disabled={busy} onClick={onStartLock}>
        Travar o acesso
      </s-button>}
      {status==='aprovado_liberado' && locking.ok && confirmingLock && <s-box border="base" borderRadius="base" padding="base">
        <s-stack gap="small-200">
          <s-text>Confirma travar o acesso? A função "Apenas pedidos" deste contato será revogada na Shopify. O cadastro continuará aprovado e voltará para Aprovados — acesso pendente.</s-text>
          <s-stack direction="inline" gap="small-200">
            <s-button variant="primary" tone="critical" disabled={busy} onClick={onLock}>{busy?'Travando...':'Confirmar travamento'}</s-button>
            <s-button variant="secondary" disabled={busy} onClick={onCancelLock}>Cancelar</s-button>
          </s-stack>
        </s-stack>
      </s-box>}
      {status==='reprovado' && <s-banner tone="info">Reprovado apenas no aplicativo. A Shopify não teve permissões alteradas.</s-banner>}
      {podeReprovar(location,decisions) && !confirming && <s-button variant="secondary" tone="critical" disabled={busy} onClick={onStartRejection}>Reprovar cadastro</s-button>}
      {podeReprovar(location,decisions) && confirming && <s-box border="base" borderRadius="base" padding="base">
        <s-stack gap="small-200">
          <s-text>Confirmar reprovação? O cadastro irá para Reprovados sem bloquear o cliente na Shopify.</s-text>
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
