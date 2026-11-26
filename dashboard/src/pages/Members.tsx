import { useState, type FormEvent } from 'react';
import { addMember, forgetUser, listMembers, removeMember } from '../lib/data';
import type { Member } from '../lib/types';
import { formatDateTime, useAsync } from '../lib/util';

export function Members({ isAdmin, me }: { isAdmin: boolean; me: string }) {
  const res = useAsync(listMembers, []);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<Member['role']>('viewer');
  const [forget, setForget] = useState('');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function add(e: FormEvent) {
    e.preventDefault();
    try {
      await addMember(email, role);
      setEmail('');
      setMsg({ ok: true, text: `Added. They can now sign in with ${email.trim()}.` });
      res.reload();
    } catch (err) {
      setMsg({ ok: false, text: err instanceof Error ? err.message : String(err) });
    }
  }

  async function remove(m: Member) {
    if (!window.confirm(`Remove ${m.email}?`)) return;
    await removeMember(m.email);
    res.reload();
  }

  async function doForget(e: FormEvent) {
    e.preventDefault();
    if (!window.confirm(`Permanently delete every session for user "${forget}"?`)) return;
    try {
      const n = await forgetUser(forget.trim());
      setMsg({ ok: true, text: `Deleted ${n} session${n === 1 ? '' : 's'}.` });
      setForget('');
    } catch (err) {
      setMsg({ ok: false, text: err instanceof Error ? err.message : String(err) });
    }
  }

  return (
    <>
      <h2>Team</h2>
      <p className="muted small">
        People on this list can sign in and see sessions. Viewers can look; admins can also manage the team and
        delete data.
      </p>
      {res.error && <p className="error">{res.error}</p>}
      <table>
        <tbody>
          {(res.data ?? []).map((m) => (
            <tr key={m.email}>
              <td>{m.email}</td>
              <td>
                <span className="pill">{m.role}</span>
              </td>
              <td className="muted small">added {formatDateTime(m.created_at)}</td>
              <td className="actions">
                {isAdmin && m.email !== me.toLowerCase() && (
                  <button className="link" onClick={() => remove(m)}>
                    Remove
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {msg && <p className={msg.ok ? 'ok' : 'error'}>{msg.text}</p>}
      {isAdmin && (
        <>
          <h3>Add someone</h3>
          <form className="row" onSubmit={add}>
            <input type="email" required placeholder="name@company.com" value={email} onChange={(e) => setEmail(e.target.value)} />
            <select value={role} onChange={(e) => setRole(e.target.value as Member['role'])}>
              <option value="viewer">Viewer</option>
              <option value="admin">Admin</option>
            </select>
            <button className="primary">Add</button>
          </form>

          <h3>Delete a user's data</h3>
          <p className="muted small">
            For data deletion requests. Enter the user id your app passes to <code>recap.setUserId()</code>.
          </p>
          <form className="row" onSubmit={doForget}>
            <input required placeholder="user id" value={forget} onChange={(e) => setForget(e.target.value)} />
            <button>Delete their sessions</button>
          </form>
        </>
      )}
    </>
  );
}
