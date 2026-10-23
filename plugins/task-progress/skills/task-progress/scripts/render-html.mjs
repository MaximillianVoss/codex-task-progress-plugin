const ROOT = 'task-progress-dashboard';
const SCOPE_LABELS = { task: 'задача', tasks: 'набор задач', project: 'проект', portfolio: 'портфель' };
const STATUS_LABELS = { working: 'Работа', checking: 'Проверка', blocked: 'Блокировка', paused: 'Пауза', unknown: 'Данных нет', accepted: 'Принято' };
const BASIS_LABELS = { fixed_checklist: 'По принятому checklist', estimate: 'Оценка', stages: 'По принятым этапам', unknown: 'Основание неизвестно' };
const STAGE_LABELS = { pending: 'Ожидает', working: 'В работе', checking: 'Проверка', accepted: 'Принят', unknown: 'Неизвестно', blocked: 'Заблокирован', paused: 'Пауза' };
const VIEWS = new Set(['bar', 'ring']);
const THEMES = new Set(['night', 'light', 'indigo', 'forest']);

// Snapshot strings are text only. Removing direction/control characters also
// prevents a source from visually disguising dates, identifiers or warnings.
export function escapeHtml(value) {
  return String(value).replace(/[\p{Cc}\p{Cf}]/gu, ' ').replace(/\s+/gu, ' ').trim()
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
const text = escapeHtml;
const exact = value => String(value).replace('.', ',');
function approximate(value) {
  if (value > 0 && value < 0.01) return 'менее 0,01';
  const floored = Math.floor((value + Number.EPSILON * Math.max(1, value) * 4) * 100) / 100;
  return Math.min(value < 100 ? 99.99 : value, floored).toLocaleString('ru-RU', { maximumFractionDigits: 2 });
}
function rangeText(value, precise = false) {
  const format = precise ? exact : approximate;
  return value.min === value.max ? `${format(value.min)}%` : `${format(value.min)}–${format(value.max)}%`;
}
function estimateText(task, value, precise = false) {
  return `${task.basis === 'fixed_checklist' ? '' : '≈ '}${rangeText(value, precise || task.basis === 'fixed_checklist')}`;
}
function sourceText(source) {
  return source ? `${text(source.ref)} — ${text(source.evidence)}` : 'Источник не передан';
}
function currentValue(task) {
  // buildReport supplies these ranges. Keep the acceptance boundary explicit
  // here too, so a hand-built report cannot display an unaccepted full bar.
  const value = task.progress;
  if (!value || !Number.isFinite(value.min) || !Number.isFinite(value.max) || value.min < 0 || value.max > 100 || value.min > value.max) return null;
  return value.max === 100 && !task.acceptanceConfirmed ? null : value;
}
function renderProgress(task) {
  const value = currentValue(task);
  if (!value) {
    const last = task.lastKnown ? `<p class="tp-last">Последняя оценка: ${text(estimateText(task, task.lastKnown))}${task.basis === 'fixed_checklist' ? ' по checklist' : ''}. Текущий прогресс неизвестен.</p>` : '';
    return `<div class="tp-progress"><p class="tp-unknown">Неизвестно <span class="tp-question" aria-hidden="true">?</span></p>${last}</div>`;
  }
  const label = task.acceptanceConfirmed ? '100% · принято' : estimateText(task, value);
  const accessible = task.acceptanceConfirmed ? '100% · фактическая приёмка подтверждена' : `${rangeText(value, true)}${task.basis === 'fixed_checklist' ? ' по принятому checklist' : ', приблизительная оценка'}`;
  const interval = value.max > value.min ? `<span class="tp-interval" style="left:${value.min}%;width:${value.max - value.min}%" aria-hidden="true"></span>` : '';
  const ringInterval = value.max > value.min ? `<circle class="tp-ring-interval" cx="50" cy="50" r="42" pathLength="100" stroke-dasharray="${value.max - value.min} 100" stroke-dashoffset="${-value.min}"/>` : '';
  const ring = `<div class="tp-ring" aria-hidden="true"><svg viewBox="0 0 100 100" focusable="false" data-progress-graphic="ring"><g transform="rotate(-90 50 50)"><circle class="tp-ring-track" cx="50" cy="50" r="42"/><circle class="tp-ring-fill" cx="50" cy="50" r="42" pathLength="100" stroke-dasharray="${value.min} 100"/>${ringInterval}</g></svg><span class="tp-ring-value">${text(label)}</span></div>`;
  return `<div class="tp-progress tp-progress-known" role="progressbar" aria-label="${text(`Прогресс задачи ${task.title}`)}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${value.min}" aria-valuetext="${text(accessible)}"><div class="tp-meter-line" aria-hidden="true"><div class="tp-track"><span class="tp-fill" style="width:${value.min}%" aria-hidden="true"></span>${interval}</div><span class="tp-percent">${text(label)}</span></div>${ring}</div>`;
}
function renderStages(task) {
  const stages = Array.isArray(task.stages) ? task.stages : [];
  const fresh = task.freshness.state === 'fresh';
  const origin = task.stageSource === 'progress' ? 'Этапы оценки' : 'Этапы';
  const freshness = !fresh && stages.length > 0 ? '<p class="tp-stage-freshness tp-attention">Этапы по последнему снимку</p>' : '';
  const source = task.stageSourceEvidence ? `<details class="tp-details tp-stage-source"><summary>Источник этапов</summary><p>${sourceText(task.stageSourceEvidence)}</p></details>` : '';
  const items = stages.length ? `<ol class="tp-stage-list">${stages.map((stage, index) => {
    const status = Object.hasOwn(STAGE_LABELS, stage.status) ? stage.status : 'unknown';
    const label = !fresh && status === 'accepted' ? 'Принят по снимку' : STAGE_LABELS[status];
    const proof = `<details class="tp-details tp-stage-proof"><summary>Основание</summary><p>ID: ${text(stage.id)}.</p>${stage.evidence ? `<p>Evidence: ${text(stage.evidence)}</p>` : '<p>Evidence не передан.</p>'}${stage.weight !== undefined ? `<p>Вес источника: ${text(exact(stage.weight))}.</p>` : ''}</details>`;
    return `<li class="tp-stage-item" data-status="${status}"><span class="tp-stage-index" aria-hidden="true">${index + 1}</span><div><p class="tp-stage-label">${text(stage.label)}</p><p class="tp-stage-status">${text(label)}</p>${proof}</div></li>`;
  }).join('')}</ol>` : '<p class="tp-stage-empty">Этапы не переданы</p>';
  return `<section class="tp-stages${fresh ? '' : ' tp-stages-stale'}" aria-label="Этапы задачи ${text(task.title)}"><h4>${origin}</h4>${freshness}${items}${source}</section>`;
}
function renderTaskDetails(task) {
  const blockers = task.blockers.length ? task.blockers.map(text).join('; ') : task.acceptanceConfirmed ? 'Открытых препятствий нет' : 'Сведения о препятствиях и остатке не переданы';
  const accepted = task.accepted.length ? `<ul>${task.accepted.map(item => `<li>${text(item.label)}<span class="tp-evidence">Evidence: ${text(item.evidence)}</span></li>`).join('')}</ul>` : 'Подтверждённые результаты не переданы';
  const acceptance = task.acceptance ? `<dt>Приёмка всей задачи</dt><dd>${text(task.acceptance.evidence)} · ${text(task.acceptance.acceptedAt)}${task.acceptanceConfirmed ? '' : ' · текущая приёмка не подтверждена'}</dd>` : '';
  const stages = task.stageCoverage ? `<dt>Охват этапов</dt><dd>Принят вес ${text(exact(task.stageCoverage.acceptedWeight))}/${text(exact(task.stageCoverage.totalWeight))}; известен статус веса ${text(exact(task.stageCoverage.knownWeight))}/${text(exact(task.stageCoverage.totalWeight))}.</dd>` : '';
  const interval = task.progress && task.progress.min !== task.progress.max ? '<dt>Шкала</dt><dd>Сплошная полоса — нижняя граница; штриховка — диапазон оценки.</dd>' : '';
  return `<details class="tp-details"><summary>Подробности</summary><dl><dt>ID задачи</dt><dd>${text(task.id)}</dd><dt>Сейчас</dt><dd>${task.stage ? text(task.stage) : 'Стадия неизвестна'}</dd><dt>Свежесть</dt><dd>${text(task.freshness.label)} · ${task.updatedAt ? text(task.updatedAt) : 'Дата не передана'}</dd><dt>Мешает / осталось</dt><dd>${blockers}</dd><dt>Источник оценки</dt><dd>${sourceText(task.source)}</dd><dt>Принято</dt><dd>${accepted}</dd>${acceptance}${stages}${interval}</dl></details>`;
}
function renderTask(task) {
  const status = Object.hasOwn(STATUS_LABELS, task.status) ? task.status : 'unknown';
  const historicalAcceptance = status === 'accepted' && !task.acceptanceConfirmed;
  const statusLabel = historicalAcceptance ? 'Приёмка по снимку' : STATUS_LABELS[status];
  const statusStyle = historicalAcceptance ? 'unknown' : status;
  const fresh = task.freshness.state === 'fresh';
  const blockers = task.blockers.length ? `<p class="tp-blockers tp-attention">${task.blockers.map(text).join('; ')}</p>` : '';
  const freshness = fresh ? '' : `<p class="tp-freshness tp-attention">${text(task.freshness.label)}</p>`;
  const issues = task.issues.length ? `<ul class="tp-issues" aria-label="Предупреждения задачи">${task.issues.map(issue => `<li>⚠ ${text(issue)}</li>`).join('')}</ul>` : '';
  return `<div class="tp-task-group" role="rowgroup"><div class="tp-task" role="row"><div class="tp-task-name" role="cell"><h3>${text(task.title)}</h3><p class="tp-basis">${text(BASIS_LABELS[task.basis] ?? BASIS_LABELS.unknown)}</p></div><div class="tp-progress-cell" role="cell">${renderProgress(task)}</div><div class="tp-state" role="cell"><p class="tp-status tp-status-${statusStyle}">${text(statusLabel)}</p>${blockers}${freshness}</div></div><div class="tp-details-row" role="row"><div role="cell" aria-colspan="3">${issues}${renderTaskDetails(task)}${renderStages(task)}</div></div></div>`;
}
function renderAggregate(total) {
  if (!total) return '';
  const title = total.progress ? total.acceptanceConfirmed ? '100% · все задачи приняты' : `Итог выбранной области: ≈ ${rangeText(total.progress)}` : 'Общий процент неизвестен';
  const incomplete = total.reason === 'Текущий итог всей области неизвестен: охват неполный';
  const reason = total.reason ? `<p class="tp-total-reason">${text(total.reason)}</p>` : '';
  const known = total.knownSubset ? `<p class="tp-subset">По известной части: ≈ ${text(rangeText(total.knownSubset))}. Это оценка только известной части.</p>` : '';
  const coverage = total.coveragePercent !== null ? `<p class="tp-coverage">Данные есть по ${text(total.knownCount)} из ${text(total.totalCount)} задач · вес ${text(exact(total.knownWeight))}/${text(exact(total.totalWeight))} (${text(approximate(total.coveragePercent))}%).</p>` : '<p class="tp-coverage">Охват неизвестен.</p>';
  const terms = total.formula?.terms.map(term => `${text(term.taskId)}: ${text(rangeText(term.value, true))} × ${text(exact(term.weight))}`).join(' + ') || 'нет известных значений';
  const formula = total.formula ? `<p>Формула ${total.progress ? 'итога' : 'известной части'}: (${terms}) / ${text(exact(total.formula.denominator))}; полный вес области ${text(exact(total.formula.fullDenominator))}.${total.formula.denominator === 0 ? ' Деление не выполнялось.' : ''}</p>` : '';
  const provenance = total.source ? `<p>Источник состава и весов: ${sourceText(total.source)}.</p>` : '<p>Источник состава и весов не передан.</p>';
  return `<section class="tp-total" aria-label="Итог выбранной области"><h3>${text(title)}</h3>${incomplete ? '' : reason}${coverage}<details class="tp-details"><summary>Основание итога</summary>${incomplete ? reason : ''}${known}${formula}${provenance}</details></section>`;
}

const STYLE = `
#${ROOT}{--tp-bg:#1b2229;--tp-panel:#20272f;--tp-line:#34404b;--tp-text:#f2f5f7;--tp-muted:#aeb8c4;--tp-accent:#36d2ed;--tp-warning:#f5c152;--tp-track:#424d59;--tp-interval:#36d2ed;--tp-interval-alt:#365867;--tp-question:#8c98a6;--tp-question-text:#182029;--tp-accepted:#82dfb1;--tp-checking:#c1adff;display:block;box-sizing:border-box;width:100%;max-width:1120px;margin:0;border:1px solid var(--tp-line);border-radius:12px;background:var(--tp-bg);color:var(--tp-text);font:14px/1.5 "Segoe UI",system-ui,sans-serif;color-scheme:dark;isolation:isolate;overflow-wrap:anywhere;text-align:left}
#${ROOT}[data-theme="light"]{--tp-bg:#fffdf9;--tp-panel:#f3f0ed;--tp-line:#d8d3cc;--tp-text:#1f2430;--tp-muted:#535d6b;--tp-accent:#007a91;--tp-warning:#8b5100;--tp-track:#dce4e7;--tp-interval:#007a91;--tp-interval-alt:#b0dce5;--tp-question:#e2e6eb;--tp-question-text:#414c5c;--tp-accepted:#14633d;--tp-checking:#6941ad;color-scheme:light}
#${ROOT}[data-theme="indigo"]{--tp-bg:#19172a;--tp-panel:#222039;--tp-line:#46425d;--tp-text:#f5f2ff;--tp-muted:#c3bdd5;--tp-accent:#b19aff;--tp-warning:#ffcf8d;--tp-track:#514866;--tp-interval:#b19aff;--tp-interval-alt:#6b568c;--tp-question:#5f5776;--tp-question-text:#f5f2ff;--tp-accepted:#a1e2c0;--tp-checking:#d1bfff}
#${ROOT}[data-theme="forest"]{--tp-bg:#13241e;--tp-panel:#1a2e26;--tp-line:#3d594b;--tp-text:#effaf2;--tp-muted:#b2cabb;--tp-accent:#72d7a0;--tp-warning:#f3cf78;--tp-track:#375247;--tp-interval:#72d7a0;--tp-interval-alt:#3e7b5c;--tp-question:#5d7b6b;--tp-question-text:#f3faf5;--tp-accepted:#9be5b6;--tp-checking:#c2d9ff}
#${ROOT} *,#${ROOT} *::before,#${ROOT} *::after{box-sizing:border-box;min-width:0}
#${ROOT} p,#${ROOT} h2,#${ROOT} h3,#${ROOT} h4,#${ROOT} dl,#${ROOT} dd,#${ROOT} ul,#${ROOT} ol{margin:0}
#${ROOT} .tp-header{display:flex;justify-content:space-between;align-items:flex-start;gap:20px;padding:24px 26px}
#${ROOT} .tp-kicker{margin-bottom:6px;color:var(--tp-muted);font-size:12px;font-weight:600;letter-spacing:.04em}
#${ROOT} h2{font-size:24px;line-height:1.3;font-weight:650}
#${ROOT} .tp-demo{margin-top:8px;color:var(--tp-muted);font-size:12px}
#${ROOT} .tp-meta{flex:0 1 240px;color:var(--tp-muted);font-size:11px;text-align:right}
#${ROOT} .tp-meta span{display:block}
#${ROOT} .tp-selected{padding:0 26px 18px;color:var(--tp-muted);font-size:12px}
#${ROOT} .tp-controls{display:flex;align-items:end;flex-wrap:wrap;gap:10px 18px;padding:0 26px 18px}
#${ROOT} .tp-control{display:grid;gap:3px;color:var(--tp-muted);font-size:11px}
#${ROOT} .tp-control select{max-width:100%;min-height:32px;padding:4px 8px;border:1px solid var(--tp-line);border-radius:6px;background:var(--tp-panel);color:var(--tp-text);font:12px/1.4 "Segoe UI",system-ui,sans-serif}
#${ROOT} .tp-control-check{display:flex;align-items:center;gap:7px;min-height:32px;color:var(--tp-text);font-size:12px}
#${ROOT} .tp-control-check input{width:16px;height:16px;margin:0;accent-color:var(--tp-accent)}
#${ROOT} .tp-control select:focus-visible,#${ROOT} .tp-control-check input:focus-visible{outline:2px solid var(--tp-accent);outline-offset:3px}
#${ROOT} .tp-column-head,#${ROOT} .tp-task{display:grid;grid-template-columns:minmax(0,1.05fr) minmax(0,1.3fr) minmax(0,1fr);column-gap:26px;padding:18px 26px}
#${ROOT} .tp-column-head{border-top:1px solid var(--tp-line);background:var(--tp-panel);color:var(--tp-muted);font-size:13px;font-weight:600}
#${ROOT} .tp-task{border-top:1px solid var(--tp-line);row-gap:12px;align-items:start;padding-top:16px;padding-bottom:4px}
#${ROOT} .tp-details-row{padding:0 26px 8px}
#${ROOT} .tp-task h3{font-size:17px;line-height:1.35;font-weight:650}
#${ROOT} .tp-basis{margin-top:4px;color:var(--tp-muted);font-size:13px}
#${ROOT} .tp-progress-cell{align-self:center}
#${ROOT} .tp-meter-line{display:grid;grid-template-columns:minmax(0,1fr) 90px;align-items:center;gap:10px}
#${ROOT} .tp-track{position:relative;width:100%;height:12px;border-radius:20px;background:var(--tp-track);overflow:hidden}
#${ROOT} .tp-fill,#${ROOT} .tp-interval{position:absolute;top:0;height:100%;display:block}
#${ROOT} .tp-fill{left:0;background:var(--tp-accent)}
#${ROOT} .tp-interval{background:repeating-linear-gradient(135deg,var(--tp-interval) 0px,var(--tp-interval) 4px,var(--tp-interval-alt) 4px,var(--tp-interval-alt) 8px)}
#${ROOT} .tp-percent{max-width:100%;font-size:16px;font-weight:600;line-height:1.3;font-variant-numeric:tabular-nums}
#${ROOT} .tp-unknown{display:flex;align-items:center;gap:8px;color:var(--tp-muted);font-size:16px}
#${ROOT} .tp-question{display:inline-flex;align-items:center;justify-content:center;width:20px;height:20px;border-radius:50%;background:var(--tp-question);color:var(--tp-question-text);font-size:14px;font-weight:700}
#${ROOT} .tp-last{margin-top:7px;color:var(--tp-muted);font-size:12px}
#${ROOT} .tp-status{font-size:16px;font-weight:600}
#${ROOT} .tp-status-blocked,#${ROOT} .tp-status-paused{color:var(--tp-warning)}
#${ROOT} .tp-status-accepted{color:var(--tp-accepted)}
#${ROOT} .tp-status-unknown{color:var(--tp-muted)}
#${ROOT} .tp-blockers{margin-top:5px;color:var(--tp-muted);font-size:12px}
#${ROOT} .tp-freshness{margin-top:5px;color:var(--tp-muted);font-size:11px}
#${ROOT} .tp-attention,#${ROOT} .tp-issues,#${ROOT} .tp-warnings{color:var(--tp-warning)}
#${ROOT} .tp-issues{grid-column:1/-1;margin-bottom:7px;padding-left:18px;font-size:12px}
#${ROOT} .tp-details{grid-column:1/-1;font-size:12px;color:var(--tp-muted)}
#${ROOT} .tp-details summary{display:list-item;min-height:24px;padding:2px 0;color:var(--tp-muted)}
#${ROOT} .tp-details summary:focus-visible{outline:2px solid var(--tp-accent);outline-offset:3px;border-radius:3px}
#${ROOT} .tp-details[open] summary{margin-bottom:8px}
#${ROOT} .tp-details dl{display:grid;grid-template-columns:minmax(90px,160px) minmax(0,1fr);gap:8px 16px}
#${ROOT} .tp-details dt{color:var(--tp-text);font-weight:600}
#${ROOT} .tp-details ul{padding-left:18px}
#${ROOT} .tp-evidence{display:block;font-size:11px}
#${ROOT} .tp-total{padding:22px 26px;border-top:1px solid var(--tp-line)}
#${ROOT} .tp-total h3{font-size:22px;line-height:1.35;font-weight:650}
#${ROOT} .tp-coverage{margin-top:5px;color:var(--tp-muted);font-size:14px}
#${ROOT} .tp-total-reason,#${ROOT} .tp-subset{margin-top:7px;color:var(--tp-muted);font-size:12px}
#${ROOT} .tp-total .tp-details{margin-top:7px}
#${ROOT} .tp-total .tp-details p+p{margin-top:8px}
#${ROOT} .tp-warnings{border-top:1px solid var(--tp-line);padding:14px 26px;font-size:12px}
#${ROOT} .tp-warnings ul{padding-left:18px}
#${ROOT} .tp-footer{padding:16px 26px;border-top:1px solid var(--tp-line);color:var(--tp-muted);font-size:11px}
#${ROOT} .tp-footer p+p{margin-top:5px}
#${ROOT} .tp-empty{padding:24px 26px;border-top:1px solid var(--tp-line);color:var(--tp-muted)}
#${ROOT} .tp-ring{display:none;position:relative;width:160px;height:160px;max-width:100%;margin:auto}
#${ROOT} .tp-ring svg{display:block;width:100%;height:100%}
#${ROOT} .tp-ring circle{fill:none;stroke-width:8;stroke-linecap:butt}
#${ROOT} .tp-ring-track{stroke:var(--tp-track)}
#${ROOT} .tp-ring-fill{stroke:var(--tp-accent)}
#${ROOT} .tp-ring-interval{stroke:var(--tp-interval);opacity:.45}
#${ROOT} .tp-ring-value{position:absolute;inset:21%;display:flex;align-items:center;justify-content:center;text-align:center;font-size:22px;line-height:1.25;font-weight:650;font-variant-numeric:tabular-nums}
#${ROOT}[data-view="ring"] .tp-column-head{display:none}
#${ROOT}[data-view="ring"] .tp-task{grid-template-columns:160px minmax(0,1fr);grid-template-areas:"ring name" "ring state";column-gap:24px;row-gap:10px;padding-top:20px;padding-bottom:12px}
#${ROOT}[data-view="ring"] .tp-task-name{grid-area:name}
#${ROOT}[data-view="ring"] .tp-progress-cell{grid-area:ring}
#${ROOT}[data-view="ring"] .tp-state{grid-area:state}
#${ROOT}[data-view="ring"] .tp-meter-line{display:none}
#${ROOT}[data-view="ring"] .tp-ring{display:block}
#${ROOT} .tp-stages{margin-top:8px;padding:12px;border:1px solid var(--tp-line);border-radius:8px;background:var(--tp-panel)}
#${ROOT} .tp-stages h4{font-size:13px;font-weight:650}
#${ROOT} .tp-stage-freshness{margin-top:4px;font-size:11px}
#${ROOT} .tp-stage-empty{margin-top:6px;color:var(--tp-muted);font-size:12px}
#${ROOT} .tp-stage-list{display:grid;grid-template-columns:repeat(auto-fit,minmax(145px,1fr));gap:10px;list-style:none;padding:0;margin-top:10px}
#${ROOT} .tp-stage-item{display:grid;grid-template-columns:22px minmax(0,1fr);gap:8px;padding:9px;border:1px solid var(--tp-line);border-radius:7px;background:var(--tp-bg)}
#${ROOT} .tp-stage-index{display:flex;align-items:center;justify-content:center;width:22px;height:22px;border:1px solid var(--tp-line);border-radius:50%;color:var(--tp-muted);font-size:11px;font-variant-numeric:tabular-nums}
#${ROOT} .tp-stage-label{font-size:12px;font-weight:600}
#${ROOT} .tp-stage-status{margin-top:3px;color:var(--tp-muted);font-size:11px}
#${ROOT} .tp-stage-item[data-status="accepted"] .tp-stage-status{color:var(--tp-accepted)}
#${ROOT} .tp-stage-item[data-status="checking"] .tp-stage-status{color:var(--tp-checking)}
#${ROOT} .tp-stage-item[data-status="working"] .tp-stage-status{color:var(--tp-accent)}
#${ROOT} .tp-stage-item[data-status="blocked"] .tp-stage-status,#${ROOT} .tp-stage-item[data-status="paused"] .tp-stage-status{color:var(--tp-warning)}
#${ROOT} .tp-stages-stale .tp-stage-item[data-status="accepted"] .tp-stage-status{color:var(--tp-muted)}
#${ROOT} .tp-stage-proof{margin-top:4px;font-size:11px}
#${ROOT} .tp-stage-proof p+p{margin-top:4px}
#${ROOT} .tp-stage-source{margin-top:6px;font-size:11px}
#${ROOT}[data-show-stages="false"] .tp-stages{display:none}
@media(max-width:600px){#${ROOT} .tp-header{display:block;padding:20px 16px}#${ROOT} h2{font-size:21px}#${ROOT} .tp-meta{margin-top:12px;text-align:left}#${ROOT} .tp-selected{padding:0 16px 16px}#${ROOT} .tp-column-head{display:none}#${ROOT} .tp-task{grid-template-columns:minmax(0,1fr);gap:14px;padding:20px 16px 8px}#${ROOT} .tp-details-row{padding:0 16px 8px}#${ROOT} .tp-progress-cell{width:100%}#${ROOT} .tp-meter-line{gap:10px}#${ROOT} .tp-state{padding-top:2px}#${ROOT} .tp-details dl{grid-template-columns:minmax(0,1fr);gap:4px}#${ROOT} .tp-details dd+dt{margin-top:8px}#${ROOT} .tp-total{padding:20px 16px}#${ROOT} .tp-total h3{font-size:20px}#${ROOT} .tp-warnings{padding:14px 16px}#${ROOT} .tp-footer{padding:16px}#${ROOT} .tp-empty{padding:20px 16px}}
@media(max-width:600px){#${ROOT} .tp-controls{padding:0 16px 16px;gap:10px 14px}#${ROOT}[data-view="ring"] .tp-task{grid-template-columns:112px minmax(0,1fr);column-gap:14px}#${ROOT}[data-view="ring"] .tp-ring{width:112px;height:112px}#${ROOT}[data-view="ring"] .tp-ring-value{font-size:18px}#${ROOT} .tp-stage-list{grid-template-columns:minmax(0,1fr)}}
`;

// This constant never contains snapshot strings. It only changes presentation
// preferences; no data is fetched, recalculated, saved to files or sent to Planner.
const SCRIPT = `
(() => {
  const root = document.getElementById('task-progress-dashboard');
  if (!root) return;
  const view = root.querySelector('[data-pref="view"]');
  const theme = root.querySelector('[data-pref="theme"]');
  const stages = root.querySelector('[data-pref="stages"]');
  if (!view || !theme || !stages) return;
  const views = new Set(['bar', 'ring']);
  const themes = new Set(['night', 'light', 'indigo', 'forest']);
  const apply = preferences => {
    if (!preferences || typeof preferences !== 'object' || Array.isArray(preferences)) return;
    if (views.has(preferences.view)) root.dataset.view = preferences.view;
    if (themes.has(preferences.theme)) root.dataset.theme = preferences.theme;
    if (typeof preferences.showStages === 'boolean') root.dataset.showStages = String(preferences.showStages);
    view.value = root.dataset.view;
    theme.value = root.dataset.theme;
    stages.checked = root.dataset.showStages === 'true';
  };
  const savePreferenceChange = () => {
    try {
      const bridge = window.openai;
      if (typeof bridge?.setWidgetState !== 'function') return;
      const appearance = { view: root.dataset.view, theme: root.dataset.theme, showStages: stages.checked };
      const result = bridge.setWidgetState({ modelContent: { appearance }, privateContent: { taskProgressUI: appearance } });
      if (result && typeof result.catch === 'function') result.catch(() => {});
    } catch {}
  };
  root.addEventListener('change', event => {
    if (event.target !== view && event.target !== theme && event.target !== stages) return;
    apply({ view: view.value, theme: theme.value, showStages: stages.checked });
    savePreferenceChange();
  });
  try { apply(window.openai?.widgetState?.privateContent?.taskProgressUI); } catch {}
  window.addEventListener('openai:set_globals', event => {
    try { apply(event.detail?.globals?.widgetState?.privateContent?.taskProgressUI); } catch {}
  });
})();
`;
function renderControls(view, theme, stages) {
  const views = [['bar', 'Полоса'], ['ring', 'Круг']];
  const themes = [['night', 'Ночная'], ['light', 'Светлая'], ['indigo', 'Индиго'], ['forest', 'Лесная']];
  return `<div class="tp-controls" role="group" aria-label="Внешний вид прогресса"><label class="tp-control">Вид<select data-pref="view">${views.map(([value, label]) => `<option value="${value}"${value === view ? ' selected' : ''}>${label}</option>`).join('')}</select></label><label class="tp-control">Тема<select data-pref="theme">${themes.map(([value, label]) => `<option value="${value}"${value === theme ? ' selected' : ''}>${label}</option>`).join('')}</select></label><label class="tp-control-check"><input type="checkbox" data-pref="stages"${stages ? ' checked' : ''}>Этапы</label></div>`;
}

// An offline fragment. Report computation belongs to core.mjs; the only script
// handles local UI preferences, optionally through the host's widgetState bridge.
export function renderHtml(report, options = {}) {
  if (options === null || typeof options !== 'object' || Array.isArray(options) || Object.keys(options).some(key => !['view', 'theme', 'stages'].includes(key))) throw new TypeError('HTML options: допустимы только view, theme и stages');
  const view = options.view === undefined ? 'bar' : options.view;
  const theme = options.theme === undefined ? 'night' : options.theme;
  const stages = options.stages === undefined ? true : options.stages;
  if (!VIEWS.has(view)) throw new TypeError('HTML view: требуется bar или ring');
  if (!THEMES.has(theme)) throw new TypeError('HTML theme: требуется night, light, indigo или forest');
  if (typeof stages !== 'boolean') throw new TypeError('HTML stages: требуется boolean');
  const heading = `Прогресс · ${SCOPE_LABELS[report.selection.kind] ?? report.selection.kind} ${report.selection.id}`;
  const selected = report.selection.kind === 'tasks' ? `<p class="tp-selected">Выбраны задачи: ${report.selection.taskIds.map(text).join(', ')}.</p>` : '';
  const rows = report.tasks.length ? `<div class="tp-table" role="table" aria-label="Прогресс выбранных задач"><div class="tp-column-head" role="row"><span role="columnheader">Задача</span><span role="columnheader">Прогресс</span><span role="columnheader">Состояние</span></div>${report.tasks.map(renderTask).join('')}</div>` : '<p class="tp-empty">Нет переданных задач. Прогресс неизвестен.</p>';
  const warnings = report.warnings.length ? `<section class="tp-warnings" aria-label="Предупреждения области"><ul>${report.warnings.map(warning => `<li>⚠ ${text(warning)}</li>`).join('')}</ul></section>` : '';
  const refs = [...new Set(report.tasks.filter(task => task.source).map(task => task.source.ref))];
  return `<section id="${ROOT}" data-task-progress data-view="${view}" data-theme="${theme}" data-show-stages="${stages}" lang="ru" aria-label="${text(heading)}"><style>${STYLE}</style><header class="tp-header"><div><p class="tp-kicker">Пульт задач</p><h2>${text(heading)}</h2>${report.demo ? '<p class="tp-demo">Демонстрация · синтетические данные, не текущий прогресс рабочих проектов.</p>' : ''}</div><p class="tp-meta"><span>Показ: ${text(report.renderedAt)}</span><span>Порог свежести: ${text(report.staleAfterMinutes)} мин.</span></p></header>${renderControls(view, theme, stages)}${selected}${rows}${renderAggregate(report.aggregate)}${warnings}<footer class="tp-footer"><p>Источники: ${refs.length ? refs.map(text).join(' · ') : 'не переданы'}. Полные evidence — в подробностях задач.</p><p>Оценка относится только к выбранной области и времени. Evidence переданы источником; renderer их внешне не проверяет.</p></footer><script>${SCRIPT}</script></section>\n`;
}
