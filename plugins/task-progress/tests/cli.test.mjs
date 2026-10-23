import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { Readable } from 'node:stream';
import { readSafeJson, main, parseArgs, MAX_BYTES } from '../skills/task-progress/scripts/render.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const temp = await mkdtemp(path.join(tmpdir(), 'task-progress-test-'));
after(async () => {
  const relative = path.relative(path.resolve(tmpdir()), path.resolve(temp));
  assert.ok(relative.startsWith('task-progress-test-') && !relative.includes(path.sep) && !path.isAbsolute(relative));
  await rm(temp, { recursive: true, force: true });
});
const example = path.join(root, 'examples', 'multiple.safe.json');
const script = path.join(root, 'skills', 'task-progress', 'scripts', 'render.mjs');
function memoryIO(input = '') { const output = { out: '', err: '' }; return { output, stdin: Readable.from([input]), stdout: { write: chunk => { output.out += chunk; } }, stderr: { write: chunk => { output.err += chunk; } } }; }
test('safe adapter reads explicit file only and leaves its exact bytes intact', async () => {
  const before = await readFile(example); const input = await readSafeJson(example); assert.equal(input.schemaVersion, 1); assert.deepEqual(await readFile(example), before);
});
test('non-safe paths, secret/service paths, STATE/NEXT and network paths are refused before reading', async () => {
  for (const file of ['.env', 'progress.json', 'STATE.safe.json', 'NEXT.safe.json', 'secrets/value.safe.json', '.env.safe.json', 'https://example.invalid/data.safe.json', '\\\\host\\data.safe.json', '//offline-probe.invalid/share/progress.safe.json']) {
    await assert.rejects(() => readSafeJson(file), error => error.code === 'UNSAFE_PATH');
  }
});
test('oversized safe JSON and non-regular input are refused', async () => {
  const file = path.join(temp, 'large.safe.json'); await writeFile(file, ' '.repeat(MAX_BYTES + 1)); await assert.rejects(() => readSafeJson(file), error => error.code === 'INPUT_TOO_LARGE');
  const directory = path.join(temp, 'directory.safe.json'); await mkdir(directory); await assert.rejects(() => readSafeJson(directory), error => error.code === 'UNSAFE_PATH');
});
test('BOM is supported; malformed JSON reports only a safe diagnostic', async () => {
  const file = path.join(temp, 'bom.safe.json'); await writeFile(file, '\uFEFF{"safe":true}'); assert.equal((await readSafeJson(file)).safe, true);
  await writeFile(file, '{"unclosed":'); await assert.rejects(() => readSafeJson(file), error => error.code === 'INVALID_JSON');
});
test('CLI native process selects one task and emits valid structured report', () => {
  const child = spawnSync(process.execPath, [script, '--input', example, '--task', 'demo-g2', '--format', 'json', '--at', '2026-10-21T12:10:00Z'], { encoding: 'utf8', timeout: 10000 });
  assert.equal(child.status, 0, child.stderr); const report = JSON.parse(child.stdout); assert.equal(report.tasks.length, 1); assert.equal(report.tasks[0].progress.min, 28); assert.equal(report.aggregate, null);
});
test('stdin works without shell interpolation or source-file writes', async () => {
  const io = memoryIO(await readFile(example, 'utf8')); assert.equal(await main(['--stdin', '--task', 'demo-package', '--format', 'json', '--at', '2026-10-21T12:10:00Z'], io), 0);
  assert.equal(JSON.parse(io.output.out).tasks[0].progress.max, 70); assert.equal(io.output.err, '');
});
test('stdin enforces the same size limit', async () => { const io = memoryIO(' '.repeat(MAX_BYTES + 1)); assert.equal(await main(['--stdin'], io), 2); assert.equal(JSON.parse(io.output.err).error, 'INPUT_TOO_LARGE'); });
test('invalid and unavailable inputs exit nonzero and never render fake zero', () => {
  const child = spawnSync(process.execPath, [script, '--input', path.join(temp, 'missing.safe.json')], { encoding: 'utf8', timeout: 10000 }); assert.equal(child.status, 2); assert.match(child.stdout, /неизвестен/); assert.doesNotMatch(child.stdout, /0%/); assert.equal(JSON.parse(child.stderr).error, 'INPUT_UNAVAILABLE');
});
test('contradictory or repeated arguments cannot silently change selection', () => {
  for (const args of [[], ['--stdin', '--input', 'a.safe.json'], ['--stdin', '--task', 'a', '--scope', 'project:p'], ['--stdin', '--format', 'svg'], ['--stdin', '--stdin'], ['--input']]) assert.throws(() => parseArgs(args));
});
test('HTML CLI uses the same selected report and keeps input bytes intact', async () => {
  const before = await readFile(example);
  const io = memoryIO(before.toString('utf8'));
  assert.equal(await main(['--stdin', '--task', 'demo-g2', '--format', 'html', '--at', '2026-10-21T12:10:00Z'], io), 0);
  assert.match(io.output.out, /28%/);
  assert.match(io.output.out, /demo-g2/);
  assert.doesNotMatch(io.output.out, /demo-package|<!doctype|<html\b/i);
  assert.equal(io.output.err, '');
  assert.deepEqual(await readFile(example), before);
});
test('HTML input errors stay unknown, escaped and nonzero', async () => {
  const io = memoryIO('{broken');
  assert.equal(await main(['--stdin', '--format', 'html'], io), 2);
  assert.match(io.output.out, /role="alert"/);
  assert.match(io.output.out, /Прогресс неизвестен/);
  assert.doesNotMatch(io.output.out, /0%|role="progressbar"/);
  assert.equal(JSON.parse(io.output.err).error, 'INVALID_JSON');
});
test('HTML CLI appearance options select ring, theme and initial stage visibility without changing data', async () => {
  const input = await readFile(example, 'utf8');
  const io = memoryIO(input);
  assert.equal(await main(['--stdin', '--task', 'demo-g2', '--format', 'html', '--view', 'ring', '--theme', 'light', '--stages', 'hide', '--at', '2026-10-21T12:10:00Z'], io), 0);
  assert.match(io.output.out, /data-view="ring"/);
  assert.match(io.output.out, /data-theme="light"/);
  assert.match(io.output.out, /28%/);
  assert.equal(io.output.err, '');
  assert.equal(input, await readFile(example, 'utf8'));
});
test('unknown appearance values and non-HTML appearance arguments are rejected', () => {
  for (const tail of [['--view','pie'],['--theme','<style>'],['--stages','maybe'],['--format','json','--view','ring'],['--format','markdown','--theme','light']]) {
    assert.throws(() => parseArgs(['--stdin', ...tail]));
  }
});
test('large escaped stage output fails safely before exceeding the inline fragment limit', async () => {
  const input = JSON.parse(await readFile(example, 'utf8'));
  input.selection = {kind:'project',id:'large'};
  input.aggregation = null;
  const seed = input.tasks[0];
  input.tasks = Array.from({length:9},(_,i) => ({...structuredClone(seed),id:`task-${i}`,projectId:'large',progress:{...structuredClone(seed.progress),scope:{kind:'task',id:`task-${i}`}},stages:{source:{ref:'test:stages',evidence:'Explicit stage evidence'},items:Array.from({length:40},(_,j)=>({id:`s-${j}`,label:'<'.repeat(200),status:'accepted',evidence:'<'.repeat(400)}))}}));
  const raw = JSON.stringify(input);
  assert.ok(Buffer.byteLength(raw)<MAX_BYTES, 'fixture must reach the HTML limit before the input limit');
  const io = memoryIO(raw);
  assert.equal(await main(['--stdin','--format','html','--at','2026-10-21T12:10:00Z'], io),2);
  assert.equal(JSON.parse(io.output.err).error,'HTML_TOO_LARGE');
  assert.match(io.output.out,/Прогресс неизвестен/);
  assert.doesNotMatch(io.output.out,/role="progressbar"/);
});
test('a multi-task selection shows only selected IDs and loses unrelated project aggregate', async () => {
  const io = memoryIO(await readFile(example, 'utf8')); assert.equal(await main(['--stdin', '--tasks', 'demo-g2,demo-unknown', '--format', 'json', '--at', '2026-10-21T12:10:00Z'], io), 0);
  const report = JSON.parse(io.output.out); assert.deepEqual(report.tasks.map(task => task.id), ['demo-g2', 'demo-unknown']); assert.equal(report.aggregate.progress, null);
});
test('portable and installed-client compatibility manifest agree; declared skill and assets exist', async () => {
  const portable = JSON.parse(await readFile(path.join(root, 'plugin.json'), 'utf8'));
  const compatibility = JSON.parse(await readFile(path.join(root, '.codex-plugin', 'plugin.json'), 'utf8'));
  assert.equal(portable.name, compatibility.name); assert.equal(portable.version, compatibility.version); assert.deepEqual(portable.extensions['com.openai'].interface, compatibility.interface);
  const skill = await readFile(path.join(root, 'skills', 'task-progress', 'SKILL.md'), 'utf8'); assert.match(skill, /^---\nname: task-progress\n/);
  assert.ok((await readFile(path.join(root, compatibility.interface.logo))).length > 0); assert.equal(compatibility.skills, './skills/');
  assert.equal(compatibility.hooks, undefined); assert.equal(compatibility.apps, undefined); assert.equal(compatibility.mcpServers, undefined);
});
