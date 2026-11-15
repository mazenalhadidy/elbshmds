// The Claude request: checked on the exact HTTP body the SDK sends (fake fetch, no API key, no cost).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import Anthropic from '@anthropic-ai/sdk';
import { runTask, validate, buildRequest, costOf, TASKS, RULES, AiError } from '../lib/ai.js';
import { sameKey } from '../lib/http.js';

function fakeClient(answer, { stop = 'end_turn', status = 200 } = {}) {
  const calls = [];
  const fetch = async (url, init) => {
    calls.push({ url: String(url), headers: Object.fromEntries(new Headers(init.headers)), body: JSON.parse(init.body) });
    const body = status === 200
      ? { id: 'msg_1', type: 'message', role: 'assistant', model: calls.at(-1).body.model, stop_reason: stop, content: [{ type: 'text', text: JSON.stringify(answer) }], usage: { input_tokens: 100, output_tokens: 20, cache_read_input_tokens: 1000, cache_creation_input_tokens: 0 } }
      : { type: 'error', error: { type: 'rate_limit_error', message: 'slow down' } };
    return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  };
  return { client: new Anthropic({ apiKey: 'test', fetch, maxRetries: 0 }), calls };
}

const IMG = 'iVBORw0KGgo=';
const imageAnswer = { is_transfer: true, kind: 'sent', amount: 500, confidence: 0.9, unclear: false, app: 'InstaPay', ref: '123', summary: 'تحويل', why: 'إيصال من المحل' };

test('image task: cached system rules + training, JSON schema output, low effort, no sampling params', async () => {
  const { client, calls } = fakeClient(imageAnswer);
  const out = await runTask(client, { task: 'image', training: 'قواعد:\n1. "وصل" = تأكيد', input: 'من المحل', image: IMG });
  assert.deepEqual(out.data, imageAnswer);
  const { body, url } = calls[0];
  assert.match(url, /\/v1\/messages$/);
  assert.equal(body.model, 'claude-haiku-5-5');
  assert.equal(body.system[0].text, RULES);
  assert.equal(body.system.at(-1).cache_control.type, 'ephemeral');           // breakpoint after the training
  assert.equal(body.system[0].cache_control, undefined);
  assert.equal(body.output_config.effort, 'low');
  assert.equal(body.output_config.format.type, 'json_schema');
  assert.deepEqual(body.output_config.format.schema, TASKS.image.schema);
  assert.equal(body.temperature, undefined);                                     // rejected by the 5.5 models
  assert.equal(body.messages[0].content[0].type, 'image');
  assert.ok(out.cost > 0 && out.cost < 0.001);
});

test('strong tier asks for server-side fallback on the beta endpoint', async () => {
  const { client, calls } = fakeClient({ summary: 'x' });
  await runTask(client, { task: 'merge', tier: 'strong', input: 'a' });
  assert.equal(calls[0].body.model, 'claude-sonnet-5-5');
  assert.equal(calls[0].body.fallbacks, 'default');
  assert.match(calls[0].headers['anthropic-beta'], /server-side-fallback-2026-07-01/);
  assert.equal(calls[0].body.betas, undefined);                                  // sent as a header, not in the body
});

test('refusal and truncation become clear errors; API errors keep their status', async () => {
  await assert.rejects(runTask(fakeClient({}, { stop: 'refusal' }).client, { task: 'text', input: 'x' }), e => e instanceof AiError && e.status === 422);
  await assert.rejects(runTask(fakeClient({}, { stop: 'max_tokens' }).client, { task: 'text', input: 'x' }), e => e.status === 502);
  await assert.rejects(runTask(fakeClient({}, { status: 429 }).client, { task: 'text', input: 'x' }), e => e.status === 429);
});

test('only known tasks with sane sizes are accepted (not an open relay)', () => {
  assert.throws(() => validate({ task: 'anything', input: 'x' }), /bad task/);
  assert.throws(() => validate({ task: 'text', tier: 'opus', input: 'x' }), /bad tier/);
  assert.throws(() => validate({ task: 'image', input: 'x' }), /image missing/);
  assert.throws(() => validate({ task: 'image', image: 'not base64!' }), /bad image/);
  assert.throws(() => validate({ task: 'text', input: 'x'.repeat(200_000) }), /bad input/);
});

test('no training: the breakpoint sits on the rules; schemas are strict', () => {
  const r = buildRequest(validate({ task: 'text', input: 'x' }));
  assert.equal(r.system.length, 1);
  assert.equal(r.system[0].cache_control.type, 'ephemeral');
  const strict = s => s.type !== 'object' || (s.additionalProperties === false && Object.keys(s.properties).every(k => s.required.includes(k)) && Object.values(s.properties).every(p => strict(p.items || p)));
  for (const t of Object.values(TASKS)) assert.ok(strict(t.schema));
});

test('cost counts cache reads at the cheap rate', () => {
  const full = costOf('claude-haiku-5-5', { input_tokens: 10_000 }), cached = costOf('claude-haiku-5-5', { cache_read_input_tokens: 10_000 });
  assert.ok(cached < full / 5);
});

test('password check', () => {
  assert.ok(sameKey('secret-1', 'secret-1'));
  assert.ok(!sameKey('secret-2', 'secret-1'));
  assert.ok(!sameKey('', ''));                                                  // no password configured = locked
});
