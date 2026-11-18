import {deadlineError} from './read-deadline.mjs';

export function transientFailure(error) {
  return [429,502,503,504].includes(Number(error?.status)) ||
    ['THROTTLED','SERVICE_UNAVAILABLE','INTERNAL_SERVER_ERROR'].includes(error?.code) ||
    /\b(429|502|503|504|THROTTLED)\b/.test(error?.message || '');
}

export function createRequestControl({limit=2,intervalMs=100,readTimeoutMs=8000,sleep=ms=>new Promise(r=>setTimeout(r,ms)),clock=()=>Date.now(),random=Math.random,onMetric=()=>{}}={}) {
  let active=0,backgroundActive=0,nextStart=0,pausedUntil=0;
  const pending=[];
  function pump(){
    pending.sort((a,b)=>Number(a.background)-Number(b.background));
    while(active<limit&&pending.length){
      // Keep capacity for a visual read while a background request is slow.
      const index=pending.findIndex(job=>!job.background||backgroundActive<Math.max(1,limit-1));
      if(index<0)return;
      const job=pending.splice(index,1)[0];job.cleanup();
      if(job.signal?.aborted){job.reject(job.signal.reason);continue;}
      active++;if(job.background)backgroundActive++;
      let released=false;
      job.resolve(()=>{if(released)return;released=true;active--;if(job.background)backgroundActive--;pump();});
    }
  }
  function slot(background,signal){
    return new Promise((resolve,reject)=>{
      if(signal?.aborted){reject(signal.reason);return;}
      const job={background,signal,resolve,reject,cleanup:()=>signal?.removeEventListener('abort',abort)};
      const abort=()=>{const index=pending.indexOf(job);if(index>=0)pending.splice(index,1);job.cleanup();reject(signal.reason);};
      signal?.addEventListener('abort',abort,{once:true});pending.push(job);pump();
    });
  }
  return async function request(query,variables={}, {background=false,signal,transport='sdk'}={}){
    const mutation=/^\s*mutation\b/.test(query);
    const operation=query.match(/(?:query|mutation)\s+(\w+)/)?.[1]||'anonymous';
    for(let attempt=0;attempt<3;attempt++){
      signal?.throwIfAborted();
      const queuedAt=clock(),releaseSlot=await slot(background,signal);
      const scheduled=Math.max(clock(),nextStart,pausedUntil);
      nextStart=scheduled+intervalMs;
      const controller=new AbortController();
      let started,timer,aborted,lateRelease=false,settled=false;
      const abort=()=>controller.abort(signal.reason);
      signal?.addEventListener('abort',abort,{once:true});
      try{
        const stopped=new Promise((_,reject)=>{
          aborted=()=>reject(controller.signal.reason||deadlineError());
          controller.signal.addEventListener('abort',aborted,{once:true});
          if(!mutation)timer=setTimeout(()=>controller.abort(deadlineError()),readTimeoutMs);
        });
        const perform=async()=>{
          if(scheduled>clock())await sleep(scheduled-clock());
          controller.signal.throwIfAborted();started=clock();
          if(transport==='fetch'){
            const response=await fetch('shopify:admin/api/2026-10/graphql.json',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({query,variables}),signal:controller.signal});
            if(!response.ok)throw Object.assign(Error(`Failed to query Admin API: ${response.status}`),{status:response.status});
            return response.json();
          }
          return shopify.query(query,{variables,version:'2026-10'});
        };
        const underlying=Promise.resolve().then(perform);
        // SDK promises cannot be cancelled. Retain their physical slot until
        // settlement, even if the UI deadline has already rejected the read.
        underlying.then(()=>{settled=true;if(lateRelease)releaseSlot();},()=>{settled=true;if(lateRelease)releaseSlot();});
        let result;
        try{result=await Promise.race([underlying,stopped]);}
        catch(error){if(controller.signal.aborted&&transport==='sdk'&&!settled)lateRelease=true;throw error;}
        const cost=result?.extensions?.cost,throttle=cost?.throttleStatus;
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
        if(mutation||controller.signal.aborted||!transientFailure(cause)||attempt===2)throw cause;
        const delay=Math.min(4000,500*2**attempt)+Math.floor(random()*200);
        // A background failure must not pause foreground work's retry budget.
        if(background)await sleep(delay);else pausedUntil=Math.max(pausedUntil,clock()+delay);
      }finally{
        clearTimeout(timer);signal?.removeEventListener('abort',abort);controller.signal.removeEventListener('abort',aborted);
        if(!lateRelease)releaseSlot();
      }
    }
  };
}

const metrics=[];
export const requestMetrics=()=>metrics.map(x=>({...x}));
export const controlledRequest=createRequestControl({onMetric:entry=>{metrics.push(entry);if(metrics.length>500)metrics.shift();}});
