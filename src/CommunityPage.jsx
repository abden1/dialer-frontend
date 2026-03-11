import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Phone, Send, MessageSquare, Users, Heart, MessageCircle, Trash2, Shield, User, ChevronLeft, ArrowLeft, ImagePlus, X } from 'lucide-react';
import { API_BASE } from './apiBase.js';

async function api(path, opts = {}) {
  const token = localStorage.getItem('token');
  const isFormData = opts.body instanceof FormData;
  const res   = await fetch(API_BASE + '/api' + path, {
    ...opts,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(isFormData ? {} : { 'Content-Type': 'application/json' }),
      ...opts.headers
    }
  });
  let data;
  try { data = await res.json(); } catch { throw new Error(`Server error (${res.status})`); }
  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data;
}

function RoleBadge({ role }) {
  const cfg = {
    admin:       { bg: 'bg-purple-100 text-purple-700', label: 'Admin' },
    team_leader: { bg: 'bg-blue-100 text-blue-700',     label: 'Leader' },
    agent:       { bg: 'bg-gray-100 text-gray-600',     label: 'Agent' },
  };
  const c = cfg[role] || cfg.agent;
  return <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${c.bg}`}>{c.label}</span>;
}

function Avatar({ name, size = 'md', online }) {
  const sz = size === 'sm' ? 'w-7 h-7 text-xs' : size === 'lg' ? 'w-11 h-11 text-sm' : 'w-9 h-9 text-sm';
  return (
    <div className="relative shrink-0">
      <div className={`${sz} rounded-full bg-gradient-to-br from-blue-400 to-blue-600 flex items-center justify-center font-bold text-white`}>
        {name?.[0]?.toUpperCase() || '?'}
      </div>
      {online !== undefined && (
        <div className={`absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border-2 border-white ${online ? 'bg-green-500' : 'bg-gray-300'}`} />
      )}
    </div>
  );
}

function timeAgo(dateStr) {
  const diff = Date.now() - new Date(dateStr).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1)  return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return new Date(dateStr).toLocaleDateString();
}

// ─────────────────────────────────────────────────────────────────────────────
export default function CommunityPage({ user, onlineAgents, phone, chatMessages, signals, makeCall }) {
  const [leftTab,  setLeftTab]  = useState('people'); // 'people' | 'team'
  const [rightTab, setRightTab] = useState('feed');   // 'feed' | 'teamchat' | 'dm'

  // People
  const [allUsers, setAllUsers]       = useState([]);
  const [myTeam,   setMyTeam]         = useState(null);
  const [peopleSearch, setPeopleSearch] = useState('');

  // Direct Messages
  const [dmTarget,    setDmTarget]    = useState(null);   // user object we're DM-ing
  const [dmMessages,  setDmMessages]  = useState([]);
  const [dmInput,     setDmInput]     = useState('');
  const dmEndRef                      = useRef(null);

  // Team Chat
  const [messages,   setMessages]  = useState([]);
  const [chatInput,  setChatInput] = useState('');
  const [chatScope,  setChatScope] = useState('all'); // 'all' | 'team'
  const chatEndRef                 = useRef(null);

  // Feed (Posts)
  const [posts,         setPosts]         = useState([]);
  const [postInput,     setPostInput]     = useState('');
  const [postImageFile, setPostImageFile] = useState(null);
  const [postImagePreview, setPostImagePreview] = useState(null);
  const [posting,       setPosting]       = useState(false);
  const [expanded,      setExpanded]      = useState(new Set());
  const [commentInputs, setCommentInputs] = useState({});
  const postImageRef = useRef(null);

  const onlineSet = new Set(onlineAgents.map(a => a.id));

  // ── Load data ──────────────────────────────────────────────────────────────
  useEffect(() => {
    loadAllUsers();
    loadMyTeam();
    loadMessages();
    loadPosts();
  }, []);

  async function loadAllUsers() {
    try { const d = await api('/users/all'); setAllUsers(d.users || []); } catch {}
  }
  async function loadMyTeam() {
    try { const d = await api('/teams/my'); setMyTeam(d.team); } catch {}
  }
  async function loadMessages(scope) {
    const s = scope || chatScope;
    try { const d = await api(`/messages?limit=80&scope=${s}`); setMessages(d.messages || []); } catch {}
  }
  async function loadPosts() {
    try { const d = await api('/posts?limit=30'); setPosts(d.posts || []); } catch {}
  }
  async function loadDmHistory(targetId) {
    try { const d = await api(`/messages/dm/${targetId}`); setDmMessages(d.messages || []); } catch {}
  }

  // ── Open DM with a person ─────────────────────────────────────────────────
  function openDm(person) {
    setDmTarget(person);
    setRightTab('dm');
    loadDmHistory(person.id);
  }

  // Reload chat when scope changes
  useEffect(() => { loadMessages(chatScope); }, [chatScope]);

  // ── Merge real-time team chat ─────────────────────────────────────────────
  useEffect(() => {
    if (!chatMessages?.length) return;
    const last = chatMessages[chatMessages.length - 1];
    // Only add if scope matches
    if (last.scope && last.scope !== chatScope) return;
    setMessages(prev => prev.find(m => m.id === last.id) ? prev : [...prev, last]);
  }, [chatMessages]);

  // ── Handle WS signals ────────────────────────────────────────────────────
  useEffect(() => {
    if (!signals?.length) return;
    const sig = signals[signals.length - 1];
    switch (sig.type) {
      case 'post-new':
        setPosts(prev => [{ ...sig.post, likedByMe: false }, ...prev.filter(p => p.id !== sig.post.id)]);
        break;
      case 'post-like':
        setPosts(prev => prev.map(p => p.id === sig.postId
          ? { ...p, likes: sig.likes, likeCount: sig.likes.length, likedByMe: sig.likes.includes(user.id) }
          : p));
        break;
      case 'post-comment':
        setPosts(prev => prev.map(p => p.id === sig.postId
          ? { ...p, commentCount: sig.commentCount, comments: [...(p.comments || []), sig.comment] }
          : p));
        break;
      case 'post-delete':
        setPosts(prev => prev.filter(p => p.id !== sig.postId));
        break;
      case 'dm': {
        const m = sig.message;
        // Only append if this DM belongs to current conversation
        if (dmTarget && (m.fromId === dmTarget.id || m.toId === dmTarget.id)) {
          setDmMessages(prev => prev.find(x => x.id === m.id) ? prev : [...prev, m]);
        }
        break;
      }
    }
  }, [signals, dmTarget]);

  // Auto-scroll chat
  useEffect(() => {
    if (rightTab === 'teamchat') chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, rightTab]);

  useEffect(() => {
    if (rightTab === 'dm') dmEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [dmMessages, rightTab]);

  // ── Team Chat send ─────────────────────────────────────────────────────────
  function sendChat() {
    const text = chatInput.trim();
    if (!text) return;
    if (phone?.sendChat) phone.sendChat(text, chatScope);
    else api('/messages', { method: 'POST', body: JSON.stringify({ text, scope: chatScope }) }).catch(() => {});
    setChatInput('');
  }

  // ── DM send ───────────────────────────────────────────────────────────────
  async function sendDm() {
    const text = dmInput.trim();
    if (!text || !dmTarget) return;
    setDmInput('');
    // Optimistic local add
    const optimistic = { id: Date.now(), fromId: user.id, toId: dmTarget.id, text, fromName: user.name, createdAt: new Date().toISOString() };
    setDmMessages(prev => [...prev, optimistic]);
    try {
      await api('/messages/dm', { method: 'POST', body: JSON.stringify({ toId: dmTarget.id, text }) });
    } catch {}
  }

  // ── Post CRUD ─────────────────────────────────────────────────────────────
  async function createPost() {
    const text = postInput.trim();
    if (!text || posting) return;
    setPosting(true);
    try {
      const fd = new FormData();
      fd.append('text', text);
      if (postImageFile) fd.append('image', postImageFile);
      await api('/posts', { method: 'POST', body: fd });
      setPostInput('');
      setPostImageFile(null);
      setPostImagePreview(null);
      if (!phone?.sendChat) loadPosts();
    } catch (e) { alert(e.message); }
    finally { setPosting(false); }
  }

  function handleImageSelect(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setPostImageFile(file);
    const reader = new FileReader();
    reader.onload = ev => setPostImagePreview(ev.target.result);
    reader.readAsDataURL(file);
  }

  async function deletePost(id) {
    if (!confirm('Delete this post?')) return;
    try { await api(`/posts/${id}`, { method: 'DELETE' }); } catch (e) { alert(e.message); }
  }

  async function toggleLike(id) {
    // Optimistic update
    setPosts(prev => prev.map(p => {
      if (p.id !== id) return p;
      const liked = !p.likedByMe;
      return { ...p, likedByMe: liked, likeCount: liked ? (p.likeCount||0) + 1 : Math.max((p.likeCount||1) - 1, 0) };
    }));
    try {
      const d = await api(`/posts/${id}/like`, { method: 'POST' });
      setPosts(prev => prev.map(p => p.id === id ? { ...p, likeCount: d.likeCount, likedByMe: d.likedByMe } : p));
    } catch {}
  }

  async function addComment(postId) {
    const text = (commentInputs[postId] || '').trim();
    if (!text) return;
    try {
      await api(`/posts/${postId}/comments`, { method: 'POST', body: JSON.stringify({ text }) });
      setCommentInputs(p => ({ ...p, [postId]: '' }));
      if (!phone?.sendChat) loadPosts();
    } catch (e) { alert(e.message); }
  }

  async function deleteComment(postId, commentId) {
    try { await api(`/posts/${postId}/comments/${commentId}`, { method: 'DELETE' }); loadPosts(); } catch {}
  }

  function toggleComments(postId) {
    setExpanded(prev => {
      const n = new Set(prev);
      if (n.has(postId)) n.delete(postId);
      else {
        n.add(postId);
        api('/posts?limit=30').then(d => setPosts(d.posts || [])).catch(() => {});
      }
      return n;
    });
  }

  // ── Filtered people ───────────────────────────────────────────────────────
  const filteredPeople = allUsers.filter(u =>
    u.name?.toLowerCase().includes(peopleSearch.toLowerCase()) ||
    u.username?.toLowerCase().includes(peopleSearch.toLowerCase()) ||
    u.teamName?.toLowerCase().includes(peopleSearch.toLowerCase())
  );

  // ── Chat bubble ───────────────────────────────────────────────────────────
  function ChatBubble({ m, isMe }) {
    return (
      <div className={`flex gap-2 ${isMe ? 'flex-row-reverse' : ''}`}>
        <Avatar name={m.fromName || m.userName} size="sm" />
        <div className={`max-w-[72%] flex flex-col gap-0.5 ${isMe ? 'items-end' : 'items-start'}`}>
          <div className={`flex items-center gap-1.5 flex-wrap ${isMe ? 'flex-row-reverse' : ''}`}>
            <span className="text-xs font-semibold text-gray-700">{m.fromName || m.userName}</span>
            {m.role && <RoleBadge role={m.role} />}
            {m.teamName && <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-slate-100 text-slate-500 font-medium">{m.teamName}</span>}
          </div>
          <div className={`px-3 py-2 rounded-2xl text-sm leading-snug ${isMe ? 'bg-blue-600 text-white rounded-tr-sm' : 'bg-slate-100 text-gray-800 rounded-tl-sm'}`}>
            {m.text}
          </div>
          <span className="text-[10px] text-gray-400">{timeAgo(m.createdAt)}</span>
        </div>
      </div>
    );
  }

  // ═══════════════════════════════════════════════════════════════════════════
  return (
    <div className="flex gap-4" style={{ height: 'calc(100vh - 120px)' }}>

      {/* ── Left Panel ───────────────────────────────────────────────── */}
      <div className="w-64 shrink-0 flex flex-col bg-white rounded-2xl border shadow-sm overflow-hidden">
        {/* Left tabs */}
        <div className="flex border-b shrink-0">
          <button onClick={() => setLeftTab('people')}
            className={`flex-1 py-2.5 text-xs font-semibold flex items-center justify-center gap-1.5 border-b-2 transition-colors ${leftTab==='people' ? 'border-blue-500 text-blue-600 bg-blue-50' : 'border-transparent text-gray-500 hover:text-gray-700'}`}>
            <Users className="w-3.5 h-3.5" /> People
          </button>
          <button onClick={() => setLeftTab('team')}
            className={`flex-1 py-2.5 text-xs font-semibold flex items-center justify-center gap-1.5 border-b-2 transition-colors ${leftTab==='team' ? 'border-blue-500 text-blue-600 bg-blue-50' : 'border-transparent text-gray-500 hover:text-gray-700'}`}>
            <Shield className="w-3.5 h-3.5" /> Team
          </button>
        </div>

        {/* People tab */}
        {leftTab === 'people' && (
          <div className="flex flex-col flex-1 overflow-hidden p-2">
            <input
              value={peopleSearch} onChange={e => setPeopleSearch(e.target.value)}
              placeholder="Search people…"
              className="w-full border rounded-lg px-2.5 py-1.5 text-xs mb-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-1.5 px-1">
              {onlineSet.size} online · {allUsers.length} total
            </p>
            <div className="flex-1 overflow-y-auto space-y-0.5 pr-0.5">
              {filteredPeople.map(u => (
                <div key={u.id}
                  onClick={() => { if (u.id !== user.id) openDm(u); }}
                  className={`flex items-center gap-2 p-2 rounded-xl transition-colors cursor-pointer
                    ${dmTarget?.id === u.id && rightTab === 'dm' ? 'bg-blue-50 ring-1 ring-blue-200' : 'hover:bg-gray-50'}`}>
                  <Avatar name={u.name} size="sm" online={onlineSet.has(u.id)} />
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-semibold text-gray-900 truncate">{u.name}</p>
                    <div className="flex items-center gap-1 flex-wrap mt-0.5">
                      <RoleBadge role={u.role} />
                      {u.teamName && (
                        <span className="text-[9px] px-1 py-0.5 rounded-full bg-slate-100 text-slate-500 font-medium">{u.teamName}</span>
                      )}
                    </div>
                  </div>
                  {u.id !== user.id && (
                    <div className="flex gap-1 shrink-0">
                      <button onClick={e => { e.stopPropagation(); makeCall(String(u.id), u); }} title="Call"
                        className={`p-1 rounded-lg ${onlineSet.has(u.id) ? 'bg-green-50 hover:bg-green-100 text-green-700' : 'bg-gray-50 hover:bg-gray-100 text-gray-400'}`}>
                        <Phone className="w-3 h-3" />
                      </button>
                      <button onClick={e => { e.stopPropagation(); openDm(u); }} title="Message"
                        className="p-1 bg-blue-50 hover:bg-blue-100 text-blue-600 rounded-lg">
                        <MessageSquare className="w-3 h-3" />
                      </button>
                    </div>
                  )}
                </div>
              ))}
              {filteredPeople.length === 0 && (
                <p className="text-xs text-gray-400 text-center py-4">No users found</p>
              )}
            </div>
          </div>
        )}

        {/* Team tab */}
        {leftTab === 'team' && (
          <div className="flex-1 overflow-y-auto p-3">
            {!myTeam ? (
              <div className="text-center py-8 text-gray-400 text-xs">
                <Shield className="w-8 h-8 mx-auto mb-2 opacity-30" />
                <p>You are not in a team yet</p>
              </div>
            ) : (
              <div>
                <div className="bg-blue-50 rounded-xl p-3 mb-3">
                  <p className="font-bold text-blue-900 text-sm">{myTeam.name}</p>
                  {myTeam.leaderName && <p className="text-xs text-blue-600 mt-0.5">Leader: {myTeam.leaderName}</p>}
                  <p className="text-xs text-blue-400 mt-0.5">{myTeam.members?.length || 0} members</p>
                </div>
                <div className="space-y-1.5">
                  {myTeam.members?.map(m => (
                    <div key={m.id}
                      onClick={() => { if (m.id !== user.id) openDm(m); }}
                      className="flex items-center gap-2 p-2 rounded-xl bg-white border hover:bg-gray-50 cursor-pointer transition-colors">
                      <Avatar name={m.name} size="sm" online={onlineSet.has(m.id)} />
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-semibold text-gray-900 truncate">{m.name}</p>
                        <RoleBadge role={m.role} />
                      </div>
                      {m.id !== user.id && onlineSet.has(m.id) && (
                        <button onClick={e => { e.stopPropagation(); makeCall(String(m.id), m); }}
                          className="p-1 bg-green-50 hover:bg-green-100 text-green-700 rounded-lg shrink-0">
                          <Phone className="w-3 h-3" />
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── Right Panel ─────────────────────────────────────────────── */}
      <div className="flex-1 flex flex-col bg-white rounded-2xl border shadow-sm overflow-hidden">
        {/* Right tabs */}
        <div className="flex border-b shrink-0">
          <button onClick={() => setRightTab('feed')}
            className={`flex-1 py-2.5 text-sm font-semibold flex items-center justify-center gap-2 border-b-2 transition-colors ${rightTab==='feed' ? 'border-blue-500 text-blue-600 bg-blue-50' : 'border-transparent text-gray-500 hover:text-gray-700'}`}>
            <Users className="w-4 h-4" /> Feed
          </button>
          <button onClick={() => setRightTab('teamchat')}
            className={`flex-1 py-2.5 text-sm font-semibold flex items-center justify-center gap-2 border-b-2 transition-colors ${rightTab==='teamchat' ? 'border-blue-500 text-blue-600 bg-blue-50' : 'border-transparent text-gray-500 hover:text-gray-700'}`}>
            <MessageSquare className="w-4 h-4" /> Team Chat
          </button>
          <button onClick={() => setRightTab('dm')}
            className={`flex-1 py-2.5 text-sm font-semibold flex items-center justify-center gap-2 border-b-2 transition-colors ${rightTab==='dm' ? 'border-blue-500 text-blue-600 bg-blue-50' : 'border-transparent text-gray-500 hover:text-gray-700'}`}>
            <User className="w-4 h-4" /> Direct
            {rightTab !== 'dm' && dmTarget && <span className="w-2 h-2 rounded-full bg-blue-500 ml-0.5" />}
          </button>
        </div>

        {/* ── FEED ──────────────────────────────────────────────────── */}
        {rightTab === 'feed' && (
          <div className="flex-1 flex flex-col overflow-hidden">
            <div className="p-4 border-b shrink-0">
              <div className="flex gap-3">
                <Avatar name={user.name} size="sm" />
                <div className="flex-1">
                  <textarea
                    value={postInput} onChange={e => setPostInput(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter' && e.ctrlKey) createPost(); }}
                    placeholder="Share something with your team… (Ctrl+Enter to post)"
                    rows={2}
                    className="w-full border rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
                  />
                  {postImagePreview && (
                    <div className="relative mt-2">
                      <img src={postImagePreview} alt="preview" className="rounded-xl max-h-40 w-full object-cover border" />
                      <button onClick={() => { setPostImageFile(null); setPostImagePreview(null); }}
                        className="absolute top-1 right-1 bg-black/50 text-white rounded-full p-0.5 hover:bg-black/70">
                        <X className="w-3 h-3" />
                      </button>
                    </div>
                  )}
                  <div className="flex items-center justify-between mt-1.5">
                    <button onClick={() => postImageRef.current?.click()}
                      className="flex items-center gap-1.5 text-xs text-gray-400 hover:text-blue-500 transition-colors">
                      <ImagePlus className="w-4 h-4" /> Add Photo
                    </button>
                    <input ref={postImageRef} type="file" accept="image/*" className="hidden" onChange={handleImageSelect} />
                    <button onClick={createPost} disabled={!postInput.trim() || posting}
                      className="bg-blue-600 hover:bg-blue-700 disabled:bg-gray-200 disabled:cursor-not-allowed text-white px-4 py-1.5 rounded-lg text-sm font-medium transition-colors">
                      {posting ? 'Posting…' : 'Post'}
                    </button>
                  </div>
                </div>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              {posts.length === 0 && (
                <div className="text-center py-12 text-gray-400 text-sm">
                  <Users className="w-10 h-10 mx-auto mb-2 opacity-30" />
                  <p>No posts yet. Be the first to share something!</p>
                </div>
              )}
              {posts.map(post => (
                <div key={post.id} className="border rounded-2xl overflow-hidden bg-white shadow-sm hover:shadow-md transition-shadow">
                  <div className="px-4 pt-4 pb-2">
                    <div className="flex items-start gap-3">
                      <Avatar name={post.userName} size="md" />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-semibold text-sm text-gray-900">{post.userName}</span>
                          <RoleBadge role={post.role} />
                          {post.teamName && <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-slate-100 text-slate-500 font-medium">{post.teamName}</span>}
                        </div>
                        <p className="text-xs text-gray-400 mt-0.5">{timeAgo(post.createdAt)}</p>
                      </div>
                      {(post.userId === user.id || user.role === 'admin') && (
                        <button onClick={() => deletePost(post.id)} className="p-1 rounded-lg text-gray-300 hover:text-red-500 hover:bg-red-50 transition-colors">
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                    <p className="text-sm text-gray-800 mt-3 leading-relaxed whitespace-pre-wrap">{post.text}</p>
                    {post.imageUrl && (
                      <img src={post.imageUrl} alt="post" className="rounded-xl mt-3 max-h-64 w-full object-cover border" />
                    )}
                  </div>

                  <div className="px-4 py-2 border-t bg-gray-50 flex items-center gap-4">
                    <button onClick={() => toggleLike(post.id)}
                      className={`flex items-center gap-1.5 text-xs font-medium transition-colors ${post.likedByMe ? 'text-red-500' : 'text-gray-400 hover:text-red-400'}`}>
                      <Heart className={`w-4 h-4 ${post.likedByMe ? 'fill-current' : ''}`} />
                      {post.likeCount || 0}
                    </button>
                    <button onClick={() => toggleComments(post.id)}
                      className="flex items-center gap-1.5 text-xs font-medium text-gray-400 hover:text-blue-500 transition-colors">
                      <MessageCircle className="w-4 h-4" />
                      {post.commentCount || 0} {expanded.has(post.id) ? '▲' : '▼'}
                    </button>
                  </div>

                  {expanded.has(post.id) && (
                    <div className="px-4 pb-3 space-y-2 bg-gray-50">
                      {(post.comments || []).map(c => (
                        <div key={c.id} className="flex items-start gap-2 pt-2">
                          <Avatar name={c.userName} size="sm" />
                          <div className="flex-1 bg-white rounded-xl px-3 py-2 text-sm border">
                            <div className="flex items-center gap-1.5 mb-0.5">
                              <span className="font-semibold text-xs text-gray-800">{c.userName}</span>
                              <RoleBadge role={c.role} />
                              <span className="text-[10px] text-gray-400 ml-auto">{timeAgo(c.createdAt)}</span>
                            </div>
                            <p className="text-xs text-gray-700">{c.text}</p>
                          </div>
                          {(c.userId === user.id || user.role === 'admin') && (
                            <button onClick={() => deleteComment(post.id, c.id)} className="mt-1 p-0.5 text-gray-300 hover:text-red-400">
                              <Trash2 className="w-3 h-3" />
                            </button>
                          )}
                        </div>
                      ))}
                      <div className="flex items-center gap-2 pt-1.5">
                        <Avatar name={user.name} size="sm" />
                        <input
                          value={commentInputs[post.id] || ''}
                          onChange={e => setCommentInputs(p => ({ ...p, [post.id]: e.target.value }))}
                          onKeyDown={e => { if (e.key === 'Enter') addComment(post.id); }}
                          placeholder="Write a comment… (Enter)"
                          className="flex-1 border rounded-xl px-3 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-blue-400"
                        />
                        <button onClick={() => addComment(post.id)} disabled={!commentInputs[post.id]?.trim()}
                          className="p-1.5 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-200 text-white rounded-lg">
                          <Send className="w-3 h-3" />
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── TEAM CHAT ─────────────────────────────────────────────── */}
        {rightTab === 'teamchat' && (
          <div className="flex-1 flex flex-col overflow-hidden">
            <div className="px-4 py-2 border-b bg-gray-50 shrink-0 flex items-center gap-2">
              <button onClick={() => setChatScope('all')}
                className={`px-3 py-1 rounded-full text-xs font-semibold transition-colors ${chatScope==='all' ? 'bg-blue-600 text-white' : 'bg-white border text-gray-500 hover:text-gray-700'}`}>
                All
              </button>
              <button onClick={() => setChatScope('team')}
                className={`px-3 py-1 rounded-full text-xs font-semibold transition-colors ${chatScope==='team' ? 'bg-blue-600 text-white' : 'bg-white border text-gray-500 hover:text-gray-700'}`}>
                My Team
              </button>
              <span className="text-[10px] text-gray-400 ml-auto">
                {chatScope === 'team' ? 'Only your team sees this' : 'Everyone can see this'}
              </span>
            </div>
            <div className="flex-1 overflow-y-auto p-4 space-y-3">
              {messages.length === 0 && (
                <div className="text-center py-12 text-gray-400 text-sm">
                  <MessageSquare className="w-8 h-8 mx-auto mb-2 opacity-30" />
                  <p>No messages yet. Say hello!</p>
                </div>
              )}
              {messages.map(m => {
                const isMe = m.userId === user.id;
                return (
                  <div key={m.id} className={`flex gap-2 ${isMe ? 'flex-row-reverse' : ''}`}>
                    <Avatar name={m.userName} size="sm" />
                    <div className={`max-w-[70%] flex flex-col gap-0.5 ${isMe ? 'items-end' : 'items-start'}`}>
                      <div className={`flex items-center gap-1.5 flex-wrap ${isMe ? 'flex-row-reverse' : ''}`}>
                        <span className="text-xs font-semibold text-gray-700">{m.userName}</span>
                        <RoleBadge role={m.role} />
                        {m.teamName && <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-slate-100 text-slate-500 font-medium">{m.teamName}</span>}
                      </div>
                      <div className={`px-3 py-2 rounded-2xl text-sm leading-snug ${isMe ? 'bg-blue-600 text-white rounded-tr-sm' : 'bg-slate-100 text-gray-800 rounded-tl-sm'}`}>
                        {m.text}
                      </div>
                      <span className="text-[10px] text-gray-400">
                        {new Date(m.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </span>
                    </div>
                  </div>
                );
              })}
              <div ref={chatEndRef} />
            </div>
            <div className="p-3 border-t flex gap-2 shrink-0">
              <input
                value={chatInput} onChange={e => setChatInput(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendChat(); } }}
                placeholder="Message everyone… (Enter to send)"
                className="flex-1 border rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <button onClick={sendChat} disabled={!chatInput.trim()}
                className="p-2.5 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-200 disabled:cursor-not-allowed text-white rounded-xl transition-colors">
                <Send className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}

        {/* ── DIRECT MESSAGE ─────────────────────────────────────────── */}
        {rightTab === 'dm' && (
          <div className="flex-1 flex flex-col overflow-hidden">
            {!dmTarget ? (
              <div className="flex-1 flex flex-col items-center justify-center text-gray-400 text-sm gap-3">
                <User className="w-12 h-12 opacity-20" />
                <p>Select someone from the People list to start a conversation</p>
              </div>
            ) : (
              <>
                {/* DM header */}
                <div className="px-4 py-2.5 border-b bg-white shrink-0 flex items-center gap-3">
                  <button onClick={() => setDmTarget(null)} className="p-1 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100">
                    <ArrowLeft className="w-4 h-4" />
                  </button>
                  <Avatar name={dmTarget.name} size="sm" online={onlineSet.has(dmTarget.id)} />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-gray-900">{dmTarget.name}</p>
                    <div className="flex items-center gap-1.5">
                      <RoleBadge role={dmTarget.role} />
                      {dmTarget.teamName && <span className="text-[9px] text-gray-400">{dmTarget.teamName}</span>}
                      <span className={`text-[10px] ${onlineSet.has(dmTarget.id) ? 'text-green-500' : 'text-gray-400'}`}>
                        {onlineSet.has(dmTarget.id) ? '● Online' : '○ Offline'}
                      </span>
                    </div>
                  </div>
                  {onlineSet.has(dmTarget.id) && (
                    <button onClick={() => makeCall(String(dmTarget.id), dmTarget)}
                      className="p-2 bg-green-50 hover:bg-green-100 text-green-700 rounded-xl flex items-center gap-1.5 text-xs font-medium">
                      <Phone className="w-3.5 h-3.5" /> Call
                    </button>
                  )}
                </div>

                {/* DM messages */}
                <div className="flex-1 overflow-y-auto p-4 space-y-3">
                  {dmMessages.length === 0 && (
                    <div className="text-center py-10 text-gray-400 text-sm">
                      <MessageSquare className="w-8 h-8 mx-auto mb-2 opacity-30" />
                      <p>No messages yet. Send the first message!</p>
                    </div>
                  )}
                  {dmMessages.map(m => {
                    const isMe = m.fromId === user.id;
                    return (
                      <div key={m.id} className={`flex gap-2 ${isMe ? 'flex-row-reverse' : ''}`}>
                        <Avatar name={isMe ? user.name : dmTarget.name} size="sm" />
                        <div className={`max-w-[70%] flex flex-col gap-0.5 ${isMe ? 'items-end' : 'items-start'}`}>
                          <div className={`px-3 py-2 rounded-2xl text-sm leading-snug ${isMe ? 'bg-blue-600 text-white rounded-tr-sm' : 'bg-slate-100 text-gray-800 rounded-tl-sm'}`}>
                            {m.text}
                          </div>
                          <span className="text-[10px] text-gray-400">{timeAgo(m.createdAt)}</span>
                        </div>
                      </div>
                    );
                  })}
                  <div ref={dmEndRef} />
                </div>

                {/* DM input */}
                <div className="p-3 border-t flex gap-2 shrink-0">
                  <input
                    value={dmInput} onChange={e => setDmInput(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendDm(); } }}
                    placeholder={`Message ${dmTarget.name}… (Enter to send)`}
                    className="flex-1 border rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                  <button onClick={sendDm} disabled={!dmInput.trim()}
                    className="p-2.5 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-200 disabled:cursor-not-allowed text-white rounded-xl transition-colors">
                    <Send className="w-4 h-4" />
                  </button>
                </div>
              </>
            )}
          </div>
        )}
      </div>

    </div>
  );
}
