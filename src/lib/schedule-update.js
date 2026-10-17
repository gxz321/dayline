import update from '../data/schedule-update.json' with { type: 'json' };
import { initialState, validateImport, eventsForDate, conflicts, weekDates, addDays, todayISO } from './calendar.js';

function stable(value) { if (Array.isArray(value)) return value.map(stable); if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(k => [k, stable(value[k])])); return value; }
function signature(e) { return JSON.stringify(stable(Object.fromEntries(['id', 'weekday', 'start', 'end', 'title', 'category', 'notes', 'repeat', 'segments', 'phaseOverrides', 'fixed', 'optional', 'flags'].filter(k => e[k] !== undefined).map(k => [k, e[k]])))); }
function prepare(state, seed, variant) {
  if (!Object.hasOwn(update.variants, variant)) throw new Error('不支持这套日程方案');
  const valid = validateImport(state);
  const normalized = initialState(seed);
  const templates = Object.fromEntries(Object.entries(update.variants).map(([key, value]) => [key, validateImport({ ...normalized, events: value.events }).events]));
  const events = new Map(valid.events.map(e => [e.id, e]));
  const eligibleIds = [], skippedIds = [], changes = [];
  for (const template of templates[variant]) {
    const current = events.get(template.id);
    const recognized = current && (signature(current) === signature(template.scheduleHistory.previous) || Object.values(templates).some(rows => rows.some(e => e.id === current.id && signature(e) === signature(current))));
    if (!current || current.modified || current.excludeDates?.length || !recognized) { skippedIds.push({ id: template.id, reason: !current ? '你已删除此窗口，不恢复' : '你已修改此窗口，保留现有安排' }); continue; }
    eligibleIds.push(template.id);
    const next = structuredClone(template);
    if (current.scheduleHistory) next.scheduleHistory = structuredClone(current.scheduleHistory);
    events.set(template.id, next);
    changes.push({ id: template.id, before: current.title, after: next.title, weekday: next.weekday, start: next.start, end: next.end, segments: next.segments || [] });
  }
  const nextState = validateImport({ ...valid, events: valid.events.map(e => events.get(e.id)), settings: { ...valid.settings, scheduleRevision: update.revision, scheduleVariant: variant } });
  return { state: nextState, eligibleIds, skippedIds, changes };
}

export function previewScheduleUpdate(state, seed, variant = 'standard', now = todayISO()) {
  const result = prepare(state, seed, variant);
  const target = new Set(result.eligibleIds), problems = [];
  const first = now < update.effectiveDate ? update.effectiveDate : now;
  const dates = [...weekDates(first), ...weekDates(addDays(first, 7))].filter(d => d >= update.effectiveDate);
  for (const date of dates) for (const conflict of conflicts(eventsForDate(result.state, date))) {
    if (!target.has(conflict.a.sourceId) && !target.has(conflict.b.sourceId)) continue;
    problems.push({ date, a: conflict.a.title, b: conflict.b.title, minutes: conflict.minutes, start: conflict.a.start, end: conflict.b.end });
  }
  return { eligibleIds: result.eligibleIds, skippedIds: result.skippedIds, changes: result.changes, conflicts: problems, revision: update.revision, effectiveDate: update.effectiveDate, variant };
}

export function applyScheduleUpdate(state, seed, variant = 'standard', now = todayISO()) {
  const preview = previewScheduleUpdate(state, seed, variant, now);
  if (preview.conflicts.length) throw new Error(`新安排与自定义时段冲突：${preview.conflicts[0].date} ${preview.conflicts[0].a} / ${preview.conflicts[0].b}。请先调整对应时段。`);
  const result = prepare(state, seed, variant);
  return { state: result.state, appliedIds: result.eligibleIds, skippedIds: result.skippedIds };
}
