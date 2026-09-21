import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import {
  familyLegalIntakeMemorySchema,
  legalIntakeCaseStateEnvelopeSchema,
  legalIntakeStageSchema,
  type FamilyLegalIntakeMemory,
} from '../legal-intake-schema';

export const readinessDecisionSchema = z.enum([
  'needs_more_information',
  'ready_for_guidance',
  'ready_for_handoff',
  'safety_priority',
  'out_of_scope',
]);

export const readinessResultSchema = z.object({
  decision: readinessDecisionSchema,
  recommendedStage: legalIntakeStageSchema,
  nextField: z.string().nullable(),
  nextQuestion: z.string().nullable(),
  missingCriticalFacts: z.array(z.string()),
  reason: z.string(),
});

export const readinessInputSchema = legalIntakeCaseStateEnvelopeSchema.describe(
  '案件状态输入；handoffRequested 仅在用户明确要求立即总结、生成律师摘要或交接时设为 true。',
);

export type ReadinessResult = z.infer<typeof readinessResultSchema>;
type Question = { field: string; question: string };

const questions: Record<string, string> = {
  scenario: '这件事主要跟离婚或夫妻财产、彩礼或婚约财产，还是跟亲人去世后的继承或家庭财产有关？',
  userGoal: '你现在最想优先解决的是什么问题？',
  'safety.currentlySafe': '你现在是否处于安全地点？',
  'divorce.marriageDuration': '你们登记结婚大约多久了？',
  'divorce.livingTogether': '你们婚后是否共同生活过？',
  'divorce.hasChildren': '你们是否有需要安排的子女？',
  'divorce.childAges': '孩子现在多大？',
  'divorce.custodyPreference': '你目前希望由谁直接抚养孩子？',
  'divorce.visitationPreference': '你对孩子探望安排目前有什么设想？',
  'divorce.childSupportSituation': '孩子目前的抚养费用是怎样承担的？',
  'divorce.separated': '你们目前是否已经分居？',
  'divorce.separationDuration': '你们大约分居多久了？',
  'divorce.separationReason': '这次分居的主要原因是什么？',
  'divorce.divorceApproach': '你目前倾向协议离婚还是诉讼离婚？',
  'divorce.spousePosition': '对方目前对离婚是什么态度？',
  'divorce.sharedProperty': '你们是否有需要处理的夫妻共同财产？',
  'divorce.sharedDebt': '你们是否有需要处理的共同债务？',
  'bridePriceDispute.partyRole': '在这些财物往来中，你属于给付方、接收方还是相关父母？',
  'bridePriceDispute.marriageRegistered': '双方是否办理过结婚登记？',
  'bridePriceDispute.marriageRegistrationTime': '双方大约什么时候办理的结婚登记？',
  'bridePriceDispute.marriageEnded': '双方目前是否已经解除婚姻关系？',
  'bridePriceDispute.livedTogether': '双方是否实际共同生活过？',
  'bridePriceDispute.cohabitationDuration': '双方共同生活大约持续了多久？',
  'bridePriceDispute.propertyDetails': '目前有争议的钱款或财物主要有哪些？',
  'bridePriceDispute.paymentTime': '这些钱款或财物大约是什么时候给付的？',
  'bridePriceDispute.paymentMethod': '这些钱款或财物是通过什么方式给付的？',
  'bridePriceDispute.payer': '这些钱款或财物实际由谁给付？',
  'bridePriceDispute.recipient': '这些钱款或财物实际由谁接收？',
  'bridePriceDispute.paymentPurpose': '给付这些钱款或财物时，双方如何表达其用途？',
  'bridePriceDispute.propertyUse': '这些钱款或财物后来主要用于什么？',
  'bridePriceDispute.dowryDetails': '这件事是否还涉及嫁妆？',
  'bridePriceDispute.pregnancyOrChildren': '双方是否存在怀孕、生育或共同抚养子女的情况？',
  'inheritance.scenarioSubtype': '这是亲人去世后的继承问题，还是亲人健在时的家庭财产问题？',
  'inheritance.relationshipToUser': '你与相关亲人是什么关系？',
  'inheritance.deathTime': '相关亲人大约什么时候去世？',
  'inheritance.hasWill': '目前是否知道存在遗嘱？',
  'inheritance.possibleHeirs': '目前知道可能涉及哪些继承人？',
  'inheritance.mainAssets': '目前主要涉及哪些财产？',
  'inheritance.registeredOwner': '相关财产目前登记在谁名下？',
  'inheritance.assetContributions': '各家庭成员对相关财产的出资情况是怎样的？',
  'inheritance.agreementsOrGifts': '家庭成员之间是否有赠与、借款、代持或其他约定？',
  'inheritance.currentControl': '相关财产目前由谁实际控制？',
  'inheritance.currentDispute': '目前围绕这些财产发生了什么争议？',
};

function hasValue(value: unknown): boolean {
  return typeof value === 'string' && value.trim().length > 0;
}

function isAffirmative(value: unknown): boolean {
  if (!hasValue(value)) return false;
  const normalized = String(value).trim().toLowerCase();
  if (/不安全|有危险/u.test(normalized)) return true;
  if (/没有|无危险|不存在|未发生|尚未|否认|不是|不涉及|unknown|declined/u.test(normalized)) {
    return false;
  }
  return /是|有|已|存在|发生|分居|危险|不安全|家暴|威胁|yes|true/u.test(normalized);
}

function isCurrentlySafe(value: unknown): boolean {
  if (!hasValue(value)) return false;
  const normalized = String(value).trim().toLowerCase();
  if (/不安全|不在安全|未处于安全|没有.*安全|否|no|false/u.test(normalized)) return false;
  return /安全|是|已到|yes|true/u.test(normalized);
}

function includesAny(value: unknown, keywords: string[]): boolean {
  if (!hasValue(value)) return false;
  const text = String(value);
  return keywords.some(keyword => text.includes(keyword));
}

function missing(field: string, value: unknown): Question | null {
  if (hasValue(value)) return null;
  return { field, question: questions[field] };
}

function missingKnown(field: string, value: unknown): Question | null {
  if (value === 'unknown') return { field, question: questions[field] };
  return missing(field, value);
}

function resultFromMissing(items: Array<Question | null>): ReadinessResult {
  const missingItems = items.filter((item): item is Question => item !== null);
  if (missingItems.length === 0) {
    return {
      decision: 'ready_for_guidance',
      recommendedStage: 'guidance',
      nextField: null,
      nextQuestion: null,
      missingCriticalFacts: [],
      reason: '当前场景的最低必要事实已经基本完整，可以提供条件性的一般法律信息。',
    };
  }

  const next = missingItems[0];
  return {
    decision: 'needs_more_information',
    recommendedStage: missingItems.length > 3 ? 'basic_facts' : 'core_facts',
    nextField: next.field,
    nextQuestion: next.question,
    missingCriticalFacts: missingItems.map(item => item.field),
    reason: `仍缺少 ${missingItems.length} 项会影响处理方向的关键信息。`,
  };
}

function evaluateDivorce(state: FamilyLegalIntakeMemory): ReadinessResult {
  const divorce = state.divorce ?? {};
  const items: Array<Question | null> = [
    missing('userGoal', state.userGoal),
    missing('divorce.marriageDuration', divorce.marriageDuration),
    missing('divorce.livingTogether', divorce.livingTogether),
    missing('divorce.hasChildren', divorce.hasChildren),
  ];

  if (isAffirmative(divorce.hasChildren)) {
    items.push(missing('divorce.childAges', divorce.childAges));
    if (includesAny(state.userGoal, ['孩子', '子女', '抚养', '探望', '探视', '抚养费'])) {
      items.push(missing('divorce.custodyPreference', divorce.custodyPreference));
      items.push(missing('divorce.visitationPreference', divorce.visitationPreference));
      items.push(missing('divorce.childSupportSituation', divorce.childSupportSituation));
    }
  }

  items.push(missing('divorce.separated', divorce.separated));
  if (isAffirmative(divorce.separated)) {
    items.push(missing('divorce.separationDuration', divorce.separationDuration));
    items.push(missing('divorce.separationReason', divorce.separationReason));
  }

  if (!hasValue(divorce.divorceApproach) && !hasValue(divorce.spousePosition)) {
    items.push(missing('divorce.divorceApproach', divorce.divorceApproach));
  }
  if (includesAny(state.userGoal, ['财产', '房', '车', '存款', '股权'])) {
    items.push(missing('divorce.sharedProperty', divorce.sharedProperty));
  }
  if (includesAny(state.userGoal, ['债', '欠款', '贷款'])) {
    items.push(missing('divorce.sharedDebt', divorce.sharedDebt));
  }

  return resultFromMissing(items);
}

function evaluateBridePrice(state: FamilyLegalIntakeMemory): ReadinessResult {
  const bridePrice = state.bridePriceDispute ?? {};
  const items: Array<Question | null> = [
    missing('userGoal', state.userGoal),
    missing('bridePriceDispute.partyRole', bridePrice.partyRole),
    missing('bridePriceDispute.marriageRegistered', bridePrice.marriageRegistered),
  ];

  if (isAffirmative(bridePrice.marriageRegistered)) {
    items.push(
      missing('bridePriceDispute.marriageRegistrationTime', bridePrice.marriageRegistrationTime),
    );
    items.push(missing('bridePriceDispute.marriageEnded', bridePrice.marriageEnded));
  }

  items.push(missing('bridePriceDispute.livedTogether', bridePrice.livedTogether));
  if (isAffirmative(bridePrice.livedTogether)) {
    items.push(missing('bridePriceDispute.cohabitationDuration', bridePrice.cohabitationDuration));
  }

  items.push(
    missing('bridePriceDispute.propertyDetails', bridePrice.propertyDetails),
    missing('bridePriceDispute.paymentTime', bridePrice.paymentTime),
    missing('bridePriceDispute.paymentMethod', bridePrice.paymentMethod),
    missing('bridePriceDispute.payer', bridePrice.payer),
    missing('bridePriceDispute.recipient', bridePrice.recipient),
    missing('bridePriceDispute.paymentPurpose', bridePrice.paymentPurpose),
    missing('bridePriceDispute.propertyUse', bridePrice.propertyUse),
    missing('bridePriceDispute.dowryDetails', bridePrice.dowryDetails),
    missing('bridePriceDispute.pregnancyOrChildren', bridePrice.pregnancyOrChildren),
  );

  return resultFromMissing(items);
}

function evaluateInheritance(state: FamilyLegalIntakeMemory): ReadinessResult {
  const inheritance = state.inheritanceFamilyProperty ?? {};
  const items: Array<Question | null> = [
    missing('userGoal', state.userGoal),
    missingKnown('inheritance.scenarioSubtype', state.scenarioSubtype),
    missing('inheritance.relationshipToUser', inheritance.relationshipToUser),
    missing('inheritance.mainAssets', inheritance.mainAssets),
    missing('inheritance.registeredOwner', inheritance.registeredOwner),
    missing('inheritance.currentControl', inheritance.currentControl),
    missing('inheritance.currentDispute', inheritance.currentDispute),
  ];

  if (state.scenarioSubtype === 'inheritance_after_death') {
    items.splice(
      3,
      0,
      missing('inheritance.deathTime', inheritance.deathTime),
      missing('inheritance.hasWill', inheritance.hasWill),
      missing('inheritance.possibleHeirs', inheritance.possibleHeirs),
    );
  }

  if (state.scenarioSubtype === 'living_family_property') {
    items.splice(
      5,
      0,
      missing('inheritance.assetContributions', inheritance.assetContributions),
      missing('inheritance.agreementsOrGifts', inheritance.agreementsOrGifts),
    );
  }

  return resultFromMissing(items);
}

export function evaluateCaseReadiness(
  state: FamilyLegalIntakeMemory,
  handoffRequested = false,
): ReadinessResult {
  const result = evaluateCaseReadinessUnlogged(state, handoffRequested);
  return logReadiness(result, state.scenario, handoffRequested);
}

function evaluateCaseReadinessUnlogged(
  state: FamilyLegalIntakeMemory,
  handoffRequested = false,
): ReadinessResult {
  const safety = state.safety ?? {};
  const dangerMentioned =
    isAffirmative(safety.immediateDanger) ||
    isAffirmative(safety.domesticViolence) ||
    isAffirmative(safety.childSafetyConcern);

  if (dangerMentioned && !hasValue(safety.currentlySafe)) {
    return {
      decision: 'safety_priority',
      recommendedStage: 'safety',
      nextField: 'safety.currentlySafe',
      nextQuestion: questions['safety.currentlySafe'],
      missingCriticalFacts: ['safety.currentlySafe'],
      reason: '对话中出现现实人身安全风险，必须先确认用户当前是否安全。',
    };
  }

  if (dangerMentioned && !isCurrentlySafe(safety.currentlySafe)) {
    return {
      decision: 'safety_priority',
      recommendedStage: 'safety',
      nextField: null,
      nextQuestion: null,
      missingCriticalFacts: [],
      reason: '用户尚未处于安全地点，应停止普通案件采集并优先提供紧急安全指引。',
    };
  }

  if (handoffRequested) {
    return {
      decision: 'ready_for_handoff',
      recommendedStage: 'handoff',
      nextField: null,
      nextQuestion: null,
      missingCriticalFacts: [],
      reason: '用户已明确要求按现有信息生成摘要或交接材料。',
    };
  }

  if (!state.scenario || state.scenario === 'unknown') {
    return resultFromMissing([missing('scenario', undefined)]);
  }

  if (state.scenario === 'out_of_scope') {
    return {
      decision: 'out_of_scope',
      recommendedStage: 'handoff',
      nextField: null,
      nextQuestion: null,
      missingCriticalFacts: [],
      reason: '用户问题不属于当前版本支持的三个法律场景。',
    };
  }

  if (state.scenario === 'divorce') return evaluateDivorce(state);
  if (state.scenario === 'bride_price_dispute') return evaluateBridePrice(state);
  return evaluateInheritance(state);
}

function logReadiness(result: ReadinessResult, scenario: unknown, handoffRequested: boolean): ReadinessResult {
  // #region agent log
  fetch('http://127.0.0.1:7329/ingest/c35ee18f-ced6-4dfb-9939-f69ca388e4fa', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Debug-Session-Id': '2d9e32' },
    body: JSON.stringify({
      sessionId: '2d9e32',
          runId: 'post-fix',
      hypothesisId: 'A',
      location: 'evaluate-case-readiness-tool.ts:evaluateCaseReadiness',
      message: 'readiness evaluated',
      data: {
        decision: result.decision,
        nextField: result.nextField,
        hasNextQuestion: Boolean(result.nextQuestion),
        nextQuestionLength: result.nextQuestion?.length ?? 0,
        missingCount: result.missingCriticalFacts.length,
        scenario: typeof scenario === 'string' ? scenario : null,
        handoffRequested,
      },
      timestamp: Date.now(),
    }),
  }).catch(() => {});
  // #endregion
  return result;
}

export const evaluateCaseReadinessTool = createTool({
  id: 'evaluate-case-readiness',
  description:
    '根据家庭法律预咨询的完整结构化案件状态，确定是否需要继续采集、下一次只问哪个字段，或是否进入安全处理、一般指引和律师交接。',
  inputSchema: readinessInputSchema,
  outputSchema: readinessResultSchema,
  execute: async ({ caseState, handoffRequested }) =>
    evaluateCaseReadiness(caseState, handoffRequested ?? false),
});
