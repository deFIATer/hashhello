import { useState, useEffect, useRef } from 'react';
import { Send, Phone, Shield, AlertTriangle, Loader2, User, LogOut, Lock, Signal, Wifi, Menu, X, MessageSquare, ChevronLeft, Paperclip, Image as ImageIcon, RefreshCw, Download, Edit2, Check, Mic, Square, Trash2, PhoneOff, MicOff, PhoneIncoming } from 'lucide-react';
import { deriveSharedSecret, encryptMessage, decryptMessage, verifyIdentity, importPublicKey, encryptStorageData, decryptStorageData } from '../lib/crypto';
import { playSound } from '../lib/audio';

export default function Chat({ identity, onLogout }) {
  const [peer, setPeer] = useState(null);
  const [status, setStatus] = useState('initializing');
  
  // Multi-chat state
  // Structure: { [peerId]: { id: string, conn: DataConnection, messages: [], status: 'connecting'|'secure'|'disconnected', unread: 0, lastMessage: '' } }
  const [chats, setChats] = useState({});
  const [activeChatId, setActiveChatId] = useState(null);
  const [contacts, setContacts] = useState({}); // { [phoneNumber]: "Custom Name" }
  const [isEditingName, setIsEditingName] = useState(false);
  const [editingNameValue, setEditingNameValue] = useState('');
  
  const [dialNumber, setDialNumber] = useState('');
  const [inputValue, setInputValue] = useState('');
  const [mobileView, setMobileView] = useState('list'); // 'list' or 'chat'

  const messagesEndRef = useRef(null);
  const chatsRef = useRef({}); // Ref to access latest chats state in callbacks if needed
  const fileInputRef = useRef(null);

  // Audio Recording State
  const [isRecording, setIsRecording] = useState(false);
  const [recordingTime, setRecordingTime] = useState(0);
  const mediaRecorderRef = useRef(null);
  const audioChunksRef = useRef([]);
  const timerIntervalRef = useRef(null);
  const isRecordingCancelledRef = useRef(false);
  const audioContextRef = useRef(null);
  const analyserRef = useRef(null);
  const canvasRef = useRef(null);
  const animationFrameRef = useRef(null);

  // Call State
  const [incomingCall, setIncomingCall] = useState(null);
  const [activeCall, setActiveCall] = useState(null);
  const [callStatus, setCallStatus] = useState('idle'); // 'idle', 'ringing', 'calling', 'connected'
  const [isMuted, setIsMuted] = useState(false);
  const localStreamRef = useRef(null);
  const remoteAudioRef = useRef(null);

  const formatTime = (seconds) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const startRecording = async () => {
    try {
      isRecordingCancelledRef.current = false;
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      
      // Audio Analysis Setup
      const audioContext = new (window.AudioContext || window.webkitAudioContext)();
      const analyser = audioContext.createAnalyser();
      const source = audioContext.createMediaStreamSource(stream);
      source.connect(analyser);
      analyser.fftSize = 64; // Low fftSize for fewer bars (chunkier look)
      
      audioContextRef.current = audioContext;
      analyserRef.current = analyser;

      const mediaRecorder = new MediaRecorder(stream);
      mediaRecorderRef.current = mediaRecorder;
      audioChunksRef.current = [];

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      mediaRecorder.onstop = async () => {
        // Cleanup Audio Context
        if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
        if (audioContextRef.current) audioContextRef.current.close();

        if (isRecordingCancelledRef.current) {
          stream.getTracks().forEach(track => track.stop());
          return;
        }

        const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
        const reader = new FileReader();
        reader.readAsDataURL(audioBlob);
        reader.onloadend = async () => {
          const base64Audio = reader.result;
          await sendMessage({ type: 'audio', content: base64Audio });
        };
        
        // Stop all tracks to release microphone
        stream.getTracks().forEach(track => track.stop());
      };

      mediaRecorder.start();
      setIsRecording(true);
      setRecordingTime(0);
      timerIntervalRef.current = setInterval(() => {
        setRecordingTime(prev => prev + 1);
      }, 1000);
      
      // Start visualization loop
      const draw = () => {
        if (!analyserRef.current || !canvasRef.current) return;
        
        const canvas = canvasRef.current;
        const ctx = canvas.getContext('2d');
        const bufferLength = analyserRef.current.frequencyBinCount;
        const dataArray = new Uint8Array(bufferLength);
        
        analyserRef.current.getByteFrequencyData(dataArray);
        
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        
        const barWidth = (canvas.width / bufferLength) * 2;
        let barHeight;
        let x = 0;
        
        for(let i = 0; i < bufferLength; i++) {
          barHeight = (dataArray[i] / 255) * canvas.height;
          
          // Gradient red color
          ctx.fillStyle = `rgba(239, 68, 68, ${dataArray[i] / 255})`;
          // Rounded bars
          ctx.beginPath();
          ctx.roundRect(x, canvas.height - barHeight, barWidth - 2, barHeight, 4);
          ctx.fill();
          
          x += barWidth;
        }
        
        animationFrameRef.current = requestAnimationFrame(draw);
      };
      draw();

      playSound('click');
    } catch (err) {
      console.error("Error accessing microphone:", err);
      alert("Could not access microphone. Please check permissions.");
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
      if (timerIntervalRef.current) {
        clearInterval(timerIntervalRef.current);
        timerIntervalRef.current = null;
      }
      playSound('click');
    }
  };

  const cancelRecording = () => {
    isRecordingCancelledRef.current = true;
    stopRecording();
  };

  // Update ref when state changes
  useEffect(() => {
    chatsRef.current = chats;
  }, [chats]);

  // Load chats from localStorage on mount
  useEffect(() => {
    const loadData = async () => {
      // Load Chats
      const encryptedChats = localStorage.getItem('hellofrom_encrypted_chats');
      if (encryptedChats && identity.masterKey) {
        try {
          const parsedEnc = JSON.parse(encryptedChats);
          const decrypted = await decryptStorageData(parsedEnc, identity.masterKey);
          
          const hydrated = {};
          Object.keys(decrypted).forEach(key => {
            hydrated[key] = {
              ...decrypted[key],
              conn: null,
              status: 'disconnected'
            };
          });
          setChats(hydrated);
        } catch (e) {
          console.error("Failed to decrypt chats", e);
        }
      } else {
        // Fallback to old unencrypted storage (migration or dev)
        const savedChats = localStorage.getItem('hellofrom_chats');
        if (savedChats) {
           // ... (Optional: migrate here if needed, but for now just ignore or load)
        }
      }

      // Load Contacts
      const encryptedContacts = localStorage.getItem('hellofrom_encrypted_contacts');
      if (encryptedContacts && identity.masterKey) {
        try {
          const parsedEnc = JSON.parse(encryptedContacts);
          const decrypted = await decryptStorageData(parsedEnc, identity.masterKey);
          setContacts(decrypted);
        } catch (e) {
          console.error("Failed to decrypt contacts", e);
        }
      }
    };
    loadData();
  }, [identity.masterKey]);

  // Save chats to localStorage whenever they change
  useEffect(() => {
    if (Object.keys(chats).length === 0 || !identity.masterKey) return;

    const toSave = {};
    Object.keys(chats).forEach(key => {
      const chat = chats[key];
      toSave[key] = {
        id: chat.id,
        messages: chat.messages,
        status: 'disconnected', // Always save as disconnected
        unread: chat.unread,
        lastMessage: chat.lastMessage,
        timestamp: chat.timestamp
      };
    });

    const saveData = async () => {
      try {
        const encrypted = await encryptStorageData(toSave, identity.masterKey);
        localStorage.setItem('hellofrom_encrypted_chats', JSON.stringify(encrypted));
      } catch (e) {
        console.error("Failed to save encrypted chats", e);
      }
    };
    saveData();
  }, [chats, identity.masterKey]);

  // Save contacts
  useEffect(() => {
    if (!identity.masterKey) return;
    const saveContacts = async () => {
      try {
        const encrypted = await encryptStorageData(contacts, identity.masterKey);
        localStorage.setItem('hellofrom_encrypted_contacts', JSON.stringify(encrypted));
      } catch (e) {
        console.error("Failed to save encrypted contacts", e);
      }
    };
    saveContacts();
  }, [contacts, identity.masterKey]);

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
    let reconnectInterval = null;
    let newPeer = null;

    const initPeer = async () => {
      try {
        const Peer = (await import('peerjs')).default;
        
        newPeer = new Peer(identity.phoneNumber, {
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
          if (reconnectInterval) {
            clearInterval(reconnectInterval);
            reconnectInterval = null;
          }
        });

        newPeer.on('disconnected', () => {
          console.log('Peer disconnected');
          setStatus('disconnected');
          if (!reconnectInterval) {
            reconnectInterval = setInterval(() => {
              if (newPeer && !newPeer.destroyed) {
                console.log('Attempting reconnection...');
                newPeer.reconnect();
              }
            }, 30000);
          }
        });

        newPeer.on('connection', (conn) => {
          console.log('Incoming connection from:', conn.peer);
          playSound('connect');
          notify('Incoming Connection', `New connection request from ${formatDisplayNumber(conn.peer)}`);
          handleIncomingConnection(conn);
        });

        newPeer.on('call', (call) => {
          console.log('Incoming call from:', call.peer);
          setIncomingCall({ call, peerId: call.peer });
          setCallStatus('ringing');
          playSound('ringtone'); // Ensure you have a ringtone sound or use 'connect' for now
          notify('Incoming Call', `Incoming call from ${formatDisplayNumber(call.peer)}`);
        });

        newPeer.on('error', (err) => {
          console.error('Peer error:', err);
          if (err.type === 'peer-unavailable') {
            const match = err.message.match(/peer\s+(\d+)/);
            if (match && match[1]) {
               const targetId = match[1];
               setChats(prev => {
                 if (!prev[targetId]) return prev;
                 return {
                   ...prev,
                   [targetId]: { ...prev[targetId], status: 'offline', lastMessage: 'User is offline' }
                 };
               });
            }
          } else {
            setStatus('error');
            playSound('error');
          }
        });

        setPeer(newPeer);
      } catch (err) {
        console.error("Failed to load PeerJS", err);
        setStatus('error');
      }
    };

    initPeer();

    const handleOnline = () => {
      if (newPeer && newPeer.disconnected && !newPeer.destroyed) {
        newPeer.reconnect();
      }
    };
    window.addEventListener('online', handleOnline);

    return () => {
      window.removeEventListener('online', handleOnline);
      if (reconnectInterval) clearInterval(reconnectInterval);
      if (newPeer) newPeer.destroy();
    };
  }, [identity.phoneNumber]);

  // Auto-reconnect to saved chats when coming online
  useEffect(() => {
    if (status === 'online' && peer && !peer.destroyed) {
      const savedChats = Object.values(chatsRef.current);
      if (savedChats.length > 0) {
        console.log(`Attempting to auto-reconnect to ${savedChats.length} chats...`);
        savedChats.forEach(chat => {
          if (chat.status === 'disconnected' || chat.status === 'offline') {
            // Don't play sound for auto-reconnect to avoid spam
            const conn = peer.connect(chat.id);
            setupConnection(conn, true);
          }
        });
      }
    }
  }, [status, peer]);

  // Auto-scroll
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chats, activeChatId]);

  const handleManualReconnect = () => {
    if (peer && !peer.destroyed) {
      console.log('Manual reconnection attempt...');
      peer.reconnect();
    } else {
      window.location.reload();
    }
  };

  const exportData = () => {
    const backup = {
      identity: {
        phoneNumber: identity.phoneNumber,
        // We don't export private keys for security in this simple backup, 
        // but we include public info.
        publicKeyJwk: identity.publicKeyJwk
      },
      chats: {},
      contacts: contacts,
      timestamp: Date.now(),
      version: '1.0'
    };

    // Clean chats for export
    Object.keys(chats).forEach(key => {
      const chat = chats[key];
      backup.chats[key] = {
        id: chat.id,
        messages: chat.messages,
        status: 'disconnected',
        unread: chat.unread,
        lastMessage: chat.lastMessage,
        timestamp: chat.timestamp
      };
    });

    const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `hellofrom-backup-${identity.phoneNumber}-${new Date().toISOString().slice(0,10)}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

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

  const reconnectToChat = (peerId) => {
    playSound('click');
    if (!peer) return;
    
    console.log("Reconnecting to", peerId);
    const conn = peer.connect(peerId);
    setupConnection(conn, true);
  };

  const setupConnection = (conn, isInitiator) => {
    const peerId = conn.peer;

    // Initialize chat entry
    setChats(prev => {
      const existing = prev[peerId];
      return {
        ...prev,
        [peerId]: {
          id: peerId,
          conn: conn,
          messages: existing ? existing.messages : [],
          status: 'connecting',
          unread: existing ? existing.unread : 0,
          lastMessage: 'Connecting...',
          timestamp: Date.now()
        }
      };
    });

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
    if (contacts[num]) return contacts[num];
    const p = num.toString().padStart(9, '0');
    return `#${p.slice(0, 3)} ${p.slice(3, 6)} ${p.slice(6)}`;
  };

  const saveContactName = () => {
    if (!activeChatId) return;
    setContacts(prev => ({
      ...prev,
      [activeChatId]: editingNameValue.trim()
    }));
    setIsEditingName(false);
  };

  const startEditingName = () => {
    setEditingNameValue(contacts[activeChatId] || '');
    setIsEditingName(true);
  };

  const handleNumberChange = (e) => {
    const raw = e.target.value.replace(/\D/g, '').slice(0, 9);
    let formatted = raw;
    if (raw.length > 6) {
      formatted = `${raw.slice(0, 3)} ${raw.slice(3, 6)} ${raw.slice(6)}`;
    } else if (raw.length > 3) {
      formatted = `${raw.slice(0, 3)} ${raw.slice(3)}`;
    }
    setDialNumber(formatted);
  };

  // Call Functions
  const startCall = async () => {
    if (!activeChatId || !peer) return;
    
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      localStreamRef.current = stream;
      
      const call = peer.call(activeChatId, stream);
      setActiveCall(call);
      setCallStatus('calling');
      
      call.on('stream', (remoteStream) => {
        if (remoteAudioRef.current) {
          remoteAudioRef.current.srcObject = remoteStream;
          remoteAudioRef.current.play();
        }
        setCallStatus('connected');
      });

      call.on('close', () => {
        endCall();
      });

      call.on('error', (err) => {
        console.error("Call error:", err);
        endCall();
      });

    } catch (err) {
      console.error("Failed to get local stream", err);
      alert("Could not access microphone.");
    }
  };

  const answerCall = async () => {
    if (!incomingCall) return;
    
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      localStreamRef.current = stream;
      
      incomingCall.call.answer(stream);
      setActiveCall(incomingCall.call);
      setCallStatus('connected');
      setIncomingCall(null);

      incomingCall.call.on('stream', (remoteStream) => {
        if (remoteAudioRef.current) {
          remoteAudioRef.current.srcObject = remoteStream;
          remoteAudioRef.current.play();
        }
      });

      incomingCall.call.on('close', () => {
        endCall();
      });

      incomingCall.call.on('error', (err) => {
        console.error("Call error:", err);
        endCall();
      });

    } catch (err) {
      console.error("Failed to get local stream", err);
      alert("Could not access microphone.");
      rejectCall();
    }
  };

  const rejectCall = () => {
    if (incomingCall) {
      incomingCall.call.close();
      setIncomingCall(null);
      setCallStatus('idle');
    }
  };

  const endCall = () => {
    if (activeCall) {
      activeCall.close();
    }
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach(track => track.stop());
      localStreamRef.current = null;
    }
    setActiveCall(null);
    setCallStatus('idle');
    setIncomingCall(null);
    setIsMuted(false);
  };

  const toggleMute = () => {
    if (localStreamRef.current) {
      const audioTrack = localStreamRef.current.getAudioTracks()[0];
      if (audioTrack) {
        audioTrack.enabled = !audioTrack.enabled;
        setIsMuted(!audioTrack.enabled);
      }
    }
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
              {status !== 'online' && (
                <button onClick={handleManualReconnect} className="ml-1 hover:text-white transition-colors" title="Reconnect">
                  <RefreshCw size={10} />
                </button>
              )}
            </div>
          </div>
          <button onClick={onLogout} className="text-gray-500 hover:text-white transition-colors" title="Logout">
            <LogOut size={18} />
          </button>
          <button onClick={exportData} className="text-gray-500 hover:text-white transition-colors ml-2" title="Export Backup">
            <Download size={18} />
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
              onChange={handleNumberChange}
              onKeyDown={(e) => e.key === 'Enter' && connect()}
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
                  <p className={`text-xs truncate max-w-[140px] ${chat.status === 'secure' ? 'text-gray-500' : 'text-gray-400'}`}>
                    {chat.status === 'secure' ? chat.lastMessage : chat.status.toUpperCase()}
                  </p>
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
                <div className="flex items-center gap-2">
                  {isEditingName ? (
                    <div className="flex items-center gap-2">
                      <input
                        type="text"
                        value={editingNameValue}
                        onChange={(e) => setEditingNameValue(e.target.value)}
                        className="bg-white/10 border border-white/20 rounded px-2 py-1 text-sm text-white focus:outline-none focus:border-primary"
                        placeholder="Enter name..."
                        autoFocus
                        onKeyDown={(e) => e.key === 'Enter' && saveContactName()}
                      />
                      <button onClick={saveContactName} className="text-primary hover:text-white">
                        <Check size={16} />
                      </button>
                      <button onClick={() => setIsEditingName(false)} className="text-red-500 hover:text-white">
                        <X size={16} />
                      </button>
                    </div>
                  ) : (
                    <h2 className="font-bold text-white flex items-center gap-2 group cursor-pointer" onClick={startEditingName}>
                      {formatDisplayNumber(activeChat.id)}
                      {activeChat.status === 'secure' && <Lock size={14} className="text-primary" />}
                      <Edit2 size={12} className="opacity-0 group-hover:opacity-50 transition-opacity text-gray-400" />
                    </h2>
                  )}
                </div>
                <p className="text-[10px] text-gray-500 font-mono uppercase tracking-widest flex items-center gap-2">
                  {activeChat.status === 'secure' ? 'ENCRYPTED CHANNEL' : activeChat.status}
                  {(activeChat.status === 'disconnected' || activeChat.status === 'offline') && (
                    <button 
                      onClick={() => reconnectToChat(activeChat.id)}
                      className="text-primary hover:text-white transition-colors"
                      title="Reconnect"
                    >
                      <RefreshCw size={12} />
                    </button>
                  )}
                </p>
              </div>
              
              {activeChat.status === 'secure' && (
                <button 
                  onClick={startCall}
                  className="p-2 bg-white/5 text-primary rounded-full hover:bg-primary hover:text-black transition-all"
                  title="Call"
                >
                  <Phone size={20} />
                </button>
              )}
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
                    ) : msg.content.type === 'audio' ? (
                        <div className="min-w-[200px] py-1">
                            <audio controls src={msg.content.content} className="w-full h-8 max-w-[240px]" />
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
                {isRecording ? (
                  <div className="flex-1 flex items-center gap-4 bg-red-500/10 border border-red-500/20 rounded-xl px-4 py-3 animate-in fade-in duration-200">
                    <div className="w-3 h-3 rounded-full bg-red-500 animate-pulse shadow-[0_0_10px_rgba(239,68,68,0.5)]" />
                    <span className="font-mono text-red-500 text-sm font-bold tracking-wider min-w-[40px]">{formatTime(recordingTime)}</span>
                    
                    <div className="flex-1 h-8 flex items-center justify-center overflow-hidden mx-2">
                      <canvas ref={canvasRef} width={200} height={32} className="w-full h-full" />
                    </div>

                    <button 
                      onClick={cancelRecording}
                      className="p-2 text-red-500 hover:bg-red-500/20 rounded-lg transition-colors mr-2"
                      title="Cancel Recording"
                    >
                      <Trash2 size={18} />
                    </button>

                    <button 
                      onClick={stopRecording}
                      className="p-2 bg-red-500 text-white rounded-lg hover:bg-red-600 transition-colors shadow-lg"
                      title="Send Recording"
                    >
                      <Send size={16} fill="currentColor" />
                    </button>
                  </div>
                ) : (
                  <>
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
                    
                    {inputValue.trim() ? (
                      <button
                        onClick={() => sendMessage()}
                        disabled={activeChat.status !== 'secure'}
                        className="p-3 bg-primary text-black rounded-xl hover:bg-[#00cc6a] disabled:opacity-50 transition-all"
                      >
                        <Send size={20} />
                      </button>
                    ) : (
                      <button
                        onClick={startRecording}
                        disabled={activeChat.status !== 'secure'}
                        className="p-3 bg-white/5 text-gray-400 rounded-xl hover:bg-white/10 hover:text-white disabled:opacity-50 transition-all"
                        title="Record Voice Message"
                      >
                        <Mic size={20} />
                      </button>
                    )}
                  </>
                )}
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

      {/* Incoming Call Modal */}
      {incomingCall && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm animate-in fade-in duration-300">
          <div className="bg-gray-900 border border-white/10 p-8 rounded-2xl shadow-2xl flex flex-col items-center space-y-6 max-w-sm w-full mx-4">
            <div className="w-24 h-24 rounded-full bg-primary/20 flex items-center justify-center animate-pulse">
              <PhoneIncoming size={48} className="text-primary" />
            </div>
            <div className="text-center">
              <h3 className="text-xl font-bold text-white mb-1">{formatDisplayNumber(incomingCall.peerId)}</h3>
              <p className="text-gray-400 font-mono text-sm">Incoming Secure Call...</p>
            </div>
            <div className="flex gap-4 w-full">
              <button 
                onClick={rejectCall}
                className="flex-1 py-3 bg-red-500/20 text-red-500 rounded-xl hover:bg-red-500 hover:text-white transition-all flex items-center justify-center gap-2 font-bold"
              >
                <PhoneOff size={20} /> Decline
              </button>
              <button 
                onClick={answerCall}
                className="flex-1 py-3 bg-primary text-black rounded-xl hover:bg-[#00cc6a] transition-all flex items-center justify-center gap-2 font-bold shadow-[0_0_20px_rgba(0,255,136,0.3)]"
              >
                <Phone size={20} /> Answer
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Active Call Overlay */}
      {(activeCall || callStatus === 'calling') && (
        <div className="absolute top-4 right-4 z-50 bg-gray-900 border border-white/10 p-4 rounded-2xl shadow-2xl flex flex-col items-center space-y-4 w-64 animate-in slide-in-from-top-4 duration-300">
          <div className="flex items-center gap-3 w-full">
            <div className="w-10 h-10 rounded-full bg-white/5 flex items-center justify-center">
              <User size={20} className="text-gray-400" />
            </div>
            <div className="flex-1 min-w-0">
              <h4 className="font-bold text-white text-sm truncate">
                {activeCall ? formatDisplayNumber(activeCall.peer) : formatDisplayNumber(activeChatId)}
              </h4>
              <p className="text-xs text-primary font-mono animate-pulse">
                {callStatus === 'calling' ? 'Calling...' : 'Connected'}
              </p>
            </div>
          </div>
          
          <div className="flex gap-2 w-full">
            <button 
              onClick={toggleMute}
              className={`flex-1 p-3 rounded-xl transition-all flex items-center justify-center ${isMuted ? 'bg-white/20 text-white' : 'bg-white/5 text-gray-400 hover:bg-white/10 hover:text-white'}`}
            >
              {isMuted ? <MicOff size={20} /> : <Mic size={20} />}
            </button>
            <button 
              onClick={endCall}
              className="flex-1 p-3 bg-red-500 text-white rounded-xl hover:bg-red-600 transition-all flex items-center justify-center shadow-lg"
            >
              <PhoneOff size={20} />
            </button>
          </div>
        </div>
      )}

      <audio ref={remoteAudioRef} className="hidden" />
    </div>
  );
}
