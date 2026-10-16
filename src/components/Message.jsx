import React, { useState, useRef, useMemo } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Bot, Volume2, Square, Download } from 'lucide-react';

import ChartRenderer from './ChartRenderer';
import { speakText, stopSpeech } from '../utils/speechUtils';
import { exportReport } from '../utils/exportUtils';

const API_BASE = import.meta.env.VITE_BACKEND_URL || '';

const Message = ({ role, content, images, fileName, onSpeaking, isPicoMode }) => {
    const isUser = role === 'user';
    const [isSpeaking, setIsSpeaking] = useState(false);
    const [isExporting, setIsExporting] = useState(false);
    const messageRef = useRef(null);

    // Memoized content processing
    const { chartData, directImages, reasoning, cleanContent, isAutomated, isSystem } = useMemo(() => {
        let currentChartData = null;
        let currentDirectImages = [];
        let currentReasoning = null;
        let processedContent = content || "";
        const automated = content && typeof content === 'string' && content.trim().startsWith('[AUTOMATED ACTION');
        const system = role === 'system' || (content && typeof content === 'string' && content.includes('SYSTEM ONLINE'));

        try {
            const chartMatch = processedContent.match(/\[CHART_DATA:\s*(\{[\s\S]*?\})\s*\]/);
            if (chartMatch) {
                try {
                    currentChartData = JSON.parse(chartMatch[1].trim());
                    processedContent = processedContent.replace(chartMatch[0], '').trim();
                } catch (e) {}
            }

            const imageRegex = /\[\s*DIRECT_IMAGE:\s*([^|]+?)\s*\|\s*([^\]]+?)\s*\]/gi;
            let match;
            while ((match = imageRegex.exec(processedContent)) !== null) {
                const rawUrl = match[1].trim();
                const safeUrl = rawUrl.replace(/\s+/g, '');
                currentDirectImages.push({ url: safeUrl, caption: match[2].trim() });
            }
            processedContent = processedContent.replace(/\[\s*DIRECT_IMAGE:\s*([^|]+?)\s*\|\s*([^\]]+?)\s*\]/gi, '').trim();
            processedContent = processedContent.replace(/!\[.*?\]\(\s*\)/g, '').trim();

            const thinkRegex = /<think>([\s\S]*?)(?:<\/think>|$)/gi;
            let thinkMatch;
            let thinkText = "";
            while ((thinkMatch = thinkRegex.exec(processedContent)) !== null) {
                thinkText += thinkMatch[1].trim() + "\n";
            }
            if (thinkText) {
                currentReasoning = thinkText.trim();
                processedContent = processedContent.replace(/<think>[\s\S]*?(?:<\/think>|$)/gi, '').trim();
            }

            if (automated) {
                processedContent = processedContent.trim().replace(/^\[AUTOMATED ACTION.*?\]:\s*/, '🤖 **Liya Automation initiated:** ');
            }

            // Prepend Canvas indicator while preserving the code block for viewing/copying
            processedContent = processedContent.replace(
                /(```(?:html|xml)?\s*[\s\S]*?(?:<!DOCTYPE html|<html|<svg)[\s\S]*?(?:```|<\/html>|<\/svg>|$))/gi,
                `\n\n🖥️ **[Canvas Interactive Visual Loaded]**\n*Maine side panel (Canvas) par is visual render ko load kar diya hai.*\n\n$1`
            );
        } catch (err) {}

        return {
            chartData: currentChartData,
            directImages: currentDirectImages,
            reasoning: currentReasoning,
            cleanContent: processedContent,
            isAutomated: automated,
            isSystem: system
        };
    }, [content, role]);

    return (
        <div className={`flex w-full mb-6 ${(isAutomated || isSystem) ? 'justify-center' : isUser ? 'justify-end' : 'justify-start'}`}>
            {(isAutomated || isSystem) ? (
                <div className={`px-4 py-2 flex flex-col items-center text-center transition-all w-full
                    ${content.includes('SYSTEM ONLINE')
                        ? 'bg-transparent text-gray-500'
                        : `rounded-xl max-w-2xl border ${content.includes('❌') || content.includes('failed') || content.includes('Error') || content.includes('⚠️')
                            ? 'bg-red-50 border-red-200 text-red-700'
                            : content.includes('✅') || content.includes('successfully') || content.includes('Stored')
                                ? 'bg-green-50 border-green-200 text-green-700'
                                : 'bg-gray-50 border-gray-200 text-gray-700'
                        }`
                    }
                `}>
                    <div ref={messageRef} className="system-message prose prose-sm flex flex-col items-center text-inherit">
                        <ReactMarkdown remarkPlugins={[remarkGfm]}>
                            {cleanContent || (reasoning ? '' : (content || ''))}
                        </ReactMarkdown>
                    </div>
                </div>
            ) : (
                <div className={`flex max-w-[85%] ${isUser ? 'flex-row-reverse' : 'flex-row'} items-start gap-4 w-full`}>
                    {!isUser && (
                        <div className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 border border-gray-200 shadow-sm bg-white text-gray-800">
                            <Bot size={18} />
                        </div>
                    )}

                    <div className={`flex flex-col flex-1 min-w-0 ${isUser ? 'items-end' : 'items-start'}`}>
                        {isUser && images && images.length > 0 && (
                            <div className="mb-3">
                                {images.map((imgBase64, i) => (
                                    <img
                                        key={i}
                                        src={`data:image/jpeg;base64,${imgBase64}`}
                                        alt="Uploaded content"
                                        className="max-w-full rounded-xl border border-gray-200 shadow-sm object-contain"
                                        style={{ maxHeight: '300px' }}
                                    />
                                ))}
                            </div>
                        )}
                        {isUser && fileName && (
                            <div className="mb-3 flex items-center gap-2 px-4 py-2 bg-gray-100 rounded-2xl w-fit">
                                <span className="text-gray-700 text-sm">📄 {fileName}</span>
                            </div>
                        )}

                        {!isUser && directImages.length > 0 && (
                            <div className="mb-3 space-y-3 w-full">
                                {directImages.map((img, i) => {
                                    const isExternal = img.url.startsWith('http') && !img.url.includes('localhost') && !img.url.includes('127.0.0.1');
                                    const displayUrl = isExternal ? `${API_BASE}/api/proxy/image?url=${encodeURIComponent(img.url)}` : img.url;
                                    return (
                                        <div key={i} className="flex flex-col gap-1 relative group w-fit">
                                            <img
                                                src={displayUrl}
                                                alt={img.caption}
                                                className="max-w-full rounded-xl border border-gray-200 shadow-sm object-contain"
                                                style={{ maxHeight: '400px' }}
                                                referrerPolicy="no-referrer"
                                                onError={(e) => {
                                                    if (!e.target.dataset.fallback && img.url) {
                                                        e.target.dataset.fallback = 'true';
                                                        e.target.src = `https://images.weserv.nl/?url=${encodeURIComponent(img.url)}`;
                                                    }
                                                }}
                                            />
                                            <button
                                                onClick={async (e) => {
                                                    e.preventDefault();
                                                    try {
                                                        const res = await fetch(displayUrl);
                                                        const blob = await res.blob();
                                                        const objectUrl = URL.createObjectURL(blob);
                                                        const a = document.createElement('a');
                                                        a.href = objectUrl;
                                                        a.download = (img.caption || 'image').replace(/[^a-z0-9]/gi, '_').toLowerCase() + '.jpg';
                                                        document.body.appendChild(a);
                                                        a.click();
                                                        document.body.removeChild(a);
                                                        URL.revokeObjectURL(objectUrl);
                                                    } catch (err) {
                                                        window.open(displayUrl, '_blank');
                                                    }
                                                }}
                                                className="absolute top-2 right-2 p-2 bg-black/60 text-white rounded-full transition-all hover:bg-black/80 backdrop-blur-sm shadow-md"
                                                title="Download Image"
                                            >
                                                <Download size={16} />
                                            </button>
                                            <span className="text-gray-500 text-xs italic w-full block">{img.caption}</span>
                                        </div>
                                    );
                                })}
                            </div>
                        )}

                        <div className={`${isUser ? 'bg-[#f4f4f4] text-gray-800 rounded-3xl px-5 py-3 w-fit max-w-full' : 'text-gray-800 w-full'}`}>
                            <div ref={messageRef} className={`prose prose-p:my-1 prose-pre:my-2 prose-sm md:prose-base leading-relaxed text-gray-800 max-w-none`}>
                                <ReactMarkdown
                                    remarkPlugins={[remarkGfm]}
                                    components={{
                                        img: ({ node, src, alt, ...props }) => {
                                            const isExternal = src && src.startsWith('http') && !src.includes('localhost') && !src.includes('127.0.0.1');
                                            const displayUrl = isExternal ? `${API_BASE}/api/proxy/image?url=${encodeURIComponent(src)}` : src;
                                            return (
                                                <img
                                                    {...props}
                                                    src={displayUrl}
                                                    alt={alt || ""}
                                                    className="max-w-full rounded-xl my-3 border border-gray-200 shadow-sm object-contain"
                                                    style={{ maxHeight: '400px' }}
                                                    referrerPolicy="no-referrer"
                                                    onError={(e) => {
                                                        if (!e.target.dataset.fallback && src) {
                                                            e.target.dataset.fallback = 'true';
                                                            e.target.src = `https://images.weserv.nl/?url=${encodeURIComponent(src)}`;
                                                        }
                                                    }}
                                                />
                                            );
                                        },
                                        table: (props) => <div className="overflow-x-auto my-4"><table {...props} className="w-full text-left border-collapse" /></div>,
                                        th: (props) => <th {...props} className="border-b border-gray-300 p-2 text-gray-700 font-semibold" />,
                                        td: (props) => <td {...props} className="border-b border-gray-200 p-2 text-gray-700" />
                                    }}
                                >
                                    {cleanContent || (reasoning ? '' : (content || ''))}
                                </ReactMarkdown>
                            </div>
                        </div>

                        {!isUser && (
                            <div className="mt-2 flex items-center justify-start gap-2">
                                <button
                                    onClick={() => {
                                        if (isSpeaking) {
                                            stopSpeech();
                                            setIsSpeaking(false);
                                            if (onSpeaking) onSpeaking(false);
                                        } else {
                                            const storedVoice = localStorage.getItem('PREFERRED_VOICE');
                                            speakText(cleanContent, storedVoice,
                                                () => {
                                                    setIsSpeaking(false);
                                                    if (onSpeaking) onSpeaking(false);
                                                },
                                                () => {
                                                    setIsSpeaking(true);
                                                    if (onSpeaking) onSpeaking(true);
                                                }
                                            );
                                        }
                                    }}
                                    className="p-1.5 text-gray-400 hover:text-gray-600 rounded transition-colors"
                                    title={isSpeaking ? "Stop Speaking" : "Read Aloud"}
                                >
                                    {isSpeaking ? <Square size={16} fill="currentColor" /> : <Volume2 size={16} />}
                                </button>
                            </div>
                        )}
                        {!isUser && chartData && (
                            <div className="mt-4 w-full max-w-lg">
                                <ChartRenderer type={chartData.type} data={chartData.data} title={chartData.title} />
                            </div>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
};

export default React.memo(Message);
