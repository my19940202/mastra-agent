import { z } from 'zod';

export const legalScenarioSchema = z.enum([
  'unknown',
  'divorce',
  'bride_price_dispute',
  'inheritance_family_property',
  'out_of_scope',
]);

export const legalIntakeStageSchema = z.enum([
  'identify',
  'safety',
  'basic_facts',
  'core_facts',
  'guidance',
  'handoff',
]);

export const safetySchema = z.object({
  immediateDanger: z.string().optional(),
  currentlySafe: z.string().optional(),
  domesticViolence: z.string().optional(),
  childSafetyConcern: z.string().optional(),
  notes: z.string().optional(),
});

export const divorceSchema = z.object({
  marriageDuration: z.string().optional(),
  livingTogether: z.string().optional(),
  separated: z.string().optional(),
  separationDuration: z.string().optional(),
  separationReason: z.string().optional(),
  divorceApproach: z.string().optional(),
  spousePosition: z.string().optional(),
  hasChildren: z.string().optional(),
  childAges: z.string().optional(),
  custodyPreference: z.string().optional(),
  visitationPreference: z.string().optional(),
  childSupportSituation: z.string().optional(),
  sharedProperty: z.string().optional(),
  sharedDebt: z.string().optional(),
  specialCircumstances: z.string().optional(),
});

export const bridePriceDisputeSchema = z.object({
  partyRole: z.string().optional(),
  marriageRegistered: z.string().optional(),
  marriageRegistrationTime: z.string().optional(),
  marriageEnded: z.string().optional(),
  marriageEndTime: z.string().optional(),
  weddingHeld: z.string().optional(),
  livedTogether: z.string().optional(),
  cohabitationDuration: z.string().optional(),
  pregnancyOrChildren: z.string().optional(),
  propertyDetails: z.string().optional(),
  paymentTime: z.string().optional(),
  paymentMethod: z.string().optional(),
  payer: z.string().optional(),
  recipient: z.string().optional(),
  paymentPurpose: z.string().optional(),
  localCustom: z.string().optional(),
  currentPropertyStatus: z.string().optional(),
  propertyUse: z.string().optional(),
  dowryDetails: z.string().optional(),
  financialHardship: z.string().optional(),
  separationReason: z.string().optional(),
  currentDisputes: z.string().optional(),
  availableEvidence: z.string().optional(),
});

export const inheritanceFamilyPropertySchema = z.object({
  deathOccurred: z.string().optional(),
  deathTime: z.string().optional(),
  relationshipToUser: z.string().optional(),
  hasWill: z.string().optional(),
  willFormAndCustody: z.string().optional(),
  possibleHeirs: z.string().optional(),
  mainAssets: z.string().optional(),
  registeredOwner: z.string().optional(),
  assetContributions: z.string().optional(),
  agreementsOrGifts: z.string().optional(),
  knownDebt: z.string().optional(),
  currentControl: z.string().optional(),
  currentDispute: z.string().optional(),
});

export const familyLegalIntakeMemorySchema = z.object({
  scenario: legalScenarioSchema.optional(),
  pendingScenario: z
    .enum(['none', 'divorce', 'bride_price_dispute', 'inheritance_family_property'])
    .optional(),
  scenarioSubtype: z.enum(['unknown', 'inheritance_after_death', 'living_family_property']).optional(),
  stage: legalIntakeStageSchema.optional(),
  userGoal: z.string().optional(),
  confirmedFacts: z.array(z.string()).optional(),
  unknownFacts: z.array(z.string()).optional(),
  disputedFacts: z.array(z.string()).optional(),
  declinedFacts: z.array(z.string()).optional(),
  safety: safetySchema.nullable().optional(),
  divorce: divorceSchema.nullable().optional(),
  bridePriceDispute: bridePriceDisputeSchema.nullable().optional(),
  inheritanceFamilyProperty: inheritanceFamilyPropertySchema.nullable().optional(),
});

// LLM 生成 Tool 参数时，偶尔会补出 childrenCount、childGender 等合理但未声明的键。
// Tool 边界采用“宽进严出”：输入阶段允许额外键，transform 后立即按正式 Memory Schema
// 清洗并丢弃未知字段，避免一次多余键导致整个 Workflow 无法启动或恢复。
export const familyLegalIntakeInputSchema = familyLegalIntakeMemorySchema
  .extend({
    safety: safetySchema.catchall(z.unknown()).nullable().optional(),
    divorce: divorceSchema.catchall(z.unknown()).nullable().optional(),
    bridePriceDispute: bridePriceDisputeSchema.catchall(z.unknown()).nullable().optional(),
    inheritanceFamilyProperty: inheritanceFamilyPropertySchema
      .catchall(z.unknown())
      .nullable()
      .optional(),
  })
  .catchall(z.unknown())
  .transform(value => familyLegalIntakeMemorySchema.parse(value));

export const legalIntakeCaseStateEnvelopeSchema = z
  .object({
    caseState: familyLegalIntakeInputSchema,
    handoffRequested: z.boolean().optional(),
  })
  .catchall(z.unknown())
  .transform(({ caseState, handoffRequested }) => ({ caseState, handoffRequested }));

export type FamilyLegalIntakeMemory = z.infer<typeof familyLegalIntakeMemorySchema>;
