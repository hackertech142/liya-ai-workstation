import { useState, useRef, useCallback } from 'react';
import { Ollama } from 'ollama/browser';

export const useOllamaStream = () => {
    const [isPlaying, setIsPlaying] = useState(false);
    const [error, setError] = useState(null);
    const [currentModel, setCurrentModel] = useState('');
    const abortControllerRef = useRef(null);

    const stop = useCallback(() => {
        if (abortControllerRef.current) {
            console.log("Stopping generation (User Requested)...");
            abortControllerRef.current.abort();
            // Don't nullify yet, let the streamChat finally block handle it
            setIsPlaying(false);
        }
    }, []);

    const streamChat = useCallback(async ({
        modelToUse,
        messages,
        onChunk,
        onDone,
        onThinking,
        reasoningEffort,
        cloudKey,
        host,
        streamOptions = {}
    }) => {
        setIsPlaying(true);
        setError(null);
        setCurrentModel(modelToUse);
        let chunksSent = 0;

        try {
            console.log("☁️ Connecting to Cloud Brain...");

            // Use existing AbortController if available (for cross-hook cancellation)
            if (!abortControllerRef.current) {
                abortControllerRef.current = new AbortController();
            }
            const abortController = abortControllerRef.current;

            const ollama = new Ollama({
                host: host,
                headers: {
                    'Authorization': `Bearer ${cloudKey}`
                }
            });

            /**
             * 🛡️ MESSAGE ROLE SANITIZER
             * Some models (especially smaller ones like gemma3:4b) REQUIRE strict
             * user/assistant alternation. This function:
             * 1. Keeps the first system message as-is
             * 2. Folds any other system messages into the nearest user message
             * 3. Merges consecutive same-role messages
             */
            const sanitizeMessageRoles = (msgs) => {
                if (!msgs || msgs.length === 0) return msgs;

                const result = [];
                let systemPrompt = null;

                // Step 1: Extract first system message, fold others into pending context
                let pendingSystemContent = '';
                for (const msg of msgs) {
                    if (msg.role === 'system') {
                        if (!systemPrompt) {
                            systemPrompt = { ...msg };
                        } else {
                            // Fold extra system messages into pending context
                            pendingSystemContent += '\n' + msg.content;
                        }
                    } else {
                        if (pendingSystemContent && msg.role === 'user') {
                            // Inject pending system content into this user message
                            result.push({
                                ...msg,
                                content: `${pendingSystemContent.trim()}\n\n${msg.content}`
                            });
                            pendingSystemContent = '';
                        } else if (pendingSystemContent && msg.role === 'assistant') {
                            // Can't inject into assistant — create a synthetic user message
                            result.push({ role: 'user', content: pendingSystemContent.trim() });
                            pendingSystemContent = '';
                            result.push(msg);
                        } else {
                            result.push(msg);
                        }
                    }
                }

                // Step 2: Merge consecutive same-role messages
                const merged = [];
                if (systemPrompt) merged.push(systemPrompt);

                for (const msg of result) {
                    const last = merged[merged.length - 1];
                    if (last && last.role === msg.role) {
                        // Merge content, preserve images from either
                        last.content = `${last.content}\n\n${msg.content}`;
                        if (msg.images && !last.images) last.images = msg.images;
                    } else {
                        merged.push({ ...msg });
                    }
                }

                // Step 3: Ensure it starts with system (optional) then user
                // If first non-system message is assistant, prepend an empty user message
                const firstNonSystem = merged.find(m => m.role !== 'system');
                if (firstNonSystem && firstNonSystem.role === 'assistant') {
                    const idx = merged.indexOf(firstNonSystem);
                    merged.splice(idx, 0, { role: 'user', content: '...' });
                }

                // Step 4: Ensure it ends with a user message (required for chat)
                if (merged.length > 0 && merged[merged.length - 1].role !== 'user') {
                    // If trailing system content exists, append it
                    if (pendingSystemContent) {
                        merged.push({ role: 'user', content: pendingSystemContent.trim() });
                    }
                }

                return merged;
            };

            const sanitizedMessages = sanitizeMessageRoles(messages);

            const stream = await ollama.chat({
                model: modelToUse,
                messages: sanitizedMessages,
                stream: true,
                keep_alive: '60m',
                options: {
                    reasoning_effort: reasoningEffort,
                    temperature: 0.85,
                    top_k: 50,
                    top_p: 0.95,
                    repeat_penalty: 1.1,
                    stop: ["<|eot_id|>", "<|im_end|>", "<|end_of_sentence|>"],
                    ...streamOptions
                },
                // Pass the abort signal to cancel the request properly
                abortSignal: abortControllerRef.current.signal
            });

            console.log("Reading Stream...");
            let thinkingStopped = false;
            let insideThinkBlock = false;
            let contentChunksSent = 0;

            for await (const part of stream) {
                // FORCE BREAK IF ABORTED (Check either local signal or ref signal)
                if (abortController.signal.aborted || (abortControllerRef.current && abortControllerRef.current.signal.aborted)) {
                    console.log("Stream forcefully aborted.");
                    break;
                }

                if (part.message) {
                    let txt = '';

                    if (part.message.thinking) {
                        if (!insideThinkBlock) {
                            txt += '<think>\n';
                            insideThinkBlock = true;
                        }
                        txt += part.message.thinking;
                    }

                    // Log raw message for diagnostics
                    if (part.message.content) {
                        console.log("Chunk Content:", part.message.content);
                        if (part.message.content.trim()) contentChunksSent++;
                    }

                    if (part.message.content !== undefined && part.message.content !== null) {
                        // If we were thinking, and now we are receiving content (even if empty, marking transition)
                        if (insideThinkBlock && part.message.content !== "") {
                            txt += '\n</think>\n\n';
                            insideThinkBlock = false;
                        }

                        let chunkContent = part.message.content;
                        // 🚨 HALLUCINATION DETECTOR — DeepSeek-specific anomalies only
                        const isDeepSeekAnomaly = (
                            chunkContent.includes('<|begin_of_sentence|>') ||
                            chunkContent.includes('<｜begin▁of▁sentence｜>') ||
                            /[\u4E00-\u9FFF]{3,}/.test(chunkContent)
                        );

                        if (isDeepSeekAnomaly) {
                            console.warn("🚨 HALLUCINATION DETECTED (DeepSeek Anomaly). Skipping chunk.");
                        } else {
                            txt += chunkContent;
                        }
                    }

                    if (txt) {
                        chunksSent++;
                        if (!thinkingStopped && onThinking) {
                            onThinking(false);
                            thinkingStopped = true;
                        }
                        onChunk(txt);
                    }
                }

                if (part.done) {
                    console.log("Stream Done");
                    if (insideThinkBlock) {
                        onChunk('\n</think>\n\n');
                        insideThinkBlock = false;
                    }
                    if (chunksSent === 0 && !abortControllerRef.current?.signal.aborted) {
                        console.warn("⚠️ Model returned empty stream. Sending fallback.");
                        onChunk(`Arey Master, lagta hai koi technical issue ki wajah se response empty aa raha hai. AI ne research toh kar li thi, par reply nahi de paayi. Aap ek baar fir se puch sakte hain?`);
                    } else if (contentChunksSent === 0 && !abortControllerRef.current?.signal.aborted) {
                        console.warn("⚠️ Model only generated reasoning without final response text before stopping.");
                        onChunk(`\n\n*(Model reasoning budget exhaust ho gaya. Coder Model ke liye Settings me **gpt-oss:120b** use karein.)*`);
                    }
                    if (!thinkingStopped && onThinking) {
                        onThinking(false);
                        thinkingStopped = true;
                    }
                    if (onDone) onDone();
                }
            }

        } catch (error) {
            console.error("Chat Process Error:", error);
            if (onThinking) onThinking(false);

            if (error.name !== 'AbortError') {
                let rawMsg = error.message || '';
                let errorMsg;

                // Detect HTML error pages (Cloudflare 524, 503, etc.) — never show raw HTML to user
                const isHtmlResponse = rawMsg.includes('<!DOCTYPE') || rawMsg.includes('<html') || rawMsg.includes('<title>');

                if (isHtmlResponse || rawMsg.includes('524') || rawMsg.includes('timeout') || rawMsg.toLowerCase().includes('timed out')) {
                    errorMsg = "☁️ Cloud server timed out (524). Ollama servers are busy — please try again in a moment.";
                } else if (rawMsg.includes('Failed to fetch') || rawMsg.includes('NetworkError') || rawMsg.includes('net::ERR')) {
                    errorMsg = "🌐 Network Error: Internet connection lost or Cloud API is unreachable. Check your connection.";
                } else if (rawMsg.includes('401') || rawMsg.includes('Unauthorized')) {
                    errorMsg = "🔑 Authentication Failed: Invalid Cloud API Key. Go to Settings and check your key.";
                } else if (rawMsg.includes('404')) {
                    errorMsg = "🤖 Model Not Found: The selected model is temporarily unavailable. Try switching models.";
                } else if (rawMsg.includes('503') || rawMsg.includes('Service Unavailable')) {
                    errorMsg = "⚠️ Cloud API is overloaded (503). Please wait a moment and try again.";
                } else if (rawMsg.includes('500')) {
                    errorMsg = "💥 Server Error: Cloud API is having internal issues. Try again shortly.";
                } else if (rawMsg.includes('429') || rawMsg.includes('rate limit')) {
                    errorMsg = "🚦 Rate Limited: Too many requests. Please wait a few seconds before trying again.";
                } else {
                    errorMsg = `Connection Error: ${rawMsg.slice(0, 120)}`; // Cap length — no HTML dumps
                }

                setError(errorMsg);

                if (error.response) {
                    error.response.text().then(t => {
                        if (!t.includes('<!DOCTYPE')) console.error("Server Response:", t); // Don't log HTML
                    }).catch(() => { });
                }

                // CRITICAL FIX: If no chunks were sent, push the error directly to the chat bubble so it doesn't hang
                if (chunksSent === 0 && onChunk) {
                    onChunk(`⚠️ **System Error:** ${errorMsg}\n\n*Technical Details:* \`${rawMsg}\``);
                }
            }

            // CRITICAL FIX: Always fire onDone if we crashed, so the UI can unlock from 'thinking' state
            if (onDone) onDone();

        } finally {
            setIsPlaying(false);
            abortControllerRef.current = null;
        }
    }, []);

    return { streamChat, stop, isPlaying, setIsPlaying, error, setError, currentModel, abortControllerRef };
};
