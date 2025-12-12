import React, { useState, useRef, useEffect, useCallback } from 'react';
import { GoogleGenAI, LiveServerMessage, Modality } from '@google/genai';
import { PPAC_KNOWLEDGE_BASE, MODEL_NAME_VOICE } from './constants';
import { ConnectionState } from './types';
import { float32ToInt16, decodeAudioData, arrayBufferToBase64 } from './utils/audioUtils';
import Waveform from './components/Waveform';
import ChatInterface from './components/ChatInterface';

type AppMode = 'voice' | 'chat';

const App: React.FC = () => {
  const [mode, setMode] = useState<AppMode>('voice');
  const [connectionState, setConnectionState] = useState<ConnectionState>(ConnectionState.DISCONNECTED);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [inputVolume, setInputVolume] = useState(0);
  const [outputVolume, setOutputVolume] = useState(0);

  // Refs for Audio Handling
  const audioContextRef = useRef<AudioContext | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const inputSourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const nextStartTimeRef = useRef<number>(0);
  const activeSourcesRef = useRef<AudioBufferSourceNode[]>([]);
  
  // Volume analysis
  const inputAnalyserRef = useRef<AnalyserNode | null>(null);
  const outputAnalyserRef = useRef<AnalyserNode | null>(null);

  const cleanupAudio = useCallback(() => {
    // Stop all playing sources immediately
    activeSourcesRef.current.forEach(source => {
      try { source.stop(); } catch(e) { /* ignore */ }
    });
    activeSourcesRef.current = [];

    if (processorRef.current) {
      processorRef.current.disconnect();
      processorRef.current = null;
    }
    if (inputSourceRef.current) {
      inputSourceRef.current.disconnect();
      inputSourceRef.current = null;
    }
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach(track => track.stop());
      mediaStreamRef.current = null;
    }
    if (audioContextRef.current) {
      audioContextRef.current.close();
      audioContextRef.current = null;
    }
    setConnectionState(ConnectionState.DISCONNECTED);
    setInputVolume(0);
    setOutputVolume(0);
    nextStartTimeRef.current = 0;
  }, []);

  // Handle mode switch
  const handleModeChange = (newMode: AppMode) => {
    if (newMode === 'chat' && connectionState === ConnectionState.CONNECTED) {
      cleanupAudio();
    }
    setMode(newMode);
  };

  const connect = async () => {
    setErrorMsg(null);
    setConnectionState(ConnectionState.CONNECTING);

    try {
      if (!process.env.API_KEY) {
        throw new Error("API Key not found in environment variables.");
      }

      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
      
      // Setup Audio Context
      const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
      const audioCtx = new AudioContextClass({ sampleRate: 16000 }); 
      audioContextRef.current = audioCtx;

      // Output Analyser (Visualizer)
      const outputAnalyser = audioCtx.createAnalyser();
      outputAnalyser.fftSize = 256;
      outputAnalyserRef.current = outputAnalyser;
      outputAnalyser.connect(audioCtx.destination);

      // Get Microphone
      const stream = await navigator.mediaDevices.getUserMedia({ 
        audio: { 
          sampleRate: 16000,
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true
        } 
      });
      mediaStreamRef.current = stream;

      // Input Analyser
      const inputSource = audioCtx.createMediaStreamSource(stream);
      inputSourceRef.current = inputSource;
      const inputAnalyser = audioCtx.createAnalyser();
      inputAnalyser.fftSize = 256;
      inputAnalyserRef.current = inputAnalyser;
      inputSource.connect(inputAnalyser);

      const config = {
        model: MODEL_NAME_VOICE,
        config: {
          responseModalities: [Modality.AUDIO],
          systemInstruction: PPAC_KNOWLEDGE_BASE,
          speechConfig: {
            voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Kore' } },
          },
        },
      };

      const sessionPromise = ai.live.connect({
        ...config,
        callbacks: {
          onopen: () => {
            console.log("Session Opened");
            setConnectionState(ConnectionState.CONNECTED);
            
            const processor = audioCtx.createScriptProcessor(4096, 1, 1);
            processorRef.current = processor;

            processor.onaudioprocess = (e) => {
              const inputData = e.inputBuffer.getChannelData(0);
              const pcmInt16 = float32ToInt16(inputData);
              const pcmUint8 = new Uint8Array(pcmInt16.buffer);
              const base64 = arrayBufferToBase64(pcmUint8.buffer);

              sessionPromise.then(session => {
                session.sendRealtimeInput({
                   media: {
                     mimeType: 'audio/pcm;rate=16000',
                     data: base64
                   }
                });
              });
            };

            inputSource.connect(processor);
            processor.connect(audioCtx.destination);
          },
          onmessage: async (msg: LiveServerMessage) => {
             // Handle interruptions (Stop speaking immediately)
             if (msg.serverContent?.interrupted) {
                console.log("Interrupted by user");
                activeSourcesRef.current.forEach(source => {
                  try { source.stop(); } catch(e) { /* ignore */ }
                });
                activeSourcesRef.current = [];
                nextStartTimeRef.current = audioCtx.currentTime;
                return;
             }

             const audioData = msg.serverContent?.modelTurn?.parts?.[0]?.inlineData?.data;
             if (audioData) {
               try {
                 const buffer = await decodeAudioData(audioData, audioCtx);
                 const source = audioCtx.createBufferSource();
                 source.buffer = buffer;
                 source.connect(outputAnalyser);
                 
                 const currentTime = audioCtx.currentTime;
                 const startTime = Math.max(currentTime, nextStartTimeRef.current);
                 
                 source.start(startTime);
                 nextStartTimeRef.current = startTime + buffer.duration;

                 // Track active source
                 activeSourcesRef.current.push(source);
                 source.onended = () => {
                   activeSourcesRef.current = activeSourcesRef.current.filter(s => s !== source);
                 };

               } catch (e) {
                 console.error("Error decoding audio", e);
               }
             }
          },
          onclose: () => {
            console.log("Session Closed");
            cleanupAudio();
          },
          onerror: (err) => {
            console.error("Session Error", err);
            setErrorMsg("Erro de conexão com o servidor.");
            cleanupAudio();
          }
        }
      });

    } catch (err) {
      console.error(err);
      setErrorMsg(err instanceof Error ? err.message : "Falha ao iniciar audio");
      cleanupAudio();
    }
  };

  // Volume Monitoring Loop
  useEffect(() => {
    if (connectionState !== ConnectionState.CONNECTED || mode !== 'voice') return;
    
    let animFrame: number;
    const updateVolumes = () => {
      if (inputAnalyserRef.current) {
        const dataArray = new Uint8Array(inputAnalyserRef.current.frequencyBinCount);
        inputAnalyserRef.current.getByteFrequencyData(dataArray);
        const avg = dataArray.reduce((a, b) => a + b) / dataArray.length;
        setInputVolume(avg / 128);
      }
      
      if (outputAnalyserRef.current) {
        const dataArray = new Uint8Array(outputAnalyserRef.current.frequencyBinCount);
        outputAnalyserRef.current.getByteFrequencyData(dataArray);
        const avg = dataArray.reduce((a, b) => a + b) / dataArray.length;
        setOutputVolume(avg / 128);
      }
      animFrame = requestAnimationFrame(updateVolumes);
    };
    updateVolumes();
    return () => cancelAnimationFrame(animFrame);
  }, [connectionState, mode]);


  return (
    // Changed to University/COGERH Blue Theme
    <div className="flex flex-col h-full bg-gradient-to-br from-[#003366] via-[#004d4d] to-[#002244]">
      {/* Header */}
      <header className="p-4 sm:p-6 border-b border-cyan-500/20 backdrop-blur-md bg-white/5 z-20">
        <div className="max-w-6xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 bg-cyan-600 rounded-lg flex items-center justify-center shadow-lg shadow-cyan-500/20 border border-cyan-400/30">
              <i className="fa-solid fa-graduation-cap text-white text-2xl"></i>
            </div>
            <div>
              <h1 className="text-2xl font-bold tracking-tight text-white font-sans">
                PPAC <span className="text-cyan-400">2026.1</span>
              </h1>
              <div className="flex items-center gap-2">
                 <span className="text-[10px] bg-teal-800 text-teal-200 px-2 py-0.5 rounded border border-teal-600">COGERH</span>
              </div>
            </div>
          </div>
          
          {/* Mode Toggle */}
          <div className="flex bg-black/20 p-1 rounded-lg border border-cyan-500/20">
            <button
              onClick={() => handleModeChange('voice')}
              className={`px-4 py-2 rounded-md text-sm font-medium transition-all duration-200 flex items-center gap-2 ${
                mode === 'voice' 
                  ? 'bg-cyan-600 text-white shadow-lg' 
                  : 'text-cyan-100/70 hover:text-white hover:bg-white/5'
              }`}
            >
              <i className="fa-solid fa-microphone"></i>
              Voz
            </button>
            <button
              onClick={() => handleModeChange('chat')}
              className={`px-4 py-2 rounded-md text-sm font-medium transition-all duration-200 flex items-center gap-2 ${
                mode === 'chat' 
                  ? 'bg-cyan-600 text-white shadow-lg' 
                  : 'text-cyan-100/70 hover:text-white hover:bg-white/5'
              }`}
            >
              <i className="fa-solid fa-message"></i>
              Chat
            </button>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 flex flex-col items-center justify-center p-4 relative overflow-hidden">
        {/* Abstract Background Shapes (Academic/Water Vibe) */}
        <div className="blob bg-cyan-600/30 w-96 h-96 rounded-full top-[-50px] left-[-50px] mix-blend-screen"></div>
        <div className="blob bg-blue-600/30 w-[500px] h-[500px] rounded-full bottom-[-100px] right-[-100px] animation-delay-2000 mix-blend-screen"></div>
        <div className="absolute inset-0 bg-[url('https://www.transparenttextures.com/patterns/cubes.png')] opacity-5 pointer-events-none"></div>

        {mode === 'voice' ? (
          <>
            {/* Status Indicator */}
            <div className="mb-2 z-10 text-center min-h-[40px]">
                {connectionState === ConnectionState.DISCONNECTED && (
                     <div className="text-cyan-100/80 text-xl font-light tracking-wide animate-pulse flex flex-col items-center">
                        <i className="fa-solid fa-fingerprint text-4xl mb-4 text-cyan-500/50"></i>
                        Toque para iniciar a orientação
                     </div>
                )}
                {connectionState === ConnectionState.CONNECTING && (
                     <div className="text-cyan-300 text-lg font-medium flex items-center gap-2">
                        <i className="fa-solid fa-circle-notch fa-spin"></i> Conectando à base de conhecimento...
                     </div>
                )}
                {errorMsg && (
                    <div className="text-red-200 mt-4 bg-red-900/50 px-4 py-2 rounded-lg border border-red-500/30 backdrop-blur-sm">
                        <i className="fa-solid fa-circle-exclamation mr-2"></i>
                        {errorMsg}
                    </div>
                )}
            </div>

            {/* Visualizer Orb */}
            <div className="relative w-64 h-64 sm:w-80 sm:h-80 mb-8 flex items-center justify-center">
                {/* Rings */}
                <div className={`absolute inset-0 rounded-full border border-cyan-400/30 transition-all duration-700 ${connectionState === ConnectionState.CONNECTED ? 'scale-110 opacity-100 shadow-[0_0_50px_rgba(34,211,238,0.2)]' : 'scale-100 opacity-20'}`}></div>
                <div className={`absolute inset-4 rounded-full border border-blue-400/30 transition-all duration-700 delay-100 ${connectionState === ConnectionState.CONNECTED ? 'scale-110 opacity-100' : 'scale-100 opacity-20'}`}></div>
                
                {/* Core Visualizer */}
                <div className="w-full h-full rounded-full overflow-hidden bg-gradient-to-b from-[#0f172a] to-[#1e293b] border-2 border-cyan-500/30 shadow-2xl relative z-10">
                    {connectionState === ConnectionState.CONNECTED ? (
                        <div className="absolute inset-0 flex flex-col opacity-90">
                             {/* Output Wave (AI Speaking - Cyan/Green) */}
                             <div className="flex-1">
                                <Waveform isActive={true} volume={outputVolume} color="#22d3ee" />
                             </div>
                             {/* Input Wave (User Speaking - Blue) */}
                             <div className="flex-1 rotate-180">
                                <Waveform isActive={true} volume={inputVolume} color="#60a5fa" />
                             </div>
                        </div>
                    ) : (
                        <div className="absolute inset-0 flex items-center justify-center flex-col gap-2 text-slate-600">
                            <i className="fa-solid fa-microphone-lines text-5xl"></i>
                            <span className="text-xs uppercase tracking-widest opacity-50">Offline</span>
                        </div>
                    )}
                </div>
            </div>

            {/* Controls */}
            <div className="z-10 flex flex-col items-center gap-4">
                {connectionState === ConnectionState.DISCONNECTED || connectionState === ConnectionState.ERROR ? (
                    <button 
                        onClick={connect}
                        className="group relative px-8 py-4 bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 rounded-full transition-all duration-300 shadow-[0_0_30px_-5px_rgba(6,182,212,0.4)] hover:shadow-[0_0_50px_-5px_rgba(6,182,212,0.6)]"
                    >
                        <span className="flex items-center gap-3 text-white font-bold text-lg tracking-wide">
                            <i className="fa-solid fa-microphone"></i>
                            INICIAR ATENDIMENTO
                        </span>
                        <div className="absolute inset-0 rounded-full border border-white/20 group-hover:scale-105 transition-transform"></div>
                    </button>
                ) : (
                    <button 
                        onClick={cleanupAudio}
                        className="px-8 py-3 bg-red-500/10 hover:bg-red-500/20 border border-red-500/50 text-red-300 rounded-full transition-all flex items-center gap-2 backdrop-blur-sm"
                    >
                        <i className="fa-solid fa-phone-slash"></i>
                        Encerrar Sessão
                    </button>
                )}
            </div>
          </>
        ) : (
          <div className="w-full h-full z-10 flex items-center justify-center">
             <ChatInterface apiKey={process.env.API_KEY || ''} />
          </div>
        )}
      </main>

      {/* Footer Info */}
      <footer className="p-4 text-center text-cyan-100/40 text-xs border-t border-cyan-900/30 bg-[#001f3f]/80 backdrop-blur-sm">
        <div className="max-w-2xl mx-auto space-y-1">
          <p className="font-medium tracking-wide">PPAC - MESTRADO PROFISSIONAL</p>
          <p className="opacity-70">UFC • COGERH</p>
        </div>
      </footer>
    </div>
  );
};

export default App;