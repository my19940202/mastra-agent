/** Exposes server-stored conversations as read-only visible messages for the mini program. */
import { registerApiRoute } from '@mastra/core/server';
import type { MastraDBMessage } from '@mastra/core/memory';

export function visibleHistory(messages: MastraDBMessage[]) {
  return messages.flatMap(message => {
    if (message.role !== 'user' && message.role !== 'assistant') return [];
    const content = message.content as any;
    const parts = Array.isArray(content?.parts) ? content.parts : [];
    const texts = parts.filter((part: any) => part.type === 'text').map((part: any) => part.text || '');
    const questions = parts.flatMap((part: any) => {
      const call = part.toolInvocation;
      if (call?.toolName !== 'ask_user') return [];
      const args = call.args;
      if (typeof args?.question !== 'string') return [];
      const options = (args.options || []).map((option: any) => typeof option === 'string' ? option : option.label);
      return [[args.question, ...options].join('\n')];
    });
    const text = [...texts, ...questions].join('\n').trim()
      || (typeof content === 'string' ? content : typeof content?.content === 'string' ? content.content : '');
    return text ? [{
      id: message.id,
      role: message.role,
      text,
      kind: questions.length ? 'question' : 'text',
      createdAt: message.createdAt,
    }] : [];
  });
}

export const consultationHistoryRoutes = [
  registerApiRoute('/legal-conversations', {
    method: 'GET',
    requiresAuth: false,
    handler: async c => {
      const store = await c.get('mastra').getStorage()?.getStore('memory');
      if (!store) return c.json({ error: '会话存储不可用。' }, 503);
      const result = await store.listThreads({ perPage: false, orderBy: { field: 'updatedAt', direction: 'DESC' } });
      return c.json({ sessions: result.threads.map(thread => ({
        id: thread.id,
        title: thread.title || '未命名咨询',
        updatedAt: thread.updatedAt,
      })) });
    },
  }),
  registerApiRoute('/legal-conversations/:id', {
    method: 'GET',
    requiresAuth: false,
    handler: async c => {
      const store = await c.get('mastra').getStorage()?.getStore('memory');
      if (!store) return c.json({ error: '会话存储不可用。' }, 503);
      const threadId = c.req.param('id');
      const thread = await store.getThreadById({ threadId });
      if (!thread) return c.json({ error: '这条对话不存在。' }, 404);
      const result = await store.listMessages({ threadId, perPage: false, orderBy: { field: 'createdAt', direction: 'ASC' } });
      return c.json({ session: { id: thread.id, title: thread.title, messages: visibleHistory(result.messages) } });
    },
  }),
];
