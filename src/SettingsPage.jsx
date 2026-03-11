import React, { useState, useEffect } from 'react';
import { Settings, Save, X, Wifi, Phone, Eye, EyeOff, Server, ExternalLink, Info } from 'lucide-react';
import { API_BASE } from './apiBase.js';

const PROVIDERS = [
  { name: 'Built-in Server', desc: 'Agent-to-agent · no external service', builtin: true, sipServer: '', color: 'blue' },
  { name: 'Telnyx',          desc: '$10 free credit · $0.002/min',         url: 'https://telnyx.com',     sipServer: 'wss://sip.telnyx.com:7443',         color: 'green'  },
  { name: 'VoIP.ms',         desc: '$0.009/min · deposit $25',             url: 'https://voip.ms',        sipServer: 'wss://seattle.voip.ms:8089/ws',     color: 'purple' },
  { name: 'SignalWire',      desc: 'Twilio alt · free trial',              url: 'https://signalwire.com', sipServer: '', placeholder: 'wss://yourspace.signalwire.com:7443', color: 'orange' },
  { name: 'Custom / Asterisk', desc: 'Self-hosted Asterisk, FreeSWITCH…', sipServer: '', placeholder: 'wss://your-pbx.com:8089/ws', color: 'slate' },
];

const HELP = {
  Telnyx: ['Sign up at telnyx.com → get $10 free credit', 'SIP Trunking → Credentials → Create Credential', 'Server: wss://sip.telnyx.com:7443', 'Buy a DID to receive calls'],
  'VoIP.ms': ['Sign up at voip.ms → add $25 minimum balance', 'Sub Accounts → Create Sub Account', 'Enable WebRTC in account settings', 'Use main account username + sub-account password'],
  SignalWire: ['Sign up at signalwire.com → free trial', 'Get your Space name from the dashboard', 'Server: wss://YOURSPACE.signalwire.com:7443', 'Voice → SIP Endpoints → Create'],
  'Custom / Asterisk': ['Asterisk: enable chan_pjsip + WebSocket transport (8088/8089)', 'FreeSWITCH: enable mod_verto or WebSocket transport (7443)', 'Use SIP extension number as username'],
};

const providerColor = {
  blue:   'border-blue-500 bg-blue-500/10 text-blue-400',
  green:  'border-green-500 bg-green-500/10 text-green-400',
  purple: 'border-purple-500 bg-purple-500/10 text-purple-400',
  orange: 'border-orange-500 bg-orange-500/10 text-orange-400',
  slate:  'border-slate-500 bg-slate-500/10 text-slate-300',
};

export default function SettingsPage({ onClose, user }) {
  const [settings, setSettings] = useState({ mode: 'webrtc', sipServer: '', sipUsername: '', sipPassword: '', sipDisplayName: '', builtinSip: false });
  const [selectedProvider, setSelectedProvider] = useState(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [showPass, setShowPass] = useState(false);
  const [error, setError] = useState('');

  const builtinUrl = `${window.location.protocol === 'https:' ? 'wss' : 'ws'}://${window.location.hostname}:5000/sip-ws`;

  useEffect(() => {
    const token = localStorage.getItem('token');
    fetch(API_BASE + '/api/settings/credentials', { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.json())
      .then(d => {
        if (d.settings) {
          setSettings(s => ({ ...s, ...d.settings }));
          if (d.settings.sipServer?.includes('/sip-ws')) setSelectedProvider('Built-in Server');
          else if (d.settings.sipServer) {
            const p = PROVIDERS.find(p => d.settings.sipServer.includes(p.sipServer?.replace('wss://', '').split(':')[0]));
            if (p) setSelectedProvider(p.name);
          }
        }
      }).catch(() => {});
  }, []);

  function pickProvider(p) {
    setSelectedProvider(p.name); setError(''); setSaved(false);
    if (p.builtin) {
      setSettings(s => ({ ...s, mode: 'sip', sipServer: builtinUrl, sipUsername: user?.username || s.sipUsername, sipDisplayName: user?.name || s.sipDisplayName, builtinSip: true }));
    } else {
      setSettings(s => ({ ...s, mode: 'sip', sipServer: p.sipServer || s.sipServer, builtinSip: false, sipUsername: s.builtinSip ? '' : s.sipUsername, sipPassword: s.builtinSip ? '' : s.sipPassword }));
    }
  }

  async function handleSave() {
    setSaving(true); setError(''); setSaved(false);
    if (settings.mode === 'sip') {
      if (!settings.sipServer) { setError('SIP Server URL is required.'); setSaving(false); return; }
      if (!settings.sipServer.startsWith('wss://') && !settings.sipServer.startsWith('ws://')) { setError('SIP Server must start with wss:// or ws://'); setSaving(false); return; }
      if (!settings.builtinSip && (!settings.sipUsername || !settings.sipPassword)) { setError('SIP Username and Password required for external providers.'); setSaving(false); return; }
    }
    try {
      const token = localStorage.getItem('token');
      const res = await fetch(API_BASE + '/api/settings', { method: 'PUT', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ settings }) });
      if (!res.ok) throw new Error('Save failed');
      setSaved(true); setTimeout(() => setSaved(false), 3000);
    } catch { setError('Failed to save. Please try again.'); }
    finally { setSaving(false); }
  }

  function set(key, value) { setSettings(s => ({ ...s, [key]: value })); setSaved(false); setError(''); }

  const helpSteps = !settings.builtinSip && selectedProvider && HELP[selectedProvider];

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-3">
      <div className="bg-slate-800 rounded-xl shadow-2xl w-full max-w-lg border border-slate-700 flex flex-col max-h-[92vh]">

        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-700 flex-shrink-0">
          <div className="flex items-center gap-2 text-white font-semibold text-sm">
            <Settings className="w-4 h-4 text-blue-400" />
            Phone Settings
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-white p-1 rounded-lg hover:bg-slate-700 transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Scrollable body */}
        <div className="p-4 space-y-4 overflow-y-auto flex-1 min-h-0">

          {/* Mode selector */}
          <div>
            <label className="block text-xs font-medium text-slate-400 mb-2">Calling Mode</label>
            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={() => { set('mode', 'webrtc'); set('builtinSip', false); setSelectedProvider(null); }}
                className={`flex items-center gap-2 p-3 rounded-lg border-2 transition-all ${settings.mode === 'webrtc' ? 'border-blue-500 bg-blue-500/10 text-blue-400' : 'border-slate-600 bg-slate-700/50 text-slate-400 hover:border-slate-500'}`}
              >
                <Wifi className="w-5 h-5 flex-shrink-0" />
                <div className="text-left">
                  <div className="font-semibold text-xs">Internal WebRTC</div>
                  <div className="text-xs opacity-60">Agent-to-agent</div>
                </div>
              </button>
              <button
                onClick={() => set('mode', 'sip')}
                className={`flex items-center gap-2 p-3 rounded-lg border-2 transition-all ${settings.mode === 'sip' ? 'border-green-500 bg-green-500/10 text-green-400' : 'border-slate-600 bg-slate-700/50 text-slate-400 hover:border-slate-500'}`}
              >
                <Phone className="w-5 h-5 flex-shrink-0" />
                <div className="text-left">
                  <div className="font-semibold text-xs">SIP / PSTN</div>
                  <div className="text-xs opacity-60">Real phone numbers</div>
                </div>
              </button>
            </div>
            {settings.mode === 'webrtc' && (
              <div className="flex items-start gap-1.5 text-xs text-slate-500 mt-2 bg-slate-900/40 rounded-lg p-2.5 border border-slate-700">
                <Info className="w-3.5 h-3.5 flex-shrink-0 mt-0.5 text-blue-400" />
                <span>Agents call each other directly in the browser. Zero cost, zero config. No phone numbers.</span>
              </div>
            )}
          </div>

          {/* SIP mode */}
          {settings.mode === 'sip' && (
            <>
              {/* Provider picker — 2 column grid */}
              <div>
                <label className="block text-xs font-medium text-slate-400 mb-2">Provider</label>
                <div className="grid grid-cols-2 gap-1.5">
                  {PROVIDERS.map(p => (
                    <button
                      key={p.name}
                      onClick={() => pickProvider(p)}
                      className={`flex items-center gap-2 px-2.5 py-2 rounded-lg border text-left transition-all ${selectedProvider === p.name ? providerColor[p.color] : 'border-slate-600 bg-slate-700/30 text-slate-400 hover:border-slate-500'}`}
                    >
                      <Server className="w-3.5 h-3.5 flex-shrink-0" />
                      <div className="flex-1 min-w-0">
                        <div className="font-semibold text-xs truncate">{p.name}</div>
                        <div className="text-xs opacity-60 truncate">{p.desc}</div>
                      </div>
                      {p.url && (
                        <a href={p.url} target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()} className="text-slate-500 hover:text-slate-300 flex-shrink-0">
                          <ExternalLink className="w-3 h-3" />
                        </a>
                      )}
                    </button>
                  ))}
                </div>
              </div>

              {/* SIP credentials */}
              <div className="border border-slate-700 rounded-lg p-3 bg-slate-900/40 space-y-3">
                <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider">SIP Credentials</h3>

                <div>
                  <label className="block text-xs text-slate-400 mb-1">SIP Server (WebSocket URL)</label>
                  <input
                    type="text"
                    placeholder={PROVIDERS.find(p => p.name === selectedProvider)?.placeholder || 'wss://sip.provider.com:7443'}
                    value={settings.sipServer}
                    onChange={e => set('sipServer', e.target.value)}
                    disabled={settings.builtinSip}
                    className="w-full bg-slate-700 text-white rounded-lg px-3 py-2 text-xs border border-slate-600 focus:border-blue-500 focus:outline-none placeholder-slate-500 disabled:opacity-50 disabled:cursor-not-allowed font-mono"
                  />
                  {settings.builtinSip && <p className="text-xs text-blue-400 mt-1">Connected to the built-in SIP server.</p>}
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-xs text-slate-400 mb-1">{settings.builtinSip ? 'Extension' : 'Username'}</label>
                    <input
                      type="text"
                      placeholder={settings.builtinSip ? user?.username || 'username' : '1001 or user@domain'}
                      value={settings.sipUsername}
                      onChange={e => set('sipUsername', e.target.value)}
                      disabled={settings.builtinSip}
                      className="w-full bg-slate-700 text-white rounded-lg px-3 py-2 text-xs border border-slate-600 focus:border-blue-500 focus:outline-none placeholder-slate-500 disabled:opacity-50 disabled:cursor-not-allowed"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-slate-400 mb-1">{settings.builtinSip ? 'Password (JWT)' : 'Password'}</label>
                    <div className="relative">
                      <input
                        type={showPass ? 'text' : 'password'}
                        placeholder={settings.builtinSip ? 'Auto (session)' : '••••••••'}
                        value={settings.sipPassword}
                        onChange={e => set('sipPassword', e.target.value)}
                        disabled={settings.builtinSip}
                        className="w-full bg-slate-700 text-white rounded-lg px-3 py-2 text-xs border border-slate-600 focus:border-blue-500 focus:outline-none placeholder-slate-500 pr-8 disabled:opacity-50 disabled:cursor-not-allowed"
                      />
                      {!settings.builtinSip && (
                        <button type="button" onClick={() => setShowPass(v => !v)} className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white">
                          {showPass ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                        </button>
                      )}
                    </div>
                  </div>
                </div>

                <div>
                  <label className="block text-xs text-slate-400 mb-1">Display Name (optional)</label>
                  <input
                    type="text"
                    placeholder="John Smith"
                    value={settings.sipDisplayName}
                    onChange={e => set('sipDisplayName', e.target.value)}
                    className="w-full bg-slate-700 text-white rounded-lg px-3 py-2 text-xs border border-slate-600 focus:border-blue-500 focus:outline-none placeholder-slate-500"
                  />
                </div>
              </div>

              {/* How-to tips */}
              {helpSteps && (
                <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg p-3 text-xs text-amber-300 space-y-1">
                  <div className="font-semibold text-amber-200 mb-1">Setup ({selectedProvider}):</div>
                  {helpSteps.map((s, i) => <div key={i}>{i + 1}. {s}</div>)}
                </div>
              )}

              {settings.builtinSip && (
                <div className="bg-blue-500/10 border border-blue-500/30 rounded-lg p-3 text-xs text-blue-300 space-y-1">
                  <div className="font-semibold text-blue-200 mb-1">Built-in SIP Server</div>
                  <div>• Runs in this app — no external account needed</div>
                  <div>• Agents call each other by username</div>
                  <div>• For real phone numbers, choose a provider above</div>
                </div>
              )}
            </>
          )}

          {/* Error / Success */}
          {error && <div className="bg-red-500/15 border border-red-500/40 text-red-300 text-xs rounded-lg px-3 py-2">{error}</div>}
          {saved && <div className="bg-green-500/15 border border-green-500/40 text-green-300 text-xs rounded-lg px-3 py-2">Settings saved. Phone will reconnect.</div>}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-slate-700 flex-shrink-0">
          <button onClick={onClose} className="px-3 py-1.5 text-xs text-slate-400 hover:text-white transition-colors">Cancel</button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex items-center gap-1.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-xs font-medium px-4 py-1.5 rounded-lg transition-colors"
          >
            <Save className="w-3.5 h-3.5" />
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}
