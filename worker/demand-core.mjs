/** Fixed, anonymous public-demand scan. No planner data, contact fields or model key. */
export const DEMAND_INTERVAL_MS = 3600000;
export const DEMAND_ALGORITHM_VERSION = 'buyer-context-1.2';
const demandDayMs = 86400000;
const demandDefinitions = {
  'hn-automation': ['hn', 'automation'],
  'hn-spreadsheet': ['hn', 'spreadsheet'],
  'hn-paying': ['hn', 'willing to pay'],
  'gh-automation': ['github-issues', 'is:issue automation bounty in:title,body'],
  'gh-spreadsheet': ['github-issues', 'is:issue spreadsheet paid in:title,body'],
  'gh-integration': ['github-issues', 'is:issue integration "willing to pay" in:title,body'],
};
function demandText(value, max = 6000) {
  return String(value ?? '').replace(/<blockquote\b[^>]*>/gi, ' [quoted passage] ').replace(/<\/blockquote\s*>/gi, ' [end quote] ').replace(/<[^>]*>/g, ' ')
    .replace(/&#(x[0-9a-f]+|\d+);/gi, (_, n) => { const code = /^x/i.test(n) ? parseInt(n.slice(1), 16) : Number(n); return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : ''; })
    .replace(/&(amp|quot|apos|lt|gt|nbsp);/gi, (_, name) => ({amp:'&',quot:'"',apos:"'",lt:'<',gt:'>',nbsp:' '})[name.toLowerCase()])
    .replace(/[\w.+-]+@[\w.-]+\.[a-z]{2,}/gi, '[contact removed]')
    .replace(/(?:\+?\d[\d ().-]{7,}\d)/g, match => /\d{4}-\d{2}-\d{2}/.test(match) ? match : '[contact removed]')
    .replace(/\b(?:tel|phone|whatsapp|telegram|微信|手机号)\s*[:：]\s*\S+/gi, '[contact removed]')
    .replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}
function demandISO(value, now) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}(?:T|$)/.test(value)) return null;
  const time = Date.parse(value);
  return Number.isFinite(time) && time >= Date.UTC(1990, 0, 1) && time <= now + 300000 ? new Date(time).toISOString() : null;
}
function demandScheduleDate(value,now) {
  if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}T/.test(value))return null;
  const time=Date.parse(value);return Number.isFinite(time)&&time>=Date.UTC(1990,0,1)&&time<=now+7*demandDayMs?new Date(time).toISOString():null;
}
function demandDeadline(value) {
  if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value))return null;
  const parsed=new Date(`${value}T00:00:00Z`);return Number.isFinite(parsed.getTime())&&parsed.toISOString().startsWith(value)?value:null;
}
function demandDeadlineExpired(date,now) {
  // A calendar date is not an exact timestamp. UTC-12 is the latest possible date end.
  return !!date&&now>Date.parse(`${date}T23:59:59.999Z`)+12*3600000;
}
function demandHash(value) {
  let a = 2166136261, b = 3339675911;
  for (const char of String(value)) { a = Math.imul(a ^ char.charCodeAt(0), 16777619); b = Math.imul(b ^ char.charCodeAt(0), 2246822519); }
  return `${(a >>> 0).toString(16).padStart(8, '0')}${(b >>> 0).toString(16).padStart(8, '0')}`;
}
function demandURL(value) {
  try {
    const url = new URL(String(value));
    if (url.protocol !== 'https:' || url.username || url.password || url.port) return null;
    if (url.hostname === 'news.ycombinator.com' && url.pathname === '/item' && /^\d{1,12}$/.test(url.searchParams.get('id') || '')) return `https://news.ycombinator.com/item?id=${url.searchParams.get('id')}`;
    if (url.hostname === 'github.com' && /^\/[\w.-]+\/[\w.-]+\/issues\/\d+$/.test(url.pathname)) return `https://github.com${url.pathname.toLowerCase()}`;
  } catch {}
  return null;
}
function demandConfiguredURL(source, now) {
  const definition = Object.hasOwn(demandDefinitions, source?.id) && demandDefinitions[source.id];
  if (!definition || source.format !== definition[0]) throw new Error('来源不在固定需求目录');
  const url = new URL(source.url);
  if (url.protocol !== 'https:' || url.username || url.password || url.port) throw new Error('来源地址不受支持');
  if (source.format === 'hn') {
    if (url.hostname !== 'hn.algolia.com' || url.pathname !== '/api/v1/search_by_date' || url.searchParams.get('tags') !== 'ask_hn' || url.searchParams.get('query') !== definition[1] || url.searchParams.get('hitsPerPage') !== '20' || [...url.searchParams.keys()].some(key => !['tags','query','hitsPerPage'].includes(key))) throw new Error('HN来源配置已偏离固定查询');
    url.searchParams.set('numericFilters', `created_at_i>${Math.floor((now - 90 * demandDayMs) / 1000)}`);
  } else {
    if (url.hostname !== 'api.github.com' || url.pathname !== '/search/issues' || url.searchParams.get('q') !== definition[1] || url.searchParams.get('sort') !== 'updated' || url.searchParams.get('order') !== 'desc' || url.searchParams.get('per_page') !== '20' || [...url.searchParams.keys()].some(key => !['q','sort','order','per_page'].includes(key))) throw new Error('GitHub来源配置已偏离固定查询');
    url.searchParams.set('q', `${definition[1]} created:>=${new Date(now - 90 * demandDayMs).toISOString().slice(0,10)}`);
  }
  return url.href;
}
function demandOffer(text) {
  if (/\b(?:spreadsheet|excel|google sheets|xlsx|csv)\b|表格|电子表单/i.test(text)) return 'spreadsheet';
  if (/\b(?:literature review|systematic review|research report|bibliography|paper summary|technical research)\b|文献综述|研究报告/i.test(text)) return 'research-pack';
  if (/\b(?:automation|automate|workflow|integration|integrate|zapier|n8n|api)\b|自动化|工作流|集成/i.test(text)) return 'workflow';
  if (/\b(?:debugging|debug|fix|bug|error|broken|fails|crash)\b|调试|报错|修复/i.test(text)) return 'debugging';
  return 'unknown';
}
function demandClassify(row, now) {
  const text = demandText(`${row.title}. ${row.text}`, 8000);
  const language = text.replace(/\bi['’]m\b/gi, 'i am').replace(/\bwe['’]re\b/gi, 'we are');
  const positiveEvidence = [], negativeEvidence = [];
  const buyer = /\b(?:i|we|our team|my team)\b.{0,100}\b(?:need|want|looking|seeking|struggling|cannot|trying|would like|willing to pay|will pay|can pay)\b|\b(?:looking for|seeking|need help|help wanted|can someone|could someone|can anyone|bounty|feature request)\b|求助|需求|希望找|愿意付费/i.test(language);
  const problem = buyer || /\b(?:broken|bug|error|fails|crash|repetitive|manual work)\b|报错|故障|重复劳动/i.test(language);
  const paymentMatch = language.match(/\b(?:i|we)\s+(?:(?:would|will|can|could|am|are)\s+)?(?:be\s+)?(?:willing|happy|ready|prepared)\s+to\s+pay\b|\b(?:i|we)\s+(?:will|can|would)\s+pay\b|\b(?:my|our)\s+budget\s*(?:is|of|:)?\s*(?:[$€£¥]\s*\d[\d,.]*|\d[\d,.]*\s*(?:USD|EUR|GBP|RMB))|\b(?:budget|bounty|offering|paying)\s*[:=-]?\s*(?:[$€£¥]\s*\d[\d,.]*|\d[\d,.]*\s*(?:USD|EUR|GBP|RMB))|\b(?:looking for|seeking|need|want)\s+(?:a\s+)?paid\s+(?:help|support|task|project)\b|有偿求助|愿意付费|预算\s*[:：]?\s*\d+\s*元/i);
  const noPay = /\b(?:for free|free of charge|must be free|needs? to be free|only free|free help|free solution|no budget|zero budget|unpaid|volunteers?|not willing to pay|not prepared to pay|unwilling to pay|(?:do not|don't|cannot|can't|won't|will not|not going to)\s+(?:want to\s+)?pay|without paying)\b|不愿.{0,4}付费|免费求助|没有预算|无偿/i.test(language);
  const seller = /\b(?:hire me|i can build|we can build|i charge|our pricing|my services|we offer|our product|check out my|buy my|our paid plan)\b/i.test(language);
  const job = /\b(?:who is hiring|job opening|job posting|full[- ]time|salary|employment|send (?:your )?(?:resume|résumé))\b/i.test(language);
  const hypothetical = /\b(?:would (?:you|users|customers|people|anyone) pay|how much would (?:you|people|users) pay|willingness to pay|market research|what would you pay|are (?:you|people) willing to pay|(?:customers|users) (?:are|would be) willing to pay|for example|an example|e\.g\.)\b/i.test(language);
  const headline = demandText(row.title, 240);
  const promotionalHeadline = /^(?:business ideas?(?:\s+(?:for\s+)?20\d{2})?\s*[:：-].*\b(?:profitable|opportunities|to start)\b|(?:top\s+)?\d+\s+(?:profitable\s+)?(?:business ideas|business opportunities|ways to (?:make money|earn))\b)|\b(?:profitable opportunities to start|best businesses to start)\b/i.test(headline);
  const securityBulletin = /^(?:(?:microsoft|google|apple|mozilla|cisco|oracle|red hat|ubuntu|debian)\s+)?security advisory\b.*(?:\bCVE-|\bvulnerability\b|\bbulletin\b)|^CVE-.*?\s*[:：-]\s*(?:security advisory|vulnerability disclosure)\b/i.test(headline);
  const aggregation = row.automated === true || /\b(?:opportunity router|task hunter|ranked opportunities|opportunity digest|curated bounties|bounty roundup|reward signal|bot[- ]generated|aggregated opportunities|latest ranked opportunities|revenue capture fleet)\b|机会汇总|悬赏汇总|任务汇总榜/i.test(language) || /\bverified one[- ]time payouts\b.*\b(?:contracts|productized services)\b/i.test(headline);
  const nonBuyerPublication = aggregation || promotionalHeadline || securityBulletin;
  const qualifiedProblem = problem && !nonBuyerPublication && !seller && !job;
  const zeroPay = /\b(?:zero bounty|zero budget|no bounty)\b|\b(?:budget|bounty|pay(?:ing)?)\s*(?:is|of|:)?\s*[$€£¥]\s*0(?:[.,]0+)?(?![\d,]|\.\d)|\b(?:budget|bounty)\s*(?:is|of|:)?\s*0(?:[.,]0+)?\s*(?:USD|EUR|GBP|RMB)\b|预算\s*[:：]?\s*0\s*元/i.test(language);
  const historicalPay = /\b(?:paid (?:before|previously|in the past|last (?:week|month|year))|(?:i|we) (?:have |had )?paid|i['’]ve paid|we['’]ve paid|used to pay|previously paid|was willing to pay|were willing to pay)\b/i.test(language);
  const quotedPay = /\b(?:he|she|they|someone|customer|user|people|users|customers|colleague)\b.{0,60}\b(?:said|says|say|told|wrote|quoted|claimed)\b.{0,100}(?:willing to pay|will pay|can pay)|["“][^"”]{0,220}(?:willing to pay|will pay|can pay)[^"”]{0,220}["”]|(?:^|\s)>\s*(?:i|we)\b.{0,100}(?:willing to pay|will pay|can pay)|\[quoted passage\].{0,300}(?:willing to pay|will pay|can pay)/i.test(language);
  const resolved = /\b(?:already (?:solved|resolved|fixed)|no longer needed|request withdrawn|bounty (?:cancelled|canceled|paid out|claimed)|problem (?:solved|resolved)|issue has been (?:fixed|resolved)|closed as completed)\b|已解决|已取消|无需帮助/i.test(language);
  const deadlineMatch = language.match(/(?:deadline|due by|complete by|needed by|finish by|deliver by|closing date|截止(?:日期)?)\s*[:：]?\s*(20\d{2}-\d{2}-\d{2})\b/i);
  const deadlineAt = deadlineMatch?demandDeadline(deadlineMatch[1]):null;
  const expired = demandDeadlineExpired(deadlineAt,now);
  const closed = row.closed === true || resolved || expired;
  if (noPay) negativeEvidence.push('原文存在免费、无预算或拒绝付费表达；不认定付款意愿');
  if (seller) negativeEvidence.push('包含卖方推广或报价语境；不认定为买方请求');
  if (job) negativeEvidence.push('包含招聘/薪资语境；不纳入本轮按项目交付需求');
  if (hypothetical) negativeEvidence.push('包含市场调查或假设语境；付费表达需人工核验');
  if (aggregation) negativeEvidence.push('自动生成或二手机会汇总，未证明发布者是本次支付者；须另找买方原始任务');
  if (promotionalHeadline) negativeEvidence.push('标题为盈利机会/创业建议营销榜单；不是发布者的具体采购请求');
  if (securityBulletin) negativeEvidence.push('标题为安全公告/CVE 披露；不能将公告模板或技术描述当成委托方需求');
  if (zeroPay) negativeEvidence.push('存在零预算或零悬赏表达；不认定为付费交付请求');
  if (historicalPay) negativeEvidence.push('存在过往付费经历；不能作为本次付款承诺');
  if (quotedPay) negativeEvidence.push('付费表达可能来自引号、转述或引用段落；需人工核验真正委托方');
  if (closed) negativeEvidence.push(expired ? `原文日期窗口已过：${deadlineAt}（未知时区，保守宽限后判断）` : '公开状态为已关闭，或原文说明已解决/撤回');
  if (!row.publishedAt) negativeEvidence.push('发布时间未核验，不能证明是近90天请求');
  const explicit = !!paymentMatch && buyer && !noPay && !seller && !job && !hypothetical && !zeroPay && !historicalPay && !quotedPay && !closed && !nonBuyerPublication;
  const paymentEvidence = explicit ? 'explicit' : qualifiedProblem ? 'problem-only' : 'none';
  if (explicit) positiveEvidence.push(`买方付费表达：「${demandText(paymentMatch[0], 150)}」；金额、授权和是否仍开放需核验`);
  if (qualifiedProblem) positiveEvidence.push(buyer ? '原文出现具体求助/寻找解决方案语境' : '原文出现问题，但没有确认付款承诺');
  const offerId = nonBuyerPublication ? 'unknown' : demandOffer(language);
  if (offerId !== 'unknown') positiveEvidence.push(`可匹配交付类型：${offerId}；仍需确认实际范围`);
  if (deadlineAt && !expired) positiveEvidence.push(`原文明示日期窗口：${deadlineAt}；只知道日期，准确时区/时刻须核验`);
  const age = row.publishedAt ? Math.max(0, (now - Date.parse(row.publishedAt)) / demandDayMs) : Infinity;
  const urgent = /\b(?:urgent|asap|this week|tomorrow)\b|急需|尽快/i.test(language);
  const scoreBreakdown = { payment: explicit ? 45 : 0, problem: qualifiedProblem ? (buyer ? 20 : 10) : 0, urgency: closed||nonBuyerPublication?0:deadlineAt && !expired ? (Date.parse(deadlineAt)-now <= 7*demandDayMs ? 10 : 6) : urgent ? 4 : 0, fit: offerId !== 'unknown' ? 15 : 0, recency: age <= 2 ? 10 : age <= 7 ? 8 : age <= 30 ? 5 : age <= 90 ? 2 : 0 };
  const intentScore = Object.values(scoreBreakdown).reduce((sum, n) => sum+n, 0);
  const blocked = noPay || seller || job || closed || zeroPay || nonBuyerPublication;
  const action = blocked ? 'skip' : explicit && row.publishedAt && offerId !== 'unknown' && intentScore >= 60 ? 'verify' : qualifiedProblem || explicit ? 'watch' : 'skip';
  return { paymentEvidence, intentScore, scoreBreakdown, positiveEvidence, negativeEvidence, action, offerId, closed, deadlineAt, windowState: expired ? 'expired' : deadlineAt ? 'open' : 'unknown' };
}
function demandRows(body, source, now) {
  const data = JSON.parse(body);
  const raw = source.format === 'hn' ? data.hits : data.items;
  if (!Array.isArray(raw)) throw new Error('公开API返回格式异常');
  const rows = [];
  for (const value of raw.slice(0, 20)) {
    if (source.format === 'github-issues' && value.pull_request) continue;
    if (source.format === 'hn' && value._tags && !value._tags.includes('ask_hn')) continue;
    const publishedRaw = source.format === 'hn' ? value.created_at : value.created_at;
    const publishedAt = demandISO(publishedRaw, now);
    if (publishedRaw && Number.isFinite(Date.parse(publishedRaw)) && Date.parse(publishedRaw) > now+300000) continue;
    if (publishedAt && now-Date.parse(publishedAt) > 90*demandDayMs) continue;
    const url = demandURL(source.format === 'hn' ? `https://news.ycombinator.com/item?id=${value.objectID}` : value.html_url);
    const title = demandText(value.title, 240);
    if (!title || !url) continue;
    const text = demandText(source.format === 'hn' ? value.story_text : value.body, 6000);
    rows.push({title, url, text, publishedAt, updatedAt: demandISO(value.updated_at, now) || publishedAt, closed: source.format === 'github-issues' && value.state === 'closed', automated: source.format === 'github-issues' && value.user?.type === 'Bot', fingerprint: demandHash(`${title}\n${text}\n${value.state === 'closed' ? 'closed' : 'open'}`)});
  }
  return {rows, incomplete: data.incomplete_results === true || source.format === 'hn' && data.exhaustiveNbHits === false, totalAvailable: Number.isFinite(data.nbHits ?? data.total_count) ? Math.min(1000000, Math.max(0, data.nbHits ?? data.total_count)) : null};
}
async function demandBody(response, cap, signal) {
  if (Number(response.headers.get('content-length')) > cap) throw new Error('公开来源内容超过上限');
  if (!response.body) return '';
  const reader = response.body.getReader(), chunks = []; let size=0;
  try {
    while (true) { if (signal.aborted) throw new Error('公开来源请求超时'); const {value, done}=await reader.read(); if(done) break; size+=value.byteLength; if(size>cap) throw new Error('公开来源内容超过上限'); chunks.push(value); }
  } finally { if (signal.aborted || size>cap) await reader.cancel().catch(()=>{}); reader.releaseLock(); }
  const bytes=new Uint8Array(size); let offset=0; for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;} return new TextDecoder().decode(bytes);
}
async function demandCollectOne(source, now, fetcher, parentSignal) {
  const controller = new AbortController(); const abort=()=>controller.abort(); parentSignal.addEventListener('abort',abort,{once:true}); if(parentSignal.aborted)controller.abort(); const timer=setTimeout(abort,8500);
  try {
    const url=demandConfiguredURL(source,now);
    const response=await fetcher(url,{redirect:'manual',signal:controller.signal,headers:{Accept:'application/json','User-Agent':'Dayline-Demand-Scan/1.0 (bounded public query)'}});
    if(response.status>=300&&response.status<400) throw new Error('固定公开API重定向被拒绝');
    if(!response.ok){let retryAt=null;const seconds=Number(response.headers.get('retry-after'));const reset=Number(response.headers.get('x-ratelimit-reset'));if(seconds>0&&seconds<86400)retryAt=new Date(now+seconds*1000).toISOString();else if(reset*1000>now&&reset*1000<now+demandDayMs)retryAt=new Date(reset*1000).toISOString();return {ok:false,error:`公开API HTTP ${response.status}${response.status===403||response.status===429?'；可能权限限制或匿名限流':''}`,retryAt};}
    const parsed=demandRows(await demandBody(response,Math.min(1500000,Math.max(100000,source.maxBytes||1000000)),controller.signal),source,now);
    return {ok:true,...parsed};
  } catch(error) {return {ok:false,error:controller.signal.aborted?'本轮请求超时':demandText(error.message,150)};}
  finally {clearTimeout(timer);parentSignal.removeEventListener('abort',abort);}
}
export async function collectDemand(sources, now=Date.now(), fetcher=fetch) {
  if(!Array.isArray(sources)||sources.length>6||new Set(sources.map(s=>s.id)).size!==sources.length)throw new Error('需求扫描只接受最多6个不重复固定来源');
  const controller=new AbortController(), timer=setTimeout(()=>controller.abort(),22000), results=Array(sources.length);let index=0;
  const offset=sources.length?Math.floor(now/DEMAND_INTERVAL_MS)%sources.length:0;
  const run=async()=>{while(index<sources.length){const position=(index+++offset)%sources.length;results[position]=controller.signal.aborted?{ok:false,error:'全局采集期限已到，本轮未尝试'}:await demandCollectOne(sources[position],now,fetcher,controller.signal);}};
  try{await Promise.all(Array.from({length:Math.min(3,sources.length)},run));return results;}finally{clearTimeout(timer);}
}
function demandBoundedEvidence(value) { return Array.isArray(value)?value.filter(v=>typeof v==='string').slice(0,12).map(v=>demandText(v,240)):[]; }
function demandNormalizeItem(item,now) {
  const url=demandURL(item?.url); if(!url||item.id!==`demand-${demandHash(url)}`||!Object.hasOwn(demandDefinitions,item.sourceId)||!['explicit','problem-only','none'].includes(item.paymentEvidence))return null;
  const breakdown={};for(const [key,limit] of Object.entries({payment:45,problem:20,urgency:10,fit:15,recency:10})){const value=item.scoreBreakdown?.[key];if(!Number.isFinite(value)||value<0||value>limit)return null;breakdown[key]=value;}
  const publishedAt=demandISO(item.publishedAt,now), firstSeenAt=demandISO(item.firstSeenAt,now);if(now-Date.parse(publishedAt||firstSeenAt||0)>90*demandDayMs)return null;
  const deadlineAt=demandDeadline(item.deadlineAt);
  const expired=demandDeadlineExpired(deadlineAt,now); const closed=item.closed===true||expired;
  if(closed){breakdown.payment=0;breakdown.urgency=0;}
  return {id:item.id,title:demandText(item.title,240),url,sourceId:item.sourceId,sourceName:demandText(item.sourceName,150),publishedAt,updatedAt:demandISO(item.updatedAt,now),firstSeenAt,lastSeenAt:demandISO(item.lastSeenAt,now),excerpt:demandText(item.excerpt,1000),paymentEvidence:closed&&item.paymentEvidence==='explicit'?'problem-only':item.paymentEvidence,intentScore:Object.values(breakdown).reduce((sum,n)=>sum+n,0),scoreBreakdown:breakdown,positiveEvidence:demandBoundedEvidence(item.positiveEvidence),negativeEvidence:[...new Set([...demandBoundedEvidence(item.negativeEvidence),...(expired?['明确日期窗口已过，需停止追踪此交付窗口']:[])])],change:['new','changed','unchanged','retained'].includes(item.change)?item.change:'retained',action:closed?'skip':['verify','watch','skip'].includes(item.action)?item.action:'watch',offerId:['spreadsheet','research-pack','workflow','debugging','unknown'].includes(item.offerId)?item.offerId:'unknown',fingerprint:typeof item.fingerprint==='string'&&/^[0-9a-f]{16}$/.test(item.fingerprint)?item.fingerprint:demandHash(`${item.title}\n${item.excerpt}`),closed,deadlineAt,windowState:expired?'expired':deadlineAt?'open':'unknown'};
}
export function normalizeDemandSnapshot(old, now=Date.now()) {
  if(!old||old.schemaVersion!==1||!Array.isArray(old.items)||old.items.length>60||!Array.isArray(old.sources)||old.sources.length>6||!['fresh','partial','stale','unavailable'].includes(old.status))return null;
  const items=old.items.slice(0,60).map(item=>demandNormalizeItem(item,now)).filter(Boolean), seen=new Set();
  const sources=old.sources.slice(0,6).filter(s=>Object.hasOwn(demandDefinitions,s?.id)).map(s=>({id:s.id,name:demandText(s.name,150),url:typeof s.url==='string'?s.url:'',status:s.status==='ok'?'ok':'error',lastSuccessAt:demandISO(s.lastSuccessAt,now),lastAttemptAt:demandISO(s.lastAttemptAt,now),itemCount:Math.min(10000,Math.max(0,Number(s.itemCount)||0)),error:demandText(s.error,180),incomplete:s.incomplete===true,totalAvailable:Number.isFinite(s.totalAvailable)?s.totalAvailable:null,retryAt:demandScheduleDate(s.retryAt,now)}));
  const lastAttemptAt=demandISO(old.lastAttemptAt,now), status=['fresh','partial','stale','unavailable'].includes(old.status)?old.status:'unavailable';
  const sourceIds=new Set(sources.map(s=>s.id)),counts={};const safeItems=items.filter(item=>sourceIds.has(item.sourceId)&&!seen.has(item.id)&&seen.add(item.id)&&((counts[item.sourceId]=(counts[item.sourceId]||0)+1)<=10));
  return {schemaVersion:1,generatedAt:demandISO(old.generatedAt,now),lastAttemptAt,nextRefreshAt:demandScheduleDate(old.nextRefreshAt,now),status:status!=='unavailable'&&(!lastAttemptAt||now-Date.parse(lastAttemptAt)>=DEMAND_INTERVAL_MS)?'stale':status,items:safeItems,sources,meta:demandMeta(safeItems,sources,Math.min(60,Math.max(0,Number(old.meta?.newCount)||0)),Math.min(60,Math.max(0,Number(old.meta?.changedCount)||0)))};
}
function demandMeta(items,sources,newCount,changedCount) {
  return {algorithmVersion:DEMAND_ALGORITHM_VERSION,intervalHours:1,cloudIntervalHours:4,sourceCount:sources.length,successfulSources:sources.filter(s=>s.status==='ok').length,coverage:'6个固定英文公开查询：Ask HN与GitHub issues；每源最多20条、近90天，不覆盖全网、评论、私域或真实采购系统',scoreMeaning:'买方语境与人工核验优先级；不是付款概率、收入预测或成交保证',weights:{payment:45,problem:20,urgency:10,fit:15,recency:10},newCount,changedCount,actionableCount:items.filter(i=>i.action==='verify'&&i.change!=='retained').length,incompleteSources:sources.filter(s=>s.incomplete).length};
}
export function compileDemandSnapshot(results, previous, sources, now=Date.now()) {
  const old=normalizeDemandSnapshot(previous,now), oldByURL=new Map((old?.items||[]).map(item=>[item.url,item]));const candidates=[],health=[];
  for(let index=0;index<sources.length;index++){
    const source=sources[index],result=results[index],prior=old?.sources.find(s=>s.id===source.id);
    if(!Object.hasOwn(demandDefinitions,source.id))continue;
    health.push({id:source.id,name:demandText(source.name,150),url:source.url,status:result?.ok?'ok':'error',lastSuccessAt:result?.ok?new Date(now).toISOString():prior?.lastSuccessAt||null,lastAttemptAt:new Date(now).toISOString(),itemCount:result?.ok?result.rows.length:0,error:result?.ok?'':demandText(result?.error||'本轮未完成',180),incomplete:result?.incomplete===true,totalAvailable:result?.totalAvailable??null,retryAt:result?.retryAt||null});
    if(result?.ok){for(const row of result.rows){const url=demandURL(row.url);if(!url||row.publishedAt&&now-Date.parse(row.publishedAt)>90*demandDayMs)continue;const priorItem=oldByURL.get(url);const title=demandText(row.title,240),text=demandText(row.text,6000);const publishedAt=demandISO(row.publishedAt,now),updatedAt=demandISO(row.updatedAt,now)||publishedAt;const fingerprint=demandHash(`${title}\n${text}\n${row.closed?'closed':'open'}`);candidates.push({id:`demand-${demandHash(url)}`,title,url,sourceId:source.id,sourceName:demandText(source.name,150),publishedAt,updatedAt,firstSeenAt:priorItem?.firstSeenAt||new Date(now).toISOString(),lastSeenAt:new Date(now).toISOString(),excerpt:text.slice(0,1000),...demandClassify({title,text,publishedAt,closed:row.closed,automated:row.automated},now),fingerprint,change:!priorItem?'new':priorItem.fingerprint!==fingerprint?'changed':'unchanged'});}}
    else for(const priorItem of old?.items||[]){if(priorItem.sourceId!==source.id)continue;const negativeEvidence=[...new Set([...priorItem.negativeEvidence,'本轮来源失败，历史请求尚未再次核验'])];const scoreBreakdown={...priorItem.scoreBreakdown,payment:Math.min(20,priorItem.scoreBreakdown.payment),recency:0};candidates.push({...priorItem,change:'retained',action:priorItem.closed||priorItem.action==='skip'?'skip':'watch',negativeEvidence,scoreBreakdown,intentScore:Object.values(scoreBreakdown).reduce((sum,n)=>sum+n,0)});}
  }
  const unique=new Map();for(const item of candidates){const existing=unique.get(item.url);if(!existing||existing.change==='retained'&&item.change!=='retained'||existing.change!=='retained'&&item.change!=='retained'&&String(item.updatedAt||'')>String(existing.updatedAt||''))unique.set(item.url,item);}
  const counts={};const items=[...unique.values()].sort((a,b)=>(a.action==='verify'?0:a.action==='watch'?1:2)-(b.action==='verify'?0:b.action==='watch'?1:2)||b.intentScore-a.intentScore||a.id.localeCompare(b.id)).filter(item=>((counts[item.sourceId]=(counts[item.sourceId]||0)+1)<=10)).slice(0,60);
  const ok=health.filter(s=>s.status==='ok').length,newCount=items.filter(i=>i.change==='new').length,changedCount=items.filter(i=>i.change==='changed').length;
  return {schemaVersion:1,generatedAt:ok?new Date(now).toISOString():old?.generatedAt||null,lastAttemptAt:new Date(now).toISOString(),nextRefreshAt:new Date(Math.max(now+DEMAND_INTERVAL_MS,...health.map(s=>Date.parse(s.retryAt)||0))).toISOString(),status:ok===sources.length&&sources.length?'fresh':ok?'partial':items.length?'stale':'unavailable',items,sources:health,meta:demandMeta(items,health,newCount,changedCount)};
}
