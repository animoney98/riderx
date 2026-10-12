import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { supabaseServer } from '@/lib/supabase-server';
import { loadSetting } from '@/lib/week-data';

async function save(formData: FormData) {
  'use server';
  const acct = String(formData.get('debit') ?? '').replace(/\s/g, '');
  if (!/^[0-9]{6,20}$/.test(acct)) redirect('/settings?error=Account+number+must+be+digits+only');
  const sb = await supabaseServer();
  const { data: auth } = await sb.auth.getUser();
  const { error } = await sb.from('app_settings').upsert({ key: 'bank_debit_account', value: acct, updated_by: auth.user?.id, updated_at: new Date().toISOString() });
  if (error) redirect('/settings?error=Could+not+save.+Only+finance+managers+and+admins+can+change+this');
  await sb.from('audit_logs').insert({ action: 'settings.debit_account', entity_type: 'setting', entity_id: 'bank_debit_account', after_values: { last4: acct.slice(-4) } });
  revalidatePath('/settings');
  redirect('/settings?saved=1');
}

export default async function SettingsPage({ searchParams }: { searchParams: Promise<{ error?: string; saved?: string }> }) {
  const { error, saved } = await searchParams;
  const sb = await supabaseServer();
  const current = await loadSetting(sb, 'bank_debit_account');
  return (
    <>
      <div>
        <div className="note" style={{ textTransform: 'uppercase', letterSpacing: '.04em', fontWeight: 600 }}>Bank Settings</div>
        <h1>Bank file settings</h1>
      </div>
      {error && <div className="alert bad" role="alert">{error}</div>}
      {saved && <div className="alert ok">Saved.</div>}
      <form action={save} className="card">
        <h2>Company debit account</h2>
        <div className="row">
          <label>IDFC FIRST Bank account number to pay from<input name="debit" required inputMode="numeric" defaultValue={current ?? ''} /></label>
          <button type="submit">Save</button>
        </div>
        <p className="note">This goes in the “Debit Account Number” column of the bank file. It must be an IDFC FIRST Bank account that you can make transactions from.</p>
      </form>
    </>
  );
}
