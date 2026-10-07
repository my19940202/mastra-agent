/** Serves compact legal-agent replies and contact-card actions to the mini program. */
import { registerApiRoute } from '@mastra/core/server';
import { z } from 'zod';
import {
  canOfferLeadCard,
  countConsultationTurns,
  handleLeadCard,
  leadCardRequestSchema,
  readLeadCaseState,
} from './miniapp-lead';
import { readLeadThreadState } from './lead-thread-state';

type MiniappAgentResult = {
  text?: string;
  finishReason?: string;
  runId?: string;
  suspendPayload?: unknown;
};

export function getMiniappAgentError(result: MiniappAgentResult): string | null {
  return result.finishReason === 'tool-calls' && !result.text?.trim()
    ? '本轮咨询未生成回复，请重试。'
    : null;
}

export function toMiniappAgentResponse(result: MiniappAgentResult, showLeadCard = false) {
  const suspendedQuestion = result.finishReason === 'suspended'
    && typeof result.runId === 'string'
    && result.runId.length > 0
    && typeof result.suspendPayload === 'object'
    && result.suspendPayload !== null
    && 'toolName' in result.suspendPayload
    && result.suspendPayload.toolName === 'ask_user'
    && 'toolCallId' in result.suspendPayload
    && typeof result.suspendPayload.toolCallId === 'string'
    && 'suspendPayload' in result.suspendPayload
    && typeof result.suspendPayload.suspendPayload === 'object'
    && result.suspendPayload.suspendPayload !== null
    && 'question' in result.suspendPayload.suspendPayload
    && typeof result.suspendPayload.suspendPayload.question === 'string'
    && result.suspendPayload.suspendPayload.question.length > 0;
  return {
    // ask_user 的挂起卡片就是这一轮的回复；模型提前生成的文字不能再显示一次。
    text: suspendedQuestion ? '' : result.text ?? '',
    finishReason: result.finishReason ?? null,
    runId: result.runId ?? null,
    suspendPayload: result.suspendPayload ?? null,
    ...(showLeadCard ? { leadCard: { type: 'lawyer_contact' as const } } : {}),
  };
}

export const miniappAgentRoute = registerApiRoute('/legal-agent/generate', {
  method: 'POST',
  requiresAuth: false,
  handler: async c => {
    const body = await c.req.json();
    const agent = c.get('mastra').getAgentById('family-legal-intake-agent');
    const ids = z.object({ thread: z.string().min(1), resource: z.string().min(1) }).safeParse(body.memory);
    const memory = ids.success ? await agent.getMemory() : undefined;
    const result = await agent.generate(body.messages, {
      memory: body.memory,
      ...(body.autoResumeSuspendedTools === true
        ? { autoResumeSuspendedTools: true }
        : {}),
    });
    const incompleteError = getMiniappAgentError(result);
    if (incompleteError) return c.json({ error: incompleteError, retryable: true }, 503);
    let showLeadCard = false;
    if (ids.success && memory && result.finishReason !== 'error') {
      try {
        const state = await readLeadCaseState(memory, ids.data);
        const leadState = await readLeadThreadState(memory, ids.data);
        const turns = await countConsultationTurns(memory, ids.data.thread);
        showLeadCard = canOfferLeadCard(state, turns, leadState);
      } catch (error) {
        console.warn('Optional contact card could not be evaluated:', error);
      }
    }
    return c.json(toMiniappAgentResponse(result, showLeadCard));
  },
});

export const miniappLeadCardRoute = registerApiRoute('/legal-agent/lead-card', {
  method: 'POST',
  requiresAuth: false,
  handler: async c => {
    const parsed = leadCardRequestSchema.safeParse(await c.req.json());
    if (!parsed.success) return c.json({ error: '联系卡数据格式不正确。' }, 400);
    const agent = c.get('mastra').getAgentById('family-legal-intake-agent');
    const memory = await agent.getMemory();
    if (!memory) return c.json({ error: '会话存储不可用。' }, 503);
    try {
      return c.json(await handleLeadCard(memory, parsed.data));
    } catch (error) {
      const message = error instanceof Error ? error.message : '保存线索失败，请稍后重试。';
      return c.json({ error: message }, 400);
    }
  },
});
