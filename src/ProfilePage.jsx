import React, { useState, useEffect, useRef } from 'react';
import { X, Camera, CheckCircle, User } from 'lucide-react';
import { API_BASE } from './apiBase.js';

async function api(path, opts = {}) {
  const token = localStorage.getItem('token');
  const isFormData = opts.body instanceof FormData;
  const res = await fetch(API_BASE + '/api' + path, {
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

export default function ProfilePage({ user, onClose, onPhotoChange }) {
  const [profile, setProfile]   = useState(null);
  const [name, setName]         = useState('');
  const [bio, setBio]           = useState('');
  const [newPassword, setNewPassword]   = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [saving, setSaving]     = useState(false);
  const [toast, setToast]       = useState('');
  const [photoPreview, setPhotoPreview] = useState(null);
  const fileRef = useRef(null);

  useEffect(() => {
    (async () => {
      try {
        const d = await api('/profile');
        setProfile(d.user);
        setName(d.user.name || '');
        setBio(d.user.bio || '');
        setPhotoPreview(d.user.photoUrl || null);
      } catch {}
    })();
  }, []);

  function notify(msg) {
    setToast(msg);
    setTimeout(() => setToast(''), 3000);
  }

  async function handlePhotoChange(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => setPhotoPreview(ev.target.result);
    reader.readAsDataURL(file);
    try {
      const fd = new FormData();
      fd.append('photo', file);
      const d = await api('/profile/photo', { method: 'POST', body: fd });
      setPhotoPreview(d.photoUrl);
      onPhotoChange?.(d.photoUrl);
      notify('Photo updated!');
    } catch (e) { notify(e.message); }
  }

  async function saveProfile() {
    if (newPassword && newPassword !== confirmPassword) {
      notify('Passwords do not match'); return;
    }
    setSaving(true);
    try {
      const body = { name, bio };
      if (newPassword) body.newPassword = newPassword;
      const d = await api('/profile', { method: 'PATCH', body: JSON.stringify(body) });
      // Update localStorage token user info
      const storedUser = JSON.parse(localStorage.getItem('user') || '{}');
      localStorage.setItem('user', JSON.stringify({ ...storedUser, name: d.user.name }));
      setNewPassword('');
      setConfirmPassword('');
      notify('Profile saved!');
    } catch (e) { notify(e.message); }
    finally { setSaving(false); }
  }

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden">
        {/* Header */}
        <div className="bg-gradient-to-r from-blue-600 to-blue-700 px-6 py-4 flex items-center justify-between">
          <h2 className="text-white font-bold text-lg">My Profile</h2>
          <button onClick={onClose} className="text-white/70 hover:text-white transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6 space-y-5">
          {/* Avatar */}
          <div className="flex items-center gap-4">
            <div className="relative">
              <div className="w-20 h-20 rounded-full overflow-hidden bg-blue-100 flex items-center justify-center border-4 border-white shadow-lg">
                {photoPreview
                  ? <img src={photoPreview} alt="avatar" className="w-full h-full object-cover" />
                  : <span className="text-blue-600 font-bold text-2xl">{name?.[0]?.toUpperCase() || '?'}</span>
                }
              </div>
              <button onClick={() => fileRef.current?.click()}
                className="absolute bottom-0 right-0 bg-blue-600 hover:bg-blue-700 text-white rounded-full p-1.5 shadow-md transition-colors">
                <Camera className="w-3 h-3" />
              </button>
              <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handlePhotoChange} />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-semibold text-gray-900">{profile?.name || user.name}</span>
                <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${
                  profile?.role === 'admin' ? 'bg-purple-100 text-purple-700' :
                  profile?.role === 'team_leader' ? 'bg-blue-100 text-blue-700' :
                  'bg-gray-100 text-gray-600'
                }`}>{profile?.role || user.role}</span>
              </div>
              {profile?.teamName && (
                <p className="text-xs text-gray-500 mt-0.5">Team: {profile.teamName}</p>
              )}
              <p className="text-xs text-gray-400 mt-0.5">@{profile?.username || user.username}</p>
            </div>
          </div>

          {/* Name */}
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1">Full Name</label>
            <input value={name} onChange={e => setName(e.target.value)}
              className="w-full border rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>

          {/* Bio */}
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1">Bio</label>
            <textarea value={bio} onChange={e => setBio(e.target.value)}
              rows={2} placeholder="Tell your team about yourself…"
              className="w-full border rounded-xl px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>

          {/* Change Password */}
          <div className="border-t pt-4">
            <p className="text-xs font-semibold text-gray-600 mb-2">Change Password <span className="font-normal text-gray-400">(leave blank to keep current)</span></p>
            <div className="space-y-2">
              <input type="password" placeholder="New password" value={newPassword} onChange={e => setNewPassword(e.target.value)}
                className="w-full border rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              <input type="password" placeholder="Confirm new password" value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)}
                className="w-full border rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
          </div>

          {/* Toast */}
          {toast && (
            <div className="flex items-center gap-2 bg-green-50 border border-green-200 text-green-700 rounded-xl px-3 py-2 text-sm">
              <CheckCircle className="w-4 h-4 shrink-0" />
              {toast}
            </div>
          )}

          {/* Save */}
          <button onClick={saveProfile} disabled={saving}
            className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white font-semibold py-2.5 rounded-xl transition-colors">
            {saving ? 'Saving…' : 'Save Changes'}
          </button>
        </div>
      </div>
    </div>
  );
}
