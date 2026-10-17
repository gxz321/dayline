const DEMAND_STATES = new Set(['fresh', 'partial', 'stale', 'unavailable']);
const DEMAND_OFFERS = new Set(['spreadsheet', 'research-pack', 'workflow', 'debugging', 'unknown']);
function dText(value, max = 1000, optional = false) {
  if (optional && value == null) return '';
  if (typeof value !== 'string' || value.length > max || !optional && !value.trim()) throw new Error('需求线索格式不完整');
  return value.trim();
}
function dId(value) { const id = dText(value, 100); if (!/^[a-zA-Z0-9][a-zA-Z0-9:_-]*$/.test(id) || ['constructor', '__proto__', 'prototype'].includes(id)) throw new Error('线索标识不正确'); return id; }
function dURL(value) { const u = new URL(dText(value, 2048)); if (u.protocol !== 'https:' || u.username || u.password || u.port) throw new Error('来源链接不正确'); return u.href; }
function dDate(value) { if (value == null || value === '') return null; if (typeof value !== 'string' || value.length > 40 || !/^\d{4}-\d{2}-\d{2}T/.test(value) || !Number.isFinite(Date.parse(value))) throw new Error('线索时间格式不正确'); return value; }
function dDeadline(value) { if (value == null || value === '') return null; if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error('截止日期格式不正确'); const parsed=new Date(`${value}T00:00:00Z`); if (!Number.isFinite(parsed.getTime()) || !parsed.toISOString().startsWith(value)) throw new Error('截止日期不存在'); return value; }
function dNumber(value, max = 100) { if (!Number.isFinite(value) || typeof value !== 'number' || value < 0 || value > max) throw new Error('线索统计格式不正确'); return value; }
function dList(value) { if (!Array.isArray(value) || value.length > 20) throw new Error('线索证据格式不正确'); return value.map(v => dText(v, 500)); }

export function validateDemandResponse(input) {
  if (!input || input.schemaVersion !== 1 || !DEMAND_STATES.has(input.status) || !Array.isArray(input.items) || input.items.length > 60 || !Array.isArray(input.sources) || input.sources.length > 6) throw new Error('暂不支持这份需求数据');
  const sources = input.sources.map(s => {
    if (!['ok', 'error'].includes(s.status)) throw new Error('来源状态不正确');
    return { id: dId(s.id), name: dText(s.name, 180), url: dURL(s.url), status: s.status, lastSuccessAt: dDate(s.lastSuccessAt), lastAttemptAt: dDate(s.lastAttemptAt), itemCount: dNumber(s.itemCount, 10000), error: dText(s.error, 500, true) };
  });
  const items = input.items.map(i => {
    if (!['explicit', 'problem-only', 'none'].includes(i.paymentEvidence) || !['verify', 'watch', 'skip'].includes(i.action) || !['new', 'changed', 'unchanged', 'retained'].includes(i.change) || !DEMAND_OFFERS.has(i.offerId) || typeof i.closed !== 'boolean') throw new Error('线索判断格式不正确');
    return { id: dId(i.id), title: dText(i.title, 1000), url: dURL(i.url), sourceId: dId(i.sourceId), sourceName: dText(i.sourceName, 180), publishedAt: dDate(i.publishedAt), updatedAt: dDate(i.updatedAt), firstSeenAt: dDate(i.firstSeenAt), lastSeenAt: dDate(i.lastSeenAt), excerpt: dText(i.excerpt, 1000, true), paymentEvidence: i.paymentEvidence, intentScore: dNumber(i.intentScore), scoreBreakdown: Object.fromEntries(['payment', 'problem', 'urgency', 'fit', 'recency'].map(k => [k, dNumber(i.scoreBreakdown?.[k])])), positiveEvidence: dList(i.positiveEvidence), negativeEvidence: dList(i.negativeEvidence), change: i.change, action: i.action, offerId: i.offerId, fingerprint: dText(i.fingerprint, 100), closed: i.closed, deadlineAt: dDeadline(i.deadlineAt), windowState: ['open', 'expired', 'unknown'].includes(i.windowState) ? i.windowState : 'unknown' };
  });
  for (const rows of [sources, items]) if (new Set(rows.map(i => i.id)).size !== rows.length) throw new Error('线索包含重复标识');
  const sourceIDs = new Set(sources.map(s => s.id));
  if (items.some(i => !sourceIDs.has(i.sourceId))) throw new Error('线索缺少来源');
  return { schemaVersion: 1, generatedAt: dDate(input.generatedAt), lastAttemptAt: dDate(input.lastAttemptAt), nextRefreshAt: dDate(input.nextRefreshAt), status: input.status, items, sources, meta: { algorithmVersion: dText(input.meta?.algorithmVersion, 100), refreshing: input.meta?.refreshing === true, scoreMeaning: dText(input.meta?.scoreMeaning || '需求核实优先级，不是盈利概率', 500) } };
}

export function effectiveHourly(price, deliveryMinutes, preparationMinutes, acquisitionMinutes, directCost = 0) {
  const values = [price, deliveryMinutes, preparationMinutes, acquisitionMinutes, directCost];
  if (values.some(v => typeof v !== 'number' || !Number.isFinite(v) || v < 0)) return null;
  const minutes = deliveryMinutes + preparationMinutes + acquisitionMinutes;
  return minutes > 0 ? (price - directCost) * 60 / minutes : null;
}

export function offerExperiment(offer, item = null) {
  return { id: item ? `deal-${item.id}` : `offer-${offer.id}`, title: item ? `${offer.title} · 需求核实` : offer.title, experiment: `${offer.experiment}\n\n交付范围：${offer.deliverable}\n试验报价：${offer.priceTest}\n验收：${offer.acceptance.join('；')}\n售前问题：${offer.questions.join('；')}${item ? `\n\n原帖证据：${item.title}\n链接：${item.url}\n证据等级：${item.paymentEvidence === 'explicit' ? '原文出现付费意愿，尚未验证成交' : '只有问题表达，支付意愿未知'}\n风险：${item.negativeEvidence.join('；') || '需核实问题是否仍存在和谁能批准预算'}` : ''}`, stopRule: offer.stopRule };
}
