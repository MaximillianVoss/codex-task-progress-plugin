import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, stat, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const readJson = async relative => JSON.parse(await readFile(path.join(root, relative), 'utf8'));
test('marketplace resolves within the repository to a complete plugin', async () => {
  const catalog = await readJson('.agents/plugins/marketplace.json');
  assert.equal(catalog.name, 'task-progress-local'); assert.equal(catalog.plugins.length, 1);
  const entry = catalog.plugins[0]; assert.equal(entry.name, 'task-progress'); assert.equal(entry.source.source, 'local');
  const plugin = path.resolve(root, entry.source.path); assert.ok(plugin.startsWith(root));
  assert.ok((await stat(path.join(plugin, 'skills/task-progress/SKILL.md'))).isFile());
  assert.ok((await stat(path.join(plugin, '.codex-plugin/plugin.json'))).isFile());
});
test('repository/plugin/compatibility versions agree and pin the documented release', async () => {
  const repository = await readJson('package.json'); const plugin = await readJson('plugins/task-progress/plugin.json');
  const compatibility = await readJson('plugins/task-progress/.codex-plugin/plugin.json'); const npm = await readJson('plugins/task-progress/package.json');
  assert.equal(repository.version, '1.6.1'); assert.equal(plugin.version, repository.version); assert.equal(compatibility.version, plugin.version); assert.equal(npm.version, plugin.version);
  const readme = await readFile(path.join(root, 'README.md'), 'utf8'); assert.ok(readme.includes('--branch v' + repository.version));
});
test('release receipt builder excludes machine paths and does not claim installation', async () => {
  const builder = await readFile(path.join(root, 'scripts/Build-Release.ps1'), 'utf8');
  assert.ok(builder.includes('file = $archiveName')); assert.ok(builder.includes('installedByBuild = $false')); assert.ok(builder.includes('nativeCodexRenderingCheckedByBuild = $false'));
  assert.ok(!builder.includes('sourceRoot =')); assert.ok(!builder.includes('archive = $ready.archive'));
});
test('portable source excludes developer receipts, credentials and nested workspaces', async () => {
  const skill = await readFile(path.join(root, 'plugins/task-progress/skills/task-progress/SKILL.md'), 'utf8');
  assert.ok(skill.includes('references/contract.md')); assert.ok((await stat(path.join(root, 'plugins/task-progress/skills/task-progress/references/contract.md'))).isFile());
  const entries = await readdir(path.join(root, 'plugins/task-progress'));
  assert.ok(!entries.includes('root-install-20261021')); assert.ok(!entries.includes('.env'));
  const ignores = await readFile(path.join(root, '.gitignore'), 'utf8'); assert.ok(ignores.includes('plugins/task-progress/evidence/')); assert.ok(ignores.includes('/snapshots/'));
});
