import {withReadDeadline} from './read-deadline.mjs';

// One atomic publication includes both the snapshot and its completed UI state.
// Notification work and commercial actions never own these loading flags.
export function createPanelController({read,onChange=()=>{},onSnapshot=()=>{},timeoutMs=12000,clock=()=>Date.now()}={}) {
  let state={snapshot:null,initialLoading:true,refreshing:false,stale:false,error:'',requestId:0,kind:'initial',startedAt:clock(),finishedAt:null};
  let pending=null,active=null,disposed=false;
  const emit=patch=>{state={...state,...patch};if(!disposed)onChange(state);};
  return {
    getState:()=>state,
    load(kind='refresh'){
      if(disposed)return Promise.resolve({ok:false,disposed:true});
      if(pending)return pending;
      active=new AbortController();
      const requestId=state.requestId+1,startedAt=clock();
      emit({requestId,kind:state.snapshot?kind:'initial',startedAt,finishedAt:null,initialLoading:!state.snapshot,refreshing:Boolean(state.snapshot),error:''});
      pending=withReadDeadline(signal=>read({signal}),{timeoutMs,signal:active.signal})
        .then(snapshot=>{
          if(disposed)return {ok:false,disposed:true};
          emit({snapshot,initialLoading:false,refreshing:false,stale:false,error:'',finishedAt:clock()});
          // Scheduling notifications is deliberately outside the read promise.
          try{onSnapshot(snapshot,requestId);}catch{}
          return {ok:true,snapshot};
        },error=>{
          if(disposed)return {ok:false,disposed:true};
          emit({initialLoading:false,refreshing:false,stale:Boolean(state.snapshot),error:error instanceof Error?error.message:'Nao foi possivel confirmar os dados comerciais.',finishedAt:clock()});
          return {ok:false,error};
        }).finally(()=>{pending=null;active=null;});
      return pending;
    },
    dispose(){disposed=true;active?.abort(Object.assign(Error('Painel fechado.'),{code:'PANEL_CLOSED'}));},
  };
}
