import { useState, useEffect, useRef } from 'react';
import { Send, Phone, Shield, AlertTriangle, Loader2, User, LogOut, Lock, Signal, Wifi, Menu, X, MessageSquare, ChevronLeft, Paperclip, Image as ImageIcon } from 'lucide-react';
import { deriveSharedSecret, encryptMessage, decryptMessage, verifyIdentity, importPublicKey } from '../lib/crypto';
import { playSound } from '../lib/audio';

export default function Chat({ identity, onLogout }) {
  const [peer, setPeer] = useState(null);
  const [status, setStatus] = useState('initializing');
  
  // Multi-chat state
  // Structure: { [peerId]: { id: string, conn: DataConnection, messages: [], status: 'connecting'|'secure'|'disconnected', unread: 0, lastMessage: '' } }
  const [chats, setChats] = useState({});
  const [activeChatId, setActiveChatId] = useState(null);
  
  const [dialNumber, setDialNumber] = useState('');
  const [inputValue, setInputValue] = useState('');
  const [mobileView, setMobileView] = useState('list'); // 'list' or 'chat'

  const messagesEndRef = useRef(null);
  const chatsRef = useRef({}); // Ref to access latest chats state in callbacks if needed
  const fileInputRef = useRef(null);

  // Update ref when state changes
  useEffect(() => {
    chatsRef.current = chats;
  }, [chats]);

  // Request notification permission
  useEffect(() => {
    if (typeof Notification !== 'undefined' && Notification.permission === 'default') {
      Notification.requestPermission();
    }
  }, []);

  const notify = (title, body) => {
    if (typeof Notification !== 'undefined' && document.hidden && Notification.permission === 'granted') {
      new Notification(title, { body, icon: '/icon.png' });
    }
  };

  // Initialize PeerJS
  useEffect(() => {
    const initPeer = async () => {
      try {
        const Peer = (await import('peerjs')).default;
        
        const newPeer = new Peer(identity.phoneNumber, {
          debug: 2,
          config: {
            iceServers: [
              { urls: 'stun:stun.l.google.com:19302' },
              { urls: 'stun:global.stun.twilio.com:3478' }
            ]
          }
        });

        newPeer.on('open', (id) => {
          console.log('My peer ID is: ' + id);
          setStatus('online');
        });

        newPeer.on('connection', (conn) => {
          console.log('Incoming connection from:', conn.peer);
          playSound('connect');
          notify('Incoming Connection', `New connection request from ${formatDisplayNumber(conn.peer)}`);
          handleIncomingConnection(conn);
        });

        newPeer.on('error', (err) => {
          console.error('Peer error:', err);
          setStatus('error');
          playSound('error');
        });

        setPeer(newPeer);
      } catch (err) {
        console.error("Failed to load PeerJS", err);
        setStatus('error');
      }
    };

    initPeer();
  }, [identity.phoneNumber]);

  // Auto-scroll
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chats, activeChatId]);

  const handleIncomingConnection = (conn) => {
    setupConnection(conn, false);
  };

  const connect = () => {
    playSound('click');
    if (!peer || !dialNumber) return;
    const targetId = dialNumber.replace(/\D/g, '');

    if (targetId.length !== 9) {
      alert("Invalid number. Please enter exactly 9 digits.");
      playSound('error');
      return;
    }

    if (targetId === identity.phoneNumber) {
      alert("You cannot connect to yourself.");
      playSound('error');
      return;
    }
    
    // Check if already exists
    if (chats[targetId]) {
      setActiveChatId(targetId);
      setMobileView('chat');
      setDialNumber('');
      return;
    }

    console.log("Connecting to", targetId);
    const conn = peer.connect(targetId);
    setupConnection(conn, true);
    setDialNumber('');
  };

  const setupConnection = (conn, isInitiator) => {
    const peerId = conn.peer;

    // Initialize chat entry
    setChats(prev => ({
      ...prev,
      [peerId]: {
        id: peerId,
        conn: conn,
        messages: [],
        status: 'connecting',
        unread: 0,
        lastMessage: 'Connecting...',
        timestamp: Date.now()
      }
    }));

    if (isInitiator) {
      setActiveChatId(peerId);
      setMobileView('chat');
    }

    conn.on('open', () => {
      console.log(`Connection to ${peerId} opened`);
      if (isInitiator) {
        sendHandshake(conn);
      }
    });

    conn.on('data', async (data) => {
      await handleData(data, conn, isInitiator);
    });

    conn.on('close', () => {
      updateChatStatus(peerId, 'disconnected');
    });

    conn.on('error', (err) => {
      console.error("Connection error", err);
      updateChatStatus(peerId, 'disconnected');
      playSound('error');
    });
  };

  const updateChatStatus = (peerId, status) => {
    setChats(prev => {
      if (!prev[peerId]) return prev;
      return {
        ...prev,
        [peerId]: { ...prev[peerId], status }
      };
    });
  };

  const sendHandshake = (conn) => {
    conn.send({
      type: 'handshake-syn',
      publicKey: identity.publicKeyJwk
    });
  };

  const handleData = async (data, conn, isInitiator) => {
    const peerId = conn.peer;

    try {
      if (data.type === 'handshake-syn' || data.type === 'handshake-ack') {
        const remotePub = await importPublicKey(data.publicKey);
        const isValid = await verifyIdentity(peerId, remotePub);
        
        if (!isValid) {
          conn.close();
          alert(`Security Alert: Identity verification failed for ${peerId}`);
          playSound('error');
          return;
        }

        const secret = await deriveSharedSecret(identity.keyPair.privateKey, remotePub);
        // Attach key to connection object to avoid state sync issues
        conn.sharedKey = secret;

        setChats(prev => {
          if (!prev[peerId]) return prev;
          return {
            ...prev,
            [peerId]: { 
              ...prev[peerId], 
              status: 'secure',
              lastMessage: 'Secure connection established' 
            }
          };
        });
        playSound('connect');

        if (data.type === 'handshake-syn') {
          conn.send({ type: 'handshake-ack', publicKey: identity.publicKeyJwk });
        }
      } else if (data.type === 'msg') {
        if (!conn.sharedKey) return;
        const decrypted = await decryptMessage(data.payload, conn.sharedKey);
        
        if (decrypted) {
          let content;
          try {
            content = JSON.parse(decrypted);
            // Basic validation to ensure it's our format
            if (!content.type) {
              content = { type: 'text', content: decrypted };
            }
          } catch (e) {
            // Fallback for plain text messages
            content = { type: 'text', content: decrypted };
          }
          addMessage(peerId, 'them', content);
          playSound('message');
          
          const msgPreview = content.type === 'image' ? '📷 Image' : content.content;
          notify(`Message from ${formatDisplayNumber(peerId)}`, msgPreview);
        }
      }
    } catch (e) {
      console.error("Error handling data", e);
    }
  };

  const addMessage = (peerId, sender, content) => {
    setChats(prev => {
      const chat = prev[peerId];
      if (!chat) return prev;
      
      const lastMsgText = content.type === 'image' ? '📷 Image' : content.content;

      return {
        ...prev,
        [peerId]: {
          ...chat,
          messages: [...chat.messages, { sender, content, timestamp: Date.now() }],
          lastMessage: lastMsgText,
          timestamp: Date.now(),
          unread: sender === 'them' ? chat.unread + 1 : chat.unread
        }
      };
    });
  };

  // Clear unread when opening chat or receiving message while open
  useEffect(() => {
    if (activeChatId && chats[activeChatId]?.unread > 0) {
      setChats(prev => ({
        ...prev,
        [activeChatId]: { ...prev[activeChatId], unread: 0 }
      }));
    }
  }, [activeChatId, chats]);

  const handleFileSelect = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    
    // 5MB limit
    if (file.size > 5 * 1024 * 1024) {
      alert("File too large. Max 5MB.");
      return;
    }

    const reader = new FileReader();
    reader.onload = async () => {
      const base64 = reader.result;
      await sendMessage({ type: 'image', content: base64, fileName: file.name });
    };
    reader.readAsDataURL(file);
    
    // Reset input
    e.target.value = '';
  };

  const sendMessage = async (messageData = null) => {
    if (!activeChatId) return;
    
    const chat = chats[activeChatId];
    if (!chat || !chat.conn || !chat.conn.sharedKey) return;

    let payloadString;
    let displayContent;

    if (messageData) {
      // Structured message (image, etc)
      payloadString = JSON.stringify(messageData);
      displayContent = messageData;
    } else {
      // Text message from input
      if (!inputValue.trim()) return;
      const text = inputValue;
      setInputValue('');
      
      const msgObj = { type: 'text', content: text };
      payloadString = JSON.stringify(msgObj);
      displayContent = msgObj;
    }

    playSound('click');
    const encrypted = await encryptMessage(payloadString, chat.conn.sharedKey);
    chat.conn.send({ type: 'msg', payload: encrypted });

    // Manually add message to state
    setChats(prev => ({
      ...prev,
      [activeChatId]: {
        ...prev[activeChatId],
        messages: [...prev[activeChatId].messages, { sender: 'me', content: displayContent, timestamp: Date.now() }],
        lastMessage: displayContent.type === 'image' ? '📷 Image' : displayContent.content,
        timestamp: Date.now()
      }
    }));
  };

  const formatDisplayNumber = (num) => {
    if (!num) return '...';
    const p = num.toString().padStart(9, '0');
    return `#${p.slice(0, 3)} ${p.slice(3, 6)} ${p.slice(6)}`;
  };

  const activeChat = activeChatId ? chats[activeChatId] : null;

  return (
    <div className="fixed inset-0 z-50 md:relative md:inset-auto md:z-0 flex h-[100dvh] md:h-[90vh] w-full md:max-w-6xl md:mx-auto md:my-8 md:rounded-2xl md:border md:border-white/10 md:shadow-2xl overflow-hidden bg-black">
      
      {/* Background Grid */}
      <div className="absolute inset-0 bg-[linear-gradient(to_right,#111_1px,transparent_1px),linear-gradient(to_bottom,#111_1px,transparent_1px)] bg-[size:24px_24px] opacity-20 pointer-events-none"></div>

      {/* Sidebar (Chat List) */}
      <div className={`w-full md:w-80 bg-black/80 backdrop-blur-xl border-r border-white/5 flex flex-col z-20 absolute md:relative h-full transition-transform duration-300 ${mobileView === 'list' ? 'translate-x-0' : '-translate-x-full md:translate-x-0'}`}>
        {/* Sidebar Header */}
        <div className="p-3 md:p-4 border-b border-white/5 flex justify-between items-center bg-black/40">
          <div>
            <h2 className="font-bold text-white flex items-center gap-2">
              <Shield size={16} className="text-primary"/>
              {identity.formattedNumber}
            </h2>
            <div className="flex items-center gap-2 text-[10px] text-gray-500 font-mono uppercase tracking-widest mt-1">
              <Signal size={10} className={status === 'online' ? 'text-primary' : 'text-red-500'} />
              {status === 'online' ? 'ONLINE' : 'OFFLINE'}
            </div>
          </div>
          <button onClick={onLogout} className="text-gray-500 hover:text-white transition-colors">
            <LogOut size={18} />
          </button>
        </div>

        {/* New Chat Input */}
        <div className="p-4 border-b border-white/5">
          <div className="flex gap-2">
            <input
              type="tel"
              inputMode="numeric"
              pattern="[0-9]*"
              placeholder="600 500 600"
              value={dialNumber}
              onChange={(e) => setDialNumber(e.target.value)}
              className="w-full bg-white/5 border border-white/10 rounded px-3 py-2 font-mono text-sm text-white focus:border-primary/50 focus:outline-none"
            />
            <button
              onClick={connect}
              disabled={!dialNumber}
              className="bg-primary text-black p-2 rounded hover:bg-[#00cc6a] disabled:opacity-50"
            >
              <Phone size={16} />
            </button>
          </div>
        </div>

        {/* Chat List */}
        <div className="flex-1 overflow-y-auto">
          {Object.values(chats).sort((a, b) => b.timestamp - a.timestamp).map(chat => (
            <button
              key={chat.id}
              onClick={() => {
                setActiveChatId(chat.id);
                setMobileView('chat');
                playSound('click');
              }}
              className={`w-full p-4 flex items-center gap-3 border-b border-white/5 hover:bg-white/5 transition-colors text-left ${activeChatId === chat.id ? 'bg-white/5 border-l-2 border-l-primary' : ''}`}
            >
              <div className="w-10 h-10 rounded-full bg-white/5 flex items-center justify-center border border-white/10 relative">
                <User size={20} className="text-gray-400" />
                {chat.status === 'secure' && <div className="absolute bottom-0 right-0 w-2.5 h-2.5 bg-primary rounded-full border-2 border-black"></div>}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex justify-between items-baseline mb-1">
                  <span className="font-mono font-bold text-sm text-gray-200">{formatDisplayNumber(chat.id)}</span>
                  {chat.timestamp && <span className="text-[10px] text-gray-600">{new Date(chat.timestamp).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</span>}
                </div>
                <div className="flex justify-between items-center">
                  <p className="text-xs text-gray-500 truncate max-w-[140px]">{chat.lastMessage}</p>
                  {chat.unread > 0 && (
                    <span className="bg-primary text-black text-[10px] font-bold px-1.5 py-0.5 rounded-full min-w-[18px] text-center">
                      {chat.unread}
                    </span>
                  )}
                </div>
              </div>
            </button>
          ))}
          {Object.keys(chats).length === 0 && (
            <div className="p-8 text-center text-gray-600 text-xs font-mono">
              No active chats. Dial a number to start.
            </div>
          )}
        </div>
      </div>

      {/* Main Chat Area */}
      <div className={`flex-1 flex flex-col bg-black/20 relative z-10 w-full h-full absolute md:relative transition-transform duration-300 ${mobileView === 'chat' ? 'translate-x-0' : 'translate-x-full md:translate-x-0'}`}>
        
        {activeChat ? (
          <>
            {/* Chat Header */}
            <header className="p-3 md:p-4 border-b border-white/5 flex items-center gap-4 bg-black/40 backdrop-blur-md">
              <button 
                onClick={() => setMobileView('list')}
                className="md:hidden text-gray-400 hover:text-white"
              >
                <ChevronLeft size={24} />
              </button>
              <div className="flex-1">
                <h2 className="font-bold text-white flex items-center gap-2">
                  {formatDisplayNumber(activeChat.id)}
                  {activeChat.status === 'secure' && <Lock size={14} className="text-primary" />}
                </h2>
                <p className="text-[10px] text-gray-500 font-mono uppercase tracking-widest">
                  {activeChat.status === 'secure' ? 'ENCRYPTED CHANNEL' : activeChat.status}
                </p>
              </div>
            </header>

            {/* Messages */}
            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              {activeChat.messages.length === 0 && (
                <div className="flex flex-col items-center justify-center h-full text-gray-600 space-y-4 opacity-50">
                  <Lock size={40} />
                  <p className="font-mono text-xs">End-to-End Encrypted</p>
                </div>
              )}
              
              {activeChat.messages.map((msg, i) => (
                <div key={i} className={`flex ${msg.sender === 'me' ? 'justify-end' : 'justify-start'} animate-in slide-in-from-bottom-2 duration-300`}>
                  <div className={`max-w-[85%] sm:max-w-[70%] p-3 rounded-2xl shadow-lg backdrop-blur-sm border ${
                    msg.sender === 'me' 
                      ? 'bg-primary/90 text-black rounded-tr-sm border-primary/50' 
                      : 'bg-gray-900/80 text-gray-100 rounded-tl-sm border-white/10'
                  }`}>
                    {msg.content.type === 'image' ? (
                      <div className="space-y-1">
                        <img 
                          src={msg.content.content} 
                          alt="Shared image" 
                          className="max-w-full rounded-lg cursor-pointer hover:opacity-90 transition-opacity" 
                          onClick={() => {
                            const w = window.open("");
                            w.document.write(`<img src="${msg.content.content}" style="max-width:100%"/>`);
                          }} 
                        />
                        {msg.content.fileName && <p className="text-[10px] opacity-50 truncate max-w-[200px]">{msg.content.fileName}</p>}
                      </div>
                    ) : (
                      <p className="font-mono text-sm leading-relaxed whitespace-pre-wrap break-words">{msg.content.content}</p>
                    )}
                    
                    <div className={`text-[9px] mt-1 flex items-center justify-end gap-1 opacity-60 ${msg.sender === 'me' ? 'text-black' : 'text-gray-400'}`}>
                      {new Date(msg.timestamp).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}
                    </div>
                  </div>
                </div>
              ))}
              <div ref={messagesEndRef} />
            </div>

            {/* Input */}
            <div className="p-4 border-t border-white/5 bg-black/40 backdrop-blur-md">
              <div className="flex gap-3 items-end">
                <input 
                  type="file" 
                  ref={fileInputRef} 
                  onChange={handleFileSelect} 
                  accept="image/*" 
                  className="hidden" 
                />
                <button
                  onClick={() => {
                    fileInputRef.current?.click();
                    playSound('click');
                  }}
                  disabled={activeChat.status !== 'secure'}
                  className="p-3 bg-white/5 text-gray-400 rounded-xl hover:bg-white/10 hover:text-white disabled:opacity-50 transition-all"
                  title="Send Image"
                >
                  <Paperclip size={20} />
                </button>

                <input
                  type="text"
                  value={inputValue}
                  onChange={(e) => setInputValue(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && sendMessage()}
                  disabled={activeChat.status !== 'secure'}
                  placeholder="Type a secure message..."
                  className="flex-1 bg-white/5 border border-white/10 rounded-xl px-4 py-3 font-mono text-sm text-white focus:border-primary/50 focus:outline-none disabled:opacity-50"
                />
                <button
                  onClick={() => sendMessage()}
                  disabled={activeChat.status !== 'secure' || !inputValue.trim()}
                  className="p-3 bg-primary text-black rounded-xl hover:bg-[#00cc6a] disabled:opacity-50 transition-all"
                >
                  <Send size={20} />
                </button>
              </div>
            </div>
          </>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center text-gray-600 p-8 text-center">
            <div className="w-20 h-20 rounded-full bg-white/5 flex items-center justify-center mb-4">
              <MessageSquare size={32} />
            </div>
            <h3 className="text-white font-bold mb-2">Select a chat</h3>
            <p className="text-xs font-mono max-w-xs">
              Choose a conversation from the sidebar or dial a new number to start messaging.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
