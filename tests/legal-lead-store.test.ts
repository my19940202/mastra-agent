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
const { createLegalLeadTool, createLegalLeadInputSchema } = await import('../src/mastra/tools/create-legal-lead-tool.ts');
const { canOfferLeadCard, handleLeadCard } = await import('../src/mastra/miniapp-lead.ts');

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

    const earlyLeadInput = {
      caseState: {
        scenario: 'bride_price_dispute' as const,
        userGoal: '想了解彩礼能否返还',
      },
      leadState: {
        qualification: { consultationIntent: 'interested' as const },
        consent: {
          status: 'granted' as const,
          purposeVersion: 'legal-consultation-contact-v1' as const,
          authorizedScope: [
            'case_summary' as const,
            'service_need' as const,
            'region' as const,
            'materials_status' as const,
            'contact_details' as const,
          ],
          userStatement: '我同意用于律师联系',
        },
        contact: { preferredMethod: 'phone' as const, contactValue: '13800138000' },
      },
    };
    const context = { agent: { threadId: 'early-lead-test-thread' } } as any;
    const malformedInput = createLegalLeadInputSchema.parse({
      ...earlyLeadInput,
      leadState: {
        ...earlyLeadInput.leadState,
        consent: { ...earlyLeadInput.leadState.consent, purposeVersion: 'wrong-version' },
      },
    });
    assert.equal(malformedInput.leadState.consent?.purposeVersion, undefined);
    await assert.rejects(createLegalLeadTool.execute!(malformedInput, context), /资格或明确授权条件不完整/);
    assert.equal((await listLegalLeads()).length, 1);
    const first = await createLegalLeadTool.execute!(earlyLeadInput, context);
    const second = await createLegalLeadTool.execute!(earlyLeadInput, context);
    assert.equal(first.created, true);
    assert.equal(second.created, false);
    assert.equal(first.leadId, second.leadId);
    const earlyDetail = await getLegalLead(first.leadId);
    assert.equal(earlyDetail?.status, 'pending_review');
    assert.match(earlyDetail?.caseSummary ?? '', /案件事实尚未补齐/);
    assert.equal(earlyDetail?.audit.length, 1);
    assert.equal((await listLegalLeads()).length, 2);

    const cardCase = { scenario: 'bride_price_dispute' as const, userGoal: '想了解彩礼返还' };
    assert.equal(canOfferLeadCard(cardCase, 1), false);
    assert.equal(canOfferLeadCard(cardCase, 2), false);
    assert.equal(canOfferLeadCard(cardCase, 3), true);
    assert.equal(canOfferLeadCard({ scenario: 'out_of_scope', userGoal: '咨询合同' }, 3), false);
    assert.equal(canOfferLeadCard({ ...cardCase, safety: { immediateDanger: '是' } }, 3), false);

    function fakeMemory(initial = cardCase, turns = 3) {
      let stored = JSON.stringify(initial);
      return {
        getWorkingMemory: async () => stored,
        updateWorkingMemory: async ({ workingMemory }: { workingMemory: string }) => { stored = workingMemory; },
        recall: async () => ({ messages: Array.from({ length: turns }, () => ({ role: 'user' })) }),
        state: () => JSON.parse(stored),
      };
    }

    const cardMemory = fakeMemory();
    const cardInput = { memory: { thread: 'contact-card-thread', resource: 'contact-card-resource' } };
    await assert.rejects(handleLeadCard(cardMemory, {
      ...cardInput, action: 'submit', method: 'phone', contactValue: '13800138000',
    }), /明确同意/);
    await assert.rejects(handleLeadCard(cardMemory, {
      ...cardInput, action: 'submit', method: 'phone', contactValue: '123', consent: true,
    }), /有效的手机号/);
    assert.equal((await listLegalLeads()).length, 2);

    const submitted = await handleLeadCard(cardMemory, {
      ...cardInput, action: 'submit', method: 'phone', contactValue: '13800138000', consent: true,
    });
    assert.equal(submitted.status, 'submitted');
    assert.equal(submitted.created, true);
    assert.equal(cardMemory.state().leadId, submitted.leadId);
    const duplicate = await handleLeadCard(cardMemory, {
      ...cardInput, action: 'submit', method: 'phone', contactValue: '13800138000', consent: true,
    });
    assert.equal(duplicate.created, false);
    assert.equal(duplicate.leadId, submitted.leadId);
    assert.equal((await listLegalLeads()).length, 3);

    const wechatMemory = fakeMemory();
    await assert.rejects(handleLeadCard(wechatMemory, {
      memory: { thread: 'wechat-card-thread', resource: 'wechat-card-resource' },
      action: 'submit', method: 'wechat', contactValue: '123', consent: true,
    }), /有效的微信号/);
    const wechat = await handleLeadCard(wechatMemory, {
      memory: { thread: 'wechat-card-thread', resource: 'wechat-card-resource' },
      action: 'submit', method: 'wechat', contactValue: 'legal_wechat_01', consent: true,
    });
    assert.equal(wechat.status, 'submitted');
    assert.equal((await getLegalLead(wechat.leadId!))?.contact.contactValue, 'legal_wechat_01');
    const withdrawn = await handleLeadCard(wechatMemory, {
      memory: { thread: 'wechat-card-thread', resource: 'wechat-card-resource' },
      action: 'withdraw',
    });
    assert.equal(withdrawn.status, 'withdrawn');
    assert.equal((await getLegalLead(wechat.leadId!))?.status, 'withdrawn');
    assert.equal(canOfferLeadCard(wechatMemory.state(), 4), false);

    const declinedMemory = fakeMemory();
    const declined = await handleLeadCard(declinedMemory, {
      memory: { thread: 'declined-card-thread', resource: 'declined-card-resource' },
      action: 'decline',
    });
    assert.equal(declined.status, 'declined');
    assert.equal(canOfferLeadCard(declinedMemory.state(), 4), false);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
