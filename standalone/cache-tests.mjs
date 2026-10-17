/** Contract tests using actual frontend validators, without secrets or live network. */
import assert from 'node:assert/strict';
import {request} from 'node:http';
import {readFile,stat} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createStandaloneServer} from './server.mjs';
const root=resolve(import.meta.dirname,'..');
const worker=(await import(pathToFileURL(resolve(root,'dist/server/index.js')))).default;
const {validateDemandResponse}=await import(pathToFileURL(resolve(root,'src/lib/demand.js')));
const {validateRadarResponse}=await import(pathToFileURL(resolve(root,'src/lib/radar-validation.js')));
const originalFetch=globalThis.fetch;let networkCalls=0,writes=0,assertions=0;const apps=[];
globalThis.fetch=async()=>{networkCalls++;throw Error('Live network forbidden in contract tests');};
const check=(actual,expected,label)=>{assert.deepEqual(actual,expected,label);assertions++;};
async function startServer(bucket,env={}){const app=await createStandaloneServer({worker,bucket,env:{PORT:'0',...env}});await new Promise(done=>app.server.listen(0,'127.0.0.1',done));apps.push(app);return app;}
async function get(app,path){return new Promise((done,reject)=>{const req=request({host:'127.0.0.1',port:app.server.address().port,path},response=>{let body='';response.on('data',chunk=>body+=chunk);response.on('end',()=>done({status:response.statusCode,data:JSON.parse(body)}));});req.on('error',reject);req.end();});}
const noData={get:async()=>null,put:async()=>{writes++;throw Error('A public read must not write');}};
try{
  const app=await startServer(noData);const radar=await get(app,'/api/radar'),demand=await get(app,'/api/demand');
  check(radar.status,200,'empty radar is a usable unavailable response');check(demand.status,200,'empty demand is usable');
  const validatedRadar=validateRadarResponse(radar.data),validatedDemand=validateDemandResponse(demand.data);assertions+=2;
  check(validatedRadar.status,'unavailable');check(validatedDemand.status,'unavailable');check(validatedRadar.generatedAt,null);check(validatedDemand.generatedAt,null);
  check(validatedRadar.items.length,0);check(validatedDemand.items.length,0);check(validatedRadar.topics.length,7,'all directions survive first load');check(validatedDemand.sources.length,6,'demand source health is available');
  check(validatedRadar.sources.length>0,true,'radar source health available');check(validatedRadar.sources.every(source=>source.status==='error'&&source.error.includes('请登录后更新')),true);check(validatedDemand.sources.every(source=>source.status==='error'&&source.error.includes('请登录后更新')),true);
  check(validatedRadar.meta.scheduledIntervalHours,0,'disabled scheduler never advertises four-hour updates');check(typeof validatedRadar.meta.algorithmVersion,'string');check(validatedDemand.meta.algorithmVersion,'buyer-context-1.2');
  const broken=await startServer({get:async()=>{throw Error('disk fixture');},put:async()=>{writes++;}});const brokenRadar=await get(broken,'/api/radar'),brokenDemand=await get(broken,'/api/demand');check(brokenRadar.status,503);check(brokenDemand.status,503);check(validateRadarResponse(brokenRadar.data).status,'unavailable');check(validateDemandResponse(brokenDemand.data).status,'unavailable');
  const invalid=await startServer({get:async()=>({json:async()=>({})}),put:async()=>{writes++;}});check((await get(invalid,'/api/radar')).status,503,'invalid disk shape fails closed');check((await get(invalid,'/api/demand')).status,503);
  const old={...radar.data,status:'fresh',generatedAt:'2020-01-01T00:00:00.000Z'};const stale=await startServer({get:async()=>({json:async()=>old}),put:async()=>{writes++;}});const staleResult=await get(stale,'/api/radar');check(validateRadarResponse(staleResult.data).status,'stale');
  check(networkCalls,0,'none of the public reads contacts external services');check(writes,0,'none of the public reads updates any key');
  const docker=await readFile(resolve(root,'standalone/Dockerfile'),'utf8'),ignore=await readFile(resolve(root,'standalone/Dockerfile.dockerignore'),'utf8');
  for(const line of docker.split('\n').filter(line=>line.startsWith('COPY ')&&!line.includes('--from='))){const paths=line.slice(5).trim().split(/\s+/).slice(0,-1);for(const path of paths){check(!!await stat(resolve(root,path)),true,`Docker source exists: ${path}`);}}
  check(docker.includes('pnpm install --frozen-lockfile --ignore-scripts'),true,'build consumes the committed lock');check(!docker.includes('COPY standalone ./standalone'),true,'runtime copies only named modules');check(ignore.split('\n').includes('**'),true,'build context uses deny-by-default');
  for(const entry of ['**/.env*','**/*.pem','**/*.key','**/*.p12','**/.data'])check(ignore.split('\n').includes(entry),true,`sensitive files excluded: ${entry}`);
  console.log(`Standalone empty-cache and Docker input contract checks passed: ${assertions}. External calls: ${networkCalls}. Cache writes: ${writes}. Docker build not executed.`);
}finally{globalThis.fetch=originalFetch;for(const app of apps)await app.close();}
