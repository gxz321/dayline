import {IS_PAGES,APP_BASE} from './deployment.js';
export function validateRuntimeSession(value) {
  if (!value || value.mode !== 'standalone' || typeof value.authenticated !== 'boolean' || typeof value.configured !== 'boolean') throw new Error('站点登录状态无效。');
  return {mode:'standalone',authenticated:value.authenticated,configured:value.configured};
}
export async function readRuntimeSession(signal) {
  if(IS_PAGES)return {mode:'pages',authenticated:false,configured:false};
  const response=await fetch('/api/session',{credentials:'same-origin',cache:'no-store',signal});
  if(!response.ok) return {mode:globalThis.location?.hostname?.endsWith('.chatgpt.site')?'sites':'unknown',authenticated:false,configured:false};
  return validateRuntimeSession(await response.json());
}
let mode;
async function runtimeMode(signal) {
  if(mode) return mode;
  const session=await readRuntimeSession(signal);
  mode=session.mode;
  return mode;
}
export async function fetchPublicFeed(kind,{refresh=false,signal}={}) {
  if(!['radar','demand'].includes(kind)) throw new Error('未知的资料类型。');
  if(IS_PAGES){
    const response=await fetch(`${APP_BASE}feeds/${kind}.json`,{signal,credentials:'omit',cache:'no-store',headers:{Accept:'application/json'}});
    if(!response.ok)return response;
    const text=await response.text();if(text.length>2000000)throw new Error('资料超过安全读取范围。');
    const data=JSON.parse(text),latest=Date.parse(data.lastAttemptAt||data.generatedAt||'');
    if(['fresh','partial'].includes(data.status)&&(!Number.isFinite(latest)||Date.now()-latest>4*3600000))data.status='stale';
    return new Response(JSON.stringify(data),{status:response.status,headers:{'Content-Type':'application/json'}});
  }
  const standalone=await runtimeMode(signal)==='standalone';
  const url=standalone&&refresh?`/api/refresh/${kind}`:`/api/${kind}${refresh&&kind==='demand'?'?wait=1':''}`;
  const response=await fetch(url,{signal,credentials:'same-origin',cache:'no-store',headers:{Accept:'application/json',...(standalone&&refresh?{'Content-Type':'application/json'}:{})},...(standalone&&refresh?{method:'POST',body:'{}'}:{})});
  if(response.status===401) throw new Error('请先到助手中登录，再检查更新。');
  if(response.status===429) throw new Error('更新正在进行或仍处于冷却时间，请稍后检查。');
  return response;
}
