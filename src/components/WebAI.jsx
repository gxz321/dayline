import { useEffect, useMemo, useRef, useState } from 'react';
import { chatText, planContext, replyTaskDraft } from '../lib/chat-client.js';
import { buildWebPrompt, WEB_PROVIDERS, WEB_QUESTION_LIMIT, WEB_REPLY_LIMIT } from '../lib/web-ai.js';
import './WebAI.css';

const QUICK_QUESTIONS = ['帮我把今天最重要的任务拆成下一步', '一起检验一个低成本赚钱想法', '帮我在收入、学业和休息之间做取舍'];
function Icon({ name }) {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{name === 'copy' ? <><rect x="8" y="8" width="12" height="12" rx="2" /><path d="M16 8V4H4v12h4" /></> : name === 'arrow' ? <><path d="M7 17 17 7M7 7h10v10" /></> : name === 'check' ? <path d="m5 12 4 4L19 6" /> : name === 'plus' ? <path d="M12 5v14M5 12h14" /> : <><path d="m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5L12 3Z" /></>}</svg>;
}

export default function WebAI({ state, date, onProposal, initialQuestion }) {
  const [providerId, setProviderId] = useState('chatgpt');
  const [question, setQuestion] = useState('');
  const [reply, setReply] = useState('');
  const [includeContext, setIncludeContext] = useState(false);
  const [copying, setCopying] = useState(false);
  const [notice, setNotice] = useState('');
  const preview = useRef(null);
  const questionInput = useRef(null);
  const copyBusy = useRef(false);
  useEffect(() => {
    if (typeof initialQuestion !== 'string' || !initialQuestion.trim()) return;
    setQuestion(chatText(initialQuestion, WEB_QUESTION_LIMIT));
    setIncludeContext(false);
    setNotice('问题已放入草稿。确认内容后，再手动复制并前往官网。');
  }, [initialQuestion]);
  const provider = WEB_PROVIDERS.find(item => item.id === providerId) || WEB_PROVIDERS[0];
  const context = useMemo(() => {
    if (!includeContext) return { data: null, error: '' };
    try { return { data: planContext(state, date), error: '' }; }
    catch { return { data: null, error: '这一天的摘要暂时无法整理；当前复制内容只含你的问题。' }; }
  }, [includeContext, state, date]);
  const prompt = useMemo(() => buildWebPrompt(question, context.data), [question, context.data]);
  async function copyPrompt() {
    if (!prompt || copyBusy.current) return;
    copyBusy.current = true; setCopying(true);
    const included = !!context.data;
    try {
      if (!navigator.clipboard?.writeText) throw new Error('clipboard unavailable');
      await navigator.clipboard.writeText(prompt);
      setIncludeContext(false);
      setNotice(included ? '已复制问题与有限摘要。本次摘要授权已复位；现在请点击「打开官网」，粘贴后自行发送。' : '已复制问题。现在请点击「打开官网」，粘贴后自行发送。');
    } catch {
      if(preview.current?.parentElement) preview.current.parentElement.open=true;
      preview.current?.focus(); preview.current?.select();
      setNotice('浏览器未允许自动复制。请在下方预览中长按并选择「全选 → 拷贝」，再打开官网。');
    } finally { copyBusy.current = false; setCopying(false); }
  }
  function useQuick(value) {
    setQuestion(value); setNotice(''); questionInput.current?.focus();
  }
  function propose() {
    if (!reply.trim() || !onProposal) return;
    onProposal(replyTaskDraft(chatText(reply, WEB_REPLY_LIMIT)));
  }
  return <div className="web-ai">
    <header className="web-ai-intro"><div><span className="web-ai-eyebrow"><i />OFFICIAL WEB · 手动交接</span><h2>选一个 AI，继续讨论。</h2><p>整理问题 → 官网讨论 → 带回计划。</p></div><span className="web-ai-orbit" aria-hidden="true"><Icon name="spark" /><i /><i /></span></header>
    <div className="web-ai-boundary"><Icon name="check" /><p>这里帮你准备讨论材料。外部网页是独立聊天，使用其账号、套餐与可用额度；不会在本站直接返回答案，也不自动同步聊天。</p></div>
    <section className="web-ai-section" aria-labelledby="web-ai-question-heading">
      <div className="web-ai-section-title"><span className="web-ai-step">01</span><div><h3 id="web-ai-question-heading">先整理一个好问题</h3><p>问题和粘贴的回复只暂存在当前页面，刷新或离开后不会保留。</p></div></div>
      <div className="web-ai-question-row"><label htmlFor="web-ai-question">这次想讨论什么</label><span>{question.length}/{WEB_QUESTION_LIMIT}</span></div>
      <textarea id="web-ai-question" ref={questionInput} className="web-ai-question" value={question} maxLength={WEB_QUESTION_LIMIT} onChange={event => { setQuestion(chatText(event.target.value, WEB_QUESTION_LIMIT)); setNotice(''); }} placeholder="比如：我每周只能再投入 4 小时，如何验证一个有人愿意付费的信息整理服务？" rows={4} />
      <div className="web-ai-quick" aria-label="快速填入问题">{QUICK_QUESTIONS.map(value => <button type="button" key={value} onClick={() => useQuick(value)}>{value}<span aria-hidden="true">＋</span></button>)}</div>
      <label className="web-ai-context"><input type="checkbox" checked={includeContext} onChange={event => { setIncludeContext(event.target.checked); setNotice(''); if(event.target.checked&&preview.current?.parentElement)preview.current.parentElement.open=true; }} /><span><strong>仅这次复制附上有限计划摘要</strong><small>{date} · 最多 12 项日程、8 个步骤、6 个目标标题；含时间和完成状态，不含备注、预算或验收证据。请先查看下方内容。</small></span></label>
      {context.error ? <p className="web-ai-warning" role="status">{context.error}</p> : null}
      <details className="web-ai-preview"><summary>实际将复制的内容<span>{prompt.length} 字符</span></summary><textarea ref={preview} readOnly value={prompt} rows={8} aria-label="实际将复制的完整文本" placeholder="输入问题后，完整的待复制文本会显示在这里。" spellCheck={false} /></details>
    </section>
    <section className="web-ai-section" aria-labelledby="web-ai-provider-heading">
      <div className="web-ai-section-title"><span className="web-ai-step">02</span><div><h3 id="web-ai-provider-heading">选一个官网，继续聊</h3><p>复制与打开分开操作，适配 iPhone 的新窗口与剪贴板权限。</p></div></div>
      <div className="web-ai-providers" role="group" aria-label="选择官方 AI 网页">{WEB_PROVIDERS.map(item => <button type="button" key={item.id} aria-pressed={providerId === item.id} className={`web-ai-provider ${item.tone}`} onClick={() => setProviderId(item.id)}><span className="web-ai-provider-mark" aria-hidden="true">{item.mark}</span><span><strong>{item.name}</strong><small>{item.note}</small></span><span className="web-ai-radio" aria-hidden="true">{providerId === item.id ? <i /> : null}</span></button>)}</div>
      <div className="web-ai-actions"><button type="button" className="web-ai-copy" onClick={copyPrompt} disabled={!prompt || copying}><Icon name="copy" />{copying ? '正在复制…' : '复制讨论材料'}</button><a className="web-ai-open" href={provider.url} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer">打开 {provider.name} 官网<Icon name="arrow" /></a></div>
      <p className="web-ai-manual">到了官网后，粘贴到聊天框并手动发送。本站不会替你登录、读取剪贴板或发送问题；官网是否可访问取决于你的网络与账号。</p>
      {notice ? <p className="web-ai-notice" role="status" aria-live="polite">{notice}</p> : null}
    </section>
    <section className="web-ai-section web-ai-return" aria-labelledby="web-ai-return-heading">
      <div className="web-ai-section-title"><span className="web-ai-step">03</span><div><h3 id="web-ai-return-heading">把结论，变成下一步</h3><p>可选。把官网回复中的有用部分粘贴回来，先编辑，再确认保存。</p></div></div>
      <div className="web-ai-question-row"><label htmlFor="web-ai-reply">带回一段回复或行动结论</label><span>{reply.length}/{WEB_REPLY_LIMIT}</span></div>
      <textarea id="web-ai-reply" value={reply} maxLength={WEB_REPLY_LIMIT} onChange={event => setReply(chatText(event.target.value, WEB_REPLY_LIMIT))} rows={4} placeholder="粘贴你想保留的结论，或写下讨论后决定做的下一件事。" />
      <button type="button" className="web-ai-draft" disabled={!reply.trim() || !onProposal} onClick={propose}><Icon name="plus" />转为任务草稿<span>尚未加入日程</span></button><p className="web-ai-limit-note">任务草稿最多保留前 2,000 字；保存前可以修改。外部回复仅按普通文字处理。</p>
    </section>
  </div>;
}
