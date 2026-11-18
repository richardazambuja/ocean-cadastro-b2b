// Review/operation IDs, never credentials. UUIDv7 fallback follows RFC 9562 §5.7
// and uses a monotonic 12-bit counter when the extension has no Web Crypto.
export function createUuidGenerator({now=()=>Date.now(),random=()=>Math.random(),cryptoProvider=()=>globalThis.crypto}={}) {
  let lastMs=-1,sequence=0;
  return function uuid() {
    const crypto=cryptoProvider();
    if(typeof crypto?.randomUUID==='function')return crypto.randomUUID();
    const at=now();
    if(!Number.isSafeInteger(at)||at<0||at>0xffffffffffff)throw Error('Relogio invalido para o identificador de analise.');
    if(at>lastMs){lastMs=at;sequence=Math.floor(random()*4096);}
    else if(++sequence>4095){lastMs++;sequence=0;}
    const bytes=new Uint8Array(8);
    if(typeof crypto?.getRandomValues==='function')crypto.getRandomValues(bytes);
    else for(let i=0;i<bytes.length;i++)bytes[i]=Math.floor(random()*256);
    bytes[0]=(bytes[0]&63)|128;
    const time=lastMs.toString(16).padStart(12,'0');
    const tail=Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join('');
    return `${time.slice(0,8)}-${time.slice(8)}-7${sequence.toString(16).padStart(3,'0')}-${tail.slice(0,4)}-${tail.slice(4)}`;
  };
}
export const newUuid=createUuidGenerator();
