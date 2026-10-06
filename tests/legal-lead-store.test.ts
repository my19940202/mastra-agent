/** Verifies the read-only lead queries against the local LibSQL adapter. */
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

const directory = mkdtempSync(join(tmpdir(), 'mastra-leads-'));
process.env.MASTRA_STORAGE_BACKEND = 'libsql';
process.env.TURSO_DATABASE_URL = `file:${join(directory, 'leads.db')}`;

const { createLegalLeadRecord, getLegalLead, listLegalLeads } = await import('../src/mastra/legal-lead-store.ts');

test('lists leads and returns lead details with audit records', async () => {
  try {
    const created = await createLegalLeadRecord({
      idempotencyKey: 'lead-list-test',
      readinessDecision: 'ready_for_handoff',
      qualification: { region: '杭州', urgency: 'soon' },
      consent: { status: 'granted', userStatement: '我同意' },
      contact: { preferredMethod: 'phone', contactValue: 'test-number' },
      caseSummary: '测试案件摘要',
    });

    const leads = await listLegalLeads();
    assert.equal(leads.length, 1);
    assert.equal(leads[0].id, created.id);
    assert.equal(leads[0].caseSummary, '测试案件摘要');
    assert.equal('contact' in leads[0], false);

    const detail = await getLegalLead(created.id);
    assert.deepEqual(detail?.contact, { preferredMethod: 'phone', contactValue: 'test-number' });
    assert.deepEqual(detail?.consent, { status: 'granted', userStatement: '我同意' });
    assert.equal(detail?.audit.length, 1);
    assert.equal(detail?.audit[0].event, 'lead_created');
    assert.equal(await getLegalLead('missing-id'), null);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
