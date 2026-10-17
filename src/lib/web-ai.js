import { chatText } from './chat-client.js';

export const WEB_QUESTION_LIMIT = 2000;
export const WEB_REPLY_LIMIT = 8000;
export const WEB_PROMPT_LIMIT = 7600;
export const WEB_PROVIDERS = Object.freeze([
  Object.freeze({ id: 'chatgpt', name: 'ChatGPT', mark: 'G', url: 'https://chatgpt.com/', note: '在你自己的 ChatGPT 账号中继续', tone: 'sage' }),
  Object.freeze({ id: 'qianwen', name: '通义千问', mark: 'Q', url: 'https://www.qianwen.com/', note: '使用通义官方网页与账号', tone: 'violet' }),
  Object.freeze({ id: 'deepseek', name: 'DeepSeek', mark: 'D', url: 'https://chat.deepseek.com/', note: '使用 DeepSeek 官方网页与账号', tone: 'blue' }),
]);
const line = (value, max) => chatText(value, max).replace(/[\r\n\t]+/g, ' ').trim();
const validDate = value => {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
};
const validTime = value => typeof value === 'string' && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value);

/** Build inspectable plain text only. Website URLs never contain questions or context. */
export function buildWebPrompt(question, context) {
  const cleanQuestion = chatText(question, WEB_QUESTION_LIMIT).trim();
  if (!cleanQuestion) return '';
  const pieces = [
    '请用中文和我讨论下面的问题。先抓住关键约束，区分已知事实与推测，再给出可执行的建议；信息不足时请直说。',
    `我的问题：\n${cleanQuestion}`,
  ];
  if (context && validDate(context.date)) {
    const lines = [`以下是我本次主动提供的有限计划摘要（日期：${context.date}）。这不是实时连接；不能访问或修改 Dayline。`];
    const events = (Array.isArray(context.events) ? context.events : []).slice(0, 12).flatMap(item => {
      if (!item || !validTime(item.start) || !(validTime(item.end) || item.end === '24:00') || item.end <= item.start) return [];
      const title = line(item.title, 120);
      return title ? [`${item.start}–${item.end} ${title}［${item.completed === true ? '已完成' : '未完成'}］`] : [];
    });
    const tasks = (Array.isArray(context.tasks) ? context.tasks : []).slice(0, 8).flatMap(item => {
      if (!item) return [];
      const title = line(item.title, 180);
      const minutes = Number.isInteger(item.minutes) && item.minutes >= 1 && item.minutes <= 480 ? `（约 ${item.minutes} 分钟）` : '';
      return title ? [`${title}${minutes}`] : [];
    });
    const goals = (Array.isArray(context.goals) ? context.goals : []).slice(0, 6).flatMap(item => {
      if (!item) return [];
      const title = line(item.title, 120);
      return title ? [`${title}${validDate(item.due) ? `（目标日期 ${item.due}）` : ''}`] : [];
    });
    if (events.length) lines.push(`当日安排：\n${events.map(item => `• ${item}`).join('\n')}`);
    if (tasks.length) lines.push(`接下来可推进的步骤：\n${tasks.map(item => `• ${item}`).join('\n')}`);
    if (goals.length) lines.push(`尚在推进的目标：\n${goals.map(item => `• ${item}`).join('\n')}`);
    pieces.push(lines.join('\n\n'));
  }
  return chatText(pieces.join('\n\n'), WEB_PROMPT_LIMIT);
}
