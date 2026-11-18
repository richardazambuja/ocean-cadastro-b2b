// These marks include startup and Preact commit in the extension runtime.
// A remote Shopify host may paint later; never label them browser paint times.
export const APP_HOME_STARTED=Date.now();
const entries=[];
export function recordPanelTiming(entry){
  const item={at:Date.now(),...entry};entries.push(item);if(entries.length>100)entries.shift();
  console.info('[ocean-b2b-panel]',JSON.stringify(item));
  return item;
}
export const panelTimings=()=>entries.map(entry=>({...entry}));
