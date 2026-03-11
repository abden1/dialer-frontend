import React, { useState, useEffect, useRef } from 'react';
import { Plus, Trash2, CheckSquare, Clock, AlertCircle, Check } from 'lucide-react';
import { API_BASE } from './apiBase.js';

async function api(path, opts = {}) {
  const token = localStorage.getItem('token');
  const res = await fetch(API_BASE + '/api' + path, {
    ...opts,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...opts.headers }
  });
  let data;
  try { data = await res.json(); } catch { throw new Error(`Server error (${res.status})`); }
  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data;
}

const STATUS_CYCLE = { pending: 'in-progress', 'in-progress': 'done', done: 'pending' };
const STATUS_CFG = {
  pending:       { label: 'Pending',     cls: 'bg-gray-100 text-gray-600',   icon: Clock },
  'in-progress': { label: 'In Progress', cls: 'bg-blue-100 text-blue-700',   icon: AlertCircle },
  done:          { label: 'Done',        cls: 'bg-green-100 text-green-700', icon: CheckSquare },
};

export default function TasksPage({ user }) {
  const canCreate = user.role === 'admin' || user.role === 'team_leader';
  const isAdmin   = user.role === 'admin';

  // Team Tasks
  const [tasks, setTasks]         = useState([]);
  const [teams, setTeams]         = useState([]);
  const [teamMembers, setTeamMembers] = useState([]);
  const [taskTab, setTaskTab]     = useState('my-team');
  const [showForm, setShowForm]   = useState(false);
  const [form, setForm]           = useState({ title: '', description: '', assignedTo: '', dueDate: '' });
  const [taskLoading, setTaskLoading] = useState(false);

  // Personal Todos
  const [todos, setTodos]         = useState([]);
  const [todoInput, setTodoInput] = useState('');
  const todoInputRef              = useRef(null);

  useEffect(() => {
    loadTasks();
    loadTodos();
    if (isAdmin) loadTeams();
    else loadMyTeamMembers();
  }, []);

  async function loadTasks() {
    try { const d = await api('/tasks'); setTasks(d.tasks || []); } catch {}
  }
  async function loadTodos() {
    try { const d = await api('/todos'); setTodos(d.todos || []); } catch {}
  }
  async function loadTeams() {
    try { const d = await api('/teams'); setTeams(d.teams || []); } catch {}
  }
  async function loadMyTeamMembers() {
    try { const d = await api('/teams/my'); setTeamMembers(d.team?.members || []); } catch {}
  }

  const allMembers = isAdmin
    ? teams.flatMap(t => t.members || []).filter((m, i, arr) => arr.findIndex(x => x.id === m.id) === i)
    : teamMembers;

  // ── Team task CRUD ────────────────────────────────────────────────────────
  async function createTask() {
    if (!form.title.trim()) return;
    setTaskLoading(true);
    try {
      await api('/tasks', { method: 'POST', body: JSON.stringify(form) });
      setForm({ title: '', description: '', assignedTo: '', dueDate: '' });
      setShowForm(false);
      loadTasks();
    } catch (e) { alert(e.message); }
    finally { setTaskLoading(false); }
  }

  async function cycleStatus(task) {
    const next = STATUS_CYCLE[task.status] || 'pending';
    try {
      await api(`/tasks/${task.id}`, { method: 'PATCH', body: JSON.stringify({ status: next }) });
      setTasks(ts => ts.map(t => t.id === task.id ? { ...t, status: next } : t));
    } catch {}
  }

  async function deleteTask(id) {
    if (!confirm('Delete this task?')) return;
    try { await api(`/tasks/${id}`, { method: 'DELETE' }); setTasks(ts => ts.filter(t => t.id !== id)); } catch {}
  }

  // ── Personal todo CRUD ────────────────────────────────────────────────────
  async function addTodo() {
    const text = todoInput.trim();
    if (!text) return;
    setTodoInput('');
    try {
      const d = await api('/todos', { method: 'POST', body: JSON.stringify({ text }) });
      setTodos(prev => [d.todo, ...prev]);
    } catch (e) { alert(e.message); }
  }

  async function toggleTodo(todo) {
    try {
      setTodos(ts => ts.map(t => t.id === todo.id ? { ...t, done: !t.done } : t));
      await api(`/todos/${todo.id}`, { method: 'PATCH', body: JSON.stringify({ done: !todo.done }) });
    } catch {}
  }

  async function deleteTodo(id) {
    try { await api(`/todos/${id}`, { method: 'DELETE' }); setTodos(ts => ts.filter(t => t.id !== id)); } catch {}
  }

  // Filtered tasks by tab
  const displayedTasks = (taskTab === 'all' && isAdmin) ? tasks : tasks;

  return (
    <div className="space-y-5">

      {/* ── Team Tasks ──────────────────────────────────────────────────────── */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <h2 className="font-bold text-gray-900 text-sm">Team Tasks</h2>
            <div className="flex gap-0.5 bg-gray-100 rounded-lg p-0.5">
              <button onClick={() => setTaskTab('my-team')}
                className={`px-2.5 py-1 rounded-md text-xs font-semibold transition-colors ${taskTab==='my-team' ? 'bg-white shadow text-gray-900' : 'text-gray-500 hover:text-gray-700'}`}>
                {canCreate ? 'My Team' : 'Assigned to me'}
              </button>
              {isAdmin && (
                <button onClick={() => setTaskTab('all')}
                  className={`px-2.5 py-1 rounded-md text-xs font-semibold transition-colors ${taskTab==='all' ? 'bg-white shadow text-gray-900' : 'text-gray-500 hover:text-gray-700'}`}>
                  All Teams
                </button>
              )}
            </div>
          </div>
          {canCreate && (
            <button onClick={() => setShowForm(p => !p)}
              className="flex items-center gap-1.5 bg-blue-600 hover:bg-blue-700 text-white px-3 py-1.5 rounded-xl text-xs font-medium">
              <Plus className="w-3.5 h-3.5" /> New Task
            </button>
          )}
        </div>

        {/* Create form */}
        {showForm && canCreate && (
          <div className="bg-white rounded-xl border p-4 mb-3 shadow-sm">
            <h3 className="font-semibold text-sm mb-3">New Task</h3>
            <div className="space-y-2">
              <input placeholder="Task title *" value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
                className="w-full border rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              <textarea placeholder="Description" rows={2} value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                className="w-full border rounded-xl px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-blue-500" />
              <div className="grid grid-cols-2 gap-2">
                <select value={form.assignedTo} onChange={e => setForm(f => ({ ...f, assignedTo: e.target.value }))}
                  className="border rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                  <option value="">Assign to…</option>
                  {allMembers.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
                </select>
                <input type="date" value={form.dueDate} onChange={e => setForm(f => ({ ...f, dueDate: e.target.value }))}
                  className="border rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
            </div>
            <div className="flex gap-2 mt-3">
              <button onClick={createTask} disabled={taskLoading || !form.title.trim()}
                className="bg-blue-600 hover:bg-blue-700 disabled:bg-gray-200 text-white px-4 py-1.5 rounded-lg text-sm font-medium">
                {taskLoading ? 'Creating…' : 'Create'}
              </button>
              <button onClick={() => setShowForm(false)} className="bg-gray-100 hover:bg-gray-200 text-gray-700 px-4 py-1.5 rounded-lg text-sm font-medium">
                Cancel
              </button>
            </div>
          </div>
        )}

        {displayedTasks.length === 0 ? (
          <div className="text-center py-8 text-gray-400 bg-white rounded-xl border">
            <CheckSquare className="w-8 h-8 mx-auto mb-2 opacity-30" />
            <p className="text-xs">No tasks yet</p>
          </div>
        ) : (
          <div className="space-y-2">
            {displayedTasks.map(task => {
              const cfg = STATUS_CFG[task.status] || STATUS_CFG.pending;
              const Icon = cfg.icon;
              const canDelete = task.createdBy === user.id || isAdmin;
              return (
                <div key={task.id} className="bg-white rounded-xl border p-3 flex items-start gap-3 hover:shadow-sm transition-shadow">
                  <button onClick={() => cycleStatus(task)}
                    className={`mt-0.5 px-2 py-1 rounded-lg text-xs font-semibold flex items-center gap-1 shrink-0 transition-colors ${cfg.cls} hover:opacity-80`}
                    title="Click to change status">
                    <Icon className="w-3 h-3" />
                    {cfg.label}
                  </button>
                  <div className="flex-1 min-w-0">
                    <p className={`font-semibold text-sm text-gray-900 ${task.status === 'done' ? 'line-through text-gray-400' : ''}`}>
                      {task.title}
                    </p>
                    {task.description && (
                      <p className="text-xs text-gray-500 mt-0.5 truncate">{task.description}</p>
                    )}
                    <div className="flex flex-wrap items-center gap-2 mt-1.5">
                      {task.assignedToName !== 'Unassigned' && (
                        <span className="text-[10px] bg-purple-50 text-purple-700 px-1.5 py-0.5 rounded-full font-medium">
                          → {task.assignedToName}
                        </span>
                      )}
                      {task.teamName && task.teamName !== 'No Team' && taskTab === 'all' && (
                        <span className="text-[10px] bg-blue-50 text-blue-600 px-1.5 py-0.5 rounded-full font-medium">
                          {task.teamName}
                        </span>
                      )}
                      {task.dueDate && (
                        <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${
                          new Date(task.dueDate) < new Date() && task.status !== 'done'
                            ? 'bg-red-50 text-red-600' : 'bg-gray-50 text-gray-500'
                        }`}>
                          Due {task.dueDate}
                        </span>
                      )}
                      <span className="text-[10px] text-gray-400">by {task.createdByName}</span>
                    </div>
                  </div>
                  {canDelete && (
                    <button onClick={() => deleteTask(task.id)}
                      className="p-1.5 text-gray-300 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors shrink-0">
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ── Personal Todo List ───────────────────────────────────────────────── */}
      <div>
        <h2 className="font-bold text-gray-900 text-sm mb-3">My Todo List</h2>

        {/* Add todo input */}
        <div className="flex gap-2 mb-3">
          <input
            ref={todoInputRef}
            value={todoInput}
            onChange={e => setTodoInput(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && addTodo()}
            placeholder="Add a personal todo…"
            className="flex-1 border rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <button onClick={addTodo} disabled={!todoInput.trim()}
            className="bg-blue-600 hover:bg-blue-700 disabled:bg-gray-200 text-white px-3 py-2 rounded-xl text-sm">
            <Plus className="w-4 h-4" />
          </button>
        </div>

        {todos.length === 0 ? (
          <div className="text-center py-8 text-gray-400 bg-white rounded-xl border">
            <Check className="w-8 h-8 mx-auto mb-2 opacity-30" />
            <p className="text-xs">Your todo list is empty</p>
          </div>
        ) : (
          <div className="space-y-1.5">
            {todos.map(todo => (
              <div key={todo.id} className="bg-white rounded-xl border px-3 py-2.5 flex items-center gap-3 hover:shadow-sm transition-shadow">
                <button onClick={() => toggleTodo(todo)}
                  className={`w-5 h-5 rounded-md border-2 flex items-center justify-center shrink-0 transition-colors ${
                    todo.done ? 'bg-green-500 border-green-500 text-white' : 'border-gray-300 hover:border-blue-400'
                  }`}>
                  {todo.done && <Check className="w-3 h-3" />}
                </button>
                <span className={`flex-1 text-sm ${todo.done ? 'line-through text-gray-400' : 'text-gray-800'}`}>
                  {todo.text}
                </span>
                <button onClick={() => deleteTodo(todo.id)}
                  className="p-1 text-gray-300 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors shrink-0">
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}
            {todos.some(t => t.done) && (
              <p className="text-[10px] text-gray-400 text-center pt-1">
                {todos.filter(t => t.done).length} of {todos.length} completed
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
