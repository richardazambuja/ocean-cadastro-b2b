export function deadlineError() {
  return Object.assign(new Error('A Shopify nao confirmou os dados no prazo. Tente atualizar novamente.'),{code:'READ_TIMEOUT'});
}

// The caller stops awaiting the result, and late completions cannot publish it.
// Abort also cancels fetch and removes work still waiting for a request slot.
export function withReadDeadline(read,{timeoutMs=12000,signal}={}) {
  const controller=new AbortController();
  let timer,abort;
  const stopped=new Promise((_,reject)=>{
    abort=()=>{const error=signal?.reason||deadlineError();controller.abort(error);reject(error);};
    if(signal?.aborted)abort();else signal?.addEventListener('abort',abort,{once:true});
    timer=setTimeout(()=>{const error=deadlineError();controller.abort(error);reject(error);},timeoutMs);
  });
  return Promise.race([Promise.resolve().then(()=>{controller.signal.throwIfAborted();return read(controller.signal);}),stopped])
    .finally(()=>{clearTimeout(timer);signal?.removeEventListener('abort',abort);});
}
