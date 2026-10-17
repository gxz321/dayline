import {readFile,writeFile,mkdir,rename} from 'node:fs/promises';
import {resolve} from 'node:path';
import {collectAll,compileSnapshot} from '../worker/radar-core.mjs';
import {collectDemand,compileDemandSnapshot} from '../worker/demand-core.mjs';
import {validateRadarResponse} from '../src/lib/radar-validation.js';
import {validateDemandResponse} from '../src/lib/demand.js';
const ROOT=resolve(import.meta.dirname,'..'),HOURS=4*3600000;
const readJSON=async path=>JSON.parse(await readFile(path,'utf8'));
export function pagesBase(repository){
 if(!repository)return null;
 if(!/^[A-Za-z0-9-]+\/[A-Za-z0-9_.-]+$/.test(repository))throw Error('Invalid repository');
 const [owner,name]=repository.split('/');return `https://${owner.toLowerCase()}.github.io/${name.toLowerCase()===owner.toLowerCase()+'.github.io'?'':encodeURIComponent(name)+'/'} ` .trim();
}
async function remotePrevious(base,kind,fetcher){
 if(!base)return null;
 const u=new URL(base);if(u.protocol!=='https:'||!u.hostname.endsWith('.github.io')||u.username||u.password||u.search||u.hash)throw Error('Invalid previous Pages origin');
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),5000);
 try{const response=await fetcher(new URL(`feeds/${kind}.json`,base),{signal:controller.signal,redirect:'error',headers:{Accept:'application/json'}});if(!response.ok)return null;const length=Number(response.headers.get('content-length'));if(length>2000000)return null;const reader=response.body?.getReader();if(!reader)return null;const chunks=[];let size=0;try{while(true){const{value,done}=await reader.read();if(done)break;size+=value.byteLength;if(size>2000000){await reader.cancel();return null;}chunks.push(value);}}finally{reader.releaseLock();}return JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{return null;}finally{clearTimeout(timer);}
}
async function atomic(path,snapshot){await mkdir(resolve(path,'..'),{recursive:true});const temp=path+'.tmp';await writeFile(temp,JSON.stringify(snapshot,null,2)+'\n','utf8');await rename(temp,path);}
export async function updateFeeds({root=ROOT,fetcher=fetch,now=Date.now(),init=false,repository=process.env.GITHUB_REPOSITORY}={}){
 const [sources,topics,demandSources]=await Promise.all(['radar-sources','radar-topics','demand-sources'].map(name=>readJSON(resolve(root,`src/data/${name}.json`))));
 const base=init?null:pagesBase(repository);
 const validators={radar:validateRadarResponse,demand:validateDemandResponse};
 const previous=await Promise.all(['radar','demand'].map(async kind=>{if(init)return null;let value=await remotePrevious(base,kind,fetcher);if(!value){try{value=await readJSON(resolve(root,`public/feeds/${kind}.json`));}catch{return null;}}try{validators[kind](value);return value;}catch{return null;}}));
 const failed=rows=>rows.map(()=>({ok:false,error:init?'尚未执行首次采集':'本轮采集未完成'}));
 const results=init?[failed(sources),failed(demandSources)]:await Promise.all([collectAll(sources,now,fetcher),collectDemand(demandSources,now,fetcher)]);
 const snapshots=[compileSnapshot(results[0],previous[0],sources,topics,now),compileDemandSnapshot(results[1],previous[1],demandSources,now)];
 for(let index=0;index<2;index++){
  const kind=index?'demand':'radar',snapshot=snapshots[index];
  if(init){snapshot.generatedAt=null;snapshot.lastAttemptAt=null;snapshot.nextRefreshAt=null;for(const source of snapshot.sources){if(Object.hasOwn(source,'lastAttemptAt'))source.lastAttemptAt=null;}}
  else snapshot.nextRefreshAt=new Date(Math.max(now+HOURS,Date.parse(snapshot.nextRefreshAt)||0)).toISOString();
  validators[kind](snapshot);await atomic(resolve(root,`public/feeds/${kind}.json`),snapshot);
 }
 return Object.fromEntries(snapshots.map((value,index)=>[index?'demand':'radar',{status:value.status,items:value.items.length,healthySources:value.sources.filter(s=>s.status==='ok').length,lastAttemptAt:value.lastAttemptAt}]));
}
if(process.argv[1]&&resolve(process.argv[1])===resolve(import.meta.filename)){
 const args=process.argv.slice(2);if(args.some(arg=>arg!=='--init'))throw Error('Only --init is supported');
 console.log(JSON.stringify(await updateFeeds({init:args.includes('--init')})));
}
