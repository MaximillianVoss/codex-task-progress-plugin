const KINDS = new Set(['task', 'tasks', 'project', 'portfolio']);
const STATUSES = new Set(['working', 'checking', 'blocked', 'paused', 'unknown', 'accepted']);
const BASES = new Set(['unknown', 'estimate', 'fixed_checklist', 'stages']);
const PHASES = new Set(['pending', 'working', 'checking', 'accepted', 'unknown', 'blocked', 'paused']);
const DISPLAY_PHASES = new Set([...PHASES, 'blocked', 'paused']);
const LABELS = { working: '🔵 Работа', checking: '🟣 Проверка', blocked: '🟠 Блокировка', paused: '⏸ Пауза', unknown: '⚪ Неизвестно', accepted: '🟢 Принято' };
const PHASE_LABELS = { ...LABELS, pending: '⚪ Ожидает', accepted: '🟢 Этап принят' };
const SCOPE_LABELS = { task: 'задача', tasks: 'набор задач', project: 'проект', portfolio: 'портфель' };
const own = (obj, key) => Object.hasOwn(obj, key);

export class ContractError extends Error {
  constructor(message, code = 'INVALID_DATA') { super(message); this.code = code; }
}
function requireThat(ok, message) { if (!ok) throw new ContractError(message); }
function object(value, field, allowed) {
  requireThat(value !== null && typeof value === 'object' && !Array.isArray(value), `${field}: нужен объект`);
  requireThat(Object.keys(value).every(key => allowed.includes(key)), `${field}: неподдерживаемые поля`);
}
function string(value, field, max = 400) {
  requireThat(typeof value === 'string' && value.trim().length > 0 && value.length <= max, `${field}: нужна непустая строка до ${max} символов`);
}
function id(value, field) { requireThat(typeof value === 'string' && /^[\p{L}\p{N}_.:-]{1,128}$/u.test(value), `${field}: недопустимый идентификатор`); }
function date(value, field, nullable = false) {
  if (nullable && value === null) return;
  requireThat(typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(value) && Number.isFinite(Date.parse(value)), `${field}: нужна ISO-дата с часовым поясом`);
  // Date.parse normalizes impossible calendar dates (e.g. 30 February).
  const day = value.slice(0, 10);
  const calendar = new Date(`${day}T00:00:00Z`);
  requireThat(calendar.toISOString().slice(0, 10) === day, `${field}: невозможная календарная дата`);
}
function source(value, field) {
  object(value, field, ['ref', 'evidence']); string(value.ref, `${field}.ref`); string(value.evidence, `${field}.evidence`);
}
function scope(value, field, allowTasks = false) {
  object(value, field, allowTasks ? ['kind', 'id', 'taskIds'] : ['kind', 'id']);
  requireThat(KINDS.has(value.kind) && (allowTasks || value.kind !== 'tasks'), `${field}: недопустимый тип области`); id(value.id, `${field}.id`);
  if (value.kind === 'tasks' && allowTasks) {
    requireThat(Array.isArray(value.taskIds) && value.taskIds.length > 0 && value.taskIds.length <= 100, `${field}.taskIds: нужен непустой список`);
    value.taskIds.forEach(item => id(item, `${field}.taskIds`));
    requireThat(new Set(value.taskIds).size === value.taskIds.length, `${field}.taskIds: повторяющиеся задачи`);
  } else requireThat(!own(value, 'taskIds'), `${field}: taskIds применим только к tasks`);
}
function percent(value, field) { requireThat(typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 100, `${field}: процент должен быть конечным числом от 0 до 100`); }
function range(value, field) {
  if (typeof value === 'number') { percent(value, field); return { min: value, max: value }; }
  object(value, field, ['min', 'max']); percent(value.min, `${field}.min`); percent(value.max, `${field}.max`);
  requireThat(value.min <= value.max, `${field}: min больше max`); return { min: value.min, max: value.max };
}
function weight(value, field) { requireThat(typeof value === 'number' && Number.isFinite(value) && value > 0 && value <= 1e9, `${field}: вес должен быть больше 0 и не больше 1e9`); }
function validateDisplayStages(value) {
  object(value, 'task.stages', ['source', 'items']); source(value.source, 'task.stages.source');
  requireThat(Array.isArray(value.items) && value.items.length > 0 && value.items.length <= 40, 'task.stages.items: нужен список от 1 до 40 этапов');
  const ids = new Set();
  for (const phase of value.items) {
    object(phase, 'task.stages.items', ['id', 'label', 'status', 'evidence']); id(phase.id, 'stage.id');
    requireThat(!ids.has(phase.id), 'task.stages.items: повтор этапа'); ids.add(phase.id); string(phase.label, 'stage.label', 200);
    requireThat(DISPLAY_PHASES.has(phase.status), 'task.stages.items: неизвестный статус этапа');
    if (phase.status === 'accepted') string(phase.evidence, 'stage.evidence');
    else if (phase.evidence !== null && phase.evidence !== undefined) string(phase.evidence, 'stage.evidence');
  }
}
function validateProgress(value, field) {
  object(value, field, ['basis', 'scope', 'value', 'source', 'stages', 'visualEstimate']);
  requireThat(BASES.has(value.basis), `${field}: неизвестное основание`); scope(value.scope, `${field}.scope`);
  requireThat(own(value, 'value'), `${field}.value: укажите значение или null`);
  if (value.value !== null) range(value.value, `${field}.value`);
  if (value.basis !== 'unknown') source(value.source, `${field}.source`);
  else if (value.source !== null && value.source !== undefined) source(value.source, `${field}.source`);
  if (value.basis === 'unknown') requireThat(value.value === null, `${field}: unknown требует null`);
  if (value.basis === 'fixed_checklist') requireThat(value.value === null || typeof value.value === 'number', `${field}: fixed_checklist требует одно принятое число`);
  if (value.basis === 'stages') {
    requireThat(value.value === null && Array.isArray(value.stages) && value.stages.length > 0 && value.stages.length <= 40, `${field}: stages требует value=null и список этапов`);
    const ids = new Set();
    for (const phase of value.stages) {
      object(phase, `${field}.stages`, ['id', 'label', 'weight', 'status', 'evidence']); id(phase.id, 'stage.id');
      requireThat(!ids.has(phase.id), `${field}: повтор этапа`); ids.add(phase.id); string(phase.label, 'stage.label', 200); weight(phase.weight, 'stage.weight');
      requireThat(PHASES.has(phase.status), `${field}: неизвестный статус этапа`);
      if (phase.status === 'accepted') string(phase.evidence, 'stage.evidence');
      else if (phase.evidence !== null && phase.evidence !== undefined) string(phase.evidence, 'stage.evidence');
    }
  } else requireThat(!own(value, 'stages'), `${field}: этапы допустимы только для stages`);
  if (own(value, 'visualEstimate') && value.visualEstimate !== null) {
    object(value.visualEstimate, `${field}.visualEstimate`, ['value', 'source']); range(value.visualEstimate.value, 'visualEstimate.value'); source(value.visualEstimate.source, 'visualEstimate.source');
    requireThat(value.basis === 'fixed_checklist', `${field}: visualEstimate допустим рядом с fixed_checklist`);
  }
}
function validateTask(task) {
  object(task, 'task', ['id', 'title', 'projectId', 'portfolioId', 'status', 'stage', 'stages', 'updatedAt', 'dataStatus', 'dataError', 'accepted', 'blockers', 'acceptance', 'progress']);
  id(task.id, 'task.id'); string(task.title, 'task.title', 160);
  for (const key of ['projectId', 'portfolioId']) if (task[key] !== null && task[key] !== undefined) id(task[key], `task.${key}`);
  requireThat(STATUSES.has(task.status), 'task.status: неизвестный статус');
  if (task.stage !== null) string(task.stage, 'task.stage', 240);
  date(task.updatedAt, 'task.updatedAt', true);
  requireThat(['ok', 'error', 'unknown'].includes(task.dataStatus), 'task.dataStatus: ожидается ok/error/unknown');
  if (task.dataError !== null && task.dataError !== undefined) string(task.dataError, 'task.dataError');
  requireThat(Array.isArray(task.accepted) && task.accepted.length <= 8, 'task.accepted: нужен список до 8 элементов');
  for (const item of task.accepted) { object(item, 'task.accepted', ['label', 'evidence']); string(item.label, 'accepted.label', 200); string(item.evidence, 'accepted.evidence'); }
  requireThat(Array.isArray(task.blockers) && task.blockers.length <= 8, 'task.blockers: нужен список до 8 элементов'); task.blockers.forEach(item => string(item, 'task.blockers', 240));
  if (task.acceptance !== null) {
    object(task.acceptance, 'task.acceptance', ['acceptedAt', 'evidence']); date(task.acceptance.acceptedAt, 'acceptance.acceptedAt'); string(task.acceptance.evidence, 'acceptance.evidence');
  }
  // Progress semantics are checked per task later, so one bad percentage cannot hide other tasks.
  object(task.progress, 'task.progress', ['basis', 'scope', 'value', 'source', 'stages', 'visualEstimate']);
  if (own(task, 'stages')) {
    validateDisplayStages(task.stages);
    requireThat(task.progress.basis !== 'stages', 'task.stages: нельзя совмещать отдельный перечень с progress.basis=stages');
  }
}
export function validateSnapshot(snapshot) {
  object(snapshot, 'snapshot', ['schemaVersion', 'demo', 'selection', 'staleAfterMinutes', 'tasks', 'aggregation']);
  requireThat(snapshot.schemaVersion === 1, 'Поддерживается schemaVersion=1');
  if (own(snapshot, 'demo')) requireThat(typeof snapshot.demo === 'boolean', 'demo: требуется boolean');
  scope(snapshot.selection, 'selection', true);
  requireThat(typeof snapshot.staleAfterMinutes === 'number' && Number.isFinite(snapshot.staleAfterMinutes) && snapshot.staleAfterMinutes >= 1 && snapshot.staleAfterMinutes <= 10080, 'staleAfterMinutes: допустим диапазон 1–10080');
  requireThat(Array.isArray(snapshot.tasks) && snapshot.tasks.length <= 100, 'tasks: максимум 100 задач');
  const ids = new Set();
  for (const task of snapshot.tasks) { validateTask(task); requireThat(!ids.has(task.id), 'Повторяющийся task.id'); ids.add(task.id); }
  if (snapshot.aggregation !== null && snapshot.aggregation !== undefined) {
    const aggregation = snapshot.aggregation;
    object(aggregation, 'aggregation', ['scope', 'members', 'source']);
    object(aggregation.scope, 'aggregation.scope', ['kind', 'id']);
    requireThat(['tasks', 'project', 'portfolio'].includes(aggregation.scope.kind), 'aggregation.scope: недопустимая область');
    id(aggregation.scope.id, 'aggregation.scope.id'); source(aggregation.source, 'aggregation.source');
    requireThat(aggregation.scope.kind !== 'task', 'aggregation: единичной задаче не нужен агрегат');
    requireThat(Array.isArray(aggregation.members) && aggregation.members.length > 0 && aggregation.members.length <= 100, 'aggregation.members: нужен список');
    const members = new Set();
    for (const member of aggregation.members) { object(member, 'member', ['taskId', 'weight']); id(member.taskId, 'member.taskId'); weight(member.weight, 'member.weight'); requireThat(!members.has(member.taskId), 'Повтор участника агрегата'); members.add(member.taskId); }
  }
  return snapshot;
}
function sameScope(a, b) { return a?.kind === b?.kind && a?.id === b?.id; }
function freshness(task, now, staleMinutes) {
  if (task.dataStatus === 'error') return { state: 'error', label: 'ошибка источника', ageMinutes: null };
  if (task.updatedAt === null || task.dataStatus === 'unknown') return { state: 'unknown', label: 'свежесть неизвестна', ageMinutes: null };
  const ageMinutes = (now - Date.parse(task.updatedAt)) / 60000;
  if (ageMinutes < -1) return { state: 'future', label: 'дата источника в будущем', ageMinutes };
  if (ageMinutes > staleMinutes) return { state: 'stale', label: 'устарело', ageMinutes };
  return { state: 'fresh', label: 'свежие данные', ageMinutes: Math.max(0, ageMinutes) };
}
function deriveTask(task, now, staleMinutes) {
  const issues = [];
  const fresh = freshness(task, now, staleMinutes);
  let candidate = null;
  let stageCoverage = null;
  let basis = 'unknown';
  let progressSource = null;
  let acceptanceConfirmed = false;
  let stages = task.stages ? structuredClone(task.stages.items) : [];
  let stageSource = task.stages ? 'display' : null;
  let stageSourceEvidence = task.stages ? structuredClone(task.stages.source) : null;
  try {
    validateProgress(task.progress, `progress(${task.id})`);
    basis = task.progress.basis;
    progressSource = task.progress.source ?? null;
    requireThat(sameScope(task.progress.scope, { kind: 'task', id: task.id }), 'Оценка относится к другой области; она не является прогрессом этой задачи');
    if (basis === 'stages') {
      stages = structuredClone(task.progress.stages);
      stageSource = 'progress';
      stageSourceEvidence = structuredClone(task.progress.source);
      const phases = task.progress.stages;
      const total = phases.reduce((sum, phase) => sum + phase.weight, 0);
      const acceptedWeight = phases.filter(phase => phase.status === 'accepted').reduce((sum, phase) => sum + phase.weight, 0);
      const knownWeight = phases.filter(phase => phase.status !== 'unknown').reduce((sum, phase) => sum + phase.weight, 0);
      stageCoverage = { acceptedWeight, knownWeight, totalWeight: total };
    }
    if (task.acceptance !== null) requireThat(task.status === 'accepted', 'Приёмка и текущий статус противоречат друг другу');
    if (task.status === 'accepted') {
      requireThat(task.acceptance !== null, '100% требует отдельного evidence фактической приёмки');
      const acceptedAt = Date.parse(task.acceptance.acceptedAt);
      requireThat(acceptedAt <= now && task.updatedAt !== null && acceptedAt <= Date.parse(task.updatedAt), 'Дата приёмки не согласуется со снимком');
      requireThat(task.blockers.length === 0, 'Приёмка противоречит незакрытым препятствиям');
      acceptanceConfirmed = true;
      // A locked accepted checklist is never increased by an unrelated completion flag.
      if (basis === 'fixed_checklist') requireThat(task.progress.value === 100, 'Принятый checklist ещё не 100%; противоречие с приёмкой');
      if (basis === 'stages') requireThat(task.progress.stages.every(phase => phase.status === 'accepted'), 'Приёмка всей задачи противоречит незавершённым этапам');
      candidate = { min: 100, max: 100 };
    } else if (basis === 'stages') {
      const phases = task.progress.stages;
      requireThat(phases.every(phase => phase.status !== 'unknown'), 'Статус части этапов неизвестен; текущий процент всей задачи неизвестен');
      requireThat(phases.some(phase => phase.status !== 'accepted'), 'Этапы отмечены принятыми, но фактическая приёмка всей задачи не подтверждена');
      candidate = { min: stageCoverage.acceptedWeight / stageCoverage.totalWeight * 100, max: stageCoverage.acceptedWeight / stageCoverage.totalWeight * 100 };
      requireThat(candidate.max < 100 && !(stageCoverage.acceptedWeight > 0 && candidate.min === 0), 'Точность чисел недостаточна для честного процента этапов; оценка неизвестна');
    } else if (task.progress.value !== null) {
      candidate = range(task.progress.value, 'progress.value');
      requireThat(candidate.max < 100, '100% и граница 100% требуют фактической приёмки; процент неизвестен');
    }
    if (basis === 'fixed_checklist' && task.progress.visualEstimate) issues.push('Дополнительная visualEstimate не применяется: сохранена принятая оценка checklist');
  } catch (error) {
    if (!(error instanceof ContractError)) throw error;
    issues.push(error.message); candidate = null; acceptanceConfirmed = false;
  }
  if (task.status === 'unknown') issues.push('Статус задачи неизвестен');
  if (task.dataStatus === 'error' && task.dataError) issues.push(`Источник: ${task.dataError}`);
  const current = fresh.state === 'fresh' && task.status !== 'unknown' && candidate !== null;
  return {
    id: task.id, title: task.title, projectId: task.projectId ?? null, portfolioId: task.portfolioId ?? null,
    status: task.status, stage: task.stage, updatedAt: task.updatedAt, freshness: fresh,
    progress: current ? candidate : null, lastKnown: current ? null : candidate,
    basis, source: progressSource, accepted: task.accepted, blockers: task.blockers,
    acceptanceConfirmed: current && acceptanceConfirmed, acceptance: task.acceptance, stageCoverage, stages, stageSource, stageSourceEvidence, issues
  };
}
function missingTask(taskId) {
  return { id: taskId, title: 'Данные задачи отсутствуют', status: 'unknown', stage: null, updatedAt: null,
    freshness: { state: 'unknown', label: 'свежесть неизвестна', ageMinutes: null }, progress: null, lastKnown: null,
    basis: 'unknown', source: null, accepted: [], blockers: [], acceptance: null, acceptanceConfirmed: false,
    stageCoverage: null, stages: [], stageSource: null, stageSourceEvidence: null, issues: ['Задача входит в выбранную область, но её снимок не передан'] };
}
function aggregate(snapshot, selection, tasks, warnings) {
  const spec = snapshot.aggregation;
  if (selection.kind === 'task') return null;
  const unavailable = reason => ({ progress: null, knownSubset: null, coveragePercent: null, reason, formula: null });
  if (!spec || !sameScope(spec.scope, selection)) return unavailable('Итог неизвестен: нет весов и полного состава именно выбранной области');
  const expected = new Set(spec.members.map(member => member.taskId));
  if (tasks.some(task => !expected.has(task.id)) || (selection.kind === 'tasks' && (selection.taskIds.length !== expected.size || selection.taskIds.some(taskId => !expected.has(taskId))))) {
    warnings.push('Состав агрегата не совпадает с выбранными задачами');
    return unavailable('Итог неизвестен: состав или область агрегата не совпадают');
  }
  const byId = new Map(tasks.map(task => [task.id, task]));
  const totalWeight = spec.members.reduce((sum, member) => sum + member.weight, 0);
  const known = spec.members.filter(member => byId.get(member.taskId)?.progress !== null && byId.has(member.taskId));
  const knownWeight = known.reduce((sum, member) => sum + member.weight, 0);
  const maxWeight = known.length ? Math.max(...known.map(member => member.weight)) : 1;
  const normalizedWeight = known.reduce((sum, member) => sum + member.weight / maxWeight, 0);
  let mean = knownWeight === 0 ? null : {
    min: known.reduce((sum, member) => sum + byId.get(member.taskId).progress.min * (member.weight / maxWeight), 0) / normalizedWeight,
    max: known.reduce((sum, member) => sum + byId.get(member.taskId).progress.max * (member.weight / maxWeight), 0) / normalizedWeight
  };
  const knownAccepted = known.length > 0 && known.every(member => byId.get(member.taskId).acceptanceConfirmed);
  const numericBoundary = mean !== null && ((mean.max >= 100 && !knownAccepted) || (mean.max === 0 && known.some(member => byId.get(member.taskId).progress.max > 0)));
  if (numericBoundary) mean = null;
  const complete = known.length === spec.members.length;
  return { scope: spec.scope, progress: complete ? mean : null, knownSubset: complete ? null : mean,
    knownCount: known.length, totalCount: spec.members.length, knownWeight, totalWeight, coveragePercent: knownWeight / totalWeight * 100,
    reason: numericBoundary ? 'Итог неизвестен: точность чисел недостаточна; 100% без полной приёмки запрещены' : complete ? null : 'Текущий итог всей области неизвестен: охват неполный', source: spec.source,
    formula: { terms: known.map(member => ({ taskId: member.taskId, weight: member.weight, value: byId.get(member.taskId).progress })), denominator: knownWeight, fullDenominator: totalWeight },
    acceptanceConfirmed: complete && tasks.every(task => task.acceptanceConfirmed) };
}

export function buildReport(snapshot, options = {}) {
  validateSnapshot(snapshot);
  const now = options.now ?? new Date().toISOString(); date(now, 'renderedAt'); const nowMs = Date.parse(now);
  const selection = options.selection ?? snapshot.selection; scope(selection, 'selection', true);
  const warnings = [];
  let raw = snapshot.tasks.filter(task => selection.kind === 'task' ? task.id === selection.id
    : selection.kind === 'tasks' ? selection.taskIds.includes(task.id)
    : selection.kind === 'project' ? task.projectId === selection.id : task.portfolioId === selection.id);
  const spec = snapshot.aggregation;
  let scopeConflict = false;
  if (selection.kind !== 'task' && spec && sameScope(spec.scope, selection)) {
    const expected = new Set(spec.members.map(member => member.taskId));
    const conflicting = snapshot.tasks.filter(task => expected.has(task.id) && !raw.includes(task));
    if (conflicting.length) { warnings.push('Членство задач противоречит области агрегата; чужой процент не применяется'); scopeConflict = true; }
  }
  const tasks = raw.map(task => deriveTask(task, nowMs, snapshot.staleAfterMinutes));
  const expectedIds = selection.kind === 'task' ? [selection.id] : selection.kind === 'tasks' ? selection.taskIds
    : spec && sameScope(spec.scope, selection) ? spec.members.map(member => member.taskId) : [];
  for (const taskId of expectedIds) if (!tasks.some(task => task.id === taskId)) tasks.push(missingTask(taskId));
  if (tasks.length === 0) warnings.push('В выбранной области нет переданных задач; прогресс неизвестен');
  const total = aggregate(snapshot, selection, tasks, warnings);
  if (scopeConflict && total) { total.progress = null; total.knownSubset = null; total.reason = 'Итог неизвестен: принадлежность задач противоречит выбранной области'; }
  return { schemaVersion: 1, demo: snapshot.demo === true, renderedAt: now, selection, staleAfterMinutes: snapshot.staleAfterMinutes, tasks, aggregate: total, warnings };
}

export function escapeMarkdown(value) {
  return String(value).replace(/[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/g, ' ').replace(/\s+/g, ' ').replace(/[\\`*_{}\[\]<>()#!|~]/g, '\\$&').trim();
}
function num(value) {
  const floored = Math.floor((value + Number.EPSILON * Math.max(1, value) * 4) * 100) / 100;
  return Math.min(value < 100 ? 99.99 : value, floored).toLocaleString('ru-RU', { maximumFractionDigits: 2 });
}
function exactNumber(value) { return String(value).replace('.', ','); }
function percentNumber(value) { return value > 0 && value < 0.01 ? 'менее 0,01' : num(value); }
function valueText(value, exact = false) {
  const format = exact ? exactNumber : percentNumber;
  return value.min === value.max ? `${format(value.min)}%` : `${format(value.min)}–${format(value.max)}%`;
}
function bar(value) { if (!value) return '`??????????`'; const filled = Math.floor(value.min / 10); return '`' + '▰'.repeat(filled) + '▱'.repeat(10 - filled) + '`'; }
function progressText(task) {
  if (!task.progress) {
    const historicalAcceptance = task.status === 'accepted' && task.lastKnown?.min === 100 && task.lastKnown.max === 100;
    const last = historicalAcceptance ? ' · последняя подтверждённая приёмка: 100% по снимку' : task.lastKnown ? ` · последняя ${task.basis === 'fixed_checklist' ? 'по checklist' : 'примерно'} ${valueText(task.lastKnown, task.basis === 'fixed_checklist')}` : '';
    return `${bar(null)} **неизвестно**${last}`;
  }
  if (task.acceptanceConfirmed) return `${bar(task.progress)} **100% · принято**`;
  return `${bar(task.progress)} **${task.basis === 'fixed_checklist' ? `${valueText(task.progress, true)} по принятому checklist` : `примерно ${valueText(task.progress)}`}**`;
}
function statusText(task) {
  if (task.status !== 'accepted' || task.acceptanceConfirmed) return LABELS[task.status];
  return task.lastKnown?.min === 100 && task.lastKnown.max === 100 ? '⚪ Приёмка по снимку' : '⚪ Приёмка не подтверждена';
}
function freshText(task) { return `${task.freshness.label}${task.updatedAt ? ` · ${escapeMarkdown(task.updatedAt)}` : ''}`; }
function scopeText(selection) { return `${SCOPE_LABELS[selection.kind]} ${escapeMarkdown(selection.id)}${selection.kind === 'tasks' ? ` · ${selection.taskIds.map(escapeMarkdown).join(', ')}` : ''}`; }
function evidenceText(task) { return task.source ? `${escapeMarkdown(task.source.ref)} — ${escapeMarkdown(task.source.evidence)}` : 'не передан'; }
function stagesMarkdown(task) {
  const lines = [`**Этапы · ${escapeMarkdown(task.id)}**`, '',
    task.stageSource === 'display' ? 'Перечень для отображения; не участвует в расчёте процента и приёмке всей задачи.' : 'Веса этапов используются в расчёте оценки; приёмка всей задачи подтверждается отдельно.',
    `Свежесть этапов: ${freshText(task)}.${task.freshness.state === 'fresh' ? '' : ' Последние переданные статусы; их актуальность не подтверждена.'}`, ''];
  for (const phase of task.stages) {
    const status = task.freshness.state !== 'fresh' && phase.status === 'accepted' ? '⚪ Этап принят по снимку' : PHASE_LABELS[phase.status];
    lines.push(`- **${escapeMarkdown(phase.label)}** · ${status}${own(phase, 'weight') ? ` · вес ${exactNumber(phase.weight)}` : ''} · ${phase.evidence ? `evidence: ${escapeMarkdown(phase.evidence)}` : 'evidence не передан'}.`);
  }
  const stageSource = task.stageSourceEvidence;
  lines.push('', `Источник этапов: ${stageSource ? `${escapeMarkdown(stageSource.ref)} — ${escapeMarkdown(stageSource.evidence)}` : 'не передан'}.`);
  return lines;
}
function aggregateMarkdown(total) {
  if (!total) return [];
  const lines = [];
  if (total.progress) lines.push(`**Итог выбранной области: ${total.acceptanceConfirmed ? '100% · все задачи приняты' : `примерно ${valueText(total.progress)}`}**`);
  else lines.push(`**${total.reason}**${total.knownSubset ? `; по известной части примерно ${valueText(total.knownSubset)}.` : '.'}`);
  if (total.coveragePercent !== null) lines.push(`Охват: ${total.knownCount}/${total.totalCount} задач; вес ${exactNumber(total.knownWeight)}/${exactNumber(total.totalWeight)} (${num(total.coveragePercent)}%).`);
  if (total.formula) {
    const terms = total.formula.terms.map(term => `${escapeMarkdown(term.taskId)}:${valueText(term.value)}×${exactNumber(term.weight)}`).join(' + ') || 'нет известных значений';
    lines.push(`Формула ${total.progress ? 'итога' : 'известной части'}: (${terms}) / ${exactNumber(total.formula.denominator)}; полный вес области ${exactNumber(total.formula.fullDenominator)}.${total.formula.denominator === 0 ? ' Деление не выполнялось.' : ''}`);
    lines.push(`Источник состава/весов: ${escapeMarkdown(total.source.ref)} — ${escapeMarkdown(total.source.evidence)}.`);
  }
  return lines;
}
export function renderMarkdown(report) {
  const lines = [];
  if (report.demo) lines.push('> Демонстрация · синтетические данные, не текущий прогресс рабочих проектов.', '');
  lines.push(`**Прогресс · ${scopeText(report.selection)}**`, '', `Показ: ${report.renderedAt} · порог свежести ${report.staleAfterMinutes} мин. Шкала примерно: 10 сегментов, вниз по нижней границе.`, '');
  if (report.tasks.length === 1) {
    const task = report.tasks[0];
    lines.push(`**${escapeMarkdown(task.title)}** · ${escapeMarkdown(task.id)}`, '', `${progressText(task)} · ${statusText(task)}`, '', `- Сейчас: ${task.stage ? escapeMarkdown(task.stage) : 'стадия неизвестна'}.`,
      `- Принято: ${task.accepted.length ? task.accepted.map(item => `${escapeMarkdown(item.label)} [evidence: ${escapeMarkdown(item.evidence)}]`).join('; ') : 'подтверждённые результаты не переданы'}.`,
      `- Мешает / осталось: ${task.blockers.length ? task.blockers.map(escapeMarkdown).join('; ') : task.acceptanceConfirmed ? 'Открытых препятствий нет' : 'сведения о препятствиях и остатке не переданы'}.`, `- Свежесть: ${freshText(task)}.`, `- Источник оценки: ${evidenceText(task)}.`);
  } else if (report.tasks.length > 1) {
    lines.push('| Задача | Прогресс | Состояние и стадия | Принято / мешает | Свежесть |', '|---|---|---|---|---|');
    for (const task of report.tasks) {
      const accepted = task.accepted.length ? task.accepted.map(item => escapeMarkdown(item.label)).join('; ') : 'не передано';
      const blockers = task.blockers.length ? task.blockers.map(escapeMarkdown).join('; ') : task.acceptanceConfirmed ? 'Открытых препятствий нет' : 'не передано';
      lines.push(`| **${escapeMarkdown(task.title)}** · ${escapeMarkdown(task.id)} | ${progressText(task)} | ${statusText(task)} · ${task.stage ? escapeMarkdown(task.stage) : 'стадия неизвестна'} | Принято: ${accepted}. Мешает/осталось: ${blockers} | ${freshText(task)} |`);
    }
    lines.push('', '**Источники**', '');
    for (const task of report.tasks) {
      const receipts = task.accepted.map(item => `${escapeMarkdown(item.label)}: ${escapeMarkdown(item.evidence)}`).join('; ');
      lines.push(`- ${escapeMarkdown(task.id)}: ${evidenceText(task)}${receipts ? `; принято: ${receipts}` : ''}.`);
    }
  }
  lines.push('');
  for (const task of report.tasks) {
    if (task.stages?.length) lines.push(...stagesMarkdown(task), '');
    else if (report.tasks.length === 1) lines.push('Этапы не переданы.', '');
    if (task.stageCoverage) lines.push(`Этапы ${escapeMarkdown(task.id)}: принят вес ${exactNumber(task.stageCoverage.acceptedWeight)}/${exactNumber(task.stageCoverage.totalWeight)}; известен статус веса ${exactNumber(task.stageCoverage.knownWeight)}/${exactNumber(task.stageCoverage.totalWeight)}.`);
    if (task.acceptance) lines.push(`Evidence приёмки ${escapeMarkdown(task.id)}: ${escapeMarkdown(task.acceptance.evidence)} · ${escapeMarkdown(task.acceptance.acceptedAt)}${task.acceptanceConfirmed ? '' : ' (текущая приёмка не подтверждена)'}.`);
    for (const issue of task.issues) lines.push(`⚠ ${escapeMarkdown(task.id)}: ${escapeMarkdown(issue)}.`);
  }
  if (report.aggregate) lines.push('', ...aggregateMarkdown(report.aggregate));
  for (const warning of report.warnings) lines.push(`⚠ ${escapeMarkdown(warning)}.`);
  lines.push('', '_Оценка относится только к указанной области и времени. Evidence переданы источником; renderer их внешне не проверяет._');
  return lines.join('\n') + '\n';
}
