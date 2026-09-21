import { z } from 'zod';

export const consultationIntentSchema = z.enum(['unknown', 'interested', 'not_interested']);
export const leadUrgencySchema = z.enum(['unknown', 'normal', 'soon', 'urgent']);
export const materialsStatusSchema = z.enum([
  'unknown',
  'none',
  'some_available',
  'mostly_ready',
]);
export const leadQualificationStatusSchema = z.enum([
  'not_started',
  'awaiting_interest',
  'awaiting_consent',
  'collecting_details',
  'qualified',
  'declined',
  'not_eligible',
]);

/** 线索资格只记录服务匹配信息，不保存联系方式或授权记录。 */
export const legalLeadQualificationSchema = z.object({
  serviceNeed: z.string().optional(),
  urgency: leadUrgencySchema.optional(),
  region: z.string().optional(),
  materialsStatus: materialsStatusSchema.optional(),
  consultationIntent: consultationIntentSchema.optional(),
  qualificationStatus: leadQualificationStatusSchema.optional(),
});

/** 授权记录与案件事实、联系方式分离，避免用“愿意咨询”代替明确授权。 */
export const legalLeadConsentSchema = z.object({
  status: z.enum(['unknown', 'pending', 'granted', 'declined', 'withdrawn']).optional(),
  purposeVersion: z.literal('legal-consultation-contact-v1').optional(),
  authorizedScope: z
    .array(
      z.enum([
        'case_summary',
        'service_need',
        'region',
        'materials_status',
        'contact_details',
      ]),
    )
    .optional(),
  userStatement: z.string().optional(),
});

/** 联系方式单独存放；阶段 6 只采集到内存，阶段 7 才实现持久化。 */
export const legalLeadContactSchema = z.object({
  preferredMethod: z.enum(['unknown', 'phone', 'wechat', 'email', 'other']).optional(),
  contactValue: z.string().optional(),
  preferredContactTime: z.string().optional(),
});

export const legalLeadStateSchema = z.object({
  qualification: legalLeadQualificationSchema.optional(),
  consent: legalLeadConsentSchema.optional(),
  contact: legalLeadContactSchema.optional(),
});

export const legalLeadStateInputSchema = legalLeadStateSchema
  .extend({
    qualification: legalLeadQualificationSchema.catchall(z.unknown()).optional(),
    consent: legalLeadConsentSchema.catchall(z.unknown()).optional(),
    contact: legalLeadContactSchema.catchall(z.unknown()).optional(),
  })
  .catchall(z.unknown())
  .transform(value => legalLeadStateSchema.parse(value));

export type LegalLeadState = z.infer<typeof legalLeadStateSchema>;
