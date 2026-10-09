/** Verifies that server history keeps visible conversation content only. */
import assert from 'node:assert/strict';
import test from 'node:test';
import { visibleHistory } from '../src/mastra/consultation-history';

test('history preserves user text and questions while omitting internal tool output', () => {
  const messages = visibleHistory([
    { id: '1', role: 'user', content: { parts: [{ type: 'text', text: '想咨询离婚' }] } },
    { id: '2', role: 'assistant', content: { parts: [
      { type: 'reasoning', text: 'internal' },
      { type: 'tool-invocation', toolInvocation: { toolName: 'updateWorkingMemory', args: { memory: 'private internal state' } } },
      { type: 'tool-invocation', toolInvocation: { toolName: 'ask_user', args: { question: '是否有孩子？', options: ['有', '没有'] } } },
    ] } },
    { id: '3', role: 'tool', content: 'internal result' },
  ] as any);
  assert.deepEqual(messages.map(message => message.text), ['想咨询离婚', '是否有孩子？\n有\n没有']);
  assert.deepEqual(visibleHistory([]), []);
});
