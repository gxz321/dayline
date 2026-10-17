import {validateRadarResponse} from '../lib/radar-validation.js';
export {validateRadarResponse};
import {storageKey,IS_PAGES} from '../lib/deployment.js';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import './Radar.css';
import {fetchPublicFeed} from '../lib/runtime-session.js';

const CACHE_KEY = storageKey('dayline:radar-cache:v1');
const TOPIC_IDS = new Set(['vertical-ai', 'ai-reliability', 'global-b2b', 'cybersecurity', 'ageing-operations', 'ai-energy', 'deeptech-transfer']);
const SIGNAL_LABELS = { release: '产品发布', research: '研究进展', policy: '政策信号', commercial: '商业进展', industry: '行业观察' };
const SCORE_LABELS = { recency: '新近程度', evidence: '证据质量', convergence: '同主题信号', access: '进入便利' };
const EMPTY_PREFS = { savedIds: [], dismissedIds: [] };
const DATE_FORMAT = new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });
const DAY_FORMAT = new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' });

function readCache() {
  try {
    const raw = window.localStorage.getItem(CACHE_KEY);
    if (!raw || raw.length > 2_000_000) return null;
    const parsed = JSON.parse(raw);
    return { data: validateRadarResponse(parsed.data), receivedAt: cleanDate(parsed.receivedAt) };
  } catch { return null; }
}
function normalizedPreferences(input) {
  const valid = values => Array.isArray(values) ? [...new Set(values.filter(id => typeof id === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9:_-]{0,99}$/.test(id) && !['constructor', 'prototype', '__proto__'].includes(id)))].slice(0, 3000) : [];
  return { savedIds: valid(input?.savedIds), dismissedIds: valid(input?.dismissedIds) };
}
function dateText(value, full = false) {
  return value ? (full ? DATE_FORMAT : DAY_FORMAT).format(new Date(value)) : '日期未提供';
}
function scoreText(value) { return Number.isInteger(value) ? value : value.toFixed(1); }
function opportunityId(value) {
  if (value.length <= 94) return `radar-${value}`;
  let hash = 2166136261;
  for (const char of value) { hash ^= char.charCodeAt(0); hash = Math.imul(hash, 16777619); }
  return `radar-${value.slice(0, 80)}-${(hash >>> 0).toString(16).padStart(8, '0')}`;
}
function experimentWithEvidence(item, topic) {
  const evidence = `\n\n证据来源\n原文标题：${item.title}\n原文链接：${item.url}\n${item.dateLabel}：${dateText(item.publishedAt)}`;
  // Leave space for the goal editor's stop rule and fixed planning note.
  const available = Math.max(0, 6000 - topic.stopRule.length - 200 - evidence.length);
  const experiment = topic.experiment.length > available ? `${topic.experiment.slice(0, Math.max(0, available - 1))}…` : topic.experiment;
  return `${experiment}${evidence}`;
}

function RadarIcon({ name, className = '' }) {
  const paths = {
    refresh: <><path d="M20 7v5h-5M4 17v-5h5" /><path d="M5.5 8a7 7 0 0 1 11.7-2L20 9M4 15l2.8 3A7 7 0 0 0 18.5 16" /></>,
    search: <><circle cx="10.5" cy="10.5" r="6.5" /><path d="m16 16 4.5 4.5" /></>,
    star: <path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2L12 17.3l-5.6 2.9L7.5 14 3 9.6l6.2-.9L12 3Z" />,
    hide: <><path d="m3 3 18 18M10.5 6.2 12 6c5 0 9 6 9 6a18 18 0 0 1-3 3.4M6.3 6.4C4.3 8 3 10 3 12c0 0 4 6 9 6a9 9 0 0 0 3.5-.8" /><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2" /></>,
    external: <><path d="M14 4h6v6M20 4l-9 9" /><path d="M11 5H5v14h14v-6" /></>,
    arrow: <path d="m9 5 7 7-7 7" />,
    back: <path d="m15 5-7 7 7 7" />,
    plus: <path d="M12 5v14M5 12h14" />,
    close: <path d="m6 6 12 12M18 6 6 18" />,
    radar: <><circle cx="12" cy="12" r="8" /><path d="M12 4v8l5.5-5.5M8 12a4 4 0 0 0 4 4" /><circle cx="8" cy="9" r="1" /></>,
  };
  return <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>;
}

export default function Radar({ onAdopt, radarPreferences, onRadarPreferences }) {
  const [snapshot, setSnapshot] = useState(readCache);
  const [connection, setConnection] = useState('cached');
  const [loading, setLoading] = useState(true);
  const [awaitingRefresh, setAwaitingRefresh] = useState(false);
  const [error, setError] = useState('');
  const [cacheWarning, setCacheWarning] = useState('');
  const [checkedAt, setCheckedAt] = useState(null);
  const [clock, setClock] = useState(Date.now);
  const [query, setQuery] = useState('');
  const [topicFilter, setTopicFilter] = useState('all');
  const [view, setView] = useState('all');
  const [visibleLimit, setVisibleLimit] = useState(20);
  const [selectedId, setSelectedId] = useState(null);
  const [fallbackPreferences, setFallbackPreferences] = useState(EMPTY_PREFS);
  const [notice, setNotice] = useState(null);
  const requestRef = useRef({ controller: null, version: 0 });
  const refreshTimerRef = useRef(null);
  const detailHeadingRef = useRef(null);
  const listHeadingRef = useRef(null);
  const listButtonsRef = useRef({});
  const preferences = useMemo(() => normalizedPreferences(radarPreferences ?? fallbackPreferences), [radarPreferences, fallbackPreferences]);
  const preferencesRef = useRef(preferences);
  preferencesRef.current = preferences;
  const data = snapshot?.data;
  const saved = useMemo(() => new Set(preferences.savedIds), [preferences.savedIds]);
  const dismissed = useMemo(() => new Set(preferences.dismissedIds), [preferences.dismissedIds]);
  const topicMap = useMemo(() => new Map((data?.topics || []).map(topic => [topic.id, topic])), [data]);

  const request = useCallback(async function fetchRadar({ followup = false, manual = false } = {}) {
    requestRef.current.controller?.abort();
    window.clearTimeout(refreshTimerRef.current);
    setAwaitingRefresh(false);
    const controller = new AbortController();
    const version = requestRef.current.version + 1;
    requestRef.current = { controller, version };
    setLoading(true);
    setError('');
    let timedOut = false;
    const timeout = window.setTimeout(() => { timedOut = true; controller.abort(); }, 35000);
    try {
      const response = await fetchPublicFeed('radar', {refresh:manual,signal:controller.signal});
      if (!response.ok) throw new Error('服务暂时未能返回雷达数据');
      const raw = await response.text();
      if (raw.length > 2_000_000) throw new Error('雷达数据超出安全读取范围');
      const next = { data: validateRadarResponse(JSON.parse(raw)), receivedAt: new Date().toISOString() };
      if (version !== requestRef.current.version || controller.signal.aborted) return;
      setSnapshot(next);
      setConnection('online');
      setCheckedAt(next.receivedAt);
      setClock(Date.now());
      try { window.localStorage.setItem(CACHE_KEY, JSON.stringify(next)); setCacheWarning(''); }
      catch { setCacheWarning('此浏览器无法保存雷达缓存，关闭页面后需要重新连接。'); }
      if (next.data.meta.refreshing && !followup) {
        setAwaitingRefresh(true);
        refreshTimerRef.current = window.setTimeout(() => {
          setAwaitingRefresh(false);
          if (document.visibilityState === 'visible') fetchRadar({ followup: true });
        }, 25000);
      }
    } catch (failure) {
      if (version !== requestRef.current.version || (controller.signal.aborted && !timedOut)) return;
      setConnection('offline');
      setError(timedOut ? '连接超时，稍后可再次检查。' : ['请先到助手中登录，再检查更新。','更新正在进行或仍处于冷却时间，请稍后检查。'].includes(failure.message) ? failure.message : '未能连接雷达服务，或响应未通过格式校验。');
      setCheckedAt(new Date().toISOString());
    } finally {
      window.clearTimeout(timeout);
      if (version === requestRef.current.version) setLoading(false);
    }
  }, []);

  useEffect(() => {
    request();
    const interval = window.setInterval(() => { if (document.visibilityState === 'visible') request(); }, 5 * 60 * 1000);
    const clockInterval = window.setInterval(() => { if (document.visibilityState === 'visible') setClock(Date.now()); }, 60 * 1000);
    const onVisibility = () => {
      if (document.visibilityState === 'visible') { setClock(Date.now()); request(); }
      else { window.clearTimeout(refreshTimerRef.current); setAwaitingRefresh(false); requestRef.current.controller?.abort(); }
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.clearInterval(interval);
      window.clearInterval(clockInterval);
      document.removeEventListener('visibilitychange', onVisibility);
      window.clearTimeout(refreshTimerRef.current);
      requestRef.current.version += 1;
      requestRef.current.controller?.abort();
    };
  }, [request]);

  const shownItems = useMemo(() => {
    const search = query.trim().toLocaleLowerCase();
    return (data?.items || []).filter(item => {
      if (view === 'hidden' ? !dismissed.has(item.id) : dismissed.has(item.id)) return false;
      if (view === 'saved' && !saved.has(item.id)) return false;
      if (topicFilter !== 'all' && !item.topics.includes(topicFilter) && !item.matchedTopics.includes(topicFilter)) return false;
      return !search || `${item.title} ${item.summary} ${item.sourceName} ${[...item.topics, ...item.matchedTopics].map(id => topicMap.get(id)?.label || '').join(' ')}`.toLocaleLowerCase().includes(search);
    }).sort((a, b) => b.score - a.score || String(b.publishedAt || '').localeCompare(String(a.publishedAt || '')) || a.id.localeCompare(b.id));
  }, [data, query, view, topicFilter, saved, dismissed, topicMap]);
  const visibleItems = shownItems.slice(0, visibleLimit);
  const selected = shownItems.find(item => item.id === selectedId) || shownItems[0] || null;
  const selectedTopic = selected && [...selected.matchedTopics, ...selected.topics].map(id => topicMap.get(id)).find(Boolean);
  const failedSources = data?.sources.filter(source => source.status === 'error') || [];
  const savedCount = data?.items.filter(item => saved.has(item.id) && !dismissed.has(item.id)).length || 0;
  const hiddenCount = data?.items.filter(item => dismissed.has(item.id)).length || 0;
  const nextRefreshMs = data?.nextRefreshAt ? Date.parse(data.nextRefreshAt) : null;
  const cooldown = nextRefreshMs && nextRefreshMs > clock ? Math.ceil((nextRefreshMs - clock) / 60000) : 0;
  const isCache = !!data && connection !== 'online';
  const statusLabel = isCache ? '本机缓存' : data?.meta.refreshing ? '服务器正在采集' : data ? ({ fresh: '来源已更新', partial: '部分来源未更新', stale: '来源数据待更新', unavailable: '暂无可用来源' }[data.status]) : loading ? '正在连接' : '服务未连接';

  function updatePreferences(next) {
    const normalized = normalizedPreferences(next);
    preferencesRef.current = normalized;
    if (onRadarPreferences) onRadarPreferences(normalized);
    else setFallbackPreferences(normalized);
  }
  function toggleSaved(item) {
    const previous = preferencesRef.current;
    const had = previous.savedIds.includes(item.id);
    updatePreferences({ ...previous, savedIds: had ? previous.savedIds.filter(id => id !== item.id) : [...previous.savedIds, item.id] });
    setNotice({ text: had ? '已取消收藏。' : '已收藏，稍后可在收藏中查看。', id: item.id, field: 'savedIds', previous: had });
  }
  function toggleDismissed(item) {
    const previous = preferencesRef.current;
    const had = previous.dismissedIds.includes(item.id);
    updatePreferences({ ...previous, dismissedIds: had ? previous.dismissedIds.filter(id => id !== item.id) : [...previous.dismissedIds, item.id] });
    setNotice({ text: had ? '已恢复到信号列表。' : '已隐藏，可在已隐藏中恢复。', id: item.id, field: 'dismissedIds', previous: had });
  }
  function undo() {
    if (!notice?.field) return;
    const previous = preferencesRef.current;
    updatePreferences({ ...previous, [notice.field]: notice.previous ? [...new Set([...previous[notice.field], notice.id])] : previous[notice.field].filter(id => id !== notice.id) });
    setNotice({ text: '已撤销刚才的操作。' });
  }
  function selectItem(item) {
    setSelectedId(item.id);
    requestAnimationFrame(() => {
      detailHeadingRef.current?.focus({ preventScroll: true });
      if (window.matchMedia('(max-width: 1080px)').matches) detailHeadingRef.current?.scrollIntoView({ block: 'start', behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
    });
  }
  function adopt() {
    if (!selected || !selectedTopic || !onAdopt) return;
    onAdopt({ id: opportunityId(selected.id), title: `${selectedTopic.label} · ${selected.title}`.slice(0, 110), experiment: experimentWithEvidence(selected, selectedTopic), stopRule: selectedTopic.stopRule });
  }
  function returnToList() {
    (listButtonsRef.current[selected?.id] || listHeadingRef.current)?.focus({ preventScroll: true });
    listHeadingRef.current?.scrollIntoView({ block: 'start', behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  }

  return <section className="radar" aria-label="机会雷达">
    <header className="radar-header">
      <div className="radar-heading" ref={listHeadingRef} tabIndex={-1}><p className="radar-eyebrow"><RadarIcon name="radar" />来自一手来源的信号</p><h1>让机会，先成为证据。</h1><p className="radar-subtitle">追踪变化，验证需求。把值得观察的信号，变成一个可控的小实验。</p></div>
      <button className="radar-refresh" type="button" onClick={() => request({manual:true})} disabled={loading}><RadarIcon name="refresh" className={loading ? 'radar-spinning' : ''} /><span>{loading ? '正在检查' : '检查更新'}</span></button>
    </header>
    <div className={`radar-status${isCache || connection === 'offline' || data?.status === 'stale' || data?.status === 'unavailable' ? ' radar-status-muted' : ''}`} role="status" aria-live="polite">
      <div className="radar-status-main"><span className="radar-status-dot" aria-hidden="true" /><strong>{statusLabel}</strong><span>{data?.generatedAt ? `数据整理于 ${dateText(data.generatedAt, true)}` : '尚无来源更新时间'}</span>{loading && data && <span className="radar-checking">正在检查连接</span>}</div>
      <p>{IS_PAGES ? '检查更新会读取最近发布的资料；后台计划每4小时检查一次，实际运行可能延迟。' : isCache ? `当前显示上次保存的数据${snapshot.receivedAt ? `（${dateText(snapshot.receivedAt, true)}）` : ''}，尚未确认服务器最新状态。` : data?.meta.refreshing ? awaitingRefresh ? '服务器正在采集，稍后检查。本页将在约 25 秒后再读取一次；已有信号保持可用。' : '服务器仍在采集，可稍后再次检查；已有信号保持可用。' : cooldown ? `服务器采集冷却约 ${cooldown} 分钟；检查更新会读取现有结果。` : data ? data.meta.scheduledIntervalHours ? `检查更新读取服务器结果；自动采集间隔 ${data.meta.scheduledIntervalHours} 小时。` : '当前使用手动更新；登录后点击检查更新，公开读取不会启动采集。' : '首次采集可能需要约 20–30 秒。连接后才会显示真实信号。'}</p>
      {error && <p className="radar-status-error">{error}{data ? ' 已保留上次有效数据。' : ''}</p>}
      {data?.nextRefreshAt && <span className="radar-status-note">{IS_PAGES?'本次采集尝试：':'服务器下次可刷新：'}{dateText(IS_PAGES?data.lastAttemptAt:data.nextRefreshAt, true)}{checkedAt ? ` · 本页检查于 ${dateText(checkedAt, true)}` : ''}</span>}
    </div>
    {cacheWarning && <p className="radar-storage-warning">{cacheWarning}</p>}
    <details className="radar-source-health"><summary><span><span className={`radar-health-dot${failedSources.length ? ' radar-health-warning' : ''}`} aria-hidden="true" />来源健康<span className="radar-health-count">{data ? `${data.sources.length - failedSources.length} / ${data.sources.length} 正常` : '等待连接'}</span></span><RadarIcon name="arrow" /></summary><p className="radar-health-explanation">{isCache ? '下面是缓存记录中的来源状态，当前尚未确认。' : '单个来源失败时会保留其历史信号；发布时间与采集时间分别显示。'} {IS_PAGES?'浏览器每5分钟读取发布结果；定时检查可能延迟，失败来源会保留历史。':'浏览器每5分钟检查结果，服务器按自己的采集间隔更新。'}{data?.lastAttemptAt ? ` 最近采集尝试：${dateText(data.lastAttemptAt, true)}。` : ''}</p>{data?.sources.length ? <div className="radar-sources">{data.sources.map(source => <div className="radar-source" key={source.id}><div><a href={source.url} target="_blank" rel="noopener noreferrer">{source.name}<RadarIcon name="external" /></a><span className={source.status === 'ok' ? 'radar-source-ok' : 'radar-source-error'}>{source.status === 'ok' ? '正常' : '未更新'}</span></div><p>{source.itemCount} 条信号 · 最近成功：{source.lastSuccessAt ? dateText(source.lastSuccessAt, true) : '尚无成功记录'}</p>{source.status === 'error' && <p className="radar-source-failure">{source.error || '此来源暂未完成采集。'}</p>}</div>)}</div> : <p className="radar-health-explanation">连接成功后，可在这里核查每个来源的状态。</p>}</details>
    <div className="radar-filters">
      <label className="radar-search"><RadarIcon name="search" /><span className="radar-sr-only">搜索信号标题、来源与主题</span><input type="search" value={query} onChange={event => { setQuery(event.target.value); setVisibleLimit(20); }} placeholder="搜索信号、来源或关键词" maxLength={200} /></label>
      <label className="radar-topic-select"><span className="radar-sr-only">按发展方向筛选</span><select value={topicFilter} onChange={event => { setTopicFilter(event.target.value); setVisibleLimit(20); }}><option value="all">全部方向</option>{(data?.topics || []).map(topic => <option key={topic.id} value={topic.id}>{topic.label}</option>)}</select></label>
      <div className="radar-view-filters" role="group" aria-label="筛选信号状态">{[['all', '全部信号'], ['saved', `收藏 ${savedCount}`], ['hidden', `已隐藏 ${hiddenCount}`]].map(([id, label]) => <button key={id} className={view === id ? 'radar-view-active' : ''} type="button" aria-pressed={view === id} onClick={() => { setView(id); setVisibleLimit(20); }}>{label}</button>)}</div>
    </div>
    {notice && <div className="radar-notice" role="status"><span>{notice.text}</span>{notice.field && <button type="button" onClick={undo}>撤销</button>}<button className="radar-notice-close" type="button" onClick={() => setNotice(null)} aria-label="关闭操作提示"><RadarIcon name="close" /></button></div>}
    <div className={`radar-content${selected ? '' : ' radar-content-empty'}`}>
      <div className="radar-feed">
        <div className="radar-feed-heading"><span>{view === 'hidden' ? '已隐藏的信号' : view === 'saved' ? '收藏的信号' : '信号列表'}</span><span>{shownItems.length} 条 · 按综合分排序</span></div>
        {loading && !data ? <div className="radar-empty" aria-busy="true"><span className="radar-empty-icon"><RadarIcon name="radar" /></span><h2>正在读取来源信号</h2><p>首次采集可能需要约 20–30 秒；核查来源与发布时间后显示结果。</p><div className="radar-loading-lines" aria-hidden="true"><i /><i /><i /></div></div> : !shownItems.length ? <div className="radar-empty"><span className="radar-empty-icon"><RadarIcon name={view === 'saved' ? 'star' : 'radar'} /></span><h2>{!data ? '雷达正在等待连接' : query || topicFilter !== 'all' ? '没有匹配的信号' : view === 'saved' ? '留下一条值得验证的信号' : view === 'hidden' ? '这里还没有隐藏的信号' : '暂时没有可用信号'}</h2><p>{!data ? '稍后检查更新；长期方向中的研究与实验仍然可以使用。' : query || topicFilter !== 'all' ? '试试其他关键词或全部方向。' : view === 'saved' ? '阅读信号后点击收藏，便于下次继续。' : view === 'hidden' ? '隐藏只影响你的列表，可以随时恢复。' : '等来源恢复或产生新内容后，再观察变化。'}</p>{(query || topicFilter !== 'all') && <button className="radar-empty-button" type="button" onClick={() => { setQuery(''); setTopicFilter('all'); setVisibleLimit(20); }}>清除筛选</button>}</div> : <div className="radar-items">{visibleItems.map(item => <article className={`radar-item${selected?.id === item.id ? ' radar-item-selected' : ''}`} key={item.id}>
          <button ref={node => { listButtonsRef.current[item.id] = node; }} className="radar-item-open" type="button" onClick={() => selectItem(item)} aria-pressed={selected?.id === item.id} aria-controls="radar-detail"><span className="radar-item-top"><span className="radar-signal-tag">{SIGNAL_LABELS[item.signalType]}</span><span className="radar-item-source">{item.sourceName} · {dateText(item.publishedAt)}</span></span><span className="radar-item-title">{item.title}</span><span className="radar-item-summary">{item.summary || '阅读原文，了解这一信号的具体内容。'}</span><span className="radar-item-bottom"><span className="radar-item-topics">{[...new Set([...item.matchedTopics, ...item.topics])].slice(0, 2).map(id => topicMap.get(id)?.label).filter(Boolean).join(' · ') || '待归类'}</span><span className="radar-item-score"><strong>{scoreText(item.score)}</strong><span>排序分</span><RadarIcon name="arrow" /></span></span></button>
          <div className="radar-item-actions"><button type="button" className={saved.has(item.id) ? 'radar-is-saved' : ''} onClick={() => toggleSaved(item)} aria-pressed={saved.has(item.id)} aria-label={`${saved.has(item.id) ? '取消收藏' : '收藏'}：${item.title}`}><RadarIcon name="star" /><span>{saved.has(item.id) ? '已收藏' : '收藏'}</span></button><button type="button" onClick={() => toggleDismissed(item)} aria-label={`${dismissed.has(item.id) ? '恢复' : '隐藏'}：${item.title}`}><RadarIcon name="hide" /><span>{dismissed.has(item.id) ? '恢复' : '隐藏'}</span></button></div>
        </article>)}</div>}
        {shownItems.length > 0 && <div className="radar-pagination"><span role="status" aria-live="polite">已显示 {visibleItems.length} / {shownItems.length} 条</span>{visibleItems.length < shownItems.length && <button type="button" onClick={() => setVisibleLimit(limit => Math.min(shownItems.length, limit + 20))}>再显示{Math.min(20, shownItems.length - visibleItems.length)}条<RadarIcon name="plus" /></button>}</div>}
      </div>
      {selected && <aside className="radar-detail" id="radar-detail" aria-labelledby="radar-detail-title"><button className="radar-return" type="button" onClick={returnToList}><RadarIcon name="back" />返回信号列表</button><p className="radar-detail-eyebrow">{SIGNAL_LABELS[selected.signalType]} · {selected.sourceName}</p><h2 id="radar-detail-title" ref={detailHeadingRef} tabIndex={-1}>{selected.title}</h2><p className="radar-detail-date">{selected.dateLabel}：{dateText(selected.publishedAt)}</p><p className="radar-detail-summary">{selected.summary || '来源未提供摘要，请阅读原文判断。'}</p><a className="radar-source-link" href={selected.url} target="_blank" rel="noopener noreferrer"><span>查看原文</span><RadarIcon name="external" /></a>
        <section className="radar-score"><div className="radar-score-heading"><h3>阅读优先级</h3><strong>{scoreText(selected.score)}<small> / 100</small></strong></div><p>{selected.evidenceLabel}</p><details><summary>这个分数怎样产生<RadarIcon name="arrow" /></summary><div className="radar-score-grid">{Object.entries(SCORE_LABELS).map(([key, label]) => <div key={key}><span>{label}</span><strong>{scoreText(selected.scoreBreakdown[key])}<small> / {data.meta.weights[key]}</small></strong></div>)}</div><p>时效：2 / 7 / 14 / 30 / 90 天内分别为 30 / 25 / 19 / 12 / 4 分；无可核验日期为 0 分。</p><p>证据：官方行动 25 分，行业资料 21 分，商业进展 22 分，供应商发布 17 分，研究 12 分。</p><p>同主题：先去重同一事件，每增加一个独立发布组织加 6 分，上限 25 分。进入便利为人工设定，不能证明客户需求。</p><p className="radar-score-disclaimer">分项为加权贡献分。综合分帮助安排阅读顺序，不代表盈利概率、投资回报或方向优劣。算法 {data.meta.algorithmVersion}。</p></details></section>
        {selectedTopic && <section className="radar-experiment"><p className="radar-detail-eyebrow">可验证的方向 · {selectedTopic.label}</p><h3>先问谁愿意付费</h3><p>{selectedTopic.profitHypothesis}</p><h3>一个小实验</h3><p>{selectedTopic.experiment}</p><h3>停止条件</h3><p>{selectedTopic.stopRule}</p></section>}
        <button className="radar-adopt" type="button" disabled={!onAdopt || !selectedTopic} onClick={adopt}><span>加入验证计划</span><RadarIcon name="plus" /></button><p className="radar-adopt-note">转为可编辑目标 · 不自动增加日程<br />从现有探索时段替换，每次只做一个实验。</p>
      </aside>}
    </div>
    <p className="radar-footnote">最多展示 80 条当前信号；收藏与隐藏标记保存在日程备份中，超出当前结果的内容暂不显示。本页的离线副本保存在本机。投入之前仍需验证支付者、成本与交付条件。</p>
  </section>;
}
