import { Ollama } from 'ollama/browser';

/**
 * Token Guardian - Protects LIYA from context overflow
 * HEURISTIC: ~4 characters = 1 token (Standard for English/Code)
 */

const MAX_SAFE_TOKENS = 8000; // Safe floor for gpt-oss / llama series
const SUMMARIZE_THRESHOLD = 6000;

/**
 * Estimate tokens in a string or object
 */
export const estimateTokens = (content) => {
    if (!content) return 0;
    const text = typeof content === 'string' ? content : JSON.stringify(content);
    return Math.ceil(text.length / 4);
};

/**
 * Summarize older parts of the conversation to save space
 */
export const optimizeContext = async (messages, options = {}) => {
    const threshold = options.threshold || SUMMARIZE_THRESHOLD;
    const totalTokens = messages.reduce((acc, m) => acc + estimateTokens(m.content), 0);
    console.log(`🛡️ Token Guardian: Current context ~${totalTokens} tokens (Threshold: ${threshold}).`);

    if (totalTokens < threshold) return messages;

    console.warn(`⚠️ Token limit nearing (${totalTokens}). Optimizing context...`);

    // Summarize the middle portion
    // Keep ALL system messages and the last 6 messages
    const systemMessages = messages.filter(m => m.role === 'system');
    const recentMessages = messages.slice(-6);

    // Middle messages are those NOT in system and NOT in recent
    const middleMessages = messages.filter(m => !systemMessages.includes(m) && !recentMessages.includes(m));

    if (middleMessages.length === 0) return messages;

    try {
        const cloudKey = localStorage.getItem('VITE_OLLAMA_CLOUD_API_KEY') || import.meta.env.VITE_OLLAMA_CLOUD_API_KEY;
        const host = import.meta.env.VITE_BACKEND_URL ? `${import.meta.env.VITE_BACKEND_URL}/cloud-api` : window.location.origin + '/cloud-api';

        const ollama = new Ollama({
            host: host,
            headers: { 'Authorization': `Bearer ${cloudKey}` }
        });

        const middleText = middleMessages.map(m => `${m.role}: ${m.content}`).join('\n');

        console.log("📝 Summarizing middle context...");
        // 🧠 MULTI-MODEL v2.0: Use lightweight summarizer model (gemma4:31b) instead of heavy smart model
        const summarizerModel = localStorage.getItem('OLLAMA_SUMMARIZER_MODEL') || 'gemma4:31b-cloud';

        const summaryResponse = await ollama.chat({
            model: summarizerModel,
            messages: [
                {
                    role: 'system',
                    content: 'Summarize the following conversation history into 5-10 key bullet points. Retain all important facts, names, and technical details. Be extremely concise.'
                },
                { role: 'user', content: middleText }
            ],
            stream: false
        });

        const summary = summaryResponse.message.content;
        const optimized = [
            ...systemMessages,
            { role: 'system', content: `[PREVIOUS CONVERSATION SUMMARY]:\n${summary}` },
            ...recentMessages
        ].filter((m, i, self) => m && self.indexOf(m) === i); // Ensure uniqueness

        const newTokens = optimized.reduce((acc, m) => acc + estimateTokens(m.content), 0);
        console.log(`✅ Optimization complete. New context ~${newTokens} tokens.`);

        return optimized;

    } catch (e) {
        console.error("Token Guardian Summary Failed:", e);
        // Fallback: Just trim forcefully if summary fails
        return [...systemMessages, ...messages.slice(-6)].filter(Boolean);
    }
};
