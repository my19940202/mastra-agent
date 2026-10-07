/** Tests compact agent replies, suspended questions, and empty-result errors. */
import assert from 'node:assert/strict';
import test from 'node:test';
import { getMiniappAgentError, toMiniappAgentResponse } from '../src/mastra/miniapp-agent-route.ts';

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
