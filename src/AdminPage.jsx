import React, { useState, useEffect, useRef } from 'react';
import { Users, Phone, Clock, Plus, Trash2, ChevronLeft, Volume2, RefreshCw,
         Shield, UserCheck, Upload, List, Calendar, ChevronDown, ChevronUp, X, Settings, Zap } from 'lucide-react';
import { API_BASE } from './apiBase.js';

async function api(path, opts = {}) {
  const token = localStorage.getItem('token');
  const res = await fetch(API_BASE + '/api' + path, {
    ...opts,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...opts.headers }
  });
  let data;
  try { data = await res.json(); }
  catch { throw new Error(`Server error (${res.status}) — is the backend running?`); }
  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data;
}

function fmt(sec) { const m = Math.floor(sec / 60), s = sec % 60; return `${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`; }

function roleBadge(role) {
  const cls = { admin: 'bg-purple-100 text-purple-700', team_leader: 'bg-blue-100 text-blue-700', agent: 'bg-gray-100 text-gray-600' };
  const label = { admin: 'Admin', team_leader: 'Team Leader', agent: 'Agent' };
  return <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${cls[role] || cls.agent}`}>{label[role] || role}</span>;
}

function parseCSVLine(line) {
  const r = []; let cur = '', inQ = false;
  for (const ch of line) { if (ch === '"') inQ = !inQ; else if (ch === ',' && !inQ) { r.push(cur); cur = ''; } else cur += ch; }
  r.push(cur); return r;
}
function normalizePhone(raw) {
  if (!raw) return '';
  let p = String(raw).replace(/[\s\-().]/g, '');
  if (!p.startsWith('+')) p = '+1' + p.replace(/\D/g, '');
  else p = '+' + p.slice(1).replace(/\D/g, '');
  return p;
}
function parseCSV(text) {
  const lines = text.split(/\r?\n/).filter(l => l.trim());
  if (lines.length < 2) return [];
  const headers = parseCSVLine(lines[0]).map(h => h.trim().toLowerCase().replace(/[^a-z0-9]/g,''));
  const pFields = ['phone','phonenumber','mobile','telephone','tel','number','cell'];
  return lines.slice(1).map((line, i) => {
    const vals = parseCSVLine(line);
    const row = {}; headers.forEach((h, j) => { row[h] = (vals[j] || '').trim(); });
    let phone = ''; for (const f of pFields) { if (row[f]) { phone = row[f]; break; } }
    if (!phone) return null;
    const norm = normalizePhone(phone);
    if (norm.replace(/\D/g,'').length < 7) return null;
    const name = [row.name, row.fullname, row.firstname && `${row.firstname} ${row.lastname||''}`.trim()].find(v => v?.trim()) || 'Unknown';
    return { _id: `csv-${i}`, phone: norm, name: name.trim(), company: row.company||row.organization||'', email: row.email||'', notes: row.notes||row.note||'', status: 'pending' };
  }).filter(Boolean);
}

export default function AdminPage({ user, onBack }) {
  const [tab, setTab]           = useState(user.role === 'team_leader' ? 'calls' : 'users');
  const [users, setUsers]       = useState([]);
  const [teams, setTeams]       = useState([]);
  const [lists, setLists]       = useState([]);
  const [meetings, setMeetings] = useState([]);
  const [calls, setCalls]       = useState([]);
  const [selectedUser, setSelectedUser]   = useState('');
  const [newUser, setNewUser]             = useState({ name:'', username:'', password:'', role:'agent', teamId:'', autoTelnyx: false });
  const [globalSettings, setGlobalSettings] = useState({ telnyxApiKey:'', telnyxConnectionId:'', telnyxSipServer:'wss://sip.telnyx.com' });
  const [newTeam, setNewTeam]             = useState({ name:'', leaderId:'' });
  const [newList, setNewList]             = useState({ name:'', teamId:'', contacts:[] });
  const [expandedTeam, setExpandedTeam]  = useState(null);
  const [loading, setLoading]            = useState(false);
  const [msg, setMsg]                    = useState({ text:'', ok:true });
  const [playingFile, setPlayingFile]    = useState(null);
  const audioRef = useRef(null);
  const fileRef  = useRef(null);

  const isAdmin = user.role === 'admin';

  useEffect(() => {
    loadUsers(); loadCalls();
    if (isAdmin) { loadTeams(); loadLists(); loadGlobalSettings(); }
    loadMeetings();
  }, []);

  async function loadUsers()          { try { const d = await api('/admin/users');      setUsers(d.users); } catch {} }
  async function loadTeams()          { try { const d = await api('/teams');            setTeams(d.teams); } catch {} }
  async function loadLists()          { try { const d = await api('/dial-lists');       setLists(d.lists); } catch {} }
  async function loadMeetings()       { try { const d = await api('/meetings');         setMeetings(d.meetings); } catch {} }
  async function loadCalls(uid)       { try { const d = await api(`/admin/calls${uid ? `?userId=${uid}` : ''}`); setCalls(d.calls); } catch {} }
  async function loadGlobalSettings() { try { const d = await api('/settings/global'); setGlobalSettings(d.settings); } catch {} }

  function notify(text, ok = true) { setMsg({ text, ok }); setTimeout(() => setMsg({ text:'', ok:true }), 4000); }

  // ── GLOBAL SETTINGS ──
  async function saveGlobalSettings() {
    try { await api('/settings/global', { method:'PUT', body: JSON.stringify(globalSettings) }); notify('Global settings saved!'); loadGlobalSettings(); }
    catch (e) { notify(e.message, false); }
  }

  async function createTelnyxSip(userId, name) {
    try {
      const d = await api('/admin/telnyx/create-sip', { method:'POST', body: JSON.stringify({ userId, name }) });
      notify(`✅ Telnyx SIP created: ${d.sipUsername}`);
      return true;
    } catch (e) { notify(`Telnyx SIP failed: ${e.message}`, false); return false; }
  }

  // ── USERS ──
  async function createUser() {
    if (!newUser.name || !newUser.username || !newUser.password) { notify('Name, username, password required', false); return; }
    setLoading(true);
    try {
      const result = await api('/admin/users', { method:'POST', body: JSON.stringify(newUser) });
      if (newUser.autoTelnyx && result.user) {
        await createTelnyxSip(result.user.id, result.user.name);
      } else {
        notify('User created!');
      }
      setNewUser({ name:'', username:'', password:'', role:'agent', teamId:'', autoTelnyx: false });
      loadUsers(); loadTeams();
    } catch (e) { notify(e.message, false); }
    finally { setLoading(false); }
  }

  async function deleteUser(id, name) {
    if (!confirm(`Delete user "${name}"?`)) return;
    try { await api(`/admin/users/${id}`, { method:'DELETE' }); loadUsers(); loadTeams(); notify('User deleted.'); }
    catch (e) { notify(e.message, false); }
  }

  async function changeRole(id, role) {
    try { await api(`/admin/users/${id}/role`, { method:'PATCH', body: JSON.stringify({ role }) }); loadUsers(); loadTeams(); notify('Role updated.'); }
    catch (e) { notify(e.message, false); }
  }

  async function moveToTeam(id, teamId) {
    try { await api(`/admin/users/${id}/team`, { method:'PATCH', body: JSON.stringify({ teamId: teamId || null }) }); loadUsers(); loadTeams(); notify('Team updated.'); }
    catch (e) { notify(e.message, false); }
  }

  // ── TEAMS ──
  async function createTeam() {
    if (!newTeam.name) { notify('Team name required', false); return; }
    try { await api('/teams', { method:'POST', body: JSON.stringify({ name: newTeam.name, leaderId: newTeam.leaderId || null }) }); notify('Team created!'); setNewTeam({ name:'', leaderId:'' }); loadTeams(); loadUsers(); }
    catch (e) { notify(e.message, false); }
  }

  async function deleteTeam(id, name) {
    if (!confirm(`Delete team "${name}"?`)) return;
    try { await api(`/teams/${id}`, { method:'DELETE' }); loadTeams(); loadUsers(); notify('Team deleted.'); }
    catch (e) { notify(e.message, false); }
  }

  async function setTeamLeader(teamId, leaderId) {
    try { await api(`/teams/${teamId}`, { method:'PUT', body: JSON.stringify({ leaderId }) }); loadTeams(); loadUsers(); notify('Leader updated.'); }
    catch (e) { notify(e.message, false); }
  }

  // ── DIAL LISTS ──
  function handleCSVFile(file) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = e => { const contacts = parseCSV(e.target.result); setNewList(l => ({ ...l, name: l.name || file.name.replace(/\.csv$/i,''), contacts })); };
    reader.readAsText(file);
  }

  async function uploadList() {
    if (!newList.name || !newList.teamId || !newList.contacts.length) { notify('Name, team, and CSV file required', false); return; }
    try { await api('/dial-lists', { method:'POST', body: JSON.stringify(newList) }); notify(`List "${newList.name}" assigned!`); setNewList({ name:'', teamId:'', contacts:[] }); loadLists(); }
    catch (e) { notify(e.message, false); }
  }

  async function deleteList(id, name) {
    if (!confirm(`Delete list "${name}"?`)) return;
    try { await api(`/dial-lists/${id}`, { method:'DELETE' }); loadLists(); notify('List deleted.'); }
    catch (e) { notify(e.message, false); }
  }

  // ── RECORDINGS ──
  function playRecording(file) {
    if (audioRef.current) { audioRef.current.pause(); audioRef.current = null; setPlayingFile(null); }
    if (playingFile === file) return;
    const a = new Audio(`/recordings/${file}`);
    audioRef.current = a;
    setPlayingFile(file);
    a.play().catch(() => notify('Cannot play recording', false));
    a.onended = () => { setPlayingFile(null); audioRef.current = null; };
  }

  const TABS = [
    { id:'users',    label:'Users',      icon:Users,    show: isAdmin },
    { id:'teams',    label:'Teams',      icon:Shield,   show: isAdmin },
    { id:'lists',    label:'Dial Lists', icon:List,     show: isAdmin },
    { id:'calls',    label:'Call Logs',  icon:Phone,    show: true    },
    { id:'meetings', label:'Meetings',   icon:Calendar, show: true    },
    { id:'settings', label:'Settings',   icon:Settings, show: isAdmin },
  ].filter(t => t.show);

  return (
    <div className="min-h-screen bg-slate-50">
      <audio ref={audioRef} />

      {/* Header */}
      <div className="bg-white border-b px-6 py-4 flex items-center gap-4 shadow-sm">
        <button onClick={onBack} className="p-2 hover:bg-gray-100 rounded-xl transition-colors">
          <ChevronLeft className="w-5 h-5 text-gray-600" />
        </button>
        <div>
          <h1 className="text-lg font-bold text-gray-900">DILO — {isAdmin ? 'Admin' : 'Manager'}</h1>
          <p className="text-sm text-gray-400">{user.name} · {user.role === 'admin' ? 'Administrator' : 'Team Leader'}</p>
        </div>
      </div>

      <div className="max-w-6xl mx-auto p-6">
        {/* Tabs */}
        <div className="flex gap-2 mb-6 flex-wrap">
          {TABS.map(t => (
            <button key={t.id} onClick={() => setTab(t.id)}
              className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition-all ${tab === t.id ? 'bg-blue-600 text-white shadow' : 'bg-white text-gray-600 hover:bg-gray-50 border border-gray-200'}`}
            >
              <t.icon className="w-4 h-4" /> {t.label}
            </button>
          ))}
        </div>

        {/* Notification */}
        {msg.text && (
          <div className={`mb-4 px-4 py-3 rounded-xl text-sm flex items-center justify-between ${msg.ok ? 'bg-green-50 text-green-700 border border-green-200' : 'bg-red-50 text-red-700 border border-red-200'}`}>
            {msg.text}
            <button onClick={() => setMsg({ text:'', ok:true })}><X className="w-4 h-4 opacity-60 hover:opacity-100" /></button>
          </div>
        )}

        {/* ═══════════════════════════════════════ USERS ═══════════════════════════════════════ */}
        {tab === 'users' && (
          <div className="space-y-4">
            {/* Create user */}
            <div className="bg-white rounded-2xl border p-6">
              <h2 className="font-bold text-gray-800 mb-4 flex items-center gap-2"><Plus className="w-4 h-4" /> Create New User</h2>
              <div className="grid grid-cols-2 gap-3 mb-4">
                <input placeholder="Full Name *" value={newUser.name} onChange={e => setNewUser(p => ({ ...p, name: e.target.value }))}
                  className="border rounded-xl px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-blue-500" />
                <input placeholder="Username *" value={newUser.username} onChange={e => setNewUser(p => ({ ...p, username: e.target.value }))}
                  className="border rounded-xl px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-blue-500" />
                <input type="password" placeholder="Password *" value={newUser.password} onChange={e => setNewUser(p => ({ ...p, password: e.target.value }))}
                  className="border rounded-xl px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-blue-500" />
                <select value={newUser.role} onChange={e => setNewUser(p => ({ ...p, role: e.target.value }))}
                  className="border rounded-xl px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white">
                  <option value="agent">Agent</option>
                  <option value="team_leader">Team Leader</option>
                  <option value="admin">Admin</option>
                </select>
                <select value={newUser.teamId} onChange={e => setNewUser(p => ({ ...p, teamId: e.target.value }))}
                  className="border rounded-xl px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white col-span-2">
                  <option value="">No team (assign later)</option>
                  {teams.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
              </div>
              <div className="flex items-center gap-3 mb-4">
                <label className="flex items-center gap-2 cursor-pointer select-none">
                  <input type="checkbox" checked={newUser.autoTelnyx} onChange={e => setNewUser(p => ({ ...p, autoTelnyx: e.target.checked }))} className="w-4 h-4 rounded accent-blue-600" />
                  <span className="text-sm text-gray-700 flex items-center gap-1.5">
                    <Zap className="w-3.5 h-3.5 text-yellow-500" /> Auto-create Telnyx SIP credentials
                  </span>
                </label>
                {newUser.autoTelnyx && !globalSettings.telnyxApiKey && (
                  <span className="text-xs text-amber-600">⚠ Set Telnyx API key in Settings tab first</span>
                )}
              </div>
              <button onClick={createUser} disabled={loading}
                className="bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white px-6 py-2 rounded-xl font-medium text-sm">
                {loading ? 'Creating…' : 'Create User'}
              </button>
            </div>

            {/* Users list */}
            <div className="bg-white rounded-2xl border overflow-hidden">
              <div className="px-6 py-4 border-b flex items-center justify-between">
                <h2 className="font-bold text-gray-800">All Users ({users.length})</h2>
                <button onClick={loadUsers} className="text-gray-400 hover:text-gray-600"><RefreshCw className="w-4 h-4" /></button>
              </div>
              {users.length === 0 && <p className="text-center py-8 text-gray-400 text-sm">No users</p>}
              <div className="divide-y">
                {users.map(u => (
                  <div key={u.id} className="px-6 py-4 flex items-center gap-3 flex-wrap">
                    <div className="w-9 h-9 rounded-full bg-blue-100 flex items-center justify-center shrink-0">
                      <span className="text-blue-700 font-bold text-sm">{u.name?.[0]?.toUpperCase()}</span>
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold text-gray-900 text-sm">{u.name}</p>
                      <p className="text-xs text-gray-500">@{u.username}{u.teamName ? ` · ${u.teamName}` : ''}</p>
                    </div>
                    {roleBadge(u.role)}

                    {/* Role selector */}
                    {u.id !== 1 && (
                      <select value={u.role} onChange={e => changeRole(u.id, e.target.value)}
                        className="text-xs border rounded-lg px-2 py-1 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500">
                        <option value="agent">Agent</option>
                        <option value="team_leader">Team Leader</option>
                        <option value="admin">Admin</option>
                      </select>
                    )}

                    {/* Team selector */}
                    {u.id !== 1 && (
                      <select value={u.teamId || ''} onChange={e => moveToTeam(u.id, e.target.value)}
                        className="text-xs border rounded-lg px-2 py-1 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500">
                        <option value="">No team</option>
                        {teams.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                      </select>
                    )}

                    <div className="flex gap-1">
                      <button onClick={() => { setSelectedUser(u.id); setTab('calls'); loadCalls(u.id); }}
                        className="p-1.5 rounded-lg bg-blue-50 hover:bg-blue-100 text-blue-700" title="View calls">
                        <Phone className="w-3.5 h-3.5" />
                      </button>
                      {u.id !== 1 && (
                        <button onClick={() => deleteUser(u.id, u.name)} className="p-1.5 rounded-lg bg-red-50 hover:bg-red-100 text-red-700">
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* ═══════════════════════════════════════ TEAMS ═══════════════════════════════════════ */}
        {tab === 'teams' && (
          <div className="space-y-4">
            {/* Create team */}
            <div className="bg-white rounded-2xl border p-6">
              <h2 className="font-bold text-gray-800 mb-4 flex items-center gap-2"><Plus className="w-4 h-4" /> Create New Team</h2>
              <div className="grid grid-cols-2 gap-3 mb-4">
                <input placeholder="Team Name *" value={newTeam.name} onChange={e => setNewTeam(p => ({ ...p, name: e.target.value }))}
                  className="border rounded-xl px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-blue-500" />
                <select value={newTeam.leaderId} onChange={e => setNewTeam(p => ({ ...p, leaderId: e.target.value }))}
                  className="border rounded-xl px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white">
                  <option value="">No leader yet</option>
                  {users.filter(u => u.role !== 'admin').map(u => <option key={u.id} value={u.id}>{u.name} (@{u.username})</option>)}
                </select>
              </div>
              <button onClick={createTeam} className="bg-blue-600 hover:bg-blue-700 text-white px-6 py-2 rounded-xl font-medium text-sm">Create Team</button>
            </div>

            {/* Teams list */}
            {teams.length === 0 && <div className="text-center py-16 text-gray-400 text-sm bg-white rounded-2xl border"><Shield className="w-10 h-10 mx-auto mb-2 opacity-30" /><p>No teams yet</p></div>}
            {teams.map(team => (
              <div key={team.id} className="bg-white rounded-2xl border overflow-hidden">
                <div className="px-6 py-4 flex items-center gap-3">
                  <div className="w-9 h-9 rounded-full bg-blue-600 flex items-center justify-center shrink-0 text-white font-bold text-sm">
                    {team.name?.[0]?.toUpperCase()}
                  </div>
                  <div className="flex-1">
                    <p className="font-bold text-gray-900">{team.name}</p>
                    <p className="text-xs text-gray-500">Leader: {team.leaderName || 'None'} · {team.members?.length || 0} members</p>
                  </div>
                  {/* Change leader */}
                  <select onChange={e => setTeamLeader(team.id, e.target.value)} defaultValue=""
                    className="text-xs border rounded-lg px-2 py-1 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500">
                    <option value="" disabled>Change leader</option>
                    <option value="">Remove leader</option>
                    {users.filter(u => u.teamId === team.id || !u.teamId).map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
                  </select>
                  <button onClick={() => setExpandedTeam(expandedTeam === team.id ? null : team.id)}
                    className="p-1.5 rounded-lg bg-gray-50 hover:bg-gray-100 text-gray-500">
                    {expandedTeam === team.id ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                  </button>
                  <button onClick={() => deleteTeam(team.id, team.name)} className="p-1.5 rounded-lg bg-red-50 hover:bg-red-100 text-red-600">
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
                {expandedTeam === team.id && (
                  <div className="border-t px-6 py-3 bg-gray-50">
                    {!team.members?.length && <p className="text-xs text-gray-400 py-2">No members. Move agents to this team from the Users tab.</p>}
                    <div className="space-y-2">
                      {team.members?.map(m => (
                        <div key={m.id} className="flex items-center gap-3">
                          <div className="w-7 h-7 rounded-full bg-blue-100 flex items-center justify-center text-xs font-bold text-blue-700">{m.name?.[0]?.toUpperCase()}</div>
                          <span className="text-sm flex-1">{m.name} <span className="text-gray-400">@{m.username}</span></span>
                          {roleBadge(m.role)}
                          <button onClick={() => moveToTeam(m.id, null)} className="text-xs text-red-500 hover:text-red-700">Remove</button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {/* ═══════════════════════════════════════ DIAL LISTS ═══════════════════════════════════════ */}
        {tab === 'lists' && (
          <div className="space-y-4">
            {/* Upload list */}
            <div className="bg-white rounded-2xl border p-6">
              <h2 className="font-bold text-gray-800 mb-4 flex items-center gap-2"><Upload className="w-4 h-4" /> Assign Dial List to Team</h2>
              <div className="grid grid-cols-2 gap-3 mb-4">
                <input placeholder="List Name *" value={newList.name} onChange={e => setNewList(l => ({ ...l, name: e.target.value }))}
                  className="border rounded-xl px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-blue-500" />
                <select value={newList.teamId} onChange={e => setNewList(l => ({ ...l, teamId: e.target.value }))}
                  className="border rounded-xl px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white">
                  <option value="">Select team *</option>
                  {teams.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
              </div>
              <div
                className="border-2 border-dashed border-gray-300 rounded-xl p-8 text-center cursor-pointer hover:border-blue-400 hover:bg-blue-50 transition-all mb-4"
                onClick={() => fileRef.current?.click()}
                onDragOver={e => e.preventDefault()}
                onDrop={e => { e.preventDefault(); handleCSVFile(e.dataTransfer.files[0]); }}
              >
                <Upload className="w-8 h-8 mx-auto text-gray-400 mb-2" />
                {newList.contacts.length > 0
                  ? <p className="text-sm text-green-700 font-medium">✓ {newList.contacts.length} contacts loaded</p>
                  : <p className="text-sm text-gray-500">Drop CSV or click to upload</p>
                }
                <input ref={fileRef} type="file" accept=".csv,.txt" className="hidden" onChange={e => handleCSVFile(e.target.files[0])} />
              </div>
              <button onClick={uploadList} className="bg-blue-600 hover:bg-blue-700 text-white px-6 py-2 rounded-xl font-medium text-sm">Assign to Team</button>
            </div>

            {/* Lists */}
            {lists.length === 0 && <div className="text-center py-16 text-gray-400 text-sm bg-white rounded-2xl border"><List className="w-10 h-10 mx-auto mb-2 opacity-30" /><p>No lists yet</p></div>}
            {lists.map(l => (
              <div key={l.id} className="bg-white rounded-2xl border p-4 flex items-center gap-4">
                <List className="w-8 h-8 text-blue-400 shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-gray-900">{l.name}</p>
                  <p className="text-xs text-gray-500">Team: {l.teamName} · {l.total} contacts · {l.done} done · {l.fail} failed</p>
                  <div className="mt-1.5 w-full bg-gray-100 rounded-full h-1.5">
                    <div className="bg-green-500 h-1.5 rounded-full" style={{ width: `${l.total ? (l.done / l.total) * 100 : 0}%` }} />
                  </div>
                </div>
                <button onClick={() => deleteList(l.id, l.name)} className="p-1.5 rounded-lg bg-red-50 hover:bg-red-100 text-red-600">
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            ))}
          </div>
        )}

        {/* ═══════════════════════════════════════ CALL LOGS ═══════════════════════════════════════ */}
        {tab === 'calls' && (
          <div>
            <div className="bg-white rounded-2xl border p-4 mb-4 flex flex-wrap items-center gap-3">
              {isAdmin && (
                <select value={selectedUser} onChange={e => { setSelectedUser(e.target.value); loadCalls(e.target.value); }}
                  className="border rounded-xl px-4 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white text-sm">
                  <option value="">All Users</option>
                  {users.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
                </select>
              )}
              <button onClick={() => loadCalls(selectedUser)} className="flex items-center gap-1.5 text-gray-500 hover:text-gray-700 text-sm">
                <RefreshCw className="w-4 h-4" /> Refresh
              </button>
              <span className="ml-auto text-sm text-gray-500">{calls.length} records</span>
            </div>

            {calls.length === 0 && <div className="text-center py-16 text-gray-400 text-sm bg-white rounded-2xl border"><Clock className="w-10 h-10 mx-auto mb-2 opacity-30" /><p>No call records found</p></div>}
            <div className="space-y-2">
              {calls.map(c => (
                <div key={c.id} className="bg-white rounded-xl border p-4 flex items-start gap-3">
                  <div className={`w-9 h-9 rounded-full flex items-center justify-center shrink-0 ${c.direction === 'outbound' ? 'bg-green-100' : 'bg-blue-100'}`}>
                    <Phone className={`w-4 h-4 ${c.direction === 'outbound' ? 'text-green-600' : 'text-blue-600'}`} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap mb-0.5">
                      <p className="font-semibold text-gray-900 text-sm">{c.contactName || 'Unknown'}</p>
                      <span className="text-xs bg-slate-100 text-slate-600 px-2 py-0.5 rounded-full">by {c.userName || 'Unknown'}</span>
                      <span className={`text-xs px-2 py-0.5 rounded-full ${c.status === 'completed' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>{c.status}</span>
                    </div>
                    <p className="text-xs text-gray-500">{c.to || c.from}</p>
                    {c.contactInfo?.company && <p className="text-xs text-gray-400">{c.contactInfo.company}</p>}
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-sm font-medium">{c.duration ? fmt(c.duration) : '--:--'}</p>
                    <p className="text-xs text-gray-400">{new Date(c.createdAt).toLocaleString()}</p>
                    {c.recordingFile && (
                      <button onClick={() => playRecording(c.recordingFile)}
                        className={`mt-1 flex items-center gap-1 text-xs px-2 py-1 rounded-lg ${playingFile === c.recordingFile ? 'bg-green-100 text-green-700 animate-pulse' : 'bg-blue-50 hover:bg-blue-100 text-blue-700'}`}
                      >
                        <Volume2 className="w-3 h-3" /> {playingFile === c.recordingFile ? 'Playing…' : 'Listen'}
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ═══════════════════════════════════════ MEETINGS ═══════════════════════════════════════ */}
        {tab === 'meetings' && (
          <div>
            <div className="bg-white rounded-2xl border p-4 mb-4 flex items-center justify-between">
              <h2 className="font-bold text-gray-800">All Meetings ({meetings.length})</h2>
              <button onClick={loadMeetings} className="text-gray-400 hover:text-gray-600"><RefreshCw className="w-4 h-4" /></button>
            </div>
            {meetings.length === 0 && <div className="text-center py-16 text-gray-400 text-sm bg-white rounded-2xl border"><Calendar className="w-10 h-10 mx-auto mb-2 opacity-30" /><p>No meetings booked yet</p></div>}
            <div className="space-y-2">
              {meetings.map(m => (
                <div key={m.id} className="bg-white rounded-xl border p-4 flex items-start gap-3">
                  <div className="w-9 h-9 rounded-full bg-purple-100 flex items-center justify-center shrink-0">
                    <Calendar className="w-4 h-4 text-purple-600" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-gray-900 text-sm">{m.contactName}</p>
                    <p className="text-xs text-gray-500">{m.contactPhone}{m.agentName ? ` · Booked by ${m.agentName}` : ''}</p>
                    {m.notes && <p className="text-xs text-gray-400 italic mt-0.5">{m.notes}</p>}
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-sm font-semibold text-gray-800">{m.date} {m.time}</p>
                    <select value={m.status} onChange={async e => { try { await api(`/meetings/${m.id}`, { method:'PATCH', body: JSON.stringify({ status: e.target.value }) }); loadMeetings(); } catch {} }}
                      className={`text-xs border rounded-lg px-2 py-1 mt-1 focus:outline-none bg-white ${m.status === 'scheduled' ? 'text-blue-700' : m.status === 'completed' ? 'text-green-700' : 'text-red-700'}`}>
                      <option value="scheduled">Scheduled</option>
                      <option value="completed">Completed</option>
                      <option value="cancelled">Cancelled</option>
                    </select>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ═══════════════════════════════════════ SETTINGS ═══════════════════════════════════════ */}
        {tab === 'settings' && (
          <div className="space-y-4">
            {/* Telnyx Integration */}
            <div className="bg-white rounded-2xl border p-6">
              <h2 className="font-bold text-gray-800 mb-1 flex items-center gap-2"><Zap className="w-4 h-4 text-yellow-500" /> Telnyx Integration</h2>
              <p className="text-xs text-gray-400 mb-4">Store your Telnyx API key here. When creating a new user with "Auto-create Telnyx SIP", the system will call Telnyx and automatically provision SIP credentials for that user.</p>
              <div className="grid grid-cols-1 gap-3">
                <div>
                  <label className="text-xs font-medium text-gray-500 block mb-1">Telnyx API Key</label>
                  <input
                    type="password" placeholder="KEY0123…"
                    value={globalSettings.telnyxApiKey}
                    onChange={e => setGlobalSettings(p => ({ ...p, telnyxApiKey: e.target.value }))}
                    className="w-full border rounded-xl px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono text-sm"
                  />
                </div>
                <div>
                  <label className="text-xs font-medium text-gray-500 block mb-1">Credential Connection ID <span className="font-normal text-gray-400">(from Telnyx Portal → Voice → Connections)</span></label>
                  <input
                    placeholder="1234567890123456789"
                    value={globalSettings.telnyxConnectionId}
                    onChange={e => setGlobalSettings(p => ({ ...p, telnyxConnectionId: e.target.value }))}
                    className="w-full border rounded-xl px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono text-sm"
                  />
                </div>
                <div>
                  <label className="text-xs font-medium text-gray-500 block mb-1">SIP Server (WebSocket URL)</label>
                  <input
                    placeholder="wss://sip.telnyx.com"
                    value={globalSettings.telnyxSipServer}
                    onChange={e => setGlobalSettings(p => ({ ...p, telnyxSipServer: e.target.value }))}
                    className="w-full border rounded-xl px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono text-sm"
                  />
                </div>
              </div>
              <button onClick={saveGlobalSettings} className="mt-4 bg-blue-600 hover:bg-blue-700 text-white px-6 py-2 rounded-xl font-medium text-sm">
                Save Settings
              </button>
            </div>

            {/* Per-user Telnyx SIP creation */}
            <div className="bg-white rounded-2xl border p-6">
              <h2 className="font-bold text-gray-800 mb-1 flex items-center gap-2"><Zap className="w-4 h-4 text-yellow-500" /> Create Telnyx SIP for Existing User</h2>
              <p className="text-xs text-gray-400 mb-4">Provision Telnyx SIP credentials for a user who doesn't have them yet.</p>
              <div className="flex gap-3">
                <select id="telnyxUserSel" className="flex-1 border rounded-xl px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white text-sm">
                  <option value="">Select user…</option>
                  {users.filter(u => u.role !== 'admin' || u.id !== 1).map(u => <option key={u.id} value={u.id}>{u.name} (@{u.username})</option>)}
                </select>
                <button
                  onClick={() => {
                    const sel = document.getElementById('telnyxUserSel');
                    const uid = sel?.value; const uName = sel?.options[sel.selectedIndex]?.text?.split(' (@')[0];
                    if (!uid) { notify('Select a user first', false); return; }
                    createTelnyxSip(uid, uName);
                  }}
                  className="bg-yellow-500 hover:bg-yellow-600 text-white px-5 py-2.5 rounded-xl text-sm font-medium flex items-center gap-2"
                >
                  <Zap className="w-4 h-4" /> Create SIP
                </button>
              </div>
            </div>
          </div>
        )}

      </div>
    </div>
  );
}
