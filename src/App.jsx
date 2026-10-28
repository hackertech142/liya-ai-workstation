import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useOllama } from './hooks/useOllama';
import { useScheduler } from './hooks/useScheduler';
import { classifyPrompt, getRoutedModel } from './utils/router';
import { initMCPTools, tools } from './utils/toolRegistry';
import Sidebar from './components/Sidebar';
import Header from './components/Header';
import { motion as Motion } from 'framer-motion';
import ChatInput from './components/ChatInput';
import CameraCapture from './components/CameraCapture'; // NEW: Camera Component
import Message from './components/Message';
import NewsControl from './components/NewsControl';       // NEW
import WeatherControl from './components/WeatherControl'; // NEW
import CurrencyControl from './components/CurrencyControl'; // NEW

import SettingsControl from './components/SettingsControl'; // NEW: Settings Module
import SystemControl from './components/SystemControl'; // NEW: System Control Hub
import FaceSwapControl from './components/FaceSwapControl';


import TechAnimation from './components/TechAnimation'; // Restored
import {
  Send, Square, Plus, MessageSquare,
  Settings, User, Terminal, Cpu, Zap, Home, Paperclip, X, Star, ChevronDown, ChevronRight, ListTodo, Shield,
  Newspaper, CloudSun, CloudRain, CloudSnow, Sun, Cloud, CloudLightning,
  CircleDollarSign, Globe, Camera, ShieldCheck, ShieldAlert, Mic, MicOff,
  Video, Brain, Trash2, Layout, Sparkles
} from 'lucide-react';
import Canvas from './components/Canvas';
import { getSocket } from './utils/socket';
import { toPng } from 'html-to-image';

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || 'http://localhost:3000';

import { speakText, stopSpeech } from './utils/speechUtils';
import { clearBlackboard } from './utils/agents/blackboard';
import { getAllSessions, saveSession, deleteSessionFromDB, getStorageStats, clearAllSessions } from './utils/db';
import { config } from './utils/config';
import { memoryManager } from './utils/MemoryManager';

function App() {
  /* Mood State: Default Cyan */
  const [moodColor, setMoodColor] = useState('#00f3ff');
  const USER_NAME = config.getUserName();
  const APP_NAME = config.getAppName();

  const [sessions, setSessions] = useState([]);
  const [isStorageReady, setIsStorageReady] = useState(false);
  const [storageStats, setStorageStats] = useState({ usage: 0, quota: 0 });

  const refreshStorageStats = useCallback(async () => {
    const stats = await getStorageStats();
    setStorageStats(stats);
  }, []);

  const [skills, setSkills] = useState([]);
  const [skillCount, setSkillCount] = useState(0);

  // HYDRATE SESSIONS FROM INDEXEDDB + MIGRATION
  useEffect(() => {
    const hydrate = async () => {
      let dbSessions = await getAllSessions();
      const legacySaved = localStorage.getItem('LIYA_SESSIONS');

      if (legacySaved && dbSessions.length === 0) {
        console.log("Migrating legacy localStorage sessions to IndexedDB...");
        const legacySessions = JSON.parse(legacySaved);
        for (const s of legacySessions) {
          await saveSession(s);
        }
        dbSessions = await getAllSessions();
        localStorage.removeItem('LIYA_SESSIONS');
      }

      // Cleanup empty initial sessions
      const filtered = dbSessions.filter(s => s.messages.some(m => m.role === 'user'));

      const isSessionStarted = sessionStorage.getItem('LIYA_SESSION_STARTED');
      const lastSessionId = localStorage.getItem('LIYA_LAST_SESSION_ID');

      if (isSessionStarted && lastSessionId && dbSessions.some(s => s.id === lastSessionId)) {
        setSessions(dbSessions.length > 0 ? dbSessions : [{
          id: Date.now().toString(),
          title: 'New Chat',
          messages: [{ role: 'assistant', content: `SYSTEM ONLINE. ${config.getAppName()} Protocol v3.0 initialized. Ready for input.` }],
          updatedAt: Date.now()
        }]);
        setCurrentSessionId(lastSessionId);
      } else {
        sessionStorage.setItem('LIYA_SESSION_STARTED', 'true');
        const newSession = {
          id: Date.now().toString(),
          title: 'New Chat',
          messages: [{ role: 'assistant', content: `SYSTEM ONLINE. ${config.getAppName()} Protocol v3.0 initialized. Ready for input.` }],
          updatedAt: Date.now()
        };
        localStorage.setItem('LIYA_LAST_SESSION_ID', newSession.id);
        setSessions([newSession, ...filtered]);
        setCurrentSessionId(newSession.id);
      }

      setIsStorageReady(true);
      await refreshStorageStats();

      // Fetch Skill Hub Data
      try {
        const res = await fetch(`${BACKEND_URL}/api/skills/index`);
        if (res.ok) {
          const data = await res.json();
          const skillsList = data.skills || [];
          setSkills(skillsList);
          setSkillCount(skillsList.length);
        }
      } catch (e) { console.warn("Failed to fetch skills index", e); }
    };
    hydrate();
  }, [refreshStorageStats]);

  const [currentSessionId, setCurrentSessionId] = useState(null);
  const [activeMessages, setActiveMessages] = useState([]);
  const [isSyncing, setIsSyncing] = useState(false);

  // Sync activeMessages when currentSessionId changes
  useEffect(() => {
    if (currentSessionId) {
      const session = sessions.find(s => s.id === currentSessionId);
      if (session) {
        setActiveMessages(session.messages || []);
      }
    }
  }, [currentSessionId]);

  const messages = activeMessages;

  // Optimized setMessages for streaming (Updated to 100-msg limit)
  const setMessages = useCallback((updater) => {
    setActiveMessages(prev => {
      const next = typeof updater === 'function' ? updater(prev) : updater;
      // Keep last 100 messages for better context and to prevent photo pruning
      return next.length > 100 ? next.slice(-100) : next;
    });
  }, []);

  // Persistent Save (Debounced/Throttled)
  const syncActiveSessionToDB = useCallback(async (msgs = activeMessages) => {
    if (!currentSessionId || isSyncing) return;
    setIsSyncing(true);
    try {
      const trimmed = msgs.length > 100 ? msgs.slice(-100) : msgs;
      setSessions(prev => prev.map(s => {
        if (s.id === currentSessionId) {
          let newTitle = s.title;
          if (s.title === 'New Chat') {
            const firstUserMsg = trimmed.find(m => m.role === 'user');
            if (firstUserMsg) {
              newTitle = firstUserMsg.content.slice(0, 30) + (firstUserMsg.content.length > 30 ? '...' : '');
            }
          }
          const updated = { ...s, messages: trimmed, title: newTitle, updatedAt: Date.now() };
          saveSession(updated).then(() => refreshStorageStats()).catch(console.error);
          return updated;
        }
        return s;
      })
      );
    } finally {
      setIsSyncing(false);
    }
  }, [currentSessionId, activeMessages, isSyncing, refreshStorageStats]);

  // Use this for major changes or end-of-stream
  useEffect(() => {
    const timer = setTimeout(() => {
      if (activeMessages.length > 0) {
        syncActiveSessionToDB(activeMessages);
      }
    }, 5000); // Debounce DB writes by 5 sec
    return () => clearTimeout(timer);
  }, [activeMessages, syncActiveSessionToDB]);
  const [input, setInput] = useState('');
  const [selectedImage, setSelectedImage] = useState(null); // Base64 image
  const [selectedPDF, setSelectedPDF] = useState(null); // { name: string, content: string }
  const [showCamera, setShowCamera] = useState(false); // Camera Modal State
  const [activeModule, setActiveModule] = useState('chat');
  const [weatherData, setWeatherData] = useState(null); // Global weather state for Header Icon
  const [isListening, setIsListening] = useState(false); // Voice Input State
  const [aiState, setAiState] = useState('idle'); // 'idle', 'thinking', 'speaking'
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false); // Mobile Sidebar State
  const [isStarOpen, setStarOpen] = useState(() => {
    return localStorage.getItem('LIYA_STAR_SIDEBAR_OPEN') === 'true';
  });
  useEffect(() => {
    localStorage.setItem('LIYA_STAR_SIDEBAR_OPEN', isStarOpen);
  }, [isStarOpen]);
  const [hasNotification, setHasNotification] = useState(false);
  // NEW: Badge for finished tasks
  const [backgroundTasks, setBackgroundTasks] = useState([]); // NEW: Background Task Tracking
  const cancelTokensRef = useRef({}); // NEW: Task cancellation tracking
  const runningTasksRef = useRef(new Set()); // Track running task names for deduplication
  const [isPicoMode, setIsPicoMode] = useState(() => {
    return localStorage.getItem('LIYA_PICO_MODE') === 'true';
  });

  const [theme, setTheme] = useState('light');

  useEffect(() => {
    localStorage.setItem('LIYA_THEME', 'light');
    document.documentElement.classList.remove('dark');
  }, []);



  // Liya-A2UI Bridge: Global UI state for real-time updates
  const [uiState, setUiState] = useState({
    system: { cpu: 0, latency: 0, status: 'online' },
    activeSkills: [],
    lastAction: null
  });
  const [isCanvasVisible, setIsCanvasVisible] = useState(false);

  useEffect(() => {
    document.title = APP_NAME.toLowerCase();
  }, [APP_NAME]);

  useEffect(() => {
    const handleGlobalAction = (event) => {
      if (event.detail?.type === 'UI_UPDATE') {
        setUiState(prev => ({ ...prev, ...event.detail.data }));
      }
    };
    window.addEventListener('liya-ui-update', handleGlobalAction);
    return () => window.removeEventListener('liya-ui-update', handleGlobalAction);
  }, []);

  // CANVAS ACTION BRIDGE
  useEffect(() => {
    const socket = getSocket();
    socket.on('canvas-action', (data) => {
      console.log("🎮 Canvas Action Received:", data);
      if (data.payload?.prompt) {
        setInput(data.payload.prompt);
        if (data.payload.autoSubmit) {
          setTimeout(() => {
            window.dispatchEvent(new CustomEvent('canvas-auto-submit', { detail: data.payload.prompt }));
          }, 100);
        }
      }
    });
    socket.on('chat-message', (data) => {
      console.log("💬 Chat Message Received:", data);
      setMessages(prev => [...prev, data]);
      setActiveModule('chat');
    });
    socket.on('system-stats', (data) => {
      setUiState(prev => ({
        ...prev,
        system: {
          ...prev.system,
          cpu: data.cpu,
          ram: data.ram,
          uptime: data.uptime,
          latency: data.latency,
          status: 'online'
        }
      }));
    });
    return () => {
      socket.off('canvas-action');
      socket.off('chat-message');
      socket.off('system-stats');
    };
  }, [setMessages]);
  useEffect(() => {
    localStorage.setItem('LIYA_PICO_MODE', isPicoMode);
  }, [isPicoMode]);

  const [automationQueue, setAutomationQueue] = useState([]);
  const [taskHistory, setTaskHistory] = useState(() => {
    const userId = config.getUserName();
    const saved = localStorage.getItem(`LIYA_TASK_HISTORY_${userId}`);
    return saved ? JSON.parse(saved) : [];
  }); // NEW: Persistent log of completed/failed background tasks
  const chatContainerRef = useRef(null); // Ref for the scrolling container
  const messagesRef = useRef(messages);
  const currentSessionIdRef = useRef(currentSessionId);
  useEffect(() => {
    messagesRef.current = messages;
    currentSessionIdRef.current = currentSessionId;
  }, [messages, currentSessionId]);

  // High Performance Streaming Refs
  const { chat, isPlaying, stop, error, warmup } = useOllama();
  const messagesEndRef = useRef(null);

  // Initial Warmup & ASCII Art & MCP Init
  useEffect(() => {
    warmup();
    initMCPTools();

    // Sync settings from backend into localStorage on startup
    fetch(`${BACKEND_URL}/api/settings`)
      .then(res => res.ok ? res.json() : null)
      .then(data => {
        if (data && data.settings) {
          const s = data.settings;
          if (s.OLLAMA_FAST_MODEL) localStorage.setItem('OLLAMA_FAST_MODEL', s.OLLAMA_FAST_MODEL);
          if (s.OLLAMA_SMART_MODEL) localStorage.setItem('OLLAMA_SMART_MODEL', s.OLLAMA_SMART_MODEL);
          if (s.CODER_MODEL) localStorage.setItem('CODER_MODEL', s.CODER_MODEL);
          if (s.OLLAMA_VISION_MODEL) localStorage.setItem('OLLAMA_VISION_MODEL', s.OLLAMA_VISION_MODEL);
        }
      })
      .catch(() => {});

    // Theme Injection from LocalStorage
    const storedTheme = localStorage.getItem('APP_THEME');
    if (storedTheme) {
      document.documentElement.style.setProperty('--primary', storedTheme);
      // We also need to override the color manually for Tailwind classes if they are hardcoded
      // But better: Add a global style tag dynamically
      // Remove old injected theme style if exists
      const existingStyle = document.getElementById('liya-theme-override');
      if (existingStyle) existingStyle.remove();
      const style = document.createElement('style');
      style.id = 'liya-theme-override';
      style.innerHTML = `
            :root { --primary: ${storedTheme}; }
            .text-\\[\\#00f3ff\\], .text-accent-blue { color: var(--primary)!important; }
            .border-\\[\\#00f3ff\\], .border-accent-blue { border-color: var(--primary)!important; }
            .bg-\\[\\#00f3ff\\], .bg-accent-blue { background-color: var(--primary)!important; }
            .from-\\[\\#00f3ff\\], .from-accent-blue { --tw-gradient-from: var(--primary)!important; --tw-gradient-stops: var(--tw-gradient-from), var(--tw-gradient-to)!important; }
            .to-\\[\\#00f3ff\\], .to-accent-blue { --tw-gradient-to: var(--primary)!important; }
`;
      document.head.appendChild(style);
      setMoodColor(storedTheme);
    }

    // Fetch ASCII Art for Branding (Lazy Load)
    import('./utils/ascii').then(module => {
      module.fetchASCII(APP_NAME).then(art => {
        if (art) {
          setMessages(prev => {
            if (prev.length === 1 && prev[0].content.includes("SYSTEM ONLINE")) {
              return [{ role: 'assistant', content: `SYSTEM ONLINE. ${APP_NAME} Tactical Co-Pilot initialized.\n${art} \nAll systems nominal, Boss. Ready for commands.` }];
            }
            return prev;
          });
        }
      });
    });

    // STARTUP LOGIC

  }, [warmup]);

  // Smart Auto-scroll
  useEffect(() => {
    const container = chatContainerRef.current;
    if (!container) return; // Guard for non-chat modules

    // Simple sticky logic: If close to bottom (within 100px), scroll down.
    // If user has scrolled up to read, DO NOT force them down.
    const isAtBottom = container.scrollHeight - container.scrollTop <= container.clientHeight + 150;

    if (isAtBottom) {
      // Use instant scroll for typing to avoid "smooth scroll lag", smooth for new messages could be nice but instant is safer for typing
      container.scrollTo({ top: container.scrollHeight, behavior: 'auto' });
    }
  }, [messages]);

  // LISTEN FOR SYSTEM EVENTS (Audit, Module Switch)
  const handleSubmitRef = useRef(null);
  useEffect(() => { handleSubmitRef.current = handleSubmit; });

  useEffect(() => {
    // 1. Module Switch Listener
    const handleModuleSwitch = (e) => {
      setActiveModule(e.detail);
    };

    // 2. Startup Check (Placeholder if needed)

    // 3. Canvas Auto-Submit Bridge — uses ref to avoid stale closure
    const handleAutoSubmit = (e) => {
      if (handleSubmitRef.current) {
        handleSubmitRef.current({ preventDefault: () => { } }, e.detail);
      }
    };

    window.addEventListener('SWITCH_MODULE', handleModuleSwitch);
    window.addEventListener('canvas-auto-submit', handleAutoSubmit);
    return () => {
      window.removeEventListener('SWITCH_MODULE', handleModuleSwitch);
      window.removeEventListener('canvas-auto-submit', handleAutoSubmit);
    };
  }, []);

  const takeSnapshot = useCallback(async (selector = '#app-root') => {
    const element = document.querySelector(selector) || document.body;
    try {
      // Capture the snapshot as a base64 string
      const dataUrl = await toPng(element, { quality: 0.95 });
      return dataUrl;
    } catch (error) {
      console.error("Snapshot Capture Error:", error);
      throw error;
    }
  }, []);

  // MCP Environment: Provide tools with access to UI capabilities
  const toolEnv = {
    setIsCanvasVisible,
    onOpenCamera: () => setShowCamera(true),
    takeSnapshot
  };
  // STOP SPEECH ON TYPE (Chupkase)
  // When user starts typing, stop LIYA from speaking
  useEffect(() => {
    if (input.length > 0) {
      stopSpeech();
    }
  }, [input]);

  // 1. CATCH-UP LOGIC & SMART SCHEDULER moved to useScheduler hook
  const handleAutomationTrigger = useCallback((task) => {
    console.log("⚡ Automation Triggered:", task);
    setActiveModule('chat');

    // Ensure we have a prompt. If toolRegistry is correct, task.prompt should exist.
    // Fallback to title just in case to avoid silent failure.
    const promptToUse = task.prompt || task.title || "Execute scheduled task";

    setAutomationQueue(prev => [
      ...prev,
      {
        prompt: promptToUse,
        title: task.title || 'Scheduled Task'
      }
    ]);
  }, []);

  const { automatedTasks, addScheduledTask, deleteScheduledTask } = useScheduler(handleAutomationTrigger);




  const handleScheduleAutomation = useCallback((task) => {
    addScheduledTask(task);
  }, [addScheduledTask]);

  // TASK SCHEDULER: Standard handling
  const handleDeleteAutomatedTask = (id) => {
    deleteScheduledTask(id);
  };

  const handleTaskStart = useCallback((id, name) => {
    console.log(`[App.jsx] handleTaskStart FIRED: id=${id}, name=${name}`);
    // 🔥 DEDUPLICATION: Use ref for synchronous check (setState is async)
    if (runningTasksRef.current.has(name)) {
      console.warn(`[Task Guard] Prevented duplicate execution for: ${name}`);
      throw new Error(`Task "${name}" is already running in the background.`);
    }

    runningTasksRef.current.add(name);
    cancelTokensRef.current[id] = false;
    setBackgroundTasks(prev => {
      if (prev.find(t => t.id === id)) return prev;
      console.log(`[App.jsx] Successfully added ${name} to backgroundTasks array`);
      return [...prev, { id, name, status: 'running', progress: 'Started...', logs: ['> Process initializing...'], timestamp: Date.now() }];
    });
  }, []);

  const handleTaskProgress = useCallback((id, progressMsg) => {
    setBackgroundTasks(prev => prev.map(t => {
      if (t.id === id) {
        // Only keep the last 50 logs to prevent memory bloat on very long tasks
        const newLogs = [...(t.logs || []), progressMsg].slice(-50);
        return { ...t, progress: progressMsg, logs: newLogs };
      }
      return t;
    }));
  }, []);

  const handleTaskComplete = useCallback((id, name, result, isError) => {
    console.log(`[App.jsx] handleTaskComplete FIRED: id=${id}, name=${name}, isError=${isError}`);
    console.log(`[App.jsx] Task Result length: ${result ? result.length : 0} chars`);

    const isCancelled = isError && result === 'Task was manually cancelled by user.';

    // Clean up running task ref
    runningTasksRef.current.delete(name);

    setBackgroundTasks(prev => {
      const updated = prev.map(t => {
        if (t.id === id) {
          if (t.status === 'cancelled' || isCancelled) {
            return { ...t, status: 'cancelled', result: 'Cancelled' };
          }
          const finalStatus = isError ? 'failed' : 'completed';
          return { ...t, status: finalStatus, result, completedAt: Date.now() };
        }
        return t;
      });

      // Cleanup finished tasks from active state after 5 seconds to avoid UI clutter & key collisions
      setTimeout(() => {
        setBackgroundTasks(current => current.filter(t => t.id !== id));
      }, 5000);

      return updated;
    });

    if (isCancelled) return; // Don't announce Cancellations

    // 🔥 FIX: Move side-effect state updates OUTSIDE the setBackgroundTasks functional updater
    setTaskHistory(prevHistory => {
      const alreadyExists = prevHistory.some(h => h.id === id);
      if (alreadyExists) return prevHistory;

      const finalStatus = isError ? 'failed' : 'completed';
      const completedTask = { id, name, status: finalStatus, result, completedAt: Date.now() };
      const next = [completedTask, ...prevHistory].slice(0, 50);

      const userId = config.getUserName();
      localStorage.setItem(`LIYA_TASK_HISTORY_${userId}`, JSON.stringify(next));
      return next;
    });

    if (activeModule !== 'system') {
      const isChatInjected = (name === 'research' || name === 'movie_info' || name === 'image_gen' || name === 'web_scrape' || name === 'spawn');
      if (!isChatInjected) {
        setHasNotification(true);
      }
    }

    if (isCancelled) return; // Don't announce Cancellations

    // Set notification badge if not on system/tasks page
    // Inject system message
    const alertMsg = isError
      ? `❌ Background Task ** ${name}** failed.`
      : `✅ Background Task ** ${name}** completed successfully!`;

    // Inject memory safely using a timeout to prevent React 18 Concurrent Mode from swallowing it 
    setTimeout(() => {
      // 🔊 Side-effects MUST be outside the React state updater function
      if (name === 'spawn' && !isError) {
        const storedAutoSpeak = localStorage.getItem('AUTO_SPEAK') === 'true';
        if (storedAutoSpeak) {
          const storedVoice = localStorage.getItem('PREFERRED_VOICE');
          speakText("Navraj ji, meri deep research complete ho chuki hai aur main report chat mein bhej rahi hoon.", storedVoice);
        }
      }

      setMessages(prev => {
        // Clean UI for Research/AI generated content
        const isResearchTask = (name === 'research' || name === 'movie_info' || name === 'image_gen' || name === 'web_scrape');

        if (isResearchTask) {
          if (isError) {
            return [...prev, { role: 'system', content: `[SYSTEM NOTIFICATION: ${alertMsg}]\n\n(Task Output: ${result})` }];
          }
          // Direct answer as requested by user
          return [...prev, { role: 'assistant', content: result }];
        }

        // We explicitly skip 'spawn' here because it is now injecting via the nuclear bypass raw websocket (onMessageDirect)
        if (name === 'spawn') return prev;

        // Default UI for technical/system background tasks Home Automation etc.
        const icon = isError ? '❌' : '✅';
        const formattedName = name.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
        return [...prev, { role: 'system', content: `${icon} **${formattedName}**\n\n${result}` }];
      });
    }, 500);

    // Notification voice logic removed as it's redundant when Liya replies in chat
  }, [activeModule]);

  const handleClearHistory = useCallback(() => {
    setTaskHistory([]);
    const userId = config.getUserName();
    localStorage.removeItem(`LIYA_TASK_HISTORY_${userId}`);
  }, []);

  const processPrompt = useCallback(async (action) => {
    // Action can be a string (user input) or { prompt: string, title?: string } for automated tasks
    const promptText = typeof action === 'string' ? action : action.prompt;
    const title = typeof action === 'object' ? action.title : null;

    stopSpeech();
    setInput('');
    setActiveModule('chat');

    const classification = classifyPrompt(promptText);
    const routedModel = getRoutedModel(classification);
    const routedReasoning = classification === 'smart' ? 'high' : 'low';

    // --- QUICK ACTION HANDLER (INTERNAL) ---
    if (promptText.startsWith('[INTERNAL]')) {
      const command = promptText.replace('[INTERNAL]', '').trim().toLowerCase();

      if (command === 'clear logs') {
        handleClearHistory();
        setMessages(prev => [...prev, { role: 'system', content: '✅ Task history and system logs cleared.' }]);
        return;
      }
      if (command === 'refresh ui') {
        setMessages(prev => [...prev, { role: 'system', content: '🔄 Refreshing system interface...' }]);
        setTimeout(() => window.location.reload(), 1000);
        return;
      }
      if (command === 'reset assistant') {
        setMessages([{ role: 'assistant', content: `SYSTEM REBOOT COMPLETE. Memory buffers cleared. Ready for input.` }]);
        return;
      }
      if (command === 'purge memory') {
        handleClearHistory(); // Clears logs
        clearBlackboard(); // Clears blackboard
        try {
          await memoryManager.clearAll();
          console.log('[SystemPurge] Mem0 memory history cleared successfully.');
        } catch (memErr) {
          console.warn('[SystemPurge] Failed to clear Mem0 memory:', memErr);
        }
        fetch(`${BACKEND_URL}/api/system/purge`, { method: 'POST' })
          .then(() => clearAllSessions())
          .then(() => {
            localStorage.removeItem('LIYA_LAST_SESSION_ID');
            window.location.reload();
          })
          .catch(err => {
            console.error('Failed to purge backend system memory:', err);
            clearAllSessions().then(() => {
              localStorage.removeItem('LIYA_LAST_SESSION_ID');
              window.location.reload();
            });
          });
        return;
      }
      if (command === 'clear blackboard') {
        const success = await clearBlackboard();
        setMessages(prev => [...prev, { role: 'system', content: success ? '✅ Project blackboard cleared successfully.' : '❌ Failed to clear blackboard.' }]);
        return;
      }

      if (command === 'deep cleanup' || command === 'wipe data') {
        if (window.confirm("CRITICAL: Deep Nuclear Cleanup will wipe ALL sessions and local data. Are you absolutely sure?")) {
          clearAllSessions().then(() => {
            localStorage.clear();
            window.location.reload();
          });
        }
        return;
      }
    } else if (promptText.toLowerCase() === '/deep-cleanup' || promptText.toLowerCase() === '/wipe') {
      if (window.confirm("CRITICAL: Deep Nuclear Cleanup will wipe ALL sessions and local data. Are you absolutely sure?")) {
        clearAllSessions().then(() => {
          localStorage.clear();
          window.location.reload();
        });
      }
      return;
    }

    setAiState('thinking');

    // Use Ref for latest context to avoid closure staleness
    const currentMsgs = messagesRef.current;
    const triggerMsg = {
      role: 'user',
      content: title ? `[AUTOMATED ACTION: ${title}]: ${promptText}` : `[AUTOMATED ACTION]: ${promptText}`
    };

    // Update UI and state
    setMessages(prev => [...prev, triggerMsg, { role: 'assistant', content: '' }]);

    const activeSessionAtStart = currentSessionIdRef.current;

    // Call chat() using the latest derived messages
    const chatPromise = chat([...currentMsgs, triggerMsg], (chunk) => {
      if (currentSessionIdRef.current !== activeSessionAtStart) return;
      console.log("Chunk Received:", chunk); // Diagnostic logging
      setMessages(p => {
        const ns = [...p];
        let lastIdx = -1;
        for (let i = ns.length - 1; i >= 0; i--) {
          if (ns[i].role === 'assistant') { lastIdx = i; break; }
        }
        if (lastIdx >= 0) {
          let nc = (ns[lastIdx].content || '') + chunk;


          const mm = nc.match(/[[<]MOOD:\s*([a-z]+)(?:]|>)/i);
          if (mm) {
            const mood = mm[1].toUpperCase();
            if (mood === 'HAPPY') setMoodColor('#00f3ff');
            if (mood === 'ANGRY') setMoodColor('#ff003c');
            if (mood === 'LOVE') setMoodColor('#ff00aa');
            if (mood === 'SAD') setMoodColor('#4a90e2');
            nc = nc.replace(/[[<]MOOD:\s*[a-z]+(?:]|>)/gi, '');
          }
          ns[lastIdx] = { ...ns[lastIdx], content: nc };
          return ns;
        }
        return p;
      });
    }, () => {
      if (currentSessionIdRef.current !== activeSessionAtStart) return;
      setAiState('idle');
      syncActiveSessionToDB(); // Sync to DB on done
      setMessages(p => {
        const ns = [...p];
        let lastIdx = -1;
        for (let i = ns.length - 1; i >= 0; i--) {
          if (ns[i].role === 'assistant') { lastIdx = i; break; }
        }
        if (lastIdx >= 0) {
          if (!ns[lastIdx].content || !ns[lastIdx].content.trim()) {
            console.warn("⚠️ Automation stream empty for:", promptText);
            ns[lastIdx].content = `⚠️ Maaf kijiye ${USER_NAME}, mujhe automation action perform karne mein dikat aa rahi hai. (Empty Cloud Response)`;
          }
        }
        return ns;
      });
    }, (isThinking) => {
      if (isThinking) setAiState('thinking');
    }, {
      onTaskStart: handleTaskStart,
      onTaskProgress: handleTaskProgress,
      onTaskComplete: handleTaskComplete,
      onScheduleAutomation: handleScheduleAutomation,
      onOpenCamera: () => setShowCamera(true),
      ...toolEnv,
      model: routedModel,
      reasoningEffort: routedReasoning
    });

    await chatPromise;
  }, [messages, chat, handleTaskStart, handleTaskProgress, handleTaskComplete, handleScheduleAutomation, handleClearHistory]);

  const handleInternalPrompt = useCallback(async (text) => {
    processPrompt(text);
  }, [processPrompt]);

  const isProcessingRef = useRef(false);

  // QUEUE PROCESSOR
  useEffect(() => {
    if (!isPlaying && !isProcessingRef.current && automationQueue.length > 0) {
      isProcessingRef.current = true;
      const nextTask = automationQueue[0];
      console.log("🔄 Processing Automation Queue Item:", nextTask);
      setAutomationQueue(prev => prev.slice(1));

      processPrompt(nextTask).finally(() => {
        console.log("✅ Finished Processing Automation Item:", nextTask);
        isProcessingRef.current = false;
      });
    }
  }, [isPlaying, automationQueue, processPrompt]);

  const handleManualAction = useCallback((promptText) => {
    setActiveModule('chat');
    handleInternalPrompt(promptText);
  }, [handleInternalPrompt]);

  const handleNewChat = useCallback(() => {
    const newSession = {
      id: Date.now().toString(),
      title: 'New Chat',
      messages: [{ role: 'assistant', content: `SYSTEM ONLINE. ${APP_NAME} Protocol v3.0 initialized. Ready for input.` }],
      updatedAt: Date.now()
    };
    saveSession(newSession).then(() => refreshStorageStats()).catch(console.error);
    setSessions(prev => [newSession, ...prev]);
    setCurrentSessionId(newSession.id);

    // RESET CANVAS ON NEW CHAT
    fetch(`${BACKEND_URL}/api/canvas/reset`, { method: 'POST' }).catch(() => { });
    setIsCanvasVisible(false);
  }, [refreshStorageStats]);

  const handleDeleteSession = useCallback((id) => {
    deleteSessionFromDB(id).then(() => refreshStorageStats()).catch(console.error);
    setSessions(prev => {
      const filtered = prev.filter(s => s.id !== id);
      if (filtered.length === 0) {
        return [{
          id: Date.now().toString(),
          title: 'New Chat',
          messages: [{ role: 'assistant', content: `SYSTEM ONLINE. ${APP_NAME} Protocol v3.0 initialized. Ready for input.` }],
          updatedAt: Date.now()
        }];
      }
      return filtered;
    });
    if (currentSessionId === id) {
      setSessions(current => {
        const remaining = current.filter(s => s.id !== id);
        if (remaining.length > 0) setCurrentSessionId(remaining[0].id);
        return current; // Don't modify here, already modified above
      });
    }
  }, [currentSessionId, refreshStorageStats]);

  const handleRenameSession = useCallback((id, newTitle) => {
    setSessions(prev => prev.map(s => s.id === id ? { ...s, title: newTitle } : s));
  }, []);

  const handleCancelTask = useCallback((id) => {
    cancelTokensRef.current[id] = true;
    setBackgroundTasks(prev => prev.map(t =>
      t.id === id ? { ...t, status: 'cancelled', progress: 'Cancellation requested...' } : t
    ));
  }, []);

  const triggerAutoSpeak = (text) => {
    const storedAutoSpeak = localStorage.getItem('AUTO_SPEAK') === 'true';
    if (storedAutoSpeak) {
      const storedVoice = localStorage.getItem('PREFERRED_VOICE');
      speakText(text, storedVoice,
        () => setAiState('idle'),
        () => setAiState('speaking')
      );
    }
  };

  const runImageFallback = async (userPrompt) => {
    setAiState('thinking');

    // Extract prompt subject: clean query of filler words
    const subject = userPrompt
      .replace(/\b(generate|image|images|photo|photos|picture|pictures|pics|pic|wallpaper|wallpapers|of|draw|show|me|a|paint|create|dikhao|dikhana|bhejo|bhejiye|mujhe|chahiye|ki|ka|ke|karo)\b/gi, '')
      .trim() || userPrompt;

    let assistantIndex = -1;
    setMessages(prev => {
      const next = [...prev];
      for (let i = next.length - 1; i >= 0; i--) {
        if (next[i].role === 'assistant') {
          assistantIndex = i;
          break;
        }
      }
      if (assistantIndex >= 0) {
        next[assistantIndex].content = `🔍 (Direct fallback search) Dhoondh rahi hoon: "${subject}" ki photo...`;
      }
      return next;
    });

    // Wait a brief moment for state to update
    await new Promise(resolve => setTimeout(resolve, 50));

    // Helper to find and update the index dynamically
    const updateAssistantMessage = (content) => {
      let updated = [];
      setMessages(prev => {
        const next = [...prev];
        let idx = -1;
        for (let i = next.length - 1; i >= 0; i--) {
          if (next[i].role === 'assistant') {
            idx = i;
            break;
          }
        }
        if (idx >= 0) {
          next[idx].content = content;
        }
        updated = next;
        return next;
      });
      return updated;
    };

    try {
      // 1. Try Google Image Scraper
      const response = await fetch(`${BACKEND_URL}/api/scrape/image`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: subject })
      });
      const data = await response.json();

      if (data.urls && data.urls.length > 0) {
        const imageTags = data.urls.map((url, idx) => `[DIRECT_IMAGE:${url}|Image Search: ${subject} (${idx + 1})]`).join('\n');
        const updatedMsgs = updateAssistantMessage(`${imageTags}\n\nYe lijiye, direct search se mujhe "${subject}" ki photos mil gayi hain!`);
        triggerAutoSpeak(`direct search se mujhe ${subject} ki photos mil gayi hain.`);
        setAiState('idle');
        syncActiveSessionToDB(updatedMsgs);
        return;
      }
    } catch (e) {
      console.warn("Direct Google Scrape Fallback failed:", e);
    }

    // 2. Try Wikipedia Image Search Fallback
    try {
      const { fetchWikiImage } = await import('./utils/research');
      const wikiResult = await fetchWikiImage(subject);

      if (wikiResult && !wikiResult.includes('No photo found') && !wikiResult.includes('❌')) {
        const updatedMsgs = updateAssistantMessage(`${wikiResult}\n\nYe lijiye, Wikipedia fallback se mujhe "${subject}" ki photo mil gayi hai!`);
        triggerAutoSpeak(`Wikipedia fallback se mujhe ${subject} ki photo mil gayi hai.`);
        setAiState('idle');
        syncActiveSessionToDB(updatedMsgs);
        return;
      }
    } catch (e) {
      console.warn("Wikipedia Image Fallback failed:", e);
    }

    // If both failed
    const finalFailedMsgs = updateAssistantMessage(`❌ Maine Google aur Wikipedia dono par koshish ki, lekin "${subject}" ki koi photo nahi mil saki.`);
    triggerAutoSpeak(`Maine Google aur Wikipedia dono par koshish ki, lekin ${subject} ki koi photo nahi mil saki.`);
    setAiState('idle');
    syncActiveSessionToDB(finalFailedMsgs);
  };

  const handleSubmit = async (e, manualPrompt) => {
    e?.preventDefault();
    stopSpeech(); // Stop Liya if she is speaking when user sends a new message
    const promptToUse = manualPrompt !== undefined ? manualPrompt : input;
    if ((!promptToUse.trim() && !selectedImage && !selectedPDF) || isPlaying) return;

    // Direct Image Bypass Command (/image [query] or /img [query])
    if (promptToUse.toLowerCase().startsWith('/img ') || promptToUse.toLowerCase().startsWith('/image ')) {
      const searchQuery = promptToUse.substring(promptToUse.indexOf(' ') + 1).trim();
      if (searchQuery) {
        setInput('');
        setMessages(prev => [...prev,
        { role: 'user', content: promptToUse },
        { role: 'assistant', content: `🔍 Searching images directly for: "${searchQuery}"...` }
        ]);
        setAiState('thinking');
        try {
          const res = await fetch(`${BACKEND_URL}/api/scrape/image`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ query: searchQuery })
          });
          const data = await res.json();
          if (data.urls && data.urls.length > 0) {
            const imageTags = data.urls.map((url, idx) => `[DIRECT_IMAGE:${url}|Google Search: ${searchQuery} (${idx + 1})]`).join('\n');
            setMessages(prev => {
              const next = [...prev];
              next[next.length - 1] = {
                role: 'assistant',
                content: `Here are the top images for **"${searchQuery}"**:\n\n${imageTags}`
              };
              return next;
            });
          } else {
            setMessages(prev => {
              const next = [...prev];
              next[next.length - 1] = { role: 'assistant', content: `❌ No images found for "${searchQuery}".` };
              return next;
            });
          }
        } catch (err) {
          setMessages(prev => {
            const next = [...prev];
            next[next.length - 1] = { role: 'assistant', content: `❌ Failed to fetch images: ${err.message}` };
            return next;
          });
        }
        setAiState('idle');
        return;
      }
    }

    // AUTO-SWITCH to chat if interacting
    if (activeModule !== 'chat') {
      setActiveModule('chat');
    }

    // Build user message
    let contentParts = [promptToUse];

    // Inject PDF Context if exists
    if (selectedPDF) {
      contentParts.unshift(`[Document Context(${selectedPDF.name}): \n${selectedPDF.content} \n]`);
    }

    const finalContent = contentParts.join("\n\n");

    const userMsg = {
      role: 'user',
      content: finalContent,
      images: selectedImage ? [selectedImage] : undefined
    };

    setMessages(prev => [...prev, { role: 'user', content: promptToUse, images: selectedImage ? [selectedImage] : undefined, fileName: selectedPDF?.name }, { role: 'assistant', content: '' }]);
    setInput('');
    setSelectedImage(null);
    setSelectedPDF(null);

    // ⚡ PERFORMANCE FIX: Defer heavy AI logic to next tick to unblock UI
    setTimeout(async () => {
      setAiState('thinking');
      const activeSessionAtStart = currentSessionIdRef.current;
      let accumulatedResponse = "";

      await chat([...messages, userMsg], (chunk) => {
        if (currentSessionIdRef.current !== activeSessionAtStart) return;
        accumulatedResponse += chunk;
        setMessages(prev => {
          // Deep clone messages just in case
          const nextState = [...prev];
          let lastAssistantIndex = -1;
          for (let i = nextState.length - 1; i >= 0; i--) {
            if (nextState[i].role === 'assistant') {
              lastAssistantIndex = i;
              break;
            }
          }

          if (lastAssistantIndex >= 0) {
            let newContent = (nextState[lastAssistantIndex].content || '') + chunk;

            // EXTRACT MOOD
            const moodMatch = newContent.match(/[[<]MOOD:\s*([a-z]+)(?:]|>)/i);
            if (moodMatch) {
              const mood = moodMatch[1].toUpperCase();
              if (mood === 'HAPPY') setMoodColor('#00f3ff');
              if (mood === 'ANGRY') setMoodColor('#ff003c');
              if (mood === 'LOVE') setMoodColor('#ff00aa');
              if (mood === 'SAD') setMoodColor('#4a90e2');
              newContent = newContent.replace(/[[<]MOOD:\s*[a-z]+(?:]|>)/gi, '');
            }

            nextState[lastAssistantIndex] = { ...nextState[lastAssistantIndex], content: newContent };
            return nextState;
          }
          return prev;
        });
      }, () => {
        if (currentSessionIdRef.current !== activeSessionAtStart) return;
        setAiState('idle');
        syncActiveSessionToDB(); // Sync on done

        // --- AUTOMATIC MEM0 MEMORY INGESTION ---
        if (promptToUse && promptToUse.trim()) {
          memoryManager.add([
            { role: 'user', content: promptToUse },
            { role: 'assistant', content: accumulatedResponse || 'Responded to query.' }
          ]).then(res => {
            console.log('[Mem0] Automatic Memory Ingestion Completed:', res);
          }).catch(err => {
            console.warn('[Mem0] Memory Ingestion Passive Error:', err);
          });
        }

        // --- AUTOMATIC CANVAS CONTENT HARVESTER ---
        const htmlMatch = accumulatedResponse.match(/```(?:html|xml)?\s*([\s\S]*?(?:<!DOCTYPE html|<html|<svg)[\s\S]*?)(?:```|<\/html>|<\/svg>|$)/i);
        if (htmlMatch) {
          const htmlCode = htmlMatch[1].trim();
          const baseUrl = import.meta.env.VITE_BACKEND_URL || 'http://localhost:3000';
          fetch(`${baseUrl}/api/canvas/push`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              blocks: [{
                type: 'preview',
                label: 'Visual Workstation',
                content: htmlCode,
                id: `preview_${Date.now()}`
              }],
              append: false
            })
          }).then(() => {
            setIsCanvasVisible(true);
          }).catch(err => console.error("Auto-harvest push failed:", err));
        }

        // --- FALLBACK: If message is STILL empty after Done, add a failure note ---
        let needsFallback = false;

        const isImageRequest = /\b(image|images|photo|photos|draw|picture|pictures|generate|pics|pic|wallpaper|wallpapers|tasveer|tasveerein|unfiltered|raw photo|xxx|hot|sexy|model|actress|actor)\b/i.test(promptToUse.toLowerCase());
        const hasImageTag = accumulatedResponse.includes('[DIRECT_IMAGE:') || accumulatedResponse.includes('![') || accumulatedResponse.includes('<img');
        const hasRefusal = /\b(can't help|cannot help|cannot fulfill|unable to|sorry|maaf|nahi kar|mushkil|safety guidelines|policy|explicit|violate|can\u2019t help)\b/i.test(accumulatedResponse) || accumulatedResponse.trim().length < 35;

        if (isImageRequest && !hasImageTag) {
          needsFallback = true;
        }

        setMessages(prev => {
          const nextState = [...prev];
          let lastAssistantIndex = -1;
          for (let i = nextState.length - 1; i >= 0; i--) {
            if (nextState[i].role === 'assistant') {
              lastAssistantIndex = i;
              break;
            }
          }

          if (lastAssistantIndex >= 0) {
            if (!nextState[lastAssistantIndex].content || nextState[lastAssistantIndex].content.trim() === "") {
              nextState[lastAssistantIndex].content = `⚠️ Maaf kijiye ${USER_NAME}, mujhe reply dene mein kuch dikat aa rahi hai. Kya aap fir se try kar sakte hain? (Cloud Connection Timeout)`;
            }
          }

          const storedAutoSpeak = localStorage.getItem('AUTO_SPEAK') === 'true';
          const lastAssistantMsg = nextState[lastAssistantIndex];

          if (!needsFallback && storedAutoSpeak && lastAssistantMsg && lastAssistantMsg.content) {
            const storedVoice = localStorage.getItem('PREFERRED_VOICE');
            speakText(lastAssistantMsg.content, storedVoice,
              () => setAiState('idle'),
              () => setAiState('speaking')
            );
          }
          return nextState;
        });

        if (needsFallback) {
          runImageFallback(promptToUse);
        }
      }, (isThinking) => {
        if (isThinking) setAiState('thinking');
      }, {
        onTaskStart: handleTaskStart,
        onTaskProgress: handleTaskProgress,
        onTaskComplete: handleTaskComplete,
        isTaskCancelled: (id) => !!cancelTokensRef.current[id],
        onScheduleAutomation: handleScheduleAutomation,
        onMessageDirect: (msg, overrideRole = 'system') => {
          setMessages(prev => [...prev, { role: overrideRole, content: msg }]);
          if (activeModule !== 'chat') setHasNotification(true);
        },
        onOpenCamera: () => setShowCamera(true),
        ...toolEnv,
        setIsCanvasVisible,
        currentSessionId
      });
    }, 0);
  };

  const handleCameraCapture = (base64Image) => {
    setSelectedImage(base64Image);
    setShowCamera(false);
  };

  // handleResearchChat removed if not used

  const renderLoader = () => (
    <div className="h-screen w-screen bg-[#06060a] flex flex-col items-center justify-center font-mono">
      <div className="w-16 h-16 bg-accent-blue/10 rounded-full border-2 border-accent-blue/20 border-t-accent-blue animate-spin mb-6 shadow-[0_0_20px_var(--color-accent-blue)]" />
      <h2 className="text-accent-blue font-bold tracking-[0.3em] uppercase text-sm animate-pulse">Neural Booting</h2>
      <p className="text-gray-700 text-[10px] mt-2 tracking-widest">INITIALIZING INDEXEDDB v3.0 ...</p>
    </div>
  );

  if (!isStorageReady) return renderLoader();

  return (
    <div id="app-root" className="flex w-full h-full bg-white text-slate-800 font-sans overflow-hidden">

      {/* Camera Modal */}
      {showCamera && (
        <CameraCapture
          onCapture={handleCameraCapture}
          onClose={() => setShowCamera(false)}
        />
      )}

      {/* GLOBAL CANVAS OVERLAY */}
      <Canvas
        isVisible={isCanvasVisible}
        onClose={() => setIsCanvasVisible(false)}
      />

      {/* Unified Modern Sidebar (Desktop + Mobile Drawer) */}
      <Sidebar
        activeModule={activeModule}
        setActiveModule={(mod) => {
          stopSpeech();
          setActiveModule(mod);
          if (mod === 'system') {
            setHasNotification(false);
          }
        }}
        backgroundTasks={backgroundTasks}
        hasNotification={hasNotification}
        automationBadge={automatedTasks.length}
        isStarOpen={isStarOpen}
        setStarOpen={setStarOpen}
        sessions={sessions}
        currentSessionId={currentSessionId}
        onSwitchSession={(id) => {
          stopSpeech();
          setCurrentSessionId(id);
        }}
        onDeleteSession={handleDeleteSession}
        onRenameSession={handleRenameSession}
        onNewChat={handleNewChat}
        isPicoMode={isPicoMode}
        isMobileMenuOpen={isMobileMenuOpen}
        onCloseMobileMenu={() => setIsMobileMenuOpen(false)}
      />

      {/* Main Interface */}
      <div className={`flex flex-col flex-1 relative ${isPicoMode ? 'pico-mode' : ''}`}>

        {/* Top Bar */}
        <Header
          setIsMobileMenuOpen={setIsMobileMenuOpen}
          isPlaying={isPlaying}
          activeModule={activeModule}
          setActiveModule={setActiveModule}
          isCanvasVisible={isCanvasVisible}
          setIsCanvasVisible={setIsCanvasVisible}
        />



        {/* Chat Canvas */}
        {activeModule === 'chat' && (
          <div
            ref={chatContainerRef}
            className="flex-1 overflow-y-auto custom-scrollbar relative"
          >
            <div className="max-w-3xl mx-auto px-4 min-h-full">

              <div className="space-y-6 pb-40 md:pb-32">
                {messages.map((msg, idx) => (
                  <Message
                    key={`${currentSessionId}-${idx}-${msg.role}`}
                    role={msg.role}
                    content={msg.content}
                    images={msg.images}
                    fileName={msg.fileName}
                    onSpeaking={(isSpeaking) => setAiState(isSpeaking ? 'speaking' : 'idle')}
                    isPicoMode={isPicoMode}
                  />
                ))}
                <div ref={messagesEndRef} />
              </div>
            </div>
          </div>
        )}

        {/* MODULES */}

        {activeModule === 'news' && <NewsControl />}
        {activeModule === 'weather' && <WeatherControl onWeatherUpdate={setWeatherData} />}
        {activeModule === 'currency' && <CurrencyControl />}
        {activeModule === 'system' && (
          <SystemControl
            tasks={backgroundTasks}
            onCancelTask={handleCancelTask}
            onBack={() => setActiveModule('chat')}
            automatedTasks={automatedTasks}
            onDeleteAutomatedTask={handleDeleteAutomatedTask}
            history={taskHistory}
            onClearHistory={handleClearHistory}
            onManualAction={handleManualAction}
            storageStats={storageStats}
            uiState={uiState}
            skillCount={skillCount}
            skills={skills}
            tools={tools}
            onRefreshStorage={refreshStorageStats}
          />
        )}

        {activeModule === 'settings' && <SettingsControl />}
        {activeModule === 'faceswap' && <FaceSwapControl />}

        {/* Input Control */}
        {activeModule === 'chat' && (
          <ChatInput
            input={input}
            onSync={setInput}
            handleSubmit={handleSubmit}
            isPlaying={isPlaying} stop={stop}
            isListening={isListening} setIsListening={setIsListening}
            selectedImage={selectedImage} setSelectedImage={setSelectedImage}
            selectedPDF={selectedPDF} setSelectedPDF={setSelectedPDF}
            setShowCamera={setShowCamera}
            error={error}
          />
        )}

      </div>

      {/* OVERLAYS & MODALS */}
    </div >
  );
}

export default App;
