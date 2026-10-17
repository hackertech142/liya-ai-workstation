import axios from 'axios';
import { config } from './config';

const API_BASE = import.meta.env.VITE_BACKEND_URL || '';
const api = axios.create({ baseURL: API_BASE });

// --- Constants ---
const MAX_LENGTH = 1500; // Increased token limit
const TIMEOUT_MS = 20000; // Increased timeout

// --- Helper: Playwright Web Search & Crawl ---
const fetchWebCrawl = async (query, env = null) => {
    try {
        console.log(`[Research:DeepCrawl] Initiating deep crawl for: "${query}"`);
        if (env?.onProgress) env.onProgress('Searching for relevant sources...');
        
        // 1. Get Search Results (URLs)
        const searchRes = await api.post('/api/web/search', { query, limit: 3 });
        const results = searchRes.data?.results || [];
        
        if (results.length === 0) return null;

        if (env?.onProgress) env.onProgress(`Found ${results.length} sources. Reading contents...`);

        // 2. Visit top URLs in parallel for full context
        const crawlResults = await Promise.allSettled(results.map(async (res) => {
            try {
                const browseRes = await api.post('/api/web/browse', { 
                    url: res.url, 
                    action: 'text',
                    model: localStorage.getItem('OLLAMA_SMART_MODEL') || undefined
                });
                const fullText = browseRes.data?.text || "";
                return `[Source: ${res.title} (${res.url})]\n${fullText.substring(0, 3000)}`; // Cap at 3k per page
            } catch (e) {
                console.warn(`[DeepCrawl] Failed to visit ${res.url}:`, e.message);
                return null;
            }
        }));

        const combined = crawlResults
            .filter(r => r.status === 'fulfilled' && r.value)
            .map(r => r.value)
            .join('\n\n---\n\n');

        return combined || null;
    } catch (e) {
        console.error("[DeepCrawl Error]:", e.message);
        return null;
    }
};

// --- Helper: Direct URL Content Fetch ---
const fetchPageContent = async (url, env = null) => {
    try {
        console.log(`[Research:Scraper] Direct scraping URL: ${url}`);
        if (env?.onProgress) env.onProgress('Connecting to website...');
        
        // Auto-detect screenshot requirement based on user query
        const queryText = env?.originalQuery || '';
        const takeScreenshot = !!env?.takeScreenshot || /photo|image|screenshot|visual|layout|design|screen shot/i.test(queryText);
        const viewportType = env?.viewportType || 'desktop';

        const browseRes = await api.post('/api/web/browse', { 
            url, 
            action: takeScreenshot ? 'markdown' : 'text',
            takeScreenshot,
            viewportType,
            model: localStorage.getItem('OLLAMA_SMART_MODEL') || undefined
        });
        
        const fullText = takeScreenshot ? (browseRes.data?.markdown || "") : (browseRes.data?.text || "");
        if (!fullText.trim()) return `No content found on the page: ${url}`;
        if (env?.onProgress) env.onProgress('Content retrieved. Preparing for analysis...');
        
        let response = `[Source: Direct Link (${url})]\n${fullText.substring(0, 8000)}`;
        if (browseRes.data?.screenshotPath) {
            response += `\n\n[Canvas Visual Reference]: ${browseRes.data.screenshotPath} (This page screenshot has been displayed on the user's Canvas)`;
        }
        return response;
    } catch (e) {
        console.error("[Scraper Error]:", e.message);
        return `Failed to scrape the website: ${e.message}`;
    }
};

// --- Helper: Clean & Truncate ---
const cleanAndTruncate = (text) => {
    if (!text) return null;
    let clean = text.replace(/<[^>]*>/g, ' ');
    clean = clean.replace(/\s+/g, ' ').trim();
    if (clean.length > MAX_LENGTH) {
        clean = clean.substring(0, MAX_LENGTH) + '...';
    }
    return clean;
};

// --- API: Wikipedia ---
const fetchWiki = async (query) => {
    try {
        const response = await api.get('/wiki', {
            params: {
                action: 'query',
                format: 'json',
                prop: 'extracts',
                exintro: true,
                explaintext: true,
                generator: 'search',
                gsrsearch: query,
                gsrlimit: 1,
                origin: '*'
            },
            timeout: TIMEOUT_MS
        });
        const pages = response.data?.query?.pages;
        if (!pages) return null;
        // The pages object keys are dynamic page IDs
        const pageId = Object.keys(pages)[0];
        if (!pageId || pageId === '-1') return null;
        return `[Source: Wikipedia] ${cleanAndTruncate(pages[pageId].extract)}`;
    } catch (_e) { console.error("[Research API Error]:", _e.message || _e); return null; }
};

// --- API: DuckDuckGo ---
const fetchDDG = async (query) => {
    try {
        const response = await api.get('/ddg', {
            params: { q: query, format: 'json', no_html: 1, skip_disambig: 1 },
            timeout: TIMEOUT_MS
        });
        const abstract = response.data?.AbstractText;
        if (abstract) return `[Source: DuckDuckGo] ${cleanAndTruncate(abstract)}`;
        if (response.data?.RelatedTopics?.[0]?.Text) {
            return `[Source: DuckDuckGo] ${cleanAndTruncate(response.data.RelatedTopics[0].Text)}`;
        }
        return null;
    } catch (_e) { console.error("[Research API Error]:", _e.message || _e); return null; }
};

// --- API: ArXiv ---
export const fetchArXiv = async (_q) => {
    try {
        const response = await axios.get('/arxiv/query', {
            params: { search_query: `all:${_q}`, start: 0, max_results: 1 },
            responseType: 'text',
            timeout: TIMEOUT_MS
        });
        const xml = response.data;
        const titleMatch = xml.match(/<title>([\s\S]*?)<\/title>/g);
        let title = "";
        if (titleMatch && titleMatch.length > 1) {
            title = titleMatch[1].replace(/<\/?title>/g, '').trim();
        }
        const summaryMatch = xml.match(/<summary>([\s\S]*?)<\/summary>/);
        let summary = "";
        if (summaryMatch) summary = summaryMatch[1].trim();

        if (!title || !summary) return null;
        return `[Source: ArXiv] Paper: ${title}. Abstract: ${cleanAndTruncate(summary)}`;
    } catch (_e) { console.error("[Research API Error]:", _e.message || _e); return null; }
};

// --- API: REST Countries ---
const fetchCountry = async (query) => {
    try {
        const response = await axios.get(`/restcountries/name/${query}`, { timeout: TIMEOUT_MS });
        const country = response.data?.[0];
        if (!country) return null;

        const info = `Country: ${country.name.common}. Capital: ${country.capital?.[0]}. Region: ${country.region}. Population: ${country.population}. Languages: ${Object.values(country.languages || {}).join(', ')}.`;
        return `[Source: REST Countries] ${cleanAndTruncate(info)}`;
    } catch (_e) { console.error("[Research API Error]:", _e.message || _e); return null; }
};

// --- API: IP-API ---
const fetchIP = async () => {
    try {
        const response = await axios.get('/ipapi/json', { timeout: TIMEOUT_MS });
        const data = response.data;
        if (!data) return null;
        return `[Source: IP-API] Location: ${data.city}, ${data.regionName}, ${data.country}. IP: ${data.query}. ISP: ${data.isp}.`;
    } catch (_e) { console.error("[Research API Error]:", _e.message || _e); return null; }
};

// --- API: Quotable ---
// --- API: Quotes (DummyJSON) ---
const fetchQuote = async () => {
    try {
        const response = await axios.get('/quotable/quotes/random', { timeout: TIMEOUT_MS });
        const data = response.data;
        if (!data) return null;
        return `[Source: DummyJSON Quotes] "${data.quote}" - ${data.author}`;
    } catch (_e) { console.error("[Research API Error]:", _e.message || _e); return null; }
};

// --- API: Official Joke API ---
const fetchJoke = async () => {
    try {
        const response = await axios.get('/joke/random_joke', { timeout: TIMEOUT_MS });
        const data = response.data;
        if (!data) return null;
        return `[Source: Official Joke] ${data.setup} ... ${data.punchline}`;
    } catch (_e) { console.error("[Research API Error]:", _e.message || _e); return null; }
};

// --- API: PokeAPI ---
const fetchPokemon = async (query) => {
    try {
        const name = query.split(' ').pop().toLowerCase();
        const response = await axios.get(`/pokeapi/pokemon/${name}`, { timeout: TIMEOUT_MS });
        const data = response.data;
        if (!data) return null;
        const types = (data.types || []).map(t => t.type.name).join(', ');
        const abilities = (data.abilities || []).map(a => a.ability.name).join(', ');
        return `[Source: PokeAPI] Pokemon: ${data.name || 'Unknown'}. Types: ${types || 'None'}. Abilities: ${abilities || 'None'}. Height: ${data.height || 'N/A'}, Weight: ${data.weight || 'N/A'}.`;
    } catch (_e) { console.error("[Research API Error]:", _e.message || _e); return null; }
};

const fetchBook = async (query) => {
    try {
        const response = await axios.get('/openlibrary/search.json', {
            params: { q: query, limit: 1 },
            timeout: TIMEOUT_MS
        });
        const book = response.data?.docs?.[0];
        if (!book) return null;
        return `[Source: Open Library] Title: ${book.title}. Author: ${book.author_name?.[0]}. Published: ${book.first_publish_year}.`;
    } catch (_e) { console.error("[Research API Error]:", _e.message || _e); return null; }
};

// --- API: Numbers API ---
const fetchNumberFact = async (query) => {
    try {
        const num = query.match(/\d+/) ? query.match(/\d+/)[0] : 'random';
        // 'math' type is generally safe
        const response = await axios.get(`/numbers/${num}/math`, { timeout: TIMEOUT_MS });
        if (typeof response.data === 'string') {
            return `[Source: Numbers API] ${cleanAndTruncate(response.data)}`;
        }
        return null;
    } catch (_e) { console.error("[Research API Error]:", _e.message || _e); return null; }
};

// --- API: Zippopotam.us ---
const fetchZip = async (query) => {
    try {
        const zip = query.match(/\d{5,}/)?.[0];
        if (!zip) return null;
        const country = zip.length === 6 ? 'in' : 'us';
        const response = await axios.get(`/zippopotam/${country}/${zip}`, { timeout: TIMEOUT_MS });
        const data = response.data;
        if (!data) return null;
        const place = data.places?.[0];
        return `[Source: Zippopotam] ${zip} is ${place['place name']}, ${place['state']}, ${data.country}.`;
    } catch (_e) { console.error("[Research API Error]:", _e.message || _e); return null; }
};

// --- API: Lyrics.ovh ---
const fetchLyrics = async (query) => {
    try {
        const parts = query.split(/by|from/);
        if (parts.length < 2) return null;
        const title = parts[0].trim();
        const artist = parts[1].trim();
        const response = await axios.get(`/lyrics/${artist}/${title}`, { timeout: TIMEOUT_MS });
        const data = response.data;
        if (!data || !data.lyrics) return null;
        return `[Source: Lyrics.ovh] Lyrics: ${cleanAndTruncate(data.lyrics.replace(/\n/g, '. '))}`;
    } catch (_e) { console.error("[Research API Error]:", _e.message || _e); return null; }
}

// --- API: StackExchange ---
const fetchStackExchange = async (query) => {
    try {
        const response = await axios.get('/stackexch/search', {
            params: {
                order: 'desc',
                sort: 'relevance',
                intitle: query,
                site: 'stackoverflow',
                pagesize: 1
            },
            timeout: TIMEOUT_MS
        });
        const item = response.data?.items?.[0];
        if (!item) return null;
        return `[Source: StackOverflow] Discussion: "${item.title}". Link: ${item.link}`;
    } catch (_e) { console.error("[Research API Error]:", _e.message || _e); return null; }
}

// --- API: RoboHash (Image Generator) ---
const fetchRoboHash = (query) => {
    // Direct URL generation, no fetch needed really, but let's return it as a "result"
    const url = `https://robohash.org/${encodeURIComponent(query)}`;
    return `[Source: RoboHash] Here is a robot for "${query}": ![Robot](${url})`;
}

// --- API: QR Code ---
const fetchQRCode = (query) => {
    // Direct URL generation
    const url = `https://api.qrserver.com/v1/create-qr-code/?size=150x150&data=${encodeURIComponent(query)}`;
    return `[Source: QR Code] Here is the QR Code for "${query}": ![QR Code](${url})`;
}


// --- API: Dictionary ---
const fetchDictionary = async (word) => {
    try {
        const response = await axios.get(`/dictionary/${word}`, { timeout: TIMEOUT_MS });
        const data = response.data[0];
        if (!data) return null;
        const meaning = data.meanings[0];
        const def = meaning.definitions[0].definition;
        return `[Source: Dictionary] **${data.word}** (${meaning.partOfSpeech}): ${def}`;
    } catch (_) { // eslint-disable-line no-unused-vars
        // Silent catch for dictionary 404s (common for names/places)
        return null;
    }
};

// --- API: ISS Location ---
const fetchISS = async () => {
    try {
        const response = await axios.get('/iss/25544', { timeout: TIMEOUT_MS });
        const data = response.data;
        if (!data) return null;
        // Generate a static map link or just coords
        return `[Source: ISS Tracker] 🛰️ **International Space Station**\n- Latitude: ${data.latitude?.toFixed(4) || 'N/A'}\n- Longitude: ${data.longitude?.toFixed(4) || 'N/A'}\n- Altitude: ${data.altitude?.toFixed(2) || 'N/A'}km\n- Velocity: ${data.velocity?.toFixed(0) || 'N/A'} km/h`;
    } catch (_e) { console.error("[Research API Error]:", _e.message || _e); return null; }
};

// --- API: Food/Recipe ---
const fetchFood = async () => {
    try {
        const response = await axios.get('/food/random.php', { timeout: TIMEOUT_MS });
        const meal = response.data.meals[0];
        if (!meal) return null;
        return `[Source: Chef Liya] 🍲 **${meal.strMeal}** (${meal.strArea} ${meal.strCategory})\nInstructions: ${meal.strInstructions.substring(0, 300)}...\n[Image](${meal.strMealThumb})`;
    } catch (_e) { console.error("[Research API Error]:", _e.message || _e); return null; }
};

// --- API: Bhagavad Gita ---
const fetchGita = async () => {
    try {
        // Random Chapter 1-18, Random Verse 1-20 (approx)
        const ch = Math.floor(Math.random() * 18) + 1;
        const sl = Math.floor(Math.random() * 20) + 1;
        const response = await axios.get(`/gita/slok/${ch}/${sl}`, { timeout: TIMEOUT_MS });
        const data = response.data;
        if (!data) return null;
        return `[Source: Bhagavad Gita] 🕉️ **Chapter ${ch}, Verse ${sl}**\n"${data.slok}"\n\n*Meaning:* ${data.tej.ht}`; // Hindi translation preferred by user context
    } catch (_e) { console.error("[Research API Error]:", _e.message || _e); return null; }
};

// --- API: Trivia ---
const fetchTrivia = async () => {
    try {
        const response = await axios.get('/trivia/api.php?amount=1&type=multiple', { timeout: TIMEOUT_MS });
        const q = response.data.results[0];
        if (!q) return null;
        return `[Source: Trivia] 🧠 **Question:** ${q.question}\n**Answer:** ||${q.correct_answer}||`;
    } catch (_e) { console.error("[Research API Error]:", _e.message || _e); return null; }
};

// --- API: Is It Up? ---
const fetchIsItUp = async (domain) => {
    try {
        const response = await axios.get(`/isitup/${domain}.json`, { timeout: TIMEOUT_MS });
        const data = response.data;
        return `[Source: IsItUp] 🌐 **${domain}** is ${data.status_code === 1 ? '✅ UP' : '❌ DOWN'}. Response time: ${data.response_ip ? 'N/A' : 'Unknown'}`;
    } catch (_e) { console.error("[Research API Error]:", _e.message || _e); return null; }
};



const fetchHistory = async () => {
    try {
        const date = new Date();
        const response = await axios.get(`/history/${date.getMonth() + 1}/${date.getDate()}`, { timeout: TIMEOUT_MS });
        const data = response.data;
        const events = data?.data?.Events;
        if (!events || events.length === 0) return null;
        const event = events[Math.floor(Math.random() * events.length)];
        return `[Source: History] 📜 **On this day in ${event.year}**: ${event.text}`;
    } catch (_e) { console.error("[Research API Error]:", _e.message || _e); return null; }
};

// --- API: City & Population (Open-Meteo) ---
const fetchCity = async (query) => {
    try {
        const response = await axios.get('/openmeteo/search', {
            params: { name: query, count: 1, language: 'en', format: 'json' },
            timeout: TIMEOUT_MS
        });
        const city = response.data?.results?.[0];
        if (!city) return null;
        return `[Source: Open-Meteo] 🏙️ **${city.name}** (${city.country})\nLat: ${city.latitude}, Long: ${city.longitude}\nElevation: ${city.elevation}m\nPopulation: ${city.population || 'Unknown'}\nTimezone: ${city.timezone}`;
    } catch (_e) { console.error("[Research API Error]:", _e.message || _e); return null; }
};

// --- API: Crypto (CoinGecko) ---
const fetchCrypto = async (query) => {
    try {
        const map = { 'bitcoin': 'bitcoin', 'btc': 'bitcoin', 'ethereum': 'ethereum', 'eth': 'ethereum', 'dogecoin': 'dogecoin', 'doge': 'dogecoin', 'solana': 'solana', 'sol': 'solana' };
        const id = map[query.toLowerCase()] || query.toLowerCase();
        const response = await axios.get('/coingecko/simple/price', {
            params: { ids: id, vs_currencies: 'inr,usd' },
            timeout: TIMEOUT_MS
        });
        const data = response.data[id];
        if (!data) return null;
        return `[Source: CoinGecko] 🪙 **${query.toUpperCase()} Price:**\n₹${data.inr} INR\n$${data.usd} USD`;
    } catch (_e) { console.error("[Research API Error]:", _e.message || _e); return null; }
};

// --- API: Fiat Currency ---
const fetchCurrency = async (query) => {
    try {
        // Query format expected: "USD to INR" or just "USD" (defaults to INR)
        // Using Open Exchange Rates or similar free proxy if available, or fallback to math/static if no key.
        // Actually, we configured /currency -> http://apilayer.net/api in vite config but that needs a key.
        // Let's use a public open API for currency: frankfurter.app
        const parts = query.toUpperCase().split(' TO ');
        const from = parts[0].trim();
        const to = parts[1] ? parts[1].trim() : 'INR';

        const response = await axios.get(`${import.meta.env.VITE_FRANKFURTER_API_URL || 'https://api.frankfurter.app/latest'}?amount=1&from=${from}&to=${to}`);
        const rate = response.data.rates[to];
        if (!rate) return null;

        return `[Source: Frankfurter] 💱 **Exchange Rate:**\n1 ${from} = ${rate} ${to}\n(Date: ${response.data.date})`;
    } catch (_e) { console.error("[Research API Error]:", _e.message || _e); return null; }
};

// --- API: Real Photo Search (Wikipedia) ---
// fetchFact removed as it was unused
export const fetchWikiImage = async (_query) => {
    try {
        console.log(`[Research] Looking for photo of: ${_query}`);
        const searchRes = await axios.get(import.meta.env.VITE_WIKIPEDIA_API_URL || 'https://en.wikipedia.org/w/api.php', {
            params: { action: 'query', list: 'search', srsearch: _query, format: 'json', origin: '*' },
            timeout: TIMEOUT_MS
        });
        const title = searchRes.data.query.search[0]?.title;
        if (!title) {
            return `[Source: Liya] 🖼️ **No photo found.** I couldn't find a Wikipedia page for "${_query}".`;
        }

        const imgRes = await axios.get(import.meta.env.VITE_WIKIPEDIA_API_URL || 'https://en.wikipedia.org/w/api.php', {
            params: { action: 'query', titles: title, prop: 'pageimages', format: 'json', piprop: 'original', origin: '*' },
            timeout: TIMEOUT_MS
        });

        const pages = imgRes.data.query.pages;
        const pageId = Object.keys(pages)[0];
        const imageUrl = pages[pageId]?.original?.source;

        if (!imageUrl) {
            return `[Source: Liya] 🖼️ **No exact photo found for "${title}".** Try "Draw ${title}" if you want AI art.`;
        }

        return `[Source: Wikipedia] 📸 **Photo of ${title}:**\n\n![${title}](${imageUrl})\n\n*(Source: Wikipedia Commons)*`;
    } catch (_) {
        console.error("Wiki Image Error:", _);
        return null;
    }
};

// --- API: Pexels (High Quality Stock Photos) ---
export const fetchPexelsImage = async (query) => {
    try {
        console.log(`[Research] Searching Pexels for: ${query}`);
        // Route through backend proxy to avoid exposing API key in client bundle
        const response = await api.post('/api/pexels/search', { query, per_page: 1 });

        const photo = response.data?.photos?.[0];
        if (!photo) return null;

        return `[DIRECT_IMAGE:${photo.src.medium}|Pexels: ${query} (by ${photo.photographer})]`;
    } catch (_) {
        console.error("Pexels Error:", _);
        return null;
    }
};



// =================== NEW OPEN SOURCE APIS ===================

// --- API: OMDb (Movies & TV) ---
const fetchMovie = async (query) => {
    try {
        const title = query.replace(/movie|film|info|about|details/gi, '').trim();
        const response = await axios.get('/omdb', {
            params: { t: title, apikey: import.meta.env.VITE_OMDB_API_KEY || 'trilogy' },
            timeout: TIMEOUT_MS
        });
        const data = response.data;
        if (data.Error) return null;
        return `[Source: OMDb] 🎬 **${data.Title}** (${data.Year})\n\n**Rating:** ${data.imdbRating}/10 ⭐\n**Genre:** ${data.Genre}\n**Director:** ${data.Director}\n**Cast:** ${data.Actors}\n**Plot:** ${data.Plot}\n\n![${data.Title}](${data.Poster})`;
    } catch (_e) { console.error("[Research API Error]:", _e.message || _e); return null; }
};

// --- API: Dog Images ---
const fetchDogImage = async () => {
    try {
        const response = await axios.get('/dogapi/breeds/image/random', { timeout: TIMEOUT_MS });
        const data = response.data;
        if (!data?.message) return null;
        return `[Source: Dog API] 🐕 **Random Dog:**\n\n![Cute Dog](${data.message})`;
    } catch (_e) { console.error("[Research API Error]:", _e.message || _e); return null; }
};

// --- API: Cat Facts ---
const fetchCatFact = async () => {
    try {
        const response = await axios.get('/catfact/fact', { timeout: TIMEOUT_MS });
        const data = response.data;
        if (!data?.fact) return null;
        return `[Source: Cat Facts] 🐱 **Cat Fact:** ${data.fact}`;
    } catch (_e) { console.error("[Research API Error]:", _e.message || _e); return null; }
};

// --- API: Bored (Activity Suggestions) ---
const fetchActivity = async () => {
    try {
        const response = await axios.get('/bored/activity', { timeout: TIMEOUT_MS });
        const data = response.data;
        if (!data?.activity) return null;
        return `[Source: Bored API] 💡 **Activity Suggestion:**\n\n**${data.activity}**\n\n*Type:* ${data.type} | *Participants:* ${data.participants}`;
    } catch (_e) { console.error("[Research API Error]:", _e.message || _e); return null; }
};

// --- API: Name Analysis (Age + Gender + Nationality) ---
const fetchNameAnalysis = async (query) => {
    try {
        const name = query.replace(/age|gender|nationality|of|name|predict|guess/gi, '').trim().split(' ')[0];
        if (!name) return null;

        const [ageRes, genderRes, nationalityRes] = await Promise.all([
            axios.get('/agify', { params: { name }, timeout: TIMEOUT_MS }),
            axios.get('/genderize', { params: { name }, timeout: TIMEOUT_MS }),
            axios.get('/nationalize', { params: { name }, timeout: TIMEOUT_MS })
        ]);

        const age = ageRes.data?.age || 'Unknown';
        const gender = genderRes.data?.gender || 'Unknown';
        const genderProb = genderRes.data?.probability ? (Number(genderRes.data.probability) * 100).toFixed(0) : 0;
        const countries = nationalityRes.data?.country?.slice(0, 3).map(c => c.country_id).join(', ') || 'Unknown';

        return `[Source: Name Analysis] 🧑 **Analysis for "${name}":**\n\n**Predicted Age:** ${age} years\n**Predicted Gender:** ${gender} (${genderProb}% confident)\n**Likely Nationality:** ${countries}`;
    } catch (_e) { console.error("[Research API Error]:", _e.message || _e); return null; }
};

// --- API: SpaceX Launches ---
const fetchSpaceXLaunch = async (query = "") => {
    try {
        const isStarship = query.toLowerCase().includes('starship');
        
        // If query mentions starship, prefer Wikipedia but fall back aggressively to news search
        if (isStarship) {
            console.log("[Research:SpaceX] Starship detected. Routing to Wiki.");
            const wikiData = await fetchWiki("SpaceX Starship mission");
            if (wikiData && !wikiData.includes("may refer to")) return wikiData;
            
            console.log("[Research:SpaceX] Wiki failed or ambiguous. Falling back to DDG News.");
            return await fetchDDG("SpaceX Starship latest launch news updates");
        }

        const response = await axios.get('/spacex/launches/latest', { timeout: TIMEOUT_MS });
        const data = response.data;
        if (!data?.name) return await fetchDDG("SpaceX Starship latest launch flight results");
        return `[Source: SpaceX] 🚀 **Latest Launch: ${data.name}**\n\n**Date:** ${new Date(data.date_utc).toLocaleDateString()}\n**Success:** ${data.success ? '✅ Yes' : '❌ No'}\n**Details:** ${data.details || 'No details available'}\n\n![${data.name}](${data.links?.patch?.small || ''})`;
    } catch (_e) { 
        console.error("[Research API Error]:", _e.message || _e); 
        // Fallback to DDG if API fails
        return await fetchDDG(query || "SpaceX Latest Launch");
    }
};

// --- API: NASA APOD (Astronomy Picture of the Day) ---
const fetchNasaAPOD = async () => {
    try {
        // Use a more robust check or fallback if NASA_API_KEY is rate limited
        const response = await axios.get('/nasa/planetary/apod', {
            params: { api_key: import.meta.env.VITE_NASA_API_KEY || 'DEMO_KEY' },
            timeout: TIMEOUT_MS
        });
        const data = response.data;
        if (!data?.url) return null;
        return `[Source: NASA] 🌌 **Astronomy Picture of the Day**\n\n**${data.title}**\n\n${data.explanation?.substring(0, 500)}...\n\n![${data.title}](${data.url})`;
    } catch (_e) { console.error("[Research API Error]:", _e.message || _e); return null; }
};

// --- API: URL Shortener (is.gd) ---
const fetchShortenUrl = async (query) => {
    try {
        const urlMatch = query.match(/https?:\/\/[^\s]+/);
        if (!urlMatch) return null;
        const response = await axios.get('/isgd/create.php', {
            params: { format: 'json', url: urlMatch[0] },
            timeout: TIMEOUT_MS
        });
        const data = response.data;
        if (!data?.shorturl) return null;
        return `[Source: is.gd] 🔗 **Shortened URL:**\n\nOriginal: ${urlMatch[0]}\n**Short:** ${data.shorturl}`;
    } catch (_e) { console.error("[Research API Error]:", _e.message || _e); return null; }
};

// --- API: Random User (Fake User Data) ---
const fetchRandomUser = async () => {
    try {
        const response = await axios.get('/randomuser/api/', { timeout: TIMEOUT_MS });
        const user = response.data?.results?.[0];
        if (!user) return null;

        const name = `${user.name.first} ${user.name.last}`;
        const location = `${user.location.city}, ${user.location.country}`;

        return `[Source: RandomUser] 🧑 **Fake User Profile:**\n\n**Name:** ${name}\n**Gender:** ${user.gender}\n**Email:** ${user.email}\n**Phone:** ${user.phone}\n**Location:** ${location}\n**Age:** ${user.dob.age} years\n\n![${name}](${user.picture.large})`;
    } catch (_e) { console.error("[Research API Error]:", _e.message || _e); return null; }
};

// ==================== NEW SMART APIs ====================

// --- API: LibreTranslate (Translation) ---
const fetchTranslation = async (query) => {
    try {
        // Parse queries like: "translate X to Y" or "Y me kya hota hai X"
        const toLangMatch = query.match(/to\s+(\w+)/i) || query.match(/(\w+)\s+me\s+kya/i);
        const targetLang = toLangMatch ? toLangMatch[1].toLowerCase() : 'hi'; // default Hindi

        // Extract text to translate
        const text = query.replace(/translate|to|me|kya|hota|hai|\w{2}$/gi, '').trim();
        if (!text) return null;

        const response = await axios.post('/libretranslate/translate', {
            q: text,
            source: 'auto',
            target: targetLang === 'hindi' ? 'hi' : targetLang.slice(0, 2)
        }, { timeout: TIMEOUT_MS });

        return `[Source: LibreTranslate] 🌍 **Translation**\n\n**Original:** ${text}\n**Language:** ${response.data.detectedLanguage?.language || 'auto'} → ${targetLang}\n**Translated:** ${response.data.translatedText}`;
    } catch (_e) { console.error("[Research API Error]:", _e.message || _e); return null; }
};

// --- API: Newton Math (Advanced Calculations) ---
const fetchMathCalculation = async (query) => {
    try {
        // Detect operation: simplify, factor, derive, integrate, zeroes, tangent, area, cos, sin, tan, arccos, arcsin, arctan, abs, log
        let operation = 'simplify';
        const lower = query.toLowerCase();

        if (lower.includes('derivative') || lower.includes('derive')) operation = 'derive';
        else if (lower.includes('integrate') || lower.includes('integral')) operation = 'integrate';
        else if (lower.includes('factor')) operation = 'factor';
        else if (lower.includes('zero') || lower.includes('root')) operation = 'zeroes';
        else if (lower.includes('tangent')) operation = 'tangent';
        else if (lower.includes('area')) operation = 'area';

        // Extract expression (remove operation words)
        const expression = query.replace(/solve|calculate|derivative|integrate|factor|of|the|simplify|find/gi, '', '').trim();
        if (!expression) return null;

        const response = await axios.get(`/newton/${operation}/${encodeURIComponent(expression)}`, { timeout: TIMEOUT_MS });
        return `[Source: Newton Math] 🧮 **Calculation**\n\n**Operation:** ${response.data.operation}\n**Expression:** ${response.data.expression}\n**Result:** ${response.data.result}`;
    } catch (_e) { console.error("[Research API Error]:", _e.message || _e); return null; }
};

// --- API: USGS Earthquake ---
const fetchEarthquake = async (_query) => { // eslint-disable-line
    try {
        const response = await axios.get('/earthquake/query', {
            params: {
                format: 'geojson',
                limit: 5,
                orderby: 'time',
                minmagnitude: 4.0
            },
            timeout: TIMEOUT_MS
        });

        const quakes = response.data?.features;
        if (!quakes || quakes.length === 0) return null;

        const formatted = (quakes || []).slice(0, 3).map(_q => {
            const place = _q.properties?.place || 'Unknown';
            const mag = _q.properties?.mag || 'N/A';
            const time = new Date(_q.properties?.time).toLocaleString();
            return `• **M${mag}** - ${place} (${time})`;
        }).join('\n');

        return formatted ? `[Source: USGS] 🌍 **Recent Earthquakes (M≥4.0):**\n\n${formatted}\n\n*Live data from USGS*` : null;
    } catch (_e) { console.error("[Research API Error]:", _e.message || _e); return null; }
};

// --- API: Nager.Date Public Holidays ---
const fetchHolidays = async (query) => {
    try {
        // Extract country code (default IN for India)
        const countryMatch = query.match(/\b(IN|US|UK|CA|AU|DE|FR|JP|CN|BR|RU)\b/i);
        const countryCode = countryMatch ? countryMatch[1].toUpperCase() : 'IN';
        const year = new Date().getFullYear();

        const response = await axios.get(`/holidays/PublicHolidays/${year}/${countryCode}`, { timeout: TIMEOUT_MS });
        const holidays = response.data;
        if (!holidays || holidays.length === 0) return null;

        // Show next 5 upcoming holidays
        const now = new Date();
        const upcoming = holidays.filter(h => new Date(h.date) >= now).slice(0, 5);

        const formatted = upcoming.map(h => `• **${h.localName}** - ${h.date}`).join('\n');
        return `[Source: Nager.Date] 📅 **Upcoming Holidays (${countryCode}):**\n\n${formatted}`;
    } catch (_e) { console.error("[Research API Error]:", _e.message || _e); return null; }
};

// --- API: Datamuse Word Finder ---
const fetchWordFinder = async (query) => {
    try {
        let endpoint = '/datamuse/words';
        let params = {};

        const lower = query.toLowerCase();
        if (lower.includes('rhyme')) {
            const word = query.replace(/rhyme|rhymes|with|words|that/gi, '').trim();
            params = { rel_rhy: word, max: 10 };
        } else if (lower.includes('synonym') || lower.includes('similar')) {
            const word = query.replace(/synonym|synonyms|similar|of|words/gi, '').trim();
            params = { rel_syn: word, max: 10 };
        } else if (lower.includes('define') || lower.includes('meaning')) {
            const word = query.replace(/define|definition|meaning|of/gi, '').trim();
            params = { sp: word, md: 'd', max: 1 };
        } else {
            return null;
        }

        const response = await axios.get(endpoint, { params, timeout: TIMEOUT_MS });
        const words = response.data;
        if (!words || words.length === 0) return null;

        if (params.md === 'd' && words[0].defs) {
            return `[Source: Datamuse] 📖 **Definition:**\n\n**${words[0].word}**: ${words[0].defs[0]}`;
        }

        const wordList = words.slice(0, 10).map(w => w.word).join(', ');
        return `[Source: Datamuse] 🔤 **Words:** ${wordList}`;
    } catch (_e) { console.error("[Research API Error]:", _e.message || _e); return null; }
};

// --- API: Nobel Prize ---
const fetchNobelPrize = async (query) => {
    try {
        const yearMatch = query.match(/\b(19|20)\d{2}\b/);
        const year = yearMatch ? yearMatch[0] : new Date().getFullYear();

        const categoryMatch = query.match(/\b(physics|chemistry|medicine|literature|peace|economics)\b/i);
        const category = categoryMatch ? categoryMatch[1].toLowerCase() : '';

        const response = await axios.get('/nobelprize/prize.json', {
            params: category ? { year, category } : { year },
            timeout: TIMEOUT_MS
        });

        const prizes = response.data?.prizes;
        if (!prizes || prizes.length === 0) return null;

        const prize = prizes[0];
        const laureates = prize.laureates?.map(l => `${l.firstname} ${l.lastname}`).join(', ') || 'Not awarded';

        return `[Source: Nobel Prize] 🏆 **Nobel Prize ${year}**\n\n**Category:** ${prize.category}\n**Laureates:** ${laureates}\n**Motivation:** ${prize.laureates?.[0]?.motivation || 'N/A'}`;
    } catch (_e) { console.error("[Research API Error]:", _e.message || _e); return null; }
};

// --- API: Advice Slip ---
const fetchAdvice = async () => {
    try {
        const response = await axios.get('/adviceslip/advice', { timeout: TIMEOUT_MS });
        const advice = response.data?.slip?.advice;
        if (!advice) return null;
        return `[Source: Advice Slip] 💡 **Life Advice:**\n\n"${advice}"`;
    } catch (_e) { console.error("[Research API Error]:", _e.message || _e); return null; }
};

// --- API: Zen Quotes (Better than generic quotes) ---
const fetchZenQuote = async () => {
    try {
        const response = await axios.get('/zenquotes/today', { timeout: TIMEOUT_MS });
        const quote = response.data?.[0];
        if (!quote) return null;
        return `[Source: Zen Quotes] 🧘 **Wisdom:**\n\n"${quote.q}"\n\n— ${quote.a}`;
    } catch (_e) { console.error("[Research API Error]:", _e.message || _e); return null; }
};

// --- API: Sunrise-Sunset Times ---
const fetchSunriseSunset = async (_query) => { // eslint-disable-line
    try {
        // Default to Delhi coordinates if no location specified
        const lat = 28.6139; // Delhi
        const lng = 77.2090;

        const response = await axios.get('/sunrise/json', {
            params: { lat, lng, formatted: 0 },
            timeout: TIMEOUT_MS
        });

        const results = response.data?.results;
        if (!results) return null;

        const sunrise = new Date(results.sunrise).toLocaleTimeString();
        const sunset = new Date(results.sunset).toLocaleTimeString();

        return `[Source: Sunrise-Sunset] 🌅 **Sun Times (Delhi):**\n\n**Sunrise:** ${sunrise}\n**Sunset:** ${sunset}\n**Day Length:** ${results.day_length} seconds`;
    } catch (_e) { console.error("[Research API Error]:", _e.message || _e); return null; }
};

// --- API: Dad Jokes (Better jokes!) ---
const fetchDadJoke = async () => {
    try {
        const response = await axios.get('/dadjoke/', {
            headers: { 'Accept': 'application/json' },
            timeout: TIMEOUT_MS
        });
        const joke = response.data?.joke;
        if (!joke) return null;
        return `[Source: Dad Jokes] 😄 ${joke}`;
    } catch (_e) { console.error("[Research API Error]:", _e.message || _e); return null; }
};

// ==================== ADDITIONAL FREE APIs ====================

// --- API: Chuck Norris Jokes ---
const fetchChuckNorrisJoke = async () => {
    try {
        const response = await axios.get('/chucknorris/jokes/random', { timeout: TIMEOUT_MS });
        return `[Source: Chuck Norris] 😂 ${response.data.value}`;
    } catch (_e) { console.error("[Research API Error]:", _e.message || _e); return null; }
};

// --- API: Random Useless Facts ---
const fetchUselessFact = async () => {
    try {
        const response = await axios.get('/uselessfacts/random.json?language=en', { timeout: TIMEOUT_MS });
        return `[Source: Useless Facts] 🤓 ${response.data.text}`;
    } catch (_e) { console.error("[Research API Error]:", _e.message || _e); return null; }
};

// --- API: Dog Facts (Text) ---
const fetchDogFact = async () => {
    try {
        const response = await axios.get('/dogfactapi/facts', { timeout: TIMEOUT_MS });
        const fact = response.data?.data?.[0]?.attributes?.body;
        if (!fact) return null;
        return `[Source: Dog Facts] 🐶 ${fact}`;
    } catch (_e) { console.error("[Research API Error]:", _e.message || _e); return null; }
};

// --- API: Random Fox Image ---
const fetchRandomFox = async () => {
    try {
        const response = await axios.get('/randomfox/floof/', { timeout: TIMEOUT_MS });
        return `[Source: Random Fox] 🦊\n\n![Cute Fox](${response.data.image})`;
    } catch (_e) { console.error("[Research API Error]:", _e.message || _e); return null; }
};

// --- API: University Search ---
const fetchUniversity = async (query) => {
    try {
        // Clean query from "research", "college", "university" etc.
        const cleanName = query.replace(/research|university|college|info|about|details/gi, '').trim();
        const countryMatch = query.match(/\b(US|UK|IN|CA|AU|DE|FR|JP|CN)\b/i);
        const country = countryMatch ? countryMatch[1].toUpperCase() : 'India';

        const response = await axios.get(`/universities/search`, { 
            params: { name: cleanName },
            timeout: TIMEOUT_MS 
        });

        let unis = response.data;
        if (!Array.isArray(unis)) unis = [];

        // If no results for specific name, fallback to country search (original behavior)
        if (unis.length === 0) {
            const fallbackRes = await axios.get(`/universities/search`, { params: { country }, timeout: TIMEOUT_MS });
            unis = fallbackRes.data || [];
        }

        unis = unis.slice(0, 8);
        if (!unis || unis.length === 0) return null;

        const formatted = unis.map(u => `• **${u.name || 'Unknown'}**\n  ${(u.web_pages && u.web_pages[0]) || 'No website'}`).join('\n\n');
        return `[Source: Universities] 🎓 **Results for "${cleanName || country}":**\n\n${formatted}`;
    } catch (_e) { console.error("[Research API Error]:", _e.message || _e); return null; }
};

// --- API: Bible Verse ---
const fetchBibleVerse = async (query) => {
    try {
        const verseMatch = query.match(/(\w+\s+\d+:\d+)/i) || query.match(/(\w+\s+\d+)/i);
        const verse = verseMatch ? verseMatch[1] : 'john 3:16';

        const response = await axios.get(`/bibleapi/${encodeURIComponent(verse)}`, { timeout: TIMEOUT_MS });
        const verses = response.data?.verses;
        if (!Array.isArray(verses)) return null;
        const text = verses.map(v => v.text).join(' ');

        return `[Source: Bible] 📖 **${response.data?.reference || verse}**\n\n"${text}"`;
    } catch (_e) { console.error("[Research API Error]:", _e.message || _e); return null; }
};

// --- API: Color Information ---
const fetchColorInfo = async (query) => {
    try {
        const colorMatch = query.match(/#([0-9A-Fa-f]{6})/);
        const hex = colorMatch ? colorMatch[1] : query.replace(/color|colour|info|about/gi, '').trim();

        const response = await axios.get(`/colorapi/id?hex=${hex}`, { timeout: TIMEOUT_MS });
        const data = response.data;

        return `[Source: Color API] 🎨 **${data.name.value}**\n\n**Hex:** ${data.hex.value}\n**RGB:** rgb(${data.rgb.r}, ${data.rgb.g}, ${data.rgb.b})\n**HSL:** hsl(${data.hsl.h}, ${data.hsl.s}%, ${data.hsl.l}%)`;
    } catch (_e) { console.error("[Research API Error]:", _e.message || _e); return null; }
};

// --- API: Magic 8-Ball ---
const fetchEightBall = async (query) => {
    try {
        const question = query.replace(/8ball|8-ball|magic|should i/gi, '').trim();
        const response = await axios.get(`/eightball/magic/JSON/${encodeURIComponent(question)}`, { timeout: TIMEOUT_MS });
        return `[Source: Magic 8-Ball] 🔮 **Question:** ${question}\n\n**Answer:** ${response.data.magic.answer}`;
    } catch (_e) { console.error("[Research API Error]:", _e.message || _e); return null; }
};

// --- API: Anime Search ---
const fetchAnime = async (query) => {
    try {
        const search = query.replace(/anime|manga/gi, '').trim();
        if (!search) return null;

        const response = await axios.get(`/jikan/anime?q=${encodeURIComponent(search)}&limit=3`, { timeout: TIMEOUT_MS });
        const animeList = response.data?.data;
        if (!animeList || animeList.length === 0) return null;

        const anime = animeList[0];
        const synopsis = anime.synopsis ? anime.synopsis.slice(0, 200) + '...' : 'No synopsis available';

        return `[Source: MyAnimeList] 📺 **${anime.title}**\n\n**Score:** ${anime.score || 'N/A'}/10\n**Episodes:** ${anime.episodes || 'Ongoing'}\n**Status:** ${anime.status}\n\n${synopsis}\n\n![${anime.title}](${anime.images.jpg.image_url})`;
    } catch (_e) { console.error("[Research API Error]:", _e.message || _e); return null; }
};

// --- API: Draw Random Card ---
const fetchCardDraw = async () => {
    try {
        const deckResponse = await axios.get('/deckofcards/api/deck/new/shuffle/?deck_count=1', { timeout: TIMEOUT_MS });
        const deckId = deckResponse.data.deck_id;
        const drawResponse = await axios.get(`/deckofcards/api/deck/${deckId}/draw/?count=1`, { timeout: TIMEOUT_MS });
        const card = drawResponse.data.cards[0];

        return `[Source: Deck of Cards] 🃏 **You drew:**\n\n**${card.value} of ${card.suit}**\n\n![Card](${card.image})`;
    } catch (_e) { console.error("[Research API Error]:", _e.message || _e); return null; }
};

// ==================== ENHANCED RESEARCH REPORT GENERATOR ====================

/**
 * Generates comprehensive, multi-source research reports using AI
 * Collects data from Wikipedia, DuckDuckGo, and specific APIs, then uses Ollama to structure it
 */
// --- Research Source Registry (Configuration) ---
const RESEARCH_SOURCES = [
    // 1. Core Knowledge (Always Active)
    {
        id: 'wiki',
        name: 'Wikipedia',
        category: 'general',
        priority: 'high',
        shouldRun: () => true, // Always run
        execute: fetchWiki
    },
    {
        id: 'ddg',
        name: 'DuckDuckGo',
        category: 'general',
        priority: 'high',
        shouldRun: () => true, // Always run as primary fallback for typos/general info
        execute: fetchDDG
    },
    {
        id: 'stackexchange',
        name: 'StackExchange',
        category: 'tech',
        priority: 'medium',
        shouldRun: (_q) => /code|error|bug|program|dev|api|sdk/i.test(_q),
        execute: fetchStackExchange
    },
    {
        id: 'dictionary',
        name: 'Dictionary',
        category: 'language',
        priority: 'low',
        // STRICT: Run ONLY for single words (no spaces), ensuring no 404s on names like "Mahatma Gandhi"
        shouldRun: (_q) => !_q.includes(' ') && !_q.match(/[0-9]/),
        execute: fetchDictionary
    },

    // 2. Domain-Specific (Smart Triggers)
    {
        id: 'space',
        name: 'SpaceX & NASA',
        category: 'science',
        priority: 'medium',
        shouldRun: (_q) => /space|nasa|rocket|launch|planet|mars|moon|orbit|starship/i.test(_q),
        execute: async (_q) => {
            const low = _q.toLowerCase();
            const isSpacex = low.includes('spacex') || low.includes('starship') || low.includes('rocket') || low.includes('launch');
            const isNasa = low.includes('nasa') || low.includes('apod');
            const isIss = low.includes('iss') || low.includes('space station');
            
            const tasks = [];
            if (isSpacex || (!isNasa && !isIss)) {
                tasks.push(low.includes('starship') ? fetchWiki('SpaceX Starship') : fetchSpaceXLaunch(_q));
            }
            if (isNasa) tasks.push(fetchNasaAPOD());
            if (isIss) tasks.push(fetchISS());

            const results = await Promise.allSettled(tasks);
            return results
                .filter(r => r.status === 'fulfilled' && r.value)
                .map(r => r.value)
                .join('\n\n');
        }
    },
    {
        id: 'movies',
        name: 'Movies (OMDb)',
        category: 'entertainment',
        priority: 'medium',
        shouldRun: (_q) => /movie|film|actor|cinema|director|series/i.test(_q),
        execute: fetchMovie
    },
    {
        id: 'anime',
        name: 'Anime (Jikan)',
        category: 'entertainment',
        priority: 'low',
        shouldRun: (_q) => /anime|manga|otaku|character/i.test(_q),
        execute: fetchAnime
    },
    {
        id: 'university',
        name: 'Universities',
        category: 'education',
        priority: 'low',
        shouldRun: (_q) => /universities in|top universities|colleges in/i.test(_q),
        execute: fetchUniversity
    },
    {
        id: 'country',
        name: 'Country Data',
        category: 'geography',
        priority: 'medium',
        shouldRun: (_q) => /country|population|capital|flag|nation/i.test(_q),
        execute: async (_q) => {
            const clean = _q.replace(/country|capital|of|population|flag/gi, '').trim();
            return clean ? await fetchCountry(clean) : null;
        }
    },
    {
        id: 'crypto',
        name: 'Crypto (CoinGecko)',
        category: 'finance',
        priority: 'medium',
        shouldRun: (_q) => /crypto|bitcoin|eth|coin|token|price/i.test(_q),
        execute: fetchCrypto
    },
    {
        id: 'earthquake',
        name: 'USGS Earthquakes',
        category: 'science',
        priority: 'low',
        shouldRun: (_q) => /earthquake|seismic|tremor|disaster/i.test(_q),
        execute: fetchEarthquake
    },
    {
        id: 'weather',
        name: 'Weather',
        category: 'utilities',
        priority: 'medium',
        shouldRun: (_q) => /weather|forecast|temp|rain/i.test(_q),
        execute: fetchCity
    },
    // --- NEWLY ADDED TOOLS ---
    {
        id: 'pokemon',
        name: 'Pokemon',
        category: 'entertainment',
        priority: 'low',
        shouldRun: (_q) => /pokemon|pokedex|pikachu/i.test(_q),
        execute: fetchPokemon
    },
    {
        id: 'book',
        name: 'Books (OpenLibrary)',
        category: 'education',
        priority: 'low',
        shouldRun: (_q) => /book|author|isbn|novel/i.test(_q),
        execute: fetchBook
    },
    {
        id: 'food',
        name: 'Food & Recipes',
        category: 'lifestyle',
        priority: 'medium',
        shouldRun: (_q) => /food|recipe|cook|meal|dish/i.test(_q),
        execute: fetchFood
    },
    {
        id: 'math',
        name: 'Math Solver',
        category: 'utilities',
        priority: 'high',
        shouldRun: (_q) => /solve|calculate|math|integral|deriv|equation/i.test(_q),
        execute: fetchMathCalculation
    },
    {
        id: 'translate',
        name: 'Translator',
        category: 'utilities',
        priority: 'high',
        shouldRun: (_q) => /translate|meaning in|french|spanish|german|hindi/i.test(_q),
        execute: fetchTranslation
    },
    {
        id: 'tech_info',
        name: 'Tech Info (IsItUp)',
        category: 'tech',
        priority: 'low',
        shouldRun: (_q) => /website|down|status|server/i.test(_q),
        execute: (_q) => {
            const domain = _q.match(/[a-zA-Z0-9-]+\.[a-zA-Z]{2,}/)?.[0];
            return domain ? fetchIsItUp(domain) : null;
        }
    },
    {
        id: 'history',
        name: 'Historical Events',
        category: 'education',
        priority: 'low',
        shouldRun: (_q) => /history|event|happened|date|year/i.test(_q),
        execute: fetchHistory
    },
    {
        id: 'trivia',
        name: 'Trivia',
        category: 'entertainment',
        priority: 'low',
        shouldRun: (_q) => /trivia|fact|quiz/i.test(_q),
        execute: fetchTrivia
    },
    {
        id: 'rhyme',
        name: 'Rhymes & Lyrics',
        category: 'media',
        priority: 'low',
        shouldRun: (_q) => /lyrics|song|rhyme/i.test(_q),
        execute: fetchLyrics
    },
    {
        id: 'reddit',
        name: 'Reddit',
        category: 'general',
        priority: 'medium',
        shouldRun: (_q) => /reddit|news|opinion|community|what do people think/i.test(_q),
        execute: async (_q) => {
            const { newsAgent } = await import('./newsAgent');
            const posts = await newsAgent.fetchReddit(_q);
            if (!posts || posts.length === 0) return null;
            return `[Source: Reddit] 🌐 **Community Intelligence:**\n\n` + 
                posts.map(p => `• **${p.title}**\n  ${p.url}`).join('\n\n');
        }
    }
];

/**
 * Generates comprehensive, multi-source research reports using Cloud AI.
 * Now optimized for direct tool usage (returns simple string).
 */
const generateEnhancedReport = async (query, existingContext = null, customInstruction = null, env = null) => {
    try {
        console.log(`[Research Engine] Processing query: "${query}"`);
        const lowerConfig = query.toLowerCase();
        let combinedContent = existingContext || "";

        if (!combinedContent) {
            // 1. Select Sources
            if (env?.onProgress) env.onProgress('Identifying research sources...');
            const activeSources = RESEARCH_SOURCES.filter(source => {
                try {
                    return source.shouldRun(lowerConfig);
                } catch (_) {
                    console.warn(`[Research Engine] Error in trigger for ${source.id}:`, _);
                    return false;
                }
            });

            console.log(`[Research Engine] Selected ${activeSources.length} sources:`, activeSources.map(s => s.id).join(', '));

            if (activeSources.length === 0) {
                activeSources.push(RESEARCH_SOURCES[0], RESEARCH_SOURCES[1]); // Wiki + DDG fallback
            }

            // 2. Execute in Parallel with Timeout Wrapper
            if (env?.onProgress) env.onProgress(`Gathering data from ${activeSources.length} specialized sources...`);
            const results = await Promise.allSettled([
                ...activeSources.map(async (source) => {
                    try {
                        const sourceData = await Promise.race([
                            source.execute(query),
                            new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), 15000))
                        ]);

                        if (!sourceData || typeof sourceData !== 'string') return null;
                        if (sourceData.includes("No information") || sourceData.includes("not found")) return null;

                        return sourceData;
                    } catch (_) {
                        console.error('[MemoryManager] Search error (Cloud):', _);
                        return null;
                    }
                }),
                // ADDED: Deep Web Crawl as a primary data source for reports
                fetchWebCrawl(query, env)
            ]);

            // 3. Aggregate
            const uniqueData = new Set();
            results.forEach(res => {
                if (res.status === 'fulfilled' && res.value) {
                    uniqueData.add(res.value);
                }
            });

            combinedContent = Array.from(uniqueData).join('\n\n');
        }

        if (!combinedContent || combinedContent.trim().length < 20) {
            console.log('[Research Engine] No valid data collected. Informing the requester.');
            return `No information found for this query (${query}). Suggestion: Try a more specific keyword.`;
        }

        // 4. AI Synthesis (Cloud Ollama ONLY)
        // IMPORTANT: keep model from echoing the raw intelligence back into the final summary.
        // Raw content is wrapped + explicitly forbidden to be copied verbatim.
        const userGoal = customInstruction || query;
        const prompt = `You are an elite research analyst and a highly polite AI assistant named Liya.

**User Goal:** "${userGoal}"

<RAW_INTELLIGENCE>
${combinedContent}
</RAW_INTELLIGENCE>

**Output rules (CRITICAL):**
1) Write the final answer in clean Markdown.
2) DO NOT paste the RAW_INTELLIGENCE, DO NOT quote it at length, and DO NOT include long "[Source: ...]" blocks verbatim. Paraphrase and synthesize.
3) If sources contain conflicting info, mention uncertainty instead of hallucinating.
4) Always start with a short greeting in Hindi/Hinglish.
5) Always include these sections in this exact order:
   - ## Executive Summary (5-8 bullet points, crisp)
   - ## Detailed Notes (grouped subheadings, short paragraphs)
   - ## Sources (bullets; if a URL is present in the intelligence, list it)

**Task:**
${customInstruction
    ? `Follow the User Goal strictly and answer ONLY what was asked.`
    : `Create a comprehensive, well-structured report that directly answers the user's question.`}
`;

        const cloudKey = config.getApiKey('VITE_OLLAMA_CLOUD_API_KEY');
        const host = import.meta.env.VITE_BACKEND_URL ? `${import.meta.env.VITE_BACKEND_URL}/cloud-api` : window.location.origin + '/cloud-api';

        try {
            // 🧠 MULTI-MODEL v2.0: Use dedicated smart model for synthesis
            const researcherModel = localStorage.getItem('OLLAMA_SMART_MODEL') || 'gpt-oss:120b';
            console.log(`[Research Engine] Synthesis starting with model: ${researcherModel}`);
            if (env?.onProgress) env.onProgress('Synthesizing research report (AI)...');
            const ollama = new (await import('ollama/browser')).Ollama({
                host: host,
                headers: { 'Authorization': `Bearer ${cloudKey}` }
            });

            console.log(`[Research Engine] Sending STREAMING request to Cloud AI...`);
            const responseStream = await ollama.chat({
                model: researcherModel,
                messages: [{ role: 'user', content: prompt }],
                stream: true,
                options: { temperature: 0.7 }
            });

            let fullText = "";
            let chunkCount = 0;
            for await (const chunk of responseStream) {
                const content = chunk.message.content;
                fullText += content;
                chunkCount++;
                if (chunkCount % 20 === 0 && env?.onProgress) {
                    env.onProgress(`Writing report... (${fullText.length} characters)`);
                }
            }

            console.log(`[Research Engine] Synthesis complete. Total length: ${fullText.length}`);
            if (fullText.trim().length < 50) {
                console.warn('[Research Engine] Synthesis produced too little content. Falling back to raw data.');
                return `**[System Note]** Synthesis was too brief. Raw data:\n\n${combinedContent}`;
            }
            return fullText;

        } catch (_error) {
            console.error('[Research Engine] Cloud Synthesis Failed:', _error);
            // Fallback: Return raw data if AI fails
            return `**[System Note]** Cloud AI unavailable. Displaying raw data:\n\n${combinedContent}`;
        }
    } catch (_error) {
        console.error("Research Critical Error:", _error);
        return "Research failed due to an internal error.";
    }
};

const performResearch = async (query, env = null) => {
    if (!query || query.trim().length < 3 || query === '...') {
        return "Query is too short or invalid. Please provide a more descriptive keyword-based search query.";
    }
    console.log("Researching (Raw):", query);

    // URL DETECTION & INSTRUCTION PARSING
    const urlPattern = /https?:\/\/[^\s/$.?#].[^\s]*/gi;
    const urlMatch = query.match(urlPattern);

    if (urlMatch) {
        const url = urlMatch[0];
        const instruction = query.replace(url, '').replace(/scrape|research|tell me about|read|analyse|analyze/gi, '').trim();
        console.log(`[Research:URL] Detected URL: ${url} instruction: "${instruction || 'None'}"`);

        const pageContent = await fetchPageContent(url, { ...env, originalQuery: query });
        if (pageContent.startsWith('Failed to scrape') || pageContent.startsWith('No text content')) {
            return pageContent;
        }

        // If instruction is empty, default to "General Info"
        const finalInstruction = instruction || `Give me general info about this website: ${url}`;
        return await generateEnhancedReport(url, pageContent, finalInstruction, env);
    }
    
    // Aggressive cleaning to strip common "Search" prefixes added by agents
    const cleanQuery = query.replace(/^(web search|search for|find info on|research about|tell me about|look up|get details on)\b/gi, '').trim();
    const lower = cleanQuery.toLowerCase();

    // 0. Visual / Tools & Utilities (Single Response)
    // NOTE: Removed "web search" prefix interceptor as it caused agents to bypass deep research.
    if (lower.startsWith('ddg ') || lower.startsWith('duckduckgo ')) {
        return await fetchDDG(query.replace(/ddg|duckduckgo/gi, '').trim());
    }

    // ==================== [NEW] EXPLICIT DEEP RESEARCH INTERCEPTOR ====================
    // Bypass all single-API checks if the user explicitly asks for a report or comprehensive deep dive.
    if (lower.includes('report') || lower.includes('deep dive') || lower.includes('research about') || lower.includes('tell me everything about') || lower.includes('reserch') || lower.includes('rreserch') || lower.includes('reserc') || lower.includes('reserch')) {
        console.log('[Research Engine] Explicit "Deep Report" requested. Bypassing simple routing.');
        // Clean the query to maximize API hits
        const cleanQuery = query.replace(/make|give|me|a|detailed|report|on|about|research|reserch|rreserch|reserc|reserch|deep dive|tell me everything about/gi, '').trim();
        return await generateEnhancedReport(cleanQuery, null, null, env);
    }
    // ==================== NEW SMART APIs ROUTING ====================

    // Translation (HIGH PRIORITY)
    if (lower.includes('translate') || lower.includes('kya hota hai') || lower.includes('meaning in')) {
        return await fetchTranslation(query);
    }

    // Advanced Math Calculations
    if (lower.includes('solve') || lower.includes('calculate') || lower.includes('derivative') || lower.includes('integrate') || lower.includes('simplify') || lower.includes('factor')) {
        return await fetchMathCalculation(query);
    }

    // Earthquake Data (Real-Time)
    if (lower.includes('earthquake') || lower.includes('bhukamp') || lower.includes('quake')) {
        return await fetchEarthquake(query);
    }

    // Public Holidays Lookup
    if (lower.includes('holiday') || lower.includes('holidays') || lower.includes('chutti') || lower.includes('bank holiday')) {
        return await fetchHolidays(query);
    }

    // Word Finder (Rhymes, Synonyms)
    if (lower.includes('rhyme') || lower.includes('synonym') || lower.includes('similar word')) {
        return await fetchWordFinder(query);
    }

    // Nobel Prize Database
    if (lower.includes('nobel prize') || lower.includes('nobel') || lower.includes('laureate')) {
        return await fetchNobelPrize(query);
    }

    // Life Advice
    if (lower.includes('advice') || lower.includes('sujhav') || lower.includes('tip') || lower.includes('suggestion')) {
        return await fetchAdvice();
    }

    // Zen Wisdom (Better Quotes)
    if (lower.includes('zen') || lower.includes('wisdom') || lower.includes('deep thought') || lower.includes('philosophy')) {
        return await fetchZenQuote();
    }

    // Sunrise/Sunset Times
    if (lower.includes('sunrise') || lower.includes('sunset') || lower.includes('suraj kab')) {
        return await fetchSunriseSunset(query);
    }

    // Dad Jokes (Better than generic jokes)
    if (lower.includes('dad joke') || lower.includes('papa joke') || lower.includes('funny joke')) {
        return await fetchDadJoke();
    }

    // ==================== ADDITIONAL FREE APIs ROUTING ====================

    // Chuck Norris Jokes
    if (lower.includes('chuck norris') || lower.includes('chuck joke')) {
        return await fetchChuckNorrisJoke();
    }

    // Random Useless Facts
    if (lower.includes('useless fact') || lower.includes('random fact') || lower.includes('fun fact')) {
        return await fetchUselessFact();
    }

    // Dog Facts (text, not images)
    if (lower.includes('dog fact') || lower.includes('kutte ke bare me')) {
        return await fetchDogFact();
    }

    // Random Fox Images
    if (lower.includes('fox') || lower.includes('fox image') || lower.includes('cute fox')) {
        return await fetchRandomFox();
    }

    // University Search (Only if looking for a list, e.g., 'universities in India', NOT 'kurukshetra university')
    if (lower.includes('universities in') || lower.includes('top universities') || lower.includes('colleges in')) {
        return await fetchUniversity(query);
    }

    // Bible Verse (STRICT: Requires book + number)
    if ((lower.includes('bible') || lower.includes('verse')) && lower.match(/\b\d+\b/)) {
        return await fetchBibleVerse(query);
    }

    // Color Information
    if ((lower.includes('color') || lower.includes('colour')) && (lower.includes('info') || lower.includes('#') || lower.includes('about'))) {
        return await fetchColorInfo(query);
    }

    // Magic 8-Ball
    if (lower.includes('8 ball') || lower.includes('8ball') || lower.includes('magic ball') || lower.includes('should i')) {
        return await fetchEightBall(query);
    }

    // Anime Search
    if (lower.includes('anime') && !lower.includes('image')) {
        return await fetchAnime(query);
    }

    // Draw Random Card
    if (lower.includes('draw card') || lower.includes('random card') || lower.includes('playing card') || lower.includes('patte kheencho')) {
        return await fetchCardDraw();
    }

    // ==================== END ADDITIONAL APIs ====================

    if (lower.includes('robot') || lower.includes('robohash')) return fetchRoboHash(query.replace(/robot|robohash/g, '').trim());
    if (lower.includes('qr code') || lower.includes('qrcode')) return fetchQRCode(query.replace(/qr code|qr/g, '').trim());

    // NEW UTILITIES
    if (lower.includes('define') || lower.includes('meaning') || lower.includes('dictionary')) return await fetchDictionary(query.replace(/define|meaning|of|dictionary/g, '').trim());
    if (lower.includes('iss') || lower.includes('space station')) return await fetchISS();
    if (lower.includes('recipe') || lower.includes('food') || lower.includes('cook') || lower.includes('dinner')) return await fetchFood();
    if (lower.includes('gita') || lower.includes('shlok') || lower.includes('krishna')) return await fetchGita();
    if (lower.includes('quiz') || lower.includes('trivia')) return await fetchTrivia();
    if (lower.includes('is it down') || lower.includes('check site') || lower.includes('website status')) {
        const domain = query.split(' ').pop(); // simple heuristic
        return await fetchIsItUp(domain);
    }

    // 1. Fun & Trivia
    if (lower.includes('joke')) return await fetchJoke();
    if (lower.includes('quote') || lower.includes('motivation')) return await fetchQuote();

    if (lower.includes('number') && lower.includes('fact')) return await fetchNumberFact(query);

    // NEW OPEN SOURCE APIS ROUTING
    if (lower.includes('movie') || lower.includes('film') || lower.includes('imdb')) return await fetchMovie(query);
    if (lower.includes('dog') || lower.includes('puppy') || lower.includes('doggo')) return await fetchDogImage();
    if (lower.includes('cat') && (lower.includes('fact') || lower.includes('about'))) return await fetchCatFact();
    if (lower.includes('bored') || lower.includes('activity') || lower.includes('what to do') || lower.includes('kya karu')) return await fetchActivity();
    if (lower.includes('age of') || lower.includes('gender of') || lower.includes('nationality') || lower.includes('name analysis')) return await fetchNameAnalysis(query);
    if (lower.includes('spacex') || lower.includes('rocket') || lower.includes('launch')) return await fetchSpaceXLaunch(query);
    if (lower.includes('nasa') || lower.includes('astronomy') || lower.includes('apod') || lower.includes('space photo')) return await fetchNasaAPOD();
    if (lower.includes('shorten') || lower.includes('short url') || lower.includes('tiny url')) return await fetchShortenUrl(query);
    if (lower.includes('fake user') || lower.includes('random user') || lower.includes('random person') || lower.includes('fake data') || lower.includes('test user')) return await fetchRandomUser();

    // 2. Specific Entities
    if (lower.includes('pokemon') || lower.includes('poke')) return await fetchPokemon(query);
    if (lower.includes('book') || lower.includes('author')) return await fetchBook(query);

    // 3. Location / Geo
    if (lower.includes('ip') && (lower.includes('my') || lower.includes('address'))) return await fetchIP();
    if (lower.includes('country') || lower.includes('capital')) {
        const country = lower.replace(/country|capital|of|is|what/g, '').trim();
        if (country) return await fetchCountry(country);
    }
    if (lower.includes('zip') || lower.includes('pin code')) return await fetchZip(query);
    if (lower.includes('university') || lower.includes('college')) return await fetchUniversity(query);

    // 4. Media
    if (lower.includes('lyrics')) return await fetchLyrics(query);




    // 5. Technical
    if (/(code|error|bug|function|api|sdk|stack|programming)/i.test(query)) {
        const result = await fetchStackExchange(query); // Fixed: declared variable
        if (result) return result;
    }

    // 6. NEW FEATURES ROUTING
    if (lower.includes('ascii') || lower.includes('art') || lower.includes('unique form') || lower.includes('uniqe form') || lower.includes('style')) {
        const { fetchASCII } = await import('./ascii');
        return await fetchASCII(query.replace(/ascii|art|make|write|in|unique\s*form|uniqe\s*form|style|stylish/gi, '').trim());
    }

    // NEW: Image Generation / Search
    // NEW: Image Sourcing (Real Only - Pexels & Wiki)
    if (lower.includes('image') || lower.includes('photo') || lower.includes('draw') || lower.includes('picture') || lower.includes('generate')) {
        // Use word boundaries (\b) to avoid replacing letters inside words (e.g. "wala" -> "wl")
        const prompt = query.replace(/\b(generate|image|photo|picture|of|draw|show|me|a|paint|create)\b/gi, '').trim();

        // 1. Try Pexels first (Best for standard stock: "City", "Computer", "Cats")
        const pexelsResult = await fetchPexelsImage(prompt);
        if (pexelsResult) return pexelsResult;

        // 2. Fallback to Wikipedia (Best for entities: "Sidhu Moose Wala", "History", "Specific Locations")
        const wikiResult = await fetchWikiImage(prompt);
        if (wikiResult && !wikiResult.includes('No photo found')) return wikiResult;

        return `[Source: Liya] ❌ I couldn't find a photo of "${prompt}" (checked Pexels & Wikipedia).`;
    }


    if (lower.includes('crypto') || lower.includes('bitcoin') || lower.includes('price')) {
        const coin = query.replace(/price|of|crypto|value|inr|usd/g, '').trim();
        if (coin) return await fetchCrypto(coin);
    }

    // NEW: Currency Routing
    if (lower.includes('currency') || lower.includes('convert') || lower.includes('rate')) {
        const clean = query.replace(/currency|convert|rate|of|exchange/g, '').trim();
        return await fetchCurrency(clean);
    }

    if (lower.includes('population') || lower.includes('city') || lower.includes('coords')) {
        const city = query.replace(/population|city|of|coordinates|coords/g, '').trim();
        return await fetchCity(city);
    }

    // 6. Academic / Deep Research
    if (/(paper|study|scientific|arxiv|physics|math|quantum)/i.test(query)) {
        const result = await fetchArXiv(query);
        if (result) return result;
    }

    // 7. General Knowledge - Generate Enhanced Multi-Source Report
    console.log('[Research] No specific API matched. Generating enhanced report...');
    const enhancedReport = await generateEnhancedReport(query, null, null, env);
    if (enhancedReport) return enhancedReport;

    // 8. Fallback to simple results if AI report fails
    let result = await fetchWiki(query);
    if (result) return result;

    // Last Resort: Search everything
    console.log('[Research] Last Resort Triggered: fetchDDG');
    result = await fetchDDG(query);
    if (result) return result;

    return "No significant information found. TIP: Use keywords like 'SpaceX', 'Starship', or 'Launch' directly.";
};

export { performResearch, generateEnhancedReport };
