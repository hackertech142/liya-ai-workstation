import React, { useState, useEffect } from 'react';
import { User, Key, Save, ShieldCheck, Eye, EyeOff, Cpu } from 'lucide-react';
import { config } from '../utils/config';

const SettingsControl = () => {
    const [userName, setUserName] = useState('');
    const [apiKeys, setApiKeys] = useState({
        VITE_OLLAMA_CLOUD_API_KEY: '',
        VITE_MEM0_API_KEY: '',
        VITE_NEWS_API_KEY: '',
        VITE_WEATHER_API_KEY: '',
        VITE_CURRENCY_API_KEY: '',
        VITE_PEXELS_API_KEY: ''
    });

    const [models, setModels] = useState({
        OLLAMA_FAST_MODEL: '',
        OLLAMA_SMART_MODEL: '',
        CODER_MODEL: '',
        OLLAMA_VISION_MODEL: ''
    });

    const [showKeys, setShowKeys] = useState({});
    const [saveStatus, setSaveStatus] = useState(false);

    useEffect(() => {
        setUserName(config.getUserName());

        // Load API Keys
        const initialKeys = {};
        Object.keys(apiKeys).forEach(key => {
            initialKeys[key] = config.getApiKey(key);
        });
        setApiKeys(initialKeys);

        // Load Models dynamically from backend settings or localStorage
        const backendUrl = import.meta.env.VITE_BACKEND_URL || 'http://localhost:3000';
        fetch(`${backendUrl}/api/settings`)
            .then(res => res.ok ? res.json() : null)
            .then(data => {
                if (data && data.settings) {
                    const s = data.settings;
                    setModels({
                        OLLAMA_FAST_MODEL: s.OLLAMA_FAST_MODEL || localStorage.getItem('OLLAMA_FAST_MODEL') || 'gpt-oss:20b',
                        OLLAMA_SMART_MODEL: s.OLLAMA_SMART_MODEL || localStorage.getItem('OLLAMA_SMART_MODEL') || 'gpt-oss:120b',
                        CODER_MODEL: s.CODER_MODEL || localStorage.getItem('CODER_MODEL') || 'gpt-oss:120b',
                        OLLAMA_VISION_MODEL: s.OLLAMA_VISION_MODEL || localStorage.getItem('OLLAMA_VISION_MODEL') || 'gemma4:31b'
                    });
                    if (s.OLLAMA_FAST_MODEL) localStorage.setItem('OLLAMA_FAST_MODEL', s.OLLAMA_FAST_MODEL);
                    if (s.OLLAMA_SMART_MODEL) localStorage.setItem('OLLAMA_SMART_MODEL', s.OLLAMA_SMART_MODEL);
                    if (s.CODER_MODEL) localStorage.setItem('CODER_MODEL', s.CODER_MODEL);
                    if (s.OLLAMA_VISION_MODEL) localStorage.setItem('OLLAMA_VISION_MODEL', s.OLLAMA_VISION_MODEL);
                } else {
                    setModels({
                        OLLAMA_FAST_MODEL: localStorage.getItem('OLLAMA_FAST_MODEL') || 'gpt-oss:20b',
                        OLLAMA_SMART_MODEL: localStorage.getItem('OLLAMA_SMART_MODEL') || 'gpt-oss:120b',
                        CODER_MODEL: localStorage.getItem('CODER_MODEL') || 'gpt-oss:120b',
                        OLLAMA_VISION_MODEL: localStorage.getItem('OLLAMA_VISION_MODEL') || 'gemma4:31b'
                    });
                }
            })
            .catch(() => {
                setModels({
                    OLLAMA_FAST_MODEL: localStorage.getItem('OLLAMA_FAST_MODEL') || 'gpt-oss:20b',
                    OLLAMA_SMART_MODEL: localStorage.getItem('OLLAMA_SMART_MODEL') || 'gpt-oss:120b',
                    CODER_MODEL: localStorage.getItem('CODER_MODEL') || 'gpt-oss:120b',
                    OLLAMA_VISION_MODEL: localStorage.getItem('OLLAMA_VISION_MODEL') || 'gemma4:31b'
                });
            });
    }, []);

    const handleSave = () => {
        config.setUserName(userName);

        // Save API Keys
        Object.entries(apiKeys).forEach(([key, value]) => {
            config.setApiKey(key, value);
        });

        // Save Models
        localStorage.setItem('OLLAMA_FAST_MODEL', models.OLLAMA_FAST_MODEL);
        localStorage.setItem('OLLAMA_SMART_MODEL', models.OLLAMA_SMART_MODEL);
        localStorage.setItem('CODER_MODEL', models.CODER_MODEL);
        localStorage.setItem('OLLAMA_VISION_MODEL', models.OLLAMA_VISION_MODEL);

        // Sync Models with Backend dynamically
        const backendUrl = import.meta.env.VITE_BACKEND_URL || 'http://localhost:3000';
        fetch(`${backendUrl}/api/settings`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                OLLAMA_FAST_MODEL: models.OLLAMA_FAST_MODEL,
                OLLAMA_SMART_MODEL: models.OLLAMA_SMART_MODEL,
                CODER_MODEL: models.CODER_MODEL,
                OLLAMA_VISION_MODEL: models.OLLAMA_VISION_MODEL,
                userName
            })
        }).catch(err => console.warn("Failed to sync settings with backend:", err));

        // Refresh state
        const refreshedKeys = {};
        Object.keys(apiKeys).forEach(k => {
            refreshedKeys[k] = config.getApiKey(k);
        });
        setApiKeys(refreshedKeys);

        setSaveStatus(true);
        setTimeout(() => {
            setSaveStatus(false);
            window.location.reload();
        }, 1500);
    };

    const toggleKeyVisibility = (key) => {
        setShowKeys(prev => ({ ...prev, [key]: !prev[key] }));
    };

    return (
        <div className="p-4 md:p-6 h-full flex flex-col w-full overflow-y-auto bg-[#f9f9f9] pb-32">
            {/* Header bar */}
            <div className="flex items-center justify-between mb-8 pb-4 border-b border-gray-200">
                <div className="flex items-center gap-3">
                    <h2 className="text-xl font-bold text-slate-900 tracking-tight uppercase">Console Settings</h2>
                </div>

                <div className="flex items-center gap-3">
                    <button
                        type="button"
                        onClick={handleSave}
                        className="bg-indigo-600 hover:bg-indigo-700 text-white px-6 py-2.5 rounded-xl font-bold text-xs uppercase tracking-wider shadow-sm flex items-center gap-2 transition-all"
                    >
                        <Save size={14} />
                        {saveStatus ? 'SYNCED' : 'SAVE CHANGES'}
                    </button>
                </div>
            </div>

            <div className="grid grid-cols-12 gap-6 max-w-5xl w-full mx-auto">
                {/* IDENTITY PROFILE */}
                <div className="col-span-12 md:col-span-4 bg-white border border-gray-200 rounded-2xl p-6 shadow-sm flex flex-col justify-between">
                    <div className="space-y-4">
                        <div className="flex items-center gap-3 border-b border-gray-100 pb-2">
                            <User size={16} className="text-indigo-600" />
                            <h4 className="text-xs font-bold text-slate-800 uppercase tracking-widest">Master Identity</h4>
                        </div>
                        <p className="text-xs text-gray-500">Configure the master username the assistant will call you by default.</p>
                        <div>
                            <label className="block text-[9px] font-bold text-gray-500 uppercase mb-1">User Name</label>
                            <input
                                type="text"
                                value={userName}
                                onChange={(e) => setUserName(e.target.value)}
                                className="w-full bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-xs text-slate-800 font-mono focus:border-indigo-500 focus:outline-none"
                            />
                        </div>
                    </div>
                </div>

                {/* API TOKENS CARD */}
                <div className="col-span-12 md:col-span-8 bg-white border border-gray-200 rounded-2xl p-6 shadow-sm space-y-4">
                    <div className="flex items-center gap-3 border-b border-gray-100 pb-2">
                        <ShieldCheck size={18} className="text-indigo-600" />
                        <h3 className="text-xs font-bold text-slate-800 uppercase tracking-widest">API Integrations & Gateway Access Tokens</h3>
                    </div>
                    <p className="text-xs text-gray-500">Add credentials for external service providers (e.g. weather, news, search, LLM routing).</p>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2">
                        {Object.entries(apiKeys).map(([key, value]) => (
                            <div key={key} className="bg-gray-50 border border-gray-200 rounded-xl p-3 relative hover:border-indigo-300 transition-all">
                                <div className="flex items-center justify-between mb-1.5">
                                    <span className="text-[9px] font-bold text-gray-500 font-mono uppercase tracking-wider">
                                        {key.replace('VITE_', '').replace('_API_KEY', '').replace('_', ' ')}
                                    </span>
                                    <button onClick={() => toggleKeyVisibility(key)} className="text-gray-400 hover:text-indigo-600 transition-colors">
                                        {showKeys[key] ? <EyeOff size={12} /> : <Eye size={12} />}
                                    </button>
                                </div>
                                <input
                                    type={showKeys[key] ? "text" : "password"}
                                    value={value}
                                    onChange={(e) => setApiKeys(prev => ({ ...prev, [key]: e.target.value }))}
                                    className="w-full bg-transparent border-none text-xs text-slate-800 font-mono outline-none"
                                    placeholder="Not configured..."
                                />
                            </div>
                        ))}
                    </div>
                </div>

                {/* MODEL CONFIGURATION CARD */}
                <div className="col-span-12 bg-white border border-gray-200 rounded-2xl p-6 shadow-sm space-y-4">
                    <div className="flex items-center gap-3 border-b border-gray-100 pb-2">
                        <Cpu size={18} className="text-indigo-600" />
                        <h3 className="text-xs font-bold text-slate-800 uppercase tracking-widest">Model Routing & Selection</h3>
                    </div>
                    <p className="text-xs text-gray-500">Configure which model names are used for the various routing tiers in the system.</p>

                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 pt-2">
                        <div className="bg-gray-50 border border-gray-200 rounded-xl p-3 hover:border-indigo-300 transition-all">
                            <label className="block text-[9px] font-bold text-gray-500 uppercase mb-1">🏃 Fast Model</label>
                            <input
                                type="text"
                                value={models.OLLAMA_FAST_MODEL}
                                onChange={(e) => setModels(prev => ({ ...prev, OLLAMA_FAST_MODEL: e.target.value }))}
                                className="w-full bg-transparent border-none text-xs text-slate-800 font-mono outline-none"
                                placeholder="gpt-oss:20b-cloud"
                            />
                        </div>

                        <div className="bg-gray-50 border border-gray-200 rounded-xl p-3 hover:border-indigo-300 transition-all">
                            <label className="block text-[9px] font-bold text-gray-500 uppercase mb-1">🧠 Smart Model</label>
                            <input
                                type="text"
                                value={models.OLLAMA_SMART_MODEL}
                                onChange={(e) => setModels(prev => ({ ...prev, OLLAMA_SMART_MODEL: e.target.value }))}
                                className="w-full bg-transparent border-none text-xs text-slate-800 font-mono outline-none"
                                placeholder="gpt-oss:120b"
                            />
                        </div>

                        <div className="bg-gray-50 border border-gray-200 rounded-xl p-3 hover:border-indigo-300 transition-all">
                            <label className="block text-[9px] font-bold text-gray-500 uppercase mb-1">💻 Coder Model</label>
                            <input
                                type="text"
                                value={models.CODER_MODEL}
                                onChange={(e) => setModels(prev => ({ ...prev, CODER_MODEL: e.target.value }))}
                                className="w-full bg-transparent border-none text-xs text-slate-800 font-mono outline-none"
                                placeholder="gpt-oss:120b"
                            />
                        </div>

                        <div className="bg-gray-50 border border-gray-200 rounded-xl p-3 hover:border-indigo-300 transition-all">
                            <label className="block text-[9px] font-bold text-gray-500 uppercase mb-1">👁️ Vision Model</label>
                            <input
                                type="text"
                                value={models.OLLAMA_VISION_MODEL}
                                onChange={(e) => setModels(prev => ({ ...prev, OLLAMA_VISION_MODEL: e.target.value }))}
                                className="w-full bg-transparent border-none text-xs text-slate-800 font-mono outline-none"
                                placeholder="gemma4:31b"
                            />
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default SettingsControl;