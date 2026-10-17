/* global require, process */
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
const { chromium } = require('playwright');
const axios = require('axios');
const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
const { createProxyMiddleware } = require('http-proxy-middleware');
const https = require('https');
const http = require('http');
const { Server } = require('socket.io');
const fs = require('fs-extra');

const { exec } = require('child_process');
const glob = require('glob');
const mcpManager = require('./mcpManager');
const scheduler = require('./scheduler');
const { smartBrowse, deepResearch, jinaFallback } = require('./smartScraper');
const loudness = require('loudness');
const app = express();
const server = http.createServer(app);
const ALLOWED_ORIGINS = ['http://localhost:5173', 'http://127.0.0.1:5173', 'http://localhost:5174', 'http://127.0.0.1:5174', 'http://localhost:5175', 'http://127.0.0.1:5175'];

// --- MIDDLEWARE (Moved to top for all routes) ---
app.use(cors({
    origin: ALLOWED_ORIGINS,
    credentials: true
}));
app.use(morgan('dev'));
app.use(express.json({ limit: '500mb' }));
app.use(express.urlencoded({ extended: true, limit: '500mb' }));
app.use('/swapped', express.static(path.resolve(__dirname, '../public/swapped')));
app.use(express.static(path.resolve(__dirname, '../public')));

// Global API Key Interceptor for Background Tasks
app.use((req, res, next) => {
    const auth = req.headers['authorization'];
    if (auth && auth.startsWith('Bearer ')) {
        const token = auth.substring(7);
        if (token && token.length > 5) {
            process.env.VITE_OLLAMA_CLOUD_API_KEY = token;

            // Persist key to disk for scheduler/background tasks
            const keysFilePath = path.resolve(__dirname, '../brain/api_keys.json');
            fs.ensureDir(path.dirname(keysFilePath))
                .then(() => fs.readJson(keysFilePath).catch(() => ({})))
                .then(keys => {
                    if (keys.VITE_OLLAMA_CLOUD_API_KEY !== token) {
                        keys.VITE_OLLAMA_CLOUD_API_KEY = token;
                        return fs.writeJson(keysFilePath, keys, { spaces: 2 });
                    }
                })
                .catch(err => console.error("[Server] Failed to persist API key:", err.message));
        }
    }
    next();
});

const io = new Server(server, {
    cors: {
        origin: (origin, callback) => {
            // Reflect the origin if it's local
            if (!origin || origin.includes('localhost') || origin.includes('127.0.0.1')) {
                callback(null, true);
            } else {
                callback(null, false);
            }
        },
        methods: ["GET", "POST"],
        credentials: true
    },
    transports: ['polling', 'websocket'],
    allowEIO3: true
});

module.exports = { io }; // Export for other modules

const { analyzeSnapshot } = require('./visionHandler.js');
const PORT = process.env.PORT || 3000;

// --- SETTINGS SYNC (Sync UI model choices with backend) ---
app.get('/api/settings', async (req, res) => {
    try {
        const settingsPath = path.resolve(__dirname, '../brain/settings.json');
        const settings = await fs.readJson(settingsPath).catch(() => ({}));
        res.json(settings);
    } catch (e) {
        res.json({});
    }
});

app.post('/api/settings', async (req, res) => {
    try {
        const settingsPath = path.resolve(__dirname, '../brain/settings.json');
        await fs.ensureDir(path.dirname(settingsPath));
        let existing = {};
        try { existing = await fs.readJson(settingsPath); } catch {}
        const updated = { ...existing, ...req.body, updatedAt: Date.now() };
        await fs.writeJson(settingsPath, updated, { spaces: 2 });
        console.log("[Settings] Synced model settings from UI:", req.body);
        res.json({ success: true, settings: updated });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// --- CURRENCY PROXY ---
app.get('/currency/live', async (req, res) => {
    try {
        const { access_key, currencies, source, format } = req.query;
        // Connect directly to currencylayer API
        const url = `http://api.currencylayer.com/live?access_key=${access_key}&currencies=${currencies}&source=${source}&format=${format}`;
        const response = await axios.get(url);
        res.json(response.data);
    } catch (error) {
        console.error("[Currency Proxy Error]:", error.message);
        res.status(500).json({ success: false, error: { info: error.message } });
    }
});

// Helper: DuckDuckGo Image Scraper (Fallback when Google-This gets rate-limited/blocked)
async function scrapeDuckDuckGoImages(query) {
    try {
        // Step 1: Get VQD token from search page
        const htmlRes = await axios.get(`https://duckduckgo.com/?q=${encodeURIComponent(query)}`, {
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' }
        });
        const vqdMatch = htmlRes.data.match(/vqd=([^&'"]+)/);
        if (!vqdMatch) throw new Error("Could not extract VQD token from DuckDuckGo response");
        const vqd = vqdMatch[1];

        // Step 2: Fetch images JSON from DuckDuckGo's private endpoint
        const url = `https://duckduckgo.com/i.js?q=${encodeURIComponent(query)}&o=json&vqd=${vqd}&f=,,,`;
        const res = await axios.get(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Referer': 'https://duckduckgo.com/'
            }
        });
        const results = res.data.results || [];
        return results.map(r => r.image).filter(url => url && url.startsWith('http'));
    } catch (e) {
        console.error("[DDG Image Scraper Fallback] Failed:", e.message);
        return [];
    }
}

// Helper: Bing Images Scraper (Unfiltered)
async function scrapeBingImages(query) {
    try {
        const cheerio = require('cheerio');
        // adlt=off disables safe search (unfiltered)
        const url = `https://www.bing.com/images/search?q=${encodeURIComponent(query)}&form=HDRSC2&first=1&adlt=off`;
        const res = await axios.get(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.5.0.0 Safari/537.36'
            }
        });
        
        const $ = cheerio.load(res.data);
        const images = [];
        
        $('a.iusc').each((i, el) => {
            const m = $(el).attr('m');
            if (m) {
                try {
                    const parsed = JSON.parse(m);
                    if (parsed && parsed.murl) {
                        images.push(parsed.murl);
                    }
                } catch(e) {}
            }
        });
        
        return images;
    } catch (e) {
        console.warn("[Bing Image Scraper] Failed:", e.message);
        return [];
    }
}

// Helper: Yandex Images Scraper (Unfiltered via Playwright)
async function scrapeYandexImagesPlaywright(query) {
    try {
        const { chromium } = require('playwright-extra');
        const stealth = require('puppeteer-extra-plugin-stealth')();
        chromium.use(stealth);
        
        const browser = await chromium.launch({ headless: true });
        const context = await browser.newContext();
        const page = await context.newPage();
        
        const url = `https://yandex.com/images/search?text=${encodeURIComponent(query)}`;
        
        // Increase timeout and catch any goto timeouts so it doesn't fail the whole function
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(e => {
            console.warn("[Yandex Scraper] Goto timeout/error (ignoring):", e.message);
        });
        
        await page.waitForTimeout(3000); // Wait for dynamic load even if domcontentloaded failed
        
        const images = await page.evaluate(() => {
            const results = [];
            document.querySelectorAll('img.serp-item__thumb').forEach(img => {
                if(img.src && img.src.startsWith('http')) results.push(img.src);
            });
            if(results.length === 0) {
                document.querySelectorAll('img').forEach(img => {
                    if(img.src && img.src.startsWith('http') && img.src.includes('images')) results.push(img.src);
                });
            }
            return Array.from(new Set(results));
        });
        
        await browser.close();
        // Strip the blur and shower parameters to get completely unblurred images
        return images.map(url => url.replace(/&(blur|shower)=\d+/g, ''));
    } catch (e) {
        console.warn("[Yandex Image Scraper] Failed:", e.message);
        return [];
    }
}

// Helper: Wikimedia Commons Image Search
async function searchWikimediaImages(query) {
    try {
        const url = `https://commons.wikimedia.org/w/api.php?action=query&generator=search&gsrnamespace=6&gsrsearch=${encodeURIComponent(query)}&gsrlimit=5&prop=imageinfo&iiprop=url&format=json`;
        const res = await axios.get(url, {
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
            timeout: 8000
        });
        const pages = res.data?.query?.pages || {};
        const imgUrls = [];
        for (const key in pages) {
            const info = pages[key]?.imageinfo?.[0];
            if (info?.url && /\.(jpg|jpeg|png|webp|svg)/i.test(info.url)) {
                imgUrls.push(info.url);
            }
        }
        return imgUrls;
    } catch (e) {
        console.warn("[Wikimedia Image Search] Failed:", e.message);
        return [];
    }
}

// Web Image Scraper Endpoint (Google-This with Wikimedia & DuckDuckGo Fallback)
app.post('/api/scrape/image', async (req, res) => {
    const { query } = req.body;
    if (!query) return res.status(400).json({ error: 'Query is required' });

    let urls = [];
    try {
        const google = require('googlethis');
        // Fetch images using googlethis (safe=false to avoid missing results for general queries)
        const images = await google.image(query, { safe: false });

        if (images && images.length > 0) {
            const blockedDomains = ['tiktok.com', 'tiktokv.com', 'byteoversea.com'];
            urls = images
                .map(img => {
                    let url = img.url;
                    if (url && blockedDomains.some(domain => url.toLowerCase().includes(domain))) {
                        url = `https://images.weserv.nl/?url=${encodeURIComponent(url)}`;
                    }
                    return url;
                })
                .filter(url => url && url.startsWith('http'))
                .slice(0, 5);
        }
    } catch (e) {
        console.warn('[WebImageScraper] Google-This search failed, attempting fallbacks...', e.message);
    }

    // Fallback 1: Yandex Images (Playwright - Truly Unfiltered)
    if (urls.length === 0) {
        try {
            console.log('[WebImageScraper] Attempting Yandex Playwright fallback...');
            const yandexUrls = await scrapeYandexImagesPlaywright(query);
            if (yandexUrls.length > 0) {
                urls = yandexUrls.slice(0, 5);
                console.log(`[WebImageScraper] Successfully retrieved ${urls.length} images via Yandex Images.`);
            }
        } catch (yandexErr) {
            console.error('[WebImageScraper] Yandex fallback failed:', yandexErr.message);
        }
    }

    // Fallback 2: Bing Images (Unfiltered)
    if (urls.length === 0) {
        try {
            console.log('[WebImageScraper] Attempting Bing fallback...');
            const bingUrls = await scrapeBingImages(query);
            if (bingUrls.length > 0) {
                urls = bingUrls.slice(0, 5);
                console.log(`[WebImageScraper] Successfully retrieved ${urls.length} images via Bing Images.`);
            }
        } catch (bingErr) {
            console.error('[WebImageScraper] Bing fallback failed:', bingErr.message);
        }
    }

    // Fallback 2: Wikimedia Commons API
    if (urls.length === 0) {
        try {
            const wikiUrls = await searchWikimediaImages(query);
            if (wikiUrls.length > 0) {
                urls = wikiUrls.slice(0, 5);
                console.log(`[WebImageScraper] Successfully retrieved ${urls.length} images via Wikimedia Commons.`);
            }
        } catch (wikiErr) {
            console.error('[WebImageScraper] Wikimedia fallback failed:', wikiErr.message);
        }
    }

    // Fallback 2: DuckDuckGo API
    if (urls.length === 0) {
        try {
            const fallbackUrls = await scrapeDuckDuckGoImages(query);
            if (fallbackUrls.length > 0) {
                urls = fallbackUrls.slice(0, 5);
                console.log(`[WebImageScraper] Successfully retrieved ${urls.length} images via DuckDuckGo fallback API.`);
            }
        } catch (fallbackErr) {
            console.error('[WebImageScraper] DuckDuckGo fallback API also failed:', fallbackErr.message);
        }
    }

    // Fallback 2: Playwright-based DuckDuckGo Image Scraper
    if (urls.length === 0) {
        let browser;
        try {
            console.log(`[WebImageScraper] Attempting Playwright-based DuckDuckGo image scraping for: "${query}"`);
            const { chromium } = require('playwright-extra');
            const stealth = require('puppeteer-extra-plugin-stealth')();
            chromium.use(stealth);
            const { getRandomUA } = require('./smartScraper');

            browser = await chromium.launch({
                headless: true,
                args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-setuid-sandbox']
            });

            const context = await browser.newContext({
                userAgent: getRandomUA() || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                locale: 'en-US'
            });

            await context.route('**/*.{css,woff,woff2,ttf,eot,mp4,mp3,avi}', route => route.abort());
            await context.route('**/*google-analytics*', route => route.abort());
            await context.route('**/*googletagmanager*', route => route.abort());

            const page = await context.newPage();
            await page.goto(`https://duckduckgo.com/?q=${encodeURIComponent(query)}&iax=images&ia=images`, {
                waitUntil: 'domcontentloaded',
                timeout: 15000
            });

            // Wait until image search results load in DOM
            await page.waitForSelector('img[src*="/iu/?u="]', { timeout: 6000 }).catch(() => { });

            const scraped = await page.evaluate(() => {
                const imgs = Array.from(document.querySelectorAll('img'));
                return imgs
                    .map(img => img.src || img.getAttribute('data-src'))
                    .filter(src => src && src.includes('/iu/?u='));
            });

            if (scraped && scraped.length > 0) {
                // Remove duplicates and slice
                const uniqueUrls = [...new Set(scraped)];
                urls = uniqueUrls.slice(0, 5);
                console.log(`[WebImageScraper] Successfully retrieved ${urls.length} images via Playwright.`);
            }
        } catch (playwrightErr) {
            console.error('[WebImageScraper] Playwright image scraper failed:', playwrightErr.message);
        } finally {
            if (browser) {
                await browser.close().catch(() => { });
            }
        }
    }

    if (urls.length === 0) {
        console.log(`[WebImageScraper] All scrapers failed. Delivering fail-safe image for query: "${query}"`);
        urls = [
            `https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=800&auto=format&fit=crop&q=80`,
            `https://images.unsplash.com/photo-1493225457124-a3eb161ffa5f?w=800&auto=format&fit=crop&q=80`
        ];
    }

    res.json({ urls });
});

// Local Ollama API Proxy (for local models like dolphin-phi)
app.use('/local-ollama', (req, res) => {
    const upstreamPath = req.url;

    const options = {
        hostname: '127.0.0.1',
        port: 11434,
        path: upstreamPath,
        method: req.method,
        headers: {
            'Content-Type': 'application/json',
            'Connection': 'keep-alive',
        }
    };

    const upstream = http.request(options, (upstreamRes) => {
        res.status(upstreamRes.statusCode);
        if (upstreamRes.headers['content-type']) {
            res.setHeader('Content-Type', upstreamRes.headers['content-type']);
        }
        upstreamRes.pipe(res);
    });

    upstream.on('error', (err) => {
        console.error('[local-ollama proxy error]', err.message);
        if (!res.headersSent) {
            res.status(502).json({ error: 'Local Ollama is not running. Please start Ollama desktop app.' });
        }
    });

    if (req.method !== 'GET' && req.method !== 'HEAD') {
        upstream.write(JSON.stringify(req.body));
    }
    upstream.end();
});

// --- CANVAS BRIDGE ---
const canvasBridge = require('./canvasBridge.js');
canvasBridge.initCanvasBridge(io);

// --- BACKEND ORCHESTRATOR BRIDGE ---
const orchestratorBridge = async (query, onChunk, options) => {
    const { planAndExecuteBackend } = require('./orchestrator');
    return await planAndExecuteBackend(query, onChunk, options);
};

// --- VISION API ---
app.post('/api/vision/analyze', async (req, res) => {
    try {
        const { image, prompt } = req.body;
        if (!image) return res.status(400).json({ error: 'Image data required' });

        const analysis = await analyzeSnapshot(image, prompt);
        res.json({ analysis });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/whisper/youtube', async (req, res) => {
    const { query } = req.body;
    try {
        const { searchYouTube } = require('./youtubeService');
        const { pushToCanvas } = require('./canvasBridge');

        const video = await searchYouTube(query);
        pushToCanvas({
            id: 'youtube_player',
            type: 'youtube',
            title: `Playing: ${video.title}`,
            videoId: video.id,
            query: query
        }, true);

        res.json({ result: `🎵 Now playing: **${video.title}**` });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// 2. [NEW] System Dashboard Stats
app.get('/api/system/stats', async (req, res) => {
    try {
        const stats = await canvasBridge.getSystemStats();
        res.json(stats);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// 3. [NEW] Hardware Control (Volume)
app.post('/api/system/control', (req, res) => {
    const { type, value } = req.body;
    const { exec } = require('child_process');

    if (type === 'volume') {
        const vol = Math.min(Math.max(parseInt(value), 0), 100);
        console.log(`[SystemControl] Setting volume to: ${vol}% (via loudness pkg)`);

        loudness.setVolume(vol).catch(err => {
            console.error(`[SystemControl] Loudness Error: ${err.message}`);
        });

        return res.json({ success: true, volume: vol });
    } else {
        res.status(400).json({ error: 'Unsupported control type' });
    }
});

// 3.5 [NEW] Purge All Memory & Swapped Media
app.post('/api/system/purge', async (req, res) => {
    try {
        const brainDir = path.resolve(__dirname, '../brain');
        const filesToClear = [
            'memories.json',
            'automated_jobs.json',
            'telegram_messages.json',
            'screenshot_gallery.json',
            'competitors.json'
        ];
        for (const file of filesToClear) {
            const filePath = path.join(brainDir, file);
            if (await fs.pathExists(filePath)) {
                await fs.writeFile(filePath, '[]');
            }
        }

        // Wipe public/swapped directory contents
        const swappedDir = path.resolve(__dirname, '../public/swapped');
        if (await fs.pathExists(swappedDir)) {
            await fs.emptyDir(swappedDir);
            console.log('[SystemPurge] Cleared public/swapped directory contents.');
        }

        // Clear scratch folder
        const scratchDir = path.resolve(__dirname, '../scratch');
        if (await fs.pathExists(scratchDir)) {
            await fs.emptyDir(scratchDir);
            console.log('[SystemPurge] Cleared scratch directory contents.');
        }

        res.json({ success: true, message: 'All backend memory and swapped assets successfully purged.' });
    } catch (e) {
        console.error('[SystemPurge] Error during purge:', e);
        res.status(500).json({ error: e.message });
    }
});

// 4. [NEW] App Launcher
app.post('/api/system/launch', (req, res) => {
    const { app: appName } = req.body;
    const { exec } = require('child_process');

    let command = '';
    switch (appName.toLowerCase()) {
        case 'chrome': command = 'start chrome'; break;
        case 'notepad': command = 'start notepad'; break;
        case 'vscode': command = 'code'; break;
        case 'terminal': command = 'start powershell'; break;
        case 'thispc': command = 'explorer.exe shell:MyComputerFolder'; break;
        default: return res.status(400).json({ error: 'App not recognized' });
    }

    console.log(`[SystemControl] Launching: ${command}`);
    exec(command, (err) => {
        if (err) console.error(`[SystemControl] Launch warning: ${err.message}`);
    });

    // Always return success if we reached the execute stage
    res.json({ success: true, launched: appName });
});

// 5. [NEW] Geocoding for Map
app.get('/api/system/geocode', async (req, res) => {
    const { location } = req.query;
    if (!location) return res.status(400).json({ error: 'Location required' });

    try {
        const response = await axios.get(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(location)}&limit=1`, {
            headers: {
                'User-Agent': 'LiyaPersonalAssistant/1.0 (contact@liya.ai)'
            }
        });
        res.json(response.data);
    } catch (e) {
        console.error(`[Geocode Error]: ${e.message}`);
        res.status(500).json({ error: e.message });
    }
});

// --- CANVAS & A2UI STATE ---
let canvasState = {
    blocks: [],
    isVisible: false,
    lastUpdate: Date.now()
};

// ==========================================
// PROXY ROUTES (Migrated from vite.config.js)
// ==========================================

// 1. Ollama Cloud API — Native streaming proxy (avoids ECONNRESET with http-proxy-middleware on long streams)
app.use('/cloud-api', (req, res) => {
    // Generous 10-minute socket timeout for massive 32K token generations
    req.setTimeout(600000);
    res.setTimeout(600000);

    const upstreamPath = req.url;
    let authHeader = req.headers['authorization']?.replace('Bearer ', '').trim();
    if (authHeader === 'BACKEND_MANAGED') authHeader = null;
    const apiKey = authHeader || process.env.VITE_OLLAMA_CLOUD_API_KEY;

    const options = {
        hostname: process.env.VITE_OLLAMA_HOST || 'api.ollama.com',
        port: 443,
        path: upstreamPath,
        method: req.method,
        timeout: 600000,
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`,
            'Connection': 'keep-alive',
        }
    };

    const upstream = https.request(options, (upstreamRes) => {
        res.status(upstreamRes.statusCode);
        // Forward essential headers
        if (upstreamRes.headers['content-type']) res.setHeader('Content-Type', upstreamRes.headers['content-type']);
        upstreamRes.pipe(res);
    });

    upstream.on('error', (err) => {
        console.error('[cloud-api proxy error]', err.message);
        if (!res.headersSent) res.status(502).json({ error: 'Cloud proxy error' });
    });

    if (req.method !== 'GET' && req.method !== 'HEAD') {
        upstream.write(JSON.stringify(req.body));
    }
    upstream.end();
});


// 2. Sinric Pro Proxy — Native proxy to handle body re-serialization
app.use('/sinric', (req, res) => {
    const upstreamPath = req.url;
    const apiKey = process.env.VITE_SINRIC_API_KEY;

    const options = {
        hostname: process.env.VITE_SINRIC_HOST || 'api.sinric.pro',
        port: 443,
        path: upstreamPath,
        method: req.method,
        headers: {
            ...req.headers,
            'host': process.env.VITE_SINRIC_HOST || 'api.sinric.pro',
            'Connection': 'keep-alive',
        },
        timeout: 30000
    };

    // Remove headers that might interfere with proxying
    delete options.headers['content-length'];

    const upstream = https.request(options, (upstreamRes) => {
        res.writeHead(upstreamRes.statusCode, upstreamRes.headers);
        upstreamRes.pipe(res, { end: true });
    });

    upstream.on('error', (err) => {
        console.error('[sinric native proxy error]', err.message);
        if (!res.headersSent) {
            res.status(502).json({ error: 'Sinric proxy error', detail: err.message });
        }
    });

    upstream.on('timeout', () => {
        console.error('[sinric native proxy] Request timed out');
        upstream.destroy();
        if (!res.headersSent) {
            res.status(504).json({ error: 'Sinric API timed out' });
        }
    });

    if (req.method !== 'GET' && req.method !== 'HEAD') {
        const bodyStr = JSON.stringify(req.body);
        upstream.setHeader('Content-Length', Buffer.byteLength(bodyStr));
        upstream.write(bodyStr);
        upstream.end();
    } else {
        upstream.end();
    }
});

// 3. NewsAPI Proxy
app.use('/news', createProxyMiddleware({
    target: 'https://newsapi.org',
    changeOrigin: true,
    pathRewrite: { '^/news': '' },
    onProxyReq: (proxyReq, req) => {
        if (process.env.VITE_NEWS_API_KEY) {
            // Append API Key to the query string if missing
            const url = new URL(req.url, 'http://localhost');
            if (!url.searchParams.has('apiKey')) {
                const separator = req.url.includes('?') ? '&' : '?';
                proxyReq.path += `${separator}apiKey=${process.env.VITE_NEWS_API_KEY}`;
            }
        }
    }
}));

// 4. OpenWeather Proxy
app.use('/weather', createProxyMiddleware({
    target: 'https://api.openweathermap.org',
    changeOrigin: true,
    pathRewrite: { '^/weather': '' },
}));

// 5. Knowivate Proxy
app.use('/knowivate', createProxyMiddleware({
    target: 'https://news.knowivate.com',
    changeOrigin: true,
    pathRewrite: { '^/knowivate': '' },
}));

// 5.1 Reddit Proxy (Free)
app.use('/reddit', createProxyMiddleware({
    target: 'https://www.reddit.com',
    changeOrigin: true,
    pathRewrite: { '^/reddit': '' },
    onProxyReq: (proxyReq) => {
        proxyReq.setHeader('User-Agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
        proxyReq.setHeader('Accept', 'application/json');
    }
}));

// 5.2 Google News RSS Proxy (Free)
app.get('/google-news', async (req, res) => {
    try {
        const { hl, gl, ceid } = req.query;
        const url = `https://news.google.com/rss?hl=${hl || 'en-US'}&gl=${gl || 'US'}&ceid=${ceid || 'US:en'}`;
        const response = await axios.get(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
            }
        });
        res.set('Content-Type', 'text/xml');
        res.send(response.data);
    } catch (error) {
        console.error("[Google News Proxy Error]:", error.message);
        res.status(500).send(error.message);
    }
});

// --- A2UI / CANVAS API ---

app.get('/api/canvas/state', (req, res) => {
    res.json(canvasBridge.getCanvasState());
});

app.post('/api/canvas/push', (req, res) => {
    const { blocks, append } = req.body;
    if (blocks) {
        canvasBridge.pushToCanvas(blocks, append);
    }
    res.json({ success: true, state: canvasBridge.getCanvasState() });
});

app.post('/api/canvas/reset', (req, res) => {
    canvasBridge.setCanvasState({ blocks: [], isVisible: false, lastUpdate: Date.now() });
    res.json({ success: true });
});

app.post('/api/canvas/visibility', (req, res) => {
    const state = canvasBridge.getCanvasState();
    state.isVisible = !!req.body.visible;
    if (req.body.mode) state.mode = req.body.mode;
    canvasBridge.setCanvasState(state);
    res.json({ success: true });
});

app.post('/api/canvas/action', (req, res) => {
    const { actionId, payload } = req.body;
    console.log(`[Canvas Action] ${actionId}:`, payload);
    // Broadcast action to the frontend orchestrator/hook
    io.emit('canvas-action', { actionId, payload });
    res.json({ success: true });
});

// --- INTERACTIVE CANVAS: Block Management ---
app.delete('/api/canvas/block/:id', (req, res) => {
    const deleted = canvasBridge.deleteBlock(req.params.id);
    res.json({ success: deleted });
});

app.post('/api/canvas/block/:id/pin', (req, res) => {
    const pinned = canvasBridge.pinBlock(req.params.id);
    res.json({ success: true, pinned });
});

app.post('/api/canvas/reorder', (req, res) => {
    const { orderedIds } = req.body;
    if (!orderedIds || !Array.isArray(orderedIds)) {
        return res.status(400).json({ error: 'orderedIds array required' });
    }
    canvasBridge.reorderBlocks(orderedIds);
    res.json({ success: true });
});

// --- SCHEDULER API ---
app.get('/api/scheduler/jobs', (req, res) => {
    const { getAllJobs } = require('./scheduler');
    res.json({ jobs: getAllJobs() });
});

app.post('/api/scheduler/schedule', (req, res) => {
    const { scheduleJob } = require('./scheduler');
    const { time, frequency, prompt, title, chatId } = req.body;
    const success = scheduleJob(chatId || 'desktop', time, frequency, prompt, title);
    res.json({ success });
});

app.post('/api/scheduler/stop', (req, res) => {
    const { stopJobById } = require('./scheduler');
    const { id } = req.body;
    const success = stopJobById(id);
    res.json({ success });
});

// 6. Currency Proxy (apilayer)
app.use('/currency', createProxyMiddleware({
    target: 'http://apilayer.net/api',
    changeOrigin: true,
    pathRewrite: { '^/currency': '' },
    onProxyReq: (proxyReq, req) => {
        if (process.env.VITE_CURRENCY_API_KEY) {
            const url = new URL(req.url, 'http://localhost');
            if (!url.searchParams.has('access_key')) {
                const separator = req.url.includes('?') ? '&' : '?';
                proxyReq.path += `${separator}access_key=${process.env.VITE_CURRENCY_API_KEY}`;
            }
        }
    }
}));

// 7. DuckDuckGo Proxy
app.use('/ddg', createProxyMiddleware({
    target: process.env.VITE_DDG_API_URL || 'https://api.duckduckgo.com',
    changeOrigin: true,
    pathRewrite: { '^/ddg': '' },
}));

// 8. Wikipedia Proxy
app.use('/wiki', createProxyMiddleware({
    target: process.env.VITE_WIKIPEDIA_API_URL || 'https://en.wikipedia.org/w/api.php',
    changeOrigin: true,
    pathRewrite: { '^/wiki': '' },
    onProxyReq: (proxyReq) => {
        const contact = process.env.VITE_CONTACT_EMAIL || 'contact@liya.ai';
        proxyReq.setHeader('User-Agent', `LiyaResearchBot/2.0 (https://github.com/liya-bot; ${contact})`);
    }
}));

// 9. Arxiv Proxy
app.use('/arxiv', createProxyMiddleware({
    target: process.env.VITE_ARXIV_API_URL || 'http://export.arxiv.org/api',
    changeOrigin: true,
    pathRewrite: { '^/arxiv': '' },
}));

// 9. Note: /scrape proxy removed — it was pointing to itself (localhost:3000) causing infinite loops.

// (Consumer APIs removed for Enterprise/Deep Tech focus)

// --- FACE SWAP API & STATIC ROUTE ---
app.use('/swapped', express.static(path.join(__dirname, '../public/swapped')));

// Global helper to safely decode Base64 data URLs without regex size limits
const decodeBase64 = (base64Str) => {
    if (typeof base64Str !== 'string') return Buffer.alloc(0);
    if (base64Str.startsWith('data:')) {
        const commaIndex = base64Str.indexOf(',');
        if (commaIndex !== -1) {
            return Buffer.from(base64Str.substring(commaIndex + 1), 'base64');
        }
    }
    return Buffer.from(base64Str, 'base64');
};

app.post('/api/faceswap', async (req, res) => {
    try {
        const { sourceImage, targetImage } = req.body;
        if (!sourceImage || !targetImage) {
            return res.status(400).json({ error: 'Both sourceImage and targetImage are required (base64 or local paths).' });
        }

        // Create swapped directory
        const swappedDir = path.resolve(__dirname, '../public/swapped');
        await fs.ensureDir(swappedDir);

        const isFilePath = (str) => typeof str === 'string' && (str.includes('/') || str.includes('\\')) && !str.startsWith('data:');

        const tempId = Date.now();
        await fs.ensureDir(path.resolve(__dirname, '../scratch'));

        let sourcePath = '';
        let isTempSource = false;
        if (isFilePath(sourceImage)) {
            sourcePath = path.resolve(sourceImage);
            if (!(await fs.pathExists(sourcePath))) {
                return res.status(400).json({ error: `Source image path not found: ${sourceImage}` });
            }
        } else {
            const sourceBuffer = decodeBase64(sourceImage);
            sourcePath = path.resolve(__dirname, `../scratch/temp_src_${tempId}.jpg`);
            await fs.writeFile(sourcePath, sourceBuffer);
            isTempSource = true;
        }

        let targetPath = '';
        let isTempTarget = false;
        if (isFilePath(targetImage)) {
            targetPath = path.resolve(targetImage);
            if (!(await fs.pathExists(targetPath))) {
                if (isTempSource) await fs.remove(sourcePath).catch(() => { });
                return res.status(400).json({ error: `Target image path not found: ${targetImage}` });
            }
        } else {
            const targetBuffer = decodeBase64(targetImage);
            targetPath = path.resolve(__dirname, `../scratch/temp_tgt_${tempId}.jpg`);
            await fs.writeFile(targetPath, targetBuffer);
            isTempTarget = true;
        }

        const outputFilename = `swap_${tempId}.jpg`;
        const outputPath = path.join(swappedDir, outputFilename);

        // Execute faceswap.py
        const pythonScript = path.resolve(__dirname, 'bin/faceswap.py');
        const cmd = `python "${pythonScript}" --source "${sourcePath}" --target "${targetPath}" --output "${outputPath}"`;

        console.log(`[FaceSwap] Running command: ${cmd}`);

        exec(cmd, { maxBuffer: 100 * 1024 * 1024 }, async (error, stdout, stderr) => {
            // Clean up temp files in background
            if (isTempSource) fs.remove(sourcePath).catch(() => { });
            if (isTempTarget) fs.remove(targetPath).catch(() => { });

            if (error) {
                console.error(`[FaceSwap Error]: ${stderr || error.message}`);
                const fullErr = (stderr || '') + (stdout || '') + (error.message || '');
                if (fullErr.includes("No face detected in the SOURCE image") || fullErr.includes("No face detected in source image")) {
                    return res.status(400).json({ error: 'No face detected in the source photo. Please upload a clear, front-facing face photo.' });
                }
                if (fullErr.includes("No face detected in the TARGET image")) {
                    return res.status(400).json({ error: 'No face detected in the target photo.' });
                }
                return res.status(500).json({ error: 'Face swap execution failed', detail: stderr || error.message });
            }

            console.log(`[FaceSwap Output]: ${stdout}`);

            // Check if output file was created
            const exists = await fs.pathExists(outputPath);
            if (!exists) {
                return res.status(500).json({ error: 'Face swap script succeeded but output file was not found.' });
            }

            // Return relative URL
            res.json({
                success: true,
                imageUrl: `/swapped/${outputFilename}`,
                logs: stdout
            });
        });

    } catch (e) {
        console.error("[FaceSwap Route Error]:", e);
        res.status(500).json({ error: e.message });
    }
});

app.post('/api/faceswap/detect', async (req, res) => {
    try {
        const { targetImage } = req.body;
        if (!targetImage) {
            return res.status(400).json({ error: 'targetImage is required (base64 or local path).' });
        }

        const cropsDir = path.resolve(__dirname, '../public/swapped/crops');
        await fs.emptyDir(cropsDir).catch(() => { });

        const tempId = Date.now();
        await fs.ensureDir(path.resolve(__dirname, '../scratch'));

        const isFilePath = (str) => typeof str === 'string' && (str.includes('/') || str.includes('\\')) && !str.startsWith('data:');

        let targetPath = '';
        let isTempTarget = false;
        if (isFilePath(targetImage)) {
            targetPath = path.resolve(targetImage);
            if (!(await fs.pathExists(targetPath))) {
                return res.status(400).json({ error: `Target image path not found: ${targetImage}` });
            }
        } else {
            const targetBuffer = decodeBase64(targetImage);
            targetPath = path.resolve(__dirname, `../scratch/temp_detect_${tempId}.jpg`);
            await fs.writeFile(targetPath, targetBuffer);
            isTempTarget = true;
        }

        const pythonScript = path.resolve(__dirname, 'bin/facedetect.py');
        const cmd = `python "${pythonScript}" --image "${targetPath}" --output-dir "${cropsDir}"`;

        console.log(`[FaceSwap Detect] Running command: ${cmd}`);

        exec(cmd, async (error, stdout, stderr) => {
            if (isTempTarget) fs.remove(targetPath).catch(() => { });

            if (error) {
                console.error(`[FaceSwap Detect Error]: ${stderr || error.message}`);
                return res.status(500).json({ error: 'Face detection failed', detail: stderr || error.message });
            }

            try {
                const parts = stdout.split('__DETECTION_JSON__:');
                if (parts.length < 2) {
                    throw new Error("No JSON array found in detector output.");
                }
                const jsonStr = parts[1].trim();
                const faces = JSON.parse(jsonStr);
                res.json({ success: true, faces });
            } catch (jsonErr) {
                console.error(`[FaceSwap Detect JSON Error]:`, jsonErr, `Raw stdout:`, stdout);
                res.status(500).json({ error: 'Failed to parse face detection result.', detail: stdout });
            }
        });
    } catch (e) {
        console.error("[FaceSwap Detect Route Error]:", e);
        res.status(500).json({ error: e.message });
    }
});

app.post('/api/faceswap/multi', async (req, res) => {
    try {
        const { targetImage, mappings } = req.body;
        if (!targetImage || !mappings || Object.keys(mappings).length === 0) {
            return res.status(400).json({ error: 'Both targetImage and a non-empty mappings object are required.' });
        }

        const swappedDir = path.resolve(__dirname, '../public/swapped');
        await fs.ensureDir(swappedDir);

        const tempId = Date.now();
        await fs.ensureDir(path.resolve(__dirname, '../scratch'));

        const isFilePath = (str) => typeof str === 'string' && (str.includes('/') || str.includes('\\')) && !str.startsWith('data:');

        let targetPath = '';
        let isTempTarget = false;
        if (isFilePath(targetImage)) {
            targetPath = path.resolve(targetImage);
            if (!(await fs.pathExists(targetPath))) {
                return res.status(400).json({ error: `Target image path not found: ${targetImage}` });
            }
        } else {
            const targetBuffer = decodeBase64(targetImage);
            targetPath = path.resolve(__dirname, `../scratch/temp_target_multi_${tempId}.jpg`);
            await fs.writeFile(targetPath, targetBuffer);
            isTempTarget = true;
        }

        const tempSourcePaths = [];
        const pythonMappings = {};

        for (const [targetIdx, sourceData] of Object.entries(mappings)) {
            if (!sourceData) continue;

            if (isFilePath(sourceData)) {
                const sPath = path.resolve(sourceData);
                if (await fs.pathExists(sPath)) {
                    pythonMappings[targetIdx] = sPath;
                }
            } else {
                const sourceBuffer = decodeBase64(sourceData);
                const sPath = path.resolve(__dirname, `../scratch/temp_src_multi_${targetIdx}_${tempId}.jpg`);
                await fs.writeFile(sPath, sourceBuffer);
                tempSourcePaths.push(sPath);
                pythonMappings[targetIdx] = sPath;
            }
        }

        const mappingsFilePath = path.resolve(__dirname, `../scratch/temp_mappings_${tempId}.json`);
        await fs.writeJson(mappingsFilePath, pythonMappings);

        const outputFilename = `swap_multi_${tempId}.jpg`;
        const outputPath = path.join(swappedDir, outputFilename);

        const pythonScript = path.resolve(__dirname, 'bin/faceswap.py');
        const cmd = `python "${pythonScript}" --target "${targetPath}" --output "${outputPath}" --mappings "${mappingsFilePath}"`;

        console.log(`[FaceSwap Multi] Running command: ${cmd}`);

        exec(cmd, { maxBuffer: 100 * 1024 * 1024 }, async (error, stdout, stderr) => {
            if (isTempTarget) fs.remove(targetPath).catch(() => { });
            fs.remove(mappingsFilePath).catch(() => { });
            for (const sPath of tempSourcePaths) {
                fs.remove(sPath).catch(() => { });
            }

            if (error) {
                console.error(`[FaceSwap Multi Error]: ${stderr || error.message}`);
                const fullErr = (stderr || '') + (stdout || '') + (error.message || '');
                if (fullErr.includes("No face detected in source image")) {
                    return res.status(400).json({ error: 'No face detected in one of the source face photos. Please upload clear, front-facing face photos.' });
                }
                return res.status(500).json({ error: 'Multi-Face swap execution failed', detail: stderr || error.message });
            }

            console.log(`[FaceSwap Multi Output]: ${stdout}`);

            const exists = await fs.pathExists(outputPath);
            if (!exists) {
                return res.status(500).json({ error: 'Multi-Face swap script succeeded but output file not found.' });
            }

            res.json({
                success: true,
                imageUrl: `/swapped/${outputFilename}`,
                logs: stdout
            });
        });
    } catch (e) {
        console.error("[FaceSwap Multi Route Error]:", e);
        res.status(500).json({ error: e.message });
    }
});

app.post('/api/faceswap/video/detect', async (req, res) => {
    try {
        const { targetVideo } = req.body;
        if (!targetVideo) {
            return res.status(400).json({ error: 'targetVideo is required (base64 or local path).' });
        }

        const cropsDir = path.resolve(__dirname, '../public/swapped/crops');
        await fs.emptyDir(cropsDir).catch(() => { });

        const tempId = Date.now();
        await fs.ensureDir(path.resolve(__dirname, '../scratch'));

        const isFilePath = (str) => typeof str === 'string' && (str.includes('/') || str.includes('\\')) && !str.startsWith('data:');

        let isGif = false;
        let videoBuffer = null;
        let isTempVideo = false;
        let videoPath = '';

        if (isFilePath(targetVideo)) {
            videoPath = path.resolve(targetVideo);
            if (!(await fs.pathExists(videoPath))) {
                return res.status(400).json({ error: `Target video path not found: ${targetVideo}` });
            }
            const lowerTarget = targetVideo.toLowerCase();
            isGif = lowerTarget.endsWith('.gif') || lowerTarget.endsWith('.webp');
        } else {
            videoBuffer = decodeBase64(targetVideo);
            // Check magic bytes: GIF starts with 'GIF' (Hex: 47 49 46), WEBP starts with 'RIFF' & 'WEBP'
            const isGifBytes = videoBuffer.length > 3 && videoBuffer[0] === 0x47 && videoBuffer[1] === 0x49 && videoBuffer[2] === 0x46;
            const isWebpBytes = videoBuffer.length > 11 && videoBuffer[0] === 0x52 && videoBuffer[1] === 0x49 && videoBuffer[2] === 0x46 && videoBuffer[3] === 0x46 && videoBuffer[8] === 0x57 && videoBuffer[9] === 0x45 && videoBuffer[10] === 0x42 && videoBuffer[11] === 0x50;
            isGif = isGifBytes || isWebpBytes;
            const ext = isWebpBytes ? 'webp' : (isGifBytes ? 'gif' : 'mp4');
            videoPath = path.resolve(__dirname, `../scratch/temp_vid_detect_${tempId}.${ext}`);
            await fs.writeFile(videoPath, videoBuffer);
            isTempVideo = true;
        }

        const firstFramePath = path.resolve(__dirname, `../scratch/temp_first_frame_${tempId}.jpg`);

        const extractFrame = () => {
            return new Promise((resolve, reject) => {
                const isWebpOrGif = isGif || videoPath.toLowerCase().endsWith('.webp') || videoPath.toLowerCase().endsWith('.gif');
                const pyCmd = `python -c "from PIL import Image; im=Image.open(r'${videoPath}'); im.seek(0); im.convert('RGB').save(r'${firstFramePath}')"`;
                const ffmpegCmd = `ffmpeg -y -i "${videoPath}" -vframes 1 "${firstFramePath}"`;

                if (isWebpOrGif) {
                    console.log(`[FaceSwap Video Detect] Extracting frame 0 using PIL for WebP/GIF...`);
                    exec(pyCmd, (pyErr) => {
                        if (!pyErr && fs.existsSync(firstFramePath)) return resolve();
                        console.log(`[FaceSwap Video Detect] PIL failed, falling back to FFmpeg...`);
                        exec(ffmpegCmd, (ffErr) => {
                            if (!ffErr && fs.existsSync(firstFramePath)) resolve();
                            else reject(ffErr ? ffErr.message : "Frame extraction failed.");
                        });
                    });
                } else {
                    console.log(`[FaceSwap Video Detect] Extracting first frame with FFmpeg: ${ffmpegCmd}`);
                    exec(ffmpegCmd, (ffErr) => {
                        if (!ffErr && fs.existsSync(firstFramePath)) return resolve();
                        console.log(`[FaceSwap Video Detect] FFmpeg failed, falling back to PIL...`);
                        exec(pyCmd, (pyErr) => {
                            if (!pyErr && fs.existsSync(firstFramePath)) resolve();
                            else reject(pyErr ? pyErr.message : "Frame extraction failed.");
                        });
                    });
                }
            });
        };

        try {
            await extractFrame();
        } catch (extractErr) {
            if (isTempVideo) fs.remove(videoPath).catch(() => { });
            console.error(`[FaceSwap Video Detect Error]: ${extractErr}`);
            return res.status(500).json({ error: 'Failed to extract first frame from video/animation', detail: extractErr });
        }

        const pythonScript = path.resolve(__dirname, 'bin/facedetect.py');
        const cmd = `python "${pythonScript}" --image "${firstFramePath}" --output-dir "${cropsDir}"`;

        console.log(`[FaceSwap Video Detect] Running face detection: ${cmd}`);

        exec(cmd, async (error, stdout, stderr) => {
            if (isTempVideo) fs.remove(videoPath).catch(() => { });
            fs.remove(firstFramePath).catch(() => { });

            if (error) {
                console.error(`[FaceSwap Video Detect Error (Python)]: ${stderr || error.message}`);
                return res.status(500).json({ error: 'Face detection failed', detail: stderr || error.message });
            }

            try {
                const parts = stdout.split('__DETECTION_JSON__:');
                if (parts.length < 2) {
                    throw new Error("No JSON array found in detector output.");
                }
                const jsonStr = parts[1].trim();
                const faces = JSON.parse(jsonStr);
                res.json({ success: true, faces });
            } catch (jsonErr) {
                console.error(`[FaceSwap Video Detect JSON Error]:`, jsonErr, `Raw stdout:`, stdout);
                res.status(500).json({ error: 'Failed to parse first frame detection result.', detail: stdout });
            }
        });
    } catch (e) {
        console.error("[FaceSwap Video Detect Route Error]:", e);
        res.status(500).json({ error: e.message });
    }
});

app.post('/api/faceswap/video/multi', async (req, res) => {
    try {
        const { targetVideo, mappings } = req.body;
        if (!targetVideo || !mappings || Object.keys(mappings).length === 0) {
            return res.status(400).json({ error: 'Both targetVideo and a non-empty mappings object are required.' });
        }

        const swappedDir = path.resolve(__dirname, '../public/swapped');
        await fs.ensureDir(swappedDir);

        const tempId = Date.now();
        await fs.ensureDir(path.resolve(__dirname, '../scratch'));

        const isFilePath = (str) => typeof str === 'string' && (str.includes('/') || str.includes('\\')) && !str.startsWith('data:');

        let isGif = false;
        let videoBuffer = null;
        let isTempVideo = false;
        let videoPath = '';

        if (isFilePath(targetVideo)) {
            videoPath = path.resolve(targetVideo);
            if (!(await fs.pathExists(videoPath))) {
                return res.status(400).json({ error: `Target video path not found: ${targetVideo}` });
            }
            const lowerTarget = targetVideo.toLowerCase();
            isGif = lowerTarget.endsWith('.gif') || lowerTarget.endsWith('.webp');
        } else {
            videoBuffer = decodeBase64(targetVideo);
            // Check magic bytes: GIF starts with 'GIF' (Hex: 47 49 46), WEBP starts with 'RIFF' & 'WEBP'
            const isGifBytes = videoBuffer.length > 3 && videoBuffer[0] === 0x47 && videoBuffer[1] === 0x49 && videoBuffer[2] === 0x46;
            const isWebpBytes = videoBuffer.length > 11 && videoBuffer[0] === 0x52 && videoBuffer[1] === 0x49 && videoBuffer[2] === 0x46 && videoBuffer[3] === 0x46 && videoBuffer[8] === 0x57 && videoBuffer[9] === 0x45 && videoBuffer[10] === 0x42 && videoBuffer[11] === 0x50;
            isGif = isGifBytes || isWebpBytes;
            const ext = isWebpBytes ? 'webp' : (isGifBytes ? 'gif' : 'mp4');
            videoPath = path.resolve(__dirname, `../scratch/temp_tgt_video_${tempId}.${ext}`);
            await fs.writeFile(videoPath, videoBuffer);
            isTempVideo = true;
        }

        const tempSourcePaths = [];
        const pythonMappings = {};

        for (const [targetIdx, sourceData] of Object.entries(mappings)) {
            if (!sourceData) continue;

            if (isFilePath(sourceData)) {
                const sPath = path.resolve(sourceData);
                if (await fs.pathExists(sPath)) {
                    pythonMappings[targetIdx] = sPath;
                }
            } else {
                const sourceBuffer = decodeBase64(sourceData);
                const sPath = path.resolve(__dirname, `../scratch/temp_src_video_${targetIdx}_${tempId}.jpg`);
                await fs.writeFile(sPath, sourceBuffer);
                tempSourcePaths.push(sPath);
                pythonMappings[targetIdx] = sPath;
            }
        }

        const mappingsFilePath = path.resolve(__dirname, `../scratch/temp_mappings_video_${tempId}.json`);
        await fs.writeJson(mappingsFilePath, pythonMappings);

        const outputFilename = `swap_video_${tempId}.${isGif ? 'gif' : 'mp4'}`;
        const outputPath = path.join(swappedDir, outputFilename);

        const pythonScript = path.resolve(__dirname, 'bin/videoswap.py');
        const cmd = `python "${pythonScript}" --target "${videoPath}" --output "${outputPath}" --mappings "${mappingsFilePath}"`;

        console.log(`[FaceSwap Video Multi] Running command: ${cmd}`);

        exec(cmd, { maxBuffer: 100 * 1024 * 1024 }, async (error, stdout, stderr) => {
            if (isTempVideo) fs.remove(videoPath).catch(() => { });
            fs.remove(mappingsFilePath).catch(() => { });
            for (const sPath of tempSourcePaths) {
                fs.remove(sPath).catch(() => { });
            }

            if (error) {
                console.error(`[FaceSwap Video Multi Error]: ${stderr || error.message}`);
                const fullErr = (stderr || '') + (stdout || '') + (error.message || '');
                if (fullErr.includes("No face detected in source image")) {
                    return res.status(400).json({ error: 'No face detected in the source face photo. Please upload a clear, front-facing face photo.' });
                }
                return res.status(500).json({ error: 'Video Face swap execution failed', detail: stderr || error.message });
            }

            console.log(`[FaceSwap Video Multi Output]: ${stdout}`);

            const exists = await fs.pathExists(outputPath);
            if (!exists) {
                return res.status(500).json({ error: 'Video Face swap script succeeded but output file not found.' });
            }

            res.json({
                success: true,
                imageUrl: `/swapped/${outputFilename}`,
                logs: stdout
            });
        });
    } catch (e) {
        console.error("[FaceSwap Video Multi Route Error]:", e);
        res.status(500).json({ error: e.message });
    }
});

app.get('/api/faceswap/history', async (req, res) => {
    try {
        const swappedDir = path.resolve(__dirname, '../public/swapped');
        await fs.ensureDir(swappedDir);

        const files = await fs.readdir(swappedDir);
        const history = [];

        for (const file of files) {
            try {
                const filePath = path.join(swappedDir, file);
                const stat = await fs.stat(filePath);
                if (stat.isFile() && (file.endsWith('.jpg') || file.endsWith('.png') || file.endsWith('.webp') || file.endsWith('.mp4') || file.endsWith('.gif'))) {
                    history.push({
                        name: file,
                        url: `/swapped/${file}`,
                        timestamp: stat.mtimeMs
                    });
                }
            } catch (err) {
                // Ignore single file error
            }
        }

        history.sort((a, b) => b.timestamp - a.timestamp);
        res.json({ success: true, history });
    } catch (e) {
        console.error("[FaceSwap History GET Error]:", e);
        res.status(500).json({ error: e.message });
    }
});

app.delete('/api/faceswap/history', async (req, res) => {
    try {
        const swappedDir = path.resolve(__dirname, '../public/swapped');
        if (await fs.pathExists(swappedDir)) {
            const files = await fs.readdir(swappedDir);
            for (const file of files) {
                if (file !== '.gitkeep') {
                    await fs.remove(path.join(swappedDir, file)).catch(() => {});
                }
            }
        }
        res.json({ success: true, message: 'All FaceSwap history & crops cleared successfully.' });
    } catch (e) {
        console.error("[FaceSwap History DELETE ALL Error]:", e);
        res.status(500).json({ error: e.message });
    }
});

app.delete('/api/faceswap/history/:filename', async (req, res) => {

    try {
        const { filename } = req.params;
        if (filename.includes('/') || filename.includes('\\') || filename.includes('..')) {
            return res.status(400).json({ error: 'Invalid filename' });
        }

        const filePath = path.resolve(__dirname, '../public/swapped', filename);
        if (await fs.pathExists(filePath)) {
            await fs.remove(filePath);
            res.json({ success: true, message: `File ${filename} deleted successfully.` });
        } else {
            res.status(404).json({ error: `File ${filename} not found.` });
        }
    } catch (e) {
        console.error("[FaceSwap History DELETE Error]:", e);
        res.status(500).json({ error: e.message });
    }
});

// Global Debug Logger
app.use((req, res, next) => {
    if (req.url.startsWith('/api/fs')) {
        console.log(`[DEBUG:FS] ${req.method} ${req.url} - Body:`, JSON.stringify(req.body));
    }
    next();
});

// ==========================================
// SYSTEM ACCESS APIs (OpenClaw Multi-Agent Features)
// ==========================================

// --- SAFE PATH VALIDATION ---
const SAFE_ROOTS = [
    path.resolve(__dirname, '..'),  // Project root
    path.resolve(process.env.LIYA_WORKSPACE || path.join(require('os').homedir(), 'Documents')),
    path.resolve(path.join(require('os').homedir(), 'Desktop')) // Allowed Desktop
];

function isSafePath(targetPath) {
    const resolved = path.resolve(targetPath);
    // Flexible check: if the path has 'desktop' in it, allow it.
    // This helps when the LLM guesses the desktop path differently (e.g. /home/desktop or C:/Users/CurrentUser/Desktop)
    if (resolved.toLowerCase().includes('desktop')) return true;

    return SAFE_ROOTS.some(root => resolved.startsWith(root));
}

function normalizeDesktopPath(targetPath) {
    if (typeof targetPath === 'string' && targetPath.toLowerCase().includes('desktop')) {
        const normalizedPath = targetPath.replace(/\\/g, '/');
        const parts = normalizedPath.split('/');
        const desktopIndex = parts.findIndex(p => p.toLowerCase() === 'desktop');
        if (desktopIndex !== -1) {
            const subPath = parts.slice(desktopIndex + 1);
            return path.join(require('os').homedir(), 'Desktop', ...subPath);
        }
    }
    return targetPath;
}

// 1. Read File
app.post('/api/fs/read', async (req, res) => {
    try {
        let { targetPath } = req.body;
        console.log(`[FS:Read] Request: ${targetPath}`);
        if (!targetPath) return res.status(400).json({ error: 'Target path required' });

        targetPath = normalizeDesktopPath(targetPath);
        const absolutePath = path.resolve(targetPath);
        if (!isSafePath(absolutePath)) {
            console.warn(`[FS:Read] BLOCKED: Path outside sandbox: ${absolutePath}`);
            return res.status(403).json({ error: 'Access denied: path outside allowed directories' });
        }
        console.log(`[FS:Read] Resolved: ${absolutePath}`);

        if (!(await fs.pathExists(absolutePath))) {
            console.warn(`[FS:Read] File not found: ${absolutePath}`);
            return res.json({ content: "" }); // Return empty instead of 404
        }

        const content = await fs.readFile(absolutePath, 'utf8');
        console.log(`[FS:Read] Success. Bytes: ${content.length}`);
        res.json({ content });
    } catch (e) {
        console.error(`[FS:Read] Error:`, e);
        res.status(500).json({ error: e.message });
    }
});

// 2. Write File
app.post('/api/fs/write', async (req, res) => {
    try {
        let { targetPath, content } = req.body;
        if (!targetPath || content === undefined) return res.status(400).json({ error: 'Target path and content required' });

        targetPath = normalizeDesktopPath(targetPath);

        const absolutePath = path.resolve(targetPath);
        if (!isSafePath(absolutePath)) {
            console.warn(`[FS:Write] BLOCKED: Path outside sandbox: ${absolutePath}`);
            return res.status(403).json({ error: 'Access denied: path outside allowed directories' });
        }
        await fs.ensureDir(path.dirname(absolutePath));
        await fs.writeFile(absolutePath, content, 'utf8');
        res.json({ success: true, message: `File written successfully at ${absolutePath}` });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// 3. List Directory / Glob Search
app.post('/api/fs/list', async (req, res) => {
    try {
        let { targetPath, pattern } = req.body;
        if (!targetPath) return res.status(400).json({ error: 'Target path required' });

        targetPath = normalizeDesktopPath(targetPath);
        const absolutePath = path.resolve(targetPath);
        if (!(await fs.pathExists(absolutePath))) {
            return res.status(404).json({ error: 'Directory not found' });
        }

        if (pattern) {
            const globResult = await new Promise((resolve, reject) => {
                glob(pattern, { cwd: absolutePath, absolute: true }, (err, files) => {
                    if (err) reject(err); else resolve(files);
                });
            });
            return res.json({ files: globResult });
        } else {
            const files = await fs.readdir(absolutePath);
            return res.json({ files });
        }
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// 3.5 Load Dynamic Skills (Legacy - Full list)

// --- SECURE DRIVE HOSTING API REMOVED ---

app.get('/api/skills', async (req, res) => {
    try {
        const skillsDir = path.join(__dirname, '..', 'skills');
        if (!(await fs.pathExists(skillsDir))) {
            return res.json({ skillsText: '' });
        }

        const files = await fs.readdir(skillsDir);
        let combinedSkills = '';

        for (const file of files) {
            if (file.endsWith('.md')) {
                const content = await fs.readFile(path.join(skillsDir, file), 'utf8');
                const skillName = file.replace('.md', '');
                combinedSkills += `\n\n### SKILL: ${skillName}\n${content}\n`;
            }
        }

        res.json({ skillsText: combinedSkills });
    } catch (e) {
        console.error("Error loading skills:", e);
        res.status(500).json({ error: e.message });
    }
});

// 3.5.1 Dynamic Skill Index (Auto-scans skills/ folder)
app.get('/api/skills/index', async (req, res) => {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    try {
        const skillsDir = path.join(__dirname, '..', 'skills');
        if (!(await fs.pathExists(skillsDir))) {
            return res.json({ skills: [] });
        }

        const files = await fs.readdir(skillsDir);
        const skills = [];

        for (const file of files) {
            if (file.endsWith('.md')) {
                const content = await fs.readFile(path.join(skillsDir, file), 'utf8');
                const id = file.replace('.md', '');

                // Extract Name (from first # header)
                const nameMatch = content.match(/^# (?:Skill: )?(.*)/m);
                const name = nameMatch ? nameMatch[1].split('(')[0].trim() : id;

                // Extract Description (from Expertise or Behavior)
                const descMatch = content.match(/\*\*Expertise\*\*:\s*(.*)/i) ||
                    content.match(/\*\*Description\*\*:\s*(.*)/i) ||
                    content.match(/Behavior:\s*(.*)/i);
                const description = descMatch ? descMatch[1].trim() : "Custom autonomous skill.";

                skills.push({
                    id,
                    name: name.replace(/_/g, ' '),
                    description: description.length > 100 ? description.substring(0, 97) + '...' : description,
                    path: `skills/${file}`
                });
            }
        }

        res.json({ skills });
    } catch (e) {
        console.error("Error generating dynamic skills index:", e);
        res.status(500).json({ error: e.message });
    }
});

// 3.5.2 Fetch specific skill document
app.get('/api/skills/doc/:name', async (req, res) => {
    try {
        const skillName = req.params.name;
        const skillPath = path.join(__dirname, '..', 'skills', `${skillName}.md`);
        if (await fs.pathExists(skillPath)) {
            const content = await fs.readFile(skillPath, 'utf8');
            return res.json({ name: skillName, doc: content });
        }
        res.status(404).json({ error: 'Skill document not found' });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// 3.6 Load Dynamic Persona (Soul + Identity)
app.get('/api/persona', async (req, res) => {
    try {
        const brainDir = path.join(__dirname, '..', 'brain');
        const soulPath = path.join(brainDir, 'soul.md');
        const identityPath = path.join(brainDir, 'identity.md');

        let persona = '';

        if (await fs.pathExists(soulPath)) {
            persona += await fs.readFile(soulPath, 'utf8');
        }

        if (await fs.pathExists(identityPath)) {
            persona += '\n\n---\n\n' + await fs.readFile(identityPath, 'utf8');
        }

        res.json({ persona });
    } catch (e) {
        console.error("Error loading persona:", e);
        res.status(500).json({ error: e.message });
    }
});

// 4. Run Terminal Command (Restricted)
const BLOCKED_COMMANDS = ['rm -rf /', 'format', 'del /f /s /q', 'mkfs', ':(){', 'shutdown', 'reboot', 'halt'];

app.post('/api/terminal/run', (req, res) => {
    const { command, cwd } = req.body;
    if (!command) return res.status(400).json({ error: 'Command required' });

    // Block dangerous commands
    const cmdLower = command.toLowerCase().trim();
    if (BLOCKED_COMMANDS.some(blocked => cmdLower.includes(blocked))) {
        return res.status(403).json({ error: 'This command is blocked for safety reasons.' });
    }

    const execOptions = { maxBuffer: 1024 * 1024 * 5, timeout: 60000 }; // 5MB limit, 60s timeout
    if (cwd) {
        const resolvedCwd = path.resolve(cwd);
        if (!isSafePath(resolvedCwd)) {
            return res.status(403).json({ error: 'Working directory outside allowed paths.' });
        }
        execOptions.cwd = resolvedCwd;
    }

    exec(command, execOptions, (error, stdout, stderr) => {
        // Return stdout/stderr even if there's an exit code > 0
        res.json({
            error: error ? error.message : null,
            stdout,
            stderr
        });
    });
});

// 4.1 Web Browser Agent (Smart Scraper v2 — Markdown + Stealth + Jina Fallback)
app.post('/api/web/browse', async (req, res) => {
    const { url, action = 'markdown', maxChars, model, takeScreenshot, viewportType, pushToCanvas = false } = req.body;
    if (!url) return res.status(400).json({ error: 'URL required' });

    console.log(`[Browse:v2] Smart browsing: ${url} (Action: ${action}, Model: ${model || 'settings-sync'}, PushToCanvas: ${pushToCanvas})`);

    try {
        const result = await smartBrowse(url, { 
            action, 
            maxChars: maxChars || 15000,
            model,
            takeScreenshot,
            viewportType,
            pushToCanvas
        });
        res.json(result);
    } catch (e) {
        console.error(`[Browse:v2] Error visiting ${url}:`, e.message);
        res.status(500).json({ error: e.message });
    }
});

// 4.1.1 Lightweight Jina Reader (No Playwright, pure HTTP — ultra fast)
app.post('/api/web/jina', async (req, res) => {
    const { url, maxChars } = req.body;
    if (!url) return res.status(400).json({ error: 'URL required' });

    console.log(`[Jina] Reading: ${url}`);
    try {
        const result = await jinaFallback(url, maxChars || 15000);
        res.json(result);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// 4.1.2 Deep Research Engine (Search + Crawl Top N links + Merge into Report)
app.post('/api/web/deep-research', async (req, res) => {
    const { query, maxLinks, maxCharsPerPage } = req.body;
    if (!query) return res.status(400).json({ error: 'Query required' });

    console.log(`[DeepResearch] Starting for: "${query}"`);
    try {
        const result = await deepResearch(query, {
            maxLinks: maxLinks || 3,
            maxCharsPerPage: maxCharsPerPage || 8000
        });
        res.json(result);
    } catch (e) {
        console.error(`[DeepResearch] Error:`, e.message);
        res.status(500).json({ error: e.message });
    }
});

// 4.2 Multi-Engine Web Search v2 (Optimized: Shared Browser, Snippet Extraction, Stealth)
app.post('/api/web/search', async (req, res) => {
    const { query, limit = 5, recency = 'all' } = req.body;
    if (!query) return res.status(400).json({ error: 'Query required' });

    console.log(`[MultiSearch:v2] Searching: "${query}" (Recency: ${recency})`);
    const { getRandomUA } = require('./smartScraper');
    const { chromium } = require('playwright-extra');
    const stealth = require('puppeteer-extra-plugin-stealth')();
    chromium.use(stealth);

    // --- Shared browser for ALL engines (saves ~500MB RAM vs 13 separate browsers) ---
    let browser;
    try {
        browser = await chromium.launch({
            headless: true,
            args: ['--no-sandbox', '--disable-dev-shm-usage']
        });

        const context = await browser.newContext({
            userAgent: getRandomUA(),
            viewport: { width: 1366, height: 768 },
            locale: 'en-US'
        });

        // Block heavy resources for speed
        await context.route('**/*.{png,jpg,jpeg,gif,svg,webp,woff,woff2,ttf,eot,mp4}', route => route.abort());
        await context.route('**/*google-analytics*', route => route.abort());
        await context.route('**/*googletagmanager*', route => route.abort());

        // --- Engine scraper using shared context ---
        async function scrapeEngine(name, url, selector, snippetSelector) {
            let page;
            try {
                page = await context.newPage();
                await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 12000 });
                await page.waitForTimeout(800);

                const results = await page.evaluate(({ selector, snippetSel, max }) => {
                    const links = [];
                    document.querySelectorAll(selector).forEach((el, i) => {
                        if (i < max) {
                            const a = el.querySelector('a[href]');
                            const h = el.querySelector('h2, h3, .title, .result-link, .snippet__title, h2 a');
                            // Snippet extraction
                            const snippetEl = snippetSel ? el.querySelector(snippetSel) : null;
                            const snippet = snippetEl
                                ? snippetEl.innerText.trim().substring(0, 200)
                                : el.innerText.split('\n').filter(l => l.length > 30)[0]?.trim()?.substring(0, 200) || '';

                            if (a && a.href && !a.href.includes('duckduckgo.com/y.js') && !a.href.startsWith('javascript:')) {
                                links.push({
                                    title: (h ? h.innerText : '').split('\n')[0].trim() || 'Result',
                                    url: a.href,
                                    snippet: snippet
                                });
                            }
                        }
                    });
                    return links;
                }, { selector, snippetSel: snippetSelector, max: limit });

                await page.close();
                return results.map(r => ({ ...r, engine: name }));
            } catch (e) {
                if (page) await page.close().catch(() => { });
                console.warn(`[MultiSearch:v2] ${name} failed: ${e.message.substring(0, 80)}`);
                return [];
            }
        }

        // --- Fast Axios-based DuckDuckGo Scraper (Bypasses Headless Captchas) ---
        async function scrapeDDGHtml() {
            try {
                const res = await axios.post(`https://lite.duckduckgo.com/lite/`, `q=${encodeURIComponent(query)}${ddgRecency}`, {
                    headers: {
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
                        'Content-Type': 'application/x-www-form-urlencoded'
                    },
                    timeout: 8000
                });
                const { parseHTML } = require('linkedom');
                const { document } = parseHTML(res.data);
                const links = [];
                document.querySelectorAll('tr').forEach((tr) => {
                    const a = tr.querySelector('.result-snippet');
                    if (a) {
                        const prevTr = tr.previousElementSibling;
                        const titleA = prevTr ? prevTr.querySelector('a.result-url') : null;
                        if (titleA && titleA.href) {
                            links.push({
                                title: titleA.textContent.trim(),
                                url: titleA.href.startsWith('http') ? titleA.href : 'https://' + titleA.href,
                                snippet: a.textContent.trim(),
                                engine: 'DuckDuckGo-Lite'
                            });
                        }
                    }
                });
                return links.slice(0, limit);
            } catch (e) {
                console.warn(`[MultiSearch:v2] DDG HTML failed: ${e.message}`);
                return [];
            }
        }

        // --- Fast API-based Google Scraper (Bypasses Headless Captchas) ---
        async function scrapeGoogleAPI() {
            try {
                const google = require('googlethis');
                const options = {
                    page: 0,
                    safe: false,
                    additional_params: {
                        hl: 'en'
                    }
                };
                if (recency === 'day') options.additional_params.tbs = 'qdr:d';
                else if (recency === 'week') options.additional_params.tbs = 'qdr:w';
                else if (recency === 'month') options.additional_params.tbs = 'qdr:m';
                else if (recency === 'year') options.additional_params.tbs = 'qdr:y';

                const response = await google.search(query, options);
                return response.results.slice(0, limit).map(r => ({
                    title: r.title,
                    url: r.url,
                    snippet: r.description,
                    engine: 'Google'
                }));
            } catch (e) {
                console.warn(`[MultiSearch:v2] Google API failed: ${e.message}`);
                return [];
            }
        }

        // --- Fast API-based Wikipedia Scraper (100% Unblockable) ---
        async function scrapeWikipediaAPI() {
            try {
                const res = await axios.get(`https://en.wikipedia.org/w/api.php`, {
                    params: { action: 'query', list: 'search', srsearch: query, format: 'json', origin: '*' },
                    headers: { 'User-Agent': 'Liya-B2B-Agent/1.0 (contact@liya.ai)' },
                    timeout: 6000
                });
                const searchResults = res.data.query?.search;
                if (!searchResults) return [];
                return searchResults.slice(0, limit).map(item => ({
                    title: item.title + ' - Wikipedia',
                    url: `https://en.wikipedia.org/wiki/${encodeURIComponent(item.title.replace(/ /g, '_'))}`,
                    snippet: item.snippet.replace(/<\/?[^>]+(>|$)/g, ""), // strip HTML tags
                    engine: 'Wikipedia'
                }));
            } catch (e) {
                console.warn(`[MultiSearch:v2] Wikipedia API failed: ${e.message}`);
                return [];
            }
        }

        // Map recency to engine-specific parameters
        let googleRecency = '';
        let ddgRecency = '';
        let bingRecency = '';
        let braveRecency = '';

        if (recency === 'day') {
            googleRecency = '&tbs=qdr:d';
            ddgRecency = '&df=d';
            bingRecency = '&filters=ex1%3a"ez1"';
            braveRecency = '&tf=pd';
        } else if (recency === 'week') {
            googleRecency = '&tbs=qdr:w';
            ddgRecency = '&df=w';
            bingRecency = '&filters=ex1%3a"ez2"';
            braveRecency = '&tf=pw';
        } else if (recency === 'month') {
            googleRecency = '&tbs=qdr:m';
            ddgRecency = '&df=m';
            bingRecency = '&filters=ex1%3a"ez3"';
            braveRecency = '&tf=pm';
        } else if (recency === 'year') {
            googleRecency = '&tbs=qdr:y';
            ddgRecency = '&df=y';
            bingRecency = '&filters=ex1%3a"ez5"';
            braveRecency = '&tf=py';
        }

        // --- Run top reliable engines in parallel (single browser, separate tabs) ---
        const scraperTasks = [
            scrapeGoogleAPI(),
            scrapeDDGHtml(),
            scrapeWikipediaAPI(),
            scrapeEngine('Bing', `https://www.bing.com/search?q=${encodeURIComponent(query)}&setlang=en${bingRecency}`, 'li.b_algo', '.b_caption p, .b_algoSlug'),
            scrapeEngine('Brave', `https://search.brave.com/search?q=${encodeURIComponent(query)}&source=web${braveRecency}`, 'div.snippet, div[data-testid="result"]', '.snippet-description, .snippet-content')
        ];

        const resultsArray = await Promise.allSettled(scraperTasks);
        await browser.close();
        browser = null;

        let allResults = [];
        resultsArray.forEach(r => {
            if (r.status === 'fulfilled' && r.value) {
                allResults = [...allResults, ...r.value];
            }
        });

        // Deduplicate by URL domain+path
        const uniqueMap = new Map();
        allResults.forEach(r => {
            try {
                const key = new URL(r.url).hostname + new URL(r.url).pathname;
                if (!uniqueMap.has(key)) uniqueMap.set(key, r);
            } catch (_) {
                if (!uniqueMap.has(r.url)) uniqueMap.set(r.url, r);
            }
        });
        let results = Array.from(uniqueMap.values()).slice(0, limit * 2);

        // FALLBACK 1: DDG Instant Answer API (if sparse results)
        if (results.length < 2) {
            console.log(`[MultiSearch:v2] Sparse results (${results.length}). Triggering DDG API fallback...`);
            try {
                const apiRes = await axios.get(`https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1`);
                if (apiRes.data.AbstractURL) {
                    results.push({
                        title: apiRes.data.Heading || query,
                        url: apiRes.data.AbstractURL,
                        snippet: apiRes.data.AbstractText,
                        engine: 'DDG-API'
                    });
                }
                // Also grab Related Topics as bonus results
                const relatedTopics = apiRes.data.RelatedTopics || [];
                relatedTopics.slice(0, 3).forEach(topic => {
                    if (topic.FirstURL && topic.Text) {
                        results.push({
                            title: topic.Text.split(' - ')[0] || topic.Text.substring(0, 60),
                            url: topic.FirstURL,
                            snippet: topic.Text,
                            engine: 'DDG-API'
                        });
                    }
                });
            } catch (_) { }
        }

        console.log(`[MultiSearch:v2] Final: ${results.length} results found`);
        res.json({ results: results.slice(0, limit * 2) });

    } catch (e) {
        if (browser) await browser.close().catch(() => { });
        console.error("[MultiSearch:v2] Critical Error:", e.message);
        res.status(500).json({ error: e.message });
    }
});
// 15. Image Proxy (Bypasses CORP/CORS for external news/research images)
app.get('/api/proxy/image', async (req, res) => {
    try {
        const imageUrl = req.query.url;
        if (!imageUrl) return res.status(400).send('URL required');
        if (imageUrl.includes('placeholder')) {
            return res.redirect('https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=400&auto=format&fit=crop&q=80');
        }

        // Direct redirect only for already proxied URLs
        if (imageUrl.includes('weserv.nl')) {
            return res.redirect(imageUrl);
        }

        console.log(`[Image Proxy] Fetching: ${imageUrl}`);
        const response = await axios.get(imageUrl, {
            responseType: 'arraybuffer',
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
                'Accept': 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
                'Accept-Language': 'en-US,en;q=0.9',
                'Referer': imageUrl
            },
            timeout: 8000
        });

        const contentType = response.headers['content-type'];
        res.setHeader('Content-Type', contentType || 'image/jpeg');
        res.setHeader('Cache-Control', 'public, max-age=86400');
        res.send(response.data);
    } catch (e) {
        console.warn(`[Image Proxy] Direct fetch failed for ${req.query.url}: ${e.message}. Redirecting to WSV CDN...`);
        try {
            const weservUrl = `https://images.weserv.nl/?url=${encodeURIComponent(req.query.url)}`;
            return res.redirect(weservUrl);
        } catch {
            res.status(500).send('Failed to proxy image');
        }
    }
});

// 16. Pexels API Proxy
app.post('/api/pexels/search', async (req, res) => {
    try {
        const { query, per_page = 1 } = req.body;
        const PEXELS_KEY = process.env.VITE_PEXELS_API_KEY || '';

        if (!PEXELS_KEY) {
            return res.status(500).json({ error: 'Pexels API key not configured on server' });
        }

        const response = await axios.get('https://api.pexels.com/v1/search', {
            params: { query, per_page },
            headers: { Authorization: PEXELS_KEY },
            timeout: 15000
        });

        res.json(response.data);
    } catch (e) {
        console.error(`[Pexels Proxy] Error searching for ${req.body.query}:`, e.message);
        res.status(500).json({ error: 'Failed to fetch from Pexels' });
    }
});

app.get('/api/mcp/tools', async (req, res) => {
    try {
        const tools = await mcpManager.getTools();
        res.json({ tools });
    } catch (e) {
        console.error("MCP Get Tools Error:", e);
        res.status(500).json({ error: e.message });
    }
});

// 6. Call MCP Tool
app.post('/api/mcp/call', async (req, res) => {
    try {
        const { serverName, toolName, args } = req.body;
        if (!serverName || !toolName) return res.status(400).json({ error: 'serverName and toolName required' });
        const result = await mcpManager.callTool(serverName, toolName, args || {});
        res.json({ result });
    } catch (e) {
        console.error("MCP Call Tool Error:", e);
        res.status(500).json({ error: e.message });
    }
});

// 17. Ollama Tags Proxy (Warmup)
app.get('/api/tags', async (req, res) => {
    try {
        const wHost = process.env.VITE_OLLAMA_HOST || 'api.ollama.com';
        const apiKey = process.env.VITE_OLLAMA_CLOUD_API_KEY;
        const response = await axios.get(`https://${wHost}/api/tags`, {
            headers: { 'Authorization': `Bearer ${apiKey}` },
            timeout: 5000
        });
        res.json(response.data);
    } catch (e) {
        res.status(500).json({ error: 'Warmup failed', detail: e.message });
    }
});




// Ultra-Fast Indian Accent TTS Route
const { indianVoiceEngine } = require('./voiceEngine');

app.post('/api/voice/tts', async (req, res) => {
    try {
        const { text, voice } = req.body;
        if (!text) return res.status(400).json({ error: 'Text required' });

        const audioFilePath = await indianVoiceEngine.synthesizeSpeech(text, voice);
        if (audioFilePath) {
            res.sendFile(audioFilePath);
        } else {
            res.status(500).json({ error: 'TTS Synthesis failed' });
        }
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// Health Check
app.get('/', (req, res) => {
    res.json({ status: 'Liya Backend System Online' });
});

// ⚡ CATCH-ALL 404 LOGGER (CRITICAL FOR DEBUGGING)
app.use((req, res) => {
    console.error(`[SERVER:404] ❌ No route matched: ${req.method} ${req.url}`);
    res.status(404).json({
        error: 'Route not found',
        method: req.method,
        url: req.url,
        help: "Check server.js for route definitions."
    });
});

// Start Server
server.listen(PORT, () => {
    console.log(`\n===========================================`);
    console.log(`🚀 Liya Backend Server Running on Port ${PORT}`);
    console.log(`===========================================\n`);

    // Initialize MCP after the server is listening (keeps event loop alive)
    mcpManager.init().catch(err => console.error('[MCP] Init failed:', err.message));

    // Initialize Scheduler
    try {
        scheduler.initScheduler(null, orchestratorBridge);
        console.log('[Scheduler] Initialized successfully.');
    } catch (e) {
        console.warn('[Scheduler] Init failed:', e.message);
    }


    // Initialize Scratch Folder & Screenshot Gallery Auto-Cleaner (runs on boot and every 10 mins)
    const cleanScratchFolder = async () => {
        try {
            const scratchDir = path.resolve(__dirname, '../scratch');
            if (await fs.pathExists(scratchDir)) {
                const files = await fs.readdir(scratchDir);
                const now = Date.now();
                for (const file of files) {
                    const filePath = path.join(scratchDir, file);
                    try {
                        const stat = await fs.stat(filePath);
                        if (file.startsWith('temp_') || file.includes('.conv.') || (now - stat.mtimeMs > 5 * 60 * 1000)) {
                            await fs.remove(filePath).catch(() => { });
                        }
                    } catch (e) { }
                }
            }

            // Auto-clean screenshot gallery
            const galleryPath = path.resolve(__dirname, '../brain/screenshot_gallery.json');
            if (await fs.pathExists(galleryPath)) {
                await fs.writeFile(galleryPath, '[]');
                console.log('[AutoCleaner] screenshot_gallery.json automatically wiped.');
            }
        } catch (e) {
            console.warn('[AutoCleaner] Error:', e.message);
        }
    };
    cleanScratchFolder();
    setInterval(cleanScratchFolder, 10 * 60 * 1000);
});