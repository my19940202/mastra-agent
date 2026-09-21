import { createStep, createWorkflow } from '@mastra/core/workflows';
import { z } from 'zod';
import {
  evaluateCaseReadiness,
  readinessInputSchema,
  readinessResultSchema,
  type ReadinessResult,
} from '../tools/evaluate-case-readiness-tool';
import { familyLegalIntakeMemorySchema } from '../legal-intake-schema';
import {
  getQuestionPresentation,
  questionPresentationSchema,
} from '../legal-question-presentation';

const responseModeSchema = z.enum([
  'ask_question',
  'provide_guidance',
  'create_handoff',
  'handle_safety',
  'decline_out_of_scope',
]);

export const legalIntakeResponsePlanSchema = z.object({
  mode: responseModeSchema,
  stage: z.enum(['identify', 'safety', 'basic_facts', 'core_facts', 'guidance', 'handoff']),
  nextField: z.string().nullable(),
  nextQuestion: z.string().nullable(),
  questionPresentation: questionPresentationSchema.nullable(),
  missingCriticalFacts: z.array(z.string()),
  reason: z.string(),
  responseRequirements: z.array(z.string()),
});

type ResponseMode = z.infer<typeof responseModeSchema>;
type ResponsePlan = z.infer<typeof legalIntakeResponsePlanSchema>;

const legalIntakeWorkflowStateSchema = z.object({
  caseState: familyLegalIntakeMemorySchema.optional(),
  handoffRequested: z.boolean().optional(),
  turnCount: z.number().int().nonnegative().optional(),
  lastPlan: legalIntakeResponsePlanSchema.nullable().optional(),
});

function toResponsePlan(
  readiness: ReadinessResult,
  mode: ResponseMode,
  responseRequirements: string[],
): ResponsePlan {
  return {
    mode,
    stage: readiness.recommendedStage,
    nextField: readiness.nextField,
    nextQuestion: readiness.nextQuestion,
    questionPresentation: getQuestionPresentation(readiness.nextField),
    missingCriticalFacts: readiness.missingCriticalFacts,
    reason: readiness.reason,
    responseRequirements,
  };
}

export const collectLegalIntakeStep = createStep({
  id: 'collect-legal-intake',
  description: '评估当前案件状态，并把充分度结果交给后续分支生成响应计划。',
  inputSchema: readinessInputSchema,
  outputSchema: readinessResultSchema,
  stateSchema: legalIntakeWorkflowStateSchema,
  execute: async ({ inputData, state, setState }) => {
    const readiness = evaluateCaseReadiness(
      inputData.caseState,
      inputData.handoffRequested ?? false,
    );

    await setState({
      caseState: inputData.caseState,
      handoffRequested: inputData.handoffRequested ?? false,
      turnCount: (state.turnCount ?? 0) + 1,
      lastPlan: null,
    });

    // #region agent log
    fetch('http://127.0.0.1:7329/ingest/c35ee18f-ced6-4dfb-9939-f69ca388e4fa', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Debug-Session-Id': '2d9e32' },
      body: JSON.stringify({
        sessionId: '2d9e32',
        runId: 'post-fix',
        hypothesisId: 'D',
        location: 'legal-intake-workflow.ts:collectLegalIntakeStep',
        message: 'collect-legal-intake completed without suspend',
        data: {
          decision: readiness.decision,
          nextField: readiness.nextField,
          hasNextQuestion: Boolean(readiness.nextQuestion),
          nextQuestionLength: readiness.nextQuestion?.length ?? 0,
          didSuspend: false,
          scenario: inputData.caseState?.scenario ?? null,
          turnCount: (state.turnCount ?? 0) + 1,
        },
        timestamp: Date.now(),
      }),
    }).catch(() => {});
    // #endregion

    return readiness;
  },
});

const askQuestionStep = createStep({
  id: 'ask-question',
  description: '为仍需补齐关键事实的案件生成单一追问计划。',
  inputSchema: readinessResultSchema,
  outputSchema: legalIntakeResponsePlanSchema,
  execute: async ({ inputData }) =>
    toResponsePlan(inputData, 'ask_question', [
      '按 questionPresentation 调用 ask_user，不要输出普通文本',
      '把 nextQuestion 原样作为 question，并且本轮只提出这一个问题',
      '不得提前给出案件结论',
    ]),
});

const guidanceStep = createStep({
  id: 'provide-guidance',
  description: '为事实基本充分的案件生成一般法律信息回复计划。',
  inputSchema: readinessResultSchema,
  outputSchema: legalIntakeResponsePlanSchema,
  execute: async ({ inputData }) =>
    toResponsePlan(inputData, 'provide_guidance', [
      '仅提供带条件的一般法律信息',
      '明确哪些未知或争议事实可能改变判断',
      '不得承诺结果、概率、精确金额或期限',
      '本轮不再追加问题清单',
    ]),
});

const handoffStep = createStep({
  id: 'create-handoff',
  description: '为用户明确要求交接的案件生成律师摘要计划。',
  inputSchema: readinessResultSchema,
  outputSchema: legalIntakeResponsePlanSchema,
  execute: async ({ inputData }) =>
    toResponsePlan(inputData, 'create_handoff', [
      '按照固定律师交接结构整理现有信息',
      '把缺失内容列为未知，不再继续追问',
      '只写用户已确认的事实，并区分未知、争议与拒绝回答事项',
      '以固定免责声明作为最后一段',
    ]),
});

const safetyStep = createStep({
  id: 'handle-safety',
  description: '暂停普通案件采集并生成安全优先回复计划。',
  inputSchema: readinessResultSchema,
  outputSchema: legalIntakeResponsePlanSchema,
  execute: async ({ inputData }) =>
    toResponsePlan(
      inputData,
      'handle_safety',
      inputData.nextQuestion
        ? [
            '按 questionPresentation 调用 ask_user，不要输出普通文本',
            '把 nextQuestion 原样作为 question，并且不继续普通案件追问',
          ]
        : [
            '停止普通案件采集',
            '建议立即联系 110、前往安全地点并联系可信赖亲友或当地支持机构',
            '不得提供对抗、报复、跟踪或转移财产方案',
          ],
    ),
});

const outOfScopeStep = createStep({
  id: 'decline-out-of-scope',
  description: '为当前版本不支持的法律问题生成范围外回复计划。',
  inputSchema: readinessResultSchema,
  outputSchema: legalIntakeResponsePlanSchema,
  execute: async ({ inputData }) =>
    toResponsePlan(inputData, 'decline_out_of_scope', [
      '简要说明当前版本不覆盖该领域',
      '建议联系对应专业律师或当地公共法律服务',
      '停止案件判断，不编造跨领域结论',
    ]),
});

const branchOutputSchema = z.object({
  'ask-question': legalIntakeResponsePlanSchema.optional(),
  'provide-guidance': legalIntakeResponsePlanSchema.optional(),
  'create-handoff': legalIntakeResponsePlanSchema.optional(),
  'handle-safety': legalIntakeResponsePlanSchema.optional(),
  'decline-out-of-scope': legalIntakeResponsePlanSchema.optional(),
});

const finalizeResponsePlanStep = createStep({
  id: 'finalize-response-plan',
  description: '把条件分支的结果统一为稳定的响应计划输出。',
  inputSchema: branchOutputSchema,
  outputSchema: legalIntakeResponsePlanSchema,
  execute: async ({ inputData }) => {
    const plan =
      inputData['ask-question'] ??
      inputData['provide-guidance'] ??
      inputData['create-handoff'] ??
      inputData['handle-safety'] ??
      inputData['decline-out-of-scope'];

    if (!plan) {
      throw new Error('Legal intake workflow completed without selecting a response branch.');
    }

    // #region agent log
    fetch('http://127.0.0.1:7329/ingest/c35ee18f-ced6-4dfb-9939-f69ca388e4fa', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Debug-Session-Id': '2d9e32' },
      body: JSON.stringify({
        sessionId: '2d9e32',
        runId: 'post-fix',
        hypothesisId: 'B',
        location: 'legal-intake-workflow.ts:finalizeResponsePlanStep',
        message: 'workflow returned response plan',
        data: {
          mode: plan.mode,
          nextField: plan.nextField,
          hasNextQuestion: Boolean(plan.nextQuestion),
          nextQuestionLength: plan.nextQuestion?.length ?? 0,
        },
        timestamp: Date.now(),
      }),
    }).catch(() => {});
    // #endregion

    return plan;
  },
});

export const legalIntakeWorkflow = createWorkflow({
  id: 'legal-intake-workflow',
  description:
    '强制执行家庭法律案件充分度评估，并将结果路由为单一追问、一般指引、律师交接、安全处理或范围外响应计划。',
  inputSchema: readinessInputSchema,
  outputSchema: legalIntakeResponsePlanSchema,
  stateSchema: legalIntakeWorkflowStateSchema,
})
  .then(collectLegalIntakeStep)
  .branch([
    [async ({ inputData }) => inputData.decision === 'needs_more_information', askQuestionStep],
    [async ({ inputData }) => inputData.decision === 'ready_for_guidance', guidanceStep],
    [async ({ inputData }) => inputData.decision === 'ready_for_handoff', handoffStep],
    [async ({ inputData }) => inputData.decision === 'safety_priority', safetyStep],
    [async ({ inputData }) => inputData.decision === 'out_of_scope', outOfScopeStep],
  ])
  .then(finalizeResponsePlanStep)
  .commit();
