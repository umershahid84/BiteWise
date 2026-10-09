// The admin team: admins and admin employees ('support'), against the local database. Emails are captured.
import { describe, expect, it, vi } from 'vitest';
import type { Email } from '@/lib/email/send';

const sent: Email[] = [];
vi.mock('@/lib/email/send', () => ({ sendEmail: vi.fn(async (e: Email) => { sent.push(e); return true; }), emailConfigured: () => true }));

const { addTeamMember, checkTeamRemoval, listTeam, updateTeamMember } = await import('@/lib/team');
const { admin, anon, supabaseAvailable, uid } = await import('../support/db');
const available = await supabaseAvailable();

describe.skipIf(!available)('admin team', () => {
  it('adds admins and employees, sets who may refund, and always keeps one admin', async () => {
    const db = admin();
    const boss = (await db.from('profiles').select('id').eq('role', 'admin').eq('status', 'active').limit(1).single()).data!;
    const username = `t_${uid()}`;
    const email = `${username}@example.com`;
    sent.length = 0;
    const id = await addTeamMember(boss.id, { email, username, password: 'teampass1', role: 'support', canRefund: false });
    expect((await db.from('profiles').select('role, can_refund').eq('id', id).single()).data).toEqual({ role: 'support', can_refund: false });
    expect(sent.at(-1)).toMatchObject({ to: email });
    expect(sent.at(-1)?.text).not.toContain('teampass1');
    expect((await listTeam()).find((m) => m.id === id)).toMatchObject({ role: 'support', canRefund: false, username });
    // Their own log-in works; terms aren't asked of them; admin-only tables stay closed to them (row-level security).
    const client = anon();
    expect((await client.auth.signInWithPassword({ email, password: 'teampass1' })).error).toBeNull();
    expect((await client.rpc('pending_terms')).data).toEqual([]);
    expect((await client.from('audit_log').select('id').limit(1)).data).toEqual([]);

    await updateTeamMember(boss.id, id, { role: 'support', canRefund: true });
    expect((await db.from('profiles').select('can_refund').eq('id', id).single()).data?.can_refund).toBe(true);
    await updateTeamMember(boss.id, id, { role: 'admin', canRefund: false });
    expect((await db.from('profiles').select('role, can_refund').eq('id', id).single()).data).toEqual({ role: 'admin', can_refund: true });

    await expect(updateTeamMember(boss.id, boss.id, { role: 'support', canRefund: false })).rejects.toThrow(/your own admin access/);
    await expect(checkTeamRemoval(boss.id, boss.id)).rejects.toThrow(/your own account/);
    await expect(addTeamMember(boss.id, { email, username: `t_${uid()}`, password: 'teampass1', role: 'support', canRefund: false })).rejects.toThrow(/already uses/);
    // A forged invite can't make an account an admin.
    const forged = await anon().auth.signUp({ email: `t_${uid()}@example.com`, password: 'teampass1', options: { data: { username: `t_${uid()}`, team_invite: 'a'.repeat(64) } } });
    expect(forged.error).not.toBeNull();
  });
});
