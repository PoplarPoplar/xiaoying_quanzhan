import assert from 'node:assert/strict';
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

// Real API smoke: creates only new anonymous demo data; never clears existing data.
const base = (process.argv[2] || 'http://localhost:3000').replace(/\/$/, '');
const origin = process.env.SMOKE_ORIGIN || new URL(base).origin;
const passed = [];
const startedAt = new Date().toISOString();
function saveReport(status, error) {
  if (!process.env.SMOKE_REPORT_PATH) return;
  const output = path.resolve(process.env.SMOKE_REPORT_PATH);
  mkdirSync(path.dirname(output), { recursive: true });
  writeFileSync(output, JSON.stringify({ status, base, startedAt, finishedAt: new Date().toISOString(), passed, error }, null, 2));
}
process.on('uncaughtExceptionMonitor', error => saveReport('failed', error.stack || String(error)));
const mark = message => { passed.push(message); console.log(`PASS ${message}`); };
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
function crc32(bytes) {
  let crc = -1;
  for (const byte of bytes) { crc ^= byte; for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1)); }
  return (crc ^ -1) >>> 0;
}
function chunk(type, data) {
  const name = Buffer.from(type), size = Buffer.alloc(4), crc = Buffer.alloc(4);
  size.writeUInt32BE(data.length); crc.writeUInt32BE(crc32(Buffer.concat([name, data])));
  return Buffer.concat([size, name, data, crc]);
}
function png() {
  const header = Buffer.alloc(13); header.writeUInt32BE(2); header.writeUInt32BE(2, 4); header[8] = 8; header[9] = 2;
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), chunk('IHDR', header), chunk('IDAT', deflateSync(Buffer.from([0,255,80,120,60,120,255,0,80,220,160,255,200,60]))), chunk('IEND', Buffer.alloc(0))]);
}
function client() {
  let cookie = '';
  return async (path, { method = 'GET', body, status = 200, binary = false, externalOrigin } = {}) => {
    const headers = { Origin: externalOrigin || origin };
    if (cookie) headers.Cookie = cookie;
    if (body && !(body instanceof FormData)) { headers['Content-Type'] = 'application/json'; body = JSON.stringify(body); }
    const response = await fetch(base + path, { method, body, headers, signal: AbortSignal.timeout(15000) });
    const setCookie = response.headers.get('set-cookie'); if (setCookie) cookie = setCookie.split(';')[0];
    const raw = binary ? new Uint8Array(await response.arrayBuffer()) : await response.text();
    assert.equal(response.status, status, `${method} ${path}: ${response.status} ${binary ? '' : raw}`);
    return binary ? raw : raw ? JSON.parse(raw) : null;
  };
}
const a = client(), b = client();
await a('/api/ping'); mark('Java API reachable through configured entry');
await a('/api/me', { status: 401 });
const userA = await a('/api/session', { method: 'POST' });
const userB = await b('/api/session', { method: 'POST' });
assert.notEqual(userA.id, userB.id); mark('anonymous users isolated; missing session rejected');
const templates = await a('/api/templates'); assert.ok(templates.length >= 2);
const template = await a('/api/templates/' + templates[0].id);
const categories = await a('/api/categories'); assert.ok(categories.length >= 2);
const filtered = await a('/api/templates?categoryId=' + encodeURIComponent(categories[0].id));
assert.ok(filtered.every(item => String(item.categoryId) === String(categories[0].id)));
await a('/api/templates/does-not-exist', { status: 404 }); mark('real template list, detail, category filter, missing template');
const assetIds = [];
for (let index = 0; index < template.requiredImageCount; index++) {
  const form = new FormData(); form.set('file', new Blob([png()], { type: 'image/png' }), 'smoke.png'); form.set('templateId', template.id);
  const asset = await a('/api/assets', { method: 'POST', body: form, status: 201 });
  const bytes = await a(asset.previewUrl, { binary: true }); assert.ok(bytes.length > 0);
  await b(asset.previewUrl, { status: 404 }); assetIds.push(asset.id);
}
const badForm = new FormData(); badForm.set('file', new Blob(['not an image'], {type: 'image/png'}), 'fake.png'); badForm.set('templateId', template.id);
await a('/api/assets', { method: 'POST', body: badForm, status: 415 }); mark('real PNG stored/read; foreign media and forged PNG rejected');
await a('/api/tasks', { method: 'POST', body: {templateId: template.id, assetIds: []}, status: 400 });
await b('/api/tasks', { method: 'POST', body: {templateId: template.id, assetIds}, status: 404 });
await a('/api/session', { method: 'POST', externalOrigin: 'https://untrusted.invalid', status: 403 }); mark('invalid inputs, foreign assets and foreign Origin rejected');
const stages = ['CHECK_ASSETS', 'GENERATE', 'PACKAGE_RESULT'];
async function create(failAt = 'NONE', delay = 100) {
  return a('/api/tasks', { method: 'POST', status: 202, body: {templateId: template.id, assetIds, simulation: {failAt, delaysMs: Object.fromEntries(stages.map(stage => [stage, delay]))}} });
}
async function terminal(id) {
  const deadline = Date.now() + 45000;
  while (Date.now() < deadline) {
    const task = await a('/api/tasks/' + id);
    if (['SUCCEEDED', 'FAILED'].includes(task.status)) return task;
    await pause(100);
  }
  throw new Error('Task did not finish: ' + id);
}
const first = await create('NONE', 600), second = await create('GENERATE', 100);
assert.notEqual(first.id, second.id); assert.ok(['QUEUED','RUNNING'].includes(first.status));
const active = await a('/api/tasks/active');
assert.ok((Array.isArray(active) ? active : active.items).some(task => task.id === first.id));
await b('/api/tasks/' + first.id, {status:404});
const success = await terminal(first.id), failure = await terminal(second.id);
assert.equal(success.status, 'SUCCEEDED'); assert.ok(success.steps.every(step => step.status === 'SUCCEEDED'));
assert.equal(failure.status, 'FAILED'); assert.equal(failure.failedStage, 'GENERATE'); assert.equal(failure.steps[2].status, 'PENDING');
assert.ok((await a(success.resultUrl, {binary:true})).length > 0); await b(success.resultUrl, {status:404});
const repeated = await a('/api/tasks/' + first.id); assert.equal(repeated.version, success.version); mark('async acceptance, multiple task IDs, active recovery, success/result, failure isolation and read-only terminal queries');
for (const stage of ['CHECK_ASSETS', 'PACKAGE_RESULT']) {
  const task = await create(stage), done = await terminal(task.id);
  assert.equal(done.status, 'FAILED'); assert.equal(done.failedStage, stage);
  for (let i = stages.indexOf(stage) + 1; i < stages.length; i++) assert.equal(done.steps[i].status, 'PENDING');
}
mark('each of three failure stages interrupts later steps');
const history = await a('/api/tasks'); assert.ok(history.items.some(task => task.id === first.id));
const foreignHistory = await b('/api/tasks'); assert.equal(foreignHistory.items.length, 0);
const inactive = await a('/api/tasks/active'); assert.equal((Array.isArray(inactive) ? inactive : inactive.items).length, 0);
mark('history restored from Java; other user cannot see records; finished tasks no longer active');
console.log(JSON.stringify({passed:passed.length, base, userData:'new anonymous demo sessions only'}, null, 2));


saveReport('passed');

