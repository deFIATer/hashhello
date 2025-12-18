import { useState, useEffect } from 'react';
import { generateIdentity, importIdentity } from '../lib/crypto';
import { Copy, Key, LogIn, ShieldCheck, Terminal, Save } from 'lucide-react';

export default function Login({ onLogin }) {
  const [mode, setMode] = useState('login'); // 'login' or 'create'
  const [inputKey, setInputKey] = useState('');
  const [generatedData, setGeneratedData] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [savedSession, setSavedSession] = useState(null);

  useEffect(() => {
    const saved = localStorage.getItem('hashhello_identity');
    if (saved) {
      setSavedSession(saved);
      // Optional: Auto-fill inputKey if we want to show it, or just keep it ready
      // setInputKey(saved); 
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

  const handleLogin = async (keyToUse = inputKey) => {
    setLoading(true);
    setError('');
    try {
      const identity = await importIdentity(keyToUse);
      const rawJson = JSON.parse(atob(keyToUse));
      
      // Save to local storage
      localStorage.setItem('hashhello_identity', keyToUse);

      onLogin({
        ...identity,
        publicKeyJwk: rawJson.publicKey
      });
    } catch (e) {
      setError("Invalid Key. Please check your input.");
      // If saved session was invalid, clear it
      if (keyToUse === savedSession) {
          localStorage.removeItem('hashhello_identity');
          setSavedSession(null);
      }
    }
    setLoading(false);
  };

  const handleAutoLoginAfterCreate = () => {
    if (generatedData) {
      // Save to local storage
      localStorage.setItem('hashhello_identity', generatedData.loginKey);

      onLogin({
        keyPair: generatedData.keyPair,
        phoneNumber: generatedData.phoneNumber,
        formattedNumber: generatedData.formattedNumber,
        publicKeyJwk: generatedData.publicKeyJwk
      });
    }
  };

  const restoreSession = () => {
      if (savedSession) {
          handleLogin(savedSession);
      }
  };

  const clearSession = () => {
      localStorage.removeItem('hashhello_identity');
      setSavedSession(null);
  };

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

      {savedSession && !generatedData && mode === 'login' ? (
          <div className="mb-6 p-4 bg-primary/5 border border-primary/20 rounded-lg animate-in slide-in-from-top-2">
              <div className="flex items-center gap-3 mb-3">
                  <div className="p-2 bg-primary/10 rounded-full">
                      <Save size={16} className="text-primary" />
                  </div>
                  <div>
                      <p className="text-xs font-bold text-white">Saved Session Found</p>
                      <p className="text-[10px] text-gray-400">Encrypted key stored locally in browser</p>
                  </div>
              </div>
              <div className="flex gap-2">
                  <button 
                      onClick={restoreSession}
                      disabled={loading}
                      className="flex-1 py-2 bg-primary text-black text-xs font-bold rounded hover:bg-[#00cc6a] transition-colors"
                  >
                      RESTORE SESSION
                  </button>
                  <button 
                      onClick={clearSession}
                      disabled={loading}
                      className="px-3 py-2 bg-white/5 text-gray-400 text-xs font-bold rounded hover:bg-red-500/10 hover:text-red-400 transition-colors"
                  >
                      FORGET
                  </button>
              </div>
          </div>
      ) : null}

      <div className="flex mb-8 p-1 bg-black/40 rounded-lg border border-white/5">
        <button
          onClick={() => setMode('login')}
          className={`flex-1 py-2 text-xs font-bold font-mono rounded-md transition-all ${
            mode === 'login' 
              ? 'bg-gray-800 text-primary shadow-sm ring-1 ring-white/10' 
              : 'text-gray-500 hover:text-gray-300 hover:bg-white/5'
          }`}
        >
          LOGIN
        </button>
        <button
          onClick={() => setMode('create')}
          className={`flex-1 py-2 text-xs font-bold font-mono rounded-md transition-all ${
            mode === 'create' 
              ? 'bg-gray-800 text-primary shadow-sm ring-1 ring-white/10' 
              : 'text-gray-500 hover:text-gray-300 hover:bg-white/5'
          }`}
        >
          NEW IDENTITY
        </button>
      </div>

      {mode === 'login' ? (
        <div className="space-y-5">
          <div className="relative group">
            <div className="absolute -inset-0.5 bg-gradient-to-r from-primary/20 to-blue-500/20 rounded-lg blur opacity-0 group-hover:opacity-100 transition duration-500"></div>
            <div className="relative">
              <label className="block text-[10px] text-gray-500 mb-2 font-mono uppercase tracking-wider">Private Key</label>
              <textarea
                value={inputKey}
                onChange={(e) => setInputKey(e.target.value)}
                className="w-full h-32 bg-black/50 border border-white/10 rounded-lg p-4 text-xs font-mono text-gray-300 focus:border-primary/50 focus:ring-1 focus:ring-primary/50 focus:outline-none resize-none transition-all placeholder:text-gray-700"
                placeholder="Paste your encrypted identity key here..."
              />
            </div>
          </div>
          
          {error && (
            <div className="p-3 bg-red-500/10 border border-red-500/20 rounded text-red-400 text-xs font-mono flex items-center gap-2">
              <Terminal size={14} />
              {error}
            </div>
          )}
          
          <button
            onClick={() => handleLogin(inputKey)}
            disabled={loading || !inputKey}
            className="w-full py-3.5 bg-primary text-black font-bold rounded-lg hover:bg-[#00cc6a] hover:shadow-[0_0_20px_rgba(0,255,136,0.3)] transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 text-sm tracking-wide"
          >
            <LogIn size={16} />
            ACCESS TERMINAL
          </button>
          
          <p className="text-[10px] text-center text-gray-600 font-mono">
            By logging in, your key will be saved locally in this browser.
          </p>
        </div>
      ) : (
        <div className="space-y-6">
          {!generatedData ? (
            <div className="text-center py-8 space-y-6">
              <div className="p-6 border border-dashed border-gray-800 rounded-xl bg-black/20">
                <p className="text-gray-400 text-xs leading-relaxed font-mono">
                  Generate a cryptographically secure identity locally in your browser. 
                  <br/><br/>
                  <span className="text-gray-500">ECDH P-256 • AES-GCM • No Server Storage</span>
                </p>
              </div>
              <button
                onClick={handleGenerate}
                disabled={loading}
                className="w-full py-3.5 bg-white/5 border border-white/10 hover:bg-white/10 hover:border-primary/50 text-white rounded-lg transition-all flex items-center justify-center gap-2 text-sm font-mono group"
              >
                <Key size={16} className="group-hover:text-primary transition-colors" />
                GENERATE KEYS
              </button>
            </div>
          ) : (
            <div className="space-y-5 animate-in fade-in slide-in-from-bottom-4 duration-500">
              <div className="bg-black/40 p-5 rounded-xl border border-primary/20 text-center relative overflow-hidden">
                <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-primary to-transparent opacity-50"></div>
                <p className="text-[10px] text-gray-500 mb-2 font-mono uppercase">Your Assigned Number</p>
                <p className="text-3xl font-mono text-primary tracking-widest text-glow">{generatedData.formattedNumber}</p>
              </div>

              <div>
                <label className="block text-[10px] text-gray-500 mb-2 font-mono flex justify-between items-center uppercase">
                  <span>Private Key (Save Securely)</span>
                  <button 
                    onClick={() => navigator.clipboard.writeText(generatedData.loginKey)}
                    className="text-primary hover:text-white text-[10px] flex items-center gap-1 transition-colors"
                  >
                    <Copy size={10} /> COPY
                  </button>
                </label>
                <div className="w-full h-24 bg-black/50 border border-white/10 rounded-lg p-3 text-[10px] font-mono text-gray-400 break-all overflow-y-auto hover:border-white/20 transition-colors">
                  {generatedData.loginKey}
                </div>
                <p className="text-[10px] text-amber-500/80 mt-2 flex items-center gap-1.5">
                  <Terminal size={10} />
                  Do not lose this key. It cannot be recovered.
                </p>
              </div>

              <button
                onClick={handleAutoLoginAfterCreate}
                className="w-full py-3.5 bg-primary text-black font-bold rounded-lg hover:bg-[#00cc6a] hover:shadow-[0_0_20px_rgba(0,255,136,0.3)] transition-all text-sm tracking-wide"
              >
                INITIALIZE SESSION
              </button>
              
              <p className="text-[10px] text-center text-gray-600 font-mono">
                Your key will be saved locally in this browser for future sessions.
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
