import { useState, useEffect } from 'react';
import { generateIdentity, importIdentity, deriveMasterKey, encryptStorageData, decryptStorageData } from '../lib/crypto';
import { Copy, Key, LogIn, ShieldCheck, Terminal, Save, Lock, Unlock } from 'lucide-react';

export default function Login({ onLogin }) {
  const [mode, setMode] = useState('login'); // 'login' or 'create'
  const [inputKey, setInputKey] = useState('');
  const [generatedData, setGeneratedData] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  
  // Master Password State
  const [hasEncryptedSession, setHasEncryptedSession] = useState(false);
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

  useEffect(() => {
    const encrypted = localStorage.getItem('hellofrom_encrypted_identity');
    if (encrypted) {
      setHasEncryptedSession(true);
      setMode('unlock');
    }
  }, []);

  const handleGenerate = async () => {
    setLoading(true);
    try {
      const data = await generateIdentity();
      setGeneratedData(data);
    } catch (e) {
      setError("Failed to generate identity.");
    }
    setLoading(false);
  };

  const handleCreateAccount = async () => {
    if (!password || password !== confirmPassword) {
      setError("Passwords do not match or are empty.");
      return;
    }
    if (!generatedData) return;

    setLoading(true);
    try {
      // 1. Generate Salt
      const salt = window.crypto.getRandomValues(new Uint8Array(16));
      
      // 2. Derive Master Key
      const masterKey = await deriveMasterKey(password, salt);

      // 3. Encrypt Identity
      const encryptedIdentity = await encryptStorageData(generatedData.loginKey, masterKey);

      // 4. Save to LocalStorage
      const storageObj = {
        salt: Array.from(salt),
        iv: encryptedIdentity.iv,
        data: encryptedIdentity.data
      };
      localStorage.setItem('hellofrom_encrypted_identity', JSON.stringify(storageObj));

      // 5. Login
      onLogin({
        ...generatedData,
        masterKey: masterKey // Pass master key to Chat for encrypting other data
      });
    } catch (e) {
      console.error(e);
      setError("Failed to encrypt and save account.");
    }
    setLoading(false);
  };

  const handleUnlock = async () => {
    if (!password) return;
    setLoading(true);
    setError('');

    try {
      const encryptedStr = localStorage.getItem('hellofrom_encrypted_identity');
      if (!encryptedStr) throw new Error("No session found");

      const storageObj = JSON.parse(encryptedStr);
      const salt = new Uint8Array(storageObj.salt);

      // 1. Derive Master Key
      const masterKey = await deriveMasterKey(password, salt);

      // 2. Decrypt Identity
      const loginKey = await decryptStorageData({
        iv: storageObj.iv,
        data: storageObj.data
      }, masterKey);

      // 3. Import Identity
      const identity = await importIdentity(loginKey);
      const rawJson = JSON.parse(atob(loginKey));

      onLogin({
        ...identity,
        publicKeyJwk: rawJson.publicKey,
        masterKey: masterKey
      });

    } catch (e) {
      console.error(e);
      setError("Incorrect password or corrupted data.");
    }
    setLoading(false);
  };

  const handleReset = () => {
    if (confirm("This will delete your existing account and all encrypted data. Are you sure?")) {
      localStorage.removeItem('hellofrom_encrypted_identity');
      localStorage.removeItem('hellofrom_encrypted_chats');
      localStorage.removeItem('hellofrom_encrypted_contacts');
      localStorage.removeItem('hellofrom_chats'); // Cleanup old
      localStorage.removeItem('hellofrom_contacts'); // Cleanup old
      localStorage.removeItem('hashhello_identity'); // Cleanup old
      setHasEncryptedSession(false);
      setMode('login');
      setGeneratedData(null);
      setPassword('');
      setConfirmPassword('');
    }
  };

  // Render Unlock Screen
  if (mode === 'unlock') {
    return (
      <div className="w-full max-w-md p-6 md:p-8 glass-panel rounded-2xl shadow-[0_0_50px_-12px_rgba(0,255,136,0.1)] animate-in fade-in zoom-in duration-500 mx-4">
        <div className="flex flex-col items-center justify-center mb-8 space-y-2">
          <div className="p-3 bg-primary/10 rounded-full ring-1 ring-primary/30 shadow-[0_0_15px_rgba(0,255,136,0.2)]">
            <Lock className="w-8 h-8 text-primary" />
          </div>
          <h1 className="text-2xl font-bold text-white tracking-tighter">Unlock #hello</h1>
        </div>

        <div className="space-y-4">
          <div>
            <label className="text-xs text-gray-500 font-mono uppercase mb-1 block">Master Password</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleUnlock()}
              className="w-full bg-black/50 border border-white/10 rounded-lg px-4 py-3 text-white font-mono focus:border-primary/50 focus:outline-none transition-colors"
              placeholder="Enter your password..."
              autoFocus
            />
          </div>

          {error && (
            <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-lg text-red-400 text-xs font-mono flex items-center gap-2">
              <span>!</span> {error}
            </div>
          )}

          <button
            onClick={handleUnlock}
            disabled={loading || !password}
            className="w-full bg-primary text-black font-bold py-3 rounded-lg hover:bg-[#00cc6a] transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
          >
            {loading ? <span className="animate-spin">⌛</span> : <Unlock size={18} />}
            UNLOCK
          </button>

          <div className="pt-4 border-t border-white/5 text-center">
            <button onClick={handleReset} className="text-xs text-red-500/50 hover:text-red-500 transition-colors font-mono">
              Forgot Password? Reset Account
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Render Create/Generate Screen
  return (
    <div className="w-full max-w-md p-6 md:p-8 glass-panel rounded-2xl shadow-[0_0_50px_-12px_rgba(0,255,136,0.1)] animate-in fade-in zoom-in duration-500 mx-4">
      <div className="flex flex-col items-center justify-center mb-8 space-y-2">
        <div className="p-3 bg-primary/10 rounded-full ring-1 ring-primary/30 shadow-[0_0_15px_rgba(0,255,136,0.2)]">
          <ShieldCheck className="w-8 h-8 text-primary" />
        </div>
        <h1 className="text-3xl font-bold text-white tracking-tighter flex items-center gap-2 text-glow">
          #hello
        </h1>
        <p className="text-xs text-gray-500 font-mono uppercase tracking-widest">Secure P2P Terminal</p>
      </div>

      {!generatedData ? (
        <div className="space-y-6">
          <div className="text-center space-y-2">
            <p className="text-sm text-gray-400">Welcome to the decentralized network.</p>
            <p className="text-xs text-gray-500">No servers. No tracking. Just you and your peers.</p>
          </div>
          
          <button
            onClick={handleGenerate}
            disabled={loading}
            className="w-full bg-primary text-black font-bold py-4 rounded-xl hover:bg-[#00cc6a] transition-all disabled:opacity-50 flex items-center justify-center gap-2 shadow-[0_0_20px_rgba(0,255,136,0.3)] hover:shadow-[0_0_30px_rgba(0,255,136,0.5)]"
          >
            {loading ? <span className="animate-spin">⌛</span> : <Terminal size={20} />}
            GENERATE NEW IDENTITY
          </button>
        </div>
      ) : (
        <div className="space-y-6 animate-in slide-in-from-bottom-4">
          <div className="text-center">
            <p className="text-xs text-gray-500 font-mono uppercase mb-2">Your New Number</p>
            <div className="text-3xl font-bold text-white font-mono tracking-wider text-glow">
              {generatedData.formattedNumber}
            </div>
          </div>

          <div className="space-y-4 bg-black/30 p-4 rounded-xl border border-white/5">
            <h3 className="text-sm font-bold text-white flex items-center gap-2">
              <Lock size={14} className="text-primary" />
              Set Master Password
            </h3>
            <p className="text-[10px] text-gray-500">
              This password will encrypt your private key and chat history on this device. 
              <br/><span className="text-red-400">If you lose it, your data is lost forever.</span>
            </p>
            
            <div className="space-y-2">
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full bg-black/50 border border-white/10 rounded px-3 py-2 text-sm text-white font-mono focus:border-primary/50 focus:outline-none"
                placeholder="Master Password"
              />
              <input
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                className="w-full bg-black/50 border border-white/10 rounded px-3 py-2 text-sm text-white font-mono focus:border-primary/50 focus:outline-none"
                placeholder="Confirm Password"
              />
            </div>
          </div>

          {error && (
            <div className="text-red-400 text-xs text-center font-mono">
              {error}
            </div>
          )}

          <button
            onClick={handleCreateAccount}
            disabled={loading}
            className="w-full bg-primary text-black font-bold py-3 rounded-lg hover:bg-[#00cc6a] transition-all disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {loading ? <span className="animate-spin">⌛</span> : <Save size={18} />}
            ENCRYPT & ENTER
          </button>
        </div>
      )}
    </div>
  );
}
