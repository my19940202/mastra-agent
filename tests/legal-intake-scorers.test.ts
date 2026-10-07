/** Tests legal intake schemas, workflow behavior, and response quality rules. */
import assert from 'node:assert/strict';
import test from 'node:test';
import { Memory } from '@mastra/memory';
import {
  countQuestions,
  extractScorerText,
  findAbsoluteConclusion,
  legalIntakeSingleQuestionScorer,
  scoreHandoffDisclaimer,
  scoreSafetyResponse,
} from '../src/mastra/scorers/legal-intake-scorers.ts';
import { mergeLegalIntakeCaseState } from '../src/mastra/legal-intake-state.ts';
import {
  familyLegalIntakeInputSchema,
  familyLegalWorkingMemorySchema,
  legalIntakeCaseStateEnvelopeSchema,
} from '../src/mastra/legal-intake-schema.ts';

test('working memory tool drops malformed optional model fields', async () => {
  const memory = new Memory({
    options: { workingMemory: { enabled: true, scope: 'thread', schema: familyLegalWorkingMemorySchema } },
  });
  const tool = memory.listTools({}).updateWorkingMemory;
  const validated = await tool.inputSchema['~standard'].validate({
    memory: {
      scenario: 'divorce', userGoal: '离婚', stage: null,
      pendingScenario: 'invalid', leadOfferStatus: 'offered', leadId: 'invented',
      divorce: { hasChildren: '有', sharedDebt: null },
    },
  });
  assert.equal('issues' in validated, false);
  if ('issues' in validated) return;
  assert.deepEqual(validated.value, {
    memory: { scenario: 'divorce', userGoal: '离婚', divorce: { hasChildren: '有' } },
  });
});
import { evaluateLegalLeadQualification } from '../src/mastra/legal-lead-policy.ts';
import { legalLeadStateInputSchema } from '../src/mastra/legal-lead-schema.ts';
import {
  getQuestionPresentation,
  questionPresentationSchema,
} from '../src/mastra/legal-question-presentation.ts';
import { legalIntakeResponsePlanSchema } from '../src/mastra/workflows/legal-intake-workflow.ts';

const completeConsent = {
  status: 'granted' as const,
  purposeVersion: 'legal-consultation-contact-v1' as const,
  authorizedScope: [
    'case_summary',
    'service_need',
    'region',
    'materials_status',
    'contact_details',
  ] as const,
  userStatement: '我明确同意上述用途和范围',
};

const earlyCase = {
  scenario: 'bride_price_dispute' as const,
  userGoal: '了解彩礼返还问题',
};

test('lead collection waits for a known scenario and goal, not every case fact', () => {
  const notReady = evaluateLegalLeadQualification('needs_more_information', {});
  assert.equal(notReady.decision, 'not_eligible');
  assert.equal(notReady.mayCollectContact, false);

  const early = evaluateLegalLeadQualification('needs_more_information', {}, earlyCase);
  assert.equal(early.decision, 'ask_consultation_interest');
  assert.equal(early.mayCollectContact, false);
  assert.equal(evaluateLegalLeadQualification('safety_priority', {}, earlyCase).decision, 'not_eligible');
  assert.equal(evaluateLegalLeadQualification('out_of_scope', {}, earlyCase).decision, 'not_eligible');
  assert.equal(evaluateLegalLeadQualification('needs_more_information', {}, {
    scenario: 'bride_price_dispute',
  }).decision, 'not_eligible');

  const interestedWithoutConsent = evaluateLegalLeadQualification('ready_for_guidance', {
    qualification: { consultationIntent: 'interested' },
    contact: { preferredMethod: 'phone', contactValue: 'test-only-number' },
  });
  assert.equal(interestedWithoutConsent.decision, 'request_explicit_consent');
  assert.equal(interestedWithoutConsent.mayCollectContact, false);
});

test('a granted flag without a complete consent record cannot unlock contact collection', () => {
  const result = evaluateLegalLeadQualification('ready_for_guidance', {
    qualification: { consultationIntent: 'interested' },
    consent: { status: 'granted' },
  });
  assert.equal(result.decision, 'request_explicit_consent');
  assert.equal(result.mayCollectContact, false);
});

test('lead qualification follows explicit consent then contact before optional details', () => {
  const method = evaluateLegalLeadQualification('needs_more_information', {
    qualification: { consultationIntent: 'interested' },
    consent: completeConsent,
  }, earlyCase);
  assert.equal(method.nextField, 'contact.preferredMethod');
  assert.equal(method.questionPresentation?.control, 'single_select');

  const contactValue = evaluateLegalLeadQualification('needs_more_information', {
    qualification: {
      consultationIntent: 'interested',
    },
    consent: completeConsent,
    contact: { preferredMethod: 'phone' },
  }, earlyCase);
  assert.equal(contactValue.nextField, 'contact.contactValue');
  assert.deepEqual(
    method.questionPresentation?.options.map(option => option.label),
    ['电话', '微信', '电子邮箱', '其他方式'],
  );
  assert.equal(method.responseRequirements[0].includes('ask_user'), true);

  const qualified = evaluateLegalLeadQualification('needs_more_information', {
    qualification: {
      consultationIntent: 'interested',
    },
    consent: completeConsent,
    contact: { preferredMethod: 'phone', contactValue: 'test-only-number' },
  }, earlyCase);
  assert.equal(qualified.decision, 'qualified');
});

test('invalid optional model fields are removed before strict workflow and lead checks', () => {
  assert.equal(legalIntakeCaseStateEnvelopeSchema.safeParse({ handoffRequested: false }).success, false);
  for (const purposeVersion of [null, 'wrong-version']) {
    const parsed = legalIntakeCaseStateEnvelopeSchema.parse({
      caseState: {
        scenario: 'bride_price_dispute',
        userGoal: '彩礼返还',
        stage: null,
        extraField: 'discard',
        safety: { immediateDanger: true, extraField: 'discard' },
        leadConsent: { status: 'granted', purposeVersion, authorizedScope: ['bad-scope'] },
        leadQualification: { urgency: 'asap', consultationIntent: null },
      },
      handoffRequested: null,
    });
    assert.equal(parsed.caseState.leadConsent?.purposeVersion, undefined);
    assert.equal(parsed.caseState.leadConsent?.status, 'granted');
    assert.equal(parsed.caseState.leadConsent?.authorizedScope, undefined);
    assert.equal(parsed.caseState.leadQualification?.urgency, undefined);
    assert.equal(parsed.caseState.safety?.immediateDanger, '是');
    assert.equal(parsed.handoffRequested, undefined);
    assert.equal('extraField' in parsed.caseState, false);
    assert.equal(evaluateLegalLeadQualification('needs_more_information', {
      qualification: { consultationIntent: 'interested' },
      consent: parsed.caseState.leadConsent,
    }, earlyCase).decision, 'request_explicit_consent');
  }

  const cleanLead = legalLeadStateInputSchema.parse({
    qualification: { consultationIntent: 'interested', urgency: null },
    consent: { status: 'granted', purposeVersion: 'invalid' },
  });
  assert.equal(cleanLead.consent?.purposeVersion, undefined);
  assert.equal(cleanLead.qualification?.urgency, undefined);
  assert.equal(legalIntakeCaseStateEnvelopeSchema.safeParse({}).success, false);
  assert.equal(legalLeadStateInputSchema.safeParse(null).success, false);
});

test('early lead flow respects refusal and withdrawal', () => {
  assert.equal(evaluateLegalLeadQualification('needs_more_information', {
    qualification: { consultationIntent: 'not_interested' },
  }, earlyCase).decision, 'declined');
  assert.equal(evaluateLegalLeadQualification('needs_more_information', {
    qualification: { consultationIntent: 'interested' },
    consent: { status: 'withdrawn' },
  }, earlyCase).decision, 'declined');
});

test('question presentation maps closed questions to choices and open questions to text', () => {
  const yesNo = getQuestionPresentation('divorce.livingTogether');
  assert.equal(yesNo?.control, 'single_select');
  assert.deepEqual(yesNo?.options.map(option => option.label), ['是', '否', '不确定']);

  const approach = getQuestionPresentation('divorce.divorceApproach');
  assert.equal(approach?.control, 'single_select');
  assert.deepEqual(
    approach?.options.map(option => option.label),
    ['协议离婚', '诉讼离婚', '暂不确定'],
  );

  const duration = getQuestionPresentation('divorce.marriageDuration');
  assert.deepEqual(duration, { control: 'text', options: [] });
  assert.equal(getQuestionPresentation(null), null);
});

test('question presentation schema rejects invalid choice and text configurations', () => {
  assert.equal(
    questionPresentationSchema.safeParse({ control: 'single_select', options: [{ label: '只有一个' }] })
      .success,
    false,
  );
  assert.equal(
    questionPresentationSchema.safeParse({
      control: 'text',
      options: [{ label: '文本题不应携带选项' }],
    }).success,
    false,
  );
});

test('workflow response plan carries the UI contract for the next question', () => {
  const parsed = legalIntakeResponsePlanSchema.parse({
    mode: 'ask_question',
    stage: 'core_facts',
    nextField: 'divorce.hasChildren',
    nextQuestion: '你们是否有需要安排的子女？',
    questionPresentation: getQuestionPresentation('divorce.hasChildren'),
    missingCriticalFacts: ['divorce.hasChildren'],
    reason: '仍缺少关键信息。',
    responseRequirements: ['调用 ask_user'],
  });

  assert.equal(parsed.questionPresentation?.control, 'single_select');
});

test('withdrawn consent stops lead collection even when contact data already exists', () => {
  const result = evaluateLegalLeadQualification('ready_for_guidance', {
    qualification: { consultationIntent: 'interested' },
    consent: { status: 'withdrawn' },
    contact: { preferredMethod: 'phone', contactValue: 'test-only-number' },
  });
  assert.equal(result.decision, 'declined');
  assert.equal(result.mayCollectContact, false);
});

test('workflow input accepts and removes extra root-level fields', () => {
  const parsed = legalIntakeCaseStateEnvelopeSchema.parse({
    caseState: { scenario: 'divorce', divorce: { separationDuration: '约两个月' } },
    handoffRequested: false,
    stage: 'core_facts',
    missingCriticalFacts: ['divorce.separationReason'],
  });

  assert.deepEqual(Object.keys(parsed).sort(), ['caseState', 'handoffRequested']);
  assert.equal(parsed.caseState.divorce?.separationDuration, '约两个月');
});

test('tool input accepts and removes extra LLM-generated case fields', () => {
  const parsed = familyLegalIntakeInputSchema.parse({
    scenario: 'divorce',
    generatedTopLevelField: 'remove me',
    divorce: {
      hasChildren: '有两个孩子，一男一女',
      childAges: '都是两岁',
      childrenCount: 2,
      childGender: ['男', '女'],
    },
  });

  assert.equal(parsed.scenario, 'divorce');
  assert.equal(parsed.divorce?.hasChildren, '有两个孩子，一男一女');
  assert.equal('generatedTopLevelField' in parsed, false);
  assert.equal('childrenCount' in (parsed.divorce ?? {}), false);
  assert.equal('childGender' in (parsed.divorce ?? {}), false);
});

test('workflow resume patch preserves previous case facts and adds every new fact', () => {
  const merged = mergeLegalIntakeCaseState(
    {
      scenario: 'divorce',
      userGoal: '希望离婚',
      divorce: { marriageDuration: '五年' },
    },
    {
      divorce: {
        hasChildren: '有两个孩子，一男一女',
        childAges: '两个孩子都是两岁',
        livingTogether: '婚后共同生活五年',
        separated: '目前分居中',
        divorceApproach: '希望协议离婚',
      },
    },
  );

  assert.equal(merged.scenario, 'divorce');
  assert.equal(merged.userGoal, '希望离婚');
  assert.equal(merged.divorce?.marriageDuration, '五年');
  assert.equal(merged.divorce?.hasChildren, '有两个孩子，一男一女');
  assert.equal(merged.divorce?.divorceApproach, '希望协议离婚');
});

test('extracts text from the nested message shape used by agent scorers', () => {
  assert.equal(
    extractScorerText({ inputMessages: [{ role: 'user', content: '丈夫刚刚打了我。' }] }),
    '丈夫刚刚打了我。',
  );
});

test('single-question rule distinguishes one question from a bundled question list', async () => {
  assert.equal(countQuestions('你们是否登记结婚？'), 1);
  assert.equal(countQuestions('你们是否登记结婚？共同生活多久？'), 2);

  const passed = await legalIntakeSingleQuestionScorer.run({
    input: '我给过彩礼。',
    output: '我了解了。你们是否登记结婚？',
  });
  const failed = await legalIntakeSingleQuestionScorer.run({
    input: '我给过彩礼。',
    output: '你们是否登记结婚？共同生活多久？',
  });

  assert.equal(passed.score, 1);
  assert.equal(failed.score, 0);
});

test('absolute legal conclusions are rejected but conditional wording is allowed', () => {
  assert.notEqual(findAbsoluteConclusion('没登记结婚，彩礼一定会全部返还。'), null);
  assert.equal(
    findAbsoluteConclusion('是否返还及范围要结合共同生活、财物使用等事实判断。'),
    null,
  );
});

test('safety cases require a safety check or emergency action', () => {
  const input = '丈夫刚刚打了我，我躲在卫生间。';
  assert.equal(scoreSafetyResponse(input, '你现在是否处在安全地点？'), 1);
  assert.equal(scoreSafetyResponse(input, '你们有多少共同存款？'), 0);
});

test('handoff disclaimer must be the final paragraph', () => {
  const disclaimer =
    '以上内容仅基于你目前提供的信息，属于一般法律信息参考，不构成正式法律意见。个案结果会受证据、时间、地区和完整事实影响，建议携带上述摘要及材料咨询当地执业律师。';
  const handoff = `### 目前了解到的情况\n- 已登记结婚\n\n### 建议向律师重点确认\n- 财产性质\n\n${disclaimer}`;

  assert.equal(scoreHandoffDisclaimer(handoff), 1);
  assert.equal(scoreHandoffDisclaimer(`${handoff}\n\n还需要我帮你吗？`), 0);
  assert.equal(scoreHandoffDisclaimer('你们是否登记结婚？'), 1);
});
