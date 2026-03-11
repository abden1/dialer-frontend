import React, { useState, useEffect } from 'react';
import LoginPage from './LoginPage.jsx';
import DialerApp from './DialerApp.jsx';
import AdminPage from './AdminPage.jsx';
import SettingsPage from './SettingsPage.jsx';

export default function App() {
  const [user, setUser] = useState(null);
  const [showAdmin, setShowAdmin] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Restore session
    const token = localStorage.getItem('token');
    const stored = localStorage.getItem('user');
    if (token && stored) {
      try {
        setUser(JSON.parse(stored));
      } catch {
        localStorage.removeItem('token');
        localStorage.removeItem('user');
      }
    }
    setLoading(false);
  }, []);

  function handleLogin(u) {
    setUser(u);
    setShowAdmin(false);
  }

  function handleLogout() {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    setUser(null);
    setShowAdmin(false);
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-900 flex items-center justify-center">
        <div className="w-10 h-10 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!user) return <LoginPage onLogin={handleLogin} />;

  if (showAdmin && (user.role === 'admin' || user.role === 'team_leader')) {
    return <AdminPage user={user} onBack={() => setShowAdmin(false)} />;
  }

  return (
    <>
      <DialerApp
        user={user}
        onLogout={handleLogout}
        onOpenAdmin={() => setShowAdmin(true)}
        onOpenSettings={() => setShowSettings(true)}
      />
      {showSettings && <SettingsPage onClose={() => setShowSettings(false)} user={user} />}
    </>
  );
}
