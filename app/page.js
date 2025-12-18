'use client';

import { useState, useEffect } from 'react';
import Login from '../components/Login';
import Chat from '../components/Chat';

export default function Home() {
  const [identity, setIdentity] = useState(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    // Check local storage for existing session if we wanted to persist login
    // For now, we keep it in memory for security as requested (login every time or paste key)
  }, []);

  if (!mounted) return null;

  return (
    <main className="min-h-screen w-full flex flex-col items-center justify-center relative overflow-hidden">
      {!identity ? (
        <Login onLogin={setIdentity} />
      ) : (
        <div className="w-full h-full flex items-center justify-center">
          <Chat identity={identity} onLogout={() => setIdentity(null)} />
        </div>
      )}
      
      {!identity && (
        <div className="fixed bottom-4 right-4 text-[10px] text-white/20 font-mono pointer-events-none">
          #HELLO PROTOCOL v0.1
        </div>
      )}
    </main>
  );
}
