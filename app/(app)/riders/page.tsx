import Link from 'next/link';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { supabaseServer } from '@/lib/supabase-server';

async function addRider(formData: FormData) {
  'use server';
  const name = String(formData.get('name') ?? '').trim();
  const fe = String(formData.get('fe') ?? '').trim().toUpperCase();
  const phone = String(formData.get('phone') ?? '').trim();
  if (!name) redirect('/riders?error=Name+is+required');
  if (!/^FE\d+$/.test(fe)) redirect('/riders?error=FE+ID+must+look+like+FE12345678');
  if (phone && !/^\+?\d{10,13}$/.test(phone.replace(/[\s-]/g, ''))) redirect('/riders?error=Phone+number+looks+wrong');

  const sb = await supabaseServer();
  const { data: existing } = await sb.from('rider_platform_accounts').select('id').eq('platform', 'zomato').eq('platform_rider_id', fe).maybeSingle();
  if (existing) redirect('/riders?error=That+FE+ID+is+already+registered');

  const { data: rider, error } = await sb
    .from('riders')
    .insert({ full_name: name, phone: phone || null, status: 'active', onboarding_date: new Date().toISOString().slice(0, 10) })
    .select('id')
    .single();
  if (error || !rider) redirect('/riders?error=Could+not+add+rider.+Check+your+role+is+admin');
  const { error: e2 } = await sb.from('rider_platform_accounts').insert({ rider_id: rider.id, platform: 'zomato', platform_rider_id: fe });
  if (e2) {
    await sb.from('riders').delete().eq('id', rider.id); // no history yet, safe to undo
    redirect('/riders?error=Could+not+save+the+FE+ID');
  }
  await sb.from('audit_logs').insert({ action: 'rider.create', entity_type: 'rider', entity_id: rider.id, after_values: { name, fe } });
  revalidatePath('/riders');
  redirect('/riders?added=1');
}

export default async function RidersPage({ searchParams }: { searchParams: Promise<{ error?: string; added?: string }> }) {
  const { error, added } = await searchParams;
  const sb = await supabaseServer();
  const { data: riders } = await sb
    .from('riders')
    .select('id, full_name, phone, status, onboarding_date, rider_platform_accounts(platform_rider_id), rider_payment_details(bank_account_number, verified_at)')
    .order('full_name');

  return (
    <>
      <div>
        <div className="note" style={{ textTransform: 'uppercase', letterSpacing: '.04em', fontWeight: 600 }}>Riders</div>
        <h1>Rider master</h1>
      </div>
      {error && <div className="alert bad" role="alert">{error}</div>}
      {added && <div className="alert ok">Rider added.</div>}

      <form action={addRider} className="card">
        <h2>Add a rider</h2>
        <div className="row">
          <label>Full name<input name="name" required /></label>
          <label>Zomato FE ID<input name="fe" required placeholder="FE11568286" pattern="[Ff][Ee][0-9]+" /></label>
          <label>Phone (optional)<input name="phone" inputMode="tel" /></label>
          <button type="submit">Add rider</button>
        </div>
        <p className="note">The FE ID is how Zomato files are matched to riders. Each FE ID can belong to one rider only.</p>
      </form>

      <section className="card">
        <h2>{riders?.length ?? 0} riders</h2>
        <div className="tbl">
          <table>
            <thead><tr><th>Name</th><th>FE ID</th><th>Phone</th><th>Status</th><th>Onboarded</th><th>Bank details</th><th></th></tr></thead>
            <tbody>
              {(riders ?? []).map((r) => (
                <tr key={r.id}>
                  <td><b>{r.full_name}</b></td>
                  <td>{(r.rider_platform_accounts as { platform_rider_id: string }[]).map((a) => a.platform_rider_id).join(', ') || '—'}</td>
                  <td>{r.phone ?? '—'}</td>
                  <td><span className="pill p-ok">{r.status}</span></td>
                  <td>{r.onboarding_date ?? '—'}</td>
                  <td>{(() => {
                    const d = [r.rider_payment_details].flat().find((x) => x) as { bank_account_number: string | null; verified_at: string | null } | undefined;
                    if (!d?.bank_account_number) return <span className="pill p-warn">Missing</span>;
                    return d.verified_at ? <span className="pill p-ok">Checked</span> : <span className="pill p-warn">Needs check</span>;
                  })()}</td>
                  <td><Link href={`/riders/${r.id}`}>Edit</Link></td>
                </tr>
              ))}
              {!riders?.length && <tr><td colSpan={7} className="note">No riders yet. Add the first one above.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
