const axios = require('axios');

/**
 * Fast HTTP YouTube Search (Instant, <500ms, no browser binary required)
 */
async function fastHttpYouTubeSearch(query) {
    const searchUrl = `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`;
    const response = await axios.get(searchUrl, {
        headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
            'Accept-Language': 'en-US,en;q=0.9',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
        },
        timeout: 10000
    });

    const html = response.data;
    if (!html || typeof html !== 'string') {
        throw new Error("Empty response from YouTube search.");
    }

    // 1. Try parsing ytInitialData
    const initialDataMatch = html.match(/ytInitialData\s*=\s*({.+?});<\/script>/);
    if (initialDataMatch) {
        try {
            const data = JSON.parse(initialDataMatch[1]);
            const sections = data.contents?.twoColumnSearchResultsRenderer?.primaryContents?.sectionListRenderer?.contents;
            if (Array.isArray(sections)) {
                for (const section of sections) {
                    const items = section.itemSectionRenderer?.contents;
                    if (Array.isArray(items)) {
                        for (const item of items) {
                            if (item.videoRenderer && item.videoRenderer.videoId) {
                                const title = item.videoRenderer.title?.runs?.[0]?.text || "YouTube Video";
                                return {
                                    id: item.videoRenderer.videoId,
                                    title: title
                                };
                            }
                        }
                    }
                }
            }
        } catch (e) {
            console.warn("[YouTube] ytInitialData parse failed, falling back to regex:", e.message);
        }
    }

    // 2. Fast regex fallback on watch?v=
    const videoIdMatch = html.match(/\/watch\?v=([a-zA-Z0-9_-]{11})/);
    if (videoIdMatch && videoIdMatch[1]) {
        return {
            id: videoIdMatch[1],
            title: query
        };
    }

    throw new Error("No YouTube video ID found in search response.");
}

/**
 * Search YouTube for a video and return the first Video ID
 * Tiers:
 * 1. Ultra-fast direct HTTP search (<500ms)
 * 2. Playwright headless browser (fallback if available)
 */
async function searchYouTube(query) {
    console.log(`[YouTube] Searching for: "${query}"`);

    // Tier 1: Fast HTTP Search
    try {
        const result = await fastHttpYouTubeSearch(query);
        console.log(`[YouTube Fast-HTTP] Found: "${result.title}" (ID: ${result.id})`);
        return result;
    } catch (httpErr) {
        console.warn(`[YouTube Fast-HTTP] Failed (${httpErr.message}). Attempting Playwright fallback...`);
    }

    // Tier 2: Playwright Fallback
    let browser;
    try {
        const { chromium } = require('playwright');
        browser = await chromium.launch({ headless: true });
        const context = await browser.newContext({
            userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36'
        });
        const page = await context.newPage();
        const searchUrl = `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`;
        await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 20000 });

        const firstVideo = await page.evaluate(() => {
            const selectors = ['a#video-title', 'a#video-title-link', 'ytd-video-renderer a#thumbnail'];
            for (const selector of selectors) {
                const link = document.querySelector(selector);
                if (link) {
                    const href = link.getAttribute('href');
                    if (href && (href.includes('/watch?v=') || href.includes('v='))) {
                        const match = href.match(/v=([^&]+)/);
                        return {
                            id: match ? match[1] : null,
                            title: link.innerText.trim() || "YouTube Video"
                        };
                    }
                }
            }
            return null;
        });

        if (!firstVideo || !firstVideo.id) {
            throw new Error("No videos found for this query via Playwright.");
        }

        console.log(`[YouTube Playwright] Found: "${firstVideo.title}" (ID: ${firstVideo.id})`);
        return firstVideo;
    } catch (playwrightErr) {
        console.error("[YouTube Playwright] Search failed:", playwrightErr.message);
        throw playwrightErr;
    } finally {
        if (browser) {
            try { await browser.close(); } catch (_) {}
        }
    }
}

module.exports = { searchYouTube };
