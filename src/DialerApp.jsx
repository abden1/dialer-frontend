import React, { useState, useEffect, useRef } from 'react';
import {
  Phone, PhoneOff, Mic, MicOff, Volume2,
  Users, Clock, Search, X, Play, Pause, LogOut,
  Settings, Trash2, Plus, CheckCircle,
  Radio, Calendar, MessageSquare, List, Shield, CheckSquare
} from 'lucide-react';
import { createPhone } from './phone.js';
import CommunityPage from './CommunityPage.jsx';
import TasksPage from './TasksPage.jsx';
import ProfilePage from './ProfilePage.jsx';
import { API_BASE } from './apiBase.js';

// ─── API ─────────────────────────────────────────────────────────────────────
async function api(path, opts = {}) {
  const token = localStorage.getItem('token');
  const res   = await fetch(API_BASE + '/api' + path, {
    ...opts,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...opts.headers }
  });
  let data;
  try { data = await res.json(); }
  catch { throw new Error(`Server error (${res.status}) — is the backend running?`); }
  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data;
}

function fmt(sec) { const m=Math.floor(sec/60),s=sec%60; return `${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`; }

function StatusBadge({ s }) {
  const cls = {
    pending:'bg-gray-100 text-gray-600', calling:'bg-blue-100 text-blue-700 animate-pulse',
    completed:'bg-green-100 text-green-700', failed:'bg-red-100 text-red-700',
    skipped:'bg-yellow-100 text-yellow-700', 'no-answer':'bg-orange-100 text-orange-700',
    busy:'bg-purple-100 text-purple-700', voicemail:'bg-slate-100 text-slate-700',
    callback:'bg-teal-100 text-teal-700', 'not-interested':'bg-red-50 text-red-500'
  };
  return <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${cls[s]||cls.pending}`}>{s}</span>;
}

// ─────────────────────────────────────────────────────────────────────────────
export default function DialerApp({ user, onLogout, onOpenAdmin, onOpenSettings }) {
  const [tab, setTab]             = useState('contacts');
  const [phone, setPhone]         = useState(null);
  const [devStatus, setDevStatus] = useState('initializing');

  // Active call
  const [callState, setCallState]       = useState('idle');
  const [currentCall, setCurrentCall]   = useState(null);
  const [phoneNumber, setPhoneNumber]   = useState('');
  const [contactInfo, setContactInfo]   = useState(null);
  const [isMuted, setIsMuted]           = useState(false);
  const [callDuration, setCallDuration] = useState(0);
  const [leadPanelTab, setLeadPanelTab] = useState('info');

  // Data
  const [contacts, setContacts]         = useState([]);
  const [history, setHistory]           = useState([]);
  const [onlineAgents, setOnlineAgents] = useState([]);
  const [search, setSearch]             = useState('');
  const [showAdd, setShowAdd]           = useState(false);
  const [newContact, setNewContact]     = useState({ name:'', phone:'', company:'', email:'', notes:'' });
  const [teams, setTeams]               = useState([]);

  // Dialer list
  const [queue, setQueue]               = useState([]);
  const [qIdx, setQIdx]                 = useState(0);
  const [autoActive, setAutoActive]     = useState(false);
  const [delay, setDelay]               = useState(3);
  const [dialListId, setDialListId]     = useState(null);
  const [dialListName, setDialListName] = useState('');
  const [phoneSettings, setPhoneSettings] = useState(null);

  // Admin dial list selector
  const [adminTeamId, setAdminTeamId]         = useState('');
  const [adminDialLists, setAdminDialLists]   = useState([]);
  const [adminDialListId, setAdminDialListId] = useState('');

  // Survey (post-call)
  const [showSurvey, setShowSurvey]     = useState(false);
  const [surveyData, setSurveyData]     = useState(null);
  const [surveyCountdown, setSurveyCountdown] = useState(20);
  const surveyTimerRef = useRef(null);
  const surveyCountRef = useRef(null);

  // Meetings
  const [meetings, setMeetings]           = useState([]);
  const [meetingForm, setMeetingForm]     = useState({ contactName:'', contactPhone:'', contactEmail:'', date:'', time:'', notes:'' });
  const [meetingBooked, setMeetingBooked] = useState(false);
  const [showMeetingForm, setShowMeetingForm] = useState(false);

  // Save Lead
  const [leadForm, setLeadForm]   = useState({ name:'', phone:'', company:'', email:'', notes:'' });
  const [leadSaved, setLeadSaved] = useState(false);

  // Profile overlay
  const [showProfile, setShowProfile] = useState(false);
  const [sidebarPhoto, setSidebarPhoto] = useState(null);

  // Chat / community signals
  const [chatMessages, setChatMessages]       = useState([]);
  const [communitySignals, setCommunitySignals] = useState([]);

  const timerRef        = useRef(null);
  const autoTimerRef    = useRef(null);
  const isInternalRef   = useRef(false); // true when calling another agent

  // Refs for auto-dial closures
  const autoRef       = useRef(autoActive);
  const qIdxRef       = useRef(qIdx);
  const qRef          = useRef(queue);
  const phoneRef      = useRef(phone);
  const dialListIdRef = useRef(dialListId);
  const callDurRef    = useRef(callDuration);
  const phoneNumRef   = useRef(phoneNumber);
  const contactRef    = useRef(contactInfo);

  useEffect(() => { autoRef.current       = autoActive;   }, [autoActive]);
  useEffect(() => { qIdxRef.current       = qIdx;         }, [qIdx]);
  useEffect(() => { qRef.current          = queue;        }, [queue]);
  useEffect(() => { phoneRef.current      = phone;        }, [phone]);
  useEffect(() => { dialListIdRef.current = dialListId;   }, [dialListId]);
  useEffect(() => { callDurRef.current    = callDuration; }, [callDuration]);
  useEffect(() => { phoneNumRef.current   = phoneNumber;  }, [phoneNumber]);
  useEffect(() => { contactRef.current    = contactInfo;  }, [contactInfo]);

  // ── Init phone engine ────────────────────────────────────────────────────
  useEffect(() => {
    let p;
    (async () => {
      try {
        const { settings } = await api('/settings/credentials');
        const token        = localStorage.getItem('token');
        const mode         = settings?.mode || 'webrtc';
        // Always fix built-in SIP URL at runtime — the stored URL may be from a different environment (e.g. localhost)
        if (settings?.builtinSip) {
          settings.sipServer = API_BASE
            ? API_BASE.replace(/^https/, 'wss').replace(/^http/, 'ws') + '/sip-ws'
            : `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.hostname}:5000/sip-ws`;
        }
        setPhoneSettings(settings);
        p = await createPhone({
          mode, user, token, settings,
          onReady:        () => setDevStatus('ready'),
          onError:        msg => {
            console.warn('Phone error:', msg);
            // Only mark device as disconnected for real connection errors
            if (msg === 'Cannot connect to signaling server' || msg === 'Microphone access denied') {
              setDevStatus('error');
            } else {
              // Call-level error (e.g. agent offline) — just show an alert, don't break the device
              setCallState('idle'); setCurrentCall(null);
              alert(msg);
            }
          },
          onStatusChange: s   => { if (s === 'disconnected') setDevStatus('reconnecting'); },
          onIncoming:     call => handleIncoming(call),
          onChat:         msg => setChatMessages(prev => [...prev, msg]),
          onSignal:       msg => {
            // Update online agents list in real-time on connect/disconnect
            if (msg.type === 'user-online') {
              loadAgents(); // refresh full list with latest data
            } else if (msg.type === 'user-offline') {
              setOnlineAgents(prev => prev.filter(a => a.id !== msg.userId));
            }
            setCommunitySignals(prev => [...prev, msg]);
          },
        });
        setPhone(p);
      } catch (err) {
        console.error('Phone init failed:', err);
        setDevStatus('error');
      }
    })();

    loadContacts(); loadHistory(); loadAgents(); loadDialList(); loadMeetings(); loadProfilePhoto();
    if (user.role === 'admin') loadTeams();
    const agentPoll = setInterval(loadAgents, 15000);

    return () => {
      clearInterval(agentPoll);
      if (timerRef.current)       clearInterval(timerRef.current);
      if (autoTimerRef.current)   clearTimeout(autoTimerRef.current);
      if (surveyTimerRef.current) clearTimeout(surveyTimerRef.current);
      if (surveyCountRef.current) clearInterval(surveyCountRef.current);
      p?.destroy();
    };
  }, []);

  // Pre-fill meeting + lead forms when call becomes active
  useEffect(() => {
    if (callState === 'active' && contactRef.current) {
      setMeetingForm(f => ({
        ...f,
        contactName:  contactRef.current.name  || '',
        contactPhone: contactRef.current.phone || phoneNumRef.current || '',
        contactEmail: contactRef.current.email || '',
      }));
      setLeadForm({
        name:    contactRef.current.name    || '',
        phone:   contactRef.current.phone   || phoneNumRef.current || '',
        company: contactRef.current.company || '',
        email:   contactRef.current.email   || '',
        notes:   contactRef.current.notes   || '',
      });
    }
    if (callState === 'idle') { setLeadSaved(false); }
  }, [callState]);

  async function loadContacts()    { try { const d = await api('/contacts');        setContacts(d.contacts);       } catch {} }
  async function loadHistory()     { try { const d = await api('/calls/history');   setHistory(d.calls);           } catch {} }
  async function loadAgents()      { try { const d = await api('/agents/online');   setOnlineAgents(d.agents);     } catch {} }
  async function loadMeetings()    { try { const d = await api('/meetings');        setMeetings(d.meetings || []); } catch {} }
  async function loadTeams()       { try { const d = await api('/teams');           setTeams(d.teams || []);       } catch {} }
  async function loadProfilePhoto() {
    try {
      const d = await api('/profile');
      if (d.user?.photoUrl) setSidebarPhoto(d.user.photoUrl);
    } catch {}
  }

  async function loadDialList() {
    try {
      const d = await api('/dial-lists/my');
      if (d.dialList) {
        setDialListId(d.dialList.id);
        setDialListName(d.dialList.name);
        setQueue(d.dialList.contacts || []);
        setQIdx(0);
      }
    } catch {}
  }

  async function loadAdminLists(teamId) {
    if (!teamId) return;
    try {
      const d = await api(`/dial-lists/team/${teamId}`);
      setAdminDialLists(d.lists || []);
      setAdminDialListId('');
    } catch {}
  }

  // ── Incoming call ────────────────────────────────────────────────────────
  function handleIncoming(call) {
    setCurrentCall(call);
    setCallState('ringing');
    const fromId  = String(call.from || '');
    const isGuest = fromId.startsWith('guest-');
    // If from is a numeric agent ID, mark as internal
    const isAgentCall = !isGuest && /^\d+$/.test(fromId);
    isInternalRef.current = isAgentCall;
    setPhoneNumber(fromId);
    setContactInfo(isGuest
      ? { name: call.fromName || 'Website Visitor', company: 'Calling from your website', phone: '' }
      : isAgentCall
        ? { name: call.fromName || `Agent #${fromId}`, company: 'Internal Call', phone: '' }
        : null
    );
    call.on('accept',     () => { setCallState('active'); startTimer(); });
    call.on('disconnect', () => endCallCleanup(call));
    call.on('reject',     () => { setCallState('idle'); setCurrentCall(null); isInternalRef.current = false; });
  }

  // ── Call control ─────────────────────────────────────────────────────────
  async function makeCall(number, info = null) {
    const p = phoneRef.current;
    if (!p || devStatus !== 'ready') { alert('Phone not ready. Check Settings.'); return false; }
    // Mark as internal if calling another agent (info has a role property)
    isInternalRef.current = !!(info?.role);
    try {
      const call = await p.call(number);
      if (!call) return false;
      setCurrentCall(call);
      setPhoneNumber(number);
      setContactInfo(info);
      setCallState('dialing');
      call.on('accept',     () => { setCallState('active'); startTimer(); });
      call.on('disconnect', () => endCallCleanup(call, info));
      return true;
    } catch (err) {
      console.error('Call failed:', err);
      setCallState('idle');
      return false;
    }
  }

  async function endCallCleanup(call, infoArg) {
    stopTimer();
    const dur        = callDurRef.current;
    const info       = infoArg || contactRef.current;
    const wasAuto    = autoRef.current;
    const idx        = qIdxRef.current;
    const contact    = qRef.current[idx];
    const listId     = dialListIdRef.current;
    const isInternal = isInternalRef.current;
    isInternalRef.current = false;

    setCallState('idle');
    setCurrentCall(null);
    setContactInfo(null);
    setCallDuration(0);
    setIsMuted(false);
    setLeadPanelTab('info');

    // Skip recording, logging, and survey for internal agent-to-agent calls
    if (isInternal) return;

    // Upload recording
    let recFile = null;
    try {
      const blob = await call.stopRecording?.();
      if (blob && blob.size > 0) {
        const res = await fetch(API_BASE + '/api/calls/recording', {
          method: 'POST', body: blob,
          headers: { Authorization: `Bearer ${localStorage.getItem('token')}`, 'Content-Type': 'audio/webm' }
        });
        const d = await res.json();
        recFile = d.file;
      }
    } catch {}

    const callSid = call.callSid || call.to || phoneNumRef.current || `local-${Date.now()}`;

    // Log call with initial status
    try {
      await api('/calls/log', {
        method: 'POST', body: JSON.stringify({
          callSid,
          to: call.to || phoneNumRef.current, from: call.from,
          contactName: info?.name || 'Unknown',
          contactInfo: info || {},
          direction: call.direction || 'outbound',
          status: 'completed', duration: dur,
          recordingFile: recFile
        })
      });
      loadHistory();
    } catch {}

    // Show survey modal
    const sd = {
      callSid,
      contactName: info?.name || 'Unknown',
      contactId:   wasAuto ? contact?._id : null,
      dialListId:  listId,
      contactIdx:  idx,
      wasAuto,
    };
    setSurveyData(sd);
    setSurveyCountdown(20);
    setShowSurvey(true);

    clearTimeout(surveyTimerRef.current);
    clearInterval(surveyCountRef.current);
    let remaining = 20;
    surveyCountRef.current = setInterval(() => {
      remaining -= 1;
      setSurveyCountdown(remaining);
      if (remaining <= 0) clearInterval(surveyCountRef.current);
    }, 1000);
    surveyTimerRef.current = setTimeout(() => submitSurvey('completed', sd), 20000);
  }

  async function submitSurvey(status, overrideData) {
    clearTimeout(surveyTimerRef.current);
    clearInterval(surveyCountRef.current);
    const data = overrideData || surveyData;
    if (!data) return;

    // Update call log status
    try {
      await api('/calls/log', { method: 'POST', body: JSON.stringify({ callSid: data.callSid, status }) });
    } catch {}

    // Update dial list contact
    if (data.dialListId && data.contactId) {
      try {
        await api(`/dial-lists/${data.dialListId}/contact/${data.contactId}`, {
          method: 'PATCH', body: JSON.stringify({ status })
        });
      } catch {}
      setQueue(q => q.map(c => c._id === data.contactId ? { ...c, status } : c));
    }

    setShowSurvey(false);
    setSurveyData(null);
    loadHistory();

    // Continue auto-dial
    if (data.wasAuto) {
      const next = data.contactIdx + 1;
      if (next < qRef.current.length) {
        setQIdx(next);
        autoTimerRef.current = setTimeout(() => { if (autoRef.current) dialAt(next); }, delay * 1000);
      } else {
        setAutoActive(false);
      }
    }
  }

  function answerCall() { currentCall?.accept(); }
  function rejectCall() { currentCall?.reject(); setCallState('idle'); setCurrentCall(null); }
  function endCall()    { currentCall?.disconnect(); }

  function toggleMute() {
    const m = !isMuted;
    currentCall?.mute(m);
    setIsMuted(m);
  }

  function dialPad(d) {
    setPhoneNumber(p => p.length < 16 ? p + d : p);
    if (callState === 'active') currentCall?.sendDigits(d);
  }

  // ── Timer ────────────────────────────────────────────────────────────────
  function startTimer() {
    setCallDuration(0);
    timerRef.current = setInterval(() => setCallDuration(p => p + 1), 1000);
  }
  function stopTimer() {
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
  }

  // ── Auto-dial ────────────────────────────────────────────────────────────
  async function dialAt(idx) {
    const q = qRef.current;
    if (idx >= q.length) { setAutoActive(false); return; }
    const c = q[idx];
    setQIdx(idx);
    setQueue(qq => qq.map((x, i) => i === idx ? { ...x, status: 'calling' } : x));
    const ok = await makeCall(c.phone, c);
    if (!ok) {
      if (dialListIdRef.current && c._id) {
        try { await api(`/dial-lists/${dialListIdRef.current}/contact/${c._id}`, { method: 'PATCH', body: JSON.stringify({ status: 'failed' }) }); } catch {}
      }
      setQueue(qq => qq.map((x, i) => i === idx ? { ...x, status: 'failed' } : x));
      const next = idx + 1;
      if (next < q.length && autoRef.current) {
        setQIdx(next);
        autoTimerRef.current = setTimeout(() => dialAt(next), 1500);
      } else { setAutoActive(false); }
    }
  }

  function startAutoDial() {
    const first = queue.findIndex(c => c.status === 'pending');
    if (first === -1) return;
    setAutoActive(true);
    dialAt(first);
  }

  function stopAutoDial() {
    setAutoActive(false);
    if (autoTimerRef.current) clearTimeout(autoTimerRef.current);
    // Mark current calling contact as failed
    const idx     = qIdxRef.current;
    const contact = qRef.current[idx];
    if (contact?.status === 'calling') {
      setQueue(q => q.map((c, i) => i === idx ? { ...c, status: 'failed' } : c));
      if (dialListIdRef.current && contact._id) {
        api(`/dial-lists/${dialListIdRef.current}/contact/${contact._id}`, {
          method: 'PATCH', body: JSON.stringify({ status: 'failed' })
        }).catch(() => {});
      }
    }
    if (callState !== 'idle') endCall();
  }

  // ── Contacts CRUD ────────────────────────────────────────────────────────
  async function addContact() {
    if (!newContact.phone) return;
    try {
      await api('/contacts', { method: 'POST', body: JSON.stringify(newContact) });
      setNewContact({ name:'', phone:'', company:'', email:'', notes:'' });
      setShowAdd(false);
      loadContacts();
    } catch (e) { alert(e.message); }
  }

  async function delContact(id) {
    if (!confirm('Delete contact?')) return;
    try { await api(`/contacts/${id}`, { method: 'DELETE' }); loadContacts(); } catch {}
  }

  // ── Save Lead ─────────────────────────────────────────────────────────────
  async function saveLead() {
    if (!leadForm.phone) return;
    try {
      await api('/contacts', { method: 'POST', body: JSON.stringify(leadForm) });
      setLeadSaved(true);
      loadContacts();
      setTimeout(() => setLeadSaved(false), 3000);
    } catch (e) { alert(e.message); }
  }

  // ── Book Meeting ─────────────────────────────────────────────────────────
  async function bookMeeting() {
    try {
      await api('/meetings', { method: 'POST', body: JSON.stringify(meetingForm) });
      setMeetingBooked(true);
      loadMeetings();
      setTimeout(() => setMeetingBooked(false), 3000);
    } catch (e) { alert(e.message); }
  }

  // ── Derived ──────────────────────────────────────────────────────────────
  const filtered = contacts.filter(c =>
    c.name?.toLowerCase().includes(search.toLowerCase()) ||
    c.phone?.includes(search) ||
    c.company?.toLowerCase().includes(search.toLowerCase())
  );

  const qStats = {
    total:   queue.length,
    done:    queue.filter(c => c.status === 'completed').length,
    pending: queue.filter(c => c.status === 'pending').length,
    fail:    queue.filter(c => ['failed','no-answer','busy'].includes(c.status)).length,
  };

  const statusColor = { ready:'bg-green-100 text-green-700', initializing:'bg-yellow-100 text-yellow-700', reconnecting:'bg-yellow-100 text-yellow-700', error:'bg-red-100 text-red-700', disconnected:'bg-gray-100 text-gray-600' };
  const statusDot   = { ready:'bg-green-500', initializing:'bg-yellow-500 animate-pulse', reconnecting:'bg-yellow-500 animate-pulse', error:'bg-red-500', disconnected:'bg-gray-400' };
  const statusLabel = { ready:'Ready', initializing:'Connecting…', reconnecting:'Reconnecting…', error:'Not Connected', disconnected:'Offline' };

  const isAdminOrLeader = user.role === 'admin' || user.role === 'team_leader';
  const tabLabel = { contacts:'Contacts', dialerlist:'Dialer List', history:'Call History', meetings:'Meetings', community:'Community', tasks:'Tasks' };

  // ══════════════════════════════════════════════════════════════════════════
  return (
    <div className="flex h-screen bg-slate-50 overflow-hidden">

      {/* Profile overlay */}
      {showProfile && <ProfilePage user={user} onClose={() => setShowProfile(false)} onPhotoChange={url => setSidebarPhoto(url)} />}

      {/* ── Incoming call overlay (always on top) ── */}
      {callState === 'ringing' && (
        <div className="fixed inset-0 z-[999] flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="bg-white rounded-3xl shadow-2xl p-8 w-80 flex flex-col items-center gap-5 animate-bounce-once">
            <div className="w-24 h-24 rounded-full bg-blue-100 flex items-center justify-center ring-4 ring-blue-300 animate-pulse">
              <Phone className="w-12 h-12 text-blue-600" />
            </div>
            <div className="text-center">
              <p className="text-xl font-bold text-gray-900">{contactInfo?.name || phoneNumber || 'Unknown'}</p>
              <p className="text-sm text-gray-500 mt-1">{contactInfo?.company || 'Incoming Call'}</p>
              <p className="text-xs text-blue-500 font-medium mt-2 animate-pulse">📲 Incoming Call…</p>
            </div>
            <div className="flex gap-8">
              <div className="flex flex-col items-center gap-1">
                <button onClick={rejectCall}
                  className="w-16 h-16 rounded-full bg-red-500 hover:bg-red-600 shadow-lg flex items-center justify-center transition-all">
                  <PhoneOff className="w-7 h-7 text-white" />
                </button>
                <span className="text-xs text-gray-500">Decline</span>
              </div>
              <div className="flex flex-col items-center gap-1">
                <button onClick={answerCall}
                  className="w-16 h-16 rounded-full bg-green-500 hover:bg-green-600 shadow-lg flex items-center justify-center transition-all">
                  <Phone className="w-7 h-7 text-white" />
                </button>
                <span className="text-xs text-gray-500">Accept</span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Survey modal */}
      {showSurvey && surveyData && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-2xl shadow-2xl p-6 w-80">
            <h3 className="font-bold text-gray-900 mb-1">Call Result</h3>
            <p className="text-sm text-gray-500 mb-4">{surveyData.contactName}</p>
            <div className="grid grid-cols-2 gap-2">
              {[
                { label:'Completed ✅',      status:'completed'      },
                { label:'No Answer 📵',      status:'no-answer'      },
                { label:'Busy 🔴',           status:'busy'           },
                { label:'Voicemail 📬',      status:'voicemail'      },
                { label:'Callback 🔄',       status:'callback'       },
                { label:'Not Interested ❌', status:'not-interested' },
              ].map(({ label, status }) => (
                <button key={status} onClick={() => submitSurvey(status)}
                  className="border rounded-xl py-2 px-3 text-sm font-medium hover:bg-blue-50 hover:border-blue-400 transition-colors text-left">
                  {label}
                </button>
              ))}
            </div>
            <p className="text-[10px] text-gray-400 mt-3 text-center">Auto-completes in {surveyCountdown}s</p>
          </div>
        </div>
      )}

      {/* ─── Sidebar ──────────────────────────────────────────────── */}
      <aside className="w-[72px] bg-slate-900 flex flex-col items-center py-5 gap-1 shrink-0">
        <div className="w-10 h-10 rounded-xl overflow-hidden mb-4 flex items-center justify-center bg-white">
          <img src="/DILO.png" alt="DILO" className="w-10 h-10 object-contain" />
        </div>

        {[
          { id:'contacts',   icon:Users,         label:'Contacts'  },
          { id:'dialerlist', icon:List,          label:'Dialer'    },
          { id:'history',    icon:Clock,         label:'History'   },
          { id:'meetings',   icon:Calendar,      label:'Meetings'  },
          { id:'community',  icon:MessageSquare, label:'Community' },
          { id:'tasks',      icon:CheckSquare,   label:'Tasks'     },
          ...(isAdminOrLeader ? [{ id:'admin', icon:Shield, label:'Admin' }] : []),
        ].map(({ id, icon:Icon, label }) => (
          <button key={id} title={label}
            onClick={() => id === 'admin' ? onOpenAdmin?.() : setTab(id)}
            className={`w-12 h-12 rounded-xl flex flex-col items-center justify-center gap-0.5 transition-all text-[9px] font-medium ${tab===id ? 'bg-blue-600 text-white' : 'text-slate-400 hover:bg-slate-800 hover:text-white'}`}
          >
            <Icon className="w-5 h-5" />
            {label}
          </button>
        ))}

        <div className="mt-auto flex flex-col items-center gap-2">
          {user.role === 'admin' && (
            <button onClick={onOpenSettings} title="Settings" className="w-12 h-12 rounded-xl text-slate-400 hover:bg-slate-800 hover:text-white flex items-center justify-center transition-all">
              <Settings className="w-4 h-4" />
            </button>
          )}
          <button onClick={() => setShowProfile(true)} title={`Profile: ${user.name}`}
            className="w-8 h-8 rounded-full bg-blue-600 hover:ring-2 hover:ring-blue-400 flex items-center justify-center transition-all overflow-hidden">
            {sidebarPhoto
              ? <img src={sidebarPhoto} alt={user.name} className="w-full h-full object-cover" onError={() => setSidebarPhoto(null)} />
              : <span className="text-white text-xs font-bold">{user.name?.[0]?.toUpperCase()}</span>
            }
          </button>
          <button onClick={onLogout} title="Logout" className="w-10 h-10 rounded-xl text-slate-400 hover:bg-slate-800 hover:text-red-400 flex items-center justify-center transition-all">
            <LogOut className="w-4 h-4" />
          </button>
        </div>
      </aside>

      {/* ─── Main content ─────────────────────────────────────────────── */}
      <main className="flex-1 overflow-y-auto">
        {/* Header */}
        <div className="bg-white border-b px-6 py-3 flex items-center justify-between sticky top-0 z-10 shadow-sm">
          <div>
            <h1 className="text-base font-bold text-gray-900">{tabLabel[tab] || 'Panel'}</h1>
            <p className="text-xs text-gray-400">
              {user.name} · {user.role}{user.teamName ? ` · ${user.teamName}` : ''}
            </p>
          </div>
          <div className={`flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium ${statusColor[devStatus] || statusColor.error}`}>
            <div className={`w-1.5 h-1.5 rounded-full ${statusDot[devStatus] || statusDot.error}`} />
            {statusLabel[devStatus] || devStatus}
          </div>
        </div>

        <div className="p-5">

          {/* ── CONTACTS ────────────────────────────────────────────── */}
          {tab === 'contacts' && (
            <div>
              <div className="flex gap-2 mb-4">
                <div className="relative flex-1">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                  <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search…"
                    className="w-full pl-9 pr-3 py-2 border rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white" />
                </div>
                <button onClick={() => setShowAdd(p => !p)} className="flex items-center gap-1.5 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-xl text-sm font-medium">
                  <Plus className="w-4 h-4" /> Add
                </button>
              </div>

              {showAdd && (
                <div className="bg-white rounded-xl border p-4 mb-4 shadow-sm">
                  <h3 className="font-semibold text-sm mb-3">New Contact</h3>
                  <div className="grid grid-cols-2 gap-2">
                    {[['name','Name'],['phone','Phone *'],['company','Company'],['email','Email'],['notes','Notes']].map(([f,l]) => (
                      <input key={f} placeholder={l} value={newContact[f]} onChange={e => setNewContact(p => ({ ...p, [f]: e.target.value }))}
                        className={`border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 ${f==='notes'?'col-span-2':''}`} />
                    ))}
                  </div>
                  <div className="flex gap-2 mt-3">
                    <button onClick={addContact} className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-1.5 rounded-lg text-sm font-medium">Save</button>
                    <button onClick={() => setShowAdd(false)} className="bg-gray-100 hover:bg-gray-200 text-gray-700 px-4 py-1.5 rounded-lg text-sm font-medium">Cancel</button>
                  </div>
                </div>
              )}

              {filtered.length === 0 && (
                <div className="text-center py-16 text-gray-400">
                  <Users className="w-10 h-10 mx-auto mb-2 opacity-30" />
                  <p className="text-sm">No contacts found</p>
                </div>
              )}

              <div className="space-y-2">
                {filtered.map(c => (
                  <div key={c.id} className="bg-white rounded-xl border p-3 flex items-center gap-3 hover:shadow-sm transition-shadow">
                    <div className="w-9 h-9 rounded-full bg-blue-100 flex items-center justify-center shrink-0 text-blue-700 font-bold text-sm">
                      {c.name?.[0]?.toUpperCase() || '?'}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-sm text-gray-900 truncate">{c.name}</p>
                      <p className="text-xs text-gray-500">{c.phone}{c.company ? ` · ${c.company}` : ''}</p>
                    </div>
                    <button onClick={() => { setPhoneNumber(c.phone); setContactInfo(c); }} className="p-1.5 bg-green-100 hover:bg-green-200 text-green-700 rounded-lg"><Phone className="w-3.5 h-3.5" /></button>
                    <button onClick={() => delContact(c.id)} className="p-1.5 bg-red-100 hover:bg-red-200 text-red-700 rounded-lg"><Trash2 className="w-3.5 h-3.5" /></button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ── DIALER LIST ──────────────────────────────────────────── */}
          {tab === 'dialerlist' && (
            <div>
              {/* Admin team + list selector */}
              {user.role === 'admin' && (
                <div className="bg-white rounded-xl border p-3 mb-3 flex flex-wrap gap-2">
                  <select value={adminTeamId} onChange={e => { setAdminTeamId(e.target.value); loadAdminLists(e.target.value); }}
                    className="flex-1 min-w-[140px] border rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                    <option value="">Select Team…</option>
                    {teams.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                  </select>
                  {adminDialLists.length > 0 && (
                    <select value={adminDialListId} onChange={e => {
                      const id = e.target.value;
                      setAdminDialListId(id);
                      const list = adminDialLists.find(l => String(l.id) === id);
                      if (list) { setDialListId(list.id); setDialListName(list.name); setQueue(list.contacts || []); setQIdx(0); }
                    }} className="flex-1 min-w-[140px] border rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                      <option value="">Select List…</option>
                      {adminDialLists.map(l => <option key={l.id} value={l.id}>{l.name} ({l.total})</option>)}
                    </select>
                  )}
                </div>
              )}

              {queue.length === 0 ? (
                <div className="text-center py-16 text-gray-400">
                  <List className="w-10 h-10 mx-auto mb-2 opacity-30" />
                  <p className="text-sm font-medium">No dial list assigned</p>
                  <p className="text-xs mt-1">Ask your admin to assign a list to your team</p>
                  <button onClick={loadDialList} className="mt-3 text-xs text-blue-600 hover:underline">↻ Check again</button>
                </div>
              ) : (
                <div>
                  {/* Controls */}
                  <div className="bg-white rounded-xl border p-4 mb-3 flex flex-wrap items-center gap-3">
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold text-sm text-gray-800 truncate">📋 {dialListName}</p>
                      <p className="text-xs text-gray-500">{qStats.done}/{qStats.total} completed · {qStats.pending} pending · {qStats.fail} failed</p>
                    </div>
                    <div className="flex items-center gap-2 text-sm">
                      <span className="text-gray-500">Delay (s):</span>
                      <input type="number" min="1" max="60" value={delay} disabled={autoActive}
                        onChange={e => setDelay(Number(e.target.value))}
                        className="w-14 border rounded-lg px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                    </div>
                    {!autoActive ? (
                      <button onClick={startAutoDial} disabled={qStats.pending === 0 || devStatus !== 'ready'}
                        className="flex items-center gap-2 bg-green-600 hover:bg-green-700 disabled:bg-gray-300 disabled:cursor-not-allowed text-white px-5 py-2 rounded-xl text-sm font-medium">
                        <Play className="w-4 h-4" /> Start Auto-Dial
                      </button>
                    ) : (
                      <button onClick={stopAutoDial} className="flex items-center gap-2 bg-red-600 hover:bg-red-700 text-white px-5 py-2 rounded-xl text-sm font-medium">
                        <Pause className="w-4 h-4" /> Stop
                      </button>
                    )}
                    <button onClick={loadDialList} className="flex items-center gap-1.5 bg-gray-100 hover:bg-gray-200 text-gray-700 px-4 py-2 rounded-xl text-sm font-medium">
                      ↻ Refresh
                    </button>
                  </div>

                  {/* Progress bar */}
                  <div className="bg-white rounded-xl border p-3 mb-3">
                    <div className="flex justify-between text-xs text-gray-500 mb-1"><span>Progress</span><span>{qStats.done}/{qStats.total}</span></div>
                    <div className="w-full bg-gray-100 rounded-full h-2">
                      <div className="bg-blue-600 h-2 rounded-full transition-all" style={{ width: `${qStats.total ? (qStats.done / qStats.total) * 100 : 0}%` }} />
                    </div>
                  </div>

                  {/* Queue */}
                  <div className="space-y-1.5 max-h-[calc(100vh-380px)] overflow-y-auto">
                    {queue.map((c, i) => (
                      <div key={c._id || i} className={`bg-white rounded-xl border p-3 flex items-center gap-3 ${i===qIdx&&autoActive?'border-blue-400 ring-1 ring-blue-400 shadow-sm':''}`}>
                        <div className="w-7 h-7 rounded-full bg-slate-100 flex items-center justify-center text-xs font-bold text-slate-500 shrink-0">{i+1}</div>
                        <div className="flex-1 min-w-0">
                          <p className="font-medium text-sm text-gray-900 truncate">{c.name}</p>
                          <p className="text-xs text-gray-500">{c.phone}{c.company ? ` · ${c.company}` : ''}</p>
                          {c.email && <p className="text-xs text-gray-400">{c.email}</p>}
                          {c.notes && <p className="text-xs text-gray-300 italic truncate">{c.notes}</p>}
                        </div>
                        <StatusBadge s={c.status} />
                        {c.status === 'pending' && (
                          <button onClick={() => { setPhoneNumber(c.phone); setContactInfo(c); }} className="p-1.5 bg-green-50 hover:bg-green-100 text-green-700 rounded-lg shrink-0">
                            <Phone className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ── HISTORY ─────────────────────────────────────────────── */}
          {tab === 'history' && (
            <div>
              <button onClick={loadHistory} className="text-xs text-blue-600 hover:underline mb-3 block">↻ Refresh</button>
              {history.length === 0 && <div className="text-center py-14 text-gray-400 text-sm"><Clock className="w-8 h-8 mx-auto mb-2 opacity-30" /><p>No call history yet</p></div>}
              <div className="space-y-2">
                {history.map(c => (
                  <div key={c.id} className="bg-white rounded-xl border p-3 flex items-start gap-3">
                    <div className={`w-9 h-9 rounded-full flex items-center justify-center shrink-0 ${c.direction==='outbound'?'bg-green-100':'bg-blue-100'}`}>
                      <Phone className={`w-4 h-4 ${c.direction==='outbound'?'text-green-600':'text-blue-600'}`} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-sm">{c.contactName || 'Unknown'}</p>
                      <p className="text-xs text-gray-500">{c.to || c.from}</p>
                      {c.contactInfo?.company && <p className="text-xs text-gray-400">{c.contactInfo.company}</p>}
                      {c.userName && isAdminOrLeader && (
                        <p className="text-[10px] text-gray-400">By: {c.userName}</p>
                      )}
                    </div>
                    <div className="text-right shrink-0">
                      <p className="text-sm font-medium">{c.duration ? fmt(c.duration) : '--:--'}</p>
                      <p className="text-xs text-gray-400">{new Date(c.createdAt).toLocaleString()}</p>
                      <span className={`text-xs px-1.5 py-0.5 rounded-full ${c.status==='completed'?'bg-green-100 text-green-700':'bg-red-100 text-red-700'}`}>{c.status}</span>
                      {c.recordingFile && isAdminOrLeader && (
                        <a href={`/recordings/${c.recordingFile}`} target="_blank" rel="noreferrer"
                          className="mt-1 flex items-center gap-1 text-xs text-blue-600 hover:underline justify-end">
                          <Volume2 className="w-3 h-3" /> Listen
                        </a>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ── MEETINGS ────────────────────────────────────────────── */}
          {tab === 'meetings' && (
            <div>
              <div className="flex items-center justify-between mb-4">
                <h2 className="font-semibold text-sm text-gray-700">Your Meetings</h2>
                <button onClick={() => setShowMeetingForm(p => !p)} className="flex items-center gap-1.5 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-xl text-sm font-medium">
                  <Plus className="w-4 h-4" /> Book Meeting
                </button>
              </div>

              {showMeetingForm && (
                <div className="bg-white rounded-xl border p-4 mb-4 shadow-sm">
                  <h3 className="font-semibold text-sm mb-3">New Meeting</h3>
                  <div className="grid grid-cols-2 gap-2">
                    <input placeholder="Contact Name" value={meetingForm.contactName} onChange={e => setMeetingForm(f => ({ ...f, contactName: e.target.value }))} className="border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                    <input placeholder="Phone" value={meetingForm.contactPhone} onChange={e => setMeetingForm(f => ({ ...f, contactPhone: e.target.value }))} className="border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                    <input placeholder="Email" type="email" value={meetingForm.contactEmail} onChange={e => setMeetingForm(f => ({ ...f, contactEmail: e.target.value }))} className="col-span-2 border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                    <input type="date" value={meetingForm.date} onChange={e => setMeetingForm(f => ({ ...f, date: e.target.value }))} className="border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                    <input type="time" value={meetingForm.time} onChange={e => setMeetingForm(f => ({ ...f, time: e.target.value }))} className="border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                    <textarea placeholder="Notes" rows={2} value={meetingForm.notes} onChange={e => setMeetingForm(f => ({ ...f, notes: e.target.value }))} className="col-span-2 border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none" />
                  </div>
                  <div className="flex gap-2 mt-3">
                    <button onClick={bookMeeting} className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-1.5 rounded-lg text-sm font-medium">Book</button>
                    <button onClick={() => setShowMeetingForm(false)} className="bg-gray-100 hover:bg-gray-200 text-gray-700 px-4 py-1.5 rounded-lg text-sm font-medium">Cancel</button>
                  </div>
                </div>
              )}

              {meetings.length === 0 && !showMeetingForm && (
                <div className="text-center py-14 text-gray-400 text-sm">
                  <Calendar className="w-8 h-8 mx-auto mb-2 opacity-30" />
                  <p>No meetings scheduled</p>
                </div>
              )}

              <div className="space-y-2">
                {meetings.map(m => (
                  <div key={m.id} className="bg-white rounded-xl border p-3 flex items-center gap-3">
                    <div className="w-9 h-9 rounded-full bg-purple-100 flex items-center justify-center shrink-0">
                      <Calendar className="w-4 h-4 text-purple-600" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-sm">{m.contactName}</p>
                      <p className="text-xs text-gray-500">{m.contactPhone}{m.contactEmail ? ` · ${m.contactEmail}` : ''}</p>
                      {m.notes && <p className="text-xs text-gray-400 italic truncate">{m.notes}</p>}
                    </div>
                    <div className="text-right shrink-0">
                      <p className="text-sm font-medium text-gray-700">{m.date} {m.time}</p>
                      <span className={`text-xs px-1.5 py-0.5 rounded-full ${m.status==='completed'?'bg-green-100 text-green-700':m.status==='cancelled'?'bg-red-100 text-red-700':'bg-blue-100 text-blue-700'}`}>{m.status}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ── COMMUNITY ───────────────────────────────────────────── */}
          {tab === 'community' && (
            <CommunityPage
              user={user}
              onlineAgents={onlineAgents}
              phone={phone}
              chatMessages={chatMessages}
              signals={communitySignals}
              makeCall={makeCall}
              currentUserPhoto={sidebarPhoto || user.photoUrl || null}
            />
          )}

          {/* ── TASKS ───────────────────────────────────────────────── */}
          {tab === 'tasks' && (
            <TasksPage user={user} />
          )}

        </div>
      </main>

      {/* ─── Right: Dial Pad / Call Panel ──────────────────────────────── */}
      <aside className="w-[300px] bg-white border-l flex flex-col shrink-0 shadow-xl overflow-hidden">

        {/* ── IDLE: dial pad ── */}
        {callState === 'idle' && (
          <div className="flex flex-col h-full p-5">
            <div className="mb-4">
              <div className="flex items-center gap-2 bg-slate-50 rounded-xl px-4 py-3 border">
                <input value={phoneNumber} onChange={e => setPhoneNumber(e.target.value)}
                  placeholder="+1 555 000 0000"
                  className="flex-1 bg-transparent text-xl font-semibold text-gray-800 focus:outline-none min-w-0" />
                {phoneNumber && <button onClick={() => setPhoneNumber(p => p.slice(0, -1))}><X className="w-5 h-5 text-gray-400 hover:text-gray-600" /></button>}
              </div>
              {contactInfo && (
                <div className="mt-2 bg-blue-50 rounded-xl px-3 py-2">
                  <p className="font-semibold text-blue-800 text-sm">{contactInfo.name}</p>
                  {contactInfo.company && <p className="text-blue-600 text-xs">{contactInfo.company}</p>}
                  {contactInfo.email   && <p className="text-blue-500 text-xs">{contactInfo.email}</p>}
                </div>
              )}
            </div>

            <div className="grid grid-cols-3 gap-2.5 mb-5">
              {[{d:'1',l:''},{d:'2',l:'ABC'},{d:'3',l:'DEF'},{d:'4',l:'GHI'},{d:'5',l:'JKL'},{d:'6',l:'MNO'},{d:'7',l:'PQRS'},{d:'8',l:'TUV'},{d:'9',l:'WXYZ'},{d:'*',l:''},{d:'0',l:'+'},{d:'#',l:''}]
                .map(({ d, l }) => (
                  <button key={d} onClick={() => dialPad(d)}
                    className="h-[68px] rounded-2xl bg-slate-50 hover:bg-slate-100 active:scale-95 border flex flex-col items-center justify-center transition-all shadow-sm">
                    <span className="text-2xl font-bold text-gray-800 leading-none">{d}</span>
                    {l && <span className="text-[9px] text-gray-500 mt-0.5 tracking-widest">{l}</span>}
                  </button>
                ))}
            </div>

            <div className="flex justify-center mb-4">
              <button onClick={() => phoneNumber && makeCall(phoneNumber, contactInfo)} disabled={!phoneNumber || devStatus !== 'ready'}
                className="w-20 h-20 rounded-full bg-green-500 hover:bg-green-600 disabled:bg-gray-300 disabled:cursor-not-allowed shadow-lg hover:shadow-xl flex items-center justify-center transition-all">
                <Phone className="w-9 h-9 text-white" />
              </button>
            </div>

            <div className="mt-auto pt-3 border-t">
              <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-2">Today</p>
              <div className="grid grid-cols-3 gap-2 text-center">
                {[
                  { label:'Calls',    val: history.filter(c => new Date(c.createdAt).toDateString() === new Date().toDateString()).length, cls:'text-blue-700 bg-blue-50' },
                  { label:'Dialed',   val: qStats.done,     cls:'text-green-700 bg-green-50' },
                  { label:'Meetings', val: meetings.length, cls:'text-purple-700 bg-purple-50' },
                ].map(({ label, val, cls }) => (
                  <div key={label} className={`rounded-xl p-2 ${cls.split(' ')[1]}`}>
                    <p className={`text-lg font-bold ${cls.split(' ')[0]}`}>{val}</p>
                    <p className="text-[9px] text-gray-400">{label}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* ── RINGING ── */}
        {callState === 'ringing' && (
          <div className="flex flex-col h-full p-5">
            <div className="flex-1 flex flex-col items-center justify-center gap-4">
              <div className="w-20 h-20 rounded-full bg-blue-100 flex items-center justify-center animate-pulse">
                <Phone className="w-10 h-10 text-blue-600" />
              </div>
              <div className="text-center">
                <p className="text-lg font-bold text-gray-800">{contactInfo?.name || phoneNumber || 'Unknown'}</p>
                {contactInfo?.company && <p className="text-sm text-gray-500">{contactInfo.company}</p>}
                {contactInfo?.phone   && <p className="text-sm text-gray-400">{contactInfo.phone}</p>}
                {contactInfo?.email   && <p className="text-sm text-gray-400">{contactInfo.email}</p>}
                <p className="text-xs text-blue-500 font-medium mt-2 animate-pulse">📲 Incoming Call</p>
              </div>
            </div>
            <div className="flex justify-center gap-6 pb-6">
              <button onClick={rejectCall} className="w-16 h-16 rounded-full bg-red-500 hover:bg-red-600 shadow-lg flex items-center justify-center">
                <PhoneOff className="w-7 h-7 text-white" />
              </button>
              <button onClick={answerCall} className="w-16 h-16 rounded-full bg-green-500 hover:bg-green-600 shadow-lg flex items-center justify-center">
                <Phone className="w-7 h-7 text-white" />
              </button>
            </div>
          </div>
        )}

        {/* ── DIALING / ACTIVE ── */}
        {(callState === 'dialing' || callState === 'active') && (
          <div className="flex flex-col h-full">
            <div className={`px-4 py-3 flex items-center justify-between shrink-0 ${callState === 'active' ? 'bg-green-600' : 'bg-blue-600'}`}>
              <div className="flex items-center gap-2">
                <div className={`w-2 h-2 rounded-full bg-white ${callState === 'active' ? '' : 'animate-pulse'}`} />
                <span className="text-white text-sm font-semibold">
                  {callState === 'dialing' ? 'Dialing…' : fmt(callDuration)}
                </span>
              </div>
              <div className="flex items-center gap-2">
                {callState === 'active' && (
                  <button onClick={toggleMute}
                    className={`p-2 rounded-lg transition-all ${isMuted ? 'bg-red-500 text-white' : 'bg-white/20 hover:bg-white/30 text-white'}`}>
                    {isMuted ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
                  </button>
                )}
                <button onClick={endCall} className="p-2 bg-red-500 hover:bg-red-600 text-white rounded-lg">
                  <PhoneOff className="w-4 h-4" />
                </button>
              </div>
            </div>

            <div className="flex border-b shrink-0 bg-white">
              {['info','lead','meeting'].map(t => (
                <button key={t} onClick={() => setLeadPanelTab(t)}
                  className={`flex-1 py-2 text-xs font-semibold border-b-2 transition-colors capitalize ${leadPanelTab===t ? 'border-blue-500 text-blue-600 bg-blue-50' : 'border-transparent text-gray-500 hover:text-gray-700'}`}>
                  {t === 'info' ? 'Info' : t === 'lead' ? 'Save Lead' : 'Meeting'}
                </button>
              ))}
            </div>

            {leadPanelTab === 'info' && (
              <div className="flex-1 overflow-y-auto p-4">
                {contactInfo ? (
                  <div className="space-y-3">
                    <div className="flex items-center gap-3">
                      <div className="w-12 h-12 rounded-full bg-gradient-to-br from-blue-400 to-blue-600 flex items-center justify-center text-white font-bold text-lg shrink-0">
                        {contactInfo.name?.[0]?.toUpperCase() || '?'}
                      </div>
                      <div>
                        <p className="font-bold text-gray-900">{contactInfo.name}</p>
                        {contactInfo.company && <p className="text-sm text-gray-500">{contactInfo.company}</p>}
                      </div>
                    </div>
                    {[
                      { label:'Phone', value: contactInfo.phone || phoneNumber },
                      { label:'Email', value: contactInfo.email },
                      { label:'Notes', value: contactInfo.notes },
                    ].filter(r => r.value).map(r => (
                      <div key={r.label} className="bg-gray-50 rounded-xl px-3 py-2">
                        <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">{r.label}</p>
                        <p className="text-sm text-gray-700 mt-0.5">{r.value}</p>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="flex flex-col items-center justify-center h-full text-gray-400 gap-2">
                    <Users className="w-10 h-10 opacity-20" />
                    <p className="text-sm">Unknown caller</p>
                    <p className="text-xs text-center">Use "Save Lead" tab to add their info</p>
                  </div>
                )}
              </div>
            )}

            {leadPanelTab === 'lead' && (
              <div className="flex-1 overflow-y-auto p-4 space-y-2">
                {leadSaved ? (
                  <div className="flex flex-col items-center justify-center h-32 gap-2">
                    <CheckCircle className="w-10 h-10 text-green-500" />
                    <p className="text-sm font-semibold text-green-600">Lead saved to contacts!</p>
                  </div>
                ) : (
                  <>
                    <p className="text-xs text-gray-500 mb-3">Save this caller as a contact. Fields are auto-filled from call info.</p>
                    {[
                      ['name',    'Full Name', 'text'],
                      ['phone',   'Phone *',   'tel'],
                      ['email',   'Email',     'email'],
                      ['company', 'Company',   'text'],
                    ].map(([field, label, type]) => (
                      <input key={field} type={type} placeholder={label}
                        value={leadForm[field]} onChange={e => setLeadForm(f => ({ ...f, [field]: e.target.value }))}
                        className="w-full border rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                    ))}
                    <textarea placeholder="Notes" rows={2} value={leadForm.notes}
                      onChange={e => setLeadForm(f => ({ ...f, notes: e.target.value }))}
                      className="w-full border rounded-xl px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-blue-500" />
                    <button onClick={saveLead} disabled={!leadForm.phone}
                      className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-gray-200 disabled:cursor-not-allowed text-white py-2 rounded-xl text-sm font-semibold transition-colors">
                      Save to Contacts
                    </button>
                  </>
                )}
              </div>
            )}

            {leadPanelTab === 'meeting' && (
              <div className="flex-1 overflow-y-auto p-4 space-y-2">
                {meetingBooked ? (
                  <div className="flex flex-col items-center justify-center h-32 gap-2">
                    <CheckCircle className="w-10 h-10 text-green-500" />
                    <p className="text-sm font-semibold text-green-600">Meeting booked!</p>
                  </div>
                ) : (
                  <>
                    <input placeholder="Contact Name" value={meetingForm.contactName} onChange={e => setMeetingForm(f => ({ ...f, contactName: e.target.value }))} className="w-full border rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                    <input placeholder="Phone" value={meetingForm.contactPhone} onChange={e => setMeetingForm(f => ({ ...f, contactPhone: e.target.value }))} className="w-full border rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                    <input placeholder="Email" type="email" value={meetingForm.contactEmail} onChange={e => setMeetingForm(f => ({ ...f, contactEmail: e.target.value }))} className="w-full border rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                    <div className="grid grid-cols-2 gap-2">
                      <input type="date" value={meetingForm.date} onChange={e => setMeetingForm(f => ({ ...f, date: e.target.value }))} className="border rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                      <input type="time" value={meetingForm.time} onChange={e => setMeetingForm(f => ({ ...f, time: e.target.value }))} className="border rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                    </div>
                    <textarea placeholder="Notes" rows={2} value={meetingForm.notes} onChange={e => setMeetingForm(f => ({ ...f, notes: e.target.value }))} className="w-full border rounded-xl px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-blue-500" />
                    <button onClick={bookMeeting} className="w-full bg-purple-600 hover:bg-purple-700 text-white py-2 rounded-xl text-sm font-semibold transition-colors">
                      📅 Book Meeting
                    </button>
                  </>
                )}
              </div>
            )}
          </div>
        )}
      </aside>
    </div>
  );
}
