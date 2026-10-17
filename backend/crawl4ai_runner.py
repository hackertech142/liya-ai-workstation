import os
import sys
import warnings

# Suppress notices & dependency warnings
os.environ["CRAWL4AI_NO_CLOUD_NOTICE"] = "1"
os.environ["PYTHONWARNINGS"] = "ignore"
warnings.filterwarnings("ignore")

import asyncio
import json
from crawl4ai import AsyncWebCrawler, BrowserConfig, CrawlerRunConfig, CacheMode

async def crawl(url, max_chars=15000):
    browser_cfg = BrowserConfig(
        headless=True,
        verbose=False,
    )
    run_cfg = CrawlerRunConfig(
        cache_mode=CacheMode.BYPASS,
        word_count_threshold=10,
        page_timeout=20000,
    )
    
    async with AsyncWebCrawler(config=browser_cfg) as crawler:
        result = await crawler.arun(url=url, config=run_cfg)
        
        if not result.success:
            return {
                "success": False,
                "error": result.error_message or "Unknown crawl failure"
            }
            
        markdown = result.markdown or ""
        if len(markdown) > max_chars:
            markdown = markdown[:max_chars] + "\n\n...[Content truncated]"
            
        images = []
        if hasattr(result, 'media') and result.media and 'images' in result.media:
            for img in result.media['images'][:6]:
                src = img.get('src') or img.get('url')
                if src and src.startswith('http'):
                    images.append({"src": src, "alt": img.get('alt', '')})
                    
        return {
            "success": True,
            "title": getattr(result, 'metadata', {}).get('title') or "",
            "markdown": markdown,
            "images": images,
            "url": url,
            "charCount": len(markdown),
            "method": "crawl4ai"
        }

def main():
    if len(sys.argv) < 2:
        print("__CRAWL4AI_JSON_START__" + json.dumps({"success": False, "error": "No URL provided"}) + "__CRAWL4AI_JSON_END__")
        sys.exit(1)
        
    url = sys.argv[1]
    max_chars = int(sys.argv[2]) if len(sys.argv) > 2 else 15000
    
    try:
        output = asyncio.run(crawl(url, max_chars))
        print("__CRAWL4AI_JSON_START__" + json.dumps(output) + "__CRAWL4AI_JSON_END__")
    except Exception as e:
        print("__CRAWL4AI_JSON_START__" + json.dumps({"success": False, "error": str(e)}) + "__CRAWL4AI_JSON_END__")

if __name__ == "__main__":
    main()
