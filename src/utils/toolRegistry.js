import axios from 'axios';
import { fetchNews } from './news';
import { fetchWeather } from './weather';
import { fetchCurrency } from './currency';
import { toggleDevice } from './sinric';
import { getDynamicSinricConfig } from './homeConfig';
import { memoryManager } from './MemoryManager';
import { config } from './config';

const getCache = (key) => {
    const cached = localStorage.getItem(`LIYA_CACHE_${key}`);
    if (!cached) return null;
    const { data, expiry } = JSON.parse(cached);
    if (Date.now() > expiry) {
        localStorage.removeItem(`LIYA_CACHE_${key}`);
        return null;
    }
    return data;
};

const setCache = (key, data, ttlMs = 900000) => { // Default 15 mins
    localStorage.setItem(`LIYA_CACHE_${key}`, JSON.stringify({
        data,
        expiry: Date.now() + ttlMs
    }));
};

const getBackendUrl = () => {
    return import.meta.env.VITE_BACKEND_URL || 'http://localhost:3000';
};

/**
 * Tool Registry - The single source of truth for all LIYA features.
...
 * To add a new feature, simply add an entry to the tools array.
 */
export const tools = [
    {
        name: 'calculator',
        description: 'Evaluate mathematical expressions for 100% accuracy. Use this whenever the user asks a math question or needs a calculation (e.g. "What is 15 * 24?", "Calculate 2+2").',
        parameters: { expression: 'string (e.g. "15 * 24")' },
        execute: async ({ expression }) => {
            // SAFE MATH EVALUATOR: No eval/Function — recursive descent parser
            const safeEval = (expr) => {
                const tokens = expr.match(/(\d+\.?\d*|[+\-*/()%]|Math\.\w+)/g);
                if (!tokens) throw new Error('Invalid expression');

                // Validate: only numbers, operators, parens, Math.* allowed
                const valid = /^[\d+\-*/().%\s]|Math\.[a-z]+$/i;
                for (const t of tokens) {
                    if (!valid.test(t) && isNaN(t)) throw new Error(`Blocked token: ${t}`);
                }

                // Allowed Math functions whitelist
                const ALLOWED_MATH = ['abs', 'ceil', 'floor', 'round', 'sqrt', 'pow', 'min', 'max', 'log', 'log2', 'log10', 'sin', 'cos', 'tan', 'PI', 'E'];

                let pos = 0;
                const peek = () => tokens[pos];
                const next = () => tokens[pos++];

                function parseExpr() {
                    let result = parseTerm();
                    while (peek() === '+' || peek() === '-') {
                        const op = next();
                        const right = parseTerm();
                        result = op === '+' ? result + right : result - right;
                    }
                    return result;
                }
                function parseTerm() {
                    let result = parseFactor();
                    while (peek() === '*' || peek() === '/' || peek() === '%') {
                        const op = next();
                        const right = parseFactor();
                        if (op === '*') result *= right;
                        else if (op === '/') { if (right === 0) throw new Error('Division by zero'); result /= right; }
                        else result %= right;
                    }
                    return result;
                }
                function parseFactor() {
                    // Unary minus
                    if (peek() === '-') { next(); return -parseFactor(); }
                    if (peek() === '+') { next(); return parseFactor(); }
                    // Parenthesized expression
                    if (peek() === '(') { next(); const r = parseExpr(); next(); return r; }
                    // Math.fn(...)
                    const token = peek();
                    if (token && token.startsWith('Math.')) {
                        const fnName = next().replace('Math.', '');
                        if (!ALLOWED_MATH.includes(fnName)) throw new Error(`Math.${fnName} not allowed`);
                        if (fnName === 'PI') return Math.PI;
                        if (fnName === 'E') return Math.E;
                        next(); // skip '('
                        const arg = parseExpr();
                        next(); // skip ')'
                        return Math[fnName](arg);
                    }
                    // Number
                    return parseFloat(next());
                }

                const result = parseExpr();
                if (pos < tokens.length) throw new Error('Unexpected token: ' + tokens[pos]);
                return result;
            };

            try {
                const result = safeEval(expression);
                if (result === undefined || result === null || Number.isNaN(result) || !isFinite(result)) {
                    return 'Mathematical Error or Invalid Equation.';
                }
                return `Calculation Result: ${expression} = ${result}`;
            } catch (e) {
                return `Calculation Error: ${e.message}`;
            }
        }
    },
    {
        name: 'schedule_automation',
        description: 'Schedule a recurring or one-time automated task or reminder. Use for: daily reminders ("Roj 8 baje..."), delayed one-time tasks ("10 minute baad", "in 30 minutes"), or complex cron schedules. CRITICAL RULES: (1) Time can be in HH:mm 24-hour format (e.g. "12:54"), relative delay (e.g. "10m", "1h"), or standard cron expression (e.g. "*/5 * * * *"). (2) For relative delays calculate the exact target time. (3) If the task requires an action (e.g. fetch weather, turn off lights), you MUST fill the "prompt" field with a clear instruction like "Get current weather". (4) For one-time tasks, use frequency="once".',
        parameters: {
            title: 'string (Short human-readable task name)',
            time: 'string (HH:mm format, relative delay like "10m", or cron expression)',
            frequency: 'string ("once", "daily", or "cron")',
            prompt: 'string (REQUIRED for action tasks: the exact instruction to execute)'
        },
        execute: async ({ title, time, frequency, prompt = '' }, env) => {
            let actualFrequency = frequency;
            let computedTime = time;

            const isRelative = time.match(/^\d+[mhs]$/i) || time.toLowerCase().includes('minute') || time.toLowerCase().includes('hour') || time.toLowerCase().includes('second');
            if (isRelative) {
                const amountMatch = time.match(/\d+/);
                if (amountMatch) {
                    const amount = parseInt(amountMatch[0], 10);
                    const unit = (time.match(/[mhs]/i) || ['m'])[0].toLowerCase();
                    const isMin = unit === 'm' || time.toLowerCase().includes('min');
                    const isHour = unit === 'h' || time.toLowerCase().includes('hour');
                    const isSec = unit === 's' || time.toLowerCase().includes('sec');

                    const target = new Date();
                    if (isMin) target.setMinutes(target.getMinutes() + amount);
                    else if (isHour) target.setHours(target.getHours() + amount);
                    else if (isSec) target.setSeconds(target.getSeconds() + amount);

                    // Format for backend: HH:mm:ss if it's a "once" task to be more precise
                    computedTime = `${String(target.getHours()).padStart(2, '0')}:${String(target.getMinutes()).padStart(2, '0')}:${String(target.getSeconds()).padStart(2, '0')}`;
                    actualFrequency = 'once';
                }
            } else if (!actualFrequency) {
                actualFrequency = 'once';
            }

            if (env && env.onScheduleAutomation) {
                env.onScheduleAutomation({ title, time: computedTime, frequency: actualFrequency, prompt });
                return `Successfully scheduled: "${title}" at ${computedTime} (${actualFrequency}).${prompt ? ' Will auto-execute: ' + prompt : ''}`;
            }
            return 'Scheduling failed: System interface not ready.';
        }
    },
    {
        name: 'camera',
        description: 'Open the camera to capture a photo. Use this when the user says "open camera", "take photo", or "camera kholo". This will show a live camera preview to the user.',
        parameters: {},
        execute: async (params, env) => {
            if (env && env.onOpenCamera) {
                env.onOpenCamera();
                return 'Camera interface opened successfully.';
            }
            return 'Failed to open camera: UI controller not found.';
        }
    },
    {
        name: 'canvas',
        description: 'Control the Agentic Canvas for high-fidelity interactive UI. Actions: "present", "hide", "reset", "push", "snapshot". UI blocks support: \n(1) "text": {label, content}\n(2) "metric": {label, value, trend}\n(3) "button": {label, actionId, payload: {prompt, autoSubmit: true}}\n(4) "chart": {label, chartType: "bar"|"line"|"area"|"pie", data: [{name, value}]}\n(5) "diff": {oldCode, newCode, fileName}\n(6) "preview": {label, content (HTML/CSS/JS)}\n\nUse this for dashboards, code patches, web previews and taking captures.',
        parameters: {
            action: 'string ("present", "hide", "reset", "push")',
            blocks: 'array (Required for "push": Array of block objects {type, label, content/value, actionId, payload})',
            append: 'boolean (Optional: if true, append to existing UI)'
        },
        execute: async ({ action, blocks, append = false }, env) => {
            const baseUrl = getBackendUrl();
            try {
                if (action === 'present' || action === 'hide') {
                    await fetch(`${baseUrl}/api/canvas/visibility`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ visible: action === 'present' })
                    });
                    if (env && env.setIsCanvasVisible) env.setIsCanvasVisible(action === 'present');
                    return `Canvas ${action === 'present' ? 'shown' : 'hidden'}.`;
                }

                if (action === 'reset') {
                    await fetch(`${baseUrl}/api/canvas/reset`, { method: 'POST' });
                    return 'Canvas UI cleared.';
                }

                if (action === 'push') {
                    // Ensure every block has a unique ID for interactive features
                    const blocksWithIds = (blocks || []).map((b, i) => {
                        return {
                            ...b,
                            id: b.id || `${b.type || 'block'}_${Date.now()}_${i}`
                        };
                    });
                    const res = await fetch(`${baseUrl}/api/canvas/push`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ blocks: blocksWithIds, append })
                    });
                    await res.json();
                    if (env && env.setIsCanvasVisible) env.setIsCanvasVisible(true);
                    return `Successfully pushed ${blocksWithIds.length} UI blocks to Canvas.`;
                }
            } catch (e) {
                return `Canvas error: ${e.message}`;
            }
        }
    },
    {
        name: 'vision_analyze',
        description: 'Capture the current screen/UI and analyze it using Liya\'s visual brain. Use this when the user asks "what do you see?", "analyze this screen", or "check the errors on page".',
        parameters: {
            prompt: 'string (Optional: Specific question about the UI)'
        },
        execute: async ({ prompt }, env) => {
            if (!env || !env.takeSnapshot) {
                return 'Vision error: Snapshot capability not available in this environment.';
            }

            try {
                const imageData = await env.takeSnapshot();
                const baseUrl = getBackendUrl();

                const res = await fetch(`${baseUrl}/api/vision/analyze`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ image: imageData, prompt })
                });

                const data = await res.json();
                if (data.error) throw new Error(data.error);

                return `[VISION ANALYSIS]\n${data.analysis}`;
            } catch (e) {
                return `Vision Analysis Failed: ${e.message}`;
            }
        }
    },
    {
        name: 'memory',
        description: 'Store or search for persistent memories. Use this to remember user preferences, important facts, or past events. Actions: "save", "search". Example: memory(action="save", content="User likes chai with ginger").',
        parameters: {
            action: 'string ("save", "search")',
            content: 'string (The fact to save OR the query to search for)',
            tags: 'array (Optional categories like ["preference", "task", "event"])'
        },
        execute: async ({ action, content, tags = [] }) => {
            const { memoryManager } = await import('./MemoryManager');
            try {
                if (action === 'save') {
                    await memoryManager.add([{ role: 'user', content }], { tags });
                    return `✅ Memory saved: "${content}"`;
                }
                if (action === 'search') {
                    const results = await memoryManager.search(content, 5);
                    if (!results) return `❌ No matching memories found for "${content}".`;
                    return `🧠 Memories found:\n- ${results}`;
                }
            } catch (e) {
                return `Memory error: ${e.message}`;
            }
        }
    },
    {
        name: 'voice_call',
        description: 'Initiate a real-time voice interaction with the user. Use this for urgent matters, "God Tier" proactive assistance, or when the user says "call me" or "talk to me".',
        parameters: {
            reason: 'string (The purpose of the call)',
            urgency: 'string ("high", "normal", "low")'
        },
        execute: async ({ reason, urgency = 'normal' }, _ENV) => {
            // Integrating with the existing speech and UI system
            const { speakText } = await import('./speechUtils');
            const baseUrl = getBackendUrl();

            try {
                // 1. Proactively show a Call UI on Canvas
                await fetch(`${baseUrl}/api/canvas/push`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        blocks: [{
                            type: 'metric',
                            label: 'INCOMING LIYA CALL',
                            value: urgency === 'high' ? 'URGENT' : 'PROACTIVE',
                            trend: urgency === 'high' ? 'up' : 'neutral'
                        }, {
                            type: 'text',
                            label: 'Reason',
                            content: reason
                        }]
                    })
                });

                // 2. Proactively speak to the user
                const callPrompt = `${import.meta.env.VITE_USER_NAME || 'Navraj'}, mujhe aapse zaroori baat karni hai: ${reason}`;
                speakText(callPrompt);

                return `✅ Voice call initiated: "${reason}"`;
            } catch (e) {
                return `Voice call failed: ${e.message}`;
            }
        }
    },
    {
        name: 'weather',
        description: 'Get real-time weather information for any city. Trigger for: weather, temperature, forecast, rain, hot, cold. CRITICAL: You MUST have a specific city name. Do NOT guess the city.',
        parameters: { city: 'string (Specific city name ONLY. Do NOT use "current", "here", or empty strings. If the user did not say their city, do NOT use this tool.)' },
        execute: async ({ city }) => {
            if (!city || typeof city !== 'string' || city.trim() === '') {
                return "ERROR: Missing valid city parameter. Please ask the user for their location.";
            }
            const cacheKey = `weather_${city.toLowerCase()}`;
            const cached = getCache(cacheKey);
            if (cached) return `[Cached] ${cached}`;

            const data = await fetchWeather(city || 'Delhi');
            if (data) setCache(cacheKey, data);
            return data || 'No weather data found.';
        }
    },
    {
        name: 'news',
        description: 'Real-Time Headlines, Breaking Incidents & Recent Events. Use this whenever the user wants newly updated information about recently happened events, current incidents, breaking updates, or sector news (e.g., "aaj kya hua", "recently kya ghatna ghati", "latest news", "breaking updates", "aaj ki taza khabar", tech/business/sports updates). Powered by NewsAgent.',
        parameters: { 
            category: 'string (Required: general, technology, business, sports, science, health, india)',
            query: 'string (Optional: filter news by keyword or specific recent event)'
        },
        execute: async ({ category, query }) => {
            const { newsAgent } = await import('./newsAgent');
            const data = await newsAgent.fetch({ 
                category: category || 'general', 
                searchQuery: query || '' 
            });

            if (!data || data.length === 0) return 'No news found for this sector.';

            // Format for chat agent
            const headlines = data.slice(0, 5).map((a, i) => `${i + 1}. ${a.title} (Source: ${a.source.name})`).join('\n');
            return `[Latest News Report]\n${headlines}\n\n*Full reports and summaries are available in the Intelligence Hub console.*`;
        }
    },
    {
        name: 'currency',
        description: 'Convert between fiat currencies (USD, INR, EUR, etc.) or check exchange rates.',
        parameters: { from: 'string', to: 'string', amount: 'number' },
        execute: async ({ from, to, amount }) => {
            const data = await fetchCurrency(from, to, amount);
            return data || 'Currency conversion failed.';
        }
    },
    {
        name: 'home_automation',
        runInBackground: true,
        description: 'Control smart home devices including handling sequences, delays, and repetitions. Devices: "pannel light" (panel/pannel/light), "star light" (star/starlight), "tv" (television). Tasks: turn on/off, wait, blink/repeat. Use this to handle commands like "turn on tv then wait 4 sec and turn off".',
        parameters: { commands: { type: 'array', description: 'Array of actions { device: string, action: "on"|"off", delayMs: number }' } },
        shouldRunInBackground: ({ commands }) => {
            if (!commands || commands.length === 0) return false;
            // Background only if more than 1 command OR any command has a delay
            return commands.length > 1 || commands.some(cmd => cmd.delayMs && cmd.delayMs > 0);
        },
        execute: async ({ commands }, { onProgress, isCancelled } = {}) => {
            if (!commands || commands.length === 0) return "No actions specified.";

            // Normalize device names to handle user-defined names
            const normalizeDevice = (dev) => {
                if (!dev) return null;
                const d = dev.toLowerCase();
                const config = getDynamicSinricConfig();

                // 1. Check for exact match in current dynamic config
                if (config.devices[d]) return d;

                // 2. Fuzzy matches for legacy or common terms
                if (d.includes('tv') || d.includes('telev')) return 'tv';
                if (d.includes('star') || d.includes('starlight')) return 'star light';
                if (d.includes('panel') || d.includes('pannel') || d.includes('pannel light')) return 'pannel light';

                // 3. Check if input matches any name in config partially
                const match = Object.keys(config.devices).find(name => d.includes(name) || name.includes(d));
                return match || dev;
            };

            // Helper for interruptible delays
            const interruptibleSleep = async (ms, isCancelledFn) => {
                const chunks = Math.ceil(ms / 100); // 100ms chunks
                for (let j = 0; j < chunks; j++) {
                    if (isCancelledFn && isCancelledFn()) throw new Error('Task was manually cancelled by user.');
                    await new Promise(resolve => setTimeout(resolve, Math.min(100, ms - (j * 100))));
                }
            };

            let results = [];
            for (let i = 0; i < commands.length; i++) {
                const cmd = commands[i];
                if (cmd.delayMs) {
                    await interruptibleSleep(cmd.delayMs, isCancelled);
                }

                if (isCancelled && isCancelled()) {
                    throw new Error('Task was manually cancelled by user.');
                }
                const device = normalizeDevice(cmd.device) || 'unknown';
                const turnOn = cmd?.action?.toLowerCase() === 'on';

                try {
                    const res = await toggleDevice(device, turnOn);
                    results.push(res || `Failed to turn ${cmd.action} ${device}.`);
                } catch (e) {
                    results.push(`Error on ${device}: ${e.message}`);
                }

                // Emitting progress
                if (onProgress) {
                    onProgress(`Executed ${i + 1}/${commands.length}: ${cmd.action} ${device}`);
                }
            }
            return results.join(' | ');
        }
    },
    {
        name: 'web_image_scraper',
        description: 'PRIMARY TOOL for finding photos of SPECIFIC people, events, items, or real-time queries (e.g., "Virat Kohli", "SpaceX", "iPhone 16"). Trigger for: show photo, scrape image, find picture.',
        parameters: { query: 'string' },
        execute: async ({ query }) => {
            try {
                // Ensure axios is available or use fetch since we are in the frontend here
                // We will call our new backend API instead.
                const response = await fetch(`${getBackendUrl()}/api/scrape/image`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ query })
                });
                
                const data = await response.json();
                if (data.urls && data.urls.length > 0) {
                    const imageTags = data.urls.map(url => `[DIRECT_IMAGE:${url}|Scraped Image: ${query}]`).join('\n');
                    return `${imageTags}\n\n(System Note to AI: The images have been shown to the user. You MUST now add a conversational sentence like "Ye lijiye aapki photo!" or "Here is the photo you requested." Do NOT just output the tag.)`;
                }
                return `Could not find scraped images for ${query}.`;
            } catch (e) {
                return `Failed to scrape image: ${e.message}`;
            }
        }
    },
    {
        name: 'image_gen',
        description: 'Fallback tool for finding GENERIC high-quality stock photos (e.g., "nature", "beautiful sunset", "generic office"). DO NOT use this for specific people or current events.',
        parameters: { prompt: 'string' },
        execute: async ({ prompt }) => {
            const { fetchPexelsImage, fetchWikiImage } = await import('./research');

            // Try Pexels first for nice high-quality stock
            const res = await fetchPexelsImage(prompt);
            if (res && !res.includes('No photo found')) {
                return `${res}\n\n(System Note to AI: The image has been shown to the user. You MUST now add a conversational sentence like "Ye lijiye aapki photo!" or "Here is the photo you requested." Do NOT just output the tag.)`;
            }

            // Fallback to Wiki if Pexels fails
            const wikiRes = await fetchWikiImage(prompt);
            if (wikiRes && !wikiRes.includes('No photo found')) return wikiRes;

            return 'Could not find a photo for that request.';
        }
    },
    {
        name: 'research',
        description: 'SKILL: Web Search & Deep Intelligence. Use this for ANY web search, DuckDuckGo queries, or specific questions about current events (e.g. "Election results", "Bitcoin price"). This tool uses live web discovery (Playwright), Reddit, and Wikipedia for 100% accurate facts. Use this instead of your internal memory for anything post-2023.',
        parameters: { query: 'string (Specific question or search topic)' },
        execute: async ({ query }, env) => {
            if (!query || query.trim().length < 2) {
                return 'Research error: Please provide a valid search query.';
            }
            const { performResearch } = await import('./research');
            // Run specialized research first
            const specialized = await performResearch(query, env);
            if (specialized && specialized.trim().length > 20) return specialized;

            // Fallback to web search only if specialized returned nothing useful
            const web = await performResearch(`web search ${query}`, env);
            return web || 'No information found.';
        }
    },
    {
        name: 'ascii_art',
        description: 'Generate stylish ASCII art for a word or name.',
        parameters: { text: 'string' },
        execute: async ({ text }) => {
            const { fetchASCII } = await import('./ascii');
            return await fetchASCII(text);
        }
    },
    {
        name: 'recall_memory',
        description: 'Search for past user information, preferences, shared facts, or history. Use this if the user asks "Tell me about me" or if you need personal context to answer a query.',
        parameters: { query: 'string' },
        execute: async ({ query }) => {
            const memories = await memoryManager.search(query, 5);
            return memories || 'No relevant memories found.';
        }
    },
    {
        name: 'store_memory',
        description: `Permanently store a definitive personal fact about the user (${import.meta.env.VITE_USER_NAME || 'Navraj'}). Use for names, preferences, or important bio info. Facts: "I am a doctor", "My name is ${import.meta.env.VITE_USER_NAME || 'Navraj'}".`,
        parameters: { fact: 'string' },
        execute: async ({ fact }) => {
            const result = await memoryManager.add([{ role: 'user', content: fact }], { memory_type: 'personal' });
            return result ? `Fact stored permanently: ${fact}` : 'Failed to store fact.';
        }
    },
    {
        name: 'web_scrape',
        description: 'Scrape a specific website URL and extract its text content. Use this if the user provides a direct link or asks to "scrape" a site. You can also specify if visual layout, photos, or screenshots are needed.',
        parameters: { 
            url: 'string', 
            instruction: 'string',
            takeScreenshot: 'boolean',
            viewportType: 'string' // 'desktop' | 'mobile' | 'tablet'
        },
        execute: async ({ url, instruction, takeScreenshot, viewportType }, env) => {
            if (!url) return 'URL required for scraping.';
            const { performResearch } = await import('./research');
            const query = instruction ? `${url} ${instruction}` : url;
            return await performResearch(query, { ...env, takeScreenshot: !!takeScreenshot, viewportType });
        }
    },
    // NEW OPEN SOURCE TOOLS
    {
        name: 'movie_info',
        description: 'Get movie or TV show information including rating, cast, plot. Trigger for: movie, film, imdb, actor.',
        parameters: { title: 'string' },
        execute: async ({ title }) => {
            if (!title) return 'Movie title not provided.';
            const { performResearch } = await import('./research');
            const result = await performResearch(`movie ${title}`);
            return result || 'Movie not found.';
        }
    },
    {
        name: 'dog_image',
        description: 'Get a random cute dog image. Trigger for: dog, puppy, doggo, show me a dog.',
        parameters: {},
        execute: async () => {
            const { performResearch } = await import('./research');
            const result = await performResearch('random dog image');
            return result || 'Could not fetch dog image.';
        }
    },
    {
        name: 'activity_suggestion',
        description: 'Get a random activity suggestion when bored. Trigger for: bored, what to do, kya karu, activity.',
        parameters: {},
        execute: async () => {
            const { performResearch } = await import('./research');
            const result = await performResearch('bored activity suggestion');
            return result || 'Could not fetch activity.';
        }
    },
    {
        name: 'name_analysis',
        description: 'Analyze a name to predict age, gender, and nationality. Trigger for: age of name, gender of, nationality.',
        parameters: { name: 'string' },
        execute: async ({ name }) => {
            if (!name) return 'Name not provided.';
            const { performResearch } = await import('./research');
            const result = await performResearch(`age of ${name}`);
            return result || 'Could not analyze name.';
        }
    },
    {
        name: 'space_launch',
        description: 'Get the latest SpaceX rocket launch info. Trigger for: spacex, rocket, launch, space news.',
        parameters: {},
        execute: async () => {
            const { performResearch } = await import('./research');
            const result = await performResearch('spacex latest launch');
            return result || 'Could not fetch launch info.';
        }
    },
    {
        name: 'nasa_apod',
        description: 'Get NASA Astronomy Picture of the Day. Trigger for: nasa, astronomy, space photo, apod.',
        parameters: {},
        execute: async () => {
            const { performResearch } = await import('./research');
            const result = await performResearch('nasa astronomy picture');
            return result || 'Could not fetch NASA APOD.';
        }
    },
    {
        name: 'fake_user',
        description: 'Generate a random fake user profile with name, email, phone, photo. Trigger for: fake user, random user, test data, fake data.',
        parameters: {},
        execute: async () => {
            const { performResearch } = await import('./research');
            const result = await performResearch('fake user data');
            return result || 'Could not generate fake user.';
        }
    },
    {
        name: 'view_memories',
        description: 'View all stored memories about the user. Trigger for: what do you remember, show my memories, list memories.',
        parameters: {},
        execute: async () => {
            const memories = await memoryManager.getAll();
            if (!memories || memories.length === 0) {
                return '🧠 No memories stored yet.';
            }
            const formatted = memories.map((m, i) => {
                const date = new Date(m.timestamp).toLocaleString();
                return `${i + 1}. [${date}] ${m.memory || m.content}`;
            }).join('\n');
            return `🧠 **Your Stored Memories (${memories.length} total):**\n\n${formatted}\n\n*To delete all: Say "forget everything" or "clear my memories"*`;
        }
    },
    {
        name: 'forget_all',
        description: 'Delete ALL stored memories permanently. Trigger for: forget everything, clear memories, delete all memories, reset memory.',
        parameters: {},
        execute: async () => {
            const success = await memoryManager.clearAll();
            return success ? '✅ All memories cleared successfully! Fresh start.' : '❌ Failed to clear memories.';
        }
    },
    // ==================== NEW SMART APIs FOR CHAT ====================
    {
        name: 'translator',
        description: 'Translate text to any language. Supports 17+ languages. Trigger for: translate, hindi me kya hota hai, meaning in language.',
        parameters: {
            text: { type: 'string', description: 'Text to translate' },
            target_language: { type: 'string', description: 'Target language (e.g., hindi, spanish, french)' }
        },
        execute: async (params) => {
            const { performResearch } = await import('./research');
            const query = `translate "${params.text}" to ${params.target_language}`;
            const result = await performResearch(query);
            return result || 'Translation failed. Try again.';
        }
    },
    {
        name: 'math_solver',
        description: 'Solve advanced math problems including calculus, algebra, derivatives, integrals. Trigger for: solve equation, calculate, derivative, integrate.',
        parameters: {
            expression: { type: 'string', description: 'Math expression to solve (e.g., "3x+5=20", "x^2", "sin(x)")' }
        },
        execute: async (params) => {
            const { performResearch } = await import('./research');
            const result = await performResearch(`solve ${params.expression}`);
            return result || 'Could not solve. Check your expression.';
        }
    },
    {
        name: 'earthquake_tracker',
        description: 'Get real-time earthquake data worldwide (magnitude ≥4.0). Trigger for: earthquake, recent quakes, bhukamp.',
        parameters: {},
        execute: async () => {
            const { performResearch } = await import('./research');
            const result = await performResearch('recent earthquakes');
            return result || 'No recent earthquakes found.';
        }
    },
    {
        name: 'holiday_checker',
        description: 'Check upcoming public holidays for any country. Trigger for: holidays, next holiday, chutti kab hai.',
        parameters: {
            country: { type: 'string', description: 'Country code (IN, US, UK, CA, etc.). Default: IN' }
        },
        execute: async (params) => {
            const { performResearch } = await import('./research');
            const country = params.country || 'IN';
            const result = await performResearch(`holidays in ${country}`);
            return result || `No holidays found for ${country}.`;
        }
    },
    {
        name: 'word_helper',
        description: 'Find rhymes, synonyms, or word definitions. Trigger for: rhyme with, synonym of, define word.',
        parameters: {
            query: { type: 'string', description: 'Word query (e.g., "rhyme with love", "synonym of happy")' }
        },
        execute: async ({ query }) => {
            const { performResearch } = await import('./research');
            const result = await performResearch(query);
            return result || 'No words found. Try a different query.';
        }
    },
    {
        name: 'nobel_lookup',
        description: 'Search Nobel Prize winners by year or category. Trigger for: nobel prize, laureate.',
        parameters: {
            year: { type: 'string', description: 'Year (e.g., 2023)' },
            category: { type: 'string', description: 'Category: physics, chemistry, medicine, literature, peace, economics' }
        },
        execute: async (params) => {
            const { performResearch } = await import('./research');
            const query = `nobel prize ${params.category || ''} ${params.year || new Date().getFullYear()}`;
            const result = await performResearch(query);
            return result || 'No Nobel Prize data found.';
        }
    },
    {
        name: 'life_coach',
        description: 'Get random life advice and wisdom. Trigger for: advice, tip, suggestion, sujhav.',
        parameters: {},
        execute: async () => {
            const { performResearch } = await import('./research');
            const result = await performResearch('give me advice');
            return result || '💡 Stay positive and keep learning!';
        }
    },
    {
        name: 'zen_master',
        description: 'Receive philosophical Zen wisdom and deep quotes. Trigger for: zen quote, wisdom, deep thought, philosophy.',
        parameters: {},
        execute: async () => {
            const { performResearch } = await import('./research');
            const result = await performResearch('zen wisdom');
            return result || '🧘 "The journey of a thousand miles begins with a single step."';
        }
    },
    {
        name: 'youtube_play',
        description: 'Search and play a video or music from YouTube on the side panel (Canvas). Trigger for: "play a song", "show video", "arijit singh gaane", "lofi play".',
        parameters: {
            query: 'string (Search query for the video/song)'
        },
        execute: async ({ query }) => {
            const baseUrl = getBackendUrl();
            try {
                const res = await fetch(`${baseUrl}/api/whisper/youtube`, { // Reusing prompt style proxy
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ query })
                });
                const data = await res.json();
                return data.result || 'YouTube request processed.';
            } catch (e) {
                return `YouTube Client Error: ${e.message}`;
            }
        }
    },
    {
        name: 'show_dashboard',
        description: 'Open the high-tech Dashboard on the side panel. Trigger for: "show dashboard", "mera pc dikhao", "system stats".',
        parameters: {},
        execute: async () => {
            const baseUrl = getBackendUrl();
            try {
                await fetch(`${baseUrl}/api/canvas/visibility`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ visible: true, mode: 'dashboard' })
                });
                return '🖥️ Opening System Dashboard...';
            } catch (e) {
                return `Dashboard Error: ${e.message}`;
            }
        }
    },
    {
        name: 'launch_app',
        description: 'Launch a PC application. Apps supported: chrome, vscode, notepad, terminal, thispc. Trigger for: "chrome kholo", "open notepad", "vscode chalao", "this pc".',
        parameters: {
            app: 'string (The name of the app to launch. Use lowercase: chrome, vscode, notepad, terminal, thispc)'
        },
        execute: async ({ app }) => {
            const baseUrl = getBackendUrl();
            try {
                const res = await fetch(`${baseUrl}/api/system/launch`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ app: app.toLowerCase() })
                });
                const data = await res.json();
                return data.success ? `🚀 Launching **${app}**...` : `Failed to launch ${app}.`;
            } catch (e) {
                return `Launch Error: ${e.message}`;
            }
        }
    },
    {
        name: 'set_system_volume',
        description: 'Change the system volume level (0-100). Trigger for: "volume 50 kar do", "mute kar do", "vol up".',
        parameters: {
            level: 'number (0-100)'
        },
        execute: async ({ level }) => {
            const baseUrl = getBackendUrl();
            try {
                const res = await fetch(`${baseUrl}/api/system/control`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ type: 'volume', value: level })
                });
                const data = await res.json();
                return data.success ? `🔊 Volume set to **${level}%**.` : 'Failed to change volume.';
            } catch (e) {
                return `Volume Error: ${e.message}`;
            }
        }
    },
    // ==================== ADDITIONAL FREE APIs FOR CHAT ====================
    {
        name: 'chuck_norris_joke',
        description: 'Get a random Chuck Norris joke. Trigger for: chuck norris, chuck joke, funny fact.',
        parameters: {},
        execute: async () => {
            const { performResearch } = await import('./research');
            const result = await performResearch('chuck norris joke');
            return result || '😂 Chuck Norris can divide by zero.';
        }
    },
    {
        name: 'random_fact',
        description: 'Get a random useless but true fact. Trigger for: random fact, useless fact, fun fact.',
        parameters: {},
        execute: async () => {
            const { performResearch } = await import('./research');
            const result = await performResearch('random useless fact');
            return result || '🤓 Did you know? A group of flamingos is called a flamboyance.';
        }
    },
    {
        name: 'dog_fact',
        description: 'Get an interesting fact about dogs. Trigger for: dog fact, kutte ke bare me.',
        parameters: {},
        execute: async () => {
            const { performResearch } = await import('./research');
            const result = await performResearch('dog fact');
            return result || '🐶 Dogs have a sense of time and miss you when you\'re gone!';
        }
    },
    {
        name: 'fox_image',
        description: 'Get a cute random fox image. Trigger for: fox, fox image, cute fox.',
        parameters: {},
        execute: async () => {
            const { performResearch } = await import('./research');
            const result = await performResearch('random fox image');
            return result || '🦊 Fox image not available right now.';
        }
    },
    {
        name: 'university_search',
        description: 'Search for top universities in a country. Trigger for: university, college.',
        parameters: {
            country: { type: 'string', description: 'Country code (IN, US, UK, CA, etc.)' }
        },
        execute: async (params) => {
            const { performResearch } = await import('./research');
            const country = params.country || 'IN';
            const result = await performResearch(`universities in ${country}`);
            return result || `No universities found for ${country}.`;
        }
    },
    {
        name: 'bible_verse',
        description: 'Get a Bible verse by reference. Trigger for: bible, verse, john 3:16.',
        parameters: {
            verse: { type: 'string', description: 'Verse reference (e.g., "john 3:16", "psalm 23")' }
        },
        execute: async (params) => {
            const { performResearch } = await import('./research');
            const verse = params.verse || 'john 3:16';
            const result = await performResearch(`bible verse ${verse}`);
            return result || '📖 Bible verse not found.';
        }
    },
    {
        name: 'color_info',
        description: 'Get information about a color by hex code or name. Trigger for: color info, #FF5733.',
        parameters: {
            color: { type: 'string', description: 'Hex color code or color name' }
        },
        execute: async (params) => {
            const { performResearch } = await import('./research');
            const result = await performResearch(`color info ${params.color}`);
            return result || '🎨 Color information not available.';
        }
    },
    {
        name: 'magic_8ball',
        description: 'Ask the magic 8-ball a yes/no question. Trigger for: 8ball, should i, magic ball.',
        parameters: {
            question: { type: 'string', description: 'Your yes/no question' }
        },
        execute: async (params) => {
            const { performResearch } = await import('./research');
            const result = await performResearch(`8ball ${params.question}`);
            return result || '🔮 The answer is unclear. Try again later.';
        }
    },
    {
        name: 'anime_search',
        description: 'Search for anime by title. Trigger for: anime, anime search.',
        parameters: {
            anime_name: { type: 'string', description: 'Name of the anime to search' }
        },
        execute: async (params) => {
            const { performResearch } = await import('./research');
            const result = await performResearch(`anime ${params.anime_name}`);
            return result || '📺 Anime not found.';
        }
    },
    {
        name: 'draw_card',
        description: 'Draw a random playing card from a deck. Trigger for: draw card, random card, patte kheencho.',
        parameters: {},
        execute: async () => {
            const { performResearch } = await import('./research');
            const result = await performResearch('draw random card');
            return result || '🃏 Card deck unavailable.';
        }
    },
    // ==================== AGENT SYSTEM TOOLS (OPENCLAW) ====================
    {
        name: 'read_file',
        description: 'AGENT TOOL: Read the contents of a file on the local system. Requires absolute or relative path.',
        parameters: { targetPath: 'string' },
        execute: async ({ targetPath }) => {
            try {
                const url = `${getBackendUrl()}/api/fs/read`;
                const res = await fetch(url, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ targetPath })
                });
                const data = await res.json();
                if (data.error) return `Error reading file: ${data.error}`;
                return `--- FILE CONTENT of ${targetPath} ---\n${data.content}`;
            } catch (e) {
                return `Failed to connect to backend: ${e.message}`;
            }
        }
    },
    {
        name: 'write_file',
        description: 'AGENT TOOL: Write or overwrite a file with new content on the local system.',
        parameters: { targetPath: 'string', content: 'string' },
        execute: async ({ targetPath, content }) => {
            try {
                const url = `${getBackendUrl()}/api/fs/write`;
                const res = await fetch(url, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ targetPath, content })
                });
                const data = await res.json();
                if (data.error) return `Error writing file: ${data.error}`;
                return `✅ Successfully wrote to ${targetPath}`;
            } catch (e) {
                return `Failed to connect to backend: ${e.message}`;
            }
        }
    },
    {
        name: 'list_directory',
        description: 'AGENT TOOL: List contents of a directory to explore the file system.',
        parameters: { targetPath: 'string', pattern: 'string (optional, e.g., "**/*.js")' },
        execute: async ({ targetPath, pattern }) => {
            try {
                const url = `${getBackendUrl()}/api/fs/list`;
                const res = await fetch(url, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ targetPath, pattern })
                });
                const data = await res.json();
                if (data.error) return `Error listing directory: ${data.error}`;
                return `Directory Contents of ${targetPath}:\n${data.files.join('\n')}`;
            } catch (e) {
                return `Failed to connect to backend: ${e.message}`;
            }
        }
    },
    {
        name: 'run_command',
        description: 'AGENT TOOL: Execute a shell command in the terminal (e.g., npm install, node script.js, dir, ls).',
        parameters: { command: 'string (The shell command to run)', cwd: 'string (optional, current working directory)' },
        execute: async ({ command, cwd }) => {
            try {
                const url = `${getBackendUrl()}/api/terminal/run`;
                const res = await fetch(url, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ command, cwd })
                });
                const data = await res.json();
                let result = `Command: ${command}\n`;
                if (cwd) result += `Directory: ${cwd}\n`;
                if (data.error) result += `❌ Error: ${data.error}\n`;
                if (data.stdout) result += `Standard Output:\n${data.stdout}\n`;
                if (data.stderr) result += `Standard Error:\n${data.stderr}\n`;
                return result;
            } catch (e) {
                return `Failed to execute command: ${e.message}`;
            }
        }
    },
    {
        name: 'read_blackboard',
        description: 'Read the shared project blackboard to see notes, findings, and instructions left by other agents. Use this to catch up on the progress of the project.',
        parameters: {},
        execute: async () => {
            const { readBlackboard } = await import('./agents/blackboard');
            return await readBlackboard();
        }
    },
    {
        name: 'update_blackboard',
        description: 'Post information, findings, or instructions to the shared project blackboard for other agents to see. Persistent globally for the session.',
        parameters: { content: 'string (The notes or data to share)' },
        execute: async ({ content }, env) => {
            const { updateBlackboard } = await import('./agents/blackboard');
            const role = env?.role || 'system';
            const success = await updateBlackboard(role, content);
            return success ? 'Blackboard updated successfully.' : 'Failed to update blackboard.';
        }
    },
    {
        name: 'clear_blackboard',
        description: 'AGENT TOOL: Wipe all notes from the shared project blackboard. Use this to start fresh or cleanup after a task is fully completed.',
        parameters: {},
        execute: async () => {
            const { clearBlackboard } = await import('./agents/blackboard');
            const success = await clearBlackboard();
            return success ? '✅ Blackboard cleared successfully.' : '❌ Failed to clear blackboard.';
        }
    },
    {
        name: 'show_map',
        description: 'Display an interactive, high-tech map of a specific location on the Canvas. Use this to show cities, addresses, or landmarks. Example: show_map(location="Paris, France")',
        parameters: { location: 'string (The name of the place to display)' },
        execute: async ({ location }, _ENV) => {
            console.log(`[show_map] Requesting geocode for: ${location}`);
            try {
                const response = await axios.get(`${getBackendUrl()}/api/system/geocode?location=${encodeURIComponent(location)}`, { timeout: 10000 });
                const data = response.data;
                console.log(`[show_map] Geocode result:`, data);

                if (!data || data.length === 0) return `❌ Location not found: ${location}`;

                const { lat, lon, display_name } = data[0];
                const mapBlock = {
                    id: `map-${Date.now()}`,
                    type: 'map',
                    lat: parseFloat(lat),
                    lng: parseFloat(lon),
                    label: display_name,
                    zoom: 13
                };

                console.log(`[show_map] Pushing block to canvas...`);
                const canvasRes = await axios.post(`${getBackendUrl()}/api/canvas/push`, { blocks: mapBlock });
                
                console.log(`[show_map] Forcing Feed mode...`);
                await axios.post(`${getBackendUrl()}/api/canvas/visibility`, { visible: true, mode: 'feed' });

                if (canvasRes.data.success) {
                    return `✅ Map of ${display_name} is now visible on your interaction Feed.`;
                }
                return '❌ Failed to push map to canvas.';
            } catch (e) {
                console.error(`[show_map] Error:`, e);
                return `❌ Error loading map: ${e.message}. Please check if the backend is running.`;
            }
        }
    },
    {
        name: 'face_swap',
        description: 'Swap the face of a source image onto a target image. Both inputs must be absolute paths to files on the local filesystem. Output will be saved to the specified output path.',
        parameters: {
            source_image_path: 'string (Absolute path to the source face image)',
            target_image_path: 'string (Absolute path to the target image)',
            output_image_path: 'string (Absolute path to save the swapped output image)'
        },
        execute: async ({ source_image_path, target_image_path, output_image_path }, env) => {
            const baseUrl = getBackendUrl();
            if (env && env.reportProgress) env.reportProgress('🎭 Initializing Face Swap...');
            try {
                const res = await fetch(`${baseUrl}/api/faceswap`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        sourceImage: source_image_path,
                        targetImage: target_image_path
                    })
                });

                const data = await res.json();
                if (!res.ok) throw new Error(data.error || 'Face swap request failed.');

                // Copy output image to specified path if it differed
                const targetPublicOutput = `${baseUrl}${data.imageUrl}`;
                
                // Return markdown result
                let md = `✅ **Face Swap Completed!**\n\n`;
                md += `- Source: \`${source_image_path}\`\n`;
                md += `- Target: \`${target_image_path}\`\n`;
                md += `- Output: \`${output_image_path}\`\n\n`;
                md += `![Swapped Image](${data.imageUrl})`;
                return md;
            } catch (e) {
                return `❌ Face Swap failed: ${e.message}`;
            }
        }
    }
];

export const getToolManifest = () => {
    const config = getDynamicSinricConfig();
    const deviceNames = Object.keys(config.devices).filter(name => config.devices[name]);
    const deviceListStr = deviceNames.length > 0 ? deviceNames.join(', ') : "None configured";

    return tools.map(t => {
        let description = t.description;

        if (t.name === 'home_automation') {
            description = `Control smart home devices including handling sequences, delays, and repetitions. Currently configured devices: ${deviceListStr}. Tasks: turn on/off, wait, repeat.`;
        }

        return {
            name: t.name,
            description: description,
            parameters: t.parameters
        };
    });
};

export const initMCPTools = async () => {
    try {
        const url = `${getBackendUrl()}/api/mcp/tools`;
        const res = await fetch(url);
        const data = await res.json();

        if (data.tools && data.tools.length > 0) {
            console.log(`[MCP] Loading ${data.tools.length} dynamic tools...`);

            // Remove any previously loaded MCP tools
            const nonMcpTools = tools.filter(t => !t._isMcpTool);

            const newMcpTools = data.tools.map(mcpTool => ({
                name: mcpTool.name,
                description: mcpTool.description,
                parameters: mcpTool.parameters || {},
                _isMcpTool: true,
                execute: async (args) => {
                    try {
                        const callUrl = `${getBackendUrl()}/api/mcp/call`;
                        const callRes = await fetch(callUrl, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                                serverName: mcpTool._mcpServerName,
                                toolName: mcpTool._mcpToolName,
                                args
                            })
                        });
                        const callData = await callRes.json();
                        if (callData.error) return `MCP Error: ${callData.error}`;
                        return callData.result || "Executed successfully without output.";
                    } catch (e) {
                        return `MCP Server communication failed: ${e.message}`;
                    }
                }
            }));

            tools.length = 0; // Clear the array
            tools.push(...nonMcpTools, ...newMcpTools); // Re-populate

            console.log(`[MCP] Loaded tools:`, newMcpTools.map(t => t.name).join(', '));
        }
    } catch (e) {
        console.warn("[MCP] Failed to connect to MCP backend:", e.message);
    }
};
