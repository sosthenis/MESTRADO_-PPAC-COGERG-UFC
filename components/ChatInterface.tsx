import React, { useState, useRef, useEffect } from 'react';
import { GoogleGenAI } from '@google/genai';
import { PPAC_KNOWLEDGE_BASE, MODEL_NAME_TEXT } from '../constants';
import { MessageLog } from '../types';
import { fileToBase64 } from '../utils/fileUtils';

interface ChatInterfaceProps {
  apiKey: string;
}

interface Attachment {
  name: string;
  mimeType: string;
  data: string; // Base64
}

const ChatInterface: React.FC<ChatInterfaceProps> = ({ apiKey }) => {
  const [messages, setMessages] = useState<MessageLog[]>([
    {
      role: 'model',
      text: 'Olá, como te ajudar nessa caminhada? Fala ai um tema que te explico',
      timestamp: new Date()
    }
  ]);
  const [inputValue, setInputValue] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [attachment, setAttachment] = useState<Attachment | null>(null);
  
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  
  // Initialize chat session ref to persist context
  const chatSessionRef = useRef<any>(null);

  useEffect(() => {
    if (!chatSessionRef.current) {
      const ai = new GoogleGenAI({ apiKey });
      chatSessionRef.current = ai.chats.create({
        model: MODEL_NAME_TEXT,
        config: {
          systemInstruction: PPAC_KNOWLEDGE_BASE,
        }
      });
    }
  }, [apiKey]);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      
      // Basic validation
      if (file.type !== 'application/pdf') {
        alert('Por favor, selecione apenas arquivos PDF.');
        return;
      }

      try {
        const base64Data = await fileToBase64(file);
        setAttachment({
          name: file.name,
          mimeType: file.type,
          data: base64Data
        });
      } catch (err) {
        console.error("Erro ao processar arquivo:", err);
        alert("Erro ao processar o arquivo.");
      }
    }
    // Reset input value so the same file can be selected again if needed
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const removeAttachment = () => {
    setAttachment(null);
  };

  const handleSend = async () => {
    if ((!inputValue.trim() && !attachment) || isLoading) return;

    const userText = inputValue.trim() || (attachment ? `Analise o arquivo anexado: ${attachment.name}` : '');

    const userMsg: MessageLog = {
      role: 'user',
      text: attachment ? `[Arquivo: ${attachment.name}]\n${inputValue}` : inputValue,
      timestamp: new Date()
    };

    setMessages(prev => [...prev, userMsg]);
    setInputValue('');
    setIsLoading(true);

    try {
      let result;
      
      if (attachment) {
        // Send multimodal content (Text + PDF)
        const parts = [
          { 
            inlineData: { 
              mimeType: attachment.mimeType, 
              data: attachment.data 
            } 
          },
          { 
            text: inputValue || "Por favor, analise este documento e me diga do que se trata." 
          }
        ];
        
        // When sending attachments, we use sendMessage with parts
        result = await chatSessionRef.current.sendMessage(parts);
        setAttachment(null); // Clear attachment after sending
      } else {
        // Text only
        result = await chatSessionRef.current.sendMessage({
          message: userText
        });
      }
      
      const responseText = result.text;
      
      const modelMsg: MessageLog = {
        role: 'model',
        text: responseText,
        timestamp: new Date()
      };
      
      setMessages(prev => [...prev, modelMsg]);
    } catch (error) {
      console.error("Erro no chat:", error);
      const errorMsg: MessageLog = {
        role: 'system',
        text: 'Ocorreu um erro ao processar sua mensagem. Tente novamente.',
        timestamp: new Date()
      };
      setMessages(prev => [...prev, errorMsg]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="flex flex-col h-full w-full max-w-4xl mx-auto bg-slate-900/50 rounded-2xl border border-indigo-500/30 overflow-hidden shadow-2xl backdrop-blur-sm">
      {/* Messages Area */}
      <div className="flex-1 overflow-y-auto p-6 space-y-4">
        {messages.map((msg, idx) => (
          <div 
            key={idx} 
            className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
          >
            <div 
              className={`max-w-[85%] rounded-2xl px-5 py-3 ${
                msg.role === 'user' 
                  ? 'bg-indigo-600 text-white rounded-tr-none' 
                  : msg.role === 'system'
                  ? 'bg-red-900/50 text-red-200 border border-red-500/30'
                  : 'bg-slate-800 text-slate-200 border border-indigo-500/20 rounded-tl-none'
              }`}
            >
              <div className="whitespace-pre-wrap text-sm leading-relaxed">
                {msg.text}
              </div>
              <div className={`text-[10px] mt-1 opacity-50 ${msg.role === 'user' ? 'text-right' : 'text-left'}`}>
                {msg.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </div>
            </div>
          </div>
        ))}
        {isLoading && (
          <div className="flex justify-start">
            <div className="bg-slate-800 rounded-2xl rounded-tl-none px-5 py-4 border border-indigo-500/20 flex gap-2 items-center">
              <div className="w-2 h-2 bg-indigo-400 rounded-full animate-bounce"></div>
              <div className="w-2 h-2 bg-indigo-400 rounded-full animate-bounce delay-100"></div>
              <div className="w-2 h-2 bg-indigo-400 rounded-full animate-bounce delay-200"></div>
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input Area */}
      <div className="p-4 bg-slate-900/80 border-t border-indigo-500/30">
        
        {/* Attachment Preview */}
        {attachment && (
          <div className="mb-2 flex items-center gap-2 bg-slate-800/80 border border-indigo-500/30 rounded-lg px-3 py-2 w-fit animate-fade-in-up">
            <div className="w-8 h-8 bg-red-500/20 rounded flex items-center justify-center text-red-400">
              <i className="fa-solid fa-file-pdf"></i>
            </div>
            <div className="flex flex-col">
              <span className="text-xs text-slate-200 font-medium truncate max-w-[200px]">{attachment.name}</span>
              <span className="text-[10px] text-slate-400">PDF Anexado</span>
            </div>
            <button 
              onClick={removeAttachment}
              className="ml-2 text-slate-400 hover:text-red-400 transition-colors"
            >
              <i className="fa-solid fa-xmark"></i>
            </button>
          </div>
        )}

        <div className="relative flex gap-2 items-end">
          <input 
            type="file" 
            ref={fileInputRef}
            onChange={handleFileSelect}
            accept=".pdf"
            className="hidden" 
          />
          
          <button
            onClick={() => fileInputRef.current?.click()}
            className="p-3 bg-slate-800 hover:bg-slate-700 text-indigo-400 rounded-xl border border-indigo-500/30 transition-colors h-[50px] w-[50px] flex-shrink-0"
            title="Anexar PDF"
          >
            <i className="fa-solid fa-paperclip text-lg"></i>
          </button>

          <textarea
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={handleKeyPress}
            placeholder={attachment ? "Pergunte sobre o arquivo..." : "Digite sua dúvida ou anexe um PDF..."}
            className="w-full bg-slate-800/50 border border-indigo-500/30 rounded-xl px-4 py-3 pr-12 text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent resize-none h-[50px] min-h-[50px] max-h-[120px] scrollbar-thin"
          />
          
          <button
            onClick={handleSend}
            disabled={(!inputValue.trim() && !attachment) || isLoading}
            className="absolute right-2 bottom-1.5 p-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed h-[40px] w-[40px]"
          >
            <i className="fa-solid fa-paper-plane"></i>
          </button>
        </div>
      </div>
    </div>
  );
};

export default ChatInterface;