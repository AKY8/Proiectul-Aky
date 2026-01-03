
import React, { useState, useRef, useEffect } from 'react';
import { GoogleGenAI } from "@google/genai";

export const ChatBot: React.FC = () => {
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState<{ role: 'user' | 'ai', text: string, sources?: any[] }[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, loading]);

  const handleSend = async () => {
    if (!input.trim() || loading) return;
    const userMsg = input.trim();
    setInput('');
    setMessages(prev => [...prev, { role: 'user', text: userMsg }]);
    setLoading(true);

    try {
      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
      const response = await ai.models.generateContent({
        model: 'gemini-3-flash-preview',
        contents: userMsg,
        config: {
          systemInstruction: 'You are the Osmos Prime Arena Assistant. You help players understand game mechanics like mass, split, and class roles. You also use Google Search to provide up-to-date gaming trends or help if asked.',
          tools: [{ googleSearch: {} }]
        }
      });

      const aiText = response.text || "I am currently recalibrating my neural net. Try again soon.";
      const sources = response.candidates?.[0]?.groundingMetadata?.groundingChunks;

      setMessages(prev => [...prev, { role: 'ai', text: aiText, sources }]);
    } catch (err) {
      setMessages(prev => [...prev, { role: 'ai', text: "Signal interference detected. AI offline." }]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex flex-col items-start w-80">
      {isOpen && (
        <div className="glass w-full h-[400px] rounded-[24px] mb-4 overflow-hidden flex flex-col border-white/10 shadow-3xl animate-in slide-in-from-bottom-6">
          <div className="bg-indigo-500/20 p-4 border-b border-white/10 flex justify-between items-center">
            <span className="font-orbitron text-[10px] font-black uppercase tracking-widest text-white">Arena Intel</span>
            <button onClick={() => setIsOpen(false)} className="text-white/40 hover:text-white">×</button>
          </div>
          <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-4 scrollbar-hide">
            {messages.length === 0 && (
              <div className="text-[11px] text-white/20 italic">Ask me about Osmos Prime mechanics or general gaming tactics...</div>
            )}
            {messages.map((m, i) => (
              <div key={i} className={`flex flex-col ${m.role === 'user' ? 'items-end' : 'items-start'}`}>
                <div className={`max-w-[85%] p-3 rounded-2xl text-[11px] ${m.role === 'user' ? 'bg-indigo-500 text-white' : 'bg-white/5 text-indigo-100 border border-white/5'}`}>
                  {m.text}
                </div>
                {m.sources && m.sources.length > 0 && (
                  <div className="mt-1 flex flex-wrap gap-1">
                    {m.sources.map((s: any, idx: number) => (
                      s.web?.uri && (
                        <a key={idx} href={s.web.uri} target="_blank" rel="noreferrer" className="text-[8px] text-indigo-400 underline truncate max-w-[60px]">
                          Source
                        </a>
                      )
                    ))}
                  </div>
                )}
              </div>
            ))}
            {loading && <div className="text-indigo-400 text-[10px] animate-pulse">AI is searching...</div>}
          </div>
          <div className="p-4 bg-slate-950/40 border-t border-white/10 flex gap-2">
            <input 
              className="flex-1 bg-transparent border-none outline-none text-[11px] text-white placeholder:text-white/20" 
              placeholder="Ask anything..." 
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleSend()}
            />
            <button onClick={handleSend} className="text-indigo-500 font-bold text-xs">→</button>
          </div>
        </div>
      )}
      <button 
        onClick={() => setIsOpen(!isOpen)} 
        className="glass w-12 h-12 rounded-2xl flex items-center justify-center hover:bg-indigo-500/20 transition-all border-white/20 text-indigo-400 text-xl shadow-2xl"
      >
        💬
      </button>
    </div>
  );
};
