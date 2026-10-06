/** Exposes only the agent result fields needed by the mini program. */
import { registerApiRoute } from '@mastra/core/server';

type MiniappAgentResult = {
  text?: string;
  finishReason?: string;
  runId?: string;
  suspendPayload?: unknown;
};

export function toMiniappAgentResponse(result: MiniappAgentResult) {
  return {
    text: result.text ?? '',
    finishReason: result.finishReason ?? null,
    runId: result.runId ?? null,
    suspendPayload: result.suspendPayload ?? null,
  };
}

export const miniappAgentRoute = registerApiRoute('/legal-agent/generate', {
  method: 'POST',
  requiresAuth: false,
  handler: async c => {
    const body = await c.req.json();
    const agent = c.get('mastra').getAgentById('family-legal-intake-agent');
    const result = await agent.generate(body.messages, {
      memory: body.memory,
      ...(body.autoResumeSuspendedTools === true
        ? { autoResumeSuspendedTools: true }
        : {}),
    });
    return c.json(toMiniappAgentResponse(result));
  },
});
