import assert from 'node:assert/strict';
import test from 'node:test';
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
  legalIntakeCaseStateEnvelopeSchema,
} from '../src/mastra/legal-intake-schema.ts';

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
