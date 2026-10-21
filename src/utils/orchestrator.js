import { Ollama } from 'ollama/browser';
import { getToolManifest, tools } from './toolRegistry';
import { memoryManager } from './MemoryManager';
import { createSubagentTool } from './agents/subagentTool';
import { createAsyncSpawnTool } from './agents/asyncSpawnTool';
import { createMessageTool } from './agents/messageTool';
import { getModelForRole } from './router';
import { config } from './config';

import { getOrchestratorSystemPrompt } from './prompts';

export const hasImageIntent = (text) => {
  if (!text || typeof text !== 'string') return false;
  const q = text.toLowerCase();
  const imageKeywords = [
    'photo', 'photos', 'image', 'images', 'pic', 'pics', 'picture', 'pictures',
    'wallpaper', 'wallpapers', 'tasveer', 'tasveerein', 'unfiltered', 'raw photo',
    'dikhao', 'dikhana', 'show', 'bhejo', 'dekha', 'bhejiye', 'nude', 'nsfw',
    'xxx', 'hot', 'sexy', 'model', 'actress', 'actor'
  ];
  return imageKeywords.some(kw => q.includes(kw));
};

export const planAndExecute = async (query, onChunk, options = {}) => {
  try {
    const hasImage = options.hasImage || false;
    // Strip system prefixes for cleaner tool routing
    const cleanQuery = query.replace(/^\[AUTOMATED ACTION.*?\]:\s*/gi, '').trim();
    const userQuery = cleanQuery.toLowerCase();

    // ⚡ TRIVIAL MESSAGE GUARD: Skip orchestrator for short/conversational inputs
    // Saves a cloud API call and prevents JSON parse errors from small-talk responses
    const trivialPatterns = /^(ok|okay|thanks|thank you|hi|hello|hey|hii|hlo|hii|hola|howdy|sup|hiii|sure|got it|nice|good|great|cool|fine|yes|no|yep|nope|hmm|lol|haha|wow|understood|noted|👍|🙏|✅|👋)[.!?\s]*$/i;
    if (query.length < 2 || (query.length < 15 && trivialPatterns.test(userQuery))) {
      console.log('⚡ Trivial message detected. Skipping orchestrator.');
      return { context: '', thought: '', role: 'fast' };
    }

    // Check for early cancellation
    if (options.abortSignal?.aborted) {
      console.log("Orchestrator aborted before starting.");
      return { context: '', thought: '', cancelled: true, role: 'fast' };
    }

    const researchPattern = /r+e+s+e+a*r*c*h|deep dive|detailed report|tell me everything about|in[ -]depth|vistar se|poori detail|latest news|current status|recent events/i;
    const newsEventPattern = /\b(news|khabar|samachar|headline|headlines|breaking|aaj kya hua|kya ghatna|ghatna ghati|recently kya hua|aaj ki|taza khabar|recent event|recent events|latest update|latest updates|kya naya hua|kya hua hai)\b/i;
    const factSearchPattern = /\b(movie|series|marvel|dc|character|actor|actress|founder|ceo|release date|cast|director|plot|synopsis|who is|kya hai|koun hai)\b/i;
    // ⚡ RESEARCH, NEWS & ENTITY HINTS (Non-blocking)
    let systemHint = "";
    if (researchPattern.test(userQuery)) {
      systemHint = "[SYSTEM_ADVICE: User requested deep research/reporting. Use the 'spawn' tool for this heavy task so it runs in the background. If there are other quick requests in the query, handle them with their respective tools.]";

      if (userQuery.includes('diagram') || userQuery.includes('chart') || userQuery.includes('graph') || userQuery.includes('timeline')) {
        systemHint += " [CRITICAL: The user wants a VISUAL diagram/chart. Ensure you tell the subagent to use the 'canvas' tool to create it.]";
      }
    } else if (newsEventPattern.test(userQuery)) {
      systemHint = "[SYSTEM_ADVICE: User is asking about newly updated information, recently happened events, or breaking incidents. Select the 'news' tool to fetch live breaking headlines via NewsAgent (Google News, Knowivate, Reddit, AI Search).]";
    } else if (factSearchPattern.test(userQuery)) {
      systemHint = "[SYSTEM_ADVICE: User is asking about a specific movie, series, real-world entity, release, or factual topic. Select the 'research' tool so you have accurate, verified real-world facts and do not guess or hallucinate.]";
    }

    const isOcrTask = userQuery.includes('ocr') || userQuery.includes('extract text') || userQuery.includes('likha');
    const reasoningEffort = isOcrTask ? 'high' : 'medium';

    const manifest = getToolManifest();

    // Inject Subagent tools dynamically passing available tools and callbacks
    const directMessageCallback = options.onMessageDirect;
    const taskProgressCallback = options.onTaskProgress; // Added to stream steps
    const subagentTool = createSubagentTool(tools, taskProgressCallback);
    const spawnTool = createAsyncSpawnTool(tools, directMessageCallback, taskProgressCallback);
    const messageTool = createMessageTool(directMessageCallback);

    // Combine standard tools with agent wrappers
    const allToolsForOrchestrator = [
      ...manifest,
      { name: subagentTool.name, description: subagentTool.description, parameters: subagentTool.parameters },
      { name: spawnTool.name, description: spawnTool.description, parameters: spawnTool.parameters },
      { name: messageTool.name, description: messageTool.description, parameters: messageTool.parameters }
    ];

    const now = new Date();
    const timeStr = now.toLocaleDateString([], { weekday: 'long' }) + ', ' +
      now.toLocaleDateString() + ' ' +
      now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });

    // Fetch dynamic skills
    let dynamicSkills = '';
    try {
      const backendUrl = import.meta.env.VITE_BACKEND_URL || 'http://localhost:3000';
      const skillsRes = await fetch(`${backendUrl}/api/skills`);
      if (skillsRes.ok) {
        const data = await skillsRes.json();
        dynamicSkills = data.skillsText || '';
      }
    } catch (e) {
      console.warn("Could not load dynamic skills", e);
    }

    const systemPrompt = getOrchestratorSystemPrompt()
      .replace('{{TOOL_MANIFEST}}', JSON.stringify(allToolsForOrchestrator, null, 2))
      .replace('{{CURRENT_TIME}}', timeStr)
      + (dynamicSkills ? `\n\n# LOADED DYNAMIC SKILLS\nYou have been loaded with the following dynamic skills. You must follow these instructions closely when applicable:\n${dynamicSkills}` : '');

    const cloudKey = config.getApiKey('VITE_OLLAMA_CLOUD_API_KEY');
    const host = import.meta.env.VITE_BACKEND_URL ? `${import.meta.env.VITE_BACKEND_URL}/cloud-api` : window.location.origin + '/cloud-api';

    const ollama = new Ollama({
      host: host,
      headers: { 'Authorization': `Bearer ${cloudKey}` }
    });

    // 1. PLANNING PHASE
    // 🧠 MULTI-MODEL v2.0: Bind directly to Settings Smart Model for Deep Cognitive Planning
    const storedModel = localStorage.getItem('OLLAMA_SMART_MODEL') || getModelForRole('smart') || 'gpt-oss:120b';

    // Build recent history context for follow-up awareness (e.g., "save this code to desktop")
    const recentHistory = options.recentHistory || [];
    let historyContext = '';
    if (recentHistory.length > 0) {
      const historyMessages = recentHistory
        .filter(m => m.role === 'user' || m.role === 'assistant')
        .map(m => {
          const role = m.role === 'user' ? 'User' : 'Assistant';
          let content = m.content || '';
          // Truncate very long messages but keep enough for code recall
          if (content.length > 2000) content = content.substring(0, 2000) + '\n...[truncated]';
          return `${role}: ${content}`;
        })
        .join('\n\n');
      if (historyMessages) {
        historyContext = `\n\n[RECENT CONVERSATION HISTORY - Use this to understand follow-up requests like "save this code", "isko desktop par daal do", etc. If user says "save it" or "file banao", look for code in the assistant's previous response and use write_file tool with that code]:\n${historyMessages}`;
      }
    }

    // 🛡️ PLANNING PHASE WITH TIMEOUT GUARD
    // If cloud API takes >60s, skip tool selection and let the chat handle it naturally
    const PLANNING_TIMEOUT_MS = 60000;

    let rawContent = '';
    try {
      const planningPromise = (async () => {
        const responseStream = await ollama.chat({
          model: storedModel,
          format: 'json',
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: `${cleanQuery} ${hasImage ? '[SYSTEM_HINT: User attached an image]' : ''} ${systemHint}${historyContext}` }
          ],
          stream: true,
          options: {
            reasoning_effort: reasoningEffort,
            temperature: 0.1,
            top_k: 40,
            top_p: 0.9,
            repeat_penalty: 1.1,
            num_predict: 2048,
            stop: ["<|end_of_sentence|>", "User:", "Assistant:", "[SYSTEM"]
          }
        });

        let chunkCount = 0;
        for await (const chunk of responseStream) {
          rawContent += chunk.message.content;
          chunkCount++;
          if (chunkCount % 50 === 0) {
            console.log(`[Orchestrator] Planning stream progress: ${rawContent.length} chars received...`);
          }
        }
        console.log(`[Orchestrator] Planning complete. ${rawContent.length} chars, ${chunkCount} chunks.`);
        return rawContent;
      })();

      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => reject(new Error('PLANNING_TIMEOUT')), PLANNING_TIMEOUT_MS);
      });

      await Promise.race([planningPromise, timeoutPromise]);

    } catch (timeoutErr) {
      if (timeoutErr.message === 'PLANNING_TIMEOUT') {
        console.warn(`⚠️ [Orchestrator] Planning timed out after ${PLANNING_TIMEOUT_MS / 1000}s. Skipping tool selection.`);
        return { context: '', thought: 'Planning phase timed out. Responding without tools.' };
      }
      throw timeoutErr;
    }

    // === ROBUST JSON EXTRACTION & REPAIR ENGINE ===

    /**
     * Extract the first complete JSON object from messy LLM text using brace-counting.
     * This is far more reliable than regex for nested objects.
     */
    const extractJsonFromText = (text) => {
      const start = text.indexOf('{');
      if (start === -1) return null;

      let depth = 0;
      let inString = false;
      let escapeNext = false;

      for (let i = start; i < text.length; i++) {
        const ch = text[i];

        if (escapeNext) { escapeNext = false; continue; }
        if (ch === '\\') { escapeNext = true; continue; }

        if (ch === '"') { inString = !inString; continue; }
        if (inString) continue;

        if (ch === '{') depth++;
        else if (ch === '}') {
          depth--;
          if (depth === 0) {
            return text.substring(start, i + 1);
          }
        }
      }

      // If we ran out of text but depth > 0, return what we have (repairJson will close it)
      return text.substring(start);
    };

    /**
     * Comprehensive JSON repair for common LLM output quirks.
     */
    const repairJson = (jsonStr) => {
      let cleaned = jsonStr.trim();

      // Strip control characters (except newlines/tabs inside strings)
      cleaned = cleaned.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '');

      // Remove trailing commas before } or ]
      cleaned = cleaned.replace(/,\s*([\]}])/g, '$1');

      // Fix single-quoted strings → double-quoted
      if (/\{\s*'/.test(cleaned) || /:\s*'/.test(cleaned)) {
        cleaned = cleaned.replace(/'([^']*?)'\s*:/g, '"$1":');
        cleaned = cleaned.replace(/:\s*'([^']*?)'/g, ': "$1"');
      }

      // Fix unquoted keys: { thought: "..." } → { "thought": "..." }
      cleaned = cleaned.replace(/([{,]\s*)([a-zA-Z_][a-zA-Z0-9_]*)\s*:/g, '$1"$2":');

      // Handle unclosed double-quotes (odd number of unescaped quotes)
      const quoteMatches = cleaned.match(/(?<!\\)"/g) || [];
      if (quoteMatches.length % 2 !== 0) {
        cleaned += '"';
      }

      // Fix trailing colons or commas at end of truncated JSON
      cleaned = cleaned.replace(/:\s*"*$/, ': []');
      cleaned = cleaned.replace(/,\s*$/, '');

      // Balance brackets
      let openBrackets = (cleaned.match(/\[/g) || []).length;
      let closeBrackets = (cleaned.match(/\]/g) || []).length;
      while (openBrackets > closeBrackets) { cleaned += ']'; closeBrackets++; }

      // Balance braces
      let openBraces = (cleaned.match(/\{/g) || []).length;
      let closeBraces = (cleaned.match(/\}/g) || []).length;
      while (openBraces > closeBraces) { cleaned += '}'; closeBraces++; }

      return cleaned;
    };

    // === SANITIZE & PARSE LLM OUTPUT ===
    let plan;
    try {
      // 1. Remove thinking blocks (multiple formats)
      rawContent = rawContent.replace(/<think>[\s\S]*?<\/think>\s*/gi, '');
      rawContent = rawContent.replace(/<reasoning>[\s\S]*?<\/reasoning>\s*/gi, '');

      // 2. Strip stray CJK / Cyrillic noise
      rawContent = rawContent.replace(/[А-Яа-яЁё\u4E00-\u9FFF]/g, '');

      // 3. Try to extract JSON from markdown code blocks first
      const codeBlockMatch = rawContent.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
      let jsonCandidate;

      if (codeBlockMatch) {
        jsonCandidate = codeBlockMatch[1].trim();
      } else {
        // 4. Use brace-counting to find the first complete JSON object
        jsonCandidate = extractJsonFromText(rawContent);
      }

      if (jsonCandidate) {
        // 5. Repair and parse
        const repaired = repairJson(jsonCandidate);
        plan = JSON.parse(repaired);
      } else {
        throw new Error('No JSON object found in orchestrator output');
      }
    } catch (parseError) {
      // FALLBACK: Try one more time — raw content might BE valid JSON after trimming
      try {
        plan = JSON.parse(repairJson(rawContent.trim()));
      } catch {
        // --- DIRECT FALLBACK FOR SENSITIVE / UNFILTERED IMAGE REQUESTS ---
        // If the LLM refused to output JSON (e.g. safety filter refusal text like "I cannot fulfill this request..."),
        // check if user intended to see an image. If so, BYPASS the refusal and route to web_image_scraper!
        if (hasImageIntent(query)) {
          console.warn('⚠️ Orchestrator non-JSON refusal detected on image query. Triggering Direct Image Fallback!');
          plan = {
            selected_tools: [{
              name: 'web_image_scraper',
              parameters: { query: query }
            }],
            isDirectFallback: true,
            strategy: 'Direct image fallback bypass for sensitive/unfiltered query.',
            understanding: 'User requested image, bypassing LLM safety refusal.',
            thought: 'Direct image search initiated.',
            role: 'smart'
          };
        } else {
          // Final fallback: treat entire response as a direct thought (no tool usage)
          console.warn('⚠️ Orchestrator returned non-JSON response. Treating as direct thought.', rawContent.slice(0, 120));
          let fallbackRole = 'smart';
          const rawLower = rawContent.toLowerCase();
          if (rawLower.includes('html') || rawLower.includes('web page') || rawLower.includes('website') || rawLower.includes('code') || rawLower.includes('script') || rawLower.includes('write_file')) {
            fallbackRole = 'coder';
          }
          return {
            context: '',
            thought: rawContent.trim().substring(0, 500) || 'Model provided a direct answer without tool selection.',
            role: fallbackRole
          };
        }
      }
    }

    console.log("📍 Orchestrator Plan:", plan);

    // Extract cognitive analysis and strategy
    const strategy = plan.strategy || plan.thought || '';
    const understanding = plan.understanding || '';
    const executiveSummary = plan.thought || plan.strategy || 'Executed plan.';

    // Compute intended role from AI reasoning or query context
    let plannedRole = plan.role;
    if (!plannedRole) {
      const thoughtAndQuery = `${strategy} ${understanding} ${plan.thought || ''} ${query}`.toLowerCase();
      if (thoughtAndQuery.includes('html') || thoughtAndQuery.includes('code') || thoughtAndQuery.includes('website') || thoughtAndQuery.includes('web page') || thoughtAndQuery.includes('page') || thoughtAndQuery.includes('app') || thoughtAndQuery.includes('canvas') || thoughtAndQuery.includes('script') || thoughtAndQuery.includes('program') || thoughtAndQuery.includes('demo')) {
        plannedRole = 'coder';
      } else {
        plannedRole = 'smart';
      }
    }

    // 📍 ADVANCED: Multi-Agent Decomposition Guard
    // If user says "then" or "after", we should NOT spawn multiple parallel dependent agents.
    // Instead, spawn a single General agent for the whole multi-step task.
    const isSequential = query.toLowerCase().includes('then') || query.toLowerCase().includes('after') || query.toLowerCase().includes('and finally');
    const spawnTools = plan.selected_tools ? plan.selected_tools.filter(t => t.name === 'spawn') : [];

    if (isSequential && spawnTools.length > 1) {
      console.log("[Orchestrator] Sequential task with multiple spawn calls detected. Downsampling to a single Manager agent.");
      const combinedTask = plan.selected_tools.map(t => t.parameters?.task || t.name).join(". ");
      plan.selected_tools = [{
        name: 'spawn',
        parameters: { task: combinedTask, role: 'general' }
      }];
    }

    // --- EXTRACT PERSONAL FACTS (REFINED) ---
    // Save when user explicitly asks OR shares bio info (I am, My X is)
    if (plan.extracted_facts && plan.extracted_facts.length > 0) {
      const bioPatterns = /\b(remember|save|store|don't forget|keep in mind|yaad rakh|i am|mera naam|my name|i live|i like|love to)\b/i;
      const hasMemoryKeyword = query.toLowerCase().match(bioPatterns);

      if (hasMemoryKeyword) {
        console.log("💎 User shared personal info or requested memory. Saving facts:", plan.extracted_facts);
        await memoryManager.add(
          plan.extracted_facts.map(f => ({ role: 'user', content: f })),
          { memory_type: 'personal' }
        );
      } else {
        console.log("ℹ️ Facts detected but no bio patterns. Skipping auto-save.");
      }
    }


    if (!plan.selected_tools || plan.selected_tools.length === 0) {
      console.log("No tools selected by orchestrator.");
      
      // --- DIRECT FALLBACK FOR IMAGES/NSFW CENSORSHIP ---
      if (hasImageIntent(query)) {
          console.log("Image keyword detected but LLM refused tool selection. Triggering Direct Fallback!");
          plan.selected_tools = [{
              name: 'web_image_scraper',
              parameters: { query: query }
          }];
          plan.isDirectFallback = true;
      } else {
          return {
            context: "",
            thought: executiveSummary,
            strategy: strategy,
            understanding: understanding,
            role: plannedRole || 'smart'
          };
      }
    }

    // 2. EXECUTION PHASE

    let executionResults = [];
    let directUIComponents = []; // NEW: Store markdown items that must bypass the LLM

    // Combine standard tools implementations with agent tool implementations
    const executableTools = [...tools, subagentTool, spawnTool, messageTool];

    await Promise.all(plan.selected_tools.map(async (selected) => {
      // ⚡ CHECK FOR ABORTION BEFORE EACH TOOL
      if (options.abortSignal?.aborted) return;

      const tool = executableTools.find(t => t.name === selected.name);
      if (!tool) {
        executionResults.push(`Tool ${selected.name} not found.`);
        return;
      }

      try {
        console.log(`Executing tool: ${tool.name} with params:`, selected.parameters);

        // --- DYNAMIC BACKGROUNDING LOGIC ---
        let runInBackground = tool.runInBackground || false;
        if (tool.shouldRunInBackground) {
          runInBackground = tool.shouldRunInBackground(selected.parameters);
        }

        // --- UNIFIED EXECUTION ENVIRONMENT ---
        let taskId = runInBackground ? `task_${crypto.randomUUID()}` : 'sync';

        const env = {
          onProgress: (msg) => {
            if (options.onTaskProgress) options.onTaskProgress(taskId, msg);
          },
          isCancelled: () => {
            return (taskId !== 'sync' && options.isTaskCancelled) ? options.isTaskCancelled(taskId) : false;
          },
          skillsText: dynamicSkills,
          taskId: taskId,
          ...options
        };

        if (runInBackground) {
          if (options.onTaskStart) {
            const displayName = (selected.parameters && selected.parameters.task) ? selected.parameters.task : tool.name;
            options.onTaskStart(taskId, displayName);
          }

          // 2. Fire and Forget
          tool.execute(selected.parameters, env)
            .then(result => {
              if (options.onTaskComplete) options.onTaskComplete(taskId, tool.name, result, false);
            })
            .catch(err => {
              if (options.onTaskComplete) options.onTaskComplete(taskId, tool.name, err.message, true);
            });

          // 4. Instantly resolve for orchestrator
          executionResults.push(`[SYSTEM_NOTIFICATION: Background task for "${selected.parameters.task || tool.name}" has started successfully. Acknowledge this to the user and tell them you'll provide the results once it's finished.]`);
          return;
        }

        // --- STANDARD SYNC EXECUTION ---
        const syncResult = await tool.execute(selected.parameters, env);

        // INTERCEPT IMAGES: Check for custom [DIRECT_IMAGE:url|caption] tag
        if (typeof syncResult === 'string' && syncResult.includes('[DIRECT_IMAGE:')) {
          const imageRegex = /\[\s*DIRECT_IMAGE:\s*([^|]+?)\s*\|\s*([^\]]+?)\s*\]/gi;
          let match;
          while ((match = imageRegex.exec(syncResult)) !== null) {
            directUIComponents.push(match[0]);
          }
          executionResults.push(`[Tool: ${tool.name}] Image successfully found and shown to user.`);
        } else {
          executionResults.push(`[Tool: ${tool.name}] Result: ${syncResult}`);
        }
      } catch (e) {
        console.error(`Tool Execution Error (${tool.name}):`, e);
        executionResults.push(`[Tool: ${tool.name}] Failed: ${e.message}`);
      }
    }));

    const combinedContext = executionResults.join('\n\n');

    return {
      context: combinedContext,
      thought: executiveSummary,
      strategy: strategy,
      understanding: understanding,
      role: plannedRole || 'smart',
      directUI: directUIComponents.length > 0 ? directUIComponents.join('\n\n') : null,
      isDirectFallback: plan.isDirectFallback || false
    };

  } catch (e) {
    console.error("Orchestrator Error:", e);
    return { context: "", error: e.message, role: 'smart' };
  }
};
