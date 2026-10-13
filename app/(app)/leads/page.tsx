import Link from 'next/link';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { supabaseServer } from '@/lib/supabase-server';
import { appsScript } from '@/lib/leads-script';
import { Icon } from '../icons';
import { TABS, ageOn, hasVehicle, isReady, sortRank, tabsFor, urgentReason, type LeadFacts, type Tab } from '@/src/engine/leads';

const FORM_URL = 'https://docs.google.com/forms/d/e/1FAIpQLSc7AQPls9iZ2m48Q7LrhN4EbNrcrlF4s7nSSDbP7V7JBGj91g/viewform';
const back = (tab: string, q: string): never => redirect(`/leads?tab=${tab}&${q}`);
const fail = (tab: string, m: string): never => back(tab, `error=${encodeURIComponent(m)}`);
const isTab = (t: string | undefined): t is Tab => TABS.some((x) => x.key === t);

async function requireStaff() {
  const sb = await supabaseServer();
  const { data: auth } = await sb.auth.getUser();
  const { data: me } = await sb.from('profiles').select('role, active').eq('id', auth.user?.id ?? '').maybeSingle();
  return { sb, actorId: auth.user?.id ?? null, ok: !!me?.active && ['super_admin', 'operations_manager'].includes(me.role as string) };
}

async function onboard(formData: FormData) {
  'use server';
  const tab = String(formData.get('tab') ?? 'urgent');
  const { sb, ok } = await requireStaff();
  if (!ok) fail(tab, 'Only admins and operations managers can add riders');
  const { error } = await sb.rpc('onboard_lead', { p_lead: String(formData.get('id')), p_fe: String(formData.get('fe') ?? '') });
  if (error) fail(tab, error.message);
  revalidatePath('/leads'); revalidatePath('/riders');
  back(tab, 'saved=' + encodeURIComponent('Added to your riders. Create their login on their rider page when you are ready.'));
}

async function updateLead(formData: FormData) {
  'use server';
  const tab = String(formData.get('tab') ?? 'urgent');
  const { sb, actorId, ok } = await requireStaff();
  if (!ok) fail(tab, 'Only admins and operations managers can change leads');
  const id = String(formData.get('id'));
  const status = String(formData.get('status'));
  if (!['new', 'contacted', 'dropped'].includes(status)) fail(tab, 'Choose a status');
  const urgent = formData.get('urgent') === 'on';
  const notes = String(formData.get('notes') ?? '').trim().slice(0, 1000) || null;
  const { error } = await sb.from('leads').update({ status, urgent_manual: urgent, notes }).eq('id', id);
  if (error) fail(tab, 'Could not save: ' + error.message);
  await sb.from('audit_logs').insert({ actor_id: actorId, action: 'lead.update', entity_type: 'lead', entity_id: id, after_values: { status, urgent, has_notes: !!notes } });
  revalidatePath('/leads');
  back(tab, 'saved=Saved');
}

interface Row extends LeadFacts {
  id: string; fullName: string; phone: string; phone10: string; email: string | null; dob: string | null; workType: string | null;
  priorExperience: boolean | null; platforms: string[]; submittedAt: string; notes: string | null;
  rider: { id: string; name: string; fe: string; login: boolean } | null;
}
const when = (iso: string) => {
  const d = Math.floor((Date.now() - Date.parse(iso)) / 86400000);
  return d <= 0 ? 'Today' : d === 1 ? 'Yesterday' : `${d} days ago`;
};
const yn = (v: boolean | null) => (v === true ? 'Yes' : v === false ? 'No' : 'Not answered');

export default async function LeadsPage({ searchParams }: { searchParams: Promise<{ tab?: string; q?: string; error?: string; saved?: string }> }) {
  const sp = await searchParams;
  const { sb, ok } = await requireStaff();
  if (!ok) return (<><h1>Leads</h1><div className="alert warn">Only admins and operations managers can see leads.</div></>);
  const tab: Tab = isTab(sp.tab) ? sp.tab : 'urgent';
  const q = (sp.q ?? '').trim().toLowerCase();

  const all: Record<string, any>[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await sb.from('leads').select('*, riders(id, full_name, user_id, rider_platform_accounts(platform_rider_id))').order('submitted_at', { ascending: false }).range(from, from + 999);
    if (error) return (<><h1>Leads</h1><div className="alert bad">Could not load leads: {error.message}. Have you run the leads step (0011) in Supabase?</div></>);
    all.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }
  const { data: existing } = await sb.from('riders').select('id, full_name, phone, rider_platform_accounts(platform_rider_id)').not('phone', 'is', null);
  const byPhone = new Map<string, { id: string; name: string; fe: string }>();
  for (const r of existing ?? []) {
    const k = String(r.phone).replace(/\D/g, '').slice(-10);
    if (k.length === 10 && !byPhone.has(k)) byPhone.set(k, { id: r.id as string, name: r.full_name as string, fe: ((r.rider_platform_accounts as { platform_rider_id: string }[])[0]?.platform_rider_id) ?? '' });
  }
  const rows: Row[] = all.map((l) => {
    const rd = l.riders as { id: string; full_name: string; user_id: string | null; rider_platform_accounts: { platform_rider_id: string }[] } | null;
    return {
      id: l.id, fullName: l.full_name, phone: l.phone, phone10: l.phone10, email: l.email, dob: l.date_of_birth, vehicleType: l.vehicle_type, hasLicenseInsurance: l.has_license_insurance,
      workType: l.work_type, priorExperience: l.prior_experience, platforms: l.prior_platforms ?? [], hasZomatoAccount: l.has_zomato_account, startWhen: l.start_when, wantsOnboarding: l.wants_onboarding,
      status: l.status, urgentManual: l.urgent_manual, submittedAt: l.submitted_at, notes: l.notes,
      rider: rd ? { id: rd.id, name: rd.full_name, fe: rd.rider_platform_accounts[0]?.platform_rider_id ?? '', login: !!rd.user_id } : null,
    };
  });
  const count = (t: Tab) => rows.filter((r) => tabsFor(r).has(t)).length;
  const shown = rows
    .filter((r) => tabsFor(r).has(tab))
    .filter((r) => !q || r.fullName.toLowerCase().includes(q) || r.phone.replace(/\D/g, '').includes(q.replace(/\D/g, '') || '§'))
    .sort((a, b) => sortRank(a) - sortRank(b) || (a.submittedAt < b.submittedAt ? 1 : -1));
  const newCount = rows.filter((r) => r.status === 'new').length;
  const last = rows[0]?.submittedAt;
  const h = await headers();
  const host = h.get('x-forwarded-host') ?? h.get('host') ?? 'your-riderx-address';
  const switchedOn = !!process.env.LEADS_WEBHOOK_SECRET;
  const tabInfo = TABS.find((t) => t.key === tab)!;

  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', gap: 12, flexWrap: 'wrap' }}>
        <div>
          <h1 style={{ fontSize: 34 }}>Leads</h1>
          <div className="note">People who filled in the RiderX Job Enquiry Form. {last ? `Latest enquiry: ${when(last).toLowerCase()}.` : 'None received yet.'}{newCount ? ` ${newCount} not contacted yet.` : ''}</div>
        </div>
        <a className="btn ghost" href={FORM_URL} target="_blank" rel="noreferrer">Open the form</a>
      </div>
      {sp.error && <div className="alert bad" role="alert">{sp.error}</div>}
      {sp.saved && <div className="alert ok">{sp.saved}</div>}

      <section className="grid leadstats">
        {TABS.filter((t) => t.key !== 'all').map((t) => (
          <Link key={t.key} href={`/leads?tab=${t.key}`} className={`stat tilelink${tab === t.key ? ' sel' : ''}`}>
            <span>{t.label}</span><b>{count(t.key)}</b>
          </Link>
        ))}
      </section>

      <section className="card">
        <div className="leadhead">
          <nav className="tabs" aria-label="Lead groups">
            {TABS.map((t) => <Link key={t.key} href={`/leads?tab=${t.key}`} className={tab === t.key ? 'on' : ''}>{t.label} <small>{count(t.key)}</small></Link>)}
          </nav>
          <form method="get" action="/leads" className="leadsearch">
            <input type="hidden" name="tab" value={tab} />
            <input name="q" defaultValue={sp.q ?? ''} placeholder="Search name or phone" aria-label="Search leads" />
          </form>
        </div>
        <p className="note" style={{ margin: '4px 0 14px' }}>{tabInfo.hint}</p>

        <div className="leadlist">
          {shown.map((l) => {
            const urgent = urgentReason(l);
            const dupe = !l.rider && byPhone.get(l.phone10);
            const age = ageOn(l.dob);
            return (
              <article key={l.id} className={`lead${urgent ? ' urgent' : ''}`}>
                <div className="lead-main">
                  <div className="lead-name">
                    <b>{l.fullName}</b>
                    {urgent && <span className="pill p-urgent">Urgent{urgent === 'manual' ? ' · flagged by you' : ''}</span>}
                    {!urgent && isReady(l) && <span className="pill p-ready">Ready to join</span>}
                    {l.status === 'new' && Date.now() - Date.parse(l.submittedAt) < 172800000 && <span className="pill p-new">New</span>}
                    {l.status === 'dropped' && <span className="pill p-warn">Dropped</span>}
                    {l.wantsOnboarding === false && <span className="pill p-warn">Not interested</span>}
                  </div>
                  <div className="note">
                    {age !== null && `${age} yrs · `}
                    <a href={`tel:+91${l.phone10}`}>{l.phone}</a> · <a href={`https://wa.me/91${l.phone10}`} target="_blank" rel="noreferrer">WhatsApp</a>
                    {l.email && <> · {l.email}</>} · Applied {when(l.submittedAt).toLowerCase()}
                  </div>
                  <div className="facts">
                    <span className={`fact${hasVehicle(l) ? ' good' : ''}`}><small>Vehicle</small>{l.vehicleType ?? 'Not answered'}</span>
                    <span className={`fact${l.hasLicenseInsurance ? ' good' : ''}`}><small>Licence &amp; insurance</small>{yn(l.hasLicenseInsurance)}</span>
                    <span className={`fact${l.startWhen === 'Immediately' ? ' good' : ''}`}><small>Can start</small>{l.startWhen ?? 'Not answered'}</span>
                    <span className="fact"><small>Wants</small>{l.workType ?? 'Not answered'}</span>
                    <span className="fact"><small>Delivery experience</small>{l.priorExperience === false ? 'None' : l.platforms.length ? l.platforms.join(', ') : yn(l.priorExperience)}</span>
                    <span className={`fact${l.hasZomatoAccount ? ' good' : ''}`}><small>Zomato account</small>{yn(l.hasZomatoAccount)}</span>
                  </div>
                  {l.notes && <div className="note" style={{ marginTop: 8 }}>Note: {l.notes}</div>}
                </div>

                <div className="lead-act">
                  {l.rider ? (
                    <div className="riderlink">
                      <div className="note">Added as a rider</div>
                      <Link href={`/riders/${l.rider.id}`}><b>{l.rider.name}</b></Link>
                      <div className="note">FE ID {l.rider.fe}</div>
                      {l.rider.login
                        ? <span className="pill p-login"><i className="dot" />Login active</span>
                        : <Link href={`/riders/${l.rider.id}`} className="pill p-nologin">No login yet · set PIN</Link>}
                    </div>
                  ) : dupe ? (
                    <div className="alert warn" style={{ fontSize: 13 }}>This phone number already belongs to rider <Link href={`/riders/${dupe.id}`}>{dupe.name}</Link>{dupe.fe ? ` (${dupe.fe})` : ''}. Mark this lead as dropped, or fix the phone on the rider.</div>
                  ) : (
                    <form action={onboard} className="onboard">
                      <input type="hidden" name="id" value={l.id} /><input type="hidden" name="tab" value={tab} />
                      <label>Zomato FE ID<input name="fe" required placeholder="FE11715032" pattern="[Ff][Ee][0-9]+" title="FE followed by numbers" autoComplete="off" /></label>
                      <button type="submit">Add as rider</button>
                    </form>
                  )}
                  {!l.rider && (
                    <details className="more-edit">
                      <summary>Status, urgent, notes</summary>
                      <form action={updateLead} className="editform">
                        <input type="hidden" name="id" value={l.id} /><input type="hidden" name="tab" value={tab} />
                        <label>Status
                          <select name="status" defaultValue={l.status}><option value="new">New</option><option value="contacted">Contacted</option><option value="dropped">Dropped</option></select>
                        </label>
                        <label className="check"><input type="checkbox" name="urgent" defaultChecked={l.urgentManual} />Flag as urgent</label>
                        <label>Notes<input name="notes" defaultValue={l.notes ?? ''} maxLength={1000} placeholder="Called, will come Monday" /></label>
                        <button type="submit" className="ghost">Save</button>
                      </form>
                    </details>
                  )}
                </div>
              </article>
            );
          })}
          {!shown.length && <p className="note">{rows.length ? 'Nobody in this group right now.' : 'No enquiries yet. Connect your form below, and new ones will appear here by themselves.'}</p>}
        </div>
      </section>

      <section className="card">
        <div className="cardhead">
          <h2>Connect your Google Form</h2>
          <span className={`pill ${switchedOn ? 'p-ok' : 'p-warn'}`}>{switchedOn ? 'Switched on' : 'Not switched on yet'}</span>
        </div>
        <ol className="steps">
          <li>In Vercel open the <b>riderx</b> project, then <b>Settings</b>, then <b>Environment Variables</b>. Add a new one named <code>LEADS_WEBHOOK_SECRET</code> with any long random value of your own (30 or more letters and numbers). Save, then <b>Redeploy</b> the latest deployment.</li>
          <li>Open your form in Google Forms (the edit view). Click the three dots at the top right, then <b>Apps Script</b>.</li>
          <li>Delete whatever is in the editor and paste the script below. Replace <code>PASTE-YOUR-SECRET-HERE</code> with the same secret you used in step 1. Click <b>Save</b>.</li>
          <li>Pick <code>sendAllExisting</code> in the function box at the top and click <b>Run</b>. Google will ask you to allow access once. This sends everyone who has already filled the form.</li>
          <li>Click the clock icon (<b>Triggers</b>), then <b>Add Trigger</b>. Choose function <code>onSubmit</code>, event source <b>From form</b>, event type <b>On form submit</b>. Save. From now on every new response arrives here within seconds.</li>
        </ol>
        <details><summary>Show the script to paste</summary><pre className="script">{appsScript(host)}</pre></details>
        <p className="note">Keep the secret private. If you ever think it leaked, change it in Vercel and in the script. The form answers are kept exactly as received, and the same response is never saved twice.</p>
      </section>
    </>
  );
}
