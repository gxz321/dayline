import {IS_PAGES,pagesChatStatus} from '../lib/deployment.js';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { formatDate, todayISO } from '../lib/calendar.js';
import { CHAT_MAX_CONTENT, CHAT_MAX_MESSAGES, CHAT_STORAGE_KEY, chatError, chatExport, chatId, chatText, createChatPayload, loadChat, nextPlanStep, planContext, replyTaskDraft, saveChat, validateChatReply, validateChatStatus } from '../lib/chat-client.js';
import { nextActions } from '../lib/next-actions.js';
import WebAI from './WebAI.jsx';
import Modal from './Modal.jsx';
import ConnectionPanel from './ConnectionPanel.jsx';
import {readRuntimeSession} from '../lib/runtime-session.js';
import './Assistant.css';
import './AssistantCalm.css';

const CLOCK = new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', hour: '2-digit', minute: '2-digit', hour12: false });
const QUICK = ['帮我拆解今天最重要的一件事', '一起推敲一个能小成本验证的赚钱想法', '我有点累，帮我调整今天的优先级'];
function Glyph({ name }) {
  const paths = { send: <><path d="m4 4 17 8-17 8 3-8-3-8Z" /><path d="M7 12h14" /></>, spark: <><path d="m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5L12 3Z" /></>, copy: <><rect x="8" y="8" width="12" height="12" rx="2" /><path d="M16 8V4H4v12h4" /></>, download: <><path d="M12 3v12m-5-5 5 5 5-5" /><path d="M4 16v5h16v-5" /></>, trash: <><path d="M4 7h16M9 7V4h6v3M6 7l1 14h10l1-14" /><path d="M10 10v7m4-7v7" /></>, stop: <rect x="6" y="6" width="12" height="12" rx="2" />, refresh: <><path d="M20 5v6h-6M4 19v-6h6" /><path d="M5 8a8 8 0 0 1 13-3l2 3M4 16l2 3a8 8 0 0 0 13-3" /></>, arrow: <path d="m8 5 7 7-7 7" />, plus: <path d="M12 5v14M5 12h14" /> };
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>;
}
function Message({ message, onCopy, onProposal }) {
  return <article className={`assistant-message assistant-message-${message.role}`} aria-label={message.role === 'user' ? '你的消息' : 'AI 回复'}>
    {message.role === 'assistant' ? <span className="assistant-avatar" aria-hidden="true">序</span> : null}
    <div className="assistant-bubble"><p>{message.content}</p>{message.role === 'assistant' && onProposal ? <button type="button" className="assistant-proposal" onClick={() => onProposal(replyTaskDraft(message.content))}><Glyph name="plus" />转为任务草稿<span>先编辑，再确认</span></button> : null}<div className="assistant-message-meta"><time dateTime={message.at}>{CLOCK.format(new Date(message.at))}</time><button type="button" onClick={() => onCopy(message.content)} aria-label={message.role === 'user' ? '复制你的消息' : '复制 AI 回复'}><Glyph name="copy" />复制</button></div></div>
  </article>;
}
function PlanTools({ state, date, onNavigate, onProposal }) {
  const [now, setNow] = useState(() => CLOCK.format(new Date()));
  useEffect(() => { const timer = setInterval(() => setNow(CLOCK.format(new Date())), 60000); return () => clearInterval(timer); }, []);
  const info = useMemo(() => nextPlanStep(state, date, date === todayISO() ? now : '00:00'), [state, date, now]);
  const tasks = useMemo(() => nextActions(state, date, { limit: 4 }), [state, date]);
  const current = tasks[0];
  return <div className="assistant-tools"><div className="assistant-tool-intro"><span className="assistant-tag">无需联网 · 确定性计划工具</span><h2>先把眼前这一步走好。</h2><p>根据这台设备上的日程与完成记录整理，不调用模型，也不会把数据发到 AI。</p></div>
    <section className="assistant-next"><span className="assistant-kicker">{formatDate(date)} · 当前可推进的行动</span>{current ? <><h3>{current.step.title}</h3><p className="assistant-next-time">约 {current.step.estimateMinutes} 分钟</p><p className="assistant-next-goal">{current.goal.title} · 已完成 {current.completedCount}/{current.totalSteps} 步</p><p>{current.step.acceptance}</p><button type="button" className="assistant-primary" onClick={() => onNavigate?.('today')}>回到今日，验收后勾选<Glyph name="arrow" /></button></> : <><h3>当前任务步骤都已完成。</h3><p>可以休息，或到计划页确认是否开启下一轮。</p><button type="button" className="assistant-primary" onClick={() => onNavigate?.('plan')}>查看计划与成果<Glyph name="arrow" /></button></>}</section>
    <section className="assistant-tool-schedule"><h3>当日待完成安排</h3>{info.events.length ? <ol>{info.events.map(event => <li key={event.viewId || event.id}><time>{event.start}</time><span>{event.title}</span></li>)}</ol> : <p>这一天的安排都已勾选完成。</p>}</section>
    <section className="assistant-goal-drafts"><h3>随后可以推进</h3><p>只展示前置条件已完成的步骤；完成一项后，下一步会自动浮现。</p>{tasks.slice(1).map(({ goal, step }) => <article key={`${goal.id}:${step.id}`}><div><strong>{step.title}</strong><span>{goal.title} · 约 {step.estimateMinutes} 分钟</span></div><button type="button" onClick={() => onNavigate?.('plan')}>查看计划<Glyph name="arrow" /></button></article>)}{tasks.length <= 1 ? <p>先专注眼前这一项即可。</p> : null}</section>
  </div>;
}
export default function Assistant({ state, date, onNavigate, onProposal }) {
  const [loaded] = useState(() => { try { return loadChat(window.localStorage); } catch { return { messages: [], error: '浏览器未开放本地存储，本次对话仅暂存于页面。' }; } });
  const [messages, setMessages] = useState(loaded.messages);
  const [storageError, setStorageError] = useState(loaded.error);
  const [mode, setMode] = useState('chat');
  const [connectionOpen,setConnectionOpen]=useState(false);
  const [runtime,setRuntime]=useState({mode:'unknown',authenticated:false,configured:false});
  const [webQuestion, setWebQuestion] = useState('');
  const [verified, setVerified] = useState(false);
  const [status, setStatus] = useState(null);
  const [statusLoading, setStatusLoading] = useState(false);
  const [statusError, setStatusError] = useState('');
  const [input, setInput] = useState('');
  const [includeContext, setIncludeContext] = useState(false);
  const [busy, setBusy] = useState(false);
  const [issue, setIssue] = useState(null);
  const [notice, setNotice] = useState('');
  const [clearConfirm, setClearConfirm] = useState(false);
  const [chatHeight, setChatHeight] = useState(null);
  const active = useRef(null), statusActive = useRef(null), alive = useRef(true), composing = useRef(false), textarea = useRef(null), end = useRef(null), shell = useRef(null), confirmDialog = useRef(null), clearOpener = useRef(null);
  const ready = !statusError && status?.authenticated && status.allowed && status.configured && status.enabled;
  const canSend = ready && status.limits.remaining !== 0;
  const needsLogin=!!status&&!status.authenticated&&(runtime.configured||(runtime.mode==='sites'&&status.configured&&status.enabled));
  const checkStatus = useCallback(async ({force=false}={}) => {
    if(IS_PAGES){setRuntime({mode:'pages',authenticated:false,configured:false});setStatus(pagesChatStatus());setStatusError('');setStatusLoading(false);return;}
    if (statusActive.current && !force) return;
    statusActive.current?.abort();
    const controller = new AbortController(); statusActive.current = controller; setStatusLoading(true); setStatusError('');
    const timer = setTimeout(() => controller.abort(), 12000);
    try { const [response,session] = await Promise.all([fetch('/api/chat/status', { signal: controller.signal, cache: 'no-store', credentials: 'same-origin' }),readRuntimeSession(controller.signal).catch(()=>({mode:'unknown',authenticated:false,configured:false}))]); const data = validateChatStatus(await response.json()); if (alive.current && statusActive.current === controller){setStatus(data);setRuntime(session);} }
    catch { if (alive.current && statusActive.current === controller) setStatusError('暂时无法读取服务状态。请稍后检查连接；本机计划仍然可用。'); }
    finally { clearTimeout(timer); if (statusActive.current === controller) { statusActive.current = null; if (alive.current) setStatusLoading(false); } }
  }, []);
  useEffect(() => { alive.current = true; checkStatus(); return () => { alive.current = false; active.current?.abort(); active.current = null; statusActive.current?.abort(); statusActive.current = null; }; }, [checkStatus]);
  useEffect(() => {
    if (!clearConfirm) return;
    const previous = clearOpener.current || document.activeElement;
    const keys = event => {
      if (event.key === 'Escape') { event.preventDefault(); setClearConfirm(false); }
      if (event.key === 'Tab') {
        const controls = confirmDialog.current?.querySelectorAll('button');
        if (!controls?.length) return;
        if (event.shiftKey && document.activeElement === controls[0]) { event.preventDefault(); controls[controls.length - 1].focus(); }
        if (!event.shiftKey && document.activeElement === controls[controls.length - 1]) { event.preventDefault(); controls[0].focus(); }
      }
    };
    document.addEventListener('keydown', keys); return () => { document.removeEventListener('keydown', keys); previous?.focus?.(); };
  }, [clearConfirm]);
  useEffect(() => {
    const viewport = window.visualViewport;
    const update = () => {
      if (!shell.current || window.innerWidth > 760) { setChatHeight(null); return; }
      const top = shell.current.getBoundingClientRect().top;
      const keyboard=document.body.classList.contains('keyboard-open');
      const available = Math.floor((viewport?.height || window.innerHeight) - Math.max(8, top) - (keyboard?12:84));
      setChatHeight(Math.max(190, available));
    };
    let firstFrame=0,secondFrame=0;
    const schedule=()=>{cancelAnimationFrame(firstFrame);cancelAnimationFrame(secondFrame);firstFrame=requestAnimationFrame(()=>{secondFrame=requestAnimationFrame(update);});};
    schedule(); viewport?.addEventListener('resize', schedule); window.addEventListener('resize', schedule);
    return () => {cancelAnimationFrame(firstFrame);cancelAnimationFrame(secondFrame);viewport?.removeEventListener('resize', schedule); window.removeEventListener('resize', schedule);};
  }, [mode]);
  useEffect(() => { end.current?.scrollIntoView({ block: 'nearest', behavior: 'instant' }); }, [messages.length, busy]);
  const persist = useCallback(next => {
    setMessages(next.slice(-CHAT_MAX_MESSAGES));
    try { setStorageError(saveChat(window.localStorage, next)); } catch { setStorageError('本次对话仅暂存于页面，请及时导出。'); }
  }, []);
  async function send(event) {
    event?.preventDefault();
    if (IS_PAGES || active.current || !input.trim() || !canSend) return;
    let requestId;
    try { requestId = chatId(); } catch (e) { setIssue({ message: e.message }); return; }
    const next = [...messages, { id: chatId(), role: 'user', content: chatText(input.trim()), at: new Date().toISOString() }].slice(-CHAT_MAX_MESSAGES);
    const body = createChatPayload(next, includeContext ? planContext(state, date) : null, requestId);
    const controller = new AbortController(); active.current = controller; persist(next); setBusy(true); setInput(''); setIncludeContext(false); setIssue(null); setNotice('');
    const timer = setTimeout(() => controller.abort(), 35000);
    try {
      const response = await fetch('/api/chat', { method: 'POST', credentials: 'same-origin', cache: 'no-store', headers: { 'Content-Type': 'application/json' }, signal: controller.signal, body: JSON.stringify(body) });
      const raw = await response.json();
      if (!alive.current || active.current !== controller) return;
      if (!response.ok) { const error = chatError(raw, response.status); setIssue(error); if ([401, 403, 503].includes(response.status)) checkStatus(); return; }
      const data = validateChatReply(raw, requestId);
      setVerified(true);
      persist([...next, { id: chatId(), role: 'assistant', content: data.reply, at: new Date().toISOString() }]);
      if (data.remaining !== null) setStatus(previous => previous ? { ...previous, limits: { ...previous.limits, remaining: data.remaining } } : previous);
    } catch (e) { if (alive.current && active.current === controller) setIssue({ message: e.name === 'AbortError' ? '已停止等待。请求可能已送达模型并产生费用；不会自动重试。' : '连接或回复验证未完成，请求可能已产生费用；不会自动重试。', maybeCharged: true }); }
    finally { clearTimeout(timer); if (active.current === controller) { active.current = null; if (alive.current) setBusy(false); } }
  }
  async function copy(content) { try { await navigator.clipboard.writeText(content); setNotice('已复制消息。'); } catch { setNotice('这台浏览器未开放复制，请长按消息文字选择复制。'); } }
  function download() {
    const blob = new Blob([chatExport(messages)], { type: 'application/json;charset=utf-8' }); const url = URL.createObjectURL(blob); const link = document.createElement('a'); link.href = url; link.download = `Dayline-对话-${todayISO()}.json`; document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000); setNotice('已导出本地会话。文件含你的聊天内容，请妥善保存。');
  }
  function clear() { try { localStorage.removeItem(CHAT_STORAGE_KEY); } catch { setStorageError('浏览器未允许删除本地记录，请在 Safari 网站数据中清理。'); } setMessages([]); setClearConfirm(false); setIssue(null); setNotice('当前页面会话已清空。'); }
  function quick(value) { if(IS_PAGES){setWebQuestion(value);setMode('web');return;}setInput(value); textarea.current?.focus(); }
  return <section className="assistant-page assistant-calm" aria-labelledby="assistant-title">
    <header className="assistant-calm-heading"><h1 id="assistant-title">助手</h1><details className="assistant-session-menu"><summary>会话<span aria-hidden="true">⌄</span></summary><div><button type="button" onClick={()=>setConnectionOpen(true)}>{IS_PAGES?'服务说明':'服务与登录'}</button><button type="button" onClick={download} disabled={!messages.length||busy}>导出对话</button><button type="button" disabled={!messages.length||busy} onClick={()=>{clearOpener.current=document.activeElement;setClearConfirm(true)}}>清空本机对话</button></div></details></header>
    <div className={`assistant-calm-status ${ready?'is-ready':''}`} aria-label="AI 连接状态"><span className="assistant-state-dot"/><div><strong>{IS_PAGES?'私人 AI 尚未连接':statusLoading?'正在检查连接':statusError?'暂时无法确认连接':ready?status.limits.remaining===0?'今日对话次数已用完':verified?'已收到真实回复':'模型已配置':needsLogin?'登录后开始对话':status?.authenticated&&status.configured&&status.enabled?'此账号尚未获授权':'尚未连接模型'}</strong><span>{IS_PAGES?'本机计划工具可直接使用。':statusError?'计划仍可正常使用。':ready?status.limits.remaining===0?'明天恢复使用，今天仍可整理本机计划。':'在这里发送问题，回复后可转成任务。':'连接后，就能在这一页继续聊。'}</span></div><button type="button" onClick={()=>setConnectionOpen(true)}>{IS_PAGES?'说明':needsLogin?'登录':'配置'}</button></div>
    <div className="assistant-chat-shell" ref={shell} style={chatHeight?{height:`${chatHeight}px`}:undefined}>
      <div className="assistant-messages" role="log" aria-label="对话消息" aria-live="polite" aria-relevant="additions" aria-busy={busy}>
        {!messages.length?<div className="assistant-calm-welcome"><h2>想清楚，然后行动。</h2><div><button type="button" onClick={()=>IS_PAGES?setMode('tools'):quick(QUICK[0])}><Glyph name="spark"/>今天先做什么</button><button type="button" onClick={()=>quick(QUICK[1])}><Glyph name="plus"/>{IS_PAGES?'整理讨论问题':'一起推敲一个想法'}</button></div></div>:messages.map(message=><Message key={message.id} message={message} onCopy={copy} onProposal={onProposal}/>)}
        {busy?<div className="assistant-thinking"><span/><span/><span/><p>等待模型回复</p></div>:null}
        {issue?<div className="assistant-request-error" role="alert"><strong>这次还没有收到完整回复</strong><p>{issue.message}</p>{issue.retryAfter?<p>建议至少等待 {issue.retryAfter} 秒。</p>:null}<button type="button" onClick={()=>setConnectionOpen(true)}>检查连接</button><button type="button" onClick={()=>{setWebQuestion(messages.filter(message=>message.role==='user').at(-1)?.content||input);setMode('web')}}>改用网页版</button></div>:null}<div ref={end}/>
      </div>
      <form className="assistant-composer" onSubmit={send}><label className="assistant-context-option"><input type="checkbox" checked={includeContext} disabled={busy||IS_PAGES} onChange={e=>setIncludeContext(e.target.checked)}/><span>这次附上 {date.slice(5).replace('-','月')}日的安排</span></label>{includeContext?<p className="assistant-privacy-hint">仅发送有限标题、时间、完成状态与目标摘要，不附备注、预算或验收证据。</p>:null}<div className="assistant-input-row"><textarea ref={textarea} aria-label="发给 AI 的消息" placeholder="和我聊聊你的安排…" value={input} maxLength={CHAT_MAX_CONTENT} rows={2} disabled={busy} onChange={e=>setInput(e.target.value)} onCompositionStart={()=>{composing.current=true}} onCompositionEnd={()=>{composing.current=false}} onKeyDown={e=>{if(e.key==='Enter'&&!e.shiftKey&&!e.nativeEvent.isComposing&&!composing.current&&e.keyCode!==229&&!('ontouchstart' in window)){e.preventDefault();send(e)}}}/>{busy?<button type="button" className="assistant-stop" onClick={()=>active.current?.abort()} aria-label="停止等待回复"><Glyph name="stop"/></button>:<button type="submit" className="assistant-send" disabled={!input.trim()||!canSend} aria-label="发送消息"><Glyph name="send"/></button>}</div>{input.length>1800?<div className="assistant-composer-note"><span>最多 2000 字符</span><span>{input.length}/2000</span></div>:null}<div className="assistant-secondary-actions"><button type="button" onClick={()=>{setWebQuestion(input.trim()||messages.filter(message=>message.role==='user').at(-1)?.content||'');setMode('web')}}>使用网页版</button><span>·</span><button type="button" onClick={()=>setMode('tools')}>计划工具</button></div></form>
    </div>
    {storageError?<p className="assistant-storage-note" role="alert">{storageError}</p>:null}
    {connectionOpen?<ConnectionPanel session={runtime} status={status} onCheck={checkStatus} onClose={()=>setConnectionOpen(false)}/>:null}
    {mode==='web'?<Modal title="使用官方网页版" wide onClose={()=>setMode('chat')}><WebAI state={state} date={date} onProposal={proposal=>{setMode('chat');onProposal?.(proposal)}} initialQuestion={webQuestion}/></Modal>:null}
    {mode==='tools'?<Modal title="计划工具" wide onClose={()=>setMode('chat')}><PlanTools state={state} date={date} onNavigate={onNavigate}/></Modal>:null}
    {notice?<p className="assistant-notice" role="status">{notice}<button type="button" onClick={()=>setNotice('')} aria-label="关闭助手提示">×</button></p>:null}
    {clearConfirm?<div className="assistant-confirm-overlay" onClick={e=>{if(e.target===e.currentTarget)setClearConfirm(false)}}><section ref={confirmDialog} className="assistant-confirm" role="alertdialog" aria-modal="true" aria-labelledby="assistant-clear-title"><h2 id="assistant-clear-title">清空本机对话？</h2><p>当前浏览器的最近对话会被删除。需要保留内容，请先导出。</p><div><button autoFocus type="button" onClick={()=>setClearConfirm(false)}>保留对话</button><button type="button" className="assistant-danger" onClick={clear}>确认清空</button></div></section></div>:null}
  </section>;
}
