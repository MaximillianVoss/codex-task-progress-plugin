import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { buildReport } from '../skills/task-progress/scripts/core.mjs';
import { renderHtml, escapeHtml } from '../skills/task-progress/scripts/render-html.mjs';

const NOW = '2026-10-21T12:10:00Z';
const proof = () => ({ ref: 'test:evidence', evidence: 'Подтверждено примером' });
function task(id = 'a', value = 28) {
  return { id, title: `Задача ${id}`, projectId: 'p', portfolioId: 'all', status: 'working', stage: 'Подготовка', updatedAt: '2026-10-21T12:00:00Z', dataStatus: 'ok', accepted: [], blockers: [], acceptance: null, progress: { basis: value === null ? 'unknown' : 'estimate', scope: { kind: 'task', id }, value, source: value === null ? null : proof() } };
}
function snapshot(tasks = [task()], selection = { kind: 'task', id: 'a' }) { return { schemaVersion: 1, selection, staleAfterMinutes: 60, tasks, aggregation: null }; }
const reportOf = input => buildReport(input, { now: NOW });
const htmlOf = input => renderHtml(reportOf(input));
const demo = () => JSON.parse(readFileSync(new URL('../examples/multiple.safe.json', import.meta.url), 'utf8'));

test('dashboard presents fixed 28, a continuous 50–70 interval and unknown without a zero bar', () => {
  const html = htmlOf(demo());
  assert.match(html, /Прогресс · проект demo-project/);
  assert.match(html, /Пульт задач/);
  assert.match(html, /Демонстрация · синтетические данные/);
  assert.match(html, /По принятому checklist/);
  assert.match(html, /class="tp-fill" style="width:28%"/);
  assert.match(html, /class="tp-percent">28%<\/span>/);
  assert.match(html, /class="tp-fill" style="width:50%"/);
  assert.match(html, /class="tp-interval" style="left:50%;width:20%"/);
  assert.match(html, /class="tp-percent">≈ 50–70%<\/span>/);
  assert.match(html, /class="tp-blockers tp-attention">Проверка отображения/);
  assert.equal((html.match(/role="progressbar"/g) ?? []).length, 2);
  const unknown = html.slice(html.indexOf('<h3>Нет свежего отчёта'));
  assert.match(unknown, /tp-unknown">Неизвестно/);
  assert.doesNotMatch(unknown, /role="progressbar"|class="tp-percent">0%/);
  assert.match(unknown, /свежесть неизвестна/);
  assert.match(unknown, /Дата не передана/);
  const visible = html.replace(/<style>[\s\S]*?<\/style>/g, '').replace(/<details\b[^>]*>[\s\S]*?<\/details>/g, '');
  assert.doesNotMatch(visible, /Следующий контрольный пункт|2026-10-21T12:00:00Z|Сведения о препятствиях и остатке не переданы/);
  assert.match(html, /<details class="tp-details"><summary>Подробности<\/summary><dl><dt>ID задачи<\/dt><dd>demo-g2/);
  assert.match(html, /grid-template-columns:minmax\(0,1fr\) 90px/);
});

test('progressbars expose exact minimum and complete interval to assistive technology', () => {
  const html = htmlOf(demo());
  assert.match(html, /aria-valuemin="0" aria-valuemax="100" aria-valuenow="28" aria-valuetext="28% по принятому checklist"/);
  assert.match(html, /aria-valuenow="50" aria-valuetext="50–70%, приблизительная оценка"/);
});

test('stale current progress is unknown; the last estimate is separate and has no progressbar', () => {
  const input = snapshot(); input.tasks[0].updatedAt = '2026-10-20T12:00:00Z';
  const html = htmlOf(input);
  assert.match(html, /tp-unknown">Неизвестно/);
  assert.match(html, /Последняя оценка: ≈ 28%/);
  assert.match(html, /Текущий прогресс неизвестен/);
  assert.match(html, /устарело/);
  assert.match(html, /2026-10-20T12:00:00Z/);
  assert.doesNotMatch(html, /role="progressbar"|class="tp-fill" style=/);
});

test('accepted tasks show known empty blockers and dated acceptance; unknown blockers stay unknown', () => {
  const accepted = task('a', 100); accepted.status = 'accepted';
  accepted.acceptance = { acceptedAt: '2026-10-21T11:50:00Z', evidence: 'test:final-acceptance' };
  const html = htmlOf(snapshot([accepted]));
  assert.match(html, /100% · принято/);
  assert.match(html, /Открытых препятствий нет/);
  assert.match(html, /test:final-acceptance/);
  assert.match(html, /2026-10-21T11:50:00Z/);
  const unknown = htmlOf(snapshot([task('a', null)]));
  assert.match(unknown, /Сведения о препятствиях и остатке не переданы/);
  assert.doesNotMatch(unknown, /Открытых препятствий нет/);
});

test('unaccepted full progress cannot render as 100 even in a hand-built report', () => {
  const report = reportOf(snapshot()); report.tasks[0].progress = { min: 100, max: 100 };
  const html = renderHtml(report);
  assert.doesNotMatch(html, /class="tp-percent">100%|aria-valuenow="100"|class="tp-fill" style="width:100%"/);
  assert.match(html, /tp-unknown">Неизвестно/);
});

test('hostile snapshot text is escaped, bidi/control characters removed, and only the static UI script is active', () => {
  const input = snapshot(); const item = input.tasks[0];
  item.title = '<img src="https://evil.invalid/a" onerror="alert(1)">\u202e\u0000';
  item.stage = '<svg onload=alert(2)>\u2066';
  item.progress.source = { ref: 'javascript:alert(3)', evidence: '</style><script>alert(4)</script>\u200f' };
  item.accepted = [{ label: '<iframe src=x>', evidence: '<a href="https://evil.invalid">click</a>' }];
  item.blockers = ['<button onclick="x">Stop</button>'];
  const html = htmlOf(input);
  assert.match(html, /&lt;img src=&quot;https:\/\/evil.invalid\/a&quot; onerror=&quot;alert\(1\)&quot;&gt;/);
  assert.match(html, /&lt;\/style&gt;&lt;script&gt;alert\(4\)&lt;\/script&gt;/);
  assert.match(html, /&lt;a href=&quot;https:\/\/evil.invalid&quot;&gt;click&lt;\/a&gt;/);
  const inert = html.replace(/<script>[\s\S]*?<\/script>/g, '');
  assert.equal((html.match(/<script>/g) ?? []).length, 1);
  assert.equal((inert.match(/<button type="button" class="tp-(?:choice|theme-choice)"/g) ?? []).length, 6);
  assert.doesNotMatch(inert.replace(/<button type="button" class="tp-(?:choice|theme-choice)"[\s\S]*?<\/button>/g, ''), /<(?:script|img|iframe|a|button)\b|<svg\s+onload/i);
  assert.doesNotMatch(html, /<(?:html|head|body)\b|<!doctype|\s(?:href|src|onerror|onload|onclick)=["']/i);
  assert.doesNotMatch(html, /[\u202a-\u202e\u2066-\u2069\u200e\u200f\u0000]/);
  assert.doesNotMatch(html, /@import|url\s*\(/i);
  assert.equal(escapeHtml('"\'&<>\n\u202e'), '&quot;&#39;&amp;&lt;&gt;');
});

test('incomplete aggregate keeps global unknown, weighted coverage, known subset, formula and source', () => {
  const html = htmlOf(demo());
  assert.match(html, /Общий процент неизвестен/);
  assert.match(html, /Текущий итог всей области неизвестен: охват неполный/);
  assert.match(html, /Данные есть по 2 из 3 задач · вес 5\/10 \(50%\)/);
  assert.match(html, /По известной части: ≈ 36,8–44,8%/);
  assert.match(html, /Формула известной части: \(demo-g2: 28% × 3 \+ demo-package: 50–70% × 2\) \/ 5; полный вес области 10/);
  assert.match(html, /demo:membership-v1 — Полный учебный состав; явные веса 3:2:5/);
  assert.match(html, /<details class="tp-details"><summary>Основание итога/);
  const visible = html.replace(/<style>[\s\S]*?<\/style>/g, '').replace(/<details\b[^>]*>[\s\S]*?<\/details>/g, '');
  assert.match(visible, /Общий процент неизвестен/);
  assert.match(visible, /Данные есть по 2 из 3 задач · вес 5\/10 \(50%\)/);
  assert.doesNotMatch(visible, /По известной части|Формула известной части|Текущий итог всей области неизвестен: охват неполный/);
});

test('positive tiny estimates never read zero; near 100 never rounds to full completion', () => {
  const tiny = htmlOf(snapshot([task('a', 0.001)]));
  assert.match(tiny, /class="tp-percent">≈ менее 0,01%/);
  assert.match(tiny, /aria-valuenow="0.001" aria-valuetext="0,001%, приблизительная оценка"/);
  assert.match(tiny, /class="tp-fill" style="width:0.001%"/);
  assert.doesNotMatch(tiny, /class="tp-percent">≈ 0%/);
  const near = htmlOf(snapshot([task('a', 99.99999999999999)]));
  assert.match(near, /class="tp-percent">≈ 99,99%/);
  assert.doesNotMatch(near, /class="tp-percent">[^<]*100%|style="width:100%"/);
  const fixed = task('a', 28.999); fixed.progress.basis = 'fixed_checklist';
  assert.match(htmlOf(snapshot([fixed])), /class="tp-percent">28,999%/);
});

test('stage coverage, missing acceptance confirmation and warnings remain present without changing the report', () => {
  const input = snapshot(); input.tasks[0].progress = { basis: 'stages', scope: { kind: 'task', id: 'a' }, value: null, source: proof(), stages: [{ id: 's1', label: 'Принято', weight: 2, status: 'accepted', evidence: 'test:stage' }, { id: 's2', label: 'Неизвестно', weight: 3, status: 'unknown' }] };
  const report = reportOf(input); report.warnings.push('<source warning>');
  const before = structuredClone(report); const html = renderHtml(report);
  assert.match(html, /Принят вес 2\/5; известен статус веса 2\/5/);
  assert.match(html, /Статус части этапов неизвестен/);
  assert.match(html, /&lt;source warning&gt;/);
  assert.deepEqual(report, before);
  const accepted = task('a', 100); accepted.status = 'accepted'; accepted.updatedAt = '2026-10-20T12:00:00Z'; accepted.acceptance = { acceptedAt: '2026-10-20T11:50:00Z', evidence: 'test:old-acceptance' };
  const staleAcceptance = htmlOf(snapshot([accepted]));
  assert.match(staleAcceptance, /текущая приёмка не подтверждена/);
  assert.match(staleAcceptance, /tp-status-unknown">Приёмка по снимку/);
  assert.doesNotMatch(staleAcceptance, /tp-status-accepted">Принято/);
});

test('fragment is scoped, has a narrow-screen layout and no demo label for real data', () => {
  const html = htmlOf(snapshot());
  assert.match(html, /^<section id="task-progress-dashboard"/);
  assert.match(html, /@media\(max-width:600px\)/);
  assert.match(html, /grid-template-columns:minmax\(0,1fr\)/);
  assert.match(html, /overflow-wrap:anywhere/);
  assert.doesNotMatch(html, /Демонстрация ·|<!doctype|<(?:html|head|body)\b/i);
  const empty = htmlOf(snapshot([], { kind: 'project', id: 'empty' }));
  assert.match(empty, /Нет переданных задач. Прогресс неизвестен/);
  assert.match(empty, /Охват неизвестен/);
});

test('ring uses quantitative SVG circles for exact 28 and a separate 50–70 arc without duplicate progress semantics', () => {
  const html = renderHtml(reportOf(demo()), { view: 'ring', theme: 'light', stages: true });
  assert.match(html, /data-view="ring" data-theme="light" data-show-stages="true"/);
  assert.match(html, /<div class="tp-ring" aria-hidden="true"><svg viewBox="0 0 100 100" focusable="false" data-progress-graphic="ring">/);
  assert.match(html, /class="tp-ring-fill"[^>]*pathLength="100" stroke-dasharray="28 100"/);
  assert.match(html, /class="tp-ring-fill"[^>]*pathLength="100" stroke-dasharray="50 100"/);
  assert.match(html, /class="tp-ring-interval"[^>]*stroke-dasharray="20 100" stroke-dashoffset="-50"/);
  assert.equal((html.match(/role="progressbar"/g) ?? []).length, 2);
  assert.equal((html.match(/data-progress-graphic="ring"/g) ?? []).length, 2);
  const stale = snapshot(); stale.tasks[0].updatedAt = '2026-10-20T12:00:00Z';
  const staleHtml = renderHtml(reportOf(stale), { view: 'ring' });
  assert.match(staleHtml, /Неизвестно/);
  assert.match(staleHtml, /Последняя оценка: ≈ 28%/);
  assert.doesNotMatch(staleHtml, /role="progressbar"|data-progress-graphic="ring"|<circle class="tp-ring-track"/);
});

test('view, four complete themes and the stages toggle are explicit validated UI preferences', () => {
  const report = reportOf(snapshot());
  const initial = renderHtml(report);
  assert.match(initial, /data-view="bar" data-theme="night" data-show-stages="true"/);
  const controls = [...initial.matchAll(/<button type="button" class="tp-(?:theme-)?choice"[^>]*>[\s\S]*?<\/button>/g)].map(match => match[0]);
  assert.equal(controls.length, 6);
  const iconMarkup = new Set();
  for (const [preference, value, label] of [
    ['view', 'bar', 'Полоса'], ['view', 'ring', 'Круг'],
    ['theme', 'night', 'Ночная'], ['theme', 'light', 'Светлая'],
    ['theme', 'indigo', 'Индиго'], ['theme', 'forest', 'Лесная']
  ]) {
    const button = controls.find(control => control.includes(`data-pref="${preference}" data-value="${value}"`));
    assert.ok(button, `${preference}:${value}`);
    assert.match(button, new RegExp(`data-icon="${value}" aria-hidden="true"><svg class="tp-control-icon"`));
    assert.match(button, /<svg[^>]*focusable="false">[\s\S]*?<\/svg>/);
    assert.ok(button.includes(`<span>${label}</span>`));
    iconMarkup.add(button.match(/<svg[^>]*>[\s\S]*?<\/svg>/)[0]);
  }
  assert.equal(iconMarkup.size, 6);
  assert.match(controls[0], /aria-pressed="true"/);
  assert.match(controls[1], /aria-pressed="false"/);
  assert.equal((initial.match(/class="tp-theme-choice"/g) ?? []).length, 4);
  assert.match(initial, /data-pref="theme" data-value="night" aria-pressed="true"/);
  assert.match(initial, /type="checkbox" data-pref="stages" checked/);
  for (const theme of ['night', 'light', 'indigo', 'forest']) {
    const html = renderHtml(report, { theme, stages: false });
    assert.ok(html.includes(`data-theme="${theme}" data-show-stages="false"`));
    assert.ok(html.includes(`data-pref="theme" data-value="${theme}" aria-pressed="true"`));
    assert.doesNotMatch(html, /data-pref="stages" checked/);
  }
  for (const options of [{ view: 'pie' }, { view: null }, { theme: 'system' }, { theme: '"><script>' }, { stages: 'false' }, { arbitrary: true }, null, []]) assert.throws(() => renderHtml(report, options), TypeError);
  assert.doesNotMatch(initial, /@import|url\s*\(|<link\b|\s(?:src|href)=["']/i);
  const script = initial.match(/<script>([\s\S]*?)<\/script>/)[1];
  assert.doesNotMatch(script, /fetch\s*\(|XMLHttpRequest|WebSocket|localStorage|sessionStorage|sendBeacon|document\.cookie|innerHTML|Planner|https?:/i);
});

test('stage panels preserve ordered source stages, evidence, all statuses and fixed checklist independence', () => {
  const input = snapshot(); input.tasks[0].progress.basis = 'fixed_checklist';
  const statuses = ['pending', 'working', 'checking', 'accepted', 'unknown', 'blocked', 'paused'];
  input.tasks[0].stages = { source: { ref: 'test:display-stages', evidence: 'Источник списка' }, items: statuses.map((status, index) => ({ id: `s${index}`, label: `Этап ${index}`, status, ...(status === 'accepted' ? { evidence: 'test:stage-accepted' } : {}) })) };
  const report = reportOf(input); const before = structuredClone(report);
  const html = renderHtml(report);
  assert.match(html, /class="tp-fill" style="width:28%"/);
  assert.match(html, /class="tp-stages-heading"/);
  assert.match(html, /class="tp-stages-summary">1 из 7 принято/);
  assert.match(html, /Перечень для ориентира · не меняет процент/);
  assert.match(html, /<ol class="tp-stage-list">/);
  assert.match(html, /class="tp-stage-top"/);
  assert.match(html, /grid-template-columns:29px minmax\(0,1fr\)/);
  for (const status of statuses) assert.ok(html.includes(`class="tp-stage-item" data-status="${status}"`));
  for (const label of ['Ожидает', 'В работе', 'Проверка', 'Принят', 'Неизвестно', 'Заблокирован', 'Пауза']) assert.ok(html.includes(`class="tp-stage-status">${label}</p>`));
  assert.ok(html.indexOf('class="tp-stage-label">Этап 0') < html.indexOf('class="tp-stage-label">Этап 6'));
  assert.match(html, /Evidence: test:stage-accepted/);
  assert.match(html, /test:display-stages — Источник списка/);
  assert.doesNotMatch(html, /Этапы по последнему снимку|[1-7]\s*\/\s*7|class="tp-percent">100%/);
  assert.deepEqual(report, before);
});

test('stale stage acceptance is labeled historical and absent stages are never invented from the current-stage text', () => {
  const input = snapshot(); input.tasks[0].updatedAt = '2026-10-20T12:00:00Z';
  input.tasks[0].stages = { source: proof(), items: [{ id: 'old', label: 'Согласование', status: 'accepted', evidence: 'test:old-stage' }] };
  const html = htmlOf(input);
  assert.match(html, /tp-stages-stale/);
  assert.match(html, /Этапы по последнему снимку/);
  assert.match(html, /class="tp-stage-status">Принят по снимку/);
  assert.match(html, /\.tp-stages-stale \.tp-stage-item\[data-status="accepted"\]\{border-left-color:var\(--tp-line\)\}/);
  assert.match(html, /\.tp-stages-stale \.tp-stage-item\[data-status="accepted"\] \.tp-stage-index\{border-color:var\(--tp-line\);color:var\(--tp-muted\)\}/);
  assert.doesNotMatch(html, /class="tp-stage-status">Принят<\/p>/);
  assert.match(htmlOf(snapshot()), /Этапы не переданы/);
  assert.doesNotMatch(htmlOf(snapshot()), /class="tp-stage-label">Подготовка/);
  const missingStages = snapshot([task('a', null)]); missingStages.tasks[0].dataStatus = 'unknown'; missingStages.tasks[0].updatedAt = null;
  const unknownHtml = htmlOf(missingStages);
  assert.match(unknownHtml, /Этапы не переданы/);
  assert.doesNotMatch(unknownHtml, /Этапы по последнему снимку/);
});

test('blocked task with explicit unknown progress and no stages explains missing source data', () => {
  // Same contract fields and selection as the real OpenServer screenshot; no project progress is inferred.
  const input = {
    schemaVersion: 1, selection: { kind: 'task', id: '01a0e255-483d-7602-9fb7-856b4d82843a' }, staleAfterMinutes: 60,
    tasks: [{
      id: '01a0e255-483d-7602-9fb7-856b4d82843a', title: 'Автозапуск курсового проекта на Windows',
      projectId: null, portfolioId: null, status: 'blocked', stage: 'ВМ готова; интерактивный рабочий стол закрыт',
      updatedAt: '2026-10-24T23:14:47Z', dataStatus: 'ok', accepted: [],
      blockers: ['Нужен ручной вход в Windows для продолжения графической установки'], acceptance: null,
      progress: { basis: 'unknown', scope: { kind: 'task', id: '01a0e255-483d-7602-9fb7-856b4d82843a' }, value: null,
        source: { ref: 'safe:openserver-deployment-zip-20261024', evidence: 'ВМ готова; установка OpenServer не проверена' } }
    }], aggregation: null
  };
  const report = buildReport(input, { now: '2026-10-24T23:20:00Z' });
  assert.equal(report.tasks[0].progress, null);
  assert.deepEqual(report.tasks[0].stages, []);
  const html = renderHtml(report);
  assert.match(html, /Источник не передал оценку прогресса; процент не вычислялся/);
  assert.match(html, /Этапы не переданы источником/);
  assert.match(html, /safe:openserver-deployment-zip-20261024/);
  assert.doesNotMatch(html, /role="progressbar"|class="tp-percent">0%|class="tp-stage-item"/);
});

test('accepted stages cannot mask unfinished work, while old acceptance is explicitly historical', () => {
  const input = snapshot(); const item = input.tasks[0];
  item.status = 'accepted'; item.acceptance = { acceptedAt: '2026-10-21T11:50:00Z', evidence: 'test:final' };
  item.progress = { basis: 'stages', scope: { kind: 'task', id: 'a' }, value: null, source: proof(), stages: [
    { id: 'done', label: 'Подготовка', weight: 2, status: 'accepted', evidence: 'test:done' },
    { id: 'open', label: 'Выпуск', weight: 3, status: 'working' }
  ] };
  const contradiction = htmlOf(input);
  assert.match(contradiction, /Приёмка не подтверждена/);
  assert.match(contradiction, /Приёмка всей задачи противоречит незавершённым этапам/);
  assert.doesNotMatch(contradiction, /role="progressbar"|class="tp-percent">100%/);

  item.progress.stages[1].status = 'accepted'; item.progress.stages[1].evidence = 'test:open-accepted';
  item.updatedAt = '2026-10-20T12:00:00Z'; item.acceptance.acceptedAt = '2026-10-20T11:50:00Z';
  const historical = htmlOf(input);
  assert.match(historical, /Последняя подтверждённая приёмка: 100% по снимку/);
  assert.match(historical, /Приёмка по снимку/);
  assert.match(historical, /Принят по снимку/);
  assert.doesNotMatch(historical, /≈ 100%|role="progressbar"|class="tp-percent">100%/);
});

test('hostile stage labels, source evidence and identifiers remain text and cannot become markup or script', () => {
  const input = snapshot(); input.tasks[0].stages = { source: { ref: 'test:stages', evidence: '</script><script>intruder()</script>' }, items: [{ id: 'safe-id', label: '<img src=x onerror="bad()">\u202e', status: 'accepted', evidence: '<a href="https://evil.invalid">proof</a>\u2066' }] };
  const html = htmlOf(input);
  assert.match(html, /&lt;img src=x onerror=&quot;bad\(\)&quot;&gt;/);
  assert.match(html, /&lt;a href=&quot;https:\/\/evil.invalid&quot;&gt;proof&lt;\/a&gt;/);
  assert.match(html, /&lt;\/script&gt;&lt;script&gt;intruder\(\)&lt;\/script&gt;/);
  assert.equal((html.match(/<script>/g) ?? []).length, 1);
  assert.doesNotMatch(html, /<img\b|<a\s+href|[\u202e\u2066]/);
  const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];
  assert.doesNotMatch(script, /intruder|bad\(\)|evil\.invalid|safe-id/);
});

test('static controls change only UI preferences; host restores do not save and bridge errors are contained', () => {
  const script = htmlOf(snapshot()).match(/<script>([\s\S]*?)<\/script>/)[1];
  const choice = (preference, value) => {
    const attributes = { 'data-pref': preference, 'aria-pressed': 'false' };
    return { dataset: { value }, attributes, setAttribute: (key, next) => { attributes[key] = next; }, getAttribute: key => attributes[key] ?? null, parentElement: null };
  };
  const viewChoices = ['bar', 'ring'].map(value => choice('view', value));
  const themeChoices = ['night', 'light', 'indigo', 'forest'].map(value => choice('theme', value));
  const stages = { checked: true };
  const dataset = { view: 'bar', theme: 'night', showStages: 'true' };
  const listeners = new Map(); const hostListeners = new Map(); const saves = [];
  const root = { dataset, querySelectorAll: selector => selector === '[data-pref="view"]' ? viewChoices : themeChoices,
    querySelector: selector => selector === '[data-pref="stages"]' ? stages : null,
    addEventListener: (type, handler) => listeners.set(type, handler) };
  for (const button of [...viewChoices, ...themeChoices]) button.parentElement = root;
  const host = { widgetState: { privateContent: { taskProgressUI: { view: 'ring', theme: 'light', showStages: false } } }, setWidgetState: preferences => { saves.push(preferences); return Promise.reject(new Error('Host unavailable')); } };
  const context = { document: { getElementById: id => id === 'task-progress-dashboard' ? root : null }, window: { openai: host, addEventListener: (type, handler) => hostListeners.set(type, handler) } };
  runInNewContext(script, context);
  assert.deepEqual(dataset, { view: 'ring', theme: 'light', showStages: 'false' });
  assert.equal(viewChoices[1].attributes['aria-pressed'], 'true');
  assert.equal(themeChoices[1].attributes['aria-pressed'], 'true');
  assert.equal(stages.checked, false); assert.equal(saves.length, 0);
  const nestedIcon = button => ({ parentElement: { parentElement: { parentElement: button, getAttribute: () => null }, getAttribute: () => null }, getAttribute: () => null });
  listeners.get('click')({ target: nestedIcon(themeChoices[3]) });
  assert.equal(dataset.theme, 'forest'); assert.equal(saves.length, 1);
  assert.equal(themeChoices[3].attributes['aria-pressed'], 'true');
  assert.equal(themeChoices[1].attributes['aria-pressed'], 'false');
  assert.equal(JSON.stringify(saves[0]), JSON.stringify({ modelContent: { appearance: { view: 'ring', theme: 'forest', showStages: false } }, privateContent: { taskProgressUI: { view: 'ring', theme: 'forest', showStages: false } } }));
  hostListeners.get('openai:set_globals')({ detail: { globals: { widgetState: { privateContent: { taskProgressUI: { view: 'bar', theme: 'indigo', showStages: true } } } } } });
  assert.deepEqual(dataset, { view: 'bar', theme: 'indigo', showStages: 'true' });
  assert.equal(viewChoices[0].attributes['aria-pressed'], 'true');
  assert.equal(saves.length, 1);
  hostListeners.get('openai:set_globals')({ detail: { globals: { widgetState: { privateContent: { taskProgressUI: { view: '<script>', theme: 'unknown', showStages: 'yes' } } } } } });
  assert.deepEqual(dataset, { view: 'bar', theme: 'indigo', showStages: 'true' });
  listeners.get('click')({ target: {} });
  listeners.get('change')({ target: {} }); assert.equal(saves.length, 1);
  host.setWidgetState = () => { throw new Error('Disabled'); };
  assert.doesNotThrow(() => listeners.get('click')({ target: nestedIcon(viewChoices[1]) }));
  assert.equal(dataset.view, 'ring');
  stages.checked = false; assert.doesNotThrow(() => listeners.get('change')({ target: stages }));
  assert.equal(dataset.showStages, 'false');
  assert.doesNotThrow(() => runInNewContext(script, { ...context, window: { addEventListener() {} } }));
  assert.doesNotMatch(script, /currentScript|\.closest\s*\(/);
  assert.doesNotThrow(() => runInNewContext(script, { document: { getElementById: () => null } }));
});
