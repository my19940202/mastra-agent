/** Exposes only the agent result fields needed by the mini program. */
import { registerApiRoute } from '@mastra/core/server';
import { z } from 'zod';
import {
  canOfferLeadCard,
  countConsultationTurns,
  handleLeadCard,
  leadCardRequestSchema,
  readLeadCaseState,
} from './miniapp-lead';

type MiniappAgentResult = {
  text?: string;
  finishReason?: string;
  runId?: string;
  suspendPayload?: unknown;
};

export function toMiniappAgentResponse(result: MiniappAgentResult, showLeadCard = false) {
  return {
    text: result.text ?? '',
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
    const previousState = memory && ids.success
      ? await readLeadCaseState(memory, ids.data)
      : {};
    const result = await agent.generate(body.messages, {
      memory: body.memory,
      ...(body.autoResumeSuspendedTools === true
        ? { autoResumeSuspendedTools: true }
        : {}),
    });
    let showLeadCard = false;
    if (ids.success && memory && result.finishReason !== 'error') {
      try {
        let state = await readLeadCaseState(memory, ids.data);
        if (previousState.leadOfferStatus) {
          state = {
            ...state,
            leadOfferStatus: previousState.leadOfferStatus,
            leadId: previousState.leadId ?? state.leadId,
          };
          await memory.updateWorkingMemory({
            threadId: ids.data.thread,
            resourceId: ids.data.resource,
            workingMemory: JSON.stringify(state),
          });
        }
        const turns = await countConsultationTurns(memory, ids.data.thread);
        showLeadCard = canOfferLeadCard(state, turns);
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
