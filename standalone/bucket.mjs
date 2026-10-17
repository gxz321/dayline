/** Single-process, single-volume R2 subset. Keys never become file paths. */
import {mkdir, open, readFile, rename, unlink, lstat} from 'node:fs/promises';
import {createHash, randomBytes} from 'node:crypto';
import {resolve, join} from 'node:path';
const digest=value=>createHash('sha256').update(value).digest('hex');
const queues=new Map();
export async function createFileBucket(directory){
  const root=resolve(directory);await mkdir(root,{recursive:true,mode:0o700});
  if((await lstat(root)).isSymbolicLink())throw Error('DATA_DIR must not be a symbolic link');
  const file=key=>{if(typeof key!=='string'||!key||key.length>1000)throw Error('Invalid bucket key');return join(root,digest(key)+'.json');};
  const read=async key=>{try{const value=await readFile(file(key),'utf8');return {etag:digest(value),json:async()=>JSON.parse(value),text:async()=>value};}catch(error){if(error.code==='ENOENT')return null;throw error;}};
  return {get:read,async put(key,input,options={}){
    const value=typeof input==='string'?input:null;if(value===null||Buffer.byteLength(value)>5_000_000)throw Error('Invalid bucket value');
    const previous=queues.get(root)||Promise.resolve();let release;const next=new Promise(done=>{release=done;});queues.set(root,next);await previous;
    let temporary;
    try{
      const old=await read(key),condition=options.onlyIf;
      if(condition instanceof Headers&&condition.get('If-None-Match')==='*'&&old)return null;
      if(condition?.etagMatches&&condition.etagMatches!==old?.etag)return null;
      const target=file(key);temporary=target+'.'+randomBytes(12).toString('hex')+'.tmp';
      const handle=await open(temporary,'wx',0o600);
      try{await handle.writeFile(value,'utf8');await handle.sync();}finally{await handle.close();}
      await rename(temporary,target);temporary=null;
      // Persist the directory entry on filesystems that support directory fsync.
      if(process.platform!=='win32'){const directory=await open(root,'r');try{await directory.sync();}finally{await directory.close();}}
      return {etag:digest(value)};
    }finally{if(temporary)await unlink(temporary).catch(()=>{});release();if(queues.get(root)===next)queues.delete(root);}
  }};
}
