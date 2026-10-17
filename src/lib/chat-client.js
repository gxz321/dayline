import {storageKey} from './deployment.js';
import { completionKey, eventsForDate } from './calendar.js';
import { nextActions } from './next-actions.js';

export const CHAT_STORAGE_KEY = storageKey('dayline:assistant-chat:v1');
export const CHAT_MAX_MESSAGES = 20;
export const CHAT_MAX_CONTENT = 2000;
export const CHAT_MAX_REPLY = 8000;
export const CHAT_WIRE_CONTENT = 12000;
const MAX_STORAGE_BYTES = 200000;
const RESERVED = new Set(['__proto__', 'constructor', 'prototype']);
const CONTROLS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g;
const record = v => v && typeof v === 'object' && !Array.isArray(v) && Object.getPrototypeOf(v) === Object.prototype;
export function chatText(value, limit = CHAT_MAX_CONTENT) {
  return typeof value === 'string' ? value.replace(CONTROLS, '').slice(0, limit).replace(/[\uD800-\uDBFF]$/, '') : '';
}
export function chatId(cryptoObject = globalThis.crypto) {
  if (cryptoObject?.randomUUID) return cryptoObject.randomUUID();
  const bytes = new Uint8Array(16);
  if (!cryptoObject?.getRandomValues) throw new Error('当前浏览器不支持安全请求标识，请使用最新版 Safari。');
  cryptoObject.getRandomValues(bytes); bytes[6] = (bytes[6] & 15) | 64; bytes[8] = (bytes[8] & 63) | 128;
  const h = [...bytes].map(b => b.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
export function validateChatMessages(input) {
  if (!Array.isArray(input)) return [];
  const seen = new Set();
  return input.slice(-CHAT_MAX_MESSAGES).flatMap(item => {
    if (!record(item) || !['user', 'assistant'].includes(item.role) || typeof item.id !== 'string' || !/^[a-zA-Z0-9_-]{1,80}$/.test(item.id) || RESERVED.has(item.id)) return [];
    if (seen.has(item.id) || typeof item.content !== 'string' || !item.content.trim() || typeof item.at !== 'string' || !Number.isFinite(Date.parse(item.at))) return [];
    seen.add(item.id);
    return [{ id: item.id, role: item.role, content: chatText(item.content, item.role === 'assistant' ? CHAT_MAX_REPLY : CHAT_MAX_CONTENT), at: new Date(item.at).toISOString() }];
  });
}
export function loadChat(storage) {
  try {
    const raw = storage?.getItem(CHAT_STORAGE_KEY);
    if (!raw) return { messages: [], error: '' };
    if (raw.length > MAX_STORAGE_BYTES) return { messages: [], error: '本地会话超出容量，本次未载入。可清空后重新开始。' };
    const data = JSON.parse(raw);
    if (!record(data) || data.schemaVersion !== 1 || !Array.isArray(data.messages)) throw new Error('invalid');
    const messages = validateChatMessages(data.messages);
    if (messages.length !== Math.min(data.messages.length, CHAT_MAX_MESSAGES)) throw new Error('invalid');
    return { messages, error: '' };
  } catch { return { messages: [], error: '本地会话无法读取，本次聊天仍可使用。原记录尚未覆盖。' }; }
}
export function saveChat(storage, messages) {
  try {
    const normalized = validateChatMessages(messages);
    const value = JSON.stringify({ schemaVersion: 1, messages: normalized });
    if (value.length > MAX_STORAGE_BYTES) throw new Error('large');
    storage.setItem(CHAT_STORAGE_KEY, value);
    return '';
  } catch { return '会话未能保存在这台设备上，请及时导出。'; }
}
export function chatExport(messages) {
  return JSON.stringify({ schemaVersion: 1, application: '序 · Dayline 助手', exportedAt: new Date().toISOString(), messages: validateChatMessages(messages) }, null, 2);
}
export function validateChatStatus(input) {
  if (!record(input)) throw new Error('助手状态格式不正确');
  for (const key of ['authenticated', 'configured', 'enabled', 'allowed']) if (typeof input[key] !== 'boolean') throw new Error('助手状态缺少必要字段');
  const safeLogin = typeof input.signInUrl === 'string' && /^\/signin-with-chatgpt(?:\?[^\s#]*)?$/.test(input.signInUrl) && input.signInUrl.length < 1000 ? input.signInUrl : '/signin-with-chatgpt?returnTo=%2F';
  const daily = Number.isInteger(input.limits?.daily) && input.limits.daily >= 0 && input.limits.daily <= 1000 ? input.limits.daily : null;
  const remaining = Number.isInteger(input.limits?.remaining) && input.limits.remaining >= 0 && input.limits.remaining <= 1000 ? input.limits.remaining : null;
  return { authenticated: input.authenticated, configured: input.configured, enabled: input.enabled, allowed: input.allowed,
    provider: chatText(input.provider, 40), model: chatText(input.model, 80), reason: chatText(input.reason, 300), signInUrl: safeLogin,
    limits: { daily, remaining } };
}
export function validateChatReply(input, expectedRequestId) {
  if (!record(input) || input.requestId !== expectedRequestId || typeof input.reply !== 'string' || !input.reply.trim() || input.reply.length > 16000) throw new Error('助手返回格式不正确');
  const reply = chatText(input.reply, CHAT_MAX_REPLY);
  return { reply, requestId: expectedRequestId, provider: chatText(input.provider, 40), model: chatText(input.model, 80), remaining: Number.isInteger(input.remaining) && input.remaining >= 0 && input.remaining <= 1000 ? input.remaining : null };
}
export function chatError(input, httpStatus) {
  const code = record(input) ? chatText(input.code, 60) : '';
  const byCode = {
    sign_in: '请先登录自己的账号，再使用私人 AI 对话。',
    not_allowed: '这个账号未加入私人 AI 白名单，请使用获授权账号。',
    origin: '请从 Dayline 本站打开助手后发送消息。',
    invalid_request: '消息格式无效或超过限制，请缩短问题后再发送。',
    content_type: '消息格式未通过检查，请刷新页面后再发送。',
    not_configured: '服务端模型尚未配置或启用，可先使用网页 AI 或计划工具。',
    storage: '额度记录暂不可用，本次未调用模型，请稍后检查服务配置。',
    busy: '上一条消息仍在处理中，请等待结束后再发送。',
    cooldown: '发送间隔过短，请等待提示的时间后再发送。',
    daily_limit: '今天的 Dayline 对话次数已用完，可先使用网页 AI 或计划工具。',
    duplicate: '这条请求已登记或处理，为防重复计费不会自动重发。',
    provider_auth: '模型服务未接受服务端密钥，请核对密钥及所属地域或项目。',
    provider_quota: '模型账户余额、账单或额度上限受限，请检查服务商账单与限额；连续重试不会恢复额度。',
    provider_free_quota: '模型免费额度已用完并停止调用，请在服务商控制台检查免费额度和计费选项。',
    provider_rate_limit: '模型服务触发请求或 Token 速率限制，请降低发送频率后再试。',
    provider_access: '模型或项目暂不可访问，请检查模型名称、账号权限及服务地域。',
    provider_network: '服务器未取得模型服务的响应，请检查服务端网络；无法确认请求是否已被模型接收，勿连续重发。',
    provider_limit: '模型账户额度或速率受限，请检查服务商额度与限流设置。',
    provider_failed: '模型调用未完成，可检查服务商状态与服务配置；不会自动重试。',
    timeout: '模型响应超时。请求可能已计费，请先查看状态，再决定是否发起新问题。',
  };
  const known = {
    400: '这次问题未通过格式检查，请缩短后重新发送。', 401: '需要先登录，才能使用私人 AI 对话。',
    403: '这个账号目前没有私人 AI 的使用权限。', 409: '这条请求已处理或仍在处理中，请勿重复发送。',
    429: '已达到请求频率或每日上限，请稍后再试。', 503: 'AI 服务尚未就绪，可先使用计划工具。',
    504: '模型响应超时。请求可能已计费，请先查看状态，再决定是否发起新问题。',
  };
  return { message: Object.hasOwn(byCode, code) ? byCode[code] : known[httpStatus] || '本次连接没有完成。请求可能已到达模型，请勿连续重复发送。', code: Object.hasOwn(byCode, code) ? code : '',
    maybeCharged: input?.maybeCharged === true || httpStatus >= 500 && httpStatus !== 503,
    retryAfter: Number.isInteger(input?.retryAfter) && input.retryAfter > 0 && input.retryAfter <= 86400 ? input.retryAfter : null };
}
export function planContext(state, date) {
  const events = eventsForDate(state, date).filter(event => event.category !== 'sleep').slice(0, 12).map(event => ({ title: chatText(event.title, 120), start: event.start, end: event.end, completed: !!state.completed?.[completionKey(event, date)] }));
  const tasks = nextActions(state, date, { limit: 8 }).map(({ goal, step }) => ({ title: chatText(`${step.title} · ${goal.label || goal.title}`, 180), minutes: step.estimateMinutes }));
  const goals = (state.goals || []).filter(goal => !goal.completed).slice(0, 6).map(goal => ({ title: chatText(goal.title, 120), due: /^\d{4}-\d{2}-\d{2}$/.test(goal.due) ? goal.due : null }));
  return { date, events, tasks, goals };
}
export function nextPlanStep(state, date, time = '00:00') {
  const list = eventsForDate(state, date).filter(event => event.category !== 'sleep' && !state.completed?.[completionKey(event, date)]);
  const current = list.find(event => event.start <= time && event.end > time);
  const next = current || list.find(event => event.start >= time) || null;
  return { next, missed: list.filter(event => event.end <= time).length, remaining: list.length, events: list };
}
export function createChatPayload(messages, context, requestId = chatId()) {
  const valid = validateChatMessages(messages);
  if (!valid.length || valid.at(-1).role !== 'user') throw new Error('请先输入一个问题。');
  const selected = []; let total = 0;
  for (let index = valid.length - 1; index >= 0; index -= 1) {
    const { role } = valid[index], content = chatText(valid[index].content);
    if (total + content.length > CHAT_WIRE_CONTENT) break;
    selected.unshift({ role, content }); total += content.length;
  }
  while (selected.length > 1 && selected[0].role === 'assistant') selected.shift();
  return { requestId, messages: selected, ...(context ? { context } : {}) };
}
export function replyTaskDraft(reply) {
  const detail = chatText(reply, 2000);
  const first = detail.split(/\r?\n/).map(line => line.replace(/^\s*(?:#{1,6}\s*|[-*+]\s+|\d+[.)、]\s*)/, '').replace(/[*_`]/g, '').trim()).find(line => line && !/^```/.test(line));
  return { title: chatText(first || '讨论后的下一步', 90), detail, minutes: 25 };
}
