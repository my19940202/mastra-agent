import { createClient } from '@libsql/client';
import { randomUUID } from 'node:crypto';

const url = process.env.TURSO_DATABASE_URL || 'file:./mastra.db';
const client = createClient({
  url,
  authToken: process.env.TURSO_AUTH_TOKEN || undefined,
});

export type LegalLeadRecord = {
  id: string;
  status: 'pending_review' | 'approved' | 'assigned' | 'contacted' | 'closed' | 'withdrawn';
  createdAt: string;
  duplicate: boolean;
};

let schemaReady: Promise<void> | undefined;

async function ensureSchema(): Promise<void> {
  schemaReady ??= (async () => {
    await client.batch([
      `CREATE TABLE IF NOT EXISTS legal_leads (
        id TEXT PRIMARY KEY,
        idempotency_key TEXT NOT NULL UNIQUE,
        status TEXT NOT NULL CHECK (status IN ('pending_review','approved','assigned','contacted','closed','withdrawn')),
        readiness_decision TEXT NOT NULL,
        qualification_json TEXT NOT NULL,
        consent_json TEXT NOT NULL,
        contact_json TEXT NOT NULL,
        case_summary TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )`,
      `CREATE TABLE IF NOT EXISTS legal_lead_audit (
        id TEXT PRIMARY KEY,
        lead_id TEXT NOT NULL REFERENCES legal_leads(id),
        event TEXT NOT NULL,
        from_status TEXT,
        to_status TEXT NOT NULL,
        actor TEXT NOT NULL,
        details_json TEXT NOT NULL,
        created_at TEXT NOT NULL
      )`,
      'CREATE INDEX IF NOT EXISTS legal_lead_audit_lead_id_idx ON legal_lead_audit(lead_id, created_at)',
    ], 'write');
  })().catch(error => {
    schemaReady = undefined;
    throw error;
  });
  return schemaReady;
}

/**
 * Persist a qualified lead and its initial audit event atomically. The stable
 * idempotency key is scoped to the conversation so retries cannot create a
 * second record for the same handoff.
 */
export async function createLegalLeadRecord(input: {
  idempotencyKey: string;
  readinessDecision: string;
  qualification: unknown;
  consent: unknown;
  contact: unknown;
  caseSummary: string;
}): Promise<LegalLeadRecord> {
  await ensureSchema();
  const now = new Date().toISOString();
  const id = randomUUID();
  const tx = await client.transaction('write');
  try {
    const result = await tx.execute({
      sql: `INSERT INTO legal_leads
        (id, idempotency_key, status, readiness_decision, qualification_json, consent_json, contact_json, case_summary, created_at, updated_at)
        VALUES (?, ?, 'pending_review', ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(idempotency_key) DO NOTHING`,
      args: [
        id,
        input.idempotencyKey,
        input.readinessDecision,
        JSON.stringify(input.qualification),
        JSON.stringify(input.consent),
        JSON.stringify(input.contact),
        input.caseSummary,
        now,
        now,
      ],
    });

    if (result.rowsAffected === 0) {
      const existing = await tx.execute({
        sql: 'SELECT id, status, created_at FROM legal_leads WHERE idempotency_key = ?',
        args: [input.idempotencyKey],
      });
      const row = existing.rows[0];
      if (!row) throw new Error('Lead idempotency conflict could not be resolved.');
      await tx.commit();
      return {
        id: String(row.id),
        status: String(row.status) as LegalLeadRecord['status'],
        createdAt: String(row.created_at),
        duplicate: true,
      };
    }

    await tx.execute({
      sql: `INSERT INTO legal_lead_audit
        (id, lead_id, event, from_status, to_status, actor, details_json, created_at)
        VALUES (?, ?, 'lead_created', NULL, 'pending_review', 'system', ?, ?)`,
      args: [randomUUID(), id, JSON.stringify({ readinessDecision: input.readinessDecision }), now],
    });
    await tx.commit();
    return { id, status: 'pending_review', createdAt: now, duplicate: false };
  } catch (error) {
    await tx.rollback();
    throw error;
  } finally {
    tx.close();
  }
}

/** Transition helper for a future authenticated human-review endpoint. */
export async function transitionLegalLead(input: {
  leadId: string;
  toStatus: LegalLeadRecord['status'];
  actor: string;
  details?: Record<string, unknown>;
}): Promise<void> {
  const allowed: Record<LegalLeadRecord['status'], LegalLeadRecord['status'][]> = {
    pending_review: ['approved', 'withdrawn', 'closed'],
    approved: ['assigned', 'withdrawn', 'closed'],
    assigned: ['contacted', 'withdrawn', 'closed'],
    contacted: ['closed', 'withdrawn'],
    closed: [],
    withdrawn: [],
  };
  await ensureSchema();
  const currentResult = await client.execute({
    sql: 'SELECT status FROM legal_leads WHERE id = ?',
    args: [input.leadId],
  });
  const current = currentResult.rows[0]?.status as LegalLeadRecord['status'] | undefined;
  if (!current) throw new Error('Legal lead was not found.');
  if (!allowed[current].includes(input.toStatus)) {
    throw new Error(`Illegal legal lead status transition: ${current} -> ${input.toStatus}`);
  }
  const now = new Date().toISOString();
  const tx = await client.transaction('write');
  try {
    const update = await tx.execute({
      sql: 'UPDATE legal_leads SET status = ?, updated_at = ? WHERE id = ? AND status = ?',
      args: [input.toStatus, now, input.leadId, current],
    });
    if (update.rowsAffected !== 1) throw new Error('Legal lead status changed concurrently; retry the transition.');
    await tx.execute({
      sql: `INSERT INTO legal_lead_audit
        (id, lead_id, event, from_status, to_status, actor, details_json, created_at)
        VALUES (?, ?, 'status_changed', ?, ?, ?, ?, ?)`,
      args: [randomUUID(), input.leadId, current, input.toStatus, input.actor, JSON.stringify(input.details ?? {}), now],
    });
    await tx.commit();
  } catch (error) {
    await tx.rollback();
    throw error;
  } finally {
    tx.close();
  }
}
