import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import {
  legalLeadStateInputSchema,
} from '../legal-lead-schema';
import { evaluateLegalLeadQualification } from '../legal-lead-policy';
import { createLegalLeadRecord } from '../legal-lead-store';
import { readinessDecisionSchema } from './evaluate-case-readiness-tool';

const createLegalLeadInputSchema = z.object({
  readinessDecision: readinessDecisionSchema,
  leadState: legalLeadStateInputSchema,
  caseSummary: z.string().trim().min(1).max(20_000),
});

const createLegalLeadOutputSchema = z.object({
  created: z.boolean(),
  leadId: z.string(),
  status: z.enum(['pending_review', 'approved', 'assigned', 'contacted', 'closed', 'withdrawn']),
  createdAt: z.string(),
  message: z.string(),
});

function isValidContact(method: string, rawValue: string): boolean {
  const value = rawValue.trim();
  if (value.length < 3 || value.length > 254 || /[\r\n\0]/.test(value)) return false;
  switch (method) {
    case 'phone':
      return /^\+?[0-9][0-9 ()-]{6,20}$/.test(value);
    case 'email':
      return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
    case 'wechat':
      return /^[a-zA-Z][-_a-zA-Z0-9]{5,19}$/.test(value);
    case 'other':
      return true;
    default:
      return false;
  }
}

export const createLegalLeadTool = createTool({
  id: 'create-legal-lead',
  description:
    '在案件 readiness 通过、用户明确希望律师联系、完成明确授权及资格信息、联系方式校验通过后，幂等保存线索并进入人工审核队列。只传已授权的案件摘要；不得承诺律师已分配或已联系。',
  inputSchema: createLegalLeadInputSchema,
  outputSchema: createLegalLeadOutputSchema,
  execute: async ({ readinessDecision, leadState, caseSummary }, context) => {
    if (!['ready_for_guidance', 'ready_for_handoff'].includes(readinessDecision)) {
      throw new Error('案件尚未达到可交接状态，不能创建线索。');
    }
    const qualificationPlan = evaluateLegalLeadQualification(readinessDecision, leadState);
    if (qualificationPlan.decision !== 'qualified' || !qualificationPlan.mayCollectContact) {
      throw new Error('线索资格或明确授权条件不完整，未保存任何联系方式。');
    }

    const { qualification, consent, contact } = leadState;
    if (
      qualification?.consultationIntent !== 'interested' ||
      !qualification.region?.trim() ||
      !qualification.urgency || qualification.urgency === 'unknown' ||
      !qualification.materialsStatus || qualification.materialsStatus === 'unknown' ||
      !consent?.authorizedScope?.includes('case_summary') ||
      !contact?.preferredMethod || contact.preferredMethod === 'unknown' ||
      !contact.contactValue || !isValidContact(contact.preferredMethod, contact.contactValue)
    ) {
      throw new Error('必需的线索资格信息或联系方式校验未通过，未保存任何联系方式。');
    }
    const threadId = context.agent?.threadId;
    if (!threadId) {
      throw new Error('缺少稳定的对话标识，无法安全执行幂等线索创建。请从有持久对话的 Agent 会话调用。');
    }

    const record = await createLegalLeadRecord({
      idempotencyKey: `${threadId}:legal-lead-v1`,
      readinessDecision,
      qualification,
      consent,
      contact: { ...contact, contactValue: contact.contactValue.trim() },
      caseSummary: caseSummary.trim(),
    });
    return {
      created: !record.duplicate,
      leadId: record.id,
      status: record.status,
      createdAt: record.createdAt,
      message: record.duplicate
        ? '该对话的线索已存在，未重复创建；当前状态为人工审核队列。'
        : '线索已保存并进入人工审核队列，尚未分配律师或建立委托关系。',
    };
  },
});
