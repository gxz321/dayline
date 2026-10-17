#!/usr/bin/env node
/** One-shot fixed public scan. Local lock, cooldown and atomic outputs; no model key. */
import {readFile,mkdir,writeFile,rename,open,unlink,copyFile} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {collectDemand,compileDemandSnapshot,normalizeDemandSnapshot,DEMAND_ALGORITHM_VERSION} from '../worker/demand-core.mjs';
const scanRoot=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const scanHelp='node scripts/scan-demand.mjs --output <snapshot.json> [--changes <changes.ndjson>]\n固定6个公开查询；一次运行后退出。已新鲜时复用缓存，已有实例时跳过。';
async function scanAtomic(path,value){await mkdir(dirname(path),{recursive:true});const temporary=`${path}.${process.pid}.tmp`;await writeFile(temporary,value,{encoding:'utf8',mode:0o600});await rename(temporary,path);}
export async function runDemandScan(args,options={}){
  if(args.length===1&&args[0]==='--help')return {help:scanHelp,exitCode:0};
  let output=null,changes=null;
  for(let i=0;i<args.length;i++){
    const argument=args[i];if(!['--output','--changes'].includes(argument)||!args[i+1]||args[i+1].startsWith('--'))throw new Error('使用 --output <path>，可选 --changes <path>');
    const value=resolve(args[++i]);if(argument==='--output'){if(output)throw new Error('--output不能重复');output=value;}else{if(changes)throw new Error('--changes不能重复');changes=value;}
  }
  if(!output||changes===output)throw new Error('必须指定快照文件；snapshot与changes不能是相同文件');
  await mkdir(dirname(output),{recursive:true});
  const lockPath=`${output}.scan.lock`;let lock;
  try{lock=await open(lockPath,'wx',0o600);await lock.writeFile(JSON.stringify({kind:'dayline-demand-scan',pid:process.pid,createdAt:new Date().toISOString()}));}
  catch(e){if(lock){await lock.close().catch(()=>{});await unlink(lockPath).catch(()=>{});}if(e.code==='EEXIST')return {skipped:true,reason:'已有扫描锁；不启动重复实例。若上次异常退出，先确认进程结束再移除锁。',output,exitCode:0};throw e;}
  try{
    const now=options.now??Date.now();let previous=null,previousVersion=null;
    try{const raw=await readFile(output,'utf8');if(raw.length>2000000)throw new Error('Snapshot too large');const parsed=JSON.parse(raw);previous=normalizeDemandSnapshot(parsed,now);previousVersion=parsed.meta?.algorithmVersion;if(!previous)throw new Error('Invalid snapshot');}
    catch(e){if(e.code!=='ENOENT')await copyFile(output,`${output}.invalid-${now}`).catch(()=>{});}
    if(previous&&previousVersion===DEMAND_ALGORITHM_VERSION&&now<Date.parse(previous.nextRefreshAt||0)){
      if(changes)await scanAtomic(changes,'');
      return {status:previous.status,reused:true,generatedAt:previous.generatedAt,nextRefreshAt:previous.nextRefreshAt,items:previous.items.length,new:0,changed:0,output,exitCode:previous.meta.successfulSources?0:2};
    }
    const sources=JSON.parse(await readFile(resolve(scanRoot,'src/data/demand-sources.json'),'utf8'));
    const results=await collectDemand(sources,now,options.fetcher??fetch);
    const snapshot=compileDemandSnapshot(results,previous,sources,now);
    await scanAtomic(output,`${JSON.stringify(snapshot,null,2)}\n`);
    if(changes){const events=snapshot.items.filter(i=>i.change==='new'||i.change==='changed').map(i=>({id:i.id,title:i.title,url:i.url,change:i.change,action:i.action,paymentEvidence:i.paymentEvidence,closed:i.closed,intentScore:i.intentScore,deadlineAt:i.deadlineAt,generatedAt:snapshot.generatedAt}));await scanAtomic(changes,events.map(i=>JSON.stringify(i)).join('\n')+(events.length?'\n':''));}
    return {status:snapshot.status,sources:snapshot.meta.successfulSources,totalSources:sources.length,items:snapshot.items.length,new:snapshot.meta.newCount,changed:snapshot.meta.changedCount,verify:snapshot.meta.actionableCount,output,exitCode:snapshot.meta.successfulSources?0:2};
  }finally{await lock.close();await unlink(lockPath);}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{const result=await runDemandScan(process.argv.slice(2));console.log(result.help||JSON.stringify(result));process.exitCode=result.exitCode;}
  catch{console.error('需求扫描未完成；检查固定来源、输出路径、权限和已有扫描锁。');process.exitCode=2;}
}
