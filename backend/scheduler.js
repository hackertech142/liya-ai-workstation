/**
 * Liya Backend Scheduler
 * Handles reminders, automated tasks, and Misfire/Catch-up Recovery (FRIDAY Style)
 */

const cron = require('node-cron');
const fs = require('fs-extra');
const path = require('path');

const JOBS_FILE = path.join(__dirname, '..', 'brain', 'automated_jobs.json');
let activeJobs = [];
let orchestratorRef = null;
let ioRef = null;
let pendingCatchupJobs = [];
let isDispatchingCatchups = false;

/**
 * Clean up old screenshots older than 24 hours
 */
async function cleanOldScreenshots() {
    try {
        const imagesDir = path.join(__dirname, '..', 'public', 'images');
        if (!(await fs.pathExists(imagesDir))) return;

        const files = await fs.readdir(imagesDir);
        const now = Date.now();
        const expirationTime = 24 * 60 * 60 * 1000; // 24 hours
        let deletedCount = 0;

        for (const file of files) {
            if (file.startsWith('screenshot_') && file.endsWith('.jpg')) {
                const filePath = path.join(imagesDir, file);
                const stat = await fs.stat(filePath);
                if (now - stat.mtimeMs > expirationTime) {
                    await fs.remove(filePath);
                    deletedCount++;
                }
            }
        }

        if (deletedCount > 0) {
            console.log(`[Scheduler] Cleaned up ${deletedCount} expired screenshots.`);
        }
    } catch (e) {
        console.error('[Scheduler] Screenshot cleanup failed:', e);
    }
}

/**
 * Calculate expected target timestamp for a time string
 */
function calculateTargetTimestamp(time) {
    const now = new Date();
    if (time.match(/^\d+[mhs]$/i)) {
        const amount = parseInt(time.slice(0, -1), 10);
        const unit = time.slice(-1).toLowerCase();
        const target = new Date();
        if (unit === 'm') target.setMinutes(target.getMinutes() + amount);
        if (unit === 'h') target.setHours(target.getHours() + amount);
        if (unit === 's') target.setSeconds(target.getSeconds() + amount);
        return target.getTime();
    } else if (time.includes(':')) {
        const parts = time.split(':');
        const hour = parseInt(parts[0], 10);
        const min = parseInt(parts[1], 10);
        const sec = parts[2] ? parseInt(parts[2], 10) : 0;
        const target = new Date();
        target.setHours(hour, min, sec, 0);
        // If specified time today is already in past, it was intended for tomorrow
        if (target.getTime() <= now.getTime()) {
            target.setDate(target.getDate() + 1);
        }
        return target.getTime();
    }
    return null;
}

/**
 * Initialize the scheduler with orchestrator and IO reference
 */
function initScheduler(bot, orchestrator, ioInstance = null) {
    orchestratorRef = orchestrator;
    if (ioInstance) {
        ioRef = ioInstance;
    } else {
        try {
            const { io } = require('./server');
            ioRef = io;
        } catch (_) {}
    }

    if (ioRef) {
        ioRef.on('connection', (socket) => {
            console.log('[Scheduler] Client connected. Checking pending catch-ups...');
            setTimeout(() => dispatchPendingCatchups(), 1500);
        });
    }

    loadJobs();

    // Setup visual screenshot auto-cleanup (Runs every 4 hours)
    cron.schedule('0 */4 * * *', () => {
        cleanOldScreenshots();
    });
    // One-off cleanup 5 seconds after boot
    setTimeout(() => cleanOldScreenshots(), 5000);
}

let hasDispatchedBootCatchups = false;

/**
 * Deliver pending missed jobs in concise F.R.I.D.A.Y. style (Runs once per boot)
 */
async function dispatchPendingCatchups() {
    if (hasDispatchedBootCatchups || isDispatchingCatchups || pendingCatchupJobs.length === 0) return;
    hasDispatchedBootCatchups = true;
    isDispatchingCatchups = true;

    try {
        const { pushToChat, notifyDesktop } = require('./canvasBridge');
        console.log(`[Scheduler] 🚀 Delivering ${pendingCatchupJobs.length} missed task(s) in FRIDAY style...`);

        while (pendingCatchupJobs.length > 0) {
            const job = pendingCatchupJobs.shift();
            notifyDesktop("Missed Reminder Catch-up", job.title, 'info');

            // F.R.I.D.A.Y. style crisp English dispatch:
            const timeStr = job.time ? ` from ${job.time}` : '';
            const header = `🔔 **[Catch-Up Dispatch]** Boss, catching you up on a task scheduled${timeStr} while systems were offline:`;
            const noteStr = (job.prompt && job.prompt !== job.title && !job.prompt.toLowerCase().startsWith('reminder')) ? `\n*Note: ${job.prompt}*` : '';
            const content = `${header}\n\n📌 **${job.title}**${noteStr}`;
            pushToChat(content, 'assistant');

            const isActionTask = job.prompt && 
                /\b(weather|news|search|research|check|find|fetch|report|status|summary|get|tell me|latest)\b/i.test(job.prompt);

            if (isActionTask && orchestratorRef) {
                console.log(`[Scheduler] 🤖 Executing caught-up action: "${job.prompt}"`);
                try {
                    const res = await orchestratorRef(`[AUTOMATED ACTION: ${job.prompt}]`, () => {}, { 
                        chatId: job.chatId || 'desktop', 
                        isAutomated: true 
                    });
                    if (res && res.context) {
                        pushToChat(res.context, 'assistant');
                    }
                } catch (orchErr) {
                    console.error("[Scheduler] Catch-up Orchestrator Error:", orchErr.message);
                }
            }
        }
    } catch (e) {
        console.error("[Scheduler] Catch-up Dispatch Error:", e);
    } finally {
        isDispatchingCatchups = false;
        broadcastUpdate();
    }
}

/**
 * Load and restart saved jobs from disk, intercepting missed jobs (Catch-Up Policy)
 */
async function loadJobs() {
    try {
        if (await fs.pathExists(JOBS_FILE)) {
            const data = await fs.readJson(JOBS_FILE);
            const now = Date.now();
            const ONE_DAY_MS = 24 * 60 * 60 * 1000;
            let remainingJobs = [];

            for (const job of data) {
                // Check for missed one-time jobs
                if (job.frequency === 'once') {
                    let targetTime = job.targetTimestamp;

                    // If legacy job without targetTimestamp
                    if (!targetTime && job.time && job.time.includes(':')) {
                        const parts = job.time.split(':');
                        const h = parseInt(parts[0], 10);
                        const m = parseInt(parts[1], 10);
                        const s = parts[2] ? parseInt(parts[2], 10) : 0;
                        const tToday = new Date();
                        tToday.setHours(h, m, s, 0);
                        
                        if (tToday.getTime() < now) {
                            targetTime = tToday.getTime();
                        }
                    }

                    // If the scheduled time has already passed while server was offline
                    if (targetTime && targetTime < now) {
                        const age = now - targetTime;
                        if (age < ONE_DAY_MS) {
                            console.log(`[Scheduler] ⚠️ Missed scheduled job detected: "${job.title}" (Scheduled for ${job.time})`);
                            pendingCatchupJobs.push({ ...job, targetTimestamp: targetTime });
                        } else {
                            console.log(`[Scheduler] ⏱️ Discarding expired missed job (>24h): "${job.title}"`);
                        }
                        // Don't reschedule missed once-off jobs as active cron
                        continue;
                    }
                }

                // Normal future / recurring scheduling
                scheduleJob(job.chatId, job.time, job.frequency, job.prompt, job.title, false, job.id, job.targetTimestamp);
                remainingJobs.push(job);
            }

            console.log(`[Scheduler] Active jobs: ${activeJobs.length}, Pending catch-ups: ${pendingCatchupJobs.length}`);

            // Persist remaining jobs to disk
            if (remainingJobs.length !== data.length) {
                await fs.writeJson(JOBS_FILE, remainingJobs, { spaces: 2 });
            }

            setTimeout(() => {
                broadcastUpdate();
                dispatchPendingCatchups();
            }, 2000);
        }
    } catch (e) {
        console.error("[Scheduler] Load Error:", e);
    }
}

/**
 * Save current jobs to disk
 */
async function saveJobs() {
    try {
        const data = activeJobs.map(j => ({
            chatId: j.chatId,
            time: j.time,
            targetTimestamp: j.targetTimestamp || null,
            frequency: j.frequency,
            prompt: j.prompt,
            title: j.title,
            id: j.id
        }));
        await fs.ensureDir(path.dirname(JOBS_FILE));
        await fs.writeJson(JOBS_FILE, data, { spaces: 2 });
    } catch (e) {
        console.error("[Scheduler] Save Error:", e);
    }
}

/**
 * Schedule a new automation
 */
function scheduleJob(chatId, time, frequency, prompt, title, persist = true, idArg = null, targetTimestampArg = null) {
    const id = idArg || (Date.now().toString(36) + Math.random().toString(36).slice(2));
    let cronExpr = "";
    const targetTimestamp = targetTimestampArg || calculateTargetTimestamp(time);

    // 1. Convert time to cron
    if (time.includes(':')) {
        const parts = time.split(':');
        if (parts.length === 3) {
            // HH:mm:ss
            const [hour, min, sec] = parts;
            cronExpr = `${parseInt(sec, 10)} ${parseInt(min, 10)} ${parseInt(hour, 10)} * * *`;
        } else {
            // HH:mm
            const [hour, min] = parts;
            cronExpr = `0 ${parseInt(min, 10)} ${parseInt(hour, 10)} * * *`;
        }
    } else if (time.match(/^\d+[mhs]$/i)) {
        const amount = parseInt(time.slice(0, -1), 10);
        const unit = time.slice(-1).toLowerCase();
        const target = new Date();
        if (unit === 'm') target.setMinutes(target.getMinutes() + amount);
        if (unit === 'h') target.setHours(target.getHours() + amount);
        if (unit === 's') target.setSeconds(target.getSeconds() + amount);

        cronExpr = `${target.getSeconds()} ${target.getMinutes()} ${target.getHours()} ${target.getDate()} ${target.getMonth() + 1} *`;
        frequency = 'once';
    } else {
        cronExpr = time;
    }

    if (!cron.validate(cronExpr)) {
        console.error(`[Scheduler] Invalid cron expression: ${cronExpr}`);
        return false;
    }

    console.log(`[Scheduler] Scheduling job "${title}" with cron: ${cronExpr}`);

    const task = cron.schedule(cronExpr, async () => {
        console.log(`[Scheduler] 🚀 Triggering: ${title}`);

        try {
            const { notifyDesktop, pushToChat } = require('./canvasBridge');
            notifyDesktop("Scheduled Task Triggered", title, 'success');
            
            // Push reminder directly as assistant message
            const noteStr = (prompt && prompt !== title && !prompt.toLowerCase().startsWith('reminder')) ? `\n*Note: ${prompt}*` : '';
            pushToChat(`🔔 **Reminder:** ${title}${noteStr}`, 'assistant');

            const isActionTask = prompt && 
                /\b(weather|news|search|research|check|find|fetch|report|status|summary|get|tell me|latest)\b/i.test(prompt);

            if (isActionTask && orchestratorRef) {
                console.log(`[Scheduler] 🤖 Executing scheduled action: "${prompt}"`);
                try {
                    const res = await orchestratorRef(`[AUTOMATED ACTION: ${prompt}]`, () => {}, { 
                        chatId, 
                        isAutomated: true 
                    });
                    if (res && res.context) {
                        pushToChat(res.context, 'assistant');
                    }
                } catch (orchErr) {
                    console.error("[Scheduler] Orchestrator Task Error:", orchErr.message);
                }
            }
        } catch (e) {
            console.error("[Scheduler] Execution Error:", e);
        }

        if (frequency === 'once') {
            stopJobById(id);
        }
    });

    activeJobs.push({ id, chatId, time, targetTimestamp, frequency, prompt, title, task });
    if (persist) {
        saveJobs();
        broadcastUpdate();
    }
    return true;
}

function broadcastUpdate() {
    try {
        const { io } = require('./server');
        if (io) {
            console.log(`[Scheduler] Broadcasting update for ${activeJobs.length} jobs.`);
            io.emit('jobs-updated', activeJobs.map(j => ({
                id: j.id, chatId: j.chatId, time: j.time, frequency: j.frequency, title: j.title, prompt: j.prompt
            })));
        } else {
            console.warn('[Scheduler] Cannot broadcast: Socket.IO (io) not found.');
        }
    } catch (e) {
        console.error('[Scheduler] Broadcast Error:', e.message);
    }
}

function stopJobById(id) {
    const index = activeJobs.findIndex(j => j.id === id);
    if (index !== -1) {
        activeJobs[index].task.stop();
        activeJobs.splice(index, 1);
        saveJobs();
        broadcastUpdate();
        return true;
    }
    return false;
}

function stopJob(chatId, title) {
    const index = activeJobs.findIndex(j => j.chatId === chatId && j.title === title);
    if (index !== -1) {
        activeJobs[index].task.stop();
        activeJobs.splice(index, 1);
        saveJobs();
        broadcastUpdate();
        return true;
    }
    return false;
}

function getAllJobs(chatId = null) {
    let jobs = activeJobs;
    if (chatId) jobs = jobs.filter(j => j.chatId === chatId);
    return jobs.map(j => ({
        id: j.id, chatId: j.chatId, time: j.time, frequency: j.frequency, title: j.title, prompt: j.prompt
    }));
}

function clearAllJobs() {
    activeJobs.forEach(j => {
        try { if (j.task) j.task.stop(); } catch (_) {}
    });
    activeJobs = [];
    pendingCatchupJobs = [];
    saveJobs();
    broadcastUpdate();
    console.log('[Scheduler] 🧹 All active and pending jobs cleared.');
    return true;
}

const getJobs = getAllJobs;

module.exports = { initScheduler, scheduleJob, stopJob, stopJobById, getAllJobs, getJobs, clearAllJobs };
