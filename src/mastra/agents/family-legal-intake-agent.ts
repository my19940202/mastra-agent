/** Configures the legal intake agent, its conversation rules, tools, and memory. */
import { Agent } from '@mastra/core/agent';
import { askUserTool } from '@mastra/core/tools';
import { Memory } from '@mastra/memory';
import { familyLegalWorkingMemorySchema } from '../legal-intake-schema';
import { legalIntakeWorkflow } from '../workflows/legal-intake-workflow';
import {
  legalIntakeHandoffDisclaimerScorer,
  legalIntakeNoAbsoluteConclusionScorer,
  legalIntakeSafetyScorer,
  legalIntakeSingleQuestionScorer,
} from '../scorers/legal-intake-scorers';

// The workflow owns question order; this prompt keeps only conversation rules.
const instructions = `
你是面向中国大陆用户的家庭法律预咨询助手，支持离婚/夫妻财产、彩礼/婚约财产、继承/家庭财产。温和、中立地梳理事实，提供有条件的一般法律信息；你不是律师，不保证个案结果。律师联系由小程序自愿联系卡处理，你不得索取手机号或微信号。

每轮按此顺序执行：
1. 从用户消息提取全部新事实，静默调用 updateWorkingMemory；不知道、拒答、前后冲突分别记入 unknownFacts、declinedFacts、disputedFacts，对应字段写 unknown 或 declined。只记录用户明确说过的事实，不猜测。
2. 把当前线程完整 Working Memory 作为 caseState 调用 legalIntakeWorkflow；ask_user 恢复后也从第 1 步重新运行，不要 resume Workflow。只有用户明确要求整理摘要、给律师看或按现有信息总结，才设 handoffRequested=true。
3. 按 workflow 的 stage、mode、responseRequirements 更新记忆并回复。ask_question 时，将 nextQuestion 原样交给 ask_user：text 只传 question；single_select/multi_select 原样传 options 和 selectionMode。卡片就是本轮回复，工具前不输出文字；不得自行改写问题、选项或分支决定。

每轮仅一次可见回复、最多一个问题和一个问号，不合并两个事实字段。普通文字先简短回应用户，再给条件性解释或按计划追问。用户直接问法律问题时先简答，再回到当前流程。信息足够时不为填满字段而追问。

普通自然语言回复以 350 个可见字符以内为目标，Markdown 标记不计入；这是精简目标，不得为凑字数截断必要信息。先回答核心问题，再用简短文字说明最相关的法律框架和会影响判断的关键争议点；删除重复解释、泛泛铺垫和不必要的背景。安全处理、紧急求助和用户明确要求的律师交接摘要不受此字数目标限制，以准确、完整和安全为先。

仅当普通文字回答需要用户补充事实时，才把补充问题从正文中分开：解释结束后空一行，单独一行写“**请补充确认**”，再空一行写唯一的补充问题。不要把问题接在免责声明或解释段落末尾。ask_question 模式仍严格只调用 ask_user 并让卡片成为本轮回复，不输出该标题或额外文字。

任何即时人身危险、家暴或儿童安全风险优先处理：确认是否安全；紧急时建议到安全地点、联系 110、可信亲友、妇联或法律援助。确认安全前暂停普通财产问答，不提供报复、隐匿或转移财产方案。

场景不清时只问属于上述哪一类；明显不支持时说明范围并建议对应专业人士。已有场景中提出新场景时，先写 pendingScenario 并单独确认；确认后重置 stage 和旧场景事实，清除旧分支对象，不能把旧事实带到新场景。

区分用户主张、待核实事项和已确认事实：亲属称谓、房屋归属、婚姻或继承资格不能自行推断；“骗婚”“诈骗”等只能记为用户怀疑。彩礼未登记不等于必然全返，共同生活或生育也不等于必然不返；综合事实说明可能方向，不计算返还比例。不编造法条、案例、胜诉概率、精确期限或费用；程序和地方差异提示由当地律师核实。避免绝对断言和不必要身份信息。

handoff 时按“已确认事实、未知/争议/拒答、可能法律方向、相关材料、下一步建议、向律师确认的 2—4 个问题”组织摘要。最后一段固定为：以上内容仅基于你目前提供的信息，属于一般法律信息参考，不构成正式法律意见。个案结果会受证据、时间、地区和完整事实影响，建议携带上述摘要及材料咨询当地执业律师。此后不再加问题或其他文字。

`;

// Agent 是 Mastra 中负责“理解消息并决定如何回复”的核心对象。
// model 使用 provider/model 格式；Mastra 会自动从环境变量 DEEPSEEK_API_KEY 读取密钥。
export const familyLegalIntakeAgent = new Agent({
  id: 'family-legal-intake-agent',
  name: '家庭法律预咨询助手',
  description:
    '通过逐轮追问梳理离婚、彩礼、继承与家庭财产问题，提供一般法律信息并生成律师咨询摘要。',
  metadata: {
    suggestedPrompts: [
      '我想离婚，但不知道应该先考虑哪些问题。',
      '我们没有登记结婚，但给过彩礼，现在想了解应该先理清哪些事实。',
      '父亲去世后留下一套房子，家里不知道应该怎么处理。',
      '家里的房产归属有争议，我想先把情况理清楚。',
    ],
  },
  instructions,
  model: 'deepseek/deepseek-flash',
  defaultOptions: {
    maxSteps: 8,
    autoResumeSuspendedTools: true,
    providerOptions: {
      deepseek: { thinking: { type: 'disabled' } },
    },
    onStepFinish: event => {
      const toolCalls = Array.isArray(event.toolCalls) ? event.toolCalls : [];
      if (process.env.NODE_ENV !== 'production') {
      // #region agent log
      fetch('http://127.0.0.1:7329/ingest/c35ee18f-ced6-4dfb-9939-f69ca388e4fa', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Debug-Session-Id': '2d9e32' },
        body: JSON.stringify({
          sessionId: '2d9e32',
          runId: 'post-fix',
          hypothesisId: 'E',
          location: 'family-legal-intake-agent.ts:onStepFinish',
          message: 'agent step finished',
          data: {
            reason: event.finishReason ?? null,
            textLength: typeof event.text === 'string' ? event.text.length : 0,
            toolNames: toolCalls.map(call => {
              if (call && typeof call === 'object' && 'payload' in call) {
                const payload = call.payload as { toolName?: string };
                return payload.toolName ?? 'unknown';
              }
              return 'unknown';
            }),
          },
          timestamp: Date.now(),
        }),
      }).catch(() => {});
      // #endregion
      }
    },
  },
  memory: new Memory({
    options: {
      generateTitle: true,
      workingMemory: {
        enabled: true,
        // thread 表示每个 Studio 对话各自保存一份案件信息，避免不同案件相互污染。
        // resource 则会跨多个对话共享，更适合长期用户画像，不适合本项目的敏感案件事实。
        scope: 'thread',
        schema: familyLegalWorkingMemorySchema,
      },
    },
  }),
  workflows: {
    legalIntakeWorkflow,
  },
  tools: {
    ask_user: askUserTool,
  },
  // 阶段 5：每次运行后异步评分。评分不改变回复，只把质量信号写入 Trace/Storage。
  scorers: {
    singleQuestion: {
      scorer: legalIntakeSingleQuestionScorer,
      sampling: { type: 'ratio', rate: 1 },
    },
    noAbsoluteConclusion: {
      scorer: legalIntakeNoAbsoluteConclusionScorer,
      sampling: { type: 'ratio', rate: 1 },
    },
    handoffDisclaimer: {
      scorer: legalIntakeHandoffDisclaimerScorer,
      sampling: { type: 'ratio', rate: 1 },
    },
    safetyPriority: {
      scorer: legalIntakeSafetyScorer,
      sampling: { type: 'ratio', rate: 1 },
    },
  },
  // 此 Agent 只配置确定性的案件 intake 工作流，不能搜索网页、读写文件或执行命令。
});
