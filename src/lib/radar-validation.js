const TOPIC_IDS = new Set(['vertical-ai', 'ai-reliability', 'global-b2b', 'cybersecurity', 'ageing-operations', 'ai-energy', 'deeptech-transfer']);
const SIGNAL_LABELS = { release: '产品发布', research: '研究进展', policy: '政策信号', commercial: '商业进展', industry: '行业观察' };
const SCORE_LABELS = { recency: '新近程度', evidence: '证据质量', convergence: '同主题信号', access: '进入便利' };

function cleanText(value, max, optional = false) {
  if (optional && (value === undefined || value === null)) return '';
  if (typeof value !== 'string' || value.length > max || (!optional && !value.trim())) throw new Error('雷达响应格式不完整');
  return value.trim();
}
function cleanId(value) {
  const id = cleanText(value, 100);
  if (!/^[a-zA-Z0-9][a-zA-Z0-9:_-]*$/.test(id) || ['constructor', 'prototype', '__proto__'].includes(id)) throw new Error('雷达标识格式不正确');
  return id;
}
function cleanURL(value) {
  const url = new URL(cleanText(value, 2048));
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) throw new Error('雷达来源链接不正确');
  return url.href;
}
function cleanDate(value) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value !== 'string' || value.length > 40 || !/^\d{4}-\d{2}-\d{2}(?:T|$)/.test(value) || !Number.isFinite(Date.parse(value))) throw new Error('雷达日期格式不正确');
  return value;
}
function cleanNumber(value, max = 100) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > max) throw new Error('雷达评分格式不正确');
  return value;
}
function cleanTopics(value) {
  if (!Array.isArray(value) || value.length > 20) throw new Error('雷达主题格式不正确');
  return [...new Set(value.map(cleanId))].filter(id => TOPIC_IDS.has(id));
}

// Build a bounded, plain response; cached and remote data pass the same checks.
export function validateRadarResponse(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input) || input.schemaVersion !== 1 || !['fresh', 'partial', 'stale', 'unavailable'].includes(input.status)) throw new Error('暂不支持这份雷达数据');
  if (!Array.isArray(input.items) || input.items.length > 80 || !Array.isArray(input.sources) || input.sources.length > 40 || !Array.isArray(input.topics) || input.topics.length > 7) throw new Error('雷达数据数量不正确');
  const topics = input.topics.map(topic => {
    const id = cleanId(topic?.id);
    if (!TOPIC_IDS.has(id)) throw new Error('雷达主题不受支持');
    return { id, label: cleanText(topic.label, 100), experiment: cleanText(topic.experiment, 4000), stopRule: cleanText(topic.stopRule, 1500), profitHypothesis: cleanText(topic.profitHypothesis, 3000) };
  });
  const sources = input.sources.map(source => {
    if (!['ok', 'error'].includes(source?.status)) throw new Error('来源状态不正确');
    return { id: cleanId(source.id), name: cleanText(source.name, 150), url: cleanURL(source.url), status: source.status, lastSuccessAt: cleanDate(source.lastSuccessAt), itemCount: cleanNumber(source.itemCount, 10000), error: cleanText(source.error, 500, true) };
  });
  const items = input.items.map(item => {
    if (!Object.hasOwn(SIGNAL_LABELS, item?.signalType)) throw new Error('信号类型不正确');
    return {
      id: cleanId(item.id), title: cleanText(item.title, 1000), url: cleanURL(item.url), sourceId: cleanId(item.sourceId), sourceName: cleanText(item.sourceName, 150), publishedAt: cleanDate(item.publishedAt), dateLabel: cleanText(item.dateLabel ?? '原文发布日期', 60),
      ...(item.sourceURL !== undefined && item.sourceURL !== null ? { sourceURL: cleanURL(item.sourceURL) } : {}),
      topics: cleanTopics(item.topics), signalType: item.signalType, summary: cleanText(item.summary, 5000, true), score: cleanNumber(item.score),
      scoreBreakdown: Object.fromEntries(Object.keys(SCORE_LABELS).map(key => [key, cleanNumber(item.scoreBreakdown?.[key])])), matchedTopics: cleanTopics(item.matchedTopics), evidenceLabel: cleanText(item.evidenceLabel, 500),
    };
  });
  for (const collection of [topics, sources, items]) if (new Set(collection.map(item => item.id)).size !== collection.length) throw new Error('雷达数据包含重复标识');
  const sourceIds = new Set(sources.map(source => source.id));
  if (items.some(item => !sourceIds.has(item.sourceId))) throw new Error('雷达信号缺少来源');
  const meta = input.meta;
  if (!meta || typeof meta !== 'object' || Array.isArray(meta)) throw new Error('雷达更新信息不完整');
  if (meta.refreshing !== undefined && typeof meta.refreshing !== 'boolean') throw new Error('雷达采集状态不正确');
  const weights = Object.fromEntries(Object.entries({ recency: 30, evidence: 25, convergence: 25, access: 20 }).map(([key, fallback]) => [key, meta.weights?.[key] === undefined ? fallback : cleanNumber(meta.weights[key])]));
  return {
    schemaVersion: 1, generatedAt: cleanDate(input.generatedAt), lastAttemptAt: cleanDate(input.lastAttemptAt), nextRefreshAt: cleanDate(input.nextRefreshAt), status: input.status, items, sources, topics,
    meta: { intervalHours: cleanNumber(meta.intervalHours, 168), scheduledIntervalHours: cleanNumber(meta.scheduledIntervalHours, 168), algorithmVersion: cleanText(meta.algorithmVersion, 50), refreshing: meta.refreshing ?? false, weights },
  };
}

