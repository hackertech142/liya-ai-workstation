// One-time migration: clear any stale local Ollama model names saved in localStorage.
let _migrationDone = false;
function runModelMigration() {
    if (_migrationDone) return;
    _migrationDone = true;
    const LOCAL_MODEL_NAMES = ['llama3:8b', 'llama3', 'llama2', 'deepseek-r1:1.5b', 'mistral', 'phi3', 'gemma', 'codellama', 'vicuna', 'orca'];
    const keysToCheck = ['OLLAMA_MODEL', 'OLLAMA_FAST_MODEL', 'OLLAMA_SMART_MODEL'];
    keysToCheck.forEach(key => {
        const val = localStorage.getItem(key);
        if (val && LOCAL_MODEL_NAMES.some(local => val.toLowerCase().includes(local.toLowerCase()))) {
            console.warn(`[Model Migration] Removing stale local model '${val}' from ${key}`);
            localStorage.removeItem(key);
        }
    });
}
runModelMigration();

/**
 * ==========================================================
 * LIYA MULTI-MODEL INTELLIGENT ROUTER v2.0
 * ==========================================================
 * Routes every query to the BEST model from our optimized arsenal.
 * 
 * TIERS:
 *   fast       → gpt-oss:20b-cloud           (simple Q&A, quick facts)
 *   smart      → gpt-oss:120b-cloud          (complex reasoning, planning)
 *   coder      → qwen3-coder:32b-cloud       (code generation)
 *   vision     → qwen3-vl:235b-instruct-cloud (vision tasks)
 * ==========================================================
 */

// === MODEL REGISTRY ===
const MODEL_DEFAULTS = {
    fast:         'gpt-oss:20b',
    smart:        'gpt-oss:120b',
    coder:        'gpt-oss:120b',
    vision:       'gemma4:31b',
};

// localStorage key mapping
const MODEL_STORAGE_KEYS = {
    fast:         'OLLAMA_FAST_MODEL',
    smart:        'OLLAMA_SMART_MODEL',
    coder:        'CODER_MODEL',
    vision:       'OLLAMA_VISION_MODEL',
};

/**
 * Intelligent Multi-Tier Prompt Classifier
 * Analyzes the prompt and returns the best model tier.
 */
export const classifyPrompt = (prompt) => {
    if (!prompt || typeof prompt !== 'string') return 'fast';

    const text = prompt.toLowerCase().trim();

    // === TIER: CODER (Code generation, programming) ===
    const codingPatterns = /\b(code|program|function|component|script|html|css|javascript|typescript|python|react|node|api|endpoint|algorithm|debug|fix.*bug|refactor|implement|write.*(?:code|function|class|component|app|website|page|script)|make.*(?:code|function|class|component|app|website|page|site|ui|script|demo)|build.*(?:code|function|class|component|app|website|page|site|ui|script|demo)|create.*(?:code|function|class|component|app|website|page|site|ui|script|demo)|likh.*code|code.*likh|banao.*(?:app|website|page|component)|(?:app|website|page).*banao|web\s*page|landing\s*page|website|error.*fix|fix.*error|syntax|compile|runtime|frontend|backend|fullstack|database|sql|mongodb|express|flask|django|nextjs|vite|canvas|convas|animation|visual|draw|skeleton|skelton|design|interactive|preview|graphics|3d|2d|render|svg|vibe|beats|theme|effect|modify|change)\b/i;
    if (codingPatterns.test(text)) return 'coder';

    // === TIER: SMART (Complex reasoning, analysis) ===
    if (text.length > 500) return 'smart';

    const complexKeywords = [
        'write a python', 'write a program', 'write a function',
        'architecture', 'plan', 'design', 'why is this failing',
        'analyze', 'explain how', 'explain why', 'compare',
        'system design', 'generate', 'strategy', 'evaluate',
        'research', 'deep dive', 'comprehensive', 'detailed',
        'pros and cons', 'advantages', 'disadvantages', 'story', 'poem'
    ];

    for (const keyword of complexKeywords) {
        if (text.includes(keyword)) return 'smart';
    }

    // Mathematical or logic indicators
    if (text.match(/[[{]\s*[\w"':,\s]+[\]}]/)) return 'smart'; // JSON-like blocks
    if (text.match(/```[a-z]*/)) return 'smart'; // Markdown code blocks

    // === TIER: FAST (Default for everything else) ===
    return 'fast';
};

/**
 * Gets the actual model name based on classification tier.
 * Checks localStorage first (for user overrides), then falls back to defaults.
 */
export const getRoutedModel = (classification) => {
    const storageKey = MODEL_STORAGE_KEYS[classification];
    if (storageKey) {
        const stored = localStorage.getItem(storageKey);
        if (stored) return stored;
    }
    return MODEL_DEFAULTS[classification] || MODEL_DEFAULTS.fast;
};

/**
 * Convenience: Get the model for a specific named role.
 * Used by subagents, research engine, etc.
 */
export const getModelForRole = (role) => {
    const roleMap = {
        'coder':       'coder',
        'vision':      'vision',
        'general':     'smart',
        'fast':        'fast'
    };
    const tier = roleMap[role] || 'smart';
    return getRoutedModel(tier);
};

/**
 * Get a human-readable label for the model tier (for UI display)
 */
export const getTierLabel = (classification) => {
    const labels = {
        fast:         '🏃 FAST',
        smart:        '🧠 DEEP THINK',
        coder:        '💻 CODER',
        vision:       '👁️ VISION',
    };
    return labels[classification] || '🤖 AI';
};

// Export registry for settings UI
export { MODEL_DEFAULTS, MODEL_STORAGE_KEYS };
