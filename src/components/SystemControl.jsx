import React, { useState, useEffect } from 'react';
import { 
    Terminal, Cpu, Clock, Database, Trash2, X, AlertTriangle, 
    Zap, BarChart3, ListTodo, ShieldAlert, 
    RefreshCcw, Play, Power, Layers, HardDrive, Settings,
    Search, Boxes, FlaskConical, Layout, Globe, RotateCcw, ArrowLeft,
    ShieldCheck, Network, Cpu as CpuIcon, ChevronDown, ChevronUp, Maximize2
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

const TabButton = ({ id, label, icon: Icon, count, activeTab, setActiveTab }) => (
    <button
        onClick={() => setActiveTab(id)}
        className={`
            relative flex items-center gap-3 px-6 py-4 transition-all
            ${activeTab === id ? 'text-gray-900 ' : 'text-gray-500 hover:text-gray-300'}
        `}
    >
        <Icon size={14} className={activeTab === id ?'text-accent-blue' : 'text-gray-600'} />
        <span className="text-[10px] font-black font-mono uppercase tracking-[0.2em] whitespace-nowrap">{label}</span>
        {count !== undefined && (
            <span className={`text-[9px] font-bold font-mono px-1.5 py-0.5 rounded ${
                activeTab === id ? 'bg-accent-blue/20 text-accent-blue' : 'bg-gray-100  text-gray-700'
            }`}>
                {count}
            </span>
        )}
        {activeTab === id && (
            <motion.div 
                layoutId="activeTabIndicator" 
                className="absolute bottom-0 left-0 right-0 h-0.5 bg-accent-blue shadow-[0_0_10px_var(--color-accent-blue)]" 
            />
        )}
    </button>
);

const QuickActionButton = ({ icon: Icon, label, action, color = "cyan", onManualAction }) => (
    <button 
        onClick={() => onManualAction(`[INTERNAL] ${action}`)}
        className={`
            flex flex-col items-center justify-center gap-2 p-4 bg-white  border border-gray-200  rounded-2xl transition-all relative overflow-hidden group
            ${color === 'cyan' ? 'hover:border-accent-blue/40 shadow-2xl' : 'hover:border-red-500/40'}
        `}
    >
        <div className={`
            p-2 rounded-xl transition-all duration-500
            ${color === 'cyan' ? 'bg-accent-blue/5 text-gray-600 group-hover:text-accent-blue group-hover:bg-accent-blue/10' : 'bg-red-500/5 text-gray-600 group-hover:text-red-500'}
        `}>
            <Icon size={16} />
        </div>
        <span className="text-[8px] font-black text-gray-600 font-mono uppercase tracking-tighter text-center group-hover:text-gray-900 leading-tight">{label}</span>
    </button>
);

const SystemControl = ({ 
    tasks = [], 
    onCancelTask, 
    onBack, 
    automatedTasks = [], 
    onDeleteAutomatedTask, 
    history = [], 
    onClearHistory, 
    onManualAction,
    storageStats = { usage: 0, quota: 0 },
    uiState,
    skillCount = 0,
    skills = [],
    tools = [],
    onRefreshStorage
}) => {
    const [activeTab, setActiveTab] = useState('processes');
    const [expandedConsoles, setExpandedConsoles] = useState({});

    const toggleConsole = (id) => {
        setExpandedConsoles(prev => ({ ...prev, [id]: !prev[id] }));
    };

    // Simulated Telemetry State
    const [telemetry, setTelemetry] = useState({});

    useEffect(() => {
        const interval = setInterval(() => {
            const newTelemetry = {};
            tasks.forEach(task => {
                newTelemetry[task.id] = {
                    cpu: (Math.random() * 15 + 2).toFixed(1),
                    mem: (Math.random() * 100 + 150).toFixed(0),
                    fps: (Math.random() * 10 + 50).toFixed(0)
                };
            });
            setTelemetry(newTelemetry);
        }, 2000);
        return () => clearInterval(interval);
    }, [tasks]);

    // Optimized Storage Refresh: Only runs when the 'storage' tab is selected
    useEffect(() => {
        if (onRefreshStorage && activeTab === 'storage') {
            onRefreshStorage();
            const interval = setInterval(onRefreshStorage, 5000); 
            return () => clearInterval(interval);
        }
    }, [onRefreshStorage, activeTab]);



    return (
        <div className="p-4 md:p-6 h-full flex flex-col w-full bg-gray-50 font-sans selection:bg-accent-blue/30 pb-12 overflow-y-auto lg:overflow-hidden custom-scrollbar">
            
            {/* AGENTIC TOP HEADER */}
            <div className="flex items-center justify-between mb-6 pb-4 border-b border-gray-200 relative z-10">
                <div className="flex items-center gap-3">
                    <button onClick={onBack} className="p-2 bg-gray-100 border border-gray-300 rounded-lg text-gray-500 hover:text-gray-900 transition-all shadow-md group">
                        <ArrowLeft size={14} className="group-hover:-translate-x-1 transition-transform" />
                    </button>
                    <div>
                        <div className="flex items-center gap-2 mb-0.5">
                            <span className="text-[8px] font-bold text-accent-blue font-mono tracking-widest uppercase animate-pulse">Neural Core</span>
                            <div className="w-1.5 h-1.5 rounded-full bg-green-500 shadow-[0_0_8px_#22c55e]" />
                        </div>
                        <h2 className="text-base font-black text-gray-900 tracking-tight uppercase leading-none flex items-center gap-2">
                            AGENTIC <span className="text-transparent bg-clip-text bg-gradient-to-r from-accent-blue via-gray-400 to-gray-300">DASHBOARD</span>
                        </h2>
                    </div>
                </div>


            </div>

            {/* HORIZONTAL NAVIGATION BAR */}
            <div className="flex items-center gap-1 mb-6 bg-white backdrop-blur-2xl border border-gray-200 rounded-xl px-1 overflow-x-auto no-scrollbar relative z-10">
                <TabButton id="processes" label="PROCESSES" icon={Activity} count={tasks.length} activeTab={activeTab} setActiveTab={setActiveTab} />
                <TabButton id="scheduled" label="SCHEDULED" icon={Clock} count={automatedTasks.length} activeTab={activeTab} setActiveTab={setActiveTab} />
                <TabButton id="history" label="EXEC LOGS" icon={Terminal} count={history.length} activeTab={activeTab} setActiveTab={setActiveTab} />
                <TabButton id="storage" label="STORAGE" icon={HardDrive} activeTab={activeTab} setActiveTab={setActiveTab} />
            </div>

            <div className="flex-1 grid grid-cols-12 gap-6 relative z-10 min-h-0">
                
                {/* MAIN CONTENT AREA */}
                <div className="col-span-12 lg:col-span-8 flex flex-col min-h-0">
                    <div className="flex-1 lg:overflow-y-auto pr-4 custom-scrollbar min-h-0">
                        <AnimatePresence mode="wait">
                            {activeTab === 'processes' && (
                                <motion.div 
                                    key="proc"
                                    initial={{ opacity: 0, y: 20 }}
                                    animate={{ opacity: 1, y: 0 }}
                                    exit={{ opacity: 0, y: -20 }}
                                    className="space-y-6"
                                >
                                    <div className="flex items-center justify-between mb-6">
                                        <div className="flex items-center gap-4">
                                            <div className="w-10 h-10 rounded-xl bg-accent-blue/10 flex items-center justify-center border border-accent-blue/20 relative overflow-hidden group">
                                                <Activity size={20} className="text-accent-blue relative z-10" />
                                                <motion.div 
                                                    animate={{ scale: [1, 1.5, 1], opacity: [0.1, 0.3, 0.1] }}
                                                    transition={{ duration: 2, repeat: Infinity }}
                                                    className="absolute inset-0 bg-accent-blue"
                                                />
                                            </div>
                                            <div>
                                                <h3 className="text-lg font-black text-gray-900 uppercase tracking-tight">Process Monitor</h3>
                                                <p className="text-[10px] text-gray-600 font-mono uppercase tracking-[0.2em]">Active Background Nodes</p>
                                            </div>
                                        </div>
                                        <div className="flex items-center gap-2 px-4 py-2 bg-gray-50 border border-gray-200 rounded-full">
                                            <div className="w-2 h-2 rounded-full bg-accent-blue animate-pulse" />
                                            <span className="text-[10px] font-black text-gray-900 font-mono">{tasks.length} RUNNING</span>
                                        </div>
                                    </div>

                                    <div className="grid grid-cols-1 gap-6">
                                        {tasks.length > 0 ? (
                                            tasks.map((task, idx) => {
                                                const taskTelemetry = telemetry[task.id] || { cpu: '0.0', mem: '0', fps: '0' };
                                                const isExpanded = expandedConsoles[task.id];
                                                
                                                return (
                                                    <motion.div 
                                                        key={task.id || idx}
                                                        initial={{ opacity: 0, x: -20 }}
                                                        animate={{ opacity: 1, x: 0 }}
                                                        transition={{ delay: idx * 0.1 }}
                                                        className="group relative bg-white backdrop-blur-xl border border-gray-200 rounded-2xl p-5 hover:border-accent-blue/20 transition-all shadow-xl overflow-hidden"
                                                    >
                                                        {/* Activity Background Wave */}
                                                        <div className="absolute inset-0 opacity-10 pointer-events-none overflow-hidden">
                                                            <svg className="w-full h-full" viewBox="0 0 100 100" preserveAspectRatio="none">
                                                                <motion.path
                                                                    d="M0,50 Q25,30 50,50 T100,50 V100 H0 Z"
                                                                    fill="url(#wave-grad)"
                                                                    animate={{ 
                                                                        opacity: [0.4, 0.85, 0.4]
                                                                    }}
                                                                    transition={{ duration: 3, repeat: Infinity, ease: "easeInOut" }}
                                                                />
                                                                <defs>
                                                                    <linearGradient id="wave-grad" x1="0" y1="0" x2="0" y2="1">
                                                                        <stop offset="0%" stopColor="#00f3ff" />
                                                                        <stop offset="100%" stopColor="transparent" />
                                                                    </linearGradient>
                                                                </defs>
                                                            </svg>
                                                        </div>

                                                        <div className="relative z-10">
                                                            <div className="flex items-start justify-between mb-4">
                                                                <div className="flex items-center gap-4">
                                                                    <div className="w-12 h-12 rounded-xl border border-gray-200 border-t-accent-blue animate-spin-slow flex items-center justify-center bg-white/[0.03] shadow-inner">
                                                                        <CpuIcon size={20} className="text-accent-blue" />
                                                                    </div>
                                                                    <div>
                                                                        <h4 className="text-base font-black text-gray-900 uppercase tracking-tight mb-1">{task.name?.replace(/_/g, ' ')}</h4>
                                                                        <div className="flex items-center gap-3">
                                                                            <span className="text-[9px] font-black text-black font-mono uppercase px-2 py-0.5 bg-accent-blue rounded">Executing</span>
                                                                            <div className="flex items-center gap-1.5 text-gray-500">
                                                                                <Clock size={10} />
                                                                                <span className="text-[9px] font-mono uppercase">{new Date(task.timestamp).toLocaleTimeString()}</span>
                                                                            </div>
                                                                        </div>
                                                                    </div>
                                                                </div>
                                                                <div className="flex items-center gap-2">
                                                                    <button 
                                                                        onClick={() => toggleConsole(task.id)}
                                                                        className="p-2 bg-gray-100 border border-gray-300 rounded-lg text-gray-500 hover:text-accent-blue hover:bg-accent-blue/10 transition-all"
                                                                        title="View Console"
                                                                    >
                                                                        {isExpanded ? <ChevronUp size={14} /> : <Terminal size={14} />}
                                                                    </button>
                                                                    <button 
                                                                        onClick={() => onCancelTask(task.id)} 
                                                                        className="p-2 bg-gray-100 border border-gray-300 rounded-lg text-gray-500 hover:text-red-500 hover:bg-red-500/10 transition-all"
                                                                        title="Terminate"
                                                                    >
                                                                        <X size={14} />
                                                                    </button>
                                                                </div>
                                                            </div>

                                                            {/* Telemetry Row */}
                                                            <div className="grid grid-cols-3 gap-4 mb-6">
                                                                <div className="bg-white border border-gray-200 rounded-2xl p-3">
                                                                    <div className="text-[8px] font-black text-gray-600 font-mono uppercase mb-1">CPU Load</div>
                                                                    <div className="text-sm font-black text-accent-blue font-mono">{taskTelemetry.cpu}%</div>
                                                                </div>
                                                                <div className="bg-white border border-gray-200 rounded-2xl p-3">
                                                                    <div className="text-[8px] font-black text-gray-600 font-mono uppercase mb-1">Memory</div>
                                                                    <div className="text-sm font-black text-gray-900 font-mono">{taskTelemetry.mem}MB</div>
                                                                </div>
                                                                <div className="bg-white border border-gray-200 rounded-2xl p-3">
                                                                    <div className="text-[8px] font-black text-gray-600 font-mono uppercase mb-1">Frequency</div>
                                                                    <div className="text-sm font-black text-green-500 font-mono">{taskTelemetry.fps}Hz</div>
                                                                </div>
                                                            </div>

                                                            <div className="space-y-2">
                                                                <div className="flex items-center justify-between mb-1">
                                                                    <span className="text-[9px] font-black text-gray-500 font-mono uppercase tracking-widest">{task.progress || 'Processing Data...'}</span>
                                                                    <span className="text-[10px] font-black text-gray-900 font-mono">75%</span>
                                                                </div>
                                                                <div className="w-full h-1.5 bg-gray-100 rounded-full overflow-hidden">
                                                                    <motion.div 
                                                                        initial={{ width: 0 }}
                                                                        animate={{ width: '75%' }}
                                                                        className="h-full bg-gradient-to-r from-accent-blue via-blue-500 to-transparent shadow-[0_0_15px_var(--color-accent-blue)]" 
                                                                    />
                                                                </div>
                                                            </div>

                                                            <AnimatePresence>
                                                                {isExpanded && (
                                                                    <motion.div 
                                                                        initial={{ height: 0, opacity: 0 }}
                                                                        animate={{ height: 'auto', opacity: 1 }}
                                                                        exit={{ height: 0, opacity: 0 }}
                                                                        className="mt-6 border-t border-gray-200 pt-4 overflow-hidden"
                                                                    >
                                                                        <div className="bg-gray-200 rounded-2xl p-4 font-mono text-[10px] space-y-1.5 max-h-40 overflow-y-auto custom-scrollbar border border-gray-200">
                                                                            {task.logs && task.logs.length > 0 ? (
                                                                                task.logs.map((log, lIdx) => (
                                                                                    <div key={lIdx} className="flex gap-3">
                                                                                        <span className="text-accent-blue opacity-50">[{lIdx.toString().padStart(2, '0')}]</span>
                                                                                        <span className="text-gray-600">{log}</span>
                                                                                    </div>
                                                                                ))
                                                                            ) : (
                                                                                <div className="text-gray-600 italic uppercase tracking-widest animate-pulse">Waiting for neural output...</div>
                                                                            )}
                                                                        </div>
                                                                    </motion.div>
                                                                )}
                                                            </AnimatePresence>

                                                            {!isExpanded && (
                                                                <div className="mt-4 flex items-center gap-3 text-[10px] text-gray-500 font-mono uppercase tracking-tight truncate bg-gray-50 p-2 rounded-lg border border-gray-200">
                                                                    <Terminal size={10} className="text-accent-blue" />
                                                                    <span className="truncate">{task.logs && task.logs.length > 0 ? `> ${task.logs[task.logs.length - 1]}` : '> Initializing secure connection...'}</span>
                                                                </div>
                                                            )}
                                                        </div>
                                                    </motion.div>
                                                );
                                            })
                                        ) : (
                                            <div className="py-24 text-center flex flex-col items-center gap-4 opacity-70 scale-90">
                                                <div className="relative">
                                                    <Network size={40} className="text-gray-400" />
                                                    <motion.div 
                                                        animate={{ opacity: [0.1, 0.4, 0.1] }}
                                                        transition={{ duration: 3, repeat: Infinity }}
                                                        className="absolute inset-0 flex items-center justify-center"
                                                    >
                                                        <Activity size={16} className="text-accent-blue/30" />
                                                    </motion.div>
                                                </div>
                                                <div className="space-y-1">
                                                    <p className="text-[10px] font-black font-mono uppercase tracking-[0.4em] text-gray-500">Neutral State</p>
                                                    <p className="text-[9px] text-gray-400 font-mono uppercase tracking-widest">System awaiting new instructions</p>
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                </motion.div>
                            )}

                            {activeTab === 'scheduled' && (
                                <motion.div key="sch" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-6">
                                    <div className="flex items-center gap-4 mb-4">
                                        <div className="w-10 h-10 rounded-2xl bg-yellow-500/10 flex items-center justify-center border border-yellow-500/20 text-yellow-500">
                                            <Clock size={20} />
                                        </div>
                                        <h3 className="text-lg font-black text-gray-900 uppercase tracking-wider">Scheduled Protocols</h3>
                                    </div>
                                    <div className="space-y-4">
                                        {automatedTasks.map((task, idx) => (
                                            <div key={idx} className="bg-white border border-gray-200 p-5 rounded-2xl flex items-center justify-between group hover:bg-white/[0.01] transition-all">
                                                <div className="flex items-center gap-5">
                                                    <div className="w-10 h-10 rounded-xl bg-yellow-500/10 flex items-center justify-center border border-yellow-500/20 text-yellow-500 group-hover:scale-110 transition-transform">
                                                        <Clock size={20} />
                                                    </div>
                                                    <div>
                                                        <h4 className="text-sm font-black text-gray-900 tracking-wider mb-0.5 uppercase">{task.title}</h4>
                                                        <div className="flex items-center gap-4">
                                                            <span className="text-[10px] font-black text-yellow-500 uppercase font-mono tracking-widest">{task.frequency}</span>
                                                            <div className="w-1 h-1 bg-gray-800 rounded-full" />
                                                            <span className="text-[10px] text-gray-600 font-mono">{task.prompt}</span>
                                                        </div>
                                                    </div>
                                                </div>
                                                <div className="flex items-center gap-10">
                                                    <span className="text-2xl font-black text-gray-900 font-mono">{task.time}</span>
                                                    <button onClick={() => onDeleteAutomatedTask(task.id)} className="p-4 hover:bg-red-500/10 rounded-2xl text-gray-800 hover:text-red-500 transition-all">
                                                        <Trash2 size={24} />
                                                    </button>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </motion.div>
                            )}
                            
                            {activeTab === 'storage' && (
                                <motion.div key="st" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-6">
                                    <div className="flex items-center justify-between mb-4">
                                        <div className="flex items-center gap-4">
                                            <div className="w-10 h-10 rounded-2xl bg-blue-500/10 flex items-center justify-center border border-blue-500/20 text-blue-500">
                                                <Database size={20} />
                                            </div>
                                            <h3 className="text-base font-black text-gray-900 uppercase tracking-wider">Storage Core</h3>
                                        </div>
                                        <button 
                                            onClick={() => {
                                                if(confirm("PROTOCOL DELTA: Clear all chat sessions, Blackboard, AND wipe Mem0 memory history?")) {
                                                    if (onManualAction) onManualAction('[INTERNAL] purge memory');
                                                }
                                            }}
                                            className="px-4 py-2 bg-red-500/10 border border-red-500/20 rounded-xl text-[9px] font-black text-red-500 uppercase tracking-widest hover:bg-red-500 hover:text-gray-900 transition-all flex items-center gap-2"
                                        >
                                            <Trash2 size={12} />
                                            Purge Memory
                                        </button>
                                    </div>

                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                        <div className="bg-white border border-gray-200 rounded-2xl p-5 relative overflow-hidden group">
                                            <div className="relative z-10">
                                                <p className="text-[9px] font-black text-gray-600 font-mono uppercase tracking-[0.3em] mb-3">Cache Usage</p>
                                                <div className="flex items-baseline gap-2">
                                                    <span className="text-3xl font-black text-gray-900">{storageStats.usage}</span>
                                                    <span className="text-[10px] font-black text-gray-700 font-mono uppercase">MB</span>
                                                </div>
                                            </div>
                                            <HardDrive size={60} className="absolute -bottom-4 -right-4 text-gray-900 -rotate-12 group-hover:rotate-0 transition-transform duration-700" />
                                        </div>
                                        <div className="bg-white border border-gray-200 rounded-2xl p-5 relative overflow-hidden group">
                                            <div className="relative z-10">
                                                <p className="text-[9px] font-black text-gray-600 font-mono uppercase tracking-[0.3em] mb-3">Neural Capacity</p>
                                                <div className="flex items-baseline gap-2">
                                                    <span className="text-3xl font-black text-gray-900">{(storageStats.quota / 1024).toFixed(1)}</span>
                                                    <span className="text-[10px] font-black text-gray-700 font-mono uppercase">GB</span>
                                                </div>
                                            </div>
                                            <Activity size={60} className="absolute -bottom-4 -right-4 text-gray-900 group-hover:scale-110 transition-transform duration-700" />
                                        </div>
                                    </div>

                                    <div className="bg-gray-50 border border-gray-200 rounded-2xl p-5">
                                        <h4 className="text-[10px] font-black text-gray-500 font-mono uppercase tracking-[0.3em] mb-4">Sector Analysis</h4>
                                        <div className="w-full h-2 bg-gray-100 rounded-full overflow-hidden flex">
                                            <motion.div 
                                                initial={{ width: 0 }}
                                                animate={{ width: `${(storageStats.usage / (storageStats.quota || 1)) * 100}%` }}
                                                className="h-full bg-blue-500 shadow-[0_0_10px_#3b82f6]" 
                                            />
                                        </div>
                                        <p className="mt-4 text-[8px] text-gray-700 font-mono uppercase leading-relaxed">
                                            The neural core is operating at optimal efficiency. High-frequency data streams are being cached locally to reduce latency.
                                        </p>
                                    </div>
                                </motion.div>
                            )}

                            {activeTab === 'history' && (
                                <motion.div key="hist" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-6">
                                    <div className="flex items-center justify-between mb-8">
                                        <div className="flex items-center gap-4">
                                            <div className="w-10 h-10 rounded-2xl bg-purple-500/10 flex items-center justify-center border border-purple-500/20 text-purple-500">
                                                <Terminal size={20} />
                                            </div>
                                            <h3 className="text-lg font-black text-gray-900 uppercase tracking-wider">Execution Logs</h3>
                                        </div>
                                        <button onClick={onClearHistory} className="px-6 py-2 bg-red-500/10 border border-red-500/20 rounded-xl text-[10px] font-black text-red-500 uppercase tracking-[0.2em] hover:bg-red-500 hover:text-gray-900 transition-all">
                                            Clear All
                                        </button>
                                    </div>
                                    <div className="space-y-3">
                                        {history.map((log, idx) => (
                                            <div key={idx} className="bg-white border border-gray-200 p-6 rounded-3xl flex items-center justify-between group">
                                                <div className="flex items-center gap-8">
                                                    <span className="text-[10px] font-mono text-gray-700">{new Date(log.completedAt || Date.now()).toLocaleTimeString()}</span>
                                                    <div>
                                                        <h4 className="text-[11px] font-black text-gray-900 uppercase tracking-widest mb-1">{log.name}</h4>
                                                        <p className="text-[10px] text-gray-600 font-mono truncate max-w-[400px]">{log.result || 'Executed successfully.'}</p>
                                                    </div>
                                                </div>
                                                <span className={`text-[9px] font-black font-mono uppercase px-3 py-1 rounded-lg ${log.status === 'completed' ? 'text-green-500 bg-green-500/10' : 'text-red-500 bg-red-500/10'}`}>
                                                    {log.status}
                                                </span>
                                            </div>
                                        ))}
                                    </div>
                                </motion.div>
                            )}

                        </AnimatePresence>
                    </div>
                </div>

                {/* SIDEBAR ACTIONS */}
                <div className="col-span-12 lg:col-span-4 flex flex-col gap-6 lg:overflow-y-auto lg:pr-2 custom-scrollbar min-h-0">
                    <div className="bg-white backdrop-blur-2xl border border-gray-200 rounded-3xl p-6 shadow-xl">
                        <div className="flex items-center gap-3 mb-6">
                            <Zap size={16} className="text-accent-blue" />
                            <h3 className="text-[11px] font-black text-gray-900 font-mono uppercase tracking-[0.3em]">Quick Protocols</h3>
                        </div>
                        <div className="grid grid-cols-2 gap-4">
                            <QuickActionButton icon={Trash2} label="Purge Logs" action="clear logs" onManualAction={onManualAction} />
                            <QuickActionButton icon={RefreshCcw} label="Refresh UI" action="refresh ui" onManualAction={onManualAction} />
                        </div>
                    </div>


                </div>

            </div>
        </div>
    );
};

export default SystemControl;