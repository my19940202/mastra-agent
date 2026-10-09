/** Serves compact legal-agent replies and contact-card actions to the mini program. */
import { registerApiRoute } from '@mastra/core/server';
import { SpanType, type Span } from '@mastra/core/observability';
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

type MiniappTimingSpan = Span<SpanType.GENERIC>;
type MiniappLeadMemory = Parameters<typeof readLeadCaseState>[0];

/** Records a named route stage without attaching request or case data to telemetry. */
export async function withMiniappTimingSpan<T>(
  parent: MiniappTimingSpan | undefined,
  name: string,
  operation: (span: MiniappTimingSpan | undefined) => Promise<T>,
): Promise<T> {
  const span = parent?.createChildSpan({ name, type: SpanType.GENERIC });
  try {
    const result = await operation(span);
    span?.end({ output: { ok: true } });
    return result;
  } catch (error) {
    span?.end({ output: { ok: false } });
    throw error;
  }
}

export async function getMiniappLeadCardEligibility(
  memory: MiniappLeadMemory,
  ids: { thread: string; resource: string },
  parent?: MiniappTimingSpan,
): Promise<boolean> {
  return withMiniappTimingSpan(parent, 'lead-card-evaluation', async span => {
    const [state, leadState, turns] = await Promise.all([
      withMiniappTimingSpan(span, 'working-memory-read', () => readLeadCaseState(memory, ids)),
      withMiniappTimingSpan(span, 'lead-thread-state-read', () => readLeadThreadState(memory, ids)),
      withMiniappTimingSpan(span, 'consultation-turn-count', () => countConsultationTurns(memory, ids.thread)),
    ]);
    return canOfferLeadCard(state, turns, leadState);
  });
}

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
    const mastra = c.get('mastra');
    const observability = mastra.observability.getSelectedInstance({});
    const requestSpan = observability?.startSpan({
      name: 'miniapp-agent-generate',
      type: SpanType.GENERIC,
    }) as MiniappTimingSpan | undefined;
    let requestOk = false;
    try {
      const body = await withMiniappTimingSpan(requestSpan, 'request-parse', () => c.req.json());
      const agent = mastra.getAgentById('family-legal-intake-agent');
      const ids = z.object({ thread: z.string().min(1), resource: z.string().min(1) }).safeParse(body.memory);
      const memory = ids.success
        ? await withMiniappTimingSpan(requestSpan, 'memory-client-init', () => agent.getMemory())
        : undefined;
      const result = await withMiniappTimingSpan(requestSpan, 'agent-generate', () => agent.generate(body.messages, {
        memory: body.memory,
        ...(body.autoResumeSuspendedTools === true
          ? { autoResumeSuspendedTools: true }
          : {}),
        tracingOptions: requestSpan
          ? {
              traceId: requestSpan.traceId,
              parentSpanId: requestSpan.id,
              hideInput: true,
              hideOutput: true,
            }
          : undefined,
      }));
      const incompleteError = getMiniappAgentError(result);
      if (incompleteError) return c.json({ error: incompleteError, retryable: true }, 503);
      let showLeadCard = false;
      if (ids.success && memory && result.finishReason !== 'error') {
        try {
          showLeadCard = await getMiniappLeadCardEligibility(memory, ids.data, requestSpan);
        } catch (error) {
          console.warn('Optional contact card could not be evaluated:', error);
        }
      }
      const response = await withMiniappTimingSpan(requestSpan, 'response-assembly', async () =>
        toMiniappAgentResponse(result, showLeadCard));
      requestOk = true;
      return c.json(response);
    } finally {
      requestSpan?.end({ output: { ok: requestOk } });
    }
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
