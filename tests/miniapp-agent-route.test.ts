/** Tests compact agent replies, suspended questions, and empty-result errors. */
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  getMiniappAgentError,
  getMiniappLeadCardEligibility,
  toMiniappAgentResponse,
  withMiniappTimingSpan,
} from '../src/mastra/miniapp-agent-route.ts';

test('empty tool-call result is reported as retryable instead of a blank reply', () => {
  assert.match(getMiniappAgentError({ text: '', finishReason: 'tool-calls' }) ?? '', /重试/);
  assert.equal(getMiniappAgentError({ text: '已有回答', finishReason: 'tool-calls' }), null);
  assert.equal(getMiniappAgentError({ text: '', finishReason: 'suspended' }), null);
});

test('normal replies expose only the four mini program fields', () => {
  const result = toMiniappAgentResponse({
    text: '已了解你的情况。',
    finishReason: 'stop',
    runId: 'run-1',
    steps: [{ reasoning: 'internal' }],
    reasoningText: 'internal',
  } as Parameters<typeof toMiniappAgentResponse>[0]);

  assert.deepEqual(result, {
    text: '已了解你的情况。',
    finishReason: 'stop',
    runId: 'run-1',
    suspendPayload: null,
  });
});

test('a suspended question remains usable when text is empty', () => {
  const question = {
    toolName: 'ask_user',
    toolCallId: 'call-1',
    suspendPayload: { question: '是否共同生活？' },
  };
  assert.deepEqual(toMiniappAgentResponse({
    text: '',
    finishReason: 'suspended',
    runId: 'run-2',
    suspendPayload: question,
  }), {
    text: '',
    finishReason: 'suspended',
    runId: 'run-2',
    suspendPayload: question,
  });
});

test('a suspended question hides model text produced before ask_user', () => {
  const question = {
    toolName: 'ask_user',
    toolCallId: 'call-2',
    suspendPayload: { question: '你们登记结婚大约多久了？' },
  };
  assert.deepEqual(toMiniappAgentResponse({
    text: "I'll start by setting up the case record.",
    finishReason: 'suspended',
    runId: 'run-3',
    suspendPayload: question,
  }), {
    text: '',
    finishReason: 'suspended',
    runId: 'run-3',
    suspendPayload: question,
  });
});

test('eligible replies add a contact card without changing agent output fields', () => {
  const result = toMiniappAgentResponse({ text: '继续了解你的情况。', finishReason: 'stop' }, true);
  assert.deepEqual(result.leadCard, { type: 'lawyer_contact' });
  assert.equal(result.text, '继续了解你的情况。');
});

test('lead-card reads start concurrently and produce the same eligibility result', async () => {
  const started = new Set<string>();
  let resolveWorkingMemory!: (value: string | null) => void;
  let resolveRecall!: (value: { messages: Array<{ role: string }> }) => void;
  const memory = {
    getWorkingMemory() {
      started.add('working-memory');
      return new Promise<string | null>(resolve => { resolveWorkingMemory = resolve; });
    },
    getThreadById() {
      started.add('lead-state');
      return Promise.resolve({ metadata: { legalLeadCard: { status: 'declined' } } });
    },
    recall() {
      started.add('turn-count');
      return new Promise<{ messages: Array<{ role: string }> }>(resolve => { resolveRecall = resolve; });
    },
  } as Parameters<typeof getMiniappLeadCardEligibility>[0];

  const pending = getMiniappLeadCardEligibility(memory, { thread: 'thread-1', resource: 'resource-1' });
  assert.deepEqual([...started].sort(), ['lead-state', 'turn-count', 'working-memory']);
  resolveWorkingMemory(null);
  resolveRecall({ messages: [{ role: 'user' }, { role: 'user' }, { role: 'user' }] });
  assert.equal(await pending, false);
});

test('timing spans record only success state, not operation values', async () => {
  const records: unknown[] = [];
  const parent = {
    createChildSpan(options: unknown) {
      records.push({ options });
      return { end: (result: unknown) => records.push(result) };
    },
  } as unknown as Parameters<typeof withMiniappTimingSpan>[0];

  const sensitiveResult = '案件事实不应进入 telemetry';
  assert.equal(await withMiniappTimingSpan(parent, 'test-stage', async () => sensitiveResult), sensitiveResult);
  assert.deepEqual(records, [
    { options: { name: 'test-stage', type: 'generic' } },
    { output: { ok: true } },
  ]);
  assert.doesNotMatch(JSON.stringify(records), /案件事实/);
});
