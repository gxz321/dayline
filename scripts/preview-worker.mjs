/** Local preview of the actual Worker and persistent public cache. Not shipped to the client. */
import {createServer} from 'node:http';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
const root=resolve(import.meta.dirname,'..');const cache=resolve(root,'../radar-preview-cache');await mkdir(cache,{recursive:true});
const worker=(await import(pathToFileURL(resolve(root,'dist/server/index.js')))).default;
const digest=text=>createHash('sha256').update(text).digest('hex');
let chain=Promise.resolve();
const BUCKET={async get(key){try{const text=await readFile(resolve(cache,key.replaceAll('/','_')),'utf8');return {etag:digest(text),json:async()=>JSON.parse(text)};}catch(e){if(e.code==='ENOENT')return null;throw e;}},async put(key,value,options={}){const previous=chain;let release;chain=new Promise(r=>{release=r;});await previous;try{const old=await this.get(key);const condition=options.onlyIf;if(condition instanceof Headers&&condition.get('If-None-Match')==='*'&&old)return null;if(condition?.etagMatches&&condition.etagMatches!==old?.etag)return null;await writeFile(resolve(cache,key.replaceAll('/','_')),value);return {etag:digest(value)};}finally{release();}}};
const server=createServer(async(req,res)=>{try{const request=new Request(`http://127.0.0.1:5173${req.url}`,{method:req.method,headers:req.headers});const result=await worker.fetch(request,{BUCKET},{waitUntil:promise=>promise.catch(e=>console.error('Background cache update failed',e.message))});res.writeHead(result.status,Object.fromEntries(result.headers));res.end(Buffer.from(await result.arrayBuffer()));}catch(e){console.error(e.message);res.writeHead(500);res.end('Preview request failed');}});
server.listen(5173,'127.0.0.1',()=>console.log('Dayline Worker preview: http://127.0.0.1:5173'));
for(const event of ['SIGINT','SIGTERM'])process.on(event,()=>server.close(()=>process.exit(0)));
