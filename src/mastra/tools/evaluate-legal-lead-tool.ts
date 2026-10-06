import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import {
  legalLeadStateInputSchema,
  leadQualificationStatusSchema,
} from '../legal-lead-schema';
import {
  evaluateLegalLeadQualification,
  type LegalLeadPlan,
} from '../legal-lead-policy';
import { questionPresentationSchema } from '../legal-question-presentation';
import { familyLegalIntakeInputSchema } from '../legal-intake-schema';
import { evaluateCaseReadiness } from './evaluate-case-readiness-tool';

export const legalLeadDecisionSchema = z.enum([
  'not_eligible',
  'ask_consultation_interest',
  'request_explicit_consent',
  'collect_qualification_detail',
  'collect_contact_method',
  'collect_contact_value',
  'qualified',
  'declined',
]);

export const legalLeadPlanSchema = z.object({
  decision: legalLeadDecisionSchema,
  qualificationStatus: leadQualificationStatusSchema,
  nextField: z.string().nullable(),
  nextQuestion: z.string().nullable(),
  questionPresentation: questionPresentationSchema.nullable(),
  reason: z.string(),
  responseRequirements: z.array(z.string()),
  mayCollectContact: z.boolean(),
});

export const legalLeadEvaluationInputSchema = z
  .object({
    leadState: legalLeadStateInputSchema,
    caseState: familyLegalIntakeInputSchema,
  })
  .catchall(z.unknown())
  .transform(({ leadState, caseState }) => ({ leadState, caseState }));

export const evaluateLegalLeadTool = createTool({
  id: 'evaluate-legal-lead',
  description:
    '在支持场景与基本诉求明确后，确定自愿律师联系流程的下一步；未明确授权时严禁收集联系方式。',
  inputSchema: legalLeadEvaluationInputSchema,
  outputSchema: legalLeadPlanSchema,
  execute: async ({ leadState, caseState }) =>
    evaluateLegalLeadQualification(evaluateCaseReadiness(caseState).decision, leadState, caseState),
});
