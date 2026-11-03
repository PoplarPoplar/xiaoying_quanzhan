import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

// Disposable verification project only. Never removes volumes, including on failure.
const root = fileURLToPath(new URL('../', import.meta.url));
const project = process.env.COMPOSE_PROJECT_NAME || `xiaoying-verify-${Date.now()}`;
assert.match(project, /^xiaoying-verify-[a-z0-9-]+$/, 'Use a unique xiaoying-verify-* project, never the application project');
const base = (process.env.VERIFY_BASE_URL || `http://localhost:${process.env.FRONTEND_PORT || 3000}`).replace(/\/$/, '');
const origin = new URL(base).origin;
const env = { ...process.env, COMPOSE_PROJECT_NAME: project, APP_ORIGIN: origin };
const out = path.resolve(root, process.env.VERIFY_OUTPUT_DIR || 'artifacts/containers');
mkdirSync(out, { recursive: true });
const report = { project, base, startedAt: new Date().toISOString(), checks: [], status: 'running' };
const compose = ['compose', '-p', project];
let ownsProject = false;
const hash = value => createHash('sha256').update(value).digest('hex');
function run(args, capture = false) {
  const result = spawnSync('docker', args, { cwd: root, env, encoding: 'utf8', stdio: capture ? 'pipe' : 'inherit', maxBuffer: 32 * 1024 * 1024 });
  if (result.error) throw result.error;
  assert.equal(result.status, 0, `docker ${args.join(' ')} failed${capture ? ': ' + result.stderr : ''}`);
  return result.stdout?.trim() || '';
}
function check(name, details = {}) { report.checks.push({ name, ...details }); console.log(`PASS ${name}`); }
function diagnostics(suffix) {
  for (const [name, args] of [['logs', ['logs', '--no-color']], ['ps', ['ps', '--all', '--format', 'json']]]) {
    const result = spawnSync('docker', [...compose, ...args], { cwd: root, env, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
    writeFileSync(path.join(out, `${suffix}-${name}.txt`), (result.stdout || '') + (result.stderr || ''));
  }
}
function fullSmoke(phase) {
  const smoke = spawnSync(process.execPath, ['scripts/smoke.mjs', base], { cwd: root, env: { ...env, SMOKE_REPORT_PATH: path.join(out, `${phase}-api-smoke.json`) }, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 });
  writeFileSync(path.join(out, `${phase}-api-smoke.log`), (smoke.stdout || '') + (smoke.stderr || ''));
  process.stdout.write(smoke.stdout || ''); process.stderr.write(smoke.stderr || '');
  assert.equal(smoke.status, 0, `${phase} full API smoke failed`);
}
let cookie = '';
async function api(route, { method = 'GET', body, status = 200, binary = false } = {}) {
  const headers = { Origin: origin };
  if (cookie) headers.Cookie = cookie;
  if (body && !(body instanceof FormData)) { headers['Content-Type'] = 'application/json'; body = JSON.stringify(body); }
  const response = await fetch(base + route, { method, headers, body, signal: AbortSignal.timeout(20000) });
  const set = response.headers.get('set-cookie'); if (set) cookie = set.split(';')[0];
  const data = binary ? Buffer.from(await response.arrayBuffer()) : await response.text();
  assert.equal(response.status, status, `${method} ${route}: ${response.status} ${binary ? '' : data}`);
  return binary ? data : data ? JSON.parse(data) : null;
}
function databaseSnapshot() {
  return run([...compose, 'exec', '-T', 'mysql', 'sh', '-c', 'MYSQL_PWD="$MYSQL_PASSWORD" mysql -u "$MYSQL_USER" "$MYSQL_DATABASE" -N -B -e "SELECT COUNT(*) FROM material_template; SELECT COUNT(*) FROM flyway_schema_history WHERE success=1;"'], true);
}
try {
  // A unique project is mandatory: refuse to touch pre-existing volumes or containers.
  assert.equal(run(['ps', '-aq', '--filter', `label=com.docker.compose.project=${project}`], true), '', 'Project already has containers');
  assert.equal(run(['volume', 'ls', '-q', '--filter', `label=com.docker.compose.project=${project}`], true), '', 'Project already has data volumes');
  ownsProject = true;
  run([...compose, 'config', '--quiet']);
  run([...compose, 'build']);
  run([...compose, 'up', '-d', '--wait', '--wait-timeout', '300']);
  check('fresh project built and all three services healthy');
  fullSmoke('before-recreate');
  check('fresh container API smoke passed');
  const user = await api('/api/session', { method: 'POST' });
  const templates = await api('/api/templates');
  const template = await api('/api/templates/' + templates[0].id);
  const cover = await api(template.coverUrl, { binary: true });
  const assets = [];
  for (let index = 0; index < template.requiredImageCount; index++) {
    const form = new FormData(); form.set('templateId', template.id); form.set('file', new Blob([cover], { type: 'image/png' }), 'persistence.png');
    const asset = await api('/api/assets', { method: 'POST', body: form, status: 201 });
    assets.push({ id: asset.id, previewUrl: asset.previewUrl, sha256: hash(await api(asset.previewUrl, { binary: true })) });
  }
  const accepted = await api('/api/tasks', { method: 'POST', body: { templateId: template.id, assetIds: assets.map(asset => asset.id), simulation: { failAt: 'NONE', delaysMs: { CHECK_ASSETS: 0, GENERATE: 0, PACKAGE_RESULT: 0 } } }, status: 202 });
  let task;
  const deadline = Date.now() + 30000;
  do {
    task = await api('/api/tasks/' + accepted.id);
    if (['SUCCEEDED', 'FAILED'].includes(task.status)) break;
    await new Promise(resolve => setTimeout(resolve, 100));
  } while (Date.now() < deadline);
  assert.equal(task.status, 'SUCCEEDED');
  const resultHash = hash(await api(task.resultUrl, { binary: true }));
  const databaseBefore = databaseSnapshot();
  const volumeNames = run(['volume', 'ls', '-q', '--filter', `label=com.docker.compose.project=${project}`], true).split('\n').sort();
  assert.equal(volumeNames.length, 2, 'Database and media must each have a persistent volume');
  const containerIds = run([...compose, 'ps', '-q'], true).split('\n').sort();
  diagnostics('before-recreate');
  // Stronger than restart: remove containers, retain named volumes, recreate every service.
  run([...compose, 'down']);
  assert.deepEqual(run(['volume', 'ls', '-q', '--filter', `label=com.docker.compose.project=${project}`], true).split('\n').sort(), volumeNames);
  run([...compose, 'up', '-d', '--wait', '--wait-timeout', '300']);
  assert.notDeepEqual(run([...compose, 'ps', '-q'], true).split('\n').sort(), containerIds);
  assert.equal((await api('/api/me')).id, user.id, 'Original cookie/session must recover same identity');
  const restored = await api('/api/tasks/' + task.id);
  assert.deepEqual(restored, task, 'Successful task snapshot must survive without state/version changes');
  assert.ok((await api('/api/tasks')).items.some(item => item.id === task.id));
  for (const asset of assets) assert.equal(hash(await api(asset.previewUrl, { binary: true })), asset.sha256);
  assert.equal(hash(await api(task.resultUrl, { binary: true })), resultHash);
  assert.deepEqual(await api('/api/templates'), templates, 'No duplicated or changed seed templates');
  assert.equal(databaseSnapshot(), databaseBefore, 'Template count/migration count must not change');
  check('containers recreated with same identity, history, task snapshot, exact uploaded/result bytes and seeds', { taskId: task.id, resultSha256: resultHash, assetSha256: assets.map(asset => asset.sha256), volumes: volumeNames, databaseCountsBeforeAndAfter: databaseBefore });
  fullSmoke('after-recreate');
  check('recreated container full API smoke passed');
  report.status = 'passed';
} catch (error) {
  report.status = 'failed'; report.error = error.stack || String(error); process.exitCode = 1;
} finally {
  if (ownsProject) {
    diagnostics('final');
    try { run([...compose, 'down']); } catch (error) { report.cleanupError = String(error); process.exitCode = 1; report.status = 'failed'; }
  }
  report.finishedAt = new Date().toISOString();
  report.volumesRemoved = false;
  writeFileSync(path.join(out, 'results.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
}

