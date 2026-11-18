import test from 'node:test';
import assert from 'node:assert/strict';
import {createUuidGenerator} from '../src/uuid.mjs';
const pattern=/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
test('UUID funciona no runtime sem crypto, inclusive com relogio constante',()=>{
 const uuid=createUuidGenerator({cryptoProvider:()=>undefined,now:()=>1794937335000,random:()=>0.5});
 const ids=Array.from({length:20000},()=>uuid());assert.equal(new Set(ids).size,ids.length);assert.ok(ids.every(x=>pattern.test(x)));assert.deepEqual([...ids].sort(),ids);
});
test('UUID monotono resiste a retrocesso do relogio',()=>{let now=10000;const uuid=createUuidGenerator({cryptoProvider:()=>undefined,now:()=>now,random:()=>0});const a=uuid();now=9000;const b=uuid();assert.ok(b>a);assert.notEqual(a,b);});
test('UUIDv7 confere com vetor publicado no RFC 9562',()=>{const uuid=createUuidGenerator({now:()=>1645557742000,random:()=>0xcc3/4096,cryptoProvider:()=>({getRandomValues:bytes=>bytes.set([0x18,0xc4,0xdc,0x0c,0x0c,0x07,0x39,0x8f])})});assert.equal(uuid(),'017f22e2-79b0-7cc3-98c4-dc0c0c07398f');});
test('UUID usa randomUUID nativo quando disponivel',()=>{const uuid=createUuidGenerator({cryptoProvider:()=>({randomUUID:()=> 'native-uuid'})});assert.equal(uuid(),'native-uuid');});
