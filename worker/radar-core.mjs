/** Bounded public-feed ingestion. This module has no credentials or personal planner data. */
export const RADAR_INTERVAL_MS = 3600000;
export const RADAR_VERSION = '1.0.1';
export function cleanText(value, max = 300) {
  return String(value ?? '').replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/<[^>]*>/g, ' ')
    .replace(/&#(x[0-9a-f]+|\d+);/gi, (_, n) => { const c = n[0].toLowerCase() === 'x' ? parseInt(n.slice(1), 16) : Number(n); return c > 0 && c <= 0x10ffff ? String.fromCodePoint(c) : ''; })
    .replace(/&(?:amp|lt|gt|quot|apos|nbsp);/gi, m => ({ '&amp;':'&','&lt;':'<','&gt;':'>','&quot;':'"','&apos;':"'",'&nbsp;':' ' })[m.toLowerCase()])
    .replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}
export function safeURL(value) {
  try { const u = new URL(cleanText(value, 2000)); if(u.protocol==='http:'&&['arxiv.org','www.arxiv.org'].includes(u.hostname))u.protocol='https:'; if (u.protocol !== 'https:' || u.username || u.password || u.port) return null; u.hash = ''; for (const k of [...u.searchParams.keys()]) if (/^(utm_|fbclid|gclid)/i.test(k)) u.searchParams.delete(k); return u.href; } catch { return null; }
}
export function publicationDate(value, now = Date.now()) {
  const s = String(value ?? '').trim(); if (!/\b(?:19|20)\d{2}\b/.test(s)) return null;
  const t = Date.parse(s); return Number.isFinite(t) && t >= Date.UTC(1990,0,1) && t <= now + 300000 ? new Date(t).toISOString() : null;
}
function futureDate(value, now) { const s = String(value ?? ''); const t = Date.parse(s); return /\b(?:19|20)\d{2}\b/.test(s) && Number.isFinite(t) && t > now + 300000; }
function xmlField(block, names) { for (const name of names) { const m = block.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${name}\\s*>`, 'i')); if (m) return m[1]; } return ''; }
function xmlRows(xml) {
  if (/<!DOCTYPE|<!ENTITY/i.test(xml)) throw new Error('拒绝外部实体或DTD');
  const blocks = [...xml.matchAll(/<(?:item|entry)(?:\s[^>]*)?>([\s\S]*?)<\/(?:item|entry)\s*>/gi)].slice(0, 60);
  if (!/<(?:rss|feed|rdf:RDF)\b/i.test(xml)) throw new Error('来源没有返回RSS/Atom');
  return blocks.map(m => { const b=m[1]; const attrs=[...b.matchAll(/<link\b([^>]+)\/?>/gi)]; let link=''; for(const a of attrs){const h=a[1].match(/\bhref\s*=\s*["']([^"']+)["']/i);const r=a[1].match(/\brel\s*=\s*["']([^"']+)["']/i);if(h&&(!r||r[1]==='alternate')){link=h[1];break;}} return {title:xmlField(b,['title']),url:link||xmlField(b,['link','id']),date:xmlField(b,['published','pubDate','dc:date','updated']),text:xmlField(b,['summary','description','content:encoded','content'])}; });
}
export function parseSource(body, source, now = Date.now()) {
  let rows;
  if (source.format === 'xml') rows=xmlRows(body);
  else if(source.format==='ndrc'){
    const list=body.match(/<ul\b[^>]*class=["'][^"']*\bu-list\b[^"']*["'][^>]*>([\s\S]*?)<\/ul>/i)?.[1];if(!list)throw new Error('官方新闻列表结构已改变');
    rows=[...list.matchAll(/<li\b[^>]*>([\s\S]*?)<\/li>/gi)].slice(0,40).map(m=>{const b=m[1];const anchor=b.match(/<a\b([^>]+)>([\s\S]*?)<\/a>/i);const href=anchor?.[1].match(/\bhref=["']([^"']+)["']/i)?.[1];const title=anchor?.[1].match(/\btitle=["']([^"']+)["']/i)?.[1]||anchor?.[2];const date=b.match(/<span\b[^>]*>\s*(\d{4})\/(\d{2})\/(\d{2})\s*<\/span>/i);return {title,url:href?new URL(href,source.url).href:'',date:date?`${date[1]}-${date[2]}-${date[3]}`:'',text:title};});
  }
  else {
    const d=JSON.parse(body);
    if(source.format==='github'){if(!Array.isArray(d))throw new Error('发布列表格式异常');rows=d.filter(v=>!v.draft&&!v.prerelease).map(v=>({title:v.name||v.tag_name,url:v.html_url,date:v.published_at,text:v.body}));}
    else if(source.format==='cisa'){if(!Array.isArray(d.vulnerabilities))throw new Error('漏洞目录格式异常');rows=d.vulnerabilities.slice().sort((a,b)=>String(b.dateAdded).localeCompare(String(a.dateAdded))).slice(0,20).map(v=>({title:`${v.cveID} · ${v.vulnerabilityName}`,url:`https://www.cisa.gov/known-exploited-vulnerabilities-catalog?search_api_fulltext=${encodeURIComponent(v.cveID)}`,date:v.dateAdded,text:`${v.shortDescription} ${v.requiredAction} vulnerability cybersecurity`}));}
    else if(source.format==='epmc'){if(!Array.isArray(d.resultList?.result))throw new Error('研究索引格式异常');rows=d.resultList.result.map(v=>({title:v.title,url:`https://europepmc.org/article/${encodeURIComponent(v.source)}/${encodeURIComponent(v.id)}`,date:v.firstPublicationDate,text:`${v.title} ageing healthcare care`}));}
    else if(source.format==='osti'){if(!Array.isArray(d))throw new Error('能源研究索引格式异常');rows=d.map(v=>({title:v.title,url:`https://www.osti.gov/biblio/${v.osti_id}`,date:v.publication_date,text:`${v.title} ${v.description||''}`}));}
    else throw new Error('不支持的来源格式');
  }
  const result=[];
  for(const row of rows){const rawDate=cleanText(row.date,100);if(futureDate(rawDate,now))continue;const title=cleanText(row.title,220);const url=safeURL(row.url);if(!title||!url)continue;const date=publicationDate(rawDate,now);if(date&&now-Date.parse(date)>90*86400000)continue;result.push({title,url,publishedAt:date,text:cleanText(row.text,4000)});}
  return result;
}
export function stableId(text) { let hash=2166136261; for (const c of String(text)){hash^=c.charCodeAt(0);hash=Math.imul(hash,16777619);} return `signal-${(hash>>>0).toString(16).padStart(8,'0')}`; }
export function canonicalEvent(item) {
  const combined=`${item.url} ${item.title}`; const arxiv=combined.match(/(?:arxiv\.org\/(?:abs|pdf)\/|arxiv\s*:?\s*)(\d{4}\.\d{4,5})(?:v\d+)?/i);if(arxiv)return `arxiv:${arxiv[1]}`;
  const cve=combined.match(/CVE-\d{4}-\d{4,}/i); if(cve)return cve[0].toUpperCase();
  try{const u=new URL(item.url);if(u.hostname==='github.com'&&u.pathname.includes('/releases/tag/'))return `github:${u.pathname}`;}catch{}
  const title=item.title.toLowerCase().replace(/[^\p{L}\p{N}]/gu,'').slice(0,180);return title.length<20?`${title}:${item.url}`:title;
}
function signalIdentity(item) { const event=canonicalEvent(item);return /^(arxiv:|CVE-|github:)/.test(event)?event:item.url; }
function matchingTopics(item, source, topics) {
  if(source.restrictTopics)return topics.filter(t=>source.fixedTopics?.includes(t.id)).map(t=>t.id);
  const value=`${item.title} ${item.text||''}`.toLowerCase();
  const matches=k=>{const key=k.toLowerCase();if(/^[a-z0-9\s-]+$/.test(key)){const escaped=key.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');return new RegExp(`\\b${escaped}(?:s|es)?\\b`,'i').test(value);}return value.includes(key);};
  return topics.filter(t=>t.keywords.some(matches)||source.fixedTopics?.includes(t.id)).map(t=>t.id);
}
const EVIDENCE={policy:25,industry:21,commercial:22,release:17,research:12};
export function compileSnapshot(results, previous, sources, topics, now = Date.now()) {
  const candidates=[];const health=[];
  for(let i=0;i<sources.length;i++){const source=sources[i];const r=results[i];const oldHealth=previous?.sources?.find(s=>s.id===source.id);
    if(r?.ok){health.push({id:source.id,name:source.name,url:source.url,status:'ok',lastSuccessAt:new Date(now).toISOString(),itemCount:r.rows.length,publisherId:source.publisherId});for(const row of r.rows){const matches=matchingTopics(row,source,topics);if(!matches.length)continue;candidates.push({...row,id:stableId(signalIdentity(row)),sourceId:source.id,sourceName:source.name,publisherId:source.publisherId,signalType:source.signalType,dateLabel:source.dateLabel||'原文发布日期',matchedTopics:matches,topics:matches});}}
    else{health.push({id:source.id,name:source.name,url:source.url,status:'error',lastSuccessAt:oldHealth?.lastSuccessAt||null,itemCount:0,error:cleanText(r?.error||'本轮未完成抓取',180),publisherId:source.publisherId});for(const old of previous?.items||[]){if(old.sourceId===source.id&&(!old.publishedAt||now-Date.parse(old.publishedAt)<90*86400000))candidates.push({...old,text:'',retained:true});}}
  }
  const unique=new Map();const urls=new Set();for(const item of candidates){const key=canonicalEvent(item);const existing=unique.get(key);if(existing){if(!item.retained&&existing.retained)unique.set(key,item);continue;}if(urls.has(item.url))continue;urls.add(item.url);unique.set(key,item);}
  const byTopic=Object.fromEntries(topics.map(t=>[t.id,new Set()]));for(const item of unique.values()){if(item.retained||!item.publishedAt||now-Date.parse(item.publishedAt)>30*86400000)continue;for(const id of item.matchedTopics)byTopic[id]?.add(item.publisherId);}
  let items=[...unique.values()].map(item=>{
    const age=item.publishedAt?Math.max(0,(now-Date.parse(item.publishedAt))/86400000):Infinity;
    const recency=age<=2?30:age<=7?25:age<=14?19:age<=30?12:age<=90?4:0;
    const evidence=EVIDENCE[item.signalType]||12;
    const convergence=Math.min(25,Math.max(0,...item.matchedTopics.map(id=>((byTopic[id]?.size||0)-1)*6)));
    const access=Math.min(20,Math.max(0,...item.matchedTopics.map(id=>topics.find(t=>t.id===id)?.accessScore||0)));
    const scoreBreakdown={recency,evidence,convergence,access};const score=Math.min(100,recency+evidence+convergence+access);
    const {text,...safe}=item;return {...safe,score,scoreBreakdown,evidenceLabel:item.signalType==='research'?'研究信号 · 不证明成熟产品':item.signalType==='release'?'供应商发布 · 商业效果待核实':item.signalType==='policy'?'官方行动信号 · 不等于客户订单':'一手行业信号 · 盈利仍待验证',summary:`${item.retained?'本轮来源失败，保留上次信号。':'本轮从公开一手来源采集。'}匹配方向：${item.matchedTopics.map(id=>topics.find(t=>t.id===id)?.label||id).join('、')}。${item.publishedAt?'请核实客户问题与付费意愿。':'来源未提供可核验发布日期，时效分为零。'}`};
  }).sort((a,b)=>b.score-a.score||String(b.publishedAt||'').localeCompare(String(a.publishedAt||''))||a.id.localeCompare(b.id));
  const counts={};items=items.filter(item=>{counts[item.sourceId]=(counts[item.sourceId]||0)+1;return counts[item.sourceId]<=10;}).slice(0,80);
  const ok=health.filter(s=>s.status==='ok').length;
  const generatedAt=ok>0?new Date(now).toISOString():(previous?.generatedAt||null);
  return {schemaVersion:1,generatedAt,lastAttemptAt:new Date(now).toISOString(),nextRefreshAt:new Date(now+RADAR_INTERVAL_MS).toISOString(),status:ok===sources.length&&ok>0?'fresh':ok>0?'partial':items.length?'stale':'unavailable',items,sources:health,topics:topics.map(({keywords,accessScore,...t})=>t),meta:{intervalHours:1,scheduledIntervalHours:4,algorithmVersion:RADAR_VERSION,sourceCount:sources.length,successfulSources:ok,scoreMeaning:'阅读与验证优先级，非盈利概率',weights:{recency:30,evidence:25,convergence:25,access:20}}};
}
async function limitedBody(response, maxBytes, signal) {
  const declared=Number(response.headers.get('content-length'));if(declared>maxBytes)throw new Error('来源内容超过大小上限');
  if(!response.body)return '';const reader=response.body.getReader();let size=0;const chunks=[];
  try{while(true){if(signal.aborted)throw new Error('来源请求超时');const {value,done}=await reader.read();if(done)break;size+=value.byteLength;if(size>maxBytes)throw new Error('来源内容超过大小上限');chunks.push(value);}}finally{if(signal.aborted||size>maxBytes)await reader.cancel().catch(()=>{});reader.releaseLock();}
  const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}return new TextDecoder().decode(bytes);
}
export async function collectSource(source, now, fetcher=fetch, parentSignal) {
  const controller=new AbortController();const abort=()=>controller.abort();parentSignal?.addEventListener('abort',abort,{once:true});if(parentSignal?.aborted)controller.abort();const timer=setTimeout(abort,Math.min(12000,Math.max(2000,source.timeoutMs||8500)));
  try{let target=new URL(source.url);if(source.format==='epmc'){target.searchParams.set('query',`(TITLE_ABS:ageing OR TITLE_ABS:aging) AND FIRST_PDATE:[${new Date(now-30*86400000).toISOString().slice(0,10)} TO ${new Date(now).toISOString().slice(0,10)}] sort_date:y`);}
    for(let hop=0;hop<3;hop++){if(target.protocol!=='https:'||target.username||target.password||target.port||!(source.allowedHosts||[new URL(source.url).hostname]).includes(target.hostname))throw new Error('来源重定向超出允许域名');const response=await fetcher(target.href,{redirect:'manual',signal:controller.signal,headers:{'Accept':source.format==='xml'?'application/rss+xml, application/atom+xml, text/xml':'application/json','User-Agent':'Dayline-Opportunity-Radar/1.0 (public research; hourly cache)'}});if(response.status>=300&&response.status<400){const location=response.headers.get('location');if(!location)throw new Error('来源重定向无目标');target=new URL(location,target);continue;}if(!response.ok)throw new Error(`来源HTTP ${response.status}`);const body=await limitedBody(response,source.maxBytes||1100000,controller.signal);return {ok:true,rows:parseSource(body,source,now)};}throw new Error('来源重定向次数过多');
  }catch(e){return {ok:false,error:controller.signal.aborted?'本轮请求超时':cleanText(e.message,180)};}finally{clearTimeout(timer);parentSignal?.removeEventListener('abort',abort);}
}
export async function collectAll(sources, now=Date.now(), fetcher=fetch) {
  const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),23000);const results=Array(sources.length);let index=0;
  const offset=Math.floor(now/RADAR_INTERVAL_MS)%sources.length;
  const run=async()=>{while(index<sources.length){const i=(index+++offset)%sources.length;if(controller.signal.aborted){results[i]={ok:false,error:'全局采集期限已到，本轮未尝试'};continue;}results[i]=await collectSource(sources[i],now,fetcher,controller.signal);}};
  try{await Promise.all(Array.from({length:Math.min(3,sources.length)},run));return results;}finally{clearTimeout(timer);}
}
