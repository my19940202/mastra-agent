import { z } from 'zod';

const questionOptionSchema = z.object({
  label: z.string(),
  description: z.string().optional(),
});

export const questionPresentationSchema = z.discriminatedUnion('control', [
  z.object({
    control: z.literal('text'),
    options: z.array(questionOptionSchema).max(0),
  }),
  z.object({
    control: z.literal('single_select'),
    options: z.array(questionOptionSchema).min(2).max(4),
  }),
  z.object({
    control: z.literal('multi_select'),
    options: z.array(questionOptionSchema).min(2).max(4),
  }),
]);

export type QuestionPresentation = z.infer<typeof questionPresentationSchema>;

const textPresentation: QuestionPresentation = {
  control: 'text',
  options: [],
};

const yesNoUnknownPresentation: QuestionPresentation = {
  control: 'single_select',
  options: [{ label: '是' }, { label: '否' }, { label: '不确定' }],
};

const presentations: Record<string, QuestionPresentation> = {
  scenario: {
    control: 'single_select',
    options: [
      { label: '离婚或夫妻财产' },
      { label: '彩礼或婚约财产' },
      { label: '继承或家庭财产' },
    ],
  },
  'safety.currentlySafe': {
    control: 'single_select',
    options: [
      { label: '是，我目前安全' },
      { label: '否，我目前不安全' },
      { label: '不确定' },
    ],
  },
  'divorce.livingTogether': yesNoUnknownPresentation,
  'divorce.hasChildren': yesNoUnknownPresentation,
  'divorce.separated': yesNoUnknownPresentation,
  'divorce.divorceApproach': {
    control: 'single_select',
    options: [{ label: '协议离婚' }, { label: '诉讼离婚' }, { label: '暂不确定' }],
  },
  'divorce.spousePosition': {
    control: 'single_select',
    options: [{ label: '同意离婚' }, { label: '不同意离婚' }, { label: '态度不明确' }],
  },
  'divorce.sharedProperty': yesNoUnknownPresentation,
  'divorce.sharedDebt': yesNoUnknownPresentation,
  'bridePriceDispute.partyRole': {
    control: 'single_select',
    options: [{ label: '给付方' }, { label: '接收方' }, { label: '相关父母' }],
  },
  'bridePriceDispute.marriageRegistered': yesNoUnknownPresentation,
  'bridePriceDispute.marriageEnded': yesNoUnknownPresentation,
  'bridePriceDispute.livedTogether': yesNoUnknownPresentation,
  'bridePriceDispute.dowryDetails': yesNoUnknownPresentation,
  'bridePriceDispute.pregnancyOrChildren': {
    control: 'single_select',
    options: [
      { label: '有相关情况' },
      { label: '没有相关情况' },
      { label: '不确定或不愿回答' },
    ],
  },
  'inheritance.scenarioSubtype': {
    control: 'single_select',
    options: [{ label: '亲人去世后的继承' }, { label: '亲人健在时的家庭财产' }],
  },
  'inheritance.hasWill': yesNoUnknownPresentation,
  'inheritance.agreementsOrGifts': yesNoUnknownPresentation,
  'qualification.consultationIntent': {
    control: 'single_select',
    options: [{ label: '希望律师进一步联系' }, { label: '暂不需要律师联系' }],
  },
  'consent.status': {
    control: 'single_select',
    options: [{ label: '我明确同意上述用途和范围' }, { label: '我不同意' }],
  },
  'qualification.urgency': {
    control: 'single_select',
    options: [
      { label: '一般安排即可' },
      { label: '希望近期联系' },
      { label: '情况紧急，希望尽快联系' },
    ],
  },
  'qualification.materialsStatus': {
    control: 'single_select',
    options: [{ label: '尚未整理' }, { label: '已有一部分' }, { label: '基本齐全' }],
  },
  'contact.preferredMethod': {
    control: 'single_select',
    options: [{ label: '电话' }, { label: '微信' }, { label: '电子邮箱' }, { label: '其他方式' }],
  },
};

/**
 * 将业务字段稳定映射为 Studio 的提问控件。未列入映射的开放性字段默认使用文本输入，
 * 这样新增时长、原因或地点字段时不会被模型错误地渲染成选择题。
 */
export function getQuestionPresentation(nextField: string | null): QuestionPresentation | null {
  if (!nextField) return null;
  return presentations[nextField] ?? textPresentation;
}
