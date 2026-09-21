import type { FamilyLegalIntakeMemory } from './legal-intake-schema';

function mergeStringLists(previous?: string[], incoming?: string[]): string[] | undefined {
  if (!previous && !incoming) return undefined;
  return [...new Set([...(previous ?? []), ...(incoming ?? [])])];
}

/** 把自动恢复提取的本轮事实补丁合并进 Workflow 已持久化的案件状态。 */
export function mergeLegalIntakeCaseState(
  previous: FamilyLegalIntakeMemory | undefined,
  incoming: FamilyLegalIntakeMemory,
): FamilyLegalIntakeMemory {
  const merged: FamilyLegalIntakeMemory = {
    ...(previous ?? {}),
    ...incoming,
    confirmedFacts: mergeStringLists(previous?.confirmedFacts, incoming.confirmedFacts),
    unknownFacts: mergeStringLists(previous?.unknownFacts, incoming.unknownFacts),
    disputedFacts: mergeStringLists(previous?.disputedFacts, incoming.disputedFacts),
    declinedFacts: mergeStringLists(previous?.declinedFacts, incoming.declinedFacts),
  };

  for (const key of ['safety', 'divorce', 'bridePriceDispute', 'inheritanceFamilyProperty'] as const) {
    const nextValue = incoming[key];
    if (nextValue === null) {
      merged[key] = null;
    } else if (nextValue !== undefined) {
      merged[key] = { ...(previous?.[key] ?? {}), ...nextValue } as never;
    }
  }

  return merged;
}
