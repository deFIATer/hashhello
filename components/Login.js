import { useState, useEffect, useRef } from 'react';
import { generateIdentity, importIdentity, deriveMasterKey, encryptStorageData, decryptStorageData } from '../lib/crypto';
import { Copy, Key, LogIn, ShieldCheck, Terminal, Save, Lock, Unlock, Upload } from 'lucide-react';

export default function Login({ onLogin }) {
  const [mode, setMode] = useState('login'); // 'login' or 'create'
  const [inputKey, setInputKey] = useState('');
  const [generatedData, setGeneratedData] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const fileInputRef = useRef(null);
  
  // Master Password State
  const [hasEncryptedSession, setHasEncryptedSession] = useState(false);
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [savedNumber, setSavedNumber] = useState('');

  useEffect(() => {
    const encrypted = localStorage.getItem('hellofrom_encrypted_identity');
    const num = localStorage.getItem('hellofrom_saved_number');
    if (num) setSavedNumber(num);
    
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
      localStorage.setItem('hellofrom_saved_number', generatedData.phoneNumber);

      // 4b. Restore Backup Data if available
      if (window.pendingBackupChats) {
          const encryptedChats = await encryptStorageData(window.pendingBackupChats, masterKey);
          localStorage.setItem('hellofrom_encrypted_chats', JSON.stringify(encryptedChats));
          delete window.pendingBackupChats;
      }
      if (window.pendingBackupContacts) {
          const encryptedContacts = await encryptStorageData(window.pendingBackupContacts, masterKey);
          localStorage.setItem('hellofrom_encrypted_contacts', JSON.stringify(encryptedContacts));
          delete window.pendingBackupContacts;
      }

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
      localStorage.removeItem('hellofrom_saved_number');
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

  const handleImport = (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (event) => {
      try {
        const backup = JSON.parse(event.target.result);
        
        if (!backup.identity || !backup.identity.privateKeyJwk || !backup.identity.publicKeyJwk) {
             throw new Error("Backup must contain a private key (identity.privateKeyJwk)");
        }

        // Reconstruct identity object compatible with generateIdentity output
        // We need to create the loginKey (base64 encoded JSON)
        const identityObject = {
            phoneNumber: backup.identity.phoneNumber,
            privateKey: backup.identity.privateKeyJwk,
            publicKey: backup.identity.publicKeyJwk
        };
        const loginKey = btoa(JSON.stringify(identityObject));

        // Verify we can import it
        const imported = await importIdentity(loginKey);

        // If successful, set as generated data so user can set a new master password
        setGeneratedData({
            ...imported,
            loginKey,
            publicKeyJwk: backup.identity.publicKeyJwk
        });

        // If backup has chats/contacts, we should probably save them to localStorage temporarily
        // or just let them be overwritten when the user logs in?
        // Actually, we should probably restore them AFTER the user sets the master password.
        // But we don't have the master password yet.
        // So we can store the raw backup in memory or a temp variable?
        // Let's just store the raw backup in a ref or state to be processed in handleCreateAccount?
        // Or simpler: Just restore the identity now, and let the user manually import chats later?
        // The user said "import existing private key OR whole backup".
        // If it's a whole backup, we should restore chats too.
        
        // Let's save the backup data to localStorage UNENCRYPTED temporarily? No, that's bad.
        // We can keep it in memory.
        // But handleCreateAccount reloads the page? No, it calls onLogin.
        
        // Let's modify handleCreateAccount to check for pending backup data.
        if (backup.chats) {
            window.pendingBackupChats = backup.chats;
        }
        if (backup.contacts) {
            window.pendingBackupContacts = backup.contacts;
        }

      } catch (err) {
        console.error(err);
        setError("Invalid backup file: " + err.message);
      }
    };
    reader.readAsText(file);
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
          {savedNumber && <p className="text-xs text-gray-500 font-mono">{savedNumber}</p>}
        </div>

        <form onSubmit={(e) => { e.preventDefault(); handleUnlock(); }} className="space-y-4">
          {/* Hidden username for password manager association */}
          <input 
            type="text" 
            name="username" 
            autoComplete="username" 
            value={savedNumber} 
            readOnly 
            className="hidden" 
          />

          <div>
            <label className="text-xs text-gray-500 font-mono uppercase mb-1 block">Master Password</label>
            <input
              type="password"
              name="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
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
            type="submit"
            disabled={loading || !password}
            className="w-full bg-primary text-black font-bold py-3 rounded-lg hover:bg-[#00cc6a] transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
          >
            {loading ? <span className="animate-spin">⌛</span> : <Unlock size={18} />}
            UNLOCK
          </button>

          <div className="pt-4 border-t border-white/5 text-center">
            <button type="button" onClick={handleReset} className="text-xs text-red-500/50 hover:text-red-500 transition-colors font-mono">
              Forgot Password? Reset Account
            </button>
          </div>
        </form>
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
        <p className="text-xs text-gray-500 font-mono uppercase tracking-widest">Secure P2P Messenger</p>
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

          <div className="relative">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t border-white/10"></div>
            </div>
            <div className="relative flex justify-center text-xs uppercase">
              <span className="bg-black px-2 text-gray-500 font-mono">Or</span>
            </div>
          </div>

          <input 
            type="file" 
            ref={fileInputRef} 
            onChange={handleImport} 
            accept=".json" 
            className="hidden" 
          />
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={loading}
            className="w-full bg-white/5 text-gray-400 font-bold py-3 rounded-xl hover:bg-white/10 hover:text-white transition-all disabled:opacity-50 flex items-center justify-center gap-2 border border-white/10"
          >
            <Upload size={18} />
            IMPORT BACKUP
          </button>
          
          {error && (
            <div className="text-red-400 text-xs text-center font-mono mt-2">
              {error}
            </div>
          )}
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
            
            <form onSubmit={(e) => { e.preventDefault(); handleCreateAccount(); }} className="space-y-2">
              {/* Hidden username for password manager association */}
              <input 
                type="text" 
                name="username" 
                autoComplete="username" 
                value={generatedData.formattedNumber} 
                readOnly 
                className="hidden" 
              />
              
              <input
                type="password"
                name="new-password"
                autoComplete="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full bg-black/50 border border-white/10 rounded px-3 py-2 text-sm text-white font-mono focus:border-primary/50 focus:outline-none"
                placeholder="Master Password"
              />
              <input
                type="password"
                name="confirm-password"
                autoComplete="new-password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                className="w-full bg-black/50 border border-white/10 rounded px-3 py-2 text-sm text-white font-mono focus:border-primary/50 focus:outline-none"
                placeholder="Confirm Password"
              />
              
              {error && (
                <div className="text-red-400 text-xs text-center font-mono">
                  {error}
                </div>
              )}

              <button
                type="submit"
                disabled={loading}
                className="w-full bg-primary text-black font-bold py-3 rounded-lg hover:bg-[#00cc6a] transition-all disabled:opacity-50 flex items-center justify-center gap-2 mt-4"
              >
                {loading ? <span className="animate-spin">⌛</span> : <Save size={18} />}
                ENCRYPT & ENTER
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
