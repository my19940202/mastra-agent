/** Handles the mini program's optional contact card outside the legal agent. */
import { z } from 'zod';
import {
  familyLegalWorkingMemorySchema,
  type FamilyLegalIntakeMemory,
} from './legal-intake-schema';
import { evaluateCaseReadiness } from './tools/evaluate-case-readiness-tool';
import { isValidContact } from './tools/create-legal-lead-tool';
import { createLegalLeadRecord, transitionLegalLead } from './legal-lead-store';
import {
  readLeadThreadState,
  writeLeadThreadState,
  type LeadThreadMemory,
  type LeadThreadState,
} from './lead-thread-state';

export const leadCardRequestSchema = z.object({
  memory: z.object({
    thread: z.string().min(1),
    resource: z.string().min(1),
  }),
  action: z.enum(['submit', 'decline', 'withdraw']),
  method: z.enum(['phone', 'wechat']).optional(),
  contactValue: z.string().optional(),
  consent: z.literal(true).optional(),
});

export type LeadCardRequest = z.infer<typeof leadCardRequestSchema>;

type LeadMemory = LeadThreadMemory & {
  getWorkingMemory(args: { threadId: string; resourceId: string }): Promise<string | null>;
  updateWorkingMemory(args: {
    threadId: string;
    resourceId: string;
    workingMemory: string;
  }): Promise<void>;
  recall(args: { threadId: string; perPage: false }): Promise<{ messages: Array<{ role: string }> }>;
};

export async function readLeadCaseState(
  memory: LeadMemory,
  ids: LeadCardRequest['memory'],
): Promise<FamilyLegalIntakeMemory> {
  const raw = await memory.getWorkingMemory({ threadId: ids.thread, resourceId: ids.resource });
  if (!raw) return {};
  try {
    return familyLegalWorkingMemorySchema.parse(JSON.parse(raw));
  } catch {
    return {};
  }
}

export function canOfferLeadCard(
  state: FamilyLegalIntakeMemory,
  userTurns: number,
  leadState: LeadThreadState = {},
): boolean {
  if (userTurns < 3 || leadState.leadId || leadState.status) return false;
  if (!state.scenario || ['unknown', 'out_of_scope'].includes(state.scenario)) return false;
  if (!state.userGoal?.trim() || state.pendingScenario && state.pendingScenario !== 'none') return false;
  if (state.leadQualification?.consultationIntent === 'not_interested') return false;
  if (['declined', 'withdrawn'].includes(state.leadConsent?.status ?? '')) return false;
  const decision = evaluateCaseReadiness(state).decision;
  return decision !== 'safety_priority' && decision !== 'out_of_scope';
}

export async function countConsultationTurns(memory: LeadMemory, threadId: string): Promise<number> {
  const result = await memory.recall({ threadId, perPage: false });
  return result.messages.filter(message => message.role === 'user').length;
}

export async function handleLeadCard(
  memory: LeadMemory,
  input: LeadCardRequest,
): Promise<{ status: 'declined' | 'submitted' | 'withdrawn'; leadId?: string; created?: boolean }> {
  const ids = input.memory;
  const state = await readLeadCaseState(memory, ids);
  const leadState = await readLeadThreadState(memory, ids);
  if (input.action === 'withdraw') {
    if (!leadState.leadId || leadState.status !== 'submitted') {
      throw new Error('当前对话没有可撤回的线索。');
    }
    await transitionLegalLead({
      leadId: leadState.leadId,
      toStatus: 'withdrawn',
      actor: 'user',
      details: { source: 'miniapp_contact_card' },
    });
    await writeLeadThreadState(memory, ids, { ...leadState, status: 'declined' });
    return { status: 'withdrawn', leadId: leadState.leadId };
  }
  const turns = await countConsultationTurns(memory, ids.thread);
  if (leadState.leadId && input.action === 'submit') {
    return { status: 'submitted', leadId: leadState.leadId, created: false };
  }
  if (!canOfferLeadCard(state, turns, leadState)) {
    throw new Error('当前对话不符合律师联系卡的提交条件。');
  }

  if (input.action === 'decline') {
    await writeLeadThreadState(memory, ids, { status: 'declined' });
    return { status: 'declined' };
  }

  if (input.consent !== true || !input.method || !input.contactValue?.trim()) {
    throw new Error('请先明确同意用途和范围，并填写联系方式。');
  }
  if (
    !isValidContact(input.method, input.contactValue) ||
    input.method === 'phone' && !/^1[3-9]\d{9}$/.test(input.contactValue.trim())
  ) {
    throw new Error(input.method === 'phone' ? '请输入有效的手机号。' : '请输入有效的微信号。');
  }

  const readinessDecision = evaluateCaseReadiness(state).decision;
  const qualification = {
    ...state.leadQualification,
    consultationIntent: 'interested' as const,
    qualificationStatus: 'qualified' as const,
  };
  const consent = {
    status: 'granted' as const,
    purposeVersion: 'legal-consultation-contact-v1' as const,
    authorizedScope: [
      'case_summary', 'service_need', 'region', 'materials_status', 'contact_details',
    ],
    userStatement: '我明确同意联系卡所列用途和范围',
  };
  const contact = { preferredMethod: input.method, contactValue: input.contactValue.trim() };
  const record = await createLegalLeadRecord({
    idempotencyKey: `${ids.thread}:legal-lead-v1`,
    readinessDecision,
    qualification,
    consent,
    contact,
    caseSummary: `${readinessDecision === 'needs_more_information' ? '案件事实尚未补齐。' : ''}场景：${state.scenario}；基本诉求：${state.userGoal?.trim()}。${(state.confirmedFacts ?? []).join('；')}`.slice(0, 20_000),
  });
  await writeLeadThreadState(memory, ids, { status: 'submitted', leadId: record.id });
  await memory.updateWorkingMemory({
    threadId: ids.thread,
    resourceId: ids.resource,
    workingMemory: JSON.stringify({
      ...state,
      leadQualification: qualification,
      leadConsent: consent,
      leadContact: contact,
    }),
  });
  return { status: 'submitted', leadId: record.id, created: !record.duplicate };
}
