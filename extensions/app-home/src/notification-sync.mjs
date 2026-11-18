// Coalesce overlapping refreshes; at most two workers, one job per location.
// A failed job is reported once. There is no timer that retries forever.
export async function synchronizeLocations(locations,work,{concurrency=2,maxJobs=20}={}) {
  const unique=[...new Map(locations.map(l=>[l.id,l])).values()];
  const warnings=[];
  let cursor=0;
  await Promise.all(Array.from({length:Math.min(concurrency,unique.length)},async()=>{
    while(cursor<Math.min(unique.length,maxJobs)){
      const local=unique[cursor++];
      try{await work(local);}catch(error){warnings.push(`${local.id}: ${error.message}`);}
    }
  }));
  if(unique.length>maxJobs)warnings.push(`${unique.length-maxJobs} locais aguardam uma proxima sincronizacao; limite por passagem atingido.`);
  return warnings;
}

export function createSyncScheduler(sync,{schedule=fn=>setTimeout(fn,0),onStatus=()=>{}}={}) {
  let running=false,pending=null,disposed=false;
  async function drain(){
    if(running||disposed)return;
    running=true;
    onStatus('running');
    try{
      while(pending&&!disposed){
        const {snapshot,onResult}=pending;pending=null;
        try{const warnings=await sync(snapshot);if(!disposed)onResult(warnings);}
        catch(error){if(!disposed)onResult([error.message]);}
      }
    }finally{running=false;if(!disposed)onStatus('idle');}
  }
  return {
    enqueue(snapshot,onResult=()=>{}){if(disposed)return;pending={snapshot,onResult};schedule(()=>void drain());},
    dispose(){disposed=true;pending=null;},
  };
}
