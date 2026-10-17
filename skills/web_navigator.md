# Skill: Web_Navigator
## Description:
High-speed, intelligent web reading and browsing. Liya uses a multi-tier scraping architecture: **Crawl4AI** as primary engine (~0.6s extraction), **Playwright Chromium + Turndown** as Fallback 1, and **Jina.ai Reader** as Fallback 2.

## Tools to Use:
1. **`web_scrape`**: To browse and read a specific URL:
   - `url`: The full target URL (e.g. "https://en.wikipedia.org/wiki/Artificial_intelligence")
   - `action`: `"markdown"` (clean readable text with structure), `"text"`, or `"screenshot"`
2. **`research`**: To perform multi-source real-time search across the live web:
   - `query`: The search topic
   - `recency`: `"day" | "week" | "month" | "year" | "all"`

## Execution Flow:
1. **Primary Extraction**: Crawl4AI fetches page markdown asynchronously without heavy overhead.
2. **Robust Fallback**: If Crawl4AI encounters anti-bot challenges or dynamic JS hurdles, Playwright Chromium automatically renders the page.
3. **Delivery**: Deliver page summaries directly in the Chat Feed accompanied by any extracted photos (`[DIRECT_IMAGE:url|caption]`). Do not push raw text summaries to Canvas.

## Safety Rules:
1. **Privacy**: Never navigate to pages requiring sensitive personal information unless authorized.
2. **Compliance**: Respect `robots.txt` and avoid hammering sites.
3. **Clarity**: Report technical failures (404, Timeouts) clearly to the user.

