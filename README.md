<div align="center">

  <img src="public/liya_logo.png" alt="LIYA AI Workstation Logo" width="110" />

  # LIYA AI Workstation
  ### *Next-Generation Agentic Desktop Workstation & Cognitive AI Assistant*

  [![React 19](https://img.shields.io/badge/React-19.0-61DAFB?style=flat-square&logo=react&logoColor=black)](https://react.dev/)
  [![Express Backend](https://img.shields.io/badge/Express-Backend-000000?style=flat-square&logo=express&logoColor=white)](https://expressjs.com/)
  [![Python](https://img.shields.io/badge/Python-3.10+-3776AB?style=flat-square&logo=python&logoColor=white)](https://python.org)
  [![Mem0 Memory](https://img.shields.io/badge/Mem0-Vector_Memory-FF4B4B?style=flat-square)](https://mem0.ai)
  [![Ollama Cloud](https://img.shields.io/badge/Ollama-Cloud_Routing-000000?style=flat-square)](https://ollama.com)
  [![License: MIT](https://img.shields.io/badge/License-MIT-emerald?style=flat-square)](LICENSE)

  <br />

  <img src="public/assets/liya_hero_banner.png" alt="LIYA AI Hero Banner" width="100%" />

</div>

---

## 📌 Overview

**LIYA (Neural Intelligent Yield Assistant)** is an advanced agentic desktop workstation and personal digital assistant. Built with **React 19**, **Express.js**, and **Python ONNX pipelines**, LIYA blends cognitive long-term memory, an interactive visual workspace (Canvas), local computer vision, and autonomous multi-agent orchestration into a unified, high-performance desktop interface.

---

## ✨ Key Features

<table>
  <tr>
    <td width="50%">
      <h3>🧠 Cognitive Vector Memory</h3>
      <p>Powered by <b>Mem0</b> (Cloud API + Local fallback). LIYA retains conversational context, user preferences, and historical facts across sessions without losing thread continuity.</p>
    </td>
    <td width="50%">
      <h3>🎨 Dynamic Interactive Canvas</h3>
      <p>A live visual workspace executing HTML/CSS/JS applications, interactive data charts (Recharts), Leaflet geographical maps, and multimedia playback in real time.</p>
    </td>
  </tr>
  <tr>
    <td width="50%">
      <h3>🎭 Local FaceSwap & Vision Engine</h3>
      <p>100% local, high-speed image and multi-threaded video face swapping via <code>inswapper_128.onnx</code> and <code>buffalo_l</code>. Private, zero cloud dependencies, and zero latency limits.</p>
    </td>
    <td width="50%">
      <h3>🤖 Autonomous Multi-Agent Orchestrator</h3>
      <p>Breaks complex requests into coordinated subtasks across specialized subagents (Coder, Academic Researcher, Terminal Executor) through a shared Blackboard architecture.</p>
    </td>
  </tr>
  <tr>
    <td width="50%">
      <h3>🗣️ Ultra-Fast Neural Speech</h3>
      <p>Real-time natural speech synthesis with Indian accent support (<code>hi-IN-SwaraNeural</code>) powered by Edge Neural TTS, with graceful browser voice fallback.</p>
    </td>
    <td width="50%">
      <h3>🧩 Integrated Mini-Apps Suite</h3>
      <p>Dedicated tools accessible directly inside the UI: Global Weather Telemetry, News Intelligence RSS, Live Currency Converter, Task Scheduler, and System Monitor.</p>
    </td>
  </tr>
</table>

---

## 📸 Interface Showcase

| Desktop Workspace & Canvas | Mini Apps Suite |
| :---: | :---: |
| ![LIYA Main Dashboard](public/assets/liya_main_dashboard.png) | ![LIYA Mini Apps Modal](public/assets/liya_mini_apps.png) |
| *Sci-Fi HUD Console with Split Canvas* | *Modular Quick-Access Mini Applications* |

| Interactive Canvas Media Card | Settings & API Gateway |
| :---: | :---: |
| ![LIYA Canvas YouTube Card](public/assets/liya_canvas_active_card.png) | ![LIYA Console Settings](public/assets/liya_settings.png) |
| *Active Media & Widget Execution on Canvas* | *Unified Model Routing & API Configuration* |

---

## 🏗️ System Architecture

```text
┌─────────────────────────────────────────────────────────────┐
│                      REACT 19 FRONTEND                      │
│   • Modern Sidebar        • Interactive Canvas Workstation  │
│   • JarvisHUD Interface   • Mini Apps Ecosystem             │
└──────────────────────────────┬──────────────────────────────┘
                               │ HTTP / WebSocket API
┌──────────────────────────────▼──────────────────────────────┐
│                    EXPRESS BACKEND SERVER                   │
│   • server.js (REST Controller) • orchestrator.js (Routing) │
│   • scheduler.js (Automations)  • voiceEngine.js (TTS)      │
│   • toolEngine.js (Web Scraper, Yandex/Bing Direct Fallback)│
└──────────────┬──────────────────────┬───────────────────────┘
               │                      │
       Local OS / Shell       Python ONNX Pipeline       Cloud Services
               │                      │                        │
       • File System          • FaceSwap (Image/Video)   • Ollama Cloud
       • PowerShell / CMD     • Inswapper 128 / Buffalo  • Mem0 Vector Cloud
```

---

## 🛠️ Quick Start

### 1. Prerequisites

Ensure your system has the following installed:
- **Node.js** `v20+` or `v22+ LTS`
- **Python** `3.10+` (with `pip`)
- **FFmpeg** (added to system `PATH` for video processing)
- **Git**

---

### 2. Installation

Clone the repository and install frontend & backend dependencies:

```bash
# 1. Clone repository
git clone https://github.com/hackertech142/Liya-adavnce-ai-asistant.git
cd Liya-adavnce-ai-asistant

# 2. Install root and backend dependencies
npm install
npm install --prefix backend

# 3. Install Python dependencies for computer vision
pip install -r backend/bin/requirements.txt

# 4. Install Playwright browser dependencies (for web scraping)
npx playwright install chromium --with-deps
```

---

### 3. Configuration (`.env`)

Copy `.env.example` to create your local `.env`:

```bash
cp .env.example .env
```

| Key | Description | Required |
| :--- | :--- | :---: |
| `VITE_OLLAMA_CLOUD_API_KEY` | Ollama Cloud / Model Provider Key | **Yes** |
| `VITE_MEM0_API_KEY` | Mem0 Vector Memory Cloud API Key | *Optional* |
| `VITE_WEATHER_API_KEY` | Weather Telemetry Data Key | *Optional* |
| `VITE_NEWS_API_KEY` | Global News RSS Key | *Optional* |
| `VITE_PEXELS_API_KEY` | High-Resolution Image Scraper Key | *Optional* |

> 💡 **Tip:** You can also configure all API keys directly through the **Settings** menu inside the app UI without restarting.

---

### 4. Running the Workstation

#### Option A: One-Click Launcher (Windows)
Double-click `Start_LIYA_AI.bat` in the project root.

#### Option B: Terminal Command
```bash
npm start
```

- **Frontend:** [http://localhost:5173](http://localhost:5173)
- **Backend Server:** [http://localhost:3000](http://localhost:3000)

---

## 💻 Tech Stack

- **Frontend:** React 19, Vite, Tailwind CSS, Lucide Icons, Recharts, Leaflet
- **Backend:** Node.js, Express.js, WebSockets (`ws`), Playwright Stealth, Node-Cron
- **AI & Memory:** Ollama Cloud, Qwen Vision Models, Mem0 Vector Memory
- **Vision Pipeline:** Python 3.10+, ONNX Runtime, OpenCV, InsightFace, FFmpeg

---

## 👨‍💻 Author

<div align="center">
  <img src="https://github.com/hackertech142.png" width="100" style="border-radius: 50%;" alt="Navraj Singh Momi" />
  <h3>Navraj Singh Momi</h3>
  <p>Creator & Lead Developer of LIYA AI Workstation</p>
  
  <p>
    <a href="https://www.linkedin.com/in/navraj-singh-4656263b0/"><img src="https://img.shields.io/badge/LinkedIn-0A66C2?style=flat-square&logo=linkedin&logoColor=white" alt="LinkedIn" /></a>
    <a href="https://instagram.com/navrajx_kamboz"><img src="https://img.shields.io/badge/Instagram-E4405F?style=flat-square&logo=instagram&logoColor=white" alt="Instagram" /></a>
    <a href="https://github.com/hackertech142"><img src="https://img.shields.io/badge/GitHub-181717?style=flat-square&logo=github&logoColor=white" alt="GitHub" /></a>
  </p>
</div>

---

<div align="center">
  <sub>Developed with ❤️ by <b>Navraj Singh Momi</b> • Released under the MIT License</sub>
</div>
