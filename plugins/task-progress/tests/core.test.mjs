import test from 'node:test';
import assert from 'node:assert/strict';
import { buildReport, renderMarkdown, escapeMarkdown, ContractError } from '../skills/task-progress/scripts/core.mjs';
const NOW = '2026-10-21T12:10:00Z';
const proof = () => ({ ref: 'test:evidence', evidence: 'Принято в тестовом примере' });
function task(id = 'a', value = 28) { return { id, title: `Задача ${id}`, projectId: 'p', portfolioId: 'all', status: 'working', stage: 'Работа', updatedAt: '2026-10-21T12:00:00Z', dataStatus: 'ok', accepted: [], blockers: [], acceptance: null, progress: { basis: value === null ? 'unknown' : 'estimate', scope: { kind: 'task', id }, value, source: value === null ? null : proof() } }; }
function snapshot(tasks = [task()], selection = { kind: 'task', id: 'a' }) { return { schemaVersion: 1, selection, staleAfterMinutes: 60, tasks, aggregation: null }; }
const run = input => buildReport(input, { now: NOW });
const first = input => run(input).tasks[0];
function accepted(id = 'a') { const item = task(id, 100); item.status = 'accepted'; item.acceptance = { acceptedAt: '2026-10-21T11:50:00Z', evidence: 'test:final-acceptance' }; return item; }
function grouped(tasks, weights = tasks.map(() => 1)) { const input = snapshot(tasks, { kind: 'project', id: 'p' }); input.aggregation = { scope: { kind: 'project', id: 'p' }, source: proof(), members: tasks.map((item, index) => ({ taskId: item.id, weight: weights[index] })) }; return input; }
test('null differs from explicit evidence-based zero', () => {
  assert.equal(first(snapshot([task('a', null)])).progress, null);
  assert.deepEqual(first(snapshot([task('a', 0)])).progress, { min: 0, max: 0 });
});
test('working/checking/blocked/paused never create a percentage', () => {
  for (const status of ['working', 'checking', 'blocked', 'paused']) { const item = task('a', null); item.status = status; assert.equal(first(snapshot([item])).progress, null); }
});
test('unknown status preserves only a last reported value', () => { const item = task(); item.status = 'unknown'; const result = first(snapshot([item])); assert.equal(result.progress, null); assert.equal(result.lastKnown.min, 28); });
for (const invalid of [-1, 100.01, NaN, Infinity, '28', true, { min: 70, max: 30 }, { min: null, max: 50 }, {}]) {
  test(`invalid percentage is never clamped: ${JSON.stringify(invalid)}`, () => { const item = task(); item.progress.value = invalid; assert.equal(first(snapshot([item])).progress, null); });
}
test('100 and upper interval bound 100 require task acceptance', () => { assert.equal(first(snapshot([task('a', 100)])).progress, null); assert.equal(first(snapshot([task('a', { min: 90, max: 100 })])).progress, null); });
test('100 requires status, dated evidence and no open blockers', () => {
  assert.deepEqual(first(snapshot([accepted()])).progress, { min: 100, max: 100 });
  for (const mutate of [item => { item.acceptance = null; }, item => { item.acceptance.acceptedAt = '2026-10-21T12:20:00Z'; }, item => { item.blockers.push('Осталось'); }, item => { item.status = 'checking'; }]) { const item = accepted(); mutate(item); assert.equal(first(snapshot([item])).progress, null); }
});
test('fixed checklist wins over visual estimate and conflicting completion flag', () => {
  const item = task(); item.progress.basis = 'fixed_checklist'; item.progress.visualEstimate = { value: 91, source: proof() };
  assert.equal(first(snapshot([item])).progress.min, 28); assert.match(first(snapshot([item])).issues.join(' '), /не применяется/);
  item.status = 'accepted'; item.acceptance = accepted().acceptance; assert.equal(first(snapshot([item])).progress, null);
});
test('fixed checklist cannot be a range; estimates require provenance', () => {
  const item = task(); item.progress.basis = 'fixed_checklist'; item.progress.value = { min: 20, max: 30 }; assert.equal(first(snapshot([item])).progress, null);
  item.progress.basis = 'estimate'; delete item.progress.source; assert.equal(first(snapshot([item])).progress, null);
});
test('portfolio 91 cannot become task 91', () => { const item = task('a', 91); item.progress.scope = { kind: 'portfolio', id: 'all' }; const result = first(snapshot([item])); assert.equal(result.progress, null); assert.equal(result.lastKnown, null); assert.match(result.issues.join(' '), /другой области/); });
test('changing selection filters metrics and removes unrelated aggregate', () => {
  const result = buildReport(grouped([task('a', 28), task('b', 91)]), { now: NOW, selection: { kind: 'task', id: 'a' } });
  assert.equal(result.tasks.length, 1); assert.equal(result.tasks[0].progress.min, 28); assert.equal(result.aggregate, null); assert.doesNotMatch(renderMarkdown(result), /91%/);
});
test('missing selected task remains visible', () => { const result = run(snapshot([], { kind: 'task', id: 'missing' })); assert.equal(result.tasks.length, 1); assert.equal(result.tasks[0].progress, null); });
test('stale/error/future/missing freshness preserve last value only', () => {
  for (const mutate of [item => { item.updatedAt = '2026-10-20T12:00:00Z'; }, item => { item.dataStatus = 'error'; }, item => { item.updatedAt = null; }, item => { item.updatedAt = '2026-10-22T12:00:00Z'; }]) { const item = task(); mutate(item); const result = first(snapshot([item])); assert.equal(result.progress, null); assert.equal(result.lastKnown.min, 28); }
});
test('freshness threshold is inclusive', () => { const item = task(); item.updatedAt = '2026-10-21T11:10:00Z'; assert.equal(first(snapshot([item])).freshness.state, 'fresh'); item.updatedAt = '2026-10-21T11:09:59Z'; assert.equal(first(snapshot([item])).freshness.state, 'stale'); });
test('impossible dates, duplicate ids and unexpected fields are rejected', () => {
  const input = snapshot(); input.tasks[0].updatedAt = '2026-02-30T12:00:00Z'; assert.throws(() => run(input)); assert.throws(() => run(snapshot([task(), task()]))); assert.throws(() => run({ ...snapshot(), token: 'forbidden-field' }));
});
test('only accepted stages contribute; unknown phases suppress task total', () => {
  const item = task(); item.progress = { basis: 'stages', scope: { kind: 'task', id: 'a' }, value: null, source: proof(), stages: [ { id: 's1', label: 'Принято', weight: 2, status: 'accepted', evidence: 'test:phase' }, { id: 's2', label: 'Работа', weight: 3, status: 'working' }, { id: 's3', label: 'Проверка', weight: 3, status: 'checking' }, { id: 's4', label: 'Осталось', weight: 2, status: 'pending' } ] };
  assert.equal(first(snapshot([item])).progress.min, 20);
  item.progress.stages[1].status = 'unknown'; assert.equal(first(snapshot([item])).progress, null); assert.equal(first(snapshot([item])).stageCoverage.knownWeight, 7);
  delete item.progress.stages[0].evidence; assert.equal(first(snapshot([item])).progress, null);
});
test('all accepted stages do not prove final acceptance', () => { const item = task(); item.progress = { basis: 'stages', scope: { kind: 'task', id: 'a' }, value: null, source: proof(), stages: [{ id: 's', label: 'Этап', status: 'accepted', weight: 1, evidence: 'test:phase' }] }; assert.equal(first(snapshot([item])).progress, null); });
test('weighted aggregate preserves both interval endpoints and denominator', () => { const result = run(grouped([task('a', 20), task('b', { min: 40, max: 60 })], [3, 1])); assert.ok(Math.abs(result.aggregate.progress.min - 25) < 1e-12); assert.ok(Math.abs(result.aggregate.progress.max - 30) < 1e-12); assert.equal(result.aggregate.coveragePercent, 100); assert.equal(result.aggregate.formula.denominator, 4); });
test('partial coverage exposes subset mean, never a global percent', () => { const result = run(grouped([task('a', 20), task('b', null)], [3, 1])); assert.equal(result.aggregate.progress, null); assert.equal(result.aggregate.knownSubset.min, 20); assert.equal(result.aggregate.coveragePercent, 75); assert.match(renderMarkdown(result), /по известной части/); });
test('missing population member remains unknown and affects denominator', () => { const input = grouped([task('a', 20), task('b', null)], [1, 9]); input.tasks.pop(); const result = run(input); assert.equal(result.tasks.length, 2); assert.equal(result.tasks[1].progress, null); assert.equal(result.aggregate.coveragePercent, 10); assert.equal(result.aggregate.progress, null); });
test('all unknown never causes division by zero or fake zero task progress', () => { const result = run(grouped([task('a', null), task('b', null)])); assert.equal(result.aggregate.progress, null); assert.equal(result.aggregate.knownSubset, null); assert.equal(result.aggregate.coveragePercent, 0); assert.doesNotMatch(renderMarkdown(result), /NaN|Infinity/); });
test('100 aggregate requires all accepted tasks', () => { const result = run(grouped([accepted('a'), accepted('b')])); assert.equal(result.aggregate.progress.min, 100); assert.equal(result.aggregate.acceptanceConfirmed, true); });
test('missing weights/full population does not synthesize an overall mean', () => { const result = run(snapshot([task(), task('b', 90)], { kind: 'project', id: 'p' })); assert.equal(result.aggregate.progress, null); assert.equal(result.aggregate.coveragePercent, null); });
test('wrong scope/membership/extra rows disable the aggregate', () => { const input = grouped([task(), task('b', 90)]); input.tasks[1].projectId = 'other'; assert.equal(run(input).aggregate.progress, null); input.tasks[1].projectId = 'p'; input.aggregation.scope.id = 'other'; assert.equal(run(input).aggregate.progress, null); input.aggregation.scope.id = 'p'; input.aggregation.members.pop(); assert.equal(run(input).aggregate.progress, null); });
test('weights must be finite positive and members unique', () => { for (const value of [0, -1, Infinity, 1e10, null]) assert.throws(() => run(grouped([task()], [value]))); const input = grouped([task()]); input.aggregation.members.push({ taskId: 'a', weight: 1 }); assert.throws(() => run(input)); });
test('one invalid row does not hide a valid row', () => { const result = run(grouped([task('a', -30), task('b', 50)])); assert.equal(result.tasks[0].progress, null); assert.equal(result.tasks[1].progress.min, 50); assert.equal(result.aggregate.coveragePercent, 50); });
test('near 100 and uncertain intervals cannot render a full bar', () => { const markdown = renderMarkdown(run(snapshot([task('a', { min: 59.99, max: 99.9999 })]))); assert.match(markdown, /59,99–99,99%/); assert.match(markdown, /▰{5}▱{5}/); assert.doesNotMatch(markdown, /100%|▰{10}/); });
test('untrusted Markdown/HTML/directives are escaped inside cells', () => { const escaped = escapeMarkdown('<img src=x> | **fake**\n::code-comment{title="x"} [go](https://evil.invalid)'); assert.ok(!escaped.includes('\n')); for (const token of ['\\<img', '\\|', '\\{', '\\[']) assert.ok(escaped.includes(token)); });
test('rendering does not mutate even deep-frozen input', () => { const input = grouped([task(), task('b', null)]); const before = JSON.stringify(input); const freeze = value => { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); } }; freeze(input); renderMarkdown(run(input)); assert.equal(JSON.stringify(input), before); });
test('empty project selection stays unknown', () => { const result = run(snapshot([], { kind: 'project', id: 'empty' })); assert.equal(result.tasks.length, 0); assert.equal(result.aggregate.progress, null); assert.match(renderMarkdown(result), /нет переданных задач/); });
test('explicit named multi-task set can use matching declared weights', () => { const input = grouped([task(), task('b', 50)]); input.selection = { kind: 'tasks', id: 'batch', taskIds: ['a', 'b'] }; input.aggregation.scope = { kind: 'tasks', id: 'batch' }; assert.equal(run(input).aggregate.progress.min, 39); });
test('rounding an aggregate cannot grant 100 when a tiny-weight task is not accepted', () => {
  const result = run(grouped([accepted('a'), task('b', 0)], [1e9, 1e-9]));
  assert.equal(result.aggregate.progress, null); assert.equal(result.aggregate.knownSubset, null); assert.equal(result.aggregate.acceptanceConfirmed, false); assert.match(result.aggregate.reason, /точность/);
});
test('subnormal weights do not underflow a single known average', () => {
  const result = run(grouped([task('a', 99.9)], [Number.MIN_VALUE])); assert.equal(result.aggregate.progress.min, 99.9); assert.equal(result.aggregate.acceptanceConfirmed, false);
});
test('fractional weights remain nonzero and auditable in the rendered formula', () => {
  const markdown = renderMarkdown(run(grouped([task('a', 20), task('b', 40)], [0.001, 0.002])));
  assert.match(markdown, /20%×0,001 \+ b:40%×0,002/); assert.match(markdown, /\/ 0,003/); assert.match(markdown, /вес 0,003\/0,003/);
});
test('tiny unknown stage remains unknown despite floating sum losing its weight', () => {
  const item = task(); item.progress = { basis: 'stages', scope: { kind: 'task', id: 'a' }, value: null, source: proof(), stages: [ { id: 'a', label: 'Принято', weight: 5e8, status: 'accepted', evidence: 'test:stage' }, { id: 'b', label: 'Работа', weight: 5e8, status: 'working' }, { id: 'c', label: 'Нет данных', weight: 1e-9, status: 'unknown' } ] };
  assert.equal(first(snapshot([item])).progress, null);
});
test('fixed checklist retains its exact supplied precision, small positive estimates do not say zero', () => {
  const item = task('a', 28.999); item.progress.basis = 'fixed_checklist'; assert.match(renderMarkdown(run(snapshot([item]))), /28,999% по принятому checklist/);
  const markdown = renderMarkdown(run(snapshot([task('a', 0.001)]))); assert.match(markdown, /менее 0,01%/); assert.doesNotMatch(markdown, /примерно 0%/);
});

test('accepted empty blockers display as known empty without hiding unknown', () => {
  const report = run(snapshot([accepted()]));
  const before = structuredClone(report);
  const single = renderMarkdown(report);
  assert.match(single, /Мешает \/ осталось: Открытых препятствий нет\./);
  assert.doesNotMatch(single, /сведения о препятствиях и остатке не переданы/);
  assert.deepEqual(report, before);
  assert.deepEqual(report.tasks[0].progress, { min: 100, max: 100 });
  const unknown = task('b', null); unknown.status = 'unknown';
  const multi = run(grouped([accepted(), unknown]));
  const multiBefore = structuredClone(multi);
  const lines = renderMarkdown(multi).split('\n');
  assert.match(lines.find(line => line.startsWith('| **Задача a**')), /Открытых препятствий нет/);
  assert.match(lines.find(line => line.startsWith('| **Задача b**')), /неизвестно.*Мешает\/осталось: не передано/);
  assert.equal(multi.tasks[1].progress, null);
  assert.deepEqual(multi, multiBefore);
});

function displayStages() {
  return { source: proof(), items: [
    { id: 's1', label: 'Требования', status: 'accepted', evidence: 'test:requirements-accepted' },
    { id: 's2', label: 'Проверка', status: 'checking' },
    { id: 's3', label: 'Выпуск', status: 'pending' },
    { id: 's4', label: 'Дополнения', status: 'unknown' }
  ] };
}
function stagedTask(id = 'a') {
  const item = task(id); item.progress = { basis: 'stages', scope: { kind: 'task', id }, value: null, source: proof(), stages: [
    { id: 's1', label: 'Требования', weight: 2, status: 'accepted', evidence: 'test:requirements-accepted' },
    { id: 's2', label: 'Разработка', weight: 3, status: 'working' },
    { id: 's3', label: 'Выпуск', weight: 5, status: 'pending' }
  ] }; return item;
}

test('accepted task cannot show 100 while weighted stages are unfinished', () => {
  const item = stagedTask(); item.status = 'accepted'; item.acceptance = accepted().acceptance;
  const contradicted = first(snapshot([item]));
  assert.equal(contradicted.progress, null);
  assert.equal(contradicted.lastKnown, null);
  assert.equal(contradicted.acceptanceConfirmed, false);
  assert.deepEqual(contradicted.stageCoverage, { acceptedWeight: 2, knownWeight: 10, totalWeight: 10 });
  assert.match(contradicted.issues.join(' '), /противоречит незавершённым этапам/);
  const markdown = renderMarkdown(run(snapshot([item])));
  assert.match(markdown, /Приёмка не подтверждена/);
  assert.doesNotMatch(markdown, /100% · принято|примерно 100%/);

  for (const phase of item.progress.stages) { phase.status = 'accepted'; phase.evidence ??= `test:${phase.id}`; }
  const acceptedStages = first(snapshot([item]));
  assert.deepEqual(acceptedStages.progress, { min: 100, max: 100 });
  assert.equal(acceptedStages.acceptanceConfirmed, true);
  assert.deepEqual(acceptedStages.stageCoverage, { acceptedWeight: 10, knownWeight: 10, totalWeight: 10 });
});

test('blocked and paused weighted stages are known but do not add accepted progress', () => {
  for (const status of ['blocked', 'paused']) {
    const item = stagedTask(); item.progress.stages[1].status = status;
    const result = first(snapshot([item]));
    assert.deepEqual(result.progress, { min: 20, max: 20 });
    assert.deepEqual(result.stageCoverage, { acceptedWeight: 2, knownWeight: 10, totalWeight: 10 });
    assert.equal(result.stages[1].status, status);
    assert.match(renderMarkdown(run(snapshot([item]))), status === 'blocked' ? /Блокировка/ : /Пауза/);

    item.status = 'accepted'; item.acceptance = accepted().acceptance;
    const contradicted = first(snapshot([item]));
    assert.equal(contradicted.progress, null);
    assert.equal(contradicted.acceptanceConfirmed, false);
    assert.match(contradicted.issues.join(' '), /противоречит незавершённым этапам/);
  }
});

test('unknown weighted stage still prevents a whole-task percentage beside blocked and paused stages', () => {
  const item = stagedTask();
  item.progress.stages[1].status = 'blocked';
  item.progress.stages[2].status = 'unknown';
  const result = first(snapshot([item]));
  assert.equal(result.progress, null);
  assert.deepEqual(result.stageCoverage, { acceptedWeight: 2, knownWeight: 5, totalWeight: 10 });
  assert.match(result.issues.join(' '), /Статус части этапов неизвестен/);
});

test('stale accepted snapshot keeps historical acceptance and stage statuses distinct from current work', () => {
  const item = stagedTask(); item.status = 'accepted';
  for (const phase of item.progress.stages) { phase.status = 'accepted'; phase.evidence ??= `test:${phase.id}`; }
  item.updatedAt = '2026-10-20T12:00:00Z';
  item.acceptance = { acceptedAt: '2026-10-20T11:50:00Z', evidence: 'test:historical-acceptance' };
  const report = run(snapshot([item]));
  assert.equal(report.tasks[0].progress, null);
  assert.deepEqual(report.tasks[0].lastKnown, { min: 100, max: 100 });
  const markdown = renderMarkdown(report);
  assert.match(markdown, /последняя подтверждённая приёмка: 100% по снимку/);
  assert.match(markdown, /Приёмка по снимку/);
  assert.match(markdown, /Этап принят по снимку/);
  assert.doesNotMatch(markdown, /примерно 100%|🟢 Принято|🟢 Этап принят/);
});

test('display stages preserve a fixed checklist and never create coverage or acceptance', () => {
  const item = task(); item.progress.basis = 'fixed_checklist'; item.stages = displayStages();
  const result = first(snapshot([item]));
  assert.deepEqual(result.progress, { min: 28, max: 28 });
  assert.equal(result.stageCoverage, null); assert.equal(result.acceptanceConfirmed, false);
  assert.deepEqual(result.stages, item.stages.items); assert.equal(result.stageSource, 'display');
  assert.deepEqual(result.stageSourceEvidence, item.stages.source);
  const markdown = renderMarkdown(run(snapshot([item])));
  assert.match(markdown, /28% по принятому checklist/); assert.match(markdown, /Перечень для отображения/);
  assert.doesNotMatch(markdown, /принят вес|1\/4|3\/4|100% · принято/);
  item.stages.items.forEach(phase => { phase.status = 'accepted'; phase.evidence = 'test:stage-only'; });
  assert.deepEqual(first(snapshot([item])).progress, { min: 28, max: 28 });
  item.progress = { basis: 'unknown', scope: { kind: 'task', id: 'a' }, value: null, source: null };
  assert.equal(first(snapshot([item])).progress, null); assert.equal(first(snapshot([item])).acceptanceConfirmed, false);
});

test('display stages accept blocked and paused without adding numeric progress', () => {
  const item = task('a', null); item.stages = displayStages();
  for (const status of ['blocked', 'paused']) {
    item.stages.items[1].status = status; const result = first(snapshot([item]));
    assert.equal(result.stages[1].status, status); assert.equal(result.progress, null); assert.equal(result.stageCoverage, null);
  }
});

test('display stages strictly reject missing accepted evidence and duplicate ids', () => {
  const item = task(); item.stages = displayStages(); delete item.stages.items[0].evidence;
  assert.throws(() => run(snapshot([item])), ContractError);
  item.stages = displayStages(); item.stages.items[1].id = item.stages.items[0].id;
  assert.throws(() => run(snapshot([item])), /повтор этапа/);
});

test('display stages enforce safe fields, source, bounds and known status names', () => {
  for (const mutate of [
    value => { value.items = []; },
    value => { value.items = Array.from({ length: 41 }, (_, index) => ({ id: `s${index}`, label: 'Этап', status: 'pending' })); },
    value => { value.items[0].label = 'x'.repeat(201); },
    value => { value.items[0].status = 'finished'; },
    value => { value.items[0].weight = 10; },
    value => { value.items[0].secret = 'forbidden'; },
    value => { value.items[0].id = 'invalid id'; },
    value => { delete value.source; }
  ]) {
    const item = task(); item.stages = displayStages(); mutate(item.stages);
    assert.throws(() => run(snapshot([item])), ContractError);
  }
});

test('display and weighted progress stage lists cannot be combined', () => {
  const item = stagedTask(); item.stages = displayStages();
  assert.throws(() => run(snapshot([item])), /нельзя совмещать/);
});

test('weighted stage report exports every stage and retains the original accepted-weight formula', () => {
  const item = stagedTask(); const result = first(snapshot([item]));
  assert.deepEqual(result.progress, { min: 20, max: 20 });
  assert.deepEqual(result.stageCoverage, { acceptedWeight: 2, knownWeight: 10, totalWeight: 10 });
  assert.equal(result.stageSource, 'progress'); assert.deepEqual(result.stageSourceEvidence, item.progress.source);
  assert.deepEqual(result.stages, item.progress.stages);
  const markdown = renderMarkdown(run(snapshot([item])));
  for (const stage of item.progress.stages) assert.ok(markdown.includes(stage.label));
  assert.match(markdown, /принят вес 2\/10/); assert.match(markdown, /вес 5/);
});

test('stage lists retain their last reported statuses when the snapshot is stale', () => {
  const displayed = task(); displayed.progress.basis = 'fixed_checklist'; displayed.stages = displayStages();
  for (const item of [displayed, stagedTask()]) {
    item.updatedAt = '2026-10-20T12:00:00Z'; const result = first(snapshot([item]));
    assert.equal(result.freshness.state, 'stale'); assert.equal(result.progress, null);
    assert.equal(result.lastKnown.min, item.progress.basis === 'stages' ? 20 : 28);
    assert.equal(result.stages[0].status, 'accepted'); assert.equal(result.stages[1].status, item.progress.basis === 'stages' ? 'working' : 'checking');
    const markdown = renderMarkdown(run(snapshot([item])));
    assert.match(markdown, /Свежесть этапов: устарело/); assert.match(markdown, /Последние переданные статусы; их актуальность не подтверждена/);
  }
});

test('unavailable snapshot freshness never promotes stage statuses into current progress', () => {
  for (const mutate of [item => { item.dataStatus = 'error'; }, item => { item.updatedAt = null; }, item => { item.updatedAt = '2026-10-22T12:00:00Z'; }]) {
    const item = stagedTask(); mutate(item); const result = first(snapshot([item]));
    assert.equal(result.progress, null); assert.deepEqual(result.stages, item.progress.stages);
    assert.match(renderMarkdown(run(snapshot([item]))), /их актуальность не подтверждена/);
  }
});

test('normalized display and progress stages deeply clone their input lists and provenance', () => {
  const display = task(); display.stages = displayStages();
  for (const item of [display, stagedTask()]) {
    const input = snapshot([item]); const before = structuredClone(input); const report = run(input);
    renderMarkdown(report); assert.deepEqual(input, before);
    const normalized = report.tasks[0]; const rawStages = item.stages?.items ?? item.progress.stages;
    const rawSource = item.stages?.source ?? item.progress.source;
    assert.notEqual(normalized.stages, rawStages); assert.notEqual(normalized.stages[0], rawStages[0]);
    assert.notEqual(normalized.stageSourceEvidence, rawSource);
    normalized.stages[0].label = 'Изменено только в отчёте'; normalized.stageSourceEvidence.evidence = 'Другой отчёт';
    assert.deepEqual(input, before);
  }
});

test('absent and missing task stages normalize to empty rather than invented phases', () => {
  for (const input of [snapshot(), snapshot([], { kind: 'task', id: 'missing' })]) {
    const result = first(input); assert.deepEqual(result.stages, []);
    assert.equal(result.stageSource, null); assert.equal(result.stageSourceEvidence, null);
    assert.match(renderMarkdown(run(input)), /Этапы не переданы/);
  }
});

test('Markdown stage labels, evidence and source are escaped', () => {
  const item = task(); item.stages = displayStages();
  item.stages.items[0].label = '**Фальшивый** | <img>';
  item.stages.items[0].evidence = '[open](https://evil.invalid)\n::code-comment{title="x"}';
  item.stages.source = { ref: 'test:**source**', evidence: '<script>danger</script>' };
  const markdown = renderMarkdown(run(snapshot([item])));
  for (const value of [item.stages.items[0].label, item.stages.items[0].evidence, item.stages.source.ref, item.stages.source.evidence]) {
    assert.ok(markdown.includes(escapeMarkdown(value))); assert.ok(!markdown.includes(value));
  }
});
