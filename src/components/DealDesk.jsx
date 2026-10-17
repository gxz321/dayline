import {storageKey,IS_PAGES} from '../lib/deployment.js';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import offers from '../data/service-offers.json';
import { effectiveHourly, offerExperiment, validateDemandResponse } from '../lib/demand.js';
import './DealDesk.css';
import {fetchPublicFeed} from '../lib/runtime-session.js';

const CACHE_KEY = storageKey('dayline:demand-cache:v1');
const SHANGHAI = new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false });
const PAY_LABEL = { explicit: '原文有付费表达', 'problem-only': '有痛点 · 预算未知', none: '缺少买方证据' };
const CHANGE_LABEL = { new: '首次发现', changed: '正文变化', unchanged: '持续观察', retained: '来源失败 · 旧缓存' };
const STATUS_LABEL = { fresh: '本轮检索完成', partial: '部分来源失败', stale: '缓存已过期', unavailable: '检索暂不可用' };
const PART_LABELS = { payment: '付费表达', problem: '具体问题', urgency: '行动窗口', fit: '交付匹配', recency: '原文新近' };
const fmt = value => value ? SHANGHAI.format(new Date(value)) : '未提供';

function dealCache() {
  try { const raw = localStorage.getItem(CACHE_KEY); if (!raw || raw.length > 1000000) return null; return validateDemandResponse(JSON.parse(raw)); } catch { return null; }
}
function useDemand() {
  const [data, setData] = useState(dealCache);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const active = useRef(null);
  const mounted = useRef(false);
  const refresh = useCallback(async (wait = false) => {
    if (active.current) return;
    const controller = new AbortController(); active.current = controller;
    setLoading(true); setError('');
    const timeout = setTimeout(() => controller.abort(), 30000);
    try {
      const response = await fetchPublicFeed('demand', {refresh:wait,signal:controller.signal});
      const next = validateDemandResponse(await response.json());
      if (!mounted.current || active.current !== controller) return;
      if (!response.ok) throw new Error('服务暂不可用，保留上次结果');
      setData(next);
      try { localStorage.setItem(CACHE_KEY, JSON.stringify(next)); } catch { setError('本次结果可用，但浏览器未能保存离线缓存'); }
    } catch (e) { if (mounted.current && active.current === controller) setError(e.name === 'AbortError' ? '检索等待超时，保留上次结果' : ['请先到助手中登录，再检查更新。','更新正在进行或仍处于冷却时间，请稍后检查。'].includes(e.message) ? e.message : '连接或数据验证失败，保留上次结果'); }
    finally { clearTimeout(timeout); if (active.current === controller) { active.current = null; if (mounted.current) setLoading(false); } }
  }, []);
  useEffect(() => {
    mounted.current = true; refresh();
    const check = () => { if (document.visibilityState === 'visible') refresh(); };
    const timer = setInterval(check, 300000); document.addEventListener('visibilitychange', check);
    return () => { mounted.current = false; clearInterval(timer); document.removeEventListener('visibilitychange', check); active.current?.abort(); active.current = null; };
  }, [refresh]);
  return { data, loading, error, refresh };
}

function Glyph({ name, className = '' }) {
  const paths = { arrow: <path d="m8 5 7 7-7 7" />, external: <><path d="M14 4h6v6M20 4l-9 9" /><path d="M11 5H5v14h14v-6" /></>, refresh: <><path d="M20 5v6h-6M4 19v-6h6" /><path d="M5 8a8 8 0 0 1 13-3l2 3M4 16l2 3a8 8 0 0 0 13-3" /></>, plus: <path d="M12 5v14M5 12h14" />, check: <path d="m5 12 4 4 10-10" />, copy: <><rect x="8" y="8" width="12" height="12" rx="2" /><path d="M16 8V4H4v12h4" /></> };
  return <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>;
}

function OfferPanel({ offer, item, onAdopt }) {
  const [copied, setCopied] = useState('');
  const draftRef = useRef(null);
  useEffect(() => setCopied(''), [offer.id]);
  async function copyDraft() {
    try { await navigator.clipboard.writeText(offer.listingDraft); setCopied('文案已复制，请先核对发布平台的类目与规则。'); }
    catch { draftRef.current?.focus(); draftRef.current?.select(); setCopied('浏览器未允许复制，已选中文案，可手动复制。'); }
  }
  return <aside className="deal-offer-panel" aria-label="服务方案详情">
    <p className="deal-eyebrow">一个范围清楚的交付</p>
    <h2>{offer.title}</h2>
    <p className="deal-buyer">{offer.buyer}</p>
    <div className="deal-price"><strong>{offer.priceTest}</strong><span>测试报价 · 非市场均价或收益承诺</span></div>
    <section><h3>交付与验收</h3><p>{offer.deliverable}</p><ul>{offer.acceptance.map(t => <li key={t}>{t}</li>)}</ul></section>
    <section><h3>什么时候可能需要</h3><p>{offer.trigger}</p><p className="deal-evidence-note">{offer.evidenceNote}</p></section>
    <section><h3>先问，再报价</h3><ol>{offer.questions.map(t => <li key={t}>{t}</li>)}</ol></section>
    <div className="deal-bounds"><span>{offer.timeCap}</span><span>{offer.cashCap}</span></div>
    <button type="button" className="deal-primary" onClick={() => onAdopt?.(offerExperiment(offer, item))} disabled={!onAdopt}><Glyph name="plus" />{item ? '为这条线索建立验证目标' : '加入小实验'}</button>
    <p className="deal-small">每周最多 2 小时，替换已有时段；加入目标不增加日程。</p>
    <details className="deal-details"><summary>刊登草稿与停止条件</summary><p>先核实类目允许、服务范围和内容版权，再自行发布。</p><textarea ref={draftRef} readOnly value={offer.listingDraft} aria-label="服务刊登草稿" rows={7} /><button type="button" className="deal-secondary" onClick={copyDraft}><Glyph name="copy" />复制草稿</button><p role="status" className="deal-small">{copied}</p><h3>停止条件</h3><p>{offer.stopRule}</p></details>
    <div className="deal-source-links">{offer.links.map(l => <a key={l.url} href={l.url} target="_blank" rel="noopener noreferrer">{l.label}<Glyph name="external" /></a>)}</div>
  </aside>;
}

function CostAndConnection() {
  const [numbers, setNumbers] = useState({ price: 199, delivery: 60, preparation: 30, acquisition: 30, cost: 0 });
  const hourly = effectiveHourly(numbers.price, numbers.delivery, numbers.preparation, numbers.acquisition, numbers.cost);
  return <div className="deal-setup-grid">
    <section className="deal-cost"><p className="deal-eyebrow">核算你的全部投入</p><h2>报价，看每小时留下多少。</h2><p>把获客、备课和修改计进去。这里是你填写的估算，尚未产生实际收入。</p><div className="deal-number-fields">{[['price', '报价 / 元'], ['delivery', '交付 / 分钟'], ['preparation', '准备与修改 / 分钟'], ['acquisition', '获客沟通 / 分钟'], ['cost', '直接成本 / 元']].map(([key, label]) => <label key={key}><span>{label}</span><input type="number" min="0" max="100000" value={numbers[key]} onChange={e => setNumbers(p => ({ ...p, [key]: e.target.value === '' ? '' : Number(e.target.value) }))} /></label>)}</div><div className={`deal-hourly${hourly != null && hourly < 0 ? ' deal-loss' : ''}`}><span>预计每投入小时收入，扣直接成本</span><strong>{hourly == null ? '—' : `¥${hourly.toFixed(0)}`}<small> / h</small></strong></div><p className="deal-small">未计平台收费、税费或取消损失，按你的实际条件补入成本。稳定复购和复用题库比一次低价订单更值得观察。</p></section>
    <section className="deal-connect"><p className="deal-eyebrow">随手问，带着证据回答</p><h2>Telegram 私人助理</h2><span className="deal-config-badge">代码已准备 · 尚未配置账号</span><p>机器人默认关闭。创建自己的 BotFather 机器人，再把机器人令牌、私人数字 ID 和独立验证密钥存入服务端配置。</p><dl><div><dt>/radar</dt><dd>行业资讯与来源状态，使用现有缓存</dd></div><div><dt>/leads</dt><dd>需求线索与付费证据，公开问题仍需核实</dd></div><div><dt>/ask 问题</dt><dd>选配 GPT 或通义千问；每日次数和输出有上限</dd></div><div><dt>/research 主题</dt><dd>OpenAI 可选联网检索；单独启用并限制次数</dd></div></dl><p>默认只回复白名单中的私人聊天。群组、陌生用户和重复事件均受限制；不会替你联系客户。</p><p className="deal-small">无需 Telegram 也能在这里检索、建立验证目标。实际连接、模型计费与账号地区可用性，以配置时的官方条件为准。</p><a className="deal-link" href="https://core.telegram.org/bots/tutorial" target="_blank" rel="noopener noreferrer">BotFather 官方入门<Glyph name="external" /></a><a className="deal-link" href="https://developers.openai.com/api/docs/guides/tools-web-search" target="_blank" rel="noopener noreferrer">OpenAI 官方检索文档<Glyph name="external" /></a></section>
  </div>;
}

export default function DealDesk({ onAdopt }) {
  const { data, loading, error, refresh } = useDemand();
  const [mode, setMode] = useState('leads');
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('all');
  const [selectedID, setSelectedID] = useState(null);
  const [offerID, setOfferID] = useState('spreadsheet');
  const [limit, setLimit] = useState(12);
  const listRef = useRef(null);
  const detailRef = useRef(null);
  const candidates = useMemo(() => (data?.items || []).filter(i => i.action !== 'skip' && !i.closed && i.windowState !== 'expired' && i.paymentEvidence !== 'none'), [data]);
  const shown = useMemo(() => (filter === 'excluded' ? (data?.items || []).filter(i => !candidates.includes(i)) : candidates).filter(i => (filter !== 'paid' || i.paymentEvidence === 'explicit' && i.change !== 'retained') && (filter !== 'changed' || ['new', 'changed'].includes(i.change)) && (!query.trim() || `${i.title} ${i.excerpt} ${i.sourceName}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()))), [data, candidates, query, filter]);
  const selected = shown.find(i => i.id === selectedID) || shown[0] || null;
  const offer = offers.find(o => o.id === (mode === 'offers' ? offerID : selected?.offerId)) || offers.find(o => o.id === 'research-pack') || offers[0];
  const successful = data?.sources.filter(s => s.status === 'ok').length || 0;
  const paid = candidates.filter(i => i.paymentEvidence === 'explicit' && i.change !== 'retained').length;
  const stale = !!data?.generatedAt && Date.now() - Date.parse(data.generatedAt) > (IS_PAGES?4:1)*3600000;
  function select(id) { setSelectedID(id); requestAnimationFrame(() => { detailRef.current?.focus({ preventScroll: true }); if (matchMedia('(max-width: 1080px)').matches) detailRef.current?.scrollIntoView({ block: 'start', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' }); }); }
  return <section className="deal-workspace" aria-label="灵活变现与需求研究">
    <header className="deal-heading"><p className="deal-eyebrow">从问题，到小额交付</p><h1>寻找一个，值得解决的问题。</h1><p>先确认支付者和交付边界，再投入两小时。</p></header>
    <div className="deal-mode" role="group" aria-label="成交工作台视图">{[['leads', '公开线索'], ['offers', '可售方案'], ['setup', '接入与成本']].map(([id, label]) => <button type="button" key={id} aria-pressed={mode === id} className={mode === id ? 'is-active' : ''} onClick={() => setMode(id)}>{label}</button>)}</div>
    {mode === 'setup' ? <CostAndConnection /> : mode === 'offers' ? <div className="deal-layout"><div className="deal-main"><div className="deal-section-intro"><h2>卖一个结果，先做小交付。</h2><p>以下是待验证的服务假设与实验报价。平台支持服务，不代表所有类目或虚拟资料都允许刊登。</p></div>{offers.map((o, n) => <button type="button" key={o.id} className={`deal-offer-row${offer.id === o.id ? ' is-selected' : ''}`} aria-pressed={offer.id === o.id} onClick={() => { setOfferID(o.id); requestAnimationFrame(() => { if (matchMedia('(max-width: 1080px)').matches) detailRef.current?.scrollIntoView({ block: 'start' }); }); }}><span>{String(n + 1).padStart(2, '0')}</span><div><strong>{o.title}</strong><p>{o.buyer}</p></div><Glyph name="arrow" /></button>)}<div className="deal-principle"><h3>信息差，需要转化成可验收的价值。</h3><p>售卖自己制作、可以追溯来源的整理与工具；每单写清输入、输出、修改次数和验收。挂牌价、收藏量、公开求助都不能当作成交。</p></div></div><div ref={detailRef} tabIndex={-1}><OfferPanel offer={offer} onAdopt={onAdopt} /></div></div> : <>
      <div className="deal-health"><div><span className={`deal-status${error || stale || data?.status !== 'fresh' ? ' is-warning' : ''}`}>{error ? '连接异常 · 使用缓存' : stale ? IS_PAGES?'缓存超过四小时':'缓存超过一小时' : data ? STATUS_LABEL[data.status] : '等待首次检索'}</span><span>{successful}/{data?.sources.length || 6} 来源正常</span></div><button type="button" className="deal-secondary" disabled={loading} onClick={() => refresh(true)}><Glyph name="refresh" />{loading ? '检索中…' : '检查更新'}</button><p>采集：{fmt(data?.generatedAt)} · 尝试：{fmt(data?.lastAttemptAt)}{IS_PAGES?' · 按4小时计划检查，实际运行可能延迟。':` · 下次可采集：${fmt(data?.nextRefreshAt)}`} </p>{error ? <p role="status">{error}</p> : null}<details><summary>来源状态与覆盖范围</summary><p>仅覆盖固定公开社区 API；没有抓取闲鱼登录页、私人群组或完整互联网。公开帖子的付费表达仍需本人确认。默认列表排除已关闭、过期或缺少买方证据的条目，反证可在「已降级 / 排除」查看。</p>{data?.sources.map(s => <div className="deal-source-status" key={s.id}><a href={s.url} target="_blank" rel="noopener noreferrer">{s.name}</a><span>{s.status === 'ok' ? `${s.itemCount} 条原始结果` : s.error || '本轮失败'}</span></div>)}</details></div>
      <div className="deal-stat-strip"><div><strong>{data ? candidates.length : '—'}</strong><span>可观察的问题</span></div><div><strong>{data ? paid : '—'}</strong><span>有付费表达</span></div><div><strong>{data ? candidates.filter(i => ['new', 'changed'].includes(i.change)).length : '—'}</strong><span>首次发现或变化</span></div><p>核实优先级 ≠ 成交概率</p></div>
      <div className="deal-layout"><div className="deal-main" ref={listRef}><label className="deal-search"><span>搜索问题或交付关键词</span><input type="search" value={query} maxLength={200} placeholder="例如：表格、PDF、automation" onChange={e => { setQuery(e.target.value); setLimit(12); }} /></label><div className="deal-filters" role="group" aria-label="筛选需求证据">{[['all', '全部痛点'], ['paid', '付费表达'], ['changed', '首次发现 / 变化'], ['excluded', '已降级 / 排除']].map(([id, title]) => <button type="button" key={id} aria-pressed={filter === id} className={filter === id ? 'is-active' : ''} onClick={() => { setFilter(id); setLimit(12); }}>{title}</button>)}</div>
        {shown.length ? shown.slice(0, limit).map(i => <button type="button" key={i.id} className={`deal-lead-row${selected?.id === i.id ? ' is-selected' : ''}`} aria-pressed={selected?.id === i.id} onClick={() => select(i.id)}><div className="deal-row-meta"><span className={i.paymentEvidence === 'explicit' && !i.closed ? 'deal-pay' : ''}>{i.closed ? '已关闭 / 已解决' : i.action === 'skip' ? '已排除 · 查看反证' : PAY_LABEL[i.paymentEvidence]}</span><span>{CHANGE_LABEL[i.change]}</span></div><strong>{i.title}</strong><p>{i.excerpt || '原文未提供完整描述，请打开来源核实。'}</p><div className="deal-row-footer"><span>{i.sourceName} · 原文 {fmt(i.publishedAt)}</span><span>核实优先级 {i.intentScore}<Glyph name="arrow" /></span></div></button>) : <div className="deal-empty"><Glyph name="check" /><h2>{loading ? '正在检查公开来源。' : filter === 'paid' ? '本轮没有匹配的付费表达。' : '没有匹配的需求线索。'}</h2><p>{filter === 'paid' ? '零结果也是有用的判断。其他痛点可用于访谈，先验证预算。' : error ? '检查来源状态，或稍后重试。不会用示例伪装真实结果。' : '可调整关键词或查看可售方案；检索范围有限，尚未找到不等于市场没有需求。'}</p>{filter !== 'all' || query ? <button type="button" className="deal-secondary" onClick={() => { setFilter('all'); setQuery(''); }}>清除筛选</button> : null}</div>}
        {shown.length > limit ? <button type="button" className="deal-secondary deal-more" onClick={() => setLimit(v => v + 12)}>继续显示 {Math.min(12, shown.length - limit)} 条</button> : null}
      </div><div className="deal-detail-wrap" ref={detailRef} tabIndex={-1}>{selected ? <><div className="deal-evidence"><button type="button" className="deal-mobile-return" onClick={() => listRef.current?.scrollIntoView({ block: 'start' })}>返回线索列表</button><p className="deal-eyebrow">原文证据 · 需要你再次核实</p><h2>{selected.title}</h2><p>{PAY_LABEL[selected.paymentEvidence]} · {CHANGE_LABEL[selected.change]}</p><a className="deal-link" href={selected.url} target="_blank" rel="noopener noreferrer">打开公开原帖<Glyph name="external" /></a><dl className="deal-score">{Object.entries(selected.scoreBreakdown).map(([k, v]) => <div key={k}><dt>{PART_LABELS[k]}</dt><dd>{v}</dd></div>)}</dl><details><summary>为什么这样判断</summary><ul>{selected.positiveEvidence.map(t => <li key={t}>{t}</li>)}</ul><h3>反证与未确认事项</h3><ul>{(selected.negativeEvidence.length ? selected.negativeEvidence : ['还没有验证付款人、预算及问题是否持续存在']).map(t => <li key={t}>{t}</li>)}</ul><p>首次发现 {fmt(selected.firstSeenAt)} · 最近发现 {fmt(selected.lastSeenAt)}{selected.deadlineAt ? ` · 原文截止日 ${selected.deadlineAt}（时区待核）` : ' · 未识别到可靠截止日期'}</p></details></div><OfferPanel offer={offer} item={selected} onAdopt={candidates.includes(selected) ? onAdopt : undefined} /></> : <div className="deal-principle"><h2>从一笔小交付开始。</h2><p>没有确认需求时，先看可售方案和验收样稿。你无需为了追热点再增加一个高强度项目。</p><button type="button" className="deal-primary" onClick={() => setMode('offers')}>查看可售方案<Glyph name="arrow" /></button></div>}</div></div>
    </>}
  </section>;
}
