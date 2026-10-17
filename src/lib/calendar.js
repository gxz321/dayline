import {normalizeTaskProgress} from './next-actions.js';
/** Pure calendar/data helpers. All dates are local calendar dates in Asia/Shanghai. */
const DAY_MS = 86400000;
const WEEKDAYS = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];
export const CATEGORY_CODES = Object.freeze([
  'life', 'buffer', 'research', 'study', 'relationship', 'exercise', 'course',
  'tutoring', 'commute', 'english', 'application', 'review', 'date',
  'custom', 'opportunity', 'sleep',
]);
const GROWTH_CODES = new Set(['research', 'study', 'english', 'application', 'review', 'opportunity']);
const CATEGORIES = new Set(CATEGORY_CODES);
const RESERVED = new Set(['__proto__', 'prototype', 'constructor']);

function fail(message) { throw new Error(message); }
function plain(value, label = '对象') {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) fail(`${label}格式不正确`);
  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) fail(`${label}必须是普通对象`);
  return value;
}
function boundedNumber(value, label, min = 0, max = 100000000, integer = false) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max || (integer && !Number.isInteger(value))) {
    fail(`${label}必须是${min}至${max}之间的${integer ? '整数' : '有限数值'}`);
  }
  return value;
}
function text(value, label, max = 6000, empty = true) {
  if (typeof value !== 'string' || value.length > max || (!empty && !value.trim())) fail(`${label}字数或类型不正确`);
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value)) fail(`${label}含有控制字符`);
  if (/<\/?[a-z!]|javascript\s*:|data\s*:\s*text\/html|\bon[a-z]+\s*=/i.test(value)) fail(`${label}不能包含可执行 HTML 内容`);
  return value;
}
function id(value, label = 'ID') {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9:_-]{0,99}$/.test(value) || RESERVED.has(value)) fail(`${label}格式不正确`);
  return value;
}
function bool(value, label, fallback = false) {
  if (value === undefined) return fallback;
  if (typeof value !== 'boolean') fail(`${label}必须是布尔值`);
  return value;
}
function choice(value, options, label, fallback) {
  const result = value === undefined ? fallback : value;
  if (!options.includes(result)) fail(`${label}取值不正确`);
  return result;
}

/** Reject non-JSON objects/accessors and dangerous keys at every depth before reading data. */
function safeClone(input) {
  let nodes = 0;
  function visit(value, depth) {
    nodes += 1;
    if (nodes > 250000 || depth > 12) fail('导入数据过大或嵌套过深');
    if (value === null || typeof value === 'boolean') return value;
    if (typeof value === 'number') {
      if (!Number.isFinite(value)) fail('导入数据含有非有限数值');
      return value;
    }
    if (typeof value === 'string') {
      if (value.length > 12000) fail('导入数据的文字过长');
      return value;
    }
    if (Array.isArray(value)) {
      if (Object.getPrototypeOf(value) !== Array.prototype) fail('导入数组原型不正确');
      if (value.length > 20000) fail('导入数组过大');
      const descriptors = Object.getOwnPropertyDescriptors(value);
      for (const [key, descriptor] of Object.entries(descriptors)) {
        if (RESERVED.has(key) || descriptor.get || descriptor.set) fail('导入数组含有不安全字段');
        if (key !== 'length' && !/^\d+$/.test(key)) fail('导入数组含有额外字段');
      }
      const result = [];
      for (let index = 0; index < value.length; index += 1) {
        const descriptor = descriptors[String(index)];
        if (!descriptor || descriptor.value === undefined) fail('导入数组不能包含空项');
        result.push(visit(descriptor.value, depth + 1));
      }
      return result;
    }
    plain(value, '导入数据');
    const descriptors = Object.getOwnPropertyDescriptors(value);
    if (Object.keys(descriptors).length > 20000) fail('导入对象字段过多');
    const result = {};
    for (const [key, descriptor] of Object.entries(descriptors)) {
      if (RESERVED.has(key) || descriptor.get || descriptor.set) fail('导入数据含有不安全字段');
      if (key.length > 256) fail('导入数据字段名称过长');
      // Match JSON.stringify for optional fields produced by the React editor.
      // Array holes/undefined entries remain invalid JSON data.
      if (descriptor.value === undefined) continue;
      result[key] = visit(descriptor.value, depth + 1);
    }
    return result;
  }
  return visit(input, 0);
}

function dateMs(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) fail('日期必须使用 YYYY-MM-DD');
  const [year, month, day] = value.split('-').map(Number);
  if (year < 1900 || year > 2200 || month < 1 || month > 12 || day < 1 || day > 31) fail('日期超出允许范围');
  const timestamp = Date.UTC(year, month - 1, day);
  const actual = new Date(timestamp);
  if (actual.getUTCFullYear() !== year || actual.getUTCMonth() !== month - 1 || actual.getUTCDate() !== day) fail('日期不存在');
  return timestamp;
}
function dateValue(value, label = '日期', nullable = false) {
  if (nullable && value === null) return null;
  try { dateMs(value); } catch { fail(`${label}不正确`); }
  return value;
}
export function todayISO() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date());
  const result = {};
  for (const part of parts) result[part.type] = part.value;
  return `${result.year}-${result.month}-${result.day}`;
}
export function weekday(dateISO) { return (new Date(dateMs(dateISO)).getUTCDay() + 6) % 7; }
export function addDays(dateISO, amount) {
  boundedNumber(amount, '日期偏移', -36600, 36600, true);
  const result = new Date(dateMs(dateISO) + amount * DAY_MS).toISOString().slice(0, 10);
  dateMs(result);
  return result;
}
export function weekDates(dateISO) {
  const monday = addDays(dateISO, -weekday(dateISO));
  return Array.from({ length: 7 }, (_, offset) => addDays(monday, offset));
}
export function formatDate(dateISO) {
  dateMs(dateISO);
  const [, month, day] = dateISO.split('-').map(Number);
  return `${month}月${day}日 · ${WEEKDAYS[weekday(dateISO)]}`;
}
export function minutes(time) {
  if (typeof time !== 'string' || !/^(?:[01]\d|2[0-3]):[0-5]\d$|^24:00$/.test(time)) fail('时间必须使用 HH:mm');
  const [hour, minute] = time.split(':').map(Number);
  return hour * 60 + minute;
}
export function duration(event) { return Math.max(0, minutes(event.end) - minutes(event.start)); }
export function formatDuration(value) {
  boundedNumber(value, '时长', 0, 10000000);
  const total = Math.round(value);
  const hours = Math.floor(total / 60);
  const remainder = total % 60;
  if (!hours) return `${remainder}分钟`;
  return remainder ? `${hours}小时${remainder}分钟` : `${hours}小时`;
}
export function planWeek(settings, dateISO) {
  const start = settings.planStartDate || '2026-10-12';
  return Math.floor((dateMs(dateISO) - dateMs(start)) / (7 * DAY_MS)) + 1;
}
export function academicWeek(settings, dateISO) {
  if (!settings.academicTermWeek1Date) return null;
  const monday = weekDates(settings.academicTermWeek1Date)[0];
  return Math.floor((dateMs(dateISO) - dateMs(monday)) / (7 * DAY_MS)) + 1;
}
export function completionKey(event, dateISO) {
  dateMs(dateISO);
  return `${dateISO}:${event.viewId || event.id}`;
}

function normalizedRepeat(input, fallbackDate) {
  plain(input, '重复规则');
  const type = choice(input.type, ['weekly', 'single', 'once'], '重复类型', 'weekly');
  if (type !== 'weekly') {
    return { type, date: dateValue(input.date || fallbackDate, '单次日程日期') };
  }
  const basis = choice(input.basis, ['ongoing', 'academic', 'plan'], '重复周次依据', 'ongoing');
  const weeksStart = boundedNumber(input.weeksStart ?? 1, '开始周次', 1, 5200, true);
  const weeksEnd = input.weeksEnd === undefined || input.weeksEnd === null ? null : boundedNumber(input.weeksEnd, '结束周次', weeksStart, 5200, true);
  const parity = choice(input.parity, ['all', 'odd', 'even'], '单双周', 'all');
  return { type, basis, weeksStart, weeksEnd, parity };
}
function normalizedFlags(value) {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 30 || value.some((item) => typeof item !== 'string' || !/^[a-z][a-z0-9_-]{0,80}$/.test(item))) fail('提醒标记格式不正确');
  return [...new Set(value)];
}
function category(value) {
  if (!CATEGORIES.has(value)) fail('日程分类不正确');
  return value;
}
function normalizedSegment(input, parent, withRepeat = true) {
  plain(input, '日程子段');
  const start = text(input.start, '子段开始时间', 5, false);
  const end = text(input.end, '子段结束时间', 5, false);
  if (minutes(start) < minutes(parent.start) || minutes(end) > minutes(parent.end) || minutes(start) >= minutes(end)) fail('子段必须位于原日程范围内');
  const result = {
    start, end, title: text(input.title, '子段标题', 160, false),
    category: category(input.category || parent.category),
  };
  if (input.notes !== undefined) result.notes = text(input.notes, '子段备注');
  if (withRepeat) result.repeat = normalizedRepeat(input.repeat || parent.repeat);
  return result;
}
function nonOverlappingSegments(segments) {
  const sorted = [...segments].sort((a, b) => minutes(a.start) - minutes(b.start));
  for (let index = 1; index < sorted.length; index += 1) {
    if (minutes(sorted[index - 1].end) > minutes(sorted[index].start)) fail('同一日程的子段不能重叠');
  }
}
function normalizedEvent(input, allowHistory = true) {
  plain(input, '日程');
  const result = {
    id: id(input.id, '日程ID'),
    weekday: boundedNumber(input.weekday, '星期', 0, 6, true),
    start: text(input.start, '开始时间', 5, false),
    end: text(input.end, '结束时间', 5, false),
    title: text(input.title, '日程标题', 160, false), category: category(input.category),
    notes: text(input.notes ?? '', '日程备注'),
    status: choice(input.status, ['pending', 'confirmed', 'needs_check'], '日程证据状态', 'pending'),
    fixed: bool(input.fixed, '固定承诺'), optional: bool(input.optional, '可选承诺', !input.fixed),
    editable: bool(input.editable, '允许编辑', true), modified: bool(input.modified, '是否已修改'),
    flags: normalizedFlags(input.flags),
    repeat: normalizedRepeat(input.repeat || { type: 'weekly' }, input.date),
  };
  if (minutes(result.start) >= minutes(result.end) || result.start === '24:00') fail('日程结束必须晚于开始，跨夜请拆成两天');
  if (input.sourceIndex !== undefined) result.sourceIndex = boundedNumber(input.sourceIndex, '原行号', 0, 100000, true);
  if (input.sourceStatus !== undefined) result.sourceStatus = text(input.sourceStatus, '原确认状态', 200);
  if (input.delivery !== undefined) result.delivery = choice(input.delivery, ['online', 'offline'], '授课形式');
  if (input.project !== undefined) result.project = text(input.project, '项目名称', 200);
  if (input.date !== undefined) result.date = dateValue(input.date, '单次日期');
  if (result.repeat.type !== 'weekly') {
    result.date = result.repeat.date;
    result.weekday = weekday(result.date);
  }
  if (input.excludeDates !== undefined) {
    if (!Array.isArray(input.excludeDates) || input.excludeDates.length > 5000) fail('排除日期列表不正确');
    result.excludeDates = [...new Set(input.excludeDates.map((entry) => dateValue(entry, '排除日期')))];
  }
  if (input.segments !== undefined) {
    if (!Array.isArray(input.segments) || input.segments.length < 1 || input.segments.length > 24) fail('日程子段数量不正确');
    result.segments = input.segments.map((item) => normalizedSegment(item, result));
    nonOverlappingSegments(result.segments);
  }
  if (input.phaseOverrides !== undefined) {
    if (!Array.isArray(input.phaseOverrides) || input.phaseOverrides.length > 12) fail('阶段替换数量不正确');
    result.phaseOverrides = input.phaseOverrides.map((item) => {
      plain(item, '阶段替换');
      const fromPlanWeek = boundedNumber(item.fromPlanWeek, '阶段开始周', 1, 5200, true);
      const toPlanWeek = item.toPlanWeek === null ? null : boundedNumber(item.toPlanWeek, '阶段结束周', fromPlanWeek, 5200, true);
      if (!Array.isArray(item.segments) || item.segments.length < 1 || item.segments.length > 24) fail('阶段子段数量不正确');
      const segments = item.segments.map((entry) => normalizedSegment(entry, result, false));
      nonOverlappingSegments(segments);
      const sorted = [...segments].sort((a, b) => minutes(a.start) - minutes(b.start));
      if (sorted[0].start !== result.start || sorted.at(-1).end !== result.end || sorted.some((entry, i) => i > 0 && entry.start !== sorted[i - 1].end)) fail('阶段替换必须完整覆盖原窗口');
      return { fromPlanWeek, toPlanWeek, segments };
    });
    const ranges = [...result.phaseOverrides].sort((a, b) => a.fromPlanWeek - b.fromPlanWeek);
    for (let index = 1; index < ranges.length; index += 1) {
      if (ranges[index - 1].toPlanWeek === null || ranges[index - 1].toPlanWeek >= ranges[index].fromPlanWeek) fail('阶段周次范围不能重叠');
    }
  }
  if (input.scheduleHistory !== undefined) {
    if (!allowHistory) fail('日程历史不能再次嵌套历史');
    plain(input.scheduleHistory, '日程历史');
    const effectiveDate = dateValue(input.scheduleHistory.effectiveDate, '日程调整生效日');
    const previous = normalizedEvent(input.scheduleHistory.previous, false);
    if (previous.id !== result.id || previous.weekday !== result.weekday) fail('历史必须对应同一个星期与原日程ID');
    result.scheduleHistory = { effectiveDate, previous };
  }
  return result;
}
function normalizeGoal(input) {
  plain(input, '目标');
  const rawDue = input.due ?? input.dueDate ?? input.targetDate ?? null;
  const result = {
    id: id(input.id, '目标ID'), title: text(input.title, '目标标题', 200, false),
    notes: text(input.notes ?? input.description ?? '', '目标说明'),
    due: dateValue(rawDue === '' ? null : rawDue, '目标日期', true),
    completed: bool(input.completed, '目标完成状态'),
    kind: choice(input.kind, ['milestone', 'longterm', 'custom', 'experiment'], '目标类型', 'custom'),
    status: choice(input.status, ['pending', 'active', 'exploring', 'completed'], '目标状态', 'pending'),
    category: category(input.category || 'research'), editable: bool(input.editable, '允许编辑', true),
  };
  if (input.week !== undefined) result.week = boundedNumber(input.week, '目标周次', 1, 5200, true);
  if (input.startDate !== undefined) result.startDate = dateValue(input.startDate, '目标开始日期');
  if (input.opportunityId !== undefined) result.opportunityId = id(input.opportunityId, '机会方向ID');
  return result;
}
function normalizedSettings(input) {
  plain(input, '设置');
  const result = {
    graduationYear: boundedNumber(input.graduationYear ?? 2028, '毕业年份', 1900, 2200, true),
    graduationMonth: boundedNumber(input.graduationMonth ?? 6, '毕业月份', 1, 12, true),
    studyDirection: text(input.studyDirection ?? '机器人', '学科方向', 120),
    studyDirectionEditable: bool(input.studyDirectionEditable, '学科可编辑', true),
    focusGoal: text(input.focusGoal ?? '完成学业，积累可迁移能力', '当前目标', 600),
    planStartDate: dateValue(input.planStartDate ?? '2026-10-12', '计划开始日期'),
    academicTermWeek1Date: dateValue(input.academicTermWeek1Date ?? null, '学期第1教学周日期', true),
    weekStartsOn: boundedNumber(input.weekStartsOn ?? 0, '每周起始日', 0, 0, true),
    dailySleepHoursTarget: boundedNumber(input.dailySleepHoursTarget ?? 8, '睡眠目标', 4, 12),
    phaseMode: choice(input.phaseMode, ['auto', 'foundation', 'steady'], '阶段模式', 'auto'),
    academicWeekFallback: boundedNumber(input.academicWeekFallback ?? 1, '待确认显示周次', 1, 52, true),
  };
  // Optional presentational preferences carry no executable data.
  if (input.theme !== undefined) result.theme = choice(input.theme, ['light', 'dark', 'system'], '外观');
  if (input.showRoutine !== undefined) result.showRoutine = bool(input.showRoutine, '显示生活时段');
  if (input.scheduleRevision !== undefined) result.scheduleRevision = input.scheduleRevision === null ? null : id(input.scheduleRevision, '日程修订ID');
  if (input.scheduleVariant !== undefined) result.scheduleVariant = choice(input.scheduleVariant, ['standard', 'tutoring'], '自由窗口方案');
  return result;
}
function normalizedBudget(input) {
  plain(input, '预算');
  if (!Array.isArray(input.monthlyExpenses) || input.monthlyExpenses.length > 100) fail('月度支出列表不正确');
  const currency = text(input.currency ?? 'CNY', '币种', 3, false);
  if (!/^[A-Z]{3}$/.test(currency)) fail('币种必须为三位大写代码');
  const expenseIds = new Set();
  const monthlyExpenses = input.monthlyExpenses.map((entry) => {
    plain(entry, '月度支出');
    const entryId = id(entry.id, '支出ID');
    if (expenseIds.has(entryId)) fail('月度支出ID重复');
    expenseIds.add(entryId);
    return { id: entryId, label: text(entry.label, '支出名称', 100, false), amount: boundedNumber(entry.amount, '月度支出'), inputStatus: choice(entry.inputStatus, ['user_confirmed', 'example', 'user_edited'], '支出依据', 'user_edited') };
  });
  return {
    currency, weeklyIncome: boundedNumber(input.weeklyIncome, '每周收入'),
    incomeRealization: boundedNumber(input.incomeRealization ?? 1, '收入兑现率', 0, 1),
    annualWeeks: boundedNumber(input.annualWeeks ?? 52, '年收入周数', 1, 53),
    months: boundedNumber(input.months ?? 12, '年月份', 1, 12, true),
    monthlyExpenses, monthlySavingTarget: boundedNumber(input.monthlySavingTarget ?? 0, '月储蓄目标'),
    hotelPerVisit: boundedNumber(input.hotelPerVisit ?? 0, '每次酒店费用', 0, 1000000),
    hotelVisitsPerWeek: boundedNumber(input.hotelVisitsPerWeek ?? 0, '每周酒店次数', 0, 7),
    hotelIncludedInDating: bool(input.hotelIncludedInDating, '酒店已包含于约会预算', true),
    notes: text(input.notes ?? '', '预算说明'),
  };
}

/** Strictly sanitize imports into the exact persisted application state shape. */
function normalizedRadarPreferences(input) {
  if (input === undefined) return {savedIds: [], dismissedIds: []};
  plain(input, '雷达偏好');
  const list = (value, label) => {
    if (value === undefined) return [];
    if (!Array.isArray(value) || value.length > 3000) fail(`${label}列表不正确`);
    return [...new Set(value.map(value => id(value, label)))];
  };
  return {savedIds: list(input.savedIds, '收藏信号ID'), dismissedIds: list(input.dismissedIds, '隐藏信号ID')};
}
export function validateImport(input) {
  const data = safeClone(input);
  plain(data, '备份');
  if (data.schemaVersion !== 1) fail('不支持此备份版本');
  if (!Array.isArray(data.events) || data.events.length > 3000) fail('日程列表不正确，最多3000项');
  if (!Array.isArray(data.goals) || data.goals.length > 3000) fail('目标列表不正确，最多3000项');
  const events = data.events.map(entry => normalizedEvent(entry));
  if (new Set(events.map((entry) => entry.id)).size !== events.length) fail('日程ID重复');
  const goals = data.goals.map(normalizeGoal);
  if (new Set(goals.map((entry) => entry.id)).size !== goals.length) fail('目标ID重复');
  const completed = {};
  plain(data.completed ?? {}, '完成记录');
  for (const [key, value] of Object.entries(data.completed ?? {})) {
    if (key.length > 256 || !/^\d{4}-\d{2}-\d{2}:[a-zA-Z0-9][a-zA-Z0-9:_-]*$/.test(key)) fail('完成记录必须包含本地日期与日程ID');
    dateValue(key.slice(0, 10), '完成记录日期');
    completed[key] = bool(value, '日程完成状态');
  }
  const checks = {};
  plain(data.checks ?? {}, '衔接确认记录');
  for (const [key, value] of Object.entries(data.checks ?? {})) checks[id(key, '确认项ID')] = bool(value, '确认状态');
  return {
    schemaVersion: 1, events, goals,
    settings: normalizedSettings(data.settings), budget: normalizedBudget(data.budget),
    completed, checks, radarPreferences: normalizedRadarPreferences(data.radarPreferences),
    taskProgress: normalizeTaskProgress(data.taskProgress),
  };
}
export function initialState(seed) {
  const milestones = (seed.milestones || []).map((entry) => ({ ...entry, kind: 'milestone', notes: entry.description || '', due: entry.dueDate, completed: false }));
  const longTerm = (seed.longTermGoals || []).map((entry) => ({ ...entry, kind: 'longterm', category: 'custom', notes: entry.description || '', due: entry.targetDate, completed: false }));
  return validateImport({
    schemaVersion: 1, events: seed.events, goals: [...milestones, ...longTerm],
    settings: { ...seed.initialProfile, phaseMode: 'auto', academicWeekFallback: 1 },
    budget: seed.budget, completed: {}, checks: {},
  });
}

function matchesRepeat(rule, state, dateISO) {
  if (rule.type !== 'weekly') return rule.date === dateISO;
  if (rule.basis === 'academic' && !state.settings.academicTermWeek1Date) return true;
  let week;
  if (rule.basis === 'academic') week = academicWeek(state.settings, dateISO);
  else if (rule.basis === 'plan') week = planWeek(state.settings, dateISO);
  else {
    // Unbounded weekly commitments recur even before the twelve-week plan starts.
    if (rule.weeksStart === 1 && rule.weeksEnd === null && rule.parity === 'all') return true;
    week = planWeek(state.settings, dateISO);
  }
  if (week < rule.weeksStart || (rule.weeksEnd !== null && week > rule.weeksEnd)) return false;
  if (rule.parity === 'odd' && week % 2 !== 1) return false;
  if (rule.parity === 'even' && week % 2 !== 0) return false;
  return true;
}
function effectivePlanWeek(state, dateISO) {
  if (state.settings.phaseMode === 'foundation') return 1;
  if (state.settings.phaseMode === 'steady') return 5;
  return Math.max(1, planWeek(state.settings, dateISO));
}
/** Expand just the visible child segments; raw id is always preserved for template edits. */
export function eventsForDate(state, dateISO) {
  dateMs(dateISO);
  const day = weekday(dateISO);
  const rendered = [];
  const phaseWeek = effectivePlanWeek(state, dateISO);
  for (const current of state.events) {
    const raw = current.scheduleHistory && dateISO < current.scheduleHistory.effectiveDate ? current.scheduleHistory.previous : current;
    const rule = raw.repeat || { type: 'weekly', basis: 'ongoing', weeksStart: 1, weeksEnd: null, parity: 'all' };
    if (rule.type === 'weekly' && raw.weekday !== day) continue;
    if (raw.excludeDates?.includes(dateISO)) continue;
    if (!matchesRepeat(rule, state, dateISO)) continue;
    const override = !raw.modified && raw.phaseOverrides?.find((entry) => phaseWeek >= entry.fromPlanWeek && (entry.toPlanWeek === null || phaseWeek <= entry.toPlanWeek));
    const sourceSegments = override ? override.segments : raw.segments;
    const segments = sourceSegments || [null];
    segments.forEach((segment, index) => {
      if (segment?.repeat && !matchesRepeat(segment.repeat, state, dateISO)) return;
      const flags = [...(raw.flags || [])];
      const usesAcademic = rule.basis === 'academic' || segment?.repeat?.basis === 'academic';
      if (usesAcademic && !state.settings.academicTermWeek1Date) flags.push('academic_week_unconfirmed');
      if (override) flags.push('foundation_phase');
      const viewId = segment ? `${raw.id}:${override ? 'phase' : 'segment'}:${index}` : raw.id;
      const view = {
        ...raw, ...(segment || {}), id: raw.id, sourceId: raw.id, viewId,
        date: dateISO, weekday: day, flags: [...new Set(flags)],
        notes: segment?.notes || raw.notes || '',
      };
      view.completed = Boolean(state.completed?.[completionKey(view, dateISO)]);
      rendered.push(view);
    });
  }
  return rendered.sort((a, b) => minutes(a.start) - minutes(b.start) || minutes(a.end) - minutes(b.end) || a.viewId.localeCompare(b.viewId));
}
export function conflicts(events) {
  const result = [];
  const sorted = [...events].sort((a, b) => minutes(a.start) - minutes(b.start));
  for (let i = 0; i < sorted.length; i += 1) {
    const a = sorted[i];
    for (let j = i + 1; j < sorted.length && minutes(sorted[j].start) < minutes(a.end); j += 1) {
      const b = sorted[j];
      const overlap = Math.min(minutes(a.end), minutes(b.end)) - Math.max(minutes(a.start), minutes(b.start));
      if (overlap > 0) result.push({ a, b, minutes: overlap });
    }
  }
  return result;
}
export function summaryForWeek(state, dateISO) {
  const days = weekDates(dateISO).map((date) => ({ date, events: eventsForDate(state, date) }));
  const totals = Object.fromEntries(CATEGORY_CODES.map((code) => [code, 0]));
  let conflictCount = 0;
  for (const day of days) {
    conflictCount += conflicts(day.events).length;
    for (const event of day.events) totals[event.category] = (totals[event.category] || 0) + duration(event);
  }
  const byCategory = Object.fromEntries(Object.entries(totals).map(([code, value]) => [code, value / 60]));
  return {
    byCategory,
    growth: [...GROWTH_CODES].reduce((sum, code) => sum + (byCategory[code] || 0), 0),
    buffer: byCategory.buffer || 0,
    scheduled: Object.values(totals).reduce((sum, value) => sum + value, 0) / 60,
    conflictCount, days,
  };
}
