import type { LegalLeadState } from './legal-lead-schema';

export type CaseReadinessDecision =
  | 'needs_more_information'
  | 'ready_for_guidance'
  | 'ready_for_handoff'
  | 'safety_priority'
  | 'out_of_scope';

export type LegalLeadPlan = {
  decision:
    | 'not_eligible'
    | 'ask_consultation_interest'
    | 'request_explicit_consent'
    | 'collect_qualification_detail'
    | 'collect_contact_method'
    | 'collect_contact_value'
    | 'qualified'
    | 'declined';
  qualificationStatus:
    | 'not_started'
    | 'awaiting_interest'
    | 'awaiting_consent'
    | 'collecting_details'
    | 'qualified'
    | 'declined'
    | 'not_eligible';
  nextField: string | null;
  nextQuestion: string | null;
  reason: string;
  responseRequirements: string[];
  mayCollectContact: boolean;
};

const questions = {
  consultationIntent:
    '如果你愿意，可以进入律师咨询联系流程；你是否希望由律师进一步联系了解情况？',
  consent:
    '为安排后续律师咨询，需要将你已提供的案件摘要、所在地区、咨询需求、材料情况以及你随后自愿提供的联系方式，用于咨询匹配和联系；你可以拒绝或之后撤回，不同意不影响继续获取一般信息。你是否明确同意上述用途和范围？',
  region: '为了匹配可能适合的本地法律服务，你所在的省或城市是哪里？',
  urgency: '你希望多久内获得律师的进一步联系？',
  materialsStatus: '与案件有关的材料目前是尚未整理、已有一部分，还是基本齐全？',
  preferredMethod: '你希望律师通过电话、微信、电子邮箱还是其他方式联系？',
  contactValue: '请提供你刚才选择的联系方式；只需提供用于本次咨询联系的号码或账号。',
} as const;

function hasValue(value: unknown): boolean {
  return typeof value === 'string' && value.trim().length > 0;
}

function hasCompleteConsentRecord(state: LegalLeadState): boolean {
  const consent = state.consent;
  const requiredScope = [
    'case_summary',
    'service_need',
    'region',
    'materials_status',
    'contact_details',
  ];
  return (
    consent?.status === 'granted' &&
    consent.purposeVersion === 'legal-consultation-contact-v1' &&
    hasValue(consent.userStatement) &&
    requiredScope.every(item => consent.authorizedScope?.includes(item as never))
  );
}

function plan(
  decision: LegalLeadPlan['decision'],
  qualificationStatus: LegalLeadPlan['qualificationStatus'],
  nextField: string | null,
  nextQuestion: string | null,
  reason: string,
  mayCollectContact: boolean,
  responseRequirements: string[],
): LegalLeadPlan {
  return {
    decision,
    qualificationStatus,
    nextField,
    nextQuestion,
    reason,
    mayCollectContact,
    responseRequirements,
  };
}

export function evaluateLegalLeadQualification(
  caseReadinessDecision: CaseReadinessDecision,
  state: LegalLeadState,
): LegalLeadPlan {
  if (!['ready_for_guidance', 'ready_for_handoff'].includes(caseReadinessDecision)) {
    return plan('not_eligible', 'not_eligible', null, null,
      '案件仍需补充事实、存在安全优先事项或不在服务范围内，当前不进入线索采集。', false,
      ['继续原案件流程', '不得询问或暗示用户提供联系方式']);
  }

  const qualification = state.qualification ?? {};
  const consent = state.consent ?? {};
  const contact = state.contact ?? {};
  const intent = qualification.consultationIntent ?? 'unknown';

  if (intent === 'unknown') {
    return plan('ask_consultation_interest', 'awaiting_interest',
      'qualification.consultationIntent', questions.consultationIntent,
      '案件信息已基本充分，但用户尚未表达是否希望进入律师联系流程。', false,
      ['原样使用 nextQuestion', '明确这是可选项，不影响继续获取一般法律信息']);
  }
  if (intent === 'not_interested') {
    return plan('declined', 'declined', null, null, '用户不希望进入律师联系流程。', false,
      ['确认尊重用户选择', '停止线索采集，不再索取授权或联系方式']);
  }
  if (consent.status === 'declined' || consent.status === 'withdrawn') {
    return plan('declined', 'declined', null, null,
      consent.status === 'withdrawn' ? '用户已撤回授权。' : '用户未同意线索用途和授权范围。', false,
      ['确认停止线索采集', '不得继续询问联系方式']);
  }
  if (!hasCompleteConsentRecord(state)) {
    return plan('request_explicit_consent', 'awaiting_consent', 'consent.status', questions.consent,
      consent.status === 'granted'
        ? '授权记录缺少用途版本、完整授权范围或用户明确同意的原话，不能开始联系方式采集。'
        : '用户有律师咨询意愿，但尚未对具体用途和范围作出明确授权。', false,
      ['完整说明用途、范围、拒绝权和撤回权', '原样使用 nextQuestion', '沉默或含糊回答不得视为同意']);
  }
  if (!hasValue(qualification.region)) {
    return plan('collect_qualification_detail', 'collecting_details', 'qualification.region', questions.region,
      '已获得明确授权，需要补充服务地区。', true,
      ['原样使用 nextQuestion', '只要求省或城市，不要求完整住址']);
  }
  if (!qualification.urgency || qualification.urgency === 'unknown') {
    return plan('collect_qualification_detail', 'collecting_details', 'qualification.urgency', questions.urgency,
      '已获得明确授权，需要了解联系紧迫程度。', true,
      ['原样使用 nextQuestion', '不得制造紧迫感或承诺联系时间']);
  }
  if (!qualification.materialsStatus || qualification.materialsStatus === 'unknown') {
    return plan('collect_qualification_detail', 'collecting_details',
      'qualification.materialsStatus', questions.materialsStatus,
      '已获得明确授权，需要了解材料准备情况。', true,
      ['原样使用 nextQuestion', '不要求用户在对话中上传证件原件或完整敏感材料']);
  }
  if (!contact.preferredMethod || contact.preferredMethod === 'unknown') {
    return plan('collect_contact_method', 'collecting_details', 'contact.preferredMethod', questions.preferredMethod,
      '授权和资格信息已具备，可以询问用户偏好的联系方式类型。', true,
      ['原样使用 nextQuestion', '本轮不要同时索取具体号码或账号']);
  }
  if (!hasValue(contact.contactValue)) {
    return plan('collect_contact_value', 'collecting_details', 'contact.contactValue', questions.contactValue,
      '用户已选择联系方式类型，可以在授权范围内收集对应联系方式。', true,
      ['原样使用 nextQuestion', '不得要求身份证号、银行卡号或完整住址']);
  }

  return plan('qualified', 'qualified', null, null,
    '案件充分度、咨询意愿、明确授权、资格信息和联系方式均已具备。', true,
    ['说明当前仅完成线索信息整理，尚未创建委托关系', '阶段 6 不执行数据库保存或实际外部联系']);
}
