import {graphql,LOCATION_FIELDS} from './api.mjs';
import {reviewSnapshotFromNodes} from './reprovados-api.mjs';

export const PANEL_QUERY=`query OceanPanelSnapshot($locationAfter:String,$reviewAfter:String,$withLocations:Boolean!,$withReviews:Boolean!){
  companyLocations(first:50,after:$locationAfter) @include(if:$withLocations){nodes{${LOCATION_FIELDS}}pageInfo{hasNextPage endCursor}}
  metaobjects(type:"$app:cadastro_decisao",first:50,after:$reviewAfter) @include(if:$withReviews){nodes{handle fields{key value}}pageInfo{hasNextPage endCursor}}
}`;

export async function fetchPanelSnapshot({signal}={}){
  const locations=new Map(),records=[];
  let locationAfter=null,reviewAfter=null,withLocations=true,withReviews=true;
  for(let page=0;page<100;page++){
    signal?.throwIfAborted();
    const data=await graphql(PANEL_QUERY,{locationAfter,reviewAfter,withLocations,withReviews},{signal,transport:'fetch'});
    if(withLocations){
      const c=data.companyLocations;
      if(!Array.isArray(c?.nodes)||typeof c.pageInfo?.hasNextPage!=='boolean')throw Error('Consulta das empresas incompleta.');
      for(const l of c.nodes){if(!l?.id)throw Error('Local indisponivel.');locations.set(l.id,l);}
      withLocations=c.pageInfo.hasNextPage;
      if(withLocations&&(!c.pageInfo.endCursor||c.pageInfo.endCursor===locationAfter))throw Error('Paginacao das empresas inconsistente.');
      locationAfter=c.pageInfo.endCursor;
    }
    if(withReviews){
      const c=data.metaobjects;
      if(!Array.isArray(c?.nodes)||typeof c.pageInfo?.hasNextPage!=='boolean')throw Error('Consulta das decisoes comerciais incompleta.');
      records.push(...c.nodes);withReviews=c.pageInfo.hasNextPage;
      if(withReviews&&(!c.pageInfo.endCursor||c.pageInfo.endCursor===reviewAfter))throw Error('Paginacao das decisoes inconsistente.');
      reviewAfter=c.pageInfo.endCursor;
    }
    if(!withLocations&&!withReviews){
      const review=reviewSnapshotFromNodes(records);
      return {locations:[...locations.values()],decisions:review.statuses,reviewDecisions:review.decisions};
    }
  }
  throw Error('Limite de paginas atingido; dados comerciais nao confirmados.');
}

// Publish one complete snapshot. Partial reads never change commercial labels.
export async function loadPanelData({locations,reviews,signal}={}) {
  const started=Date.now();
  let snapshot;
  if(locations&&reviews){
    const [items,review]=await Promise.all([locations(),reviews()]);
    snapshot={locations:items,decisions:review.statuses,reviewDecisions:review.decisions};
  }else snapshot=await fetchPanelSnapshot({signal});
  signal?.throwIfAborted();
  return {...snapshot,loadedAt:Date.now(),ms:Date.now()-started};
}
