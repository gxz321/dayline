import {IS_PAGES,APP_BASE,storageKey,pagesChatStatus} from './deployment.js';
import {validateChatStatus} from './chat-client.js';
import {readRuntimeSession} from './runtime-session.js';

export const ASSISTANT_CONNECTION_WAIT_MS=45000;
const SESSION_KEY=storageKey('assistant-session-v1');
const ROUTES={status:'status',session:'session',login:'login',logout:'logout',chat:'chat'};
let configuredOrigin,memorySession;
export function validateServiceConfig(value){
  if(!value||value.schemaVersion!==1||!Object.hasOwn(value,'origin')||Object.keys(value).some(k=>!['schemaVersion','origin'].includes(k)))throw Error('助手连接配置无效。');
  if(value.origin===null)return null;
  if(typeof value.origin!=='string'||value.origin.length>500)throw Error('助手地址无效。');
  const u=new URL(value.origin);
  if(u.protocol!=='https:'||u.username||u.password||u.search||u.hash||u.pathname!=='/'||u.port||u.hostname==='localhost'||u.hostname.endsWith('.localhost')||!u.hostname.includes('.')||/^\d+(?:\.\d+){3}$/.test(u.hostname))throw Error('助手需要有效的 HTTPS 地址。');
  return u.origin;
}
async function json(response,max=24000){const value=await response.text();if(value.length>max)throw Error('助手返回内容过长。');return JSON.parse(value);}
async function serviceOrigin(signal,force=false){
  if(configuredOrigin!==undefined&&!force)return configuredOrigin;
  const response=await fetch(`${APP_BASE}chat-service.json`,{credentials:'omit',cache:'no-store',redirect:'error',signal,headers:{Accept:'application/json'}});
  if(!response.ok)throw Error('暂时无法读取助手连接配置。');
  const origin=validateServiceConfig(await json(response,2048));
  if(configuredOrigin!==undefined&&configuredOrigin!==origin)clearSession();
  configuredOrigin=origin;return origin;
}
function clearSession(){memorySession=null;try{globalThis.sessionStorage?.removeItem(SESSION_KEY);}catch{}}
function getSession(origin){
  if(memorySession===undefined){try{memorySession=JSON.parse(globalThis.sessionStorage?.getItem(SESSION_KEY)||'null');}catch{memorySession=null;}}
  const s=memorySession;if(!s||s.origin!==origin||!Number.isFinite(s.expiresAt)||s.expiresAt<=Date.now()||typeof s.accessToken!=='string'||!/^[A-Za-z0-9_-]{43}\.[A-Za-z0-9_-]{43}$/.test(s.accessToken)){clearSession();return null;}return s;
}
export async function assistantFetch(route,options={}){
  if(!Object.hasOwn(ROUTES,route))throw Error('未知助手操作。');
  if(!IS_PAGES)return fetch(route==='status'?'/api/chat/status':`/api/${route}`,{...options,credentials:'same-origin',cache:'no-store'});
  const origin=await serviceOrigin(options.signal);if(!origin)throw Error('私人助手服务尚未连接。');
  const headers=new Headers(options.headers);headers.set('Accept','application/json');const session=getSession(origin);
  if(session)headers.set('Authorization',`Bearer ${session.accessToken}`);
  const response=await fetch(`${origin}/bridge/${route}`,{...options,headers,credentials:'omit',cache:'no-store',redirect:'error'});
  if(response.status===401)clearSession();return response;
}
export async function readAssistantConnection(signal,{force=false}={}){
  if(IS_PAGES&&!await serviceOrigin(signal,force))return {session:{mode:'pages',authenticated:false,configured:false},status:pagesChatStatus()};
  const [response,session]=await Promise.all([assistantFetch('status',{signal}),IS_PAGES?assistantFetch('session',{signal}).then(async r=>{if(!r.ok)throw Error('无法读取登录状态。');const s=await json(r);if(s.mode!=='bridge'||typeof s.authenticated!=='boolean'||typeof s.configured!=='boolean')throw Error('助手登录状态无效。');return {mode:'bridge',authenticated:s.authenticated,configured:s.configured};}):readRuntimeSession(signal).catch(()=>({mode:'unknown',authenticated:false,configured:false}))]);
  if(!response.ok)throw Error('暂时无法读取服务状态。');
  return {session,status:validateChatStatus(await json(response))};
}
export async function assistantLogin(password,signal){
  const response=await assistantFetch('login',{method:'POST',signal,headers:{'Content-Type':'application/json'},body:JSON.stringify({password})});
  if(response.ok&&IS_PAGES){const value=await json(response,2048);const origin=await serviceOrigin(signal);if(!value.ok||typeof value.accessToken!=='string'||!/^[A-Za-z0-9_-]{43}\.[A-Za-z0-9_-]{43}$/.test(value.accessToken)||!Number.isFinite(value.expiresAt)||value.expiresAt<=Date.now()||value.expiresAt>Date.now()+8*86400000)throw Error('登录返回格式无效。');memorySession={origin,accessToken:value.accessToken,expiresAt:value.expiresAt};try{globalThis.sessionStorage?.setItem(SESSION_KEY,JSON.stringify(memorySession));}catch{}}
  return response;
}
export async function assistantLogout(signal){try{return await assistantFetch('logout',{method:'POST',signal,headers:{'Content-Type':'application/json'},body:'{}'});}finally{clearSession();}}
