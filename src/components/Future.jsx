import { lazy, Suspense, useRef, useState } from 'react';
import opportunities from '../data/opportunities.json';
import Radar from './Radar';
import './Future.css';
const DealDesk = lazy(() => import('./DealDesk'));
const WORKSPACE_TABS = [['radar', '机会雷达'], ['demand', '成交工作台'], ['longterm', '长期方向']];

const ORDER = ['vertical-ai', 'ai-reliability', 'global-b2b', 'cybersecurity', 'ageing-operations', 'ai-energy', 'deeptech-transfer'];
const PRESENTATION = {
  'vertical-ai': { summary: '把一个重复流程，做成客户愿意付费的结果。', timeline: '30 天需求验证', profit: '试点交付费 + 维护费，先验证可核算的时间节省。', trial: '选择一种流程，访谈 3 位实际用户，做一个可演示的样例。', stop: '无人愿意提供流程样本或给出试点意向时，暂停追加投入。' },
  'ai-reliability': { summary: '让企业的 AI 用得上、用得稳、用得起。', timeline: '30 天需求验证', profit: '数据诊断 + 评测交付；需求重复后，再考虑持续监控。', trial: '用 20 条公开样例，做一次质量、延迟和费用对照，询问发布前复测需求。', stop: '没有真实版本决策问题，或拿不到合法测试数据时，停止销售投入。' },
  'global-b2b': { summary: '解决一个真实场景中的跨境效率问题。', timeline: '30 天需求验证', profit: '固定范围服务或工具授权，计入获客、支付和售后成本。', trial: '选一个用户角色，访谈 3 位用户，做一组英文输入输出样例。', stop: '需求无法复用、没有合法样例，或收费与售后成本不明时，暂停发布。' },
  'cybersecurity': { summary: '从权限与恢复做起，积累可靠的基础保护能力。', timeline: '中期能力积累', profit: '先积累实习与交付能力，再提供检查、演练与维护服务。', trial: '访谈小团队的 IT 管理者；在自己的隔离环境做一次备份恢复示例。', stop: '没有明确授权，或任务超出独立恢复与安全能力时，不承诺交付。' },
  'ageing-operations': { summary: '围绕机构的重复工作，找到有支付者的需求。', timeline: '长期服务需求', profit: '流程梳理 + 培训或维护，先确认由机构还是家属付费。', trial: '访谈机构运营人员，用虚构信息做预约或提醒样例，确认预算负责人。', stop: '支付者不清、需要持续驻场，或不具备敏感数据处理条件时，暂停。' },
  'ai-energy': { summary: '观察算力时代的能源约束，寻找软件与行业入口。', timeline: '长期行业观察', profit: '从行业就业和成本分析积累，收益要以真实数据和工程验证为准。', trial: '阅读 IEA 报告，访谈运维人员，用合成账单做一个成本对照。', stop: '数据不可信、缺少专业指导，或必须先买硬件时，只保留观察。' },
  'deeptech-transfer': { summary: '从实验室走向市场，学习技术与需求之间的翻译。', timeline: '长期候选方向', profit: '成熟团队中的工程服务或成果转化，先明确验证门槛与知识产权。', trial: '选择一项公开技术与一种替代方案，写一页客户价值和验证条件。', stop: '没有客户成本证据、技术指导或清晰知识产权时，停止个人创业投入。' },
};
const ITEMS = ORDER.map(id => opportunities.find(item => item.id === id)).filter(Boolean);
const FILTERS = [{ id: 'all', title: '全部' }, { id: 'short', title: '短期验证' }, { id: 'long', title: '长期积累' }];

function FutureIcon({ name, className = '' }) {
  const paths = {
    arrow: <path d="m9 5 7 7-7 7" />,
    back: <path d="m15 5-7 7 7 7" />,
    external: <><path d="M14 4h6v6M20 4l-9 9" /><path d="M11 5H5a1 1 0 0 0-1 1v13a1 1 0 0 0 1 1h13a1 1 0 0 0 1-1v-6" /></>,
    info: <><circle cx="12" cy="12" r="8" /><path d="M12 11v5" /><path d="M12 8h.01" /></>,
    plus: <path d="M12 5v14M5 12h14" />,
  };
  return <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>;
}

function LongTermDirections({ onAdopt }) {
  const [selectedId, setSelectedId] = useState(ITEMS[0].id);
  const [filter, setFilter] = useState('all');
  const detailHeadingRef = useRef(null);
  const listHeadingRef = useRef(null);
  const listButtonsRef = useRef({});
  const selected = ITEMS.find(item => item.id === selectedId) || ITEMS[0];
  const shownItems = ITEMS.filter(item => filter === 'all' || (filter === 'short' ? ORDER.indexOf(item.id) < 3 : ORDER.indexOf(item.id) >= 3));
  const display = PRESENTATION[selected.id];

  function selectItem(id) {
    setSelectedId(id);
    requestAnimationFrame(() => {
      detailHeadingRef.current?.focus({ preventScroll: true });
      if (window.matchMedia('(max-width: 1080px)').matches) {
        detailHeadingRef.current?.scrollIntoView({ block: 'start', behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
      }
    });
  }

  function setActiveFilter(next) {
    setFilter(next);
    const first = ITEMS.find(item => next === 'all' || (next === 'short' ? ORDER.indexOf(item.id) < 3 : ORDER.indexOf(item.id) >= 3));
    const remainsVisible = next === 'all' || (next === 'short' ? ORDER.indexOf(selectedId) < 3 : ORDER.indexOf(selectedId) >= 3);
    if (!remainsVisible && first) setSelectedId(first.id);
  }

  function returnToList() {
    const target = listButtonsRef.current[selectedId] || listHeadingRef.current;
    target?.focus({ preventScroll: true });
    listHeadingRef.current?.scrollIntoView({ block: 'start', behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  }

  return (
    <section className="future-layout" aria-label="未来方向与小实验">
      <div className="future-main">
        <header className="future-heading" ref={listHeadingRef} tabIndex={-1}>
          <h1>未来，先做小实验。</h1>
          <p className="future-subtitle">从趋势到需求，从需求到第一笔收入。</p>
        </header>
        <div className="future-controls">
          <div className="future-filters" role="group" aria-label="筛选发展方向">
            {FILTERS.map(item => <button key={item.id} type="button" className={filter === item.id ? 'future-filter future-filter-active' : 'future-filter'} aria-pressed={filter === item.id} onClick={() => setActiveFilter(item.id)}>{item.title}</button>)}
          </div>
          <p className="future-principle"><FutureIcon name="info" /><span>行业增长 ≠ 个人盈利<span className="future-principle-extra"> · 每次只验证一个方向</span></span></p>
        </div>
        <div className="future-opportunities" aria-label="机会列表">
          {shownItems.map(item => {
            const current = item.id === selected.id;
            const presentation = PRESENTATION[item.id];
            return <button key={item.id} ref={node => { listButtonsRef.current[item.id] = node; }} className={`future-opportunity${current ? ' future-opportunity-selected' : ''}`} type="button" onClick={() => selectItem(item.id)} aria-pressed={current} aria-controls="future-detail">
              <span className="future-number">{String(ORDER.indexOf(item.id) + 1).padStart(2, '0')}</span>
              <span className="future-opportunity-copy"><span className="future-opportunity-title">{item.title}</span><span className="future-opportunity-description">{presentation.summary}</span></span>
              <span className="future-timeline">{presentation.timeline}</span>
              <FutureIcon className="future-row-arrow" name="arrow" />
            </button>;
          })}
        </div>
        <div className="future-footnote"><span className="future-footnote-label">一个可控的开始</span><p>先拿到需求证据，再投入开发。每周最多 2 小时，从已有时段替换；每轮只做一个方向，现金上限 500 元。</p><span className="future-research-date">研究核查 · 2026.10.10</span></div>
      </div>
      <aside className="future-detail" id="future-detail" aria-labelledby="future-detail-title">
        <button className="future-return" type="button" onClick={returnToList}><FutureIcon name="back" />返回机会列表</button>
        <h2 id="future-detail-title" ref={detailHeadingRef} tabIndex={-1}>{selected.title}</h2>
        <div className="future-detail-section"><h3>盈利结构</h3><p>{display.profit}</p></div>
        <div className="future-detail-section"><h3>30 天实验</h3><p>{display.trial}</p></div>
        <div className="future-detail-section"><h3>停止条件</h3><p>{display.stop}</p></div>
        <a className="future-source-link" href={selected.links[0].url} target="_blank" rel="noopener noreferrer"><span>阅读官方来源</span><FutureIcon name="external" /></a>
        <button className="future-adopt" type="button" onClick={() => onAdopt?.(selected)} disabled={!onAdopt}><span>加入验证计划</span><FutureIcon name="plus" /></button>
        <p className="future-adopt-note">转为可编辑目标 · 不自动增加日程</p>
        <details className="future-deep-dive" key={selected.id}>
          <summary><span>查看判断依据与完整实验</span><FutureIcon name="arrow" /></summary>
          <div className="future-expanded">
            <p className="future-detail-eyebrow">{selected.horizon}</p>
            <section><h3>为什么值得观察</h3><p>{selected.thesis}</p><p className="future-evidence">{selected.evidence}</p></section>
            <section><h3>你可以怎样进入</h3><p>{selected.entry}</p></section>
            <section><h3>利润需要怎样核算</h3><p>{selected.profitModel}</p></section>
            <section><h3>信号与投入</h3><p>{selected.timeToSignal}</p><p>{selected.capitalRange}</p></section>
            <section><h3>完整 30 天实验</h3><p>{selected.experiment}</p></section>
            <section><h3>继续的信号</h3><ul>{selected.signals.map(signal => <li key={signal}>{signal}</li>)}</ul></section>
            <section><h3>停止规则</h3><p>{selected.stopRule}</p></section>
            <section><h3>进入门槛</h3><ul>{selected.barriers.map(barrier => <li key={barrier}>{barrier}</li>)}</ul></section>
            <section><h3>现实风险</h3><ul>{selected.risks.map(risk => <li key={risk}>{risk}</li>)}</ul></section>
            <section><h3>四维观察</h3><p className="future-score-note">1–5 分为主观比较；不代表收益、成功或录取概率。</p><div className="future-score-grid">{Object.entries({ demand: '需求信号', access: '进入便利', margin: '利润结构', durability: '长期积累' }).map(([key, label]) => <div key={key}><span>{label}</span><strong>{selected.scores[key]}<small> / 5</small></strong><span className="future-score-track" aria-hidden="true"><i style={{ width: `${selected.scores[key] * 20}%` }} /></span></div>)}</div></section>
            <section><h3>一手来源</h3><div className="future-all-sources">{selected.links.map(link => <a href={link.url} target="_blank" rel="noopener noreferrer" key={link.url}><span>{link.label}</span><FutureIcon name="external" /></a>)}</div></section>
          </div>
        </details>
      </aside>
    </section>
  );
}

export default function Future({ onAdopt, radarPreferences, onRadarPreferences }) {
  const [tab, setTab] = useState('radar');
  const tabRefs = useRef({});

  function changeTab(next, focus = false) {
    setTab(next);
    if (focus) requestAnimationFrame(() => tabRefs.current[next]?.focus());
  }

  return <div className="future-workspace">
    <div className="future-tabs" role="tablist" aria-label="未来探索视图" onKeyDown={event => {
      if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) {
        event.preventDefault();
        const current = WORKSPACE_TABS.findIndex(([id]) => id === tab);
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? WORKSPACE_TABS.length - 1 : (current + (event.key === 'ArrowRight' ? 1 : -1) + WORKSPACE_TABS.length) % WORKSPACE_TABS.length;
        changeTab(WORKSPACE_TABS[next][0], true);
      }
    }}>
      {WORKSPACE_TABS.map(([id, title]) => <button ref={node => { tabRefs.current[id] = node; }} key={id} type="button" role="tab" id={`future-tab-${id}`} aria-controls={`future-panel-${id}`} aria-selected={tab === id} tabIndex={tab === id ? 0 : -1} className={`future-tab${tab === id ? ' future-tab-active' : ''}`} onClick={() => changeTab(id)}>{title}</button>)}
    </div>
    <div role="tabpanel" id={`future-panel-${tab}`} aria-labelledby={`future-tab-${tab}`}>
      {tab === 'radar' ? <Radar onAdopt={onAdopt} radarPreferences={radarPreferences} onRadarPreferences={onRadarPreferences} /> : tab === 'demand' ? <Suspense fallback={<p role="status" className="inline-note">正在载入成交工作台…</p>}><DealDesk onAdopt={onAdopt} /></Suspense> : <LongTermDirections onAdopt={onAdopt} />}
    </div>
  </div>;
}
