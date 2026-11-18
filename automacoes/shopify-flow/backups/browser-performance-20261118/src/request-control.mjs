// Shared by foreground reads and background reconciliation. Never replay a
// mutation here: its caller must first verify the persisted result.
export function transientFailure(error) {
  return [429,502,503,504].includes(Number(error?.status)) ||
    ['THROTTLED','SERVICE_UNAVAILABLE','INTERNAL_SERVER_ERROR'].includes(error?.code) ||
    /\b(429|502|503|504|THROTTLED)\b/.test(error?.message || '');
}

export function createRequestControl({limit=2,intervalMs=100,sleep=ms=>new Promise(r=>setTimeout(r,ms)),clock=()=>Date.now(),random=Math.random,onMetric=()=>{}}={}) {
  let active=0,nextStart=0,pausedUntil=0;
  const pending=[];
  function release(){active--;pump();}
  function pump(){
    while(active<limit&&pending.length){
      pending.sort((a,b)=>Number(a.background)-Number(b.background));
      active++;pending.shift().resolve(release);
    }
  }
  async function slot(background){return new Promise(resolve=>{pending.push({background,resolve});pump();});}
  return async function request(query,variables={}, {background=false}={}){
    const mutation=/^\s*mutation\b/.test(query);
    const operation=query.match(/(?:query|mutation)\s+(\w+)/)?.[1]||'anonymous';
    for(let attempt=0;attempt<3;attempt++){
      const releaseSlot=await slot(background);
      const scheduled=Math.max(clock(),nextStart,pausedUntil);
      nextStart=scheduled+intervalMs;
      const queuedAt=clock();
      let started;
      try{
        if(scheduled>clock())await sleep(scheduled-clock());
        started=clock();
        const result=await shopify.query(query,{variables,version:'2026-10'});
        const cost=result?.extensions?.cost;
        const throttle=cost?.throttleStatus;
        if(throttle?.restoreRate>0){
          const reserve=Math.min(throttle.maximumAvailable||1000,Math.max(100,cost.requestedQueryCost||0));
          if(throttle.currentlyAvailable<reserve)pausedUntil=Math.max(pausedUntil,clock()+Math.ceil((reserve-throttle.currentlyAvailable)/throttle.restoreRate*1000));
        }
        if(result?.errors?.length)throw Object.assign(new Error(result.errors.map(e=>e.message).join('; ')),{code:result.errors[0]?.extensions?.code});
        if(!result?.data)throw Error('Resposta GraphQL sem dados. Confira os escopos do app.');
        onMetric({operation,mutation,background,attempt:attempt+1,ms:clock()-started,queueMs:started-queuedAt,ok:true,cost:cost?.actualQueryCost});
        return result.data;
      }catch(cause){
        onMetric({operation,mutation,background,attempt:attempt+1,ms:started===undefined?0:clock()-started,ok:false,code:cause.code||null});
        if(mutation||!transientFailure(cause)||attempt===2)throw cause;
        const delay=Math.min(4000,500*2**attempt)+Math.floor(random()*200);
        pausedUntil=Math.max(pausedUntil,clock()+delay);
      }finally{releaseSlot();}
    }
  };
}

const metrics=[];
export const requestMetrics=()=>metrics.map(x=>({...x}));
export const controlledRequest=createRequestControl({onMetric:entry=>{metrics.push(entry);if(metrics.length>500)metrics.shift();}});
