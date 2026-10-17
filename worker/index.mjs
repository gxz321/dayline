import {browserChatResponse} from './chat.mjs';
import {DEMAND_ALGORITHM_VERSION} from './demand-core.mjs';
import {RADAR_INTERVAL_MS,compileSnapshot,collectAll} from './radar-core.mjs';
import {mcpResponse} from './mcp.mjs';
import {demandResponse} from './demand-cache.mjs';
import {telegramResponse,telegramConfigurationStatus} from './telegram.mjs';
import sources from '../src/data/radar-sources.json' with {type:'json'};
import topics from '../src/data/radar-topics.json' with {type:'json'};
const SNAPSHOT_KEY='radar/snapshot-v1.json';
const LEASE_KEY='radar/lease-v1.json';
const inflight=new Map();
const daylineAssetBytes=new Map();
async function readSnapshot(bucket){const object=await bucket.get(SNAPSHOT_KEY);if(!object)return null;const data=await object.json();return data?.schemaVersion===1&&Array.isArray(data.items)?data:null;}
function emptySnapshot(message){return {schemaVersion:1,generatedAt:null,lastAttemptAt:null,nextRefreshAt:null,status:'unavailable',items:[],sources:sources.map(s=>({id:s.id,name:s.name,url:s.url,status:'error',lastSuccessAt:null,itemCount:0,error:message})),topics:topics.map(({keywords,accessScore,...t})=>t),meta:{intervalHours:1,scheduledIntervalHours:4,algorithmVersion:'1.0',scoreMeaning:'阅读与验证优先级，非盈利概率',error:message}};}
function servedSnapshot(snapshot,now,refreshing=false){const stale=!snapshot?.generatedAt||now-Date.parse(snapshot.generatedAt)>RADAR_INTERVAL_MS;return {...snapshot,status:snapshot.status==='unavailable'?'unavailable':stale?'stale':snapshot.status,meta:{...snapshot.meta,refreshing}};}
async function refresh(bucket,old,now){
  const lease=await bucket.get(LEASE_KEY);let last=0;if(lease){try{last=Number((await lease.json()).attemptedAt)||0;}catch{}}
  if(now-last<RADAR_INTERVAL_MS)return {...(old||emptySnapshot('另一轮采集尚未完成，请稍后检查')),nextRefreshAt:new Date(last+RADAR_INTERVAL_MS).toISOString()};
  // R2 conditional write admits one collector across isolates; expiry also limits failed attempts.
  const granted=await bucket.put(LEASE_KEY,JSON.stringify({attemptedAt:now}),{onlyIf:lease?{etagMatches:lease.etag}:new Headers({'If-None-Match':'*'}),httpMetadata:{contentType:'application/json'}});
  if(!granted)return old||emptySnapshot('另一轮采集尚未完成，请稍后检查');
  const results=await collectAll(sources,now);const snapshot=compileSnapshot(results,old,sources,topics,now);
  await bucket.put(SNAPSHOT_KEY,JSON.stringify(snapshot),{httpMetadata:{contentType:'application/json',cacheControl:'no-store'}});
  return snapshot;
}
export async function radarResponse(request,env,ctx){
  const headers={'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'};
  if(request.method!=='GET')return new Response(JSON.stringify({error:'只允许读取公开雷达'}),{status:405,headers:{...headers,Allow:'GET'}});
  const u=new URL(request.url);if([...u.searchParams.keys()].some(k=>k!=='wait')||u.searchParams.has('wait')&&u.searchParams.get('wait')!=='1')return new Response(JSON.stringify({error:'不接受自定义来源或采集参数'}),{status:400,headers});
  const bucket=env.BUCKET;if(!bucket?.get||!bucket?.put)return new Response(JSON.stringify(emptySnapshot('共享信息存储尚未配置，未启动采集')),{status:503,headers});
  try{const now=Date.now();const old=await readSnapshot(bucket);const due=!old?.lastAttemptAt||now-Date.parse(old.lastAttemptAt)>=RADAR_INTERVAL_MS;
    if(!due)return new Response(JSON.stringify(servedSnapshot(old,now)),{headers});
    let promise=inflight.get(bucket);if(!promise){promise=refresh(bucket,old,now).finally(()=>inflight.delete(bucket));inflight.set(bucket,promise);}
    if(old&&u.searchParams.get('wait')!=='1'&&ctx?.waitUntil){ctx.waitUntil(promise.catch(()=>{}));return new Response(JSON.stringify(servedSnapshot(old,now,true)),{headers});}
    return new Response(JSON.stringify(servedSnapshot(await promise,Date.now())),{headers});
  }catch{return new Response(JSON.stringify(emptySnapshot('共享存储或采集暂不可用，稍后重试')),{status:503,headers});}
}
export default {async fetch(request,env,ctx){const url=new URL(request.url);if(url.pathname==='/api/chat'||url.pathname==='/api/chat/status')return browserChatResponse(request,env);if(url.pathname==='/mcp')return mcpResponse(request,env,ctx,radarResponse,demandResponse);if(url.pathname==='/api/demand')return demandResponse(request,env,ctx);if(url.pathname==='/api/telegram/webhook')return telegramResponse(request,env,ctx,{radarResponse,demandResponse});if(url.pathname==='/api/radar')return radarResponse(request,env,ctx);if(url.pathname==='/api/health')return Response.json({app:'Dayline',radar:'1.0.1',demand:DEMAND_ALGORITHM_VERSION,storage:!!env.BUCKET,telegram:telegramConfigurationStatus(env)});if(request.method!=='GET'&&request.method!=='HEAD')return new Response('Method Not Allowed',{status:405});const path=url.pathname==='/'?'/index.html':url.pathname;const asset=ASSETS[path];if(!asset)return new Response('Not Found',{status:404});let bytes=null;if(request.method!=='HEAD'){bytes=daylineAssetBytes.get(path);if(!bytes){bytes=Uint8Array.from(atob(asset.data),c=>c.charCodeAt(0));daylineAssetBytes.set(path,bytes);}}return new Response(request.method==='HEAD'?null:bytes,{headers:{'content-type':asset.type,'cache-control':path.startsWith('/assets/')?'public, max-age=31536000, immutable':'no-cache','x-content-type-options':'nosniff','referrer-policy':'strict-origin-when-cross-origin'}});}};
