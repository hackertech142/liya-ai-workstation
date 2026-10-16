import { useCallback } from 'react';

import { memoryManager } from '../utils/MemoryManager';
import { planAndExecute } from '../utils/orchestrator';
import { optimizeContext } from '../utils/tokenGuardian';
import { getLiyaSystemPrompt } from '../utils/prompts';
import { useOllamaStream } from './useOllamaStream';
import { config } from '../utils/config';
import { classifyPrompt, getRoutedModel, getModelForRole, getTierLabel } from '../utils/router';
import { readBlackboard } from '../utils/agents/blackboard';

const fetchPersona = async () => {
    try {
        const baseUrl = import.meta.env.VITE_BACKEND_URL || 'http://localhost:3000';
        const res = await fetch(`${baseUrl}/api/persona`);
        const data = await res.json();
        return data.persona;
    } catch (e) {
        console.error("Failed to load persona:", e);
        return "";
    }
};

export function useOllama() {
    const { streamChat, stop, isPlaying, setIsPlaying, error, setError, currentModel, abortControllerRef } = useOllamaStream();

    const chat = useCallback(async (messages, onChunk, onDone, onThinking, options = {}) => {
        stop();
        // --- INITIALIZE ABORT CONTROLLER FOR THIS CYCLE ---
        abortControllerRef.current = new AbortController();

        setIsPlaying(true);
        if (onThinking) onThinking(true);
        setError(null);
        const now = new Date();
        const timeString = now.toLocaleString('en-IN', {
            weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
            hour: 'numeric', minute: 'numeric', second: 'numeric', hour12: true
        });

        // Extract last user message (MUST BE BEFORE ENGINES)
        let lastUserText = "";
        let lastUserImages = null;

        if (messages.length > 0) {
            const lastRole = messages[messages.length - 1];
            if (lastRole.role === 'user') {
                lastUserText = lastRole.content || "";
                lastUserImages = lastRole.images;

                // Cleanup text if image exists but text is empty (sometimes UI sends empty string)
                if (!lastUserText.trim()) lastUserText = "";
            }
        }

        // --- NEW INTELLIGENT ORCHESTRATOR & MEMORY ---
        let orchestratedContext = "";
        let memoryContext = "";
        let backgroundTasksContext = "";

        if (options.backgroundTasks && options.backgroundTasks.length > 0) {
            const active = options.backgroundTasks.filter(t => t.status === 'running');
            if (active.length > 0) {
                backgroundTasksContext = `[CURRENTLY RUNNING BACKGROUND TASKS (DO NOT WAIT FOR THESE)]:\n` + active.map(t => `- ${t.name.replace(/_/g, ' ')} (Progress: ${t.progress})`).join('\n');
            }
        }

        // --- ROUTING LOGIC: LOCAL vs CLOUD ---
        const hasImages = lastUserImages && lastUserImages.length > 0;

        if (lastUserText && !options.skipOrchestrator) {
            try {
                // Parallel: Search Memory + Plan Tools
                const [memResults, orchestratorOutput] = await Promise.all([
                    memoryManager.search(lastUserText).catch(e => {
                        console.warn("Memory Search Failed:", e);
                        return "";
                    }),
                    planAndExecute(lastUserText, onChunk, {
                        ...options,
                        abortSignal: abortControllerRef.current?.signal,
                        hasImage: hasImages,
                        recentHistory: messages.slice(-6) // Pass last few messages for context (code recall, follow-ups)
                    }).catch(e => {
                        console.warn("Orchestrator Execution Failed:", e);
                        return { context: `[SYSTEM: Tool execution failed: ${e.message}]`, thought: "Error occurred" };
                    })
                ]);

                const { context: toolContext, thought: planThought, directUI, isDirectFallback } = orchestratorOutput || {};

                if (memResults) memoryContext = `[Relevant Memories]:\n${memResults}`;
                if (toolContext) orchestratedContext = toolContext;
                if (planThought) orchestratedContext = `[INTERNAL_PLAN: ${planThought}]\n\n${orchestratedContext}`;

                // Fetch Project Blackboard only if relevant or tasks are active
                const queryForBB = (lastUserText || "").toLowerCase();
                const needsBlackboard = /research|search|result|report|progress|task|tell me|blackboard|find|found/i.test(queryForBB) ||
                    (options.backgroundTasks && options.backgroundTasks.length > 0);

                if (needsBlackboard) {
                    try {
                        const bbContent = await readBlackboard();
                        if (bbContent && bbContent.trim() && !bbContent.includes("No notes yet.")) {
                            orchestratedContext += `\n\n[PROJECT BLACKBOARD (Background Task Results)]:\n${bbContent}`;
                        }
                    } catch (e) {
                        console.warn("Failed to read blackboard:", e);
                    }
                }

                // 🔥 NEW: Instantly inject direct UI elements (like Images) bypassing the LLM
                if (directUI) {
                    let injectionText = directUI;
                    
                    if (isDirectFallback) {
                        // Strip the system note intended for the LLM
                        injectionText = injectionText.split('\n\n(System Note')[0];
                        // Add the human-friendly response directly
                        injectionText += '\n\nये लीजिये सर, आपकी फोटोज़! 😊';
                    }
                    
                    console.log("Injecting Direct UI Component to Stream:", injectionText);
                    onChunk(`${injectionText}\n\n`);
                }
                
                // If it's a direct fallback (e.g. LLM refused to fetch an image due to NSFW filter),
                // we gracefully end the turn here to prevent the LLM from outputting an apology text.
                if (isDirectFallback) {
                    console.log("Direct Fallback Mode Active: Bypassing final LLM response.");
                    if (onDone) onDone();
                    return;
                }
            } catch (orchestratorError) {
                console.error("Critical Orchestrator Error:", orchestratorError);
                orchestratedContext = `[SYSTEM: Failed to process tools. Please rely on your internal knowledge.]`;
            }
        }

        let visionContext = "";



        // --- CONTEXT INJECTION & PREPARATION ---
        const finalMessages = messages.map(m => ({ ...m }));

        const customPersona = localStorage.getItem('CUSTOM_PERSONA');
        let dynamicPersona = await fetchPersona();
        if (dynamicPersona) {
            dynamicPersona = dynamicPersona
                .replace(/\{\{USER_NAME\}\}/g, config.getUserName())
                .replace(/\{\{CREATOR_NAME\}\}/g, config.getCreatorName());
        }
        const baseSystemPrompt = `${getLiyaSystemPrompt()}\n\n${dynamicPersona ? '\n\n# CUSTOM SOUL OVERRIDE\n' + dynamicPersona : ''}`;
        const masterName = config.getUserName();
        const identityAnchor = `\n\n[MANDATORY_IDENTITY]: Your Master's name is ${masterName}. You MUST call him ${masterName} and respond to him by name whenever appropriate. Never claim you do not know his name.`;

        if (finalMessages.length > 0) {
            if (finalMessages[0].role === 'system') {
                finalMessages[0].content = `${baseSystemPrompt}${identityAnchor}\n\n${finalMessages[0].content}`;
                if (customPersona) finalMessages[0].content += `\n\n[USER CUSTOM INSTRUCTIONS]:\n${customPersona}`;
            } else {
                const promptText = `${baseSystemPrompt}${identityAnchor}` + (customPersona ? `\n\n[USER CUSTOM INSTRUCTIONS]:\n${customPersona}` : "");
                finalMessages.unshift({ role: 'system', content: promptText });
            }
        }

        const last = finalMessages[finalMessages.length - 1];
        if (last && last.role === 'user') {
            const trivialSmallTalkPatterns = /^(ok|okay|thanks|thank you|hi|hello|hey|hii|hlo|hii|hola|howdy|sup|hiii|sure|got it|nice|good|great|cool|fine|yes|no|yep|nope|hmm|lol|haha|wow|understood|noted|👍|🙏|✅|👋)[.!?\s]*$/i;
            const isTrivial = last.content.length < 15 && trivialSmallTalkPatterns.test(last.content.toLowerCase().trim());
            const contextParts = [
                visionContext,
                memoryContext,
                `[System Time: ${timeString}]`
            ];

            // Only add complex tool context if the message isn't trivial
            if (!isTrivial) {
                contextParts.unshift(orchestratedContext);
                contextParts.push(backgroundTasksContext);
            }

            const context = contextParts.filter(Boolean).join('\n\n');
            const steeringMsg = isTrivial
                ? `[[${config.getAppName()}_INSTRUCTION]]: Be warm, brief, and very natural. No lists.]]`
                : `[[${config.getAppName()}_INSTRUCTION]]: Respond to Master ${config.getUserName()} naturally using the context provided. Do NOT be silent.]]`;

            // 🔥 IMPROVED: Structure the prompt using standard XML tags so modern models don't echo them
            last.content = context
                ? `<context>\n${context}\n</context>\n\n<instruction>\n${steeringMsg}\n</instruction>\n\n${last.content}`
                : (steeringMsg ? `<instruction>\n${steeringMsg}\n</instruction>\n\n${last.content}` : last.content);

            console.log(`📝 Final message length: ${last.content.length} characters`);
        }

        // --- SANITIZE PREVIOUS MESSAGES TO PREVENT HALLUCINATION LOOPS ---
        const sanitizedMessages = finalMessages.map(m => {
            if (m.role === 'assistant' && typeof m.content === 'string') {
                return {
                    ...m,
                    content: m.content
                        .replace(/<think>[\s\S]*?<\/think>\s*/gi, '')
                        .replace(/<\|?begin_of_sentence\|?>/gi, '')
                        .replace(/<\|?end_of_sentence\|?>/gi, '')
                        .replace(/[А-Яа-яЁё]/g, '') // Strip Russian characters just in case it's a deepseek anomaly
                };
            }
            return m;
        });

        // --- OPTIMIZATION: TOKEN GUARDIAN (Summarization) ---
        const optimizedMessages = await optimizeContext(sanitizedMessages);

        console.log("☁️ Sending to Cloud:", optimizedMessages);

        // FIX #26: Removed `new Promise(async ...)` anti-pattern. Using direct async/await instead.
        try {
            const storedKey = config.getApiKey('VITE_OLLAMA_CLOUD_API_KEY');

            const host = import.meta.env.VITE_BACKEND_URL ? `${import.meta.env.VITE_BACKEND_URL}/cloud-api` : 'http://localhost:3000/cloud-api';

            const userQuery = lastUserText.toLowerCase();
            const isOcrTask = userQuery.includes('ocr') || userQuery.includes('extract text') || userQuery.includes('likha');

            // 🧠 MULTI-MODEL INTELLIGENT ROUTING v2.0
            // Classifies prompt into 12 tiers and picks the optimal model
            let modelToUse;
            let tierClassification;

            if (options.model) {
                // Explicit model override (from settings or subagent)
                modelToUse = options.model;
                tierClassification = 'override';
            } else if (hasImages) {
                // Vision queries always go to the vision model
                modelToUse = getModelForRole('vision');
                tierClassification = 'vision';
            } else {
                // 🔥 INTELLIGENT CLASSIFICATION: Analyze the query and route to the best model
                tierClassification = classifyPrompt(lastUserText);
                
                // Detect follow-ups to canvas/name queries to keep using the coder model
                const isFollowUpToCanvas = messages.length > 1 && 
                    messages.slice(-2).some(m => 
                        m.role === 'assistant' && typeof m.content === 'string' &&
                        (m.content.toLowerCase().includes('canvas') || 
                         m.content.toLowerCase().includes('animate') || 
                         m.content.toLowerCase().includes('naam') || 
                         m.content.toLowerCase().includes('name'))
                    );
                if (tierClassification === 'fast' && isFollowUpToCanvas) {
                    console.log("⚡ Upgrading follow-up query to CODER tier based on conversation context.");
                    tierClassification = 'coder';
                }
                
                modelToUse = getRoutedModel(tierClassification);
            }

            const tierLabel = getTierLabel(tierClassification);
            console.log(`🤖 Intelligence Core: ${tierLabel} → ${modelToUse}`);

            // --- FIX: STRIP IMAGES IF NOT USING VISION MODEL ---
            // This prevents "model does not support image input" errors when images are in history
            const isVisionModel = tierClassification === 'vision' ||
                modelToUse.toLowerCase().includes('vl') ||
                modelToUse.toLowerCase().includes('vision') ||
                modelToUse.toLowerCase().includes('minimax') ||
                modelToUse.toLowerCase().includes('gemma4') ||
                modelToUse.toLowerCase().includes('llava');

            let finalPayloadMessages = optimizedMessages;
            if (!isVisionModel) {
                finalPayloadMessages = optimizedMessages.map(m => {
                    if (m.images) {
                        const { images: _IMAGES, ...rest } = m;
                        return rest;
                    }
                    return m;
                });
            }

            const effectiveKey = storedKey || 'BACKEND_MANAGED';
            if (!effectiveKey) throw new Error("Missing Cloud API Key.");

            const reasoningEffort = isOcrTask ? 'high' : (options.reasoningEffort || localStorage.getItem('REASONING_EFFORT') || 'medium');
            const finalReasoningEffort = tierClassification === 'smart' ? 'high' : (options.reasoningEffort || 'low');

            await streamChat({
                modelToUse,
                messages: finalPayloadMessages,
                onChunk,
                onDone,
                onThinking,
                reasoningEffort: finalReasoningEffort,
                cloudKey: effectiveKey,
                host
            });

        } catch (err) {
            console.error("Chat Process Error:", err);
            setError(err.message);
            setIsPlaying(false);
            if (onThinking) onThinking(false);
            throw err;
        }
    }, [stop, streamChat, setIsPlaying, setError]);

    const warmup = useCallback(async () => {
        try {
            console.log("🔥 Warming up Cloud Models...");
            const wHost = import.meta.env.VITE_BACKEND_URL ? `${import.meta.env.VITE_BACKEND_URL}/cloud-api` : 'http://localhost:3000/cloud-api';
            await fetch(`${wHost}/api/tags`).catch(() => { });
        } catch (e) {
            console.warn("Cloud Warmup Failed (Passive):", e);
        }
    }, []);

    return { chat, stop, isPlaying, error, warmup, currentModel };
};
