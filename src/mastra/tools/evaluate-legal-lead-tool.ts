import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import {
  legalLeadStateInputSchema,
  leadQualificationStatusSchema,
} from '../legal-lead-schema';
import { readinessDecisionSchema } from './evaluate-case-readiness-tool';
import {
  evaluateLegalLeadQualification,
  type LegalLeadPlan,
} from '../legal-lead-policy';
import { questionPresentationSchema } from '../legal-question-presentation';

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
    caseReadinessDecision: readinessDecisionSchema,
    leadState: legalLeadStateInputSchema,
  })
  .catchall(z.unknown())
  .transform(({ caseReadinessDecision, leadState }) => ({ caseReadinessDecision, leadState }));

export const evaluateLegalLeadTool = createTool({
  id: 'evaluate-legal-lead',
  description:
    '在案件信息基本充分后，确定律师咨询意愿、明确授权、资格信息和联系方式的下一步；未明确授权时严禁收集联系方式。',
  inputSchema: legalLeadEvaluationInputSchema,
  outputSchema: legalLeadPlanSchema,
  execute: async ({ caseReadinessDecision, leadState }) =>
    evaluateLegalLeadQualification(caseReadinessDecision, leadState),
});
