#!/usr/bin/env node
import { open, lstat, realpath } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { ContractError, buildReport, renderMarkdown, escapeMarkdown } from './core.mjs';
import { renderHtml, escapeHtml } from './render-html.mjs';

export const MAX_BYTES = 262144;
export const MAX_HTML_BYTES = 1000000;
function fail(message, code) { throw new ContractError(message, code); }
function checkPath(file) {
  if (/^(?:[a-z]+:\/\/|[\\/]{2})/i.test(file)) fail('Разрешён только явно выбранный локальный safe JSON', 'UNSAFE_PATH');
  const segments = file.split(/[\\/]+/);
  if (!/\.safe\.json$/i.test(file) || segments.some(segment => /^(?:\.env(?:\..*)?|\.git|\.ssh|credentials|secrets|STATE(?:\..*)?|NEXT(?:\..*)?)$/i.test(segment))) {
    fail('Нужен отдельный *.safe.json; секреты, STATE/NEXT и служебные каталоги не читаются', 'UNSAFE_PATH');
  }
}
export async function readSafeJson(file) {
  checkPath(file);
  const resolved = path.resolve(file);
  checkPath(resolved);
  const entry = await lstat(resolved);
  if (entry.isSymbolicLink() || !entry.isFile()) fail('Ожидается обычный локальный файл, без символьной ссылки', 'UNSAFE_PATH');
  const canonical = await realpath(resolved); checkPath(canonical);
  const handle = await open(canonical, 'r');
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size > MAX_BYTES) fail('Safe snapshot превышает 256 КиБ или не является файлом', 'INPUT_TOO_LARGE');
    // Fixed-size read bounds allocation even if the file grows after stat().
    const buffer = Buffer.alloc(MAX_BYTES + 1);
    let read = 0;
    while (read < buffer.length) {
      const part = await handle.read(buffer, read, buffer.length - read, null);
      if (!part.bytesRead) break;
      read += part.bytesRead;
    }
    if (read > MAX_BYTES) fail('Safe snapshot превышает 256 КиБ', 'INPUT_TOO_LARGE');
    return parseJson(buffer.subarray(0, read).toString('utf8'));
  } finally { await handle.close(); }
}
export function parseJson(text) {
  try { return JSON.parse(text.replace(/^\uFEFF/, '')); }
  catch { fail('Safe snapshot содержит некорректный JSON', 'INVALID_JSON'); }
}
async function readStdin(stream) {
  const chunks = []; let size = 0;
  for await (const chunk of stream) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += bytes.length;
    if (size > MAX_BYTES) fail('Safe snapshot превышает 256 КиБ', 'INPUT_TOO_LARGE');
    chunks.push(bytes);
  }
  return parseJson(Buffer.concat(chunks).toString('utf8'));
}
export function parseArgs(args) {
  const result = { format: 'markdown', view: 'bar', theme: 'night', stages: 'show' }; const seen = new Set();
  for (let index = 0; index < args.length; index++) {
    const key = args[index];
    if (!['--input', '--stdin', '--task', '--tasks', '--scope', '--format', '--at', '--view', '--theme', '--stages', '--help'].includes(key) || seen.has(key)) fail('Неизвестный или повторный аргумент', 'INVALID_ARGUMENT');
    seen.add(key);
    if (key === '--stdin' || key === '--help') { result[key.slice(2)] = true; continue; }
    const value = args[++index];
    if (!value || value.startsWith('--')) fail('Пропущено значение аргумента', 'INVALID_ARGUMENT');
    result[key.slice(2)] = value;
  }
  if (result.help) return result;
  if (Boolean(result.input) === Boolean(result.stdin)) fail('Укажите ровно один источник: --input или --stdin', 'INVALID_ARGUMENT');
  if (![ 'markdown', 'json', 'html' ].includes(result.format)) fail('Формат: markdown, json или html', 'INVALID_ARGUMENT');
  if (!['bar', 'ring'].includes(result.view)) fail('Вид: bar или ring', 'INVALID_ARGUMENT');
  if (!['night', 'light', 'indigo', 'forest'].includes(result.theme)) fail('Тема: night, light, indigo или forest', 'INVALID_ARGUMENT');
  if (!['show', 'hide'].includes(result.stages)) fail('Этапы: show или hide', 'INVALID_ARGUMENT');
  if (result.format !== 'html' && ['--view', '--theme', '--stages'].some(key => seen.has(key))) fail('Вид, тема и переключатель этапов применимы к --format html', 'INVALID_ARGUMENT');
  if ([result.task, result.tasks, result.scope].filter(Boolean).length > 1) fail('Выберите только одну область', 'INVALID_ARGUMENT');
  return result;
}
export function selectedScope(args, snapshot) {
  if (args.task) return { kind: 'task', id: args.task };
  if (args.tasks) {
    const taskIds = args.tasks.split(',');
    const old = snapshot.selection;
    const same = old?.kind === 'tasks' && taskIds.length === old.taskIds?.length && taskIds.every(taskId => old.taskIds.includes(taskId));
    return { kind: 'tasks', id: same ? old.id : 'explicit-selection', taskIds };
  }
  if (args.scope) {
    const split = args.scope.indexOf(':'); const kind = args.scope.slice(0, split); const id = args.scope.slice(split + 1);
    if (split < 1 || !['project', 'portfolio', 'task'].includes(kind) || !id) fail('Область: task:id, project:id или portfolio:id', 'INVALID_ARGUMENT');
    return { kind, id };
  }
  return snapshot.selection;
}
export async function main(args, io = process) {
  let options;
  try {
    options = parseArgs(args);
    if (options.help) {
      io.stdout.write('Task Progress · read-only, offline\nnode render.mjs --input <file.safe.json> [--task <id> | --tasks <id,id> | --scope project:<id>] [--format markdown|json|html]\nnode render.mjs --stdin [--task <id>]\nHTML options: --view bar|ring --theme night|light|indigo|forest --stages show|hide\nHTML includes local appearance controls; Markdown remains the CLI default.\n--at <ISO timestamp> reproduces a dated snapshot; it does not refresh evidence.\n');
      return 0;
    }
    const snapshot = options.stdin ? await readStdin(io.stdin) : await readSafeJson(options.input);
    const report = buildReport(snapshot, { now: options.at, selection: selectedScope(options, snapshot) });
    const output = options.format === 'json' ? JSON.stringify(report, null, 2) + '\n' : options.format === 'html' ? renderHtml(report, { view: options.view, theme: options.theme, stages: options.stages === 'show' }) : renderMarkdown(report);
    if (options.format === 'html' && Buffer.byteLength(output, 'utf8') > MAX_HTML_BYTES) fail('Графический вывод превышает 1 МБ: выберите меньше задач или Markdown', 'HTML_TOO_LARGE');
    io.stdout.write(output);
    return 0;
  } catch (error) {
    const code = error instanceof ContractError ? error.code : 'INPUT_UNAVAILABLE';
    const message = error instanceof ContractError ? error.message : 'Выбранный safe snapshot недоступен для чтения';
    io.stdout.write(options?.format === 'html' ? `<p role="alert"><strong>Прогресс неизвестен</strong> · ${escapeHtml(message)}.</p>\n` : `**Прогресс неизвестен** · ${escapeMarkdown(message)}.\n`);
    io.stderr.write(JSON.stringify({ error: code, message }) + '\n');
    return 2;
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) process.exitCode = await main(process.argv.slice(2));
