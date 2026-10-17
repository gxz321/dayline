import {useId, useMemo, useState} from 'react';
import {todayISO} from '../lib/calendar.js';
import {addTaskGoal, completeTaskStep, flowForGoal, nextActions, saveTaskSteps, undoTaskStep} from '../lib/next-actions.js';
import {Icon} from './Icon.jsx';
import Modal from './Modal.jsx';
import './NextActions.css';

function StepsEditor({state, goal, onChange, onClose, creating = false}) {
  const [title, setTitle] = useState(creating ? '' : goal.title);
  const [draft, setDraft] = useState(() => creating ? [{id: 'step-1', title: '', acceptance: '', estimateMinutes: 30, dependsOn: []}] : flowForGoal(goal, state.taskProgress).steps.map(task => ({...task, dependsOn: [...task.dependsOn]})));
  const [error, setError] = useState('');
  const patch = (id, key, value) => setDraft(previous => previous.map(task => task.id === id ? {...task, [key]: value} : task));
  const remove = id => setDraft(previous => previous.filter(task => task.id !== id).map(task => ({...task, dependsOn: task.dependsOn.filter(dep => dep !== id)})));
  function add() {
    const id = `step-${crypto.randomUUID()}`;
    setDraft(previous => [...previous, {id, title: '', acceptance: '', estimateMinutes: 30, dependsOn: previous.length ? [previous.at(-1).id] : []}]);
  }
  function save(event) {
    event.preventDefault(); setError('');
    try {
      const next = creating ? addTaskGoal(state, {id: `goal-${crypto.randomUUID()}`, title}, draft) : saveTaskSteps(state, goal.id, draft);
      const result = onChange(next);
      if (typeof result === 'string') {setError(result); return;}
      onClose();
    } catch (failure) {setError(failure.message || '步骤保存失败，请检查输入。');}
  }
  return <Modal title={creating ? '安排下一轮' : '把目标拆成步骤'} onClose={onClose}>
    <form className="editor-form task-editor" onSubmit={save}>
      {creating ? <label>这轮只完成什么<input required maxLength={180} value={title} onChange={event => setTitle(event.target.value)} placeholder="写一个具体成果"/></label> : <p className="task-editor-goal">{goal.title}</p>}
      <p className="hint">每步写清动作与验收。完成后才推进，步骤修改后需要重新核对相应完成记录。</p>
      <div className="task-editor-list">{draft.map((task, index) => <fieldset className="task-editor-step" key={task.id}>
        <legend>步骤 {index + 1}</legend>
        <label>下一步做什么<input required maxLength={160} value={task.title} onChange={event => patch(task.id, 'title', event.target.value)} placeholder="一个能开始的具体动作"/></label>
        <label>怎样算完成<textarea required rows={3} maxLength={1200} value={task.acceptance} onChange={event => patch(task.id, 'acceptance', event.target.value)} placeholder="保存什么成果、核对什么结果"/></label>
        <div className="task-editor-step-foot"><label>预计分钟<input type="number" inputMode="numeric" min="5" max="480" step="5" required value={task.estimateMinutes} onChange={event => patch(task.id, 'estimateMinutes', Number(event.target.value))}/></label><button type="button" className="text-button danger" disabled={draft.length === 1} onClick={() => remove(task.id)} aria-label={`删除步骤${index + 1}`}>删除此步</button></div>
        {draft.length > 1 ? <details className="task-dependencies"><summary>前置步骤 · {task.dependsOn.length ? `${task.dependsOn.length} 项` : '可直接开始'}</summary><p>勾选必须先完成的动作；不能构成循环。</p>{draft.filter(item => item.id !== task.id).map(dep => <label key={dep.id}><input type="checkbox" checked={task.dependsOn.includes(dep.id)} onChange={event => patch(task.id, 'dependsOn', event.target.checked ? [...task.dependsOn, dep.id] : task.dependsOn.filter(id => id !== dep.id))}/><span>{dep.title || '未命名步骤'}</span></label>)}</details> : null}
      </fieldset>)}</div>
      <button type="button" className="button secondary" onClick={add} disabled={draft.length >= 24}><Icon name="plus" size={17}/>再加一个步骤</button>
      {error ? <p className="form-error" role="alert">{error}</p> : null}
      <footer className="modal-footer"><span/><div><button type="button" className="button secondary" onClick={onClose}>取消</button><button type="submit" className="button primary">{creating ? '开始这一轮' : '保存步骤'}</button></div></footer>
    </form>
  </Modal>;
}

function GoalSteps({goal, state, onComplete, onUndo, onEdit}) {
  const flow = flowForGoal(goal, state.taskProgress);
  const milestoneReady = nextActions(state, todayISO(), {limit: 3000}).some(item => item.goal.id === goal.id);
  return <div className="task-goal-detail"><div className="task-detail-heading"><div><h3>{goal.title}</h3><p>{flow.completedCount} / {flow.steps.length} 步已核对{goal.due ? ` · 原定 ${goal.due}` : ''}</p></div><button className="text-button" type="button" onClick={onEdit}><Icon name="edit" size={16}/>编辑步骤</button></div>
    {goal.completed ? <p className="task-context-note">你已在计划页确认整项目标完成。若需重新推进，可撤销整项目标完成或创建下一轮。</p> : null}
    {!goal.completed && !flow.complete && !milestoneReady ? <p className="task-context-note">先完成前面的里程碑，再推进这一项。原定日期过去也会保留任务。</p> : null}
    <ol className="task-step-list">{flow.steps.map((task, index) => {
      const done = flow.completed[task.id]; const ready = !goal.completed && milestoneReady && !done && task.dependsOn.every(id => flow.completed[id]);
      return <li className={`${done ? 'task-step-done' : ready ? 'task-step-ready' : 'task-step-wait'}`} key={task.id}><div className="task-step-number">{done ? <Icon name="check" size={15}/> : String(index + 1).padStart(2, '0')}</div><div className="task-step-body"><strong>{task.title}</strong><p>{task.acceptance}</p><small>{done ? `已核对 · ${done.completedAt}` : `${task.estimateMinutes} 分钟${ready ? ' · 可以开始' : ' · 等待前置行动'}`}</small>{done?.evidence ? <p className="task-evidence">凭据：{done.evidence}</p> : null}</div>{done ? <button type="button" className="text-button" onClick={() => onUndo(goal.id, task.id)} aria-label={`撤销步骤：${task.title}`}>撤销</button> : <button type="button" className="task-step-check" aria-label={`完成步骤：${task.title}`} disabled={!ready} onClick={() => onComplete(goal.id, task.id)}><Icon name="check" size={18}/></button>}</li>;
    })}</ol>
    {flow.complete && !goal.completed ? <p className="task-context-note task-complete-note">这一轮步骤已齐。下一项已经补位，整项目标的总验收可在计划页确认。</p> : null}
  </div>;
}

export default function NextActions({state, onChange, onAddGoal, compact=false}) {
  const [selection, setSelection] = useState('recommended');
  const [expanded, setExpanded] = useState(null);
  const [editor, setEditor] = useState(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [lastDone, setLastDone] = useState(null);
  const [compactMore, setCompactMore] = useState(false);
  const [completionReview, setCompletionReview] = useState(null);
  const labelId = useId(); const date = todayISO();
  const actions = useMemo(() => nextActions(state, date, {limit:compact?1:3}), [state, date, compact]);
  const finished = state.goals.filter(goal => flowForGoal(goal, state.taskProgress).complete).length;
  const selectedGoal = state.goals.find(goal => goal.id === selection);
  const expandedGoal = state.goals.find(goal => goal.id === expanded);
  function change(next) {
    const result = onChange(next);
    if (typeof result === 'string') throw new Error(result);
  }
  function complete(goalId, stepId) {
    setError('');
    try {
      const goal = state.goals.find(item => item.id === goalId); const task = flowForGoal(goal, state.taskProgress).steps.find(item => item.id === stepId);
      const next = completeTaskStep(state, goalId, stepId, date);
      change(next); setLastDone({goalId, stepId}); setNotice(`已核对「${task.title}」。下一项已按前置条件更新。`);
    } catch (failure) {setError(failure.message);}
  }
  function undo(goalId, stepId) {
    setError('');
    try {change(undoTaskStep(state, goalId, stepId)); setLastDone(null); setNotice('已撤销；依赖此步骤的本轮后续完成也已恢复为待做。');}
    catch (failure) {setError(failure.message);}
  }
  const addRound = () => onAddGoal ? onAddGoal() : setEditor({creating: true});
  function reviewCompletion(goalId, stepId) {
    const goal = state.goals.find(item => item.id === goalId);
    const task = goal && flowForGoal(goal, state.taskProgress).steps.find(item => item.id === stepId);
    if (task) setCompletionReview({goalId, stepId, title:task.title, acceptance:task.acceptance});
  }
  const editorDialog = editor ? <StepsEditor state={state} goal={editor.goal} creating={editor.creating} onChange={next=>{const error=onChange(next);if(typeof error!=='string'&&editor.creating)setSelection(next.goals.at(-1).id);return error;}} onClose={() => setEditor(null)}/> : null;
  if (compact) {
    const item = actions[0];
    const detailGoal = selectedGoal || item?.goal;
    return <section className="next-actions is-compact calm-focus" aria-labelledby={labelId}>
      <div className="focus-kicker" id={labelId}>下一步</div>
      {item ? <><h2 className="focus-title">{item.step.title}</h2><p className="focus-minutes"><Icon name="clock" size={16}/>约 {item.step.estimateMinutes} 分钟</p><p className="focus-acceptance">{item.step.acceptance}</p><div className="focus-actions"><button type="button" className="button primary" onClick={() => reviewCompletion(item.goal.id, item.step.id)} aria-label={`完成步骤：${item.step.title}`}>完成这一步</button><button type="button" className="button secondary" aria-expanded={compactMore} onClick={()=>setCompactMore(value=>!value)}>更多</button></div></> : <div className="focus-empty"><h2>这一轮已收尾。</h2><p>保留成果，再决定下一步。</p><button type="button" className="button primary" onClick={addRound}>安排下一轮</button><button type="button" className="text-button" aria-expanded={compactMore} onClick={()=>setCompactMore(value=>!value)}>查看全部目标</button></div>}
      {notice ? <div className="task-feedback" role="status"><Icon name="check" size={17}/><span>{notice}</span>{lastDone ? <button type="button" className="text-button" onClick={() => undo(lastDone.goalId, lastDone.stepId)}>撤销刚才完成</button> : null}</div> : null}
      {error ? <p className="form-error" role="alert">{error}</p> : null}
      {compactMore ? <div className="focus-more"><div className="task-controls"><label>推进中的目标<select value={selectedGoal ? selection : 'recommended'} onChange={event => setSelection(event.target.value)}><option value="recommended">当前建议</option>{state.goals.map(goal => <option value={goal.id} key={goal.id}>{flowForGoal(goal, state.taskProgress).complete ? '✓ ' : ''}{goal.title}</option>)}</select></label><button type="button" className="text-button" onClick={addRound}><Icon name="plus" size={16}/>安排下一轮</button></div>{detailGoal ? <GoalSteps goal={detailGoal} state={state} onComplete={reviewCompletion} onUndo={undo} onEdit={()=>setEditor({goal:detailGoal})}/> : null}<p className="task-local-note"><Icon name="lock" size={14}/>进度随本机备份保存，完成不会改变日程。</p></div> : null}
      {completionReview ? <Modal title="核对这一步" onClose={()=>setCompletionReview(null)}><div className="task-completion-review"><h3>{completionReview.title}</h3><p className="task-review-label">完成标准</p><p>{completionReview.acceptance}</p><div className="confirmation-actions"><button type="button" className="button secondary" onClick={()=>setCompletionReview(null)}>继续推进</button><button type="button" className="button primary" onClick={()=>{complete(completionReview.goalId,completionReview.stepId);setCompletionReview(null)}}>已核对，完成</button></div></div></Modal> : null}
      {editorDialog}
    </section>;
  }
  return <section className={`next-actions ${compact?'is-compact':''}`} aria-labelledby={labelId}>
    <div className="task-section-head"><div><h2 id={labelId}>下一步</h2><p>按验收推进，保留已经完成的成果。</p></div><div className="task-finished-count"><strong>{finished}</strong><span>/ {state.goals.length}<small>轮次已收尾</small></span></div></div>
    <div className="task-controls"><label>推进中的目标<select value={selectedGoal ? selection : 'recommended'} onChange={event => setSelection(event.target.value)}><option value="recommended">{compact?'现在建议 · 先做一项':'现在建议 · 最多三项'}</option>{state.goals.map(goal => <option value={goal.id} key={goal.id}>{flowForGoal(goal, state.taskProgress).complete ? '✓ ' : ''}{goal.title}</option>)}</select></label><button type="button" className="text-button" onClick={addRound}><Icon name="plus" size={16}/>安排下一轮</button></div>
    {notice ? <div className="task-feedback" role="status"><Icon name="check" size={17}/><span>{notice}</span>{lastDone ? <button type="button" className="text-button" onClick={() => undo(lastDone.goalId, lastDone.stepId)}>撤销刚才完成</button> : null}</div> : null}
    {error ? <p className="form-error" role="alert">{error}</p> : null}
    {selectedGoal ? <GoalSteps goal={selectedGoal} state={state} onComplete={complete} onUndo={undo} onEdit={() => setEditor({goal: selectedGoal})}/> : actions.length ? <div className="task-action-grid">{actions.map((item, index) => <article className={`task-action-card ${index === 0 ? 'task-primary-action' : ''}`} key={`${item.goal.id}:${item.step.id}`}><div className="task-card-top"><span>{index === 0 ? '先推进这一件' : '备选行动'}<b>{item.step.estimateMinutes} min</b></span><span className="task-step-fraction">{item.completedCount + 1} / {item.totalSteps}</span></div><div className="task-progress-track" aria-label={`已完成${item.completedCount}个步骤，共${item.totalSteps}个`}><span style={{width: `${item.completedCount / item.totalSteps * 100}%`}}/></div><p className="task-parent-goal">{item.goal.title}{item.overdue ? <span>原定日期已过 · 可继续</span> : null}</p><h3>{item.step.title}</h3><p className="task-acceptance"><strong>做到这样才点完成</strong>{item.step.acceptance}</p><div className="task-card-actions"><button type="button" className={`button ${index === 0 ? 'primary' : 'secondary'}`} onClick={() => complete(item.goal.id, item.step.id)} aria-label={`完成步骤：${item.step.title}`}><Icon name="check" size={17}/>已核对，完成</button><button type="button" className="text-button" onClick={() => setExpanded(expanded === item.goal.id ? null : item.goal.id)} aria-expanded={expanded === item.goal.id}>全部步骤<Icon name="chevronDown" size={16}/></button></div></article>)}</div> : <div className="task-all-done"><span className="task-done-mark"><Icon name="check" size={25}/></span><h3>{state.goals.length ? '这一轮的行动都已收尾。' : '先给这一轮一个清楚的目标。'}</h3><p>保留成果，做一次复盘，再由你决定下一阶段。</p><button type="button" className="button primary" onClick={addRound}><Icon name="plus" size={17}/>安排下一轮</button></div>}
    {!selectedGoal && expandedGoal ? <GoalSteps goal={expandedGoal} state={state} onComplete={complete} onUndo={undo} onEdit={() => setEditor({goal: expandedGoal})}/> : null}
    <p className="task-local-note"><Icon name="lock" size={14}/>步骤进度随本机备份保存。完成一项只推进任务，不会自动占用休息或家教时段。</p>
    {editorDialog}
  </section>;
}
