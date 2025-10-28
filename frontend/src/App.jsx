import React, { useCallback, useEffect, useRef, useState } from 'react';

const WS_URL = process.env.VITE_BACKEND_WS_URL || 'ws://localhost:4000/ws/audio';
const INPUT_SAMPLE_RATE = 16000;

const floatTo16BitPCM = (float32Array) => {
  const buffer = new ArrayBuffer(float32Array.length * 2);
  const view = new DataView(buffer);
  for (let i = 0; i < float32Array.length; i += 1) {
    let sample = float32Array[i];
    sample = Math.max(-1, Math.min(1, sample));
    view.setInt16(i * 2, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
  }
  return buffer;
};

const base64ToArrayBuffer = (base64) => {
  const binary = atob(base64);
  const buffer = new ArrayBuffer(binary.length);
  const bytes = new Uint8Array(buffer);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return buffer;
};

const extractPcmFromWav = (arrayBuffer) => {
  if (!arrayBuffer || arrayBuffer.byteLength < 44) {
    return arrayBuffer;
  }
  const view = new DataView(arrayBuffer);
  const riff = String.fromCharCode(
    view.getUint8(0),
    view.getUint8(1),
    view.getUint8(2),
    view.getUint8(3)
  );
  const wave = String.fromCharCode(
    view.getUint8(8),
    view.getUint8(9),
    view.getUint8(10),
    view.getUint8(11)
  );

  if (riff !== 'RIFF' || wave !== 'WAVE') {
    return arrayBuffer;
  }

  let offset = 12;
  while (offset + 8 <= view.byteLength) {
    const chunkId = String.fromCharCode(
      view.getUint8(offset),
      view.getUint8(offset + 1),
      view.getUint8(offset + 2),
      view.getUint8(offset + 3)
    );
    const chunkSize = view.getUint32(offset + 4, true);
    const dataStart = offset + 8;
    if (chunkId === 'data') {
      const end = Math.min(dataStart + chunkSize, view.byteLength);
      return arrayBuffer.slice(dataStart, end);
    }
    offset += 8 + chunkSize + (chunkSize % 2);
  }

  return arrayBuffer;
};

export default function App() {
  const [isRecording, setIsRecording] = useState(false);
  const [interimText, setInterimText] = useState('');
  const [messages, setMessages] = useState([]);
  const [connectionState, setConnectionState] = useState('disconnected');
  const wsRef = useRef(null);
  const mediaStreamRef = useRef(null);
  const processorRef = useRef(null);
  const inputContextRef = useRef(null);
  const playbackContextRef = useRef(null);
  const playbackQueueRef = useRef({ nextTime: 0 });
  const pendingStartRef = useRef(false);

  const ensurePlaybackContext = useCallback(async () => {
    if (!playbackContextRef.current) {
      const context = new AudioContext();
      await context.resume();
      playbackContextRef.current = context;
      playbackQueueRef.current.nextTime = context.currentTime;
    }
    return playbackContextRef.current;
  }, []);

  const stopRecording = useCallback(async () => {
    pendingStartRef.current = false;
    if (processorRef.current) {
      processorRef.current.disconnect();
      processorRef.current.onaudioprocess = null;
      processorRef.current = null;
    }
    if (inputContextRef.current) {
      await inputContextRef.current.close();
      inputContextRef.current = null;
    }
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach((track) => track.stop());
      mediaStreamRef.current = null;
    }
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'audio_end' }));
    }
    setIsRecording(false);
  }, []);

  const startRecording = useCallback(async () => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
      console.warn('WebSocket is not ready for audio streaming');
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          sampleRate: INPUT_SAMPLE_RATE,
          noiseSuppression: true,
          echoCancellation: true,
        },
      });
      mediaStreamRef.current = stream;

      const audioContext = new AudioContext({ sampleRate: INPUT_SAMPLE_RATE });
      inputContextRef.current = audioContext;
      await audioContext.resume();

      const source = audioContext.createMediaStreamSource(stream);
      const processor = audioContext.createScriptProcessor(4096, 1, 1);
      processorRef.current = processor;

      processor.onaudioprocess = (event) => {
        const inputBuffer = event.inputBuffer.getChannelData(0);
        const pcmBuffer = floatTo16BitPCM(inputBuffer);
        const bytes = new Uint8Array(pcmBuffer);
        let binary = '';
        for (let i = 0; i < bytes.length; i += 1) {
          binary += String.fromCharCode(bytes[i]);
        }
        const chunk = btoa(binary);
        if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
          wsRef.current.send(
            JSON.stringify({
              type: 'audio_chunk',
              audio: chunk,
            })
          );
        }
      };

      source.connect(processor);
      processor.connect(audioContext.destination);
      setIsRecording(true);
      pendingStartRef.current = false;
    } catch (error) {
      console.error('Failed to start microphone streaming', error);
      pendingStartRef.current = false;
    }
  }, []);

  const disconnect = useCallback(() => {
    stopRecording();
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    setConnectionState('disconnected');
  }, [stopRecording]);

  const connectWebSocket = useCallback(() => {
    if (wsRef.current) {
      return;
    }
    const socket = new WebSocket(WS_URL);
    wsRef.current = socket;
    setConnectionState('connecting');

    socket.addEventListener('open', async () => {
      setConnectionState('connected');
      if (pendingStartRef.current) {
        await ensurePlaybackContext();
        await startRecording();
      }
    });

    socket.addEventListener('close', () => {
      setConnectionState('disconnected');
      wsRef.current = null;
      stopRecording();
      pendingStartRef.current = false;
    });

    socket.addEventListener('error', (error) => {
      console.error('WebSocket error', error);
      setConnectionState('error');
    });

    socket.addEventListener('message', async (event) => {
      const payload = JSON.parse(event.data);
      switch (payload.type) {
        case 'stt-interim':
          setInterimText(payload.text || '');
          break;
        case 'stt-final':
          setInterimText('');
          break;
        case 'user_text':
          if (payload.text) {
            setMessages((prev) => [...prev, { role: 'user', text: payload.text }]);
          }
          break;
        case 'assistant_text':
          if (payload.text) {
            setMessages((prev) => [...prev, { role: 'assistant', text: payload.text }]);
          }
          break;
        case 'audio_chunk': {
          const audioContext = await ensurePlaybackContext();
          const arrayBuffer = base64ToArrayBuffer(payload.audio);
          const encoding = payload.encoding || 'pcm_f32le';
          const container = payload.container || 'raw';
          const decodedBuffer =
            container === 'wav' ? extractPcmFromWav(arrayBuffer) : arrayBuffer;
          let float32;
          if (encoding === 'pcm_s16le') {
            const int16 = new Int16Array(decodedBuffer);
            float32 = new Float32Array(int16.length);
            for (let i = 0; i < int16.length; i += 1) {
              float32[i] = int16[i] / 0x7fff;
            }
          } else if (encoding === 'pcm_f32le') {
            float32 = new Float32Array(decodedBuffer);
          } else {
            console.warn('Unsupported audio encoding from server', encoding);
            break;
          }
          const sampleRate = payload.sampleRate || audioContext.sampleRate;
          const buffer = audioContext.createBuffer(1, float32.length, sampleRate);
          buffer.copyToChannel(float32, 0);
          const source = audioContext.createBufferSource();
          source.buffer = buffer;
          source.connect(audioContext.destination);
          const startTime = Math.max(audioContext.currentTime, playbackQueueRef.current.nextTime);
          source.start(startTime);
          playbackQueueRef.current.nextTime = startTime + buffer.duration;
          break;
        }
        case 'audio_end': {
          if (playbackContextRef.current) {
            playbackQueueRef.current.nextTime = playbackContextRef.current.currentTime;
          }
          break;
        }
        case 'server-error':
          setMessages((prev) => [...prev, { role: 'system', text: payload.message || 'Server error occurred.' }]);
          break;
        default:
          break;
      }
    });
  }, [ensurePlaybackContext, startRecording, stopRecording]);

  useEffect(() => {
    connectWebSocket();
    return () => {
      disconnect();
      if (playbackContextRef.current) {
        playbackContextRef.current.close();
        playbackContextRef.current = null;
      }
    };
  }, [connectWebSocket, disconnect]);

  const toggleRecording = async () => {
    if (isRecording) {
      await stopRecording();
    } else {
      if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
        pendingStartRef.current = true;
        connectWebSocket();
        return;
      }
      await ensurePlaybackContext();
      await startRecording();
    }
  };

  return (
    <div className="app">
      <header>
        <h1>Voice Agent</h1>
        <p>Speak with the AI customer service assistant in real time.</p>
      </header>
      <section className="controls">
        <button onClick={toggleRecording} disabled={connectionState !== 'connected'}>
          {isRecording ? 'Stop Talking' : 'Start Talking'}
        </button>
        <span className={`status status-${connectionState}`}>
          Connection: {connectionState}
        </span>
        {interimText && <p className="interim">{interimText}</p>}
      </section>
      <section className="transcript">
        {messages.map((message, index) => (
          <div key={`message-${index}`} className={`message message-${message.role}`}>
            <span className="label">{message.role === 'assistant' ? 'Agent' : message.role === 'user' ? 'You' : 'System'}</span>
            <p>{message.text}</p>
          </div>
        ))}
      </section>
    </div>
  );
}
