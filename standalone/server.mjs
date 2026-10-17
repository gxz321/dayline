/** Node 24 adapter for the same built Worker. Deploy one process and one persistent disk. */
import {createServer} from 'node:http';
import {mkdir,open,unlink} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createFileBucket} from './bucket.mjs';
import {createAuth} from './auth.mjs';
const ROOT=resolve(import.meta.dirname,'..'),OWNER='dayline-standalone-owner';
const JSON_HEADERS={'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'};
const json=(value,status=200,headers={})=>Response.json(value,{status,headers:{...JSON_HEADERS,...headers}});
export function standaloneConfig(env={}){
  const production=env.NODE_ENV==='production',host=env.HOST||'127.0.0.1',port=env.PORT==null?3000:Number(env.PORT);
  if(!Number.isInteger(port)||port<0||port>65535||production&&port===0)throw Error('Invalid PORT');
  if(['WEB_CONCURRENCY','NODE_APP_INSTANCE','INSTANCE_ID'].some(key=>env[key]&&env[key]!=='1'&&env[key]!=='0')||env.NODE_UNIQUE_ID||env.pm_id)throw Error('Multiple instances are unsupported');
  let origin=null;
  if(env.PUBLIC_ORIGIN){let u;try{u=new URL(env.PUBLIC_ORIGIN);}catch{throw Error('Invalid PUBLIC_ORIGIN');}if(u.href!==u.origin+'/'||u.username||u.password||u.search||u.hash||u.protocol!=='https:'&&!(u.protocol==='http:'&&['127.0.0.1','localhost','[::1]'].includes(u.hostname)))throw Error('PUBLIC_ORIGIN must be an exact HTTPS origin');origin=u.origin;}
  if(production&&(!origin||!origin.startsWith('https://')))throw Error('Production requires PUBLIC_ORIGIN=https://your-domain');
  if(!production&&!origin&&!['127.0.0.1','localhost','::1'].includes(host))throw Error('Non-loopback hosting requires PUBLIC_ORIGIN');
  return {production,host,port,origin,dataDir:resolve(env.DATA_DIR||resolve(import.meta.dirname,'.data')),autoRefresh:env.AUTO_REFRESH==='true',passwordHash:env.STANDALONE_PASSWORD_HASH,sessionSecret:env.STANDALONE_SESSION_SECRET};
}
export function stripSitesHeaders(input){const headers=new Headers();for(const[key,value]of new Headers(input)){const lower=key.toLowerCase();if(lower.startsWith('oai-authenticated-user-')||lower==='oai-sites-authorization'||lower.startsWith('x-forwarded-')||lower==='forwarded'||lower==='host')continue;headers.set(key,value);}return headers;}
async function readBody(request,max=60000){
  if(Number(request.headers['content-length'])>max)throw Object.assign(Error('body too large'),{status:413});
  return new Promise((done,reject)=>{let size=0,ended=false;const parts=[];
    const finish=(error,value)=>{if(ended)return;ended=true;clearTimeout(timer);request.off('data',data);request.off('end',end);request.off('error',fail);request.off('aborted',abort);if(error){request.resume();reject(error);}else done(value);};
    const data=part=>{size+=part.length;if(size>max)finish(Object.assign(Error('body too large'),{status:413}));else parts.push(part);};
    const end=()=>finish(null,Buffer.concat(parts)),fail=()=>finish(Object.assign(Error('request failed'),{status:400})),abort=()=>finish(Object.assign(Error('request aborted'),{status:400}));
    const timer=setTimeout(()=>finish(Object.assign(Error('request timeout'),{status:408})),5000);request.on('data',data);request.on('end',end);request.on('error',fail);request.on('aborted',abort);
  });
}
async function jsonBody(request,max=2048){if(!String(request.headers['content-type']||'').toLowerCase().startsWith('application/json'))throw Object.assign(Error('JSON required'),{status:415});const bytes=await readBody(request,max);try{return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}catch{throw Object.assign(Error('Invalid JSON'),{status:400});}}
function sameOrigin(headers,origin){return headers.get('origin')===origin&&headers.get('sec-fetch-site')!=='cross-site';}
async function unavailable(worker,kind,message,autoRefresh,status=200){
  // The canonical no-storage response returns before any collection and gets
  // neither a bucket nor provider credentials. Preserve its frontend schema.
  const response=await worker.fetch(new Request(`https://standalone.invalid/api/${kind}`),{},{});
  const snapshot=await response.json();
  return json({...snapshot,sources:snapshot.sources.map(source=>({...source,error:message})),meta:{...snapshot.meta,...(kind==='radar'?{scheduledIntervalHours:autoRefresh?4:0}:{}),readOnly:true,refreshing:false,error:message}},status);
}
async function cached(bucket,kind,worker,autoRefresh){
  try{const object=await bucket.get(`${kind}/snapshot-v1.json`);if(object){const snapshot=await object.json();if(snapshot?.schemaVersion!==1||!Array.isArray(snapshot.items)||!Array.isArray(snapshot.sources)||kind==='radar'&&!Array.isArray(snapshot.topics)||!snapshot.meta)throw Error('Invalid cached snapshot');const stale=!snapshot.generatedAt||Date.now()-Date.parse(snapshot.generatedAt)>3600000;return json({...snapshot,status:stale&&snapshot.status!=='unavailable'?'stale':snapshot.status,meta:{...snapshot.meta,...(kind==='radar'?{scheduledIntervalHours:autoRefresh?4:0}:{}),refreshing:false,readOnly:true}});}}
  catch{return unavailable(worker,kind,'持久缓存暂不可用，未启动采集；请检查数据磁盘。',autoRefresh,503);}
  return unavailable(worker,kind,'新站点尚未采集；请登录后更新。新部署不会继承旧站点的定时任务。',autoRefresh);
}
export async function createStandaloneServer({env={},worker,bucket,now=Date.now}={}){
  const config=standaloneConfig(env);if(!worker?.fetch)throw Error('Built Worker required');bucket??=await createFileBucket(config.dataDir);
  const auth=createAuth({...config,secure:config.production||config.origin?.startsWith('https:'),now});
  // No client can choose the internal owner identity or retain a Sites allowlist.
  const runtimeEnv={...env,BUCKET:bucket,CHAT_ALLOWED_USER_IDS:OWNER,CHAT_ALLOWED_EMAILS:'',CHAT_DAILY_LIMIT:'20',CHAT_MAX_OUTPUT_TOKENS:'800'};
  if(!auth.configured){runtimeEnv.CHAT_ENABLED='false';runtimeEnv.OPENAI_API_KEY=undefined;runtimeEnv.DASHSCOPE_API_KEY=undefined;runtimeEnv.TELEGRAM_ENABLED='false';}
  const pending=new Set();const ctx={waitUntil(promise){pending.add(promise);promise.catch(()=>{}).finally(()=>pending.delete(promise));}};
  let autoTimer=null,refreshBusy=false;
  const originFor=()=>config.origin||`http://${config.host==='::1'?'[::1]':config.host}:${server.address()?.port||config.port}`;
  async function refresh(kind,origin){
    const request=new Request(origin+`/api/${kind}?wait=1`),response=await worker.fetch(request,runtimeEnv,ctx);
    if(kind!=='radar')return response;const snapshot=await response.json();
    return json({...snapshot,meta:{...snapshot.meta,scheduledIntervalHours:config.autoRefresh?4:0}},response.status);
  }
  const server=createServer(async(incoming,outgoing)=>{
    try{
      const origin=originFor();if(incoming.headers.host!==new URL(origin).host)return send(json({error:'Invalid host',code:'host'},421));
      if(!incoming.url?.startsWith('/')||incoming.url.startsWith('//'))return send(json({error:'Invalid path'},400));
      const url=new URL(incoming.url,origin),headers=stripSitesHeaders(incoming.headers),method=incoming.method||'GET';
      const authenticated=auth.authenticated(headers);
      if(url.pathname==='/api/session'){if(method!=='GET')return send(json({error:'Method not allowed'},405,{Allow:'GET'}));return send(json({mode:'standalone',authenticated,configured:auth.configured,authConfigured:auth.configured}));}
      if(url.pathname==='/api/login'||url.pathname==='/api/logout'){
        if(method!=='POST')return send(json({error:'Method not allowed'},405,{Allow:'POST'}));
        if(!sameOrigin(headers,origin))return send(json({error:'请从本站操作',code:'origin'},403));
        const body=await jsonBody(incoming,2048);
        if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).some(key=>url.pathname.endsWith('/login')?key!=='password':true))return send(json({error:'Invalid request'},400));
        if(url.pathname.endsWith('/logout'))return send(json({ok:true},200,{'set-cookie':auth.logout(headers)}));
        if(typeof body.password!=='string'||body.password.length<1||body.password.length>256)return send(json({error:'密码格式不正确',code:'invalid_credentials'},400));
        const result=await auth.login(body.password,incoming.socket.remoteAddress||'unknown');
        return send(json(result.status===200?{ok:true}:{error:result.status===429?'登录尝试过于频繁，请十五分钟后再试。':result.status===503?'站主还没有配置私人登录。':'密码不正确',code:result.code},result.status,result.cookie?{'set-cookie':result.cookie}:{}));
      }
      if(url.pathname==='/signin-with-chatgpt')return send(new Response(null,{status:303,headers:{Location:'/?view=assistant&login=1','cache-control':'no-store'}}));
      if(url.pathname==='/mcp')return send(json({error:'This deployment uses standalone login, not Sites MCP.',code:'standalone'},404));
      if(url.pathname==='/api/health')return send(json({app:'Dayline',mode:'standalone',storage:true,loginConfigured:auth.configured,autoRefresh:config.autoRefresh}));
      if(url.pathname==='/api/radar'||url.pathname==='/api/demand'){
        if(method!=='GET')return send(json({error:'Method not allowed'},405,{Allow:'GET'}));
        if(url.search)return send(json({error:'请使用登录后的更新按钮；读取不会启动采集。',code:'read_only'},400));
        return send(await cached(bucket,url.pathname.slice(5),worker,config.autoRefresh));
      }
      if(url.pathname==='/api/refresh/radar'||url.pathname==='/api/refresh/demand'){
        if(method!=='POST')return send(json({error:'Method not allowed'},405,{Allow:'POST'}));
        if(!authenticated)return send(json({error:'请先登录',code:'sign_in'},401));
        if(!sameOrigin(headers,origin))return send(json({error:'请从本站操作',code:'origin'},403));
        const body=await jsonBody(incoming,128);if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).length)return send(json({error:'不接受自定义来源或参数'},400));
        return send(await refresh(url.pathname.endsWith('/radar')?'radar':'demand',origin));
      }
      if(url.pathname==='/api/chat'&&(!authenticated||!auth.configured))return send(json({error:auth.configured?'请先登录私人助手':'站主还没有配置私人登录',code:auth.configured?'sign_in':'not_configured',maybeCharged:false},auth.configured?401:503));
      if(url.pathname==='/api/chat'&&!sameOrigin(headers,origin))return send(json({error:'请从本站发送',code:'origin',maybeCharged:false},403));
      if(authenticated)headers.set('oai-authenticated-user-id',OWNER);
      let body;if(method!=='GET'&&method!=='HEAD')body=await readBody(incoming);
      const request=new Request(url,{method,headers,...(body?{body}:{} )});
      const response=await worker.fetch(request,runtimeEnv,ctx);
      if(url.pathname==='/api/chat/status'){
        const status=await response.json();status.signInUrl='/?view=assistant&login=1';status.authMode='standalone';
        if(!auth.configured)status.reason='站主还没有配置私人登录；付费 AI 暂未开放。';else if(!authenticated)status.reason='请登录你的 Dayline 私人助手。';
        return send(json(status,response.status));
      }
      return send(response);
    }catch(error){if(!outgoing.headersSent)send(json({error:error?.status?'请求格式无效或超过限制。':'服务暂不可用；未记录问题内容。',code:'request_failed'},error?.status||500));else outgoing.end();}
    async function send(response){
      if(outgoing.destroyed)return;const headers=Object.fromEntries(response.headers);headers['x-content-type-options']='nosniff';headers['referrer-policy']='strict-origin-when-cross-origin';headers['x-frame-options']='DENY';
      if(config.production)headers['strict-transport-security']='max-age=31536000';
      outgoing.writeHead(response.status,headers);outgoing.end(incoming.method==='HEAD'?undefined:Buffer.from(await response.arrayBuffer()));
    }
  });
  server.requestTimeout=10000;server.headersTimeout=10000;server.keepAliveTimeout=5000;server.maxHeadersCount=64;
  server.on('listening',()=>{if(!config.autoRefresh)return;const run=async()=>{if(refreshBusy)return;refreshBusy=true;try{for(const kind of ['radar','demand'])await refresh(kind,originFor());}catch{/* no user data, credentials, or upstream response in logs */}finally{refreshBusy=false;}};ctx.waitUntil(run());autoTimer=setInterval(()=>ctx.waitUntil(run()),4*3600000);autoTimer.unref();});
  server.on('close',()=>clearInterval(autoTimer));
  return {server,config,bucket,async close(){clearInterval(autoTimer);await new Promise(done=>server.close(done));await Promise.allSettled([...pending]);}};
}
async function main(){
  const args=process.argv.slice(2);if(args.some(arg=>arg!=='--env-file=.env.local'))throw Error('Only --env-file=.env.local is supported');
  if(args.includes('--env-file=.env.local'))process.loadEnvFile(resolve(ROOT,'.env.local'));
  const config=standaloneConfig(process.env);await mkdir(config.dataDir,{recursive:true,mode:0o700});const lockPath=resolve(config.dataDir,'.instance.lock');let lock;
  try{lock=await open(lockPath,'wx',0o600);}catch(error){if(error.code==='EEXIST')throw Error('DATA_DIR is locked. Run one process; after a crash remove .instance.lock only after verifying no Dayline process is running.');throw error;}
  await lock.writeFile(String(process.pid));
  let app;try{const worker=(await import(pathToFileURL(resolve(ROOT,'dist/server/index.js')))).default;app=await createStandaloneServer({env:process.env,worker});await new Promise((done,reject)=>{app.server.once('error',reject);app.server.listen(config.port,config.host,done);});}
  catch(error){await lock.close();await unlink(lockPath).catch(()=>{});throw error;}
  console.log(`Dayline standalone ready on ${config.host}:${app.server.address().port}; ${config.production?'HTTPS proxy required':'local development'}; one process only.`);
  let closing=false;for(const signal of ['SIGTERM','SIGINT'])process.on(signal,async()=>{if(closing)return;closing=true;await app.close();await lock.close();await unlink(lockPath).catch(()=>{});process.exit(0);});
}
if(process.argv[1]&&resolve(process.argv[1])===resolve(import.meta.filename))main().catch(()=>{console.error('Dayline could not start. Check Node 24, build output, origin, single-instance settings, and data directory. No secrets were logged.');process.exitCode=1;});
