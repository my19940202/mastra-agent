/** Keeps contact-card decisions outside model-editable working memory. */
import { z } from 'zod';

const leadThreadStateSchema = z.object({
  status: z.enum(['declined', 'submitted']).optional(),
  leadId: z.string().min(1).optional(),
});

export type LeadThreadState = z.infer<typeof leadThreadStateSchema>;

export type LeadThreadMemory = {
  getThreadById(args: { threadId: string }): Promise<{ metadata?: Record<string, unknown> } | null>;
  updateThread(args: { id: string; metadata: Record<string, unknown> }): Promise<unknown>;
  getWorkingMemory(args: { threadId: string; resourceId: string }): Promise<string | null>;
};

export async function readLeadThreadState(
  memory: LeadThreadMemory,
  ids: { thread: string; resource: string },
): Promise<LeadThreadState> {
  const thread = await memory.getThreadById({ threadId: ids.thread });
  const current = leadThreadStateSchema.safeParse(thread?.metadata?.legalLeadCard);
  if (current.success && (current.data.status || current.data.leadId)) return current.data;

  // Existing conversations stored these fields in working memory. Only known
  // status values are migrated; newly generated memory cannot write these keys.
  const raw = await memory.getWorkingMemory({ threadId: ids.thread, resourceId: ids.resource });
  if (!raw) return {};
  let legacy: unknown;
  try { legacy = JSON.parse(raw); } catch { return {}; }
  if (!legacy || typeof legacy !== 'object' || Array.isArray(legacy)) return {};
  const record = legacy as Record<string, unknown>;
  const parsed = leadThreadStateSchema.safeParse({
    status: record.leadOfferStatus,
    leadId: record.leadId,
  });
  if (!parsed.success || !parsed.data.status && !parsed.data.leadId) return {};
  if (thread) await writeLeadThreadState(memory, ids, parsed.data);
  return parsed.data;
}

export async function writeLeadThreadState(
  memory: LeadThreadMemory,
  ids: { thread: string; resource: string },
  state: LeadThreadState,
): Promise<void> {
  const thread = await memory.getThreadById({ threadId: ids.thread });
  if (!thread) throw new Error('当前会话不存在。');
  await memory.updateThread({
    id: ids.thread,
    metadata: { ...thread.metadata, legalLeadCard: leadThreadStateSchema.parse(state) },
  });
}
