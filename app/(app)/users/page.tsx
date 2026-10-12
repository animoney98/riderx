import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { supabaseServer } from '@/lib/supabase-server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { ROLES, changeProblem, emailProblem, passwordProblem, roleLabel, type Role, type StaffRow } from '@/src/engine/access';

const back = (q: string): never => redirect(`/users?${q}`);
const err = (m: string): never => back(`error=${encodeURIComponent(m)}`);
const isRole = (r: string): r is Role => ROLES.some((x) => x.value === r);

/** Every action re-checks on the server that the caller is an active Admin. */
async function requireAdmin() {
  const sb = await supabaseServer();
  const { data: auth } = await sb.auth.getUser();
  const { data: me } = await sb.from('profiles').select('role, active').eq('id', auth.user?.id ?? '').maybeSingle();
  if (!auth.user || !me?.active || me.role !== 'super_admin') err('Only an Admin can manage users');
  return { sb, actorId: auth.user!.id };
}

async function addUser(formData: FormData) {
  'use server';
  const { sb, actorId } = await requireAdmin();
  const name = String(formData.get('name') ?? '').trim();
  const email = String(formData.get('email') ?? '').trim().toLowerCase();
  const role = String(formData.get('role') ?? '');
  const password = String(formData.get('password') ?? '');
  if (!name) err('Name is required');
  const ep = emailProblem(email); if (ep) err(ep);
  if (!isRole(role)) err('Choose a role');
  const pp = passwordProblem(password); if (pp) err(pp);
  const admin = supabaseAdmin();
  if (!admin) err('User creation is not switched on yet. Add SUPABASE_SERVICE_ROLE_KEY in Vercel.');
  const { data: dup } = await sb.from('profiles').select('id').eq('email', email).maybeSingle();
  if (dup) err('A user with this email already exists');
  const { data, error } = await admin!.auth.admin.createUser({ email, password, email_confirm: true });
  if (error || !data.user) err('Could not create the login: ' + (error?.message ?? 'unknown'));
  const { error: e2 } = await sb.from('profiles').insert({ id: data.user!.id, full_name: name, email, role, active: true });
  if (e2) {
    await admin!.auth.admin.deleteUser(data.user!.id); // no half-created user left behind
    err('Could not save the user: ' + e2.message);
  }
  await sb.from('audit_logs').insert({ actor_id: actorId, action: 'user.create', entity_type: 'user', entity_id: data.user!.id, after_values: { email, role } });
  revalidatePath('/users');
  back('saved=' + encodeURIComponent(`${name} added as ${roleLabel(role)}`));
}

async function updateUser(formData: FormData) {
  'use server';
  const { sb, actorId } = await requireAdmin();
  const id = String(formData.get('id'));
  const role = String(formData.get('role') ?? '');
  const active = String(formData.get('active')) === 'true';
  if (!isRole(role)) err('Choose a role');
  const { data: all } = await sb.from('profiles').select('id, role, active');
  const rows = (all ?? []) as StaffRow[];
  const target = rows.find((r) => r.id === id);
  if (!target) err('User not found');
  const problem = changeProblem(actorId, target!, { role: role as Role, active }, rows);
  if (problem) err(problem);
  if (target!.role === role && target!.active === active) back('saved=Nothing+to+change');
  const { error } = await sb.from('profiles').update({ role, active, updated_at: new Date().toISOString() }).eq('id', id);
  if (error) err('Could not save: ' + error.message);
  // Also lock or unlock the sign-in itself. Data access is already blocked by the inactive flag either way.
  const admin = supabaseAdmin();
  if (admin && target!.active !== active) await admin.auth.admin.updateUserById(id, { ban_duration: active ? 'none' : '876000h' });
  await sb.from('audit_logs').insert({
    actor_id: actorId, action: 'user.update', entity_type: 'user', entity_id: id,
    before_values: { role: target!.role, active: target!.active }, after_values: { role, active },
  });
  revalidatePath('/users');
  back('saved=Saved');
}

async function resetPassword(formData: FormData) {
  'use server';
  const { sb, actorId } = await requireAdmin();
  const id = String(formData.get('id'));
  const password = String(formData.get('password') ?? '');
  const pp = passwordProblem(password); if (pp) err(pp);
  const admin = supabaseAdmin();
  if (!admin) err('Password reset is not switched on yet. Add SUPABASE_SERVICE_ROLE_KEY in Vercel.');
  const { data: prof } = await sb.from('profiles').select('id').eq('id', id).maybeSingle();
  if (!prof) err('User not found');
  const { error } = await admin!.auth.admin.updateUserById(id, { password });
  if (error) err('Could not set the password: ' + error.message);
  await sb.from('audit_logs').insert({ actor_id: actorId, action: 'user.password_reset', entity_type: 'user', entity_id: id });
  back('saved=Password+changed.+Tell+them+the+new+password+yourself.');
}

export default async function UsersPage({ searchParams }: { searchParams: Promise<{ error?: string; saved?: string }> }) {
  const { error, saved } = await searchParams;
  const sb = await supabaseServer();
  const { data: auth } = await sb.auth.getUser();
  const { data: me } = await sb.from('profiles').select('role, active').eq('id', auth.user?.id ?? '').maybeSingle();
  if (!me?.active || me.role !== 'super_admin') {
    return (
      <>
        <h1>User &amp; Access Management</h1>
        <div className="alert warn">Only an Admin can manage users.</div>
      </>
    );
  }
  const { data: staff } = await sb.from('profiles').select('id, full_name, email, role, active, created_at').order('created_at');
  return (
    <>
      <div>
        <h1>User &amp; Access Management</h1>
        <div className="note">Staff who can sign in to this dashboard. Riders are not listed here: their logins are managed on each rider&apos;s page.</div>
      </div>
      {error && <div className="alert bad" role="alert">{error}</div>}
      {saved && <div className="alert ok">{saved}</div>}

      <section className="card">
        <h2>Team ({staff?.length ?? 0})</h2>
        <div className="tbl">
          <table>
            <thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Status</th><th></th></tr></thead>
            <tbody>
              {(staff ?? []).map((u) => {
                const mine = u.id === auth.user?.id;
                return (
                  <tr key={u.id}>
                    <td><b>{u.full_name}</b>{mine && <span className="note"> (you)</span>}</td>
                    <td>{u.email}</td>
                    <td colSpan={3}>
                      <form action={updateUser} style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                        <input type="hidden" name="id" value={u.id} />
                        <select name="role" defaultValue={u.role} disabled={mine} aria-label={`Role for ${u.full_name}`}>
                          {ROLES.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
                        </select>
                        <select name="active" defaultValue={String(u.active)} disabled={mine} aria-label={`Status for ${u.full_name}`}>
                          <option value="true">Active</option>
                          <option value="false">Switched off</option>
                        </select>
                        {mine ? <span className="note">Ask another Admin to change your own access</span> : <button type="submit">Save</button>}
                      </form>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <form action={addUser} className="card" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <h2>Add a team member</h2>
        <div className="row">
          <label>Full name<input name="name" required /></label>
          <label>Email<input name="email" type="email" required autoComplete="off" /></label>
          <label>Role
            <select name="role" defaultValue="viewer">{ROLES.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}</select>
          </label>
          <label>First password<input name="password" type="text" required minLength={10} autoComplete="off" placeholder="10+ characters, letters and numbers" /></label>
        </div>
        <button type="submit" style={{ alignSelf: 'flex-start' }}>Add team member</button>
        <p className="note">Tell them the email and password yourself (WhatsApp or in person). They sign in at the normal sign-in page. The password is not stored anywhere you can read it.</p>
      </form>

      <form action={resetPassword} className="card" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <h2>Reset someone&apos;s password</h2>
        <div className="row">
          <label>Team member
            <select name="id" required>{(staff ?? []).map((u) => <option key={u.id} value={u.id}>{u.full_name} ({u.email})</option>)}</select>
          </label>
          <label>New password<input name="password" type="text" required minLength={10} autoComplete="off" placeholder="10+ characters, letters and numbers" /></label>
        </div>
        <button type="submit" style={{ alignSelf: 'flex-start' }}>Set new password</button>
      </form>

      <section className="card">
        <h2>What each role can do</h2>
        <div className="tbl">
          <table>
            <tbody>{ROLES.map((r) => <tr key={r.value}><td><b>{r.label}</b></td><td>{r.can}</td></tr>)}</tbody>
          </table>
        </div>
        <p className="note">These limits are enforced in the database, not just hidden in the menu. Switching someone off blocks all their access immediately.</p>
      </section>
    </>
  );
}
