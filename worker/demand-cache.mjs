import { DEMAND_INTERVAL_MS, DEMAND_ALGORITHM_VERSION, collectDemand, compileDemandSnapshot, normalizeDemandSnapshot } from './demand-core.mjs';
import demandSources from '../src/data/demand-sources.json' with { type: 'json' };

const DEMAND_SNAPSHOT_KEY = 'demand/snapshot-v1.json';
const DEMAND_LEASE_KEY = 'demand/lease-v1.json';
const demandInflight = new WeakMap();
const demandHeaders = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' };

function demandUnavailable(message) {
  return { schemaVersion: 1, generatedAt: null, lastAttemptAt: null, nextRefreshAt: null, status: 'unavailable', items: [], sources: demandSources.map(s => ({ id: s.id, name: s.name, url: s.url, status: 'error', lastSuccessAt: null, lastAttemptAt: null, itemCount: 0, error: message })), meta: { algorithmVersion: DEMAND_ALGORITHM_VERSION, intervalHours: 1, successfulSources: 0, scoreMeaning: '需求核实优先级，不代表付费或盈利概率', error: message } };
}

async function demandRead(bucket) {
  const object = await bucket.get(DEMAND_SNAPSHOT_KEY);
  if (!object) return null;
  return normalizeDemandSnapshot(await object.json(), Date.now());
}

async function demandRefresh(bucket, previous, now) {
  const lease = await bucket.get(DEMAND_LEASE_KEY);
  let last = 0;
  if (lease) { try { last = Number((await lease.json()).attemptedAt) || 0; } catch { /* Invalid lease can be replaced conditionally. */ } }
  if (now - last < DEMAND_INTERVAL_MS) return { ...(previous || demandUnavailable('另一轮检索尚未完成')), nextRefreshAt: new Date(last + DEMAND_INTERVAL_MS).toISOString() };
  const granted = await bucket.put(DEMAND_LEASE_KEY, JSON.stringify({ attemptedAt: now }), { onlyIf: lease ? { etagMatches: lease.etag } : new Headers({ 'If-None-Match': '*' }), httpMetadata: { contentType: 'application/json' } });
  if (!granted) return previous || demandUnavailable('另一轮检索正在运行，请稍后检查');
  const results = await collectDemand(demandSources, now);
  const snapshot = compileDemandSnapshot(results, previous, demandSources, now);
  await bucket.put(DEMAND_SNAPSHOT_KEY, JSON.stringify(snapshot), { httpMetadata: { contentType: 'application/json', cacheControl: 'no-store' } });
  return snapshot;
}

export async function demandResponse(request, env, ctx) {
  if (request.method !== 'GET') return Response.json({ error: '仅允许读取公开需求线索' }, { status: 405, headers: { ...demandHeaders, Allow: 'GET' } });
  const url = new URL(request.url);
  if ([...url.searchParams.keys()].some(k => k !== 'wait') || url.searchParams.has('wait') && url.searchParams.get('wait') !== '1') return Response.json({ error: '仅使用固定公开来源，不接受自定义网址或查询' }, { status: 400, headers: demandHeaders });
  const bucket = env.BUCKET;
  if (!bucket?.get || !bucket?.put) return Response.json(demandUnavailable('持久存储未配置，检索未运行'), { status: 503, headers: demandHeaders });
  try {
    const now = Date.now();
    const previous = await demandRead(bucket);
    const due = (!previous?.lastAttemptAt || now - Date.parse(previous.lastAttemptAt) >= DEMAND_INTERVAL_MS) && (!previous?.nextRefreshAt || now >= Date.parse(previous.nextRefreshAt));
    if (!due) return Response.json(previous, { headers: demandHeaders });
    let pending = demandInflight.get(bucket);
    if (!pending) { pending = demandRefresh(bucket, previous, now).finally(() => demandInflight.delete(bucket)); demandInflight.set(bucket, pending); }
    if (previous && url.searchParams.get('wait') !== '1' && ctx?.waitUntil) {
      ctx.waitUntil(pending.catch(() => {}));
      return Response.json({ ...previous, meta: { ...previous.meta, refreshing: true } }, { headers: demandHeaders });
    }
    return Response.json(await pending, { headers: demandHeaders });
  } catch { return Response.json(demandUnavailable('检索或持久存储暂不可用，未声称更新成功'), { status: 503, headers: demandHeaders }); }
}
