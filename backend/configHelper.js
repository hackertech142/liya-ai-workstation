/**
 * configHelper.js
 * Utility to retrieve API keys with a fallback to the .env file if they are not present in process.env.
 * This is crucial for background/automated tasks where client headers are absent.
 */

const fs = require('fs-extra');
const path = require('path');
const dotenv = require('dotenv');

function getBackendApiKey(keyName) {
    if (process.env[keyName]) {
        return process.env[keyName];
    }
    
    // Fallback 1: Read from brain/api_keys.json (persisted keys from client UI session)
    try {
        const keysFilePath = path.resolve(__dirname, '../brain/api_keys.json');
        if (fs.existsSync(keysFilePath)) {
            const keys = fs.readJsonSync(keysFilePath);
            const val = keys[keyName] || keys[keyName.replace('VITE_', '')];
            if (val) {
                process.env[keyName] = val;
                return val;
            }
        }
    } catch (e) {
        console.warn(`[ConfigHelper] Error reading brain/api_keys.json fallback for ${keyName}:`, e.message);
    }
    
    // Fallback 2: Read directly from .env file
    try {
        const envPath = path.resolve(__dirname, '../.env');
        if (fs.existsSync(envPath)) {
            const envConfig = dotenv.parse(fs.readFileSync(envPath, 'utf8'));
            const val = envConfig[keyName] || envConfig[keyName.replace('VITE_', '')];
            if (val) {
                // Cache it back to process.env so we don't read the file every time
                process.env[keyName] = val;
                return val;
            }
        }
    } catch (e) {
        console.warn(`[ConfigHelper] Error reading .env fallback for ${keyName}:`, e.message);
    }
    return null;
}

function getBackendModel(modelKey, fallback = 'gemma4:31b-cloud') {
    if (process.env[modelKey]) {
        return process.env[modelKey];
    }
    
    // Check brain/settings.json (persisted settings from client Settings UI)
    try {
        const settingsPath = path.resolve(__dirname, '../brain/settings.json');
        if (fs.existsSync(settingsPath)) {
            const settings = fs.readJsonSync(settingsPath);
            const val = settings[modelKey] || settings[modelKey.replace('VITE_', '')];
            if (val) return val;
        }
    } catch (e) {
        console.warn(`[ConfigHelper] Error reading brain/settings.json for ${modelKey}:`, e.message);
    }
    
    // Check .env file
    try {
        const envPath = path.resolve(__dirname, '../.env');
        if (fs.existsSync(envPath)) {
            const envConfig = dotenv.parse(fs.readFileSync(envPath, 'utf8'));
            const val = envConfig[modelKey] || envConfig[modelKey.replace('VITE_', '')];
            if (val) return val;
        }
    } catch (e) {}

    return fallback;
}

module.exports = { getBackendApiKey, getBackendModel };
