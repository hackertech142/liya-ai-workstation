import { useState, useEffect } from 'react';
import { getSocket } from '../utils/socket';

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || 'http://localhost:3000';

export const useScheduler = () => {
    const [automatedTasks, setAutomatedTasks] = useState([]);

    const fetchJobs = async () => {
        try {
            const res = await fetch(`${BACKEND_URL}/api/scheduler/jobs`);
            const data = await res.json();
            setAutomatedTasks(data.jobs || []);
        } catch (e) {
            console.error("Failed to fetch jobs:", e);
        }
    };

    useEffect(() => {
        fetchJobs();

        const socket = getSocket();
        
        socket.on('connect', () => {
            console.log("🟢 Scheduler Socket Connected");
        });

        socket.on('jobs-updated', (jobs) => {
            console.log("📅 Scheduler Sync: Jobs Updated", jobs);
            setAutomatedTasks(jobs);
        });

        socket.on('notification', (data) => {
            if (data.title === "Scheduled Task Triggered") {
                // If the backend triggered it, we might want to show it in chat
                // However, the backend already calls orchestrator which pushes results.
                // So we just let the results speak for themselves.
            }
        });

        return () => {
            socket.off('connect');
            socket.off('jobs-updated');
            socket.off('notification');
        };
    }, []);

    const addScheduledTask = async (task) => {
        try {
            const res = await fetch(`${BACKEND_URL}/api/scheduler/schedule`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ ...task, chatId: 'desktop' })
            });
            const data = await res.json();
            if (data.success) fetchJobs();
        } catch (e) {
            console.error("Failed to add task:", e);
        }
    };

    const deleteScheduledTask = async (id) => {
        try {
            const res = await fetch(`${BACKEND_URL}/api/scheduler/stop`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id })
            });
            const data = await res.json();
            if (data.success) fetchJobs();
        } catch (e) {
            console.error("Failed to delete task:", e);
        }
    };

    return { automatedTasks, addScheduledTask, deleteScheduledTask };
};
