import { createPool, type Pool, type RowDataPacket } from 'mysql2/promise';
import { createClient } from '@libsql/client';
import { createHash, randomUUID } from 'node:crypto';
import { getMysqlConnectionConfig } from './mysql-config';

const mysqlEnabled = process.env.MASTRA_STORAGE_BACKEND === 'mysql';
const mysqlConfig = mysqlEnabled ? getMysqlConnectionConfig() : undefined;
const mysqlPool: Pool | undefined = mysqlConfig
  ? createPool({
      ...mysqlConfig,
      ...(mysqlConfig.ssl === false ? { ssl: undefined } : { ssl: mysqlConfig.ssl }),
      waitForConnections: true,
      connectionLimit: Number(process.env.MYSQL_CONNECTION_LIMIT ?? 10),
      queueLimit: 0,
      charset: 'utf8mb4',
      timezone: 'Z',
    })
  : undefined;

const libsql = mysqlEnabled
  ? undefined
  : createClient({
      url: process.env.TURSO_DATABASE_URL || 'file:./mastra.db',
      authToken: process.env.TURSO_AUTH_TOKEN || undefined,
    });

export type LegalLeadStatus =
  | 'pending_review'
  | 'approved'
  | 'assigned'
  | 'contacted'
  | 'closed'
  | 'withdrawn';

export type LegalLeadRecord = {
  id: string;
  status: LegalLeadStatus;
  createdAt: string;
  duplicate: boolean;
};

const allowedTransitions: Record<LegalLeadStatus, LegalLeadStatus[]> = {
  pending_review: ['approved', 'withdrawn', 'closed'],
  approved: ['assigned', 'withdrawn', 'closed'],
  assigned: ['contacted', 'withdrawn', 'closed'],
  contacted: ['closed', 'withdrawn'],
  closed: [],
  withdrawn: [],
};

let schemaReady: Promise<void> | undefined;

async function ensureLibsqlSchema(): Promise<void> {
  await libsql!.batch([
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
}

async function ensureMysqlSchema(): Promise<void> {
  const pool = mysqlPool!;
  await pool.execute(`CREATE TABLE IF NOT EXISTS app_schema_migrations (
    version INT NOT NULL PRIMARY KEY,
    applied_at DATETIME(3) NOT NULL
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

  const [rows] = await pool.execute<(RowDataPacket & { version: number })[]>(
    'SELECT version FROM app_schema_migrations WHERE version = 1 LIMIT 1',
  );
  if (rows.length) return;

  // DDL is idempotent because MySQL implicitly commits schema changes. The
  // migration marker is written only after every table and index exists.
  await pool.execute(`CREATE TABLE IF NOT EXISTS legal_leads (
    id CHAR(36) NOT NULL PRIMARY KEY,
    idempotency_key CHAR(64) NOT NULL UNIQUE,
    status VARCHAR(32) NOT NULL,
    readiness_decision VARCHAR(40) NOT NULL,
    qualification_json JSON NOT NULL,
    consent_json JSON NOT NULL,
    contact_json JSON NOT NULL,
    case_summary MEDIUMTEXT NOT NULL,
    created_at DATETIME(3) NOT NULL,
    updated_at DATETIME(3) NOT NULL,
    INDEX legal_leads_created_at_idx (created_at)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
  await pool.execute(`CREATE TABLE IF NOT EXISTS legal_lead_audit (
    id CHAR(36) NOT NULL PRIMARY KEY,
    lead_id CHAR(36) NOT NULL,
    event VARCHAR(64) NOT NULL,
    from_status VARCHAR(32) NULL,
    to_status VARCHAR(32) NOT NULL,
    actor VARCHAR(191) NOT NULL,
    details_json JSON NOT NULL,
    created_at DATETIME(3) NOT NULL,
    INDEX legal_lead_audit_lead_id_idx (lead_id, created_at),
    CONSTRAINT legal_lead_audit_lead_fk FOREIGN KEY (lead_id) REFERENCES legal_leads(id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
  await pool.execute(
    'INSERT IGNORE INTO app_schema_migrations (version, applied_at) VALUES (1, UTC_TIMESTAMP(3))',
  );
}

/** Explicit startup migration; containers fail fast when DB access or DDL is unavailable. */
export async function initializeLegalLeadSchema(): Promise<void> {
  schemaReady ??= (mysqlEnabled ? ensureMysqlSchema() : ensureLibsqlSchema()).catch(error => {
    schemaReady = undefined;
    throw error;
  });
  return schemaReady;
}

export async function createLegalLeadRecord(input: {
  idempotencyKey: string;
  readinessDecision: string;
  qualification: unknown;
  consent: unknown;
  contact: unknown;
  caseSummary: string;
}): Promise<LegalLeadRecord> {
  await initializeLegalLeadSchema();
  const now = new Date();
  const nowIso = now.toISOString();
  const id = randomUUID();
  const idempotencyKey = mysqlEnabled
    ? createHash('sha256').update(input.idempotencyKey).digest('hex')
    : input.idempotencyKey;

  if (!mysqlEnabled) {
    const tx = await libsql!.transaction('write');
    try {
      const result = await tx.execute({
        sql: `INSERT INTO legal_leads
          (id, idempotency_key, status, readiness_decision, qualification_json, consent_json, contact_json, case_summary, created_at, updated_at)
          VALUES (?, ?, 'pending_review', ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(idempotency_key) DO NOTHING`,
        args: [id, idempotencyKey, input.readinessDecision, JSON.stringify(input.qualification),
          JSON.stringify(input.consent), JSON.stringify(input.contact), input.caseSummary, nowIso, nowIso],
      });
      if (result.rowsAffected === 0) {
        const existing = await tx.execute({
          sql: 'SELECT id, status, created_at FROM legal_leads WHERE idempotency_key = ?',
          args: [input.idempotencyKey],
        });
        const row = existing.rows[0];
        if (!row) throw new Error('Lead idempotency conflict could not be resolved.');
        await tx.commit();
        return { id: String(row.id), status: String(row.status) as LegalLeadStatus, createdAt: String(row.created_at), duplicate: true };
      }
      await tx.execute({
        sql: `INSERT INTO legal_lead_audit
          (id, lead_id, event, from_status, to_status, actor, details_json, created_at)
          VALUES (?, ?, 'lead_created', NULL, 'pending_review', 'system', ?, ?)`,
        args: [randomUUID(), id, JSON.stringify({ readinessDecision: input.readinessDecision }), nowIso],
      });
      await tx.commit();
      return { id, status: 'pending_review', createdAt: nowIso, duplicate: false };
    } catch (error) {
      await tx.rollback();
      throw error;
    } finally {
      tx.close();
    }
  }

  const connection = await mysqlPool!.getConnection();
  try {
    await connection.beginTransaction();
    await connection.execute(
      `INSERT INTO legal_leads
        (id, idempotency_key, status, readiness_decision, qualification_json, consent_json, contact_json, case_summary, created_at, updated_at)
        VALUES (?, ?, 'pending_review', ?, ?, ?, ?, ?, ?, ?)`,
      [id, idempotencyKey, input.readinessDecision, JSON.stringify(input.qualification),
        JSON.stringify(input.consent), JSON.stringify(input.contact), input.caseSummary, now, now],
    );
    await connection.execute(
      `INSERT INTO legal_lead_audit
        (id, lead_id, event, from_status, to_status, actor, details_json, created_at)
        VALUES (?, ?, 'lead_created', NULL, 'pending_review', 'system', ?, ?)`,
      [randomUUID(), id, JSON.stringify({ readinessDecision: input.readinessDecision }), now],
    );
    await connection.commit();
    return { id, status: 'pending_review', createdAt: nowIso, duplicate: false };
  } catch (error) {
    await connection.rollback();
    if ((error as { code?: string }).code === 'ER_DUP_ENTRY') {
      const [rows] = await connection.execute<(RowDataPacket & { id: string; status: LegalLeadStatus; created_at: Date })[]>(
        'SELECT id, status, created_at FROM legal_leads WHERE idempotency_key = ?',
        [idempotencyKey],
      );
      const row = rows[0];
      if (row) return { id: row.id, status: row.status, createdAt: new Date(row.created_at).toISOString(), duplicate: true };
    }
    throw error;
  } finally {
    connection.release();
  }
}

export async function transitionLegalLead(input: {
  leadId: string;
  toStatus: LegalLeadStatus;
  actor: string;
  details?: Record<string, unknown>;
}): Promise<void> {
  await initializeLegalLeadSchema();
  if (!mysqlEnabled) {
    const currentResult = await libsql!.execute({ sql: 'SELECT status FROM legal_leads WHERE id = ?', args: [input.leadId] });
    const current = currentResult.rows[0]?.status as LegalLeadStatus | undefined;
    if (!current) throw new Error('Legal lead was not found.');
    if (!allowedTransitions[current].includes(input.toStatus)) throw new Error(`Illegal legal lead status transition: ${current} -> ${input.toStatus}`);
    const now = new Date().toISOString();
    const tx = await libsql!.transaction('write');
    try {
      const updated = await tx.execute({ sql: 'UPDATE legal_leads SET status = ?, updated_at = ? WHERE id = ? AND status = ?', args: [input.toStatus, now, input.leadId, current] });
      if (updated.rowsAffected !== 1) throw new Error('Legal lead status changed concurrently; retry the transition.');
      await tx.execute({
        sql: `INSERT INTO legal_lead_audit (id, lead_id, event, from_status, to_status, actor, details_json, created_at)
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
    return;
  }

  const connection = await mysqlPool!.getConnection();
  try {
    await connection.beginTransaction();
    const [rows] = await connection.execute<(RowDataPacket & { status: LegalLeadStatus })[]>(
      'SELECT status FROM legal_leads WHERE id = ? FOR UPDATE', [input.leadId],
    );
    const current = rows[0]?.status;
    if (!current) throw new Error('Legal lead was not found.');
    if (!allowedTransitions[current].includes(input.toStatus)) throw new Error(`Illegal legal lead status transition: ${current} -> ${input.toStatus}`);
    const now = new Date();
    await connection.execute('UPDATE legal_leads SET status = ?, updated_at = ? WHERE id = ?', [input.toStatus, now, input.leadId]);
    await connection.execute(
      `INSERT INTO legal_lead_audit (id, lead_id, event, from_status, to_status, actor, details_json, created_at)
        VALUES (?, ?, 'status_changed', ?, ?, ?, ?, ?)`,
      [randomUUID(), input.leadId, current, input.toStatus, input.actor, JSON.stringify(input.details ?? {}), now],
    );
    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}
