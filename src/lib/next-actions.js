/** A finite, editable task graph. Progress never changes the timetable or invents completion. */
const RESERVED = new Set(['__proto__', 'prototype', 'constructor']);
const SAFE_ID = /^[a-zA-Z0-9][a-zA-Z0-9:_-]{0,99}$/;
const MAX_TOTAL_STEPS = 5000;
const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
const fail = message => { throw new Error(message); };

function record(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) fail(`${label}必须是普通对象`);
  const descriptors = Object.getOwnPropertyDescriptors(value);
  for (const [key, descriptor] of Object.entries(descriptors)) {
    if (RESERVED.has(key) || descriptor.get || descriptor.set) fail(`${label}含有不安全字段`);
  }
  return value;
}
function identifier(value) {
  if (typeof value !== 'string' || !SAFE_ID.test(value) || RESERVED.has(value)) fail('任务或目标ID不正确');
  return value;
}
function content(value, label, max, empty = false) {
  if (typeof value !== 'string' || value.length > max || (!empty && !value.trim()) || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value) || /<\/?[a-z!]|javascript\s*:|data\s*:\s*text\/html|\bon[a-z]+\s*=/i.test(value)) fail(`${label}格式或字数不正确`);
  return value.trim();
}
function calendarDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) fail('任务记录日期不正确');
  const [y, m, d] = value.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  if (y < 1900 || y > 2200 || date.toISOString().slice(0, 10) !== value) fail('任务记录日期不存在');
  return value;
}
function safeArray(value, label, max) {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype || value.length > max) fail(`${label}数量不正确`);
  const descriptors = Object.getOwnPropertyDescriptors(value);
  for (const [key, entry] of Object.entries(descriptors)) if (key !== 'length' && (!/^\d+$/.test(key) || entry.get || entry.set)) fail(`${label}含有不安全字段`);
  for (let i = 0; i < value.length; i++) if (!own(value, i)) fail(`${label}不能含有空项`);
  return value;
}

export function normalizeTaskSteps(input) {
  safeArray(input, '行动步骤', 24);
  if (!input.length) fail('至少保留一个可验收步骤');
  const steps = input.map(step => {
    record(step, '行动步骤');
    if (!Number.isInteger(step.estimateMinutes) || step.estimateMinutes < 5 || step.estimateMinutes > 480) fail('行动时长需为5至480分钟整数');
    const dependsOn = [...new Set(safeArray(step.dependsOn ?? [], '前置步骤', 24).map(identifier))];
    return {id: identifier(step.id), title: content(step.title, '行动标题', 160), acceptance: content(step.acceptance, '验收标准', 1200), estimateMinutes: step.estimateMinutes, dependsOn};
  });
  const byId = new Map(steps.map(step => [step.id, step]));
  if (byId.size !== steps.length) fail('行动步骤ID重复');
  const visited = new Set(); const visiting = new Set();
  function visit(step) {
    if (visiting.has(step.id)) fail('步骤之间不能循环依赖');
    if (visited.has(step.id)) return;
    visiting.add(step.id);
    for (const dep of step.dependsOn) {
      if (!byId.has(dep)) fail('前置步骤不存在');
      visit(byId.get(dep));
    }
    visiting.delete(step.id); visited.add(step.id);
  }
  steps.forEach(visit);
  return steps;
}

/** Safe to call from the application's import validator after its whole-document safeClone. */
export function normalizeTaskProgress(input) {
  if (input === undefined) return {version: 1, byGoal: {}};
  record(input, '任务进度');
  if (input.version !== 1) fail('不支持此任务进度版本');
  record(input.byGoal, '目标步骤');
  const entries = Object.entries(input.byGoal);
  if (entries.length > 3000) fail('目标步骤数量过多');
  const byGoal = {}; let total = 0;
  for (const [goalId, value] of entries) {
    identifier(goalId); record(value, '目标步骤');
    const steps = normalizeTaskSteps(value.steps);
    total += steps.length;
    if (total > MAX_TOTAL_STEPS) fail('任务总步骤过多');
    record(value.completed ?? {}, '步骤完成记录');
    const byId = new Map(steps.map(step => [step.id, step])); const completed = {};
    for (const [stepId, entry] of Object.entries(value.completed ?? {})) {
      identifier(stepId); record(entry, '完成记录');
      if (!byId.has(stepId)) fail('完成记录对应的步骤不存在');
      completed[stepId] = {completedAt: calendarDate(entry.completedAt), evidence: content(entry.evidence ?? '', '完成凭据', 1200, true)};
    }
    for (const step of steps) if (completed[step.id] && step.dependsOn.some(dep => !completed[dep])) fail('已完成步骤缺少前置完成记录');
    byGoal[goalId] = {steps, completed};
  }
  return {version: 1, byGoal};
}

const step = (id, title, acceptance, estimateMinutes = 30, dependsOn = []) => ({id, title, acceptance, estimateMinutes, dependsOn});
const chain = rows => rows.map(([title, acceptance, minutes], i) => step(`step-${i + 1}`, title, acceptance, minutes ?? 30, i ? [`step-${i}`] : []));
const MILESTONES = {
  'milestone-01': [
    ['确认个人适用的升学规则', '保存学校/学院当届推免或转段规则的原始链接，列出适用资格、排名口径和仍待确认的问题。', 30],
    ['做一页近邻研究对照', '记录至少3项最接近的研究：任务、场景、指标、公开材料与你的差异；每项保留来源。', 45],
    ['冻结一个可验证的问题', '写出一句研究问题、一个主指标和四周内可运行的最小实验；得到导师反馈，未知项明确标记。', 30],
  ],
  'milestone-02': [
    ['列出最小任务和约束', '写清起点、语言目标、成功/失败条件与医院规则；先用合成或获授权布局。', 30],
    ['给指标写可计算例子', '为成功、碰撞、区域违规和事件后恢复各写一个输入与期望结果。', 45],
    ['跑通一个最小任务', '保存一段可重跑的任务命令、配置与结果，记录仍未覆盖的事件。', 45],
  ],
  'milestone-03': [
    ['定义统一行为日志', '用一个版本化样例记录时间、位姿、目标、事件和接触/违规信息，注明单位。', 30],
    ['实现评测器小测试', '正常、碰撞、违规、停滞四类样例都得到已人工核对的评分。', 45],
    ['核对一次端到端结果', '保存任务输入、原始日志和评分输出，可从日志独立复算。', 30],
  ],
  'milestone-04': [
    ['贯通一个场景和基线', '一个合成/授权布局、一类动态事件和一个基线从输入到评分完整运行。', 45],
    ['列出阻塞项与成本', '记录失败原因、下一步需要的设备/数据/时间，明确四周范围是否可行。', 30],
    ['取得继续或缩减决定', '将最小结果交导师，记下继续、缩减或停止的反馈及理由。', 30],
  ],
  'milestone-05': [
    ['确认第二个可行基线', '记录实现来源、输入输出与是否能在当前硬件/数据条件下运行。', 30],
    ['固定公平比较预算', '分别列出oracle与端到端任务；固定硬件、时限、重试和同一任务集合。', 30],
    ['保存一次对照结果', '两基线在同一小集合上输出可核对日志；失败也原样保留。', 45],
  ],
  'milestone-06': [
    ['冻结场景与指令切分', '任务清单按场景/指令家族分开，记录是否存在信息泄漏。', 30],
    ['锁定复现配置', '保存环境版本、随机种子、硬件说明和一条可执行命令。', 30],
    ['从干净入口复跑', '按文档从配置重新生成结果，核对关键指标与原日志一致。', 45],
  ],
  'milestone-07': [
    ['预登记小规模任务矩阵', '在运行前固定事件、强度、基线、种子与成功/失败判定。', 30],
    ['执行并保留所有结果', '保存成功、失败和异常日志；不要只保留最好的一次。', 45],
    ['检查难度与数据完整性', '列出缺失结果、场景难度差异和需要修正的评测实现。', 30],
  ],
  'milestone-08': [
    ['设计一组指标消融', '写清去掉哪条规则/事件、预期改变哪个分项指标。', 30],
    ['人工抽查行为评分', '抽查正常与失败片段，保存评分与人工观察是否一致的记录。', 45],
    ['记录有效性和局限', '用结果说明指标区分了什么行为；无法排除的难度影响明确写出。', 30],
  ],
  'milestone-09': [
    ['整理安全与规则分项', '从原始日志生成分项表/图，给每项附上样本数和单位。', 45],
    ['核对恢复与失败案例', '至少列出典型失败、事件后恢复过程及其原始日志位置。', 30],
    ['写出结论边界', '报告波动、样本限制和不能从当前实验推出的结论。', 30],
  ],
  'milestone-10': [
    ['核实真实考试和作业日期', '把已确认的考试/交付日期写入现有日程；未知日期保留待确认。', 20],
    ['冻结当前研究版本', '保存任务、代码、配置和结果清单，明确之后只维护哪些项。', 30],
    ['确认考试周维护上限', '按实际考试安排将科研维护控制在约2小时/周；需要变更的日程由你确认。', 20],
  ],
  'milestone-11': [
    ['搭出报告结构', '列出问题、方法、实验、局限和贡献边界，并链接现有结果。', 30],
    ['填入可核对证据', '每个关键结论对应图表/日志/来源；标明未完成部分。', 45],
    ['先核对课程交付', '检查最近考试与课程提交是否完成；不足时推迟非必要投稿工作。', 20],
  ],
  'milestone-12': [
    ['打包研究交付清单', '代码、协议、日志、图表和报告有明确版本及运行入口。', 30],
    ['取得导师评审', '记录导师对论文定位、贡献和当前缺口的具体意见。', 30],
    ['决定下一阶段范围', '依据反馈选择继续、改题或停止，并写下一阶段最多3项验收目标。', 30],
  ],
};
const LONG_TERM = {
  'goal-graduation': [
    ['建立升学条件清单', '保存国内与海外候选路径的当届官方条件，分别标注已满足、待补和未知。', 30],
    ['核实一个关键资格', '对当前最影响路径的资格取得书面依据；未回复则记录待确认，不当作通过。', 30],
    ['完成一次路径复盘', '按成绩、科研反馈、费用与时间调整优先路径，保留理由和下一次复盘日期。', 30],
  ],
  'goal-portable-skills': [
    ['选一个能展示的作品', '限定一个具体问题、使用者和可运行成果；用现有项目积累，避免再开大坑。', 20],
    ['做一个最小可运行版本', '保留运行入口、示例输入和真实输出；别人可按说明复现。', 45],
    ['补齐说明与反馈', '写清解决问题、局限和你的贡献，记录一次真实使用或评审反馈。', 30],
  ],
  'goal-opportunity': [
    ['只选一项小服务', '从成交工作台选一项，写清客户、交付物、报价假设与不提供的范围；每周探索上限2小时。', 20],
    ['核对一个真实需求', '保存原始需求链接并核实是否仍有效；没有直接付费证据就标为待验证。', 25],
    ['做一个可验收样例', '用自有/授权数据展示输入、输出与交付边界，完整记录耗时和成本。', 45],
    ['作出继续或停止决定', '记录真实咨询/付费结果和有效时薪；未达成付费也可如实结束验证，决定是否继续。', 20],
  ],
  'goal-sustainable-life': [
    ['记录一周真实负荷', '记录睡眠、通勤、备课和实际收支；缺失数据留空，不用模板值代替实测。', 15],
    ['调整一个主要摩擦点', '只修改一个影响最大的安排，并保留睡眠与必要现金流。', 20],
    ['核对调整后的体验', '比较实测用时和主观疲劳，记下继续、回退或再调整的决定。', 15],
  ],
};

function defaults(goal) {
  if (MILESTONES[goal.id]) return chain(MILESTONES[goal.id]);
  if (LONG_TERM[goal.id]) return chain(LONG_TERM[goal.id]);
  if (goal.kind === 'experiment') return chain([
    ['确定一个客户与交付边界', `围绕“${goal.title}”写清一个客户、一个交付物、报价假设与止损条件。`, 20],
    ['验证一条真实需求', '保留原始来源和日期，区分明确付费、一般痛点与个人推测；不把热度当订单。', 25],
    ['交付样例并核算成本', '使用自有或获授权材料，按验收标准做一个样例；记录获客、准备、交付与修改用时。', 45],
    ['记录结果并作决定', '如实记录咨询/付费/无需求的结果和有效时薪，决定继续、缩小范围或停止。', 20],
  ]);
  const notes = String(goal.notes || '').trim();
  return chain([
    ['明确本轮的交付物', `为“${goal.title}”写出一个可检查的成果、范围和验收方式。`, 20],
    ['完成并保存成果', notes ? `对照目标说明完成本轮成果：${notes.slice(0, 900)}` : '按上一项确定的范围完成成果，保留文件、链接或核对记录。', 45],
    ['核对验收并决定下一步', '逐项核对交付和完成标准；仍缺什么就继续本轮，完成后再由你决定下一轮。', 20],
  ]);
}

export function flowForGoal(goal, taskProgress) {
  const saved = taskProgress?.byGoal?.[goal.id];
  const steps = saved?.steps ?? defaults(goal); const completed = saved?.completed ?? {};
  const completedCount = steps.filter(item => Boolean(completed[item.id])).length;
  return {steps, completed, completedCount, complete: Boolean(goal.completed) || completedCount === steps.length};
}
function milestonePredecessors(state, goal) {
  if (goal.kind !== 'milestone') return [];
  const milestones = state.goals.filter(item => item.kind === 'milestone').map((item, index) => ({item, index})).sort((a, b) => (a.item.week ?? a.index + 1) - (b.item.week ?? b.index + 1));
  const position = milestones.findIndex(entry => entry.item.id === goal.id);
  return milestones.slice(0, position).map(entry => entry.item).filter(item => !flowForGoal(item, state.taskProgress).complete);
}

/** One ready step per goal, with the milestone chain respected even after a missed due date. */
export function nextActions(state, dateISO, {limit = 3} = {}) {
  calendarDate(dateISO);
  const goalPriority = {'goal-opportunity': 1, 'goal-portable-skills': 2, 'goal-graduation': 3, 'goal-sustainable-life': 4};
  const result = [];
  for (const [index, goal] of state.goals.entries()) {
    const flow = flowForGoal(goal, state.taskProgress);
    if (flow.complete || milestonePredecessors(state, goal).length) continue;
    const ready = flow.steps.find(item => !flow.completed[item.id] && item.dependsOn.every(dep => flow.completed[dep]));
    if (!ready) continue;
    result.push({goal, step: ready, completedCount: flow.completedCount, totalSteps: flow.steps.length, overdue: Boolean(goal.due && goal.due < dateISO), priority: goal.kind === 'milestone' ? 0 : goal.kind === 'experiment' ? 1 : (goalPriority[goal.id] ?? 2), index});
  }
  result.sort((a, b) => a.priority - b.priority || a.index - b.index);
  return result.slice(0, Math.max(1, Math.min(3000, Number.isInteger(limit) ? limit : 3)));
}

function goalInState(state, goalId) {
  identifier(goalId);
  const goal = state.goals.find(item => item.id === goalId);
  if (!goal) fail('目标已被删除，请刷新任务列表');
  return goal;
}
function withFlow(state, goalId, value) {
  const progress = normalizeTaskProgress(state.taskProgress);
  return {...state, taskProgress: normalizeTaskProgress({version: 1, byGoal: {...progress.byGoal, [goalId]: value}})};
}

export function completeTaskStep(state, goalId, stepId, dateISO, evidence = '') {
  calendarDate(dateISO); const goal = goalInState(state, goalId); const flow = flowForGoal(goal, state.taskProgress);
  if (goal.completed) fail('整项目标已完成，请先在计划页撤销完成或创建下一轮');
  if (milestonePredecessors(state, goal).length) fail('请先完成前面的里程碑，或在计划页调整目标顺序');
  const task = flow.steps.find(item => item.id === stepId);
  if (!task) fail('步骤已变化，请重新选择');
  if (flow.completed[stepId]) return state;
  if (task.dependsOn.some(dep => !flow.completed[dep])) fail('请先完成此步骤的前置行动');
  return withFlow(state, goalId, {steps: flow.steps, completed: {...flow.completed, [stepId]: {completedAt: dateISO, evidence: content(evidence, '完成凭据', 1200, true)}}});
}

function descendants(steps, roots) {
  const result = new Set(roots); let changed = true;
  while (changed) {
    changed = false;
    for (const task of steps) if (!result.has(task.id) && task.dependsOn.some(dep => result.has(dep))) {result.add(task.id); changed = true;}
  }
  return result;
}
export function undoTaskStep(state, goalId, stepId) {
  const goal = goalInState(state, goalId); const flow = flowForGoal(goal, state.taskProgress);
  if (!flow.completed[stepId]) return state;
  const removed = descendants(flow.steps, [stepId]);
  return withFlow(state, goalId, {steps: flow.steps, completed: Object.fromEntries(Object.entries(flow.completed).filter(([key]) => !removed.has(key)))});
}

/** Editing acceptance or dependencies invalidates that step and its dependent completions. */
export function saveTaskSteps(state, goalId, input) {
  const goal = goalInState(state, goalId); const before = flowForGoal(goal, state.taskProgress); const steps = normalizeTaskSteps(input);
  const changed = new Set(); const beforeById = new Map(before.steps.map(item => [item.id, item]));
  const acceptanceSignature = task => task ? JSON.stringify([task.title, task.acceptance, [...task.dependsOn].sort()]) : null;
  for (const task of steps) if (acceptanceSignature(task) !== acceptanceSignature(beforeById.get(task.id))) changed.add(task.id);
  const invalidated = descendants(steps, changed); const ids = new Set(steps.map(item => item.id));
  const completed = Object.fromEntries(Object.entries(before.completed).filter(([key]) => ids.has(key) && !invalidated.has(key)));
  return withFlow(state, goalId, {steps, completed});
}

export function addTaskGoal(state, input, inputSteps) {
  if (state.goals.length >= 3000) fail('目标已达到数量上限');
  record(input, '下一轮目标'); const goalId = identifier(input.id);
  if (state.goals.some(item => item.id === goalId)) fail('目标ID重复');
  const goal = {id: goalId, title: content(input.title, '目标名称', 180), notes: content(input.notes ?? '', '目标说明', 6000, true), due: input.due ? calendarDate(input.due) : null, kind: ['experiment','longterm'].includes(input.kind) ? input.kind : 'custom', status: 'pending', category: 'custom', completed: false, editable: true};
  return withFlow({...state, goals: [...state.goals, goal]}, goalId, {steps: normalizeTaskSteps(inputSteps), completed: {}});
}
