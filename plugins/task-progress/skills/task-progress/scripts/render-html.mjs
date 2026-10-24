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
    const historicalAcceptance = task.status === 'accepted' && task.lastKnown?.min === 100 && task.lastKnown.max === 100;
    const last = historicalAcceptance ? '<p class="tp-last">Последняя подтверждённая приёмка: 100% по снимку. Текущий прогресс неизвестен.</p>' : task.lastKnown ? `<p class="tp-last">Последняя оценка: ${text(estimateText(task, task.lastKnown))}${task.basis === 'fixed_checklist' ? ' по checklist' : ''}. Текущий прогресс неизвестен.</p>` : '';
    const missing = task.basis === 'unknown' && !task.lastKnown ? '<p class="tp-last">Источник не передал оценку прогресса; процент не вычислялся.</p>' : '';
    return `<div class="tp-progress"><p class="tp-unknown">Неизвестно <span class="tp-question" aria-hidden="true">?</span></p>${last}${missing}</div>`;
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
  const relation = task.stageSource === 'display' ? 'Перечень для ориентира · не меняет процент' : task.stageSource === 'progress' ? 'Принятые шаги учитываются по весам' : '';
  const freshness = !fresh && stages.length > 0 ? '<p class="tp-stage-freshness tp-attention">Этапы по последнему снимку</p>' : '';
  const source = task.stageSourceEvidence ? `<details class="tp-details tp-stage-source"><summary>Источник этапов</summary><p>${sourceText(task.stageSourceEvidence)}</p></details>` : '';
  const acceptedCount = stages.filter(stage => stage.status === 'accepted').length;
  const summary = stages.length ? `${acceptedCount} из ${stages.length} принято${fresh ? '' : ' по снимку'}` : 'План пока не передан';
  const items = stages.length ? `<ol class="tp-stage-list">${stages.map((stage, index) => {
    const status = Object.hasOwn(STAGE_LABELS, stage.status) ? stage.status : 'unknown';
    const label = !fresh && status === 'accepted' ? 'Принят по снимку' : STAGE_LABELS[status];
    const proof = `<div class="tp-stage-proof"><p>ID: ${text(stage.id)}.</p>${stage.evidence ? `<p>Evidence: ${text(stage.evidence)}</p>` : '<p>Evidence не передан.</p>'}${stage.weight !== undefined ? `<p>Вес источника: ${text(exact(stage.weight))}.</p>` : ''}</div>`;
    return `<li class="tp-stage-item" data-status="${status}"><details class="tp-stage-disclosure"><summary class="tp-stage-row"><span class="tp-stage-index" aria-hidden="true">${index + 1}</span><span class="tp-stage-label">${text(stage.label)}</span><span class="tp-stage-status">${text(label)}</span><span class="tp-stage-chevron" aria-hidden="true"></span></summary>${proof}</details></li>`;
  }).join('')}</ol>` : '<p class="tp-stage-empty">Этапы не переданы источником.</p>';
  return `<section class="tp-stages${fresh ? '' : ' tp-stages-stale'}" aria-label="Этапы задачи ${text(task.title)}"><div class="tp-stages-heading"><div><p class="tp-stages-kicker">Маршрут задачи</p><h4>${origin}</h4></div><p class="tp-stages-summary">${summary}</p></div>${relation ? `<p class="tp-stages-relation">${relation}</p>` : ''}${freshness}${items}${source}</section>`;
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
  const unconfirmedAcceptance = status === 'accepted' && !task.acceptanceConfirmed;
  const historicalAcceptance = unconfirmedAcceptance && task.lastKnown?.min === 100 && task.lastKnown.max === 100;
  const statusLabel = historicalAcceptance ? 'Приёмка по снимку' : unconfirmedAcceptance ? 'Приёмка не подтверждена' : STATUS_LABELS[status];
  const statusStyle = unconfirmedAcceptance ? 'unknown' : status;
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
#${ROOT}{--tp-bg:#1b2229;--tp-panel:#20272f;--tp-line:#34404b;--tp-text:#f2f5f7;--tp-muted:#aeb8c4;--tp-accent:#36d2ed;--tp-warning:#f5c152;--tp-track:#424d59;--tp-interval:#36d2ed;--tp-interval-alt:#365867;--tp-question:#8c98a6;--tp-question-text:#182029;--tp-accepted:#82dfb1;--tp-checking:#c1adff;display:block;box-sizing:border-box;width:100%;max-width:1120px;margin:0;border:1px solid var(--tp-line);border-radius:12px;background:var(--tp-bg);color:var(--tp-text);font:14px/1.5 "Segoe UI",system-ui,sans-serif;color-scheme:dark;isolation:isolate;overflow-wrap:anywhere;text-align:left;container-type:inline-size}
#${ROOT}[data-theme="light"]{--tp-bg:#fffdf9;--tp-panel:#f3f0ed;--tp-line:#d8d3cc;--tp-text:#1f2430;--tp-muted:#535d6b;--tp-accent:#007a91;--tp-warning:#8b5100;--tp-track:#dce4e7;--tp-interval:#007a91;--tp-interval-alt:#b0dce5;--tp-question:#e2e6eb;--tp-question-text:#414c5c;--tp-accepted:#14633d;--tp-checking:#6941ad;color-scheme:light}
#${ROOT}[data-theme="indigo"]{--tp-bg:#19172a;--tp-panel:#222039;--tp-line:#46425d;--tp-text:#f5f2ff;--tp-muted:#c3bdd5;--tp-accent:#b19aff;--tp-warning:#ffcf8d;--tp-track:#514866;--tp-interval:#b19aff;--tp-interval-alt:#6b568c;--tp-question:#5f5776;--tp-question-text:#f5f2ff;--tp-accepted:#a1e2c0;--tp-checking:#d1bfff}
#${ROOT}[data-theme="forest"]{--tp-bg:#13241e;--tp-panel:#1a2e26;--tp-line:#3d594b;--tp-text:#effaf2;--tp-muted:#b2cabb;--tp-accent:#72d7a0;--tp-warning:#f3cf78;--tp-track:#375247;--tp-interval:#72d7a0;--tp-interval-alt:#3e7b5c;--tp-question:#5d7b6b;--tp-question-text:#f3faf5;--tp-accepted:#9be5b6;--tp-checking:#c2d9ff}
#${ROOT} *,#${ROOT} *::before,#${ROOT} *::after{box-sizing:border-box;min-width:0}
#${ROOT} p,#${ROOT} h2,#${ROOT} h3,#${ROOT} h4,#${ROOT} dl,#${ROOT} dd,#${ROOT} ul,#${ROOT} ol{margin:0}
#${ROOT} .tp-visually-hidden{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0 0 0 0);clip-path:inset(50%);white-space:nowrap;border:0}
#${ROOT} .tp-dashboard-disclosure>summary{list-style:none;cursor:pointer}
#${ROOT} .tp-dashboard-disclosure>summary::-webkit-details-marker{display:none}
#${ROOT} .tp-dashboard-disclosure>summary:focus-visible{outline:2px solid var(--tp-accent);outline-offset:-3px;border-radius:10px}
#${ROOT} .tp-dashboard-disclosure>summary:hover{background:var(--tp-panel)}
#${ROOT} .tp-compact-summary{display:grid;grid-template-columns:66px minmax(0,1fr) auto;align-items:center;gap:14px;min-height:84px;padding:10px 56px 10px 16px}
#${ROOT} .tp-compact-ring{position:relative;display:grid;place-items:center;width:64px;height:64px;border-radius:50%;background:conic-gradient(from -90deg,var(--tp-accent) 0 var(--tp-compact-progress),var(--tp-interval-alt) var(--tp-compact-progress) var(--tp-compact-interval),var(--tp-track) var(--tp-compact-interval));color:var(--tp-text);font-size:16px;font-weight:700;font-variant-numeric:tabular-nums;white-space:nowrap}
#${ROOT} .tp-compact-ring::before{content:"";position:absolute;inset:6px;border-radius:50%;background:var(--tp-bg)}
#${ROOT} .tp-compact-ring>span{position:relative}
#${ROOT} .tp-compact-range{font-size:11px}
#${ROOT} .tp-compact-unknown{background:var(--tp-track);color:var(--tp-muted);font-size:22px}
#${ROOT} .tp-compact-main{display:grid;gap:1px;min-width:0}
#${ROOT} .tp-compact-title{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:14px;line-height:1.25}
#${ROOT} .tp-compact-state{color:var(--tp-muted);font-size:11px}
#${ROOT} .tp-compact-stage-wrap{display:flex;flex-wrap:wrap;align-items:center;gap:3px 8px;min-width:0;margin-top:3px}
#${ROOT} .tp-compact-stage-caption,#${ROOT} .tp-compact-stages-off{color:var(--tp-muted);font-size:10px;white-space:normal}
#${ROOT} .tp-compact-stages-off{display:none}
#${ROOT}[data-show-stages="false"] .tp-compact-stage-wrap{display:none}
#${ROOT}[data-show-stages="false"] .tp-compact-stages-off{display:block}
#${ROOT} .tp-compact-stage-list{display:flex;flex:1;flex-wrap:wrap;min-width:0;max-width:280px;align-items:center}
#${ROOT} .tp-compact-stage-node{position:relative;display:flex;align-items:center;justify-content:center;flex:1;min-width:17px;max-width:30px;height:20px}
#${ROOT} .tp-compact-stage-node+.tp-compact-stage-node::before{content:"";position:absolute;left:-50%;width:100%;height:2px;background:var(--tp-line)}
#${ROOT} .tp-compact-stage-dot{position:relative;z-index:1;display:grid;place-items:center;width:19px;height:19px;border:1px solid var(--tp-line);border-radius:50%;background:var(--tp-bg);color:var(--tp-muted);font-size:9px;font-weight:700;font-variant-numeric:tabular-nums}
#${ROOT} .tp-compact-stage-node[data-status="accepted"] .tp-compact-stage-dot{border-color:var(--tp-accepted);color:var(--tp-accepted)}
#${ROOT} .tp-compact-stage-node[data-status="working"] .tp-compact-stage-dot{border-color:var(--tp-accent);color:var(--tp-accent)}
#${ROOT} .tp-compact-stage-node[data-status="checking"] .tp-compact-stage-dot{border-color:var(--tp-checking);color:var(--tp-checking)}
#${ROOT} .tp-compact-stage-node[data-status="blocked"] .tp-compact-stage-dot,#${ROOT} .tp-compact-stage-node[data-status="paused"] .tp-compact-stage-dot{border-color:var(--tp-warning);color:var(--tp-warning)}
#${ROOT} .tp-compact-stage-list.tp-compact-stale .tp-compact-stage-node .tp-compact-stage-dot{border-color:var(--tp-line);color:var(--tp-muted)}
#${ROOT} .tp-compact-action{display:inline-flex;align-items:center;justify-content:center;gap:7px;min-height:34px;padding:5px 9px;border:1px solid var(--tp-line);border-radius:8px;color:var(--tp-text);font-size:11px;font-weight:650;white-space:nowrap}
#${ROOT} .tp-dashboard-disclosure>summary:hover .tp-compact-action{border-color:var(--tp-accent)}
#${ROOT} .tp-action-close{display:none}
#${ROOT} .tp-dashboard-disclosure[open] .tp-action-open{display:none}
#${ROOT} .tp-dashboard-disclosure[open] .tp-action-close{display:inline}
#${ROOT} .tp-compact-chevron{width:7px;height:7px;border-right:1.5px solid currentColor;border-bottom:1.5px solid currentColor;transform:rotate(45deg)}
#${ROOT} .tp-dashboard-disclosure[open] .tp-compact-chevron{transform:rotate(225deg)}
#${ROOT} .tp-wide-summary{display:flex;align-items:center;justify-content:space-between;gap:12px;min-height:48px;padding:7px 56px 7px 16px;color:var(--tp-muted);font-size:12px}
#${ROOT} .tp-expanded{border-top:1px solid var(--tp-line)}
#${ROOT} .tp-header{display:flex;justify-content:space-between;align-items:flex-start;gap:20px;padding:24px 56px 20px 26px}
#${ROOT} .tp-kicker{margin-bottom:6px;color:var(--tp-muted);font-size:12px;font-weight:600;letter-spacing:.04em}
#${ROOT} h2{font-size:24px;line-height:1.3;font-weight:650}
#${ROOT} .tp-demo{margin-top:8px;color:var(--tp-muted);font-size:12px}
#${ROOT} .tp-meta{flex:0 1 240px;color:var(--tp-muted);font-size:11px;text-align:right}
#${ROOT} .tp-meta span{display:block}
#${ROOT} .tp-selected{padding:0 26px 18px;color:var(--tp-muted);font-size:12px}
#${ROOT} .tp-controls{display:flex;align-items:end;flex-wrap:wrap;gap:18px 24px;padding:16px 26px 20px;border-top:1px solid var(--tp-line);background:var(--tp-panel)}
#${ROOT} .tp-control-group{display:grid;gap:7px;min-width:0}
#${ROOT} .tp-control-title{color:var(--tp-muted);font-size:11px;font-weight:650;letter-spacing:.035em}
#${ROOT} .tp-choice-group{display:flex;flex-wrap:wrap;gap:5px}
#${ROOT} .tp-choice,#${ROOT} .tp-theme-choice{display:inline-flex;align-items:center;justify-content:center;gap:8px;min-height:40px;padding:6px 10px;border:1px solid var(--tp-line);border-radius:10px;background:var(--tp-bg);color:var(--tp-muted);font:600 12px/1.3 "Segoe UI",system-ui,sans-serif;cursor:pointer;white-space:nowrap}
#${ROOT} .tp-choice:hover,#${ROOT} .tp-theme-choice:hover{border-color:var(--tp-accent);color:var(--tp-text)}
#${ROOT} .tp-choice[aria-pressed="true"],#${ROOT} .tp-theme-choice[aria-pressed="true"]{border-color:var(--tp-accent);background:var(--tp-bg);color:var(--tp-text);box-shadow:inset 0 0 0 1px var(--tp-accent)}
#${ROOT} .tp-icon-badge{display:inline-flex;align-items:center;justify-content:center;flex:none;width:25px;height:25px;border-radius:7px;background:var(--tp-panel);color:var(--tp-accent)}
#${ROOT} .tp-control-icon{display:block;width:18px;height:18px}
#${ROOT} .tp-icon-badge[data-icon="night"]{background:#153d49;color:#68ddef}
#${ROOT} .tp-icon-badge[data-icon="light"]{background:#fff0c9;color:#946000}
#${ROOT} .tp-icon-badge[data-icon="indigo"]{background:#30254f;color:#c4aeff}
#${ROOT} .tp-icon-badge[data-icon="forest"]{background:#1d4230;color:#83e5ac}
#${ROOT} .tp-stage-toggle{display:inline-flex;align-items:center;gap:9px;min-height:40px;padding:0 2px;color:var(--tp-text);font-size:12px;font-weight:600;cursor:pointer;white-space:nowrap}
#${ROOT} .tp-stage-toggle input{appearance:none;position:relative;flex:none;width:34px;height:20px;margin:0;border:1px solid var(--tp-line);border-radius:999px;background:var(--tp-track);cursor:pointer}
#${ROOT} .tp-stage-toggle input::before{content:"";position:absolute;top:2px;left:2px;width:14px;height:14px;border-radius:50%;background:var(--tp-text)}
#${ROOT} .tp-stage-toggle input:checked{border-color:var(--tp-accent);background:var(--tp-accent)}
#${ROOT} .tp-stage-toggle input:checked::before{left:16px;background:var(--tp-bg)}
#${ROOT} .tp-choice:focus-visible,#${ROOT} .tp-theme-choice:focus-visible,#${ROOT} .tp-stage-toggle input:focus-visible{outline:2px solid var(--tp-accent);outline-offset:3px}
#${ROOT} .tp-column-head,#${ROOT} .tp-task{display:grid;grid-template-columns:minmax(0,1.05fr) minmax(0,1.3fr) minmax(0,1fr);column-gap:26px;padding:18px 26px}
#${ROOT} .tp-column-head{border-top:1px solid var(--tp-line);background:var(--tp-panel);color:var(--tp-muted);font-size:13px;font-weight:600}
#${ROOT} .tp-column-head-single{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0 0 0 0);clip-path:inset(50%);white-space:nowrap;border:0}
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
#${ROOT} .tp-ring{display:none;position:relative;width:124px;height:124px;max-width:100%;margin:auto}
#${ROOT} .tp-ring svg{display:block;width:100%;height:100%}
#${ROOT} .tp-ring circle{fill:none;stroke-width:8;stroke-linecap:butt}
#${ROOT} .tp-ring-track{stroke:var(--tp-track)}
#${ROOT} .tp-ring-fill{stroke:var(--tp-accent)}
#${ROOT} .tp-ring-interval{stroke:var(--tp-interval);opacity:.45}
#${ROOT} .tp-ring-value{position:absolute;inset:21%;display:flex;align-items:center;justify-content:center;text-align:center;font-size:19px;line-height:1.25;font-weight:650;font-variant-numeric:tabular-nums}
#${ROOT}[data-view="ring"] .tp-column-head{display:none}
#${ROOT}[data-view="ring"] .tp-task{grid-template-columns:124px minmax(0,1fr);grid-template-areas:"ring name" "ring state";column-gap:20px;row-gap:8px;padding-top:16px;padding-bottom:8px}
#${ROOT}[data-view="ring"] .tp-task-name{grid-area:name}
#${ROOT}[data-view="ring"] .tp-progress-cell{grid-area:ring}
#${ROOT}[data-view="ring"] .tp-state{grid-area:state}
#${ROOT}[data-view="ring"] .tp-meter-line{display:none}
#${ROOT}[data-view="ring"] .tp-ring{display:block}
#${ROOT} .tp-stages{margin-top:8px;padding:9px 0 0;border-top:1px solid var(--tp-line)}
#${ROOT} .tp-stages-heading{display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:4px 12px}
#${ROOT} .tp-stages-kicker{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)}
#${ROOT} .tp-stages h4{font-size:14px;font-weight:650;line-height:1.3}
#${ROOT} .tp-stages-summary{color:var(--tp-muted);font-size:11px;font-variant-numeric:tabular-nums}
#${ROOT} .tp-stages-relation{margin-top:2px;color:var(--tp-muted);font-size:10px}
#${ROOT} .tp-stage-freshness{margin-top:3px;font-size:10px}
#${ROOT} .tp-stage-empty{margin-top:7px;color:var(--tp-muted);font-size:12px}
#${ROOT} .tp-stage-list{display:grid;gap:0;list-style:none;padding:0;margin-top:7px;border-top:1px solid var(--tp-line)}
#${ROOT} .tp-stage-item{border-bottom:1px solid var(--tp-line)}
#${ROOT} .tp-stage-row{display:grid;grid-template-columns:22px minmax(0,1fr) auto 9px;align-items:center;gap:9px;min-height:36px;padding:5px 2px;cursor:pointer;list-style:none}
#${ROOT} .tp-stage-row::-webkit-details-marker{display:none}
#${ROOT} .tp-stage-row:focus-visible{outline:2px solid var(--tp-accent);outline-offset:-2px;border-radius:4px}
#${ROOT} .tp-stage-row:hover{background:var(--tp-panel)}
#${ROOT} .tp-stage-index{display:flex;align-items:center;justify-content:center;width:22px;height:22px;border:1px solid var(--tp-line);border-radius:50%;color:var(--tp-muted);font-size:11px;font-weight:650;font-variant-numeric:tabular-nums}
#${ROOT} .tp-stage-item[data-status="accepted"] .tp-stage-index{border-color:var(--tp-accepted);color:var(--tp-accepted)}
#${ROOT} .tp-stage-item[data-status="checking"] .tp-stage-index{border-color:var(--tp-checking);color:var(--tp-checking)}
#${ROOT} .tp-stage-item[data-status="working"] .tp-stage-index{border-color:var(--tp-accent);color:var(--tp-accent)}
#${ROOT} .tp-stage-item[data-status="blocked"] .tp-stage-index,#${ROOT} .tp-stage-item[data-status="paused"] .tp-stage-index{border-color:var(--tp-warning);color:var(--tp-warning)}
#${ROOT} .tp-stage-label{min-width:0;font-size:12px;font-weight:650;line-height:1.35}
#${ROOT} .tp-stage-status{padding:1px 7px;border:1px solid currentColor;border-radius:999px;color:var(--tp-muted);font-size:10px;font-weight:600;line-height:1.3;white-space:nowrap}
#${ROOT} .tp-stage-chevron{width:7px;height:7px;border-right:1.5px solid var(--tp-muted);border-bottom:1.5px solid var(--tp-muted);transform:rotate(45deg);transition:transform .15s ease}
#${ROOT} .tp-stage-disclosure[open] .tp-stage-chevron{transform:rotate(225deg)}
#${ROOT} .tp-stage-item[data-status="accepted"] .tp-stage-status{color:var(--tp-accepted)}
#${ROOT} .tp-stage-item[data-status="checking"] .tp-stage-status{color:var(--tp-checking)}
#${ROOT} .tp-stage-item[data-status="working"] .tp-stage-status{color:var(--tp-accent)}
#${ROOT} .tp-stage-item[data-status="blocked"] .tp-stage-status,#${ROOT} .tp-stage-item[data-status="paused"] .tp-stage-status{color:var(--tp-warning)}
#${ROOT} .tp-stages-stale .tp-stage-item[data-status="accepted"] .tp-stage-index{border-color:var(--tp-line);color:var(--tp-muted)}
#${ROOT} .tp-stages-stale .tp-stage-item[data-status="accepted"] .tp-stage-status{color:var(--tp-muted)}
#${ROOT} .tp-stage-proof{padding:1px 8px 9px 33px;color:var(--tp-muted);font-size:11px}
#${ROOT} .tp-stage-proof p+p{margin-top:4px}
#${ROOT} .tp-stage-source{margin-top:6px;font-size:11px}
#${ROOT}[data-show-stages="false"] .tp-stages{display:none}
@media(prefers-reduced-motion:reduce){#${ROOT} .tp-stage-chevron{transition:none}}
@media(max-width:600px){#${ROOT} .tp-header{display:block;padding:20px 56px 16px 16px}#${ROOT} h2{font-size:21px}#${ROOT} .tp-meta{margin-top:12px;text-align:left}#${ROOT} .tp-selected{padding:0 16px 16px}#${ROOT} .tp-column-head{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0 0 0 0);clip-path:inset(50%);white-space:nowrap;border:0}#${ROOT} .tp-task{grid-template-columns:minmax(0,1fr);gap:14px;padding:20px 16px 8px}#${ROOT} .tp-details-row{padding:0 16px 8px}#${ROOT} .tp-progress-cell{width:100%}#${ROOT} .tp-meter-line{gap:10px}#${ROOT} .tp-state{padding-top:2px}#${ROOT} .tp-details dl{grid-template-columns:minmax(0,1fr);gap:4px}#${ROOT} .tp-details dd+dt{margin-top:8px}#${ROOT} .tp-total{padding:20px 16px}#${ROOT} .tp-total h3{font-size:20px}#${ROOT} .tp-warnings{padding:14px 16px}#${ROOT} .tp-footer{padding:16px}#${ROOT} .tp-empty{padding:20px 16px}}
@media(max-width:600px){#${ROOT} .tp-controls{padding:14px 16px 18px;gap:14px}#${ROOT} .tp-control-group[data-group="theme"]{width:100%}#${ROOT} .tp-theme-choice{min-width:calc(50% - 3px)}#${ROOT}[data-view="ring"] .tp-task{grid-template-columns:112px minmax(0,1fr);column-gap:14px}#${ROOT}[data-view="ring"] .tp-ring{width:112px;height:112px}#${ROOT}[data-view="ring"] .tp-ring-value{font-size:18px}}
@media(max-width:600px){#${ROOT} .tp-compact-summary{grid-template-columns:58px minmax(0,1fr) auto;gap:9px;min-height:76px;padding:9px 48px 9px 12px}#${ROOT} .tp-compact-ring{width:56px;height:56px;font-size:14px}#${ROOT} .tp-compact-range{font-size:10px}#${ROOT} .tp-compact-unknown{font-size:20px}#${ROOT} .tp-compact-title{font-size:13px}#${ROOT} .tp-compact-stage-wrap{flex-wrap:wrap;gap:2px 7px}#${ROOT} .tp-compact-action{min-height:30px;padding:4px 6px;font-size:10px}#${ROOT} .tp-wide-summary{padding-right:48px}}
@container (max-width:460px){#${ROOT} .tp-compact-summary{grid-template-columns:56px minmax(0,1fr);grid-template-areas:"ring main" "ring action";gap:4px 9px;min-height:80px;padding:9px 48px 9px 12px}#${ROOT} .tp-compact-ring{grid-area:ring;align-self:center;width:54px;height:54px;font-size:14px}#${ROOT} .tp-compact-range{font-size:10px}#${ROOT} .tp-compact-unknown{font-size:20px}#${ROOT} .tp-compact-main{grid-area:main}#${ROOT} .tp-compact-title{font-size:12px}#${ROOT} .tp-compact-stage-wrap{flex-wrap:wrap;gap:2px 6px}#${ROOT} .tp-compact-action{grid-area:action;justify-self:start;min-height:27px;padding:3px 6px;font-size:10px}}
`;

// This constant never contains snapshot strings. It only changes presentation
// preferences; no data is fetched, recalculated, saved to files or sent to Planner.
const SCRIPT = `
(() => {
  const root = document.getElementById('task-progress-dashboard');
  if (!root) return;
  const viewChoices = [...root.querySelectorAll('[data-pref="view"]')];
  const themeChoices = [...root.querySelectorAll('[data-pref="theme"]')];
  const stages = root.querySelector('[data-pref="stages"]');
  if (!viewChoices.length || !themeChoices.length || !stages) return;
  const views = new Set(['bar', 'ring']);
  const themes = new Set(['night', 'light', 'indigo', 'forest']);
  const sync = () => {
    for (const choice of viewChoices) choice.setAttribute('aria-pressed', String(choice.dataset.value === root.dataset.view));
    for (const choice of themeChoices) choice.setAttribute('aria-pressed', String(choice.dataset.value === root.dataset.theme));
    stages.checked = root.dataset.showStages === 'true';
  };
  const apply = preferences => {
    if (!preferences || typeof preferences !== 'object' || Array.isArray(preferences)) return;
    if (views.has(preferences.view)) root.dataset.view = preferences.view;
    if (themes.has(preferences.theme)) root.dataset.theme = preferences.theme;
    if (typeof preferences.showStages === 'boolean') root.dataset.showStages = String(preferences.showStages);
    sync();
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
  root.addEventListener('click', event => {
    let choice = event.target;
    while (choice && choice !== root && !choice.getAttribute?.('data-pref')) choice = choice.parentElement;
    if (!choice || choice === root) return;
    const preference = choice.getAttribute('data-pref');
    const value = choice.dataset.value;
    if (preference === 'view' && views.has(value)) apply({ view: value });
    else if (preference === 'theme' && themes.has(value)) apply({ theme: value });
    else return;
    savePreferenceChange();
  });
  root.addEventListener('change', event => {
    if (event.target !== stages) return;
    apply({ showStages: stages.checked });
    savePreferenceChange();
  });
  sync();
  try { apply(window.openai?.widgetState?.privateContent?.taskProgressUI); } catch {}
  window.addEventListener('openai:set_globals', event => {
    try { apply(event.detail?.globals?.widgetState?.privateContent?.taskProgressUI); } catch {}
  });
})();
`;
const CONTROL_ICONS = {
  bar: '<path d="M4 7h16M4 12h16M4 17h16" opacity=".35"/><path d="M4 7h9M4 12h13M4 17h6"/>',
  ring: '<circle cx="12" cy="12" r="8" opacity=".35"/><path d="M12 4a8 8 0 1 1-7.73 10.07"/>',
  night: '<path d="M19.2 15.7A8.2 8.2 0 0 1 8.3 4.8 8.2 8.2 0 1 0 19.2 15.7Z"/><path d="M18 3v4m-2-2h4"/>',
  light: '<circle cx="12" cy="12" r="3.4"/><path d="M12 2v2m0 16v2M4.93 4.93l1.42 1.42m11.3 11.3 1.42 1.42M2 12h2m16 0h2M4.93 19.07l1.42-1.42m11.3-11.3 1.42-1.42"/>',
  indigo: '<path d="m12 2 1.9 7.1L21 11l-7.1 1.9L12 20l-1.9-7.1L3 11l7.1-1.9L12 2Z"/><path d="M19 17v4m-2-2h4"/>',
  forest: '<path d="M20 4c-7 0-13 2.1-14.8 7.3C3.8 15.5 6.3 19 10.4 19 17 19 20 11 20 4Z"/><path d="M5 20c3-4 6-6 11-9"/>'
};
function controlIcon(value) {
  return `<span class="tp-icon-badge" data-icon="${value}" aria-hidden="true"><svg class="tp-control-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" focusable="false">${CONTROL_ICONS[value]}</svg></span>`;
}
function disclosureAction() {
  return '<span class="tp-compact-action"><span class="tp-action-open">Подробнее</span><span class="tp-action-close">Свернуть</span><span class="tp-compact-chevron" aria-hidden="true"></span></span>';
}
function compactSummary(task, demo) {
  const fresh = task.freshness.state === 'fresh';
  const value = fresh ? currentValue(task) : null;
  const label = value ? task.acceptanceConfirmed ? '100%' : estimateText(task, value) : '?';
  const progressDescription = value ? `Прогресс: ${label}` : 'Текущий прогресс неизвестен';
  const taskState = fresh ? task.status === 'accepted' && !task.acceptanceConfirmed ? 'Приёмка не подтверждена' : STATUS_LABELS[task.status] ?? STATUS_LABELS.unknown : `Снимок: ${task.freshness.label}`;
  const state = demo ? `Демо · ${taskState}` : taskState;
  const style = value ? ` style="--tp-compact-progress:${value.min}%;--tp-compact-interval:${value.max}%"` : '';
  const stages = Array.isArray(task.stages) ? task.stages : [];
  const accepted = stages.filter(stage => stage.status === 'accepted').length;
  const stageCaption = stages.length ? `Этапы: ${accepted}/${stages.length} принято${fresh ? '' : ' по снимку'}` : 'Этапы не переданы';
  const nodes = stages.slice(0, 6).map((stage, index) => {
    const status = Object.hasOwn(STAGE_LABELS, stage.status) ? stage.status : 'unknown';
    const description = `Этап ${index + 1}: ${stage.label}. ${STAGE_LABELS[status]}${fresh ? '' : ' по снимку'}`;
    return `<span class="tp-compact-stage-node" role="listitem" data-status="${status}" aria-label="${text(description)}"><span class="tp-compact-stage-dot" aria-hidden="true">${index + 1}</span></span>`;
  }).join('');
  const rest = stages.length > 6 ? `<span class="tp-compact-stage-node tp-compact-stage-rest" role="listitem" aria-label="Ещё этапов: ${stages.length - 6}; полный список внутри"><span class="tp-compact-stage-dot" aria-hidden="true">+${stages.length - 6}</span></span>` : '';
  const graph = stages.length ? `<span class="tp-compact-stage-list${fresh ? '' : ' tp-compact-stale'}" role="list" aria-label="Этапы задачи">${nodes}${rest}</span>` : '';
  return `<summary class="tp-compact-summary"><span class="tp-compact-ring${value ? value.min === value.max ? '' : ' tp-compact-range' : ' tp-compact-unknown'}"${style} aria-hidden="true"><span>${text(label)}</span></span><span class="tp-compact-main"><strong class="tp-compact-title">${text(task.title)}</strong><span class="tp-compact-state">${text(state)}</span><span class="tp-compact-stage-wrap"><span class="tp-compact-stage-caption">${text(stageCaption)}</span>${graph}</span><span class="tp-compact-stages-off">Этапы скрыты</span></span><span class="tp-visually-hidden">${text(progressDescription)}.</span>${disclosureAction()}</summary>`;
}
function scopeSummary(report) {
  const scope = SCOPE_LABELS[report.selection.kind] ?? report.selection.kind;
  return `<summary class="tp-wide-summary"><span>${text(`Выбранная область: ${scope}`)} · задач: ${report.tasks.length}${report.demo ? ' · демо' : ''}</span>${disclosureAction()}</summary>`;
}
function renderControls(view, theme, stages) {
  const views = [['bar', 'Полоса'], ['ring', 'Круг']];
  const themes = [['night', 'Ночная'], ['light', 'Светлая'], ['indigo', 'Индиго'], ['forest', 'Лесная']];
  return `<div class="tp-controls" role="group" aria-label="Внешний вид прогресса"><div class="tp-control-group" data-group="view"><span class="tp-control-title">Вид прогресса</span><div class="tp-choice-group" role="group" aria-label="Вид прогресса">${views.map(([value, label]) => `<button type="button" class="tp-choice" data-pref="view" data-value="${value}" aria-pressed="${value === view}">${controlIcon(value)}<span>${label}</span></button>`).join('')}</div></div><div class="tp-control-group" data-group="theme"><span class="tp-control-title">Тема</span><div class="tp-choice-group" role="group" aria-label="Тема оформления">${themes.map(([value, label]) => `<button type="button" class="tp-theme-choice" data-pref="theme" data-value="${value}" aria-pressed="${value === theme}">${controlIcon(value)}<span>${label}</span></button>`).join('')}</div></div><label class="tp-stage-toggle"><input type="checkbox" role="switch" data-pref="stages"${stages ? ' checked' : ''}><span>Показывать этапы</span></label></div>`;
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
  const rows = report.tasks.length ? `<div class="tp-table" role="table" aria-label="Прогресс выбранных задач"><div class="tp-column-head${report.tasks.length === 1 ? ' tp-column-head-single' : ''}" role="row"><span role="columnheader">Задача</span><span role="columnheader">Прогресс</span><span role="columnheader">Состояние</span></div>${report.tasks.map(renderTask).join('')}</div>` : '<p class="tp-empty">Нет переданных задач. Прогресс неизвестен.</p>';
  const warnings = report.warnings.length ? `<section class="tp-warnings" aria-label="Предупреждения области"><ul>${report.warnings.map(warning => `<li>⚠ ${text(warning)}</li>`).join('')}</ul></section>` : '';
  const refs = [...new Set(report.tasks.filter(task => task.source).map(task => task.source.ref))];
  const compact = report.selection.kind === 'task' && report.tasks.length === 1;
  const summary = compact ? compactSummary(report.tasks[0], report.demo) : scopeSummary(report);
  return `<section id="${ROOT}" data-task-progress data-view="${view}" data-theme="${theme}" data-show-stages="${stages}" lang="ru" aria-label="${text(heading)}"><style>${STYLE}</style><details class="tp-dashboard-disclosure${compact ? ' tp-dashboard-single' : ''}"${compact ? '' : ' open'}>${summary}<div class="tp-expanded"><header class="tp-header"><div><p class="tp-kicker">Пульт задач</p><h2>${text(heading)}</h2>${report.demo ? '<p class="tp-demo">Демонстрация · синтетические данные, не текущий прогресс рабочих проектов.</p>' : ''}</div><p class="tp-meta"><span>Показ: ${text(report.renderedAt)}</span><span>Порог свежести: ${text(report.staleAfterMinutes)} мин.</span></p></header>${renderControls(view, theme, stages)}${selected}${rows}${renderAggregate(report.aggregate)}${warnings}<footer class="tp-footer"><p>Источники: ${refs.length ? refs.map(text).join(' · ') : 'не переданы'}. Полные evidence — в подробностях задач.</p><p>Оценка относится только к выбранной области и времени. Evidence переданы источником; renderer их внешне не проверяет.</p></footer></div></details><script>${SCRIPT}</script></section>\n`;
}
