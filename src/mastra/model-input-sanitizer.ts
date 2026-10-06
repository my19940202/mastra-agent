/** Cleans malformed optional model fields before strict business validation. */
import { z } from 'zod';

type ObjectSchema = z.ZodObject<z.ZodRawShape>;

export function sanitizeOptionalModelFields(
  value: unknown,
  schema: ObjectSchema,
  nested: Record<string, ObjectSchema> = {},
): unknown {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value;

  const source = value as Record<string, unknown>;
  const clean: Record<string, unknown> = {};
  for (const [key, rawField] of Object.entries(schema.shape)) {
    const field = rawField as z.ZodType;
    if (!(key in source)) continue;
    let candidate = source[key];
    if (key === 'safety' && candidate && typeof candidate === 'object' && !Array.isArray(candidate)) {
      const safety = { ...candidate } as Record<string, unknown>;
      for (const safetyKey of ['immediateDanger', 'currentlySafe', 'domesticViolence', 'childSafetyConcern']) {
        if (typeof safety[safetyKey] === 'boolean') safety[safetyKey] = safety[safetyKey] ? '是' : '否';
      }
      candidate = safety;
    }
    if (nested[key] && candidate && typeof candidate === 'object' && !Array.isArray(candidate)) {
      candidate = sanitizeOptionalModelFields(candidate, nested[key]);
    }
    if (field.safeParse(candidate).success || !field.isOptional()) clean[key] = candidate;
  }
  return clean;
}
