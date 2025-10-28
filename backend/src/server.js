require('dotenv').config();

const path = require('path');
const fs = require('fs');
const express = require('express');
const http = require('http');
const cors = require('cors');
const WebSocket = require('ws');
const { CartesiaClient } = require('@cartesia/cartesia-js');
const OpenAI = require('openai');

const PORT = Number(process.env.PORT) || 4000;
const CARTESIA_STT_SAMPLE_RATE = Number(process.env.CARTESIA_STT_SAMPLE_RATE) || 16000;
const CARTESIA_TTS_SAMPLE_RATE = Number(process.env.CARTESIA_TTS_SAMPLE_RATE) || 24000;
const CARTESIA_LANGUAGE = process.env.CARTESIA_LANGUAGE || 'en';
const CARTESIA_STT_MODEL = process.env.CARTESIA_STT_MODEL || 'ink-whisper';
const CARTESIA_TTS_MODEL = process.env.CARTESIA_TTS_MODEL || 'sonic-en-v1';
const CARTESIA_VOICE_ID = process.env.CARTESIA_VOICE_ID || 'alloy';
const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';

if (!process.env.CARTESIA_API_KEY) {
  console.warn('Missing CARTESIA_API_KEY in environment');
}
if (!process.env.OPENAI_API_KEY) {
  console.warn('Missing OPENAI_API_KEY in environment');
}

const companyDetailsPath = path.resolve(__dirname, '..', 'company_details.txt');
let companyDetails = '';
try {
  companyDetails = fs.readFileSync(companyDetailsPath, 'utf-8');
} catch (error) {
  console.warn(`Could not read company details at ${companyDetailsPath}:`, error.message);
}

const systemPrompt = `You are a helpful customer service agent. Use the following company details to answer questions accurately:\n\n${companyDetails}`;

const app = express();
app.use(cors());
app.use(express.json());

app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

const server = http.createServer(app);
const wss = new WebSocket.Server({ server, path: '/ws/audio' });

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

wss.on('connection', async (socket) => {
  const cartesia = new CartesiaClient({ apiKey: process.env.CARTESIA_API_KEY });

  const ttsWs = cartesia.tts.websocket({
    sampleRate: CARTESIA_TTS_SAMPLE_RATE,
    container: 'raw',
    encoding: 'pcm_s16le',
  });

  let sttWs;
  let sttReady = Promise.resolve();
  let closed = false;
  const conversation = [{ role: 'system', content: systemPrompt }];
  let processingQueue = Promise.resolve();

  const handleSttMessage = (message) => {
    if (closed) {
      return;
    }
    if (message.type === 'transcript') {
      socket.send(
        JSON.stringify({
          type: message.isFinal ? 'stt-final' : 'stt-interim',
          text: message.text,
        })
      );
      if (message.isFinal && message.text.trim()) {
        processingQueue = processingQueue
          .then(() => handleFinalTranscript(message.text.trim()))
          .catch((error) => {
            console.error('Failed to handle transcript', error);
          });
      }
    } else if (message.type === 'error') {
      socket.send(
        JSON.stringify({
          type: 'stt-error',
          message: message.message || 'Unknown STT error',
        })
      );
    }
  };

  async function initializeSttStream() {
    if (closed) {
      return;
    }

    const stream = cartesia.stt.websocket({
      model: CARTESIA_STT_MODEL,
      language: CARTESIA_LANGUAGE,
      encoding: 'pcm_s16le',
      sampleRate: CARTESIA_STT_SAMPLE_RATE,
    });

    sttWs = stream;

    try {
      await stream.connect();
      await stream.onMessage(handleSttMessage);
    } catch (error) {
      sttWs = undefined;
      throw error;
    }
  }

  const cleanup = () => {
    if (closed) return;
    closed = true;
    try {
      sttWs && sttWs.disconnect();
    } catch (error) {
      console.error('Failed to disconnect STT websocket', error);
    }
    sttWs = undefined;
    sttReady = Promise.resolve();
    try {
      ttsWs.disconnect();
    } catch (error) {
      console.error('Failed to disconnect TTS websocket', error);
    }
  };

  socket.on('close', cleanup);
  socket.on('error', (err) => {
    console.error('WebSocket error from client', err);
    cleanup();
  });

  try {
    sttReady = initializeSttStream();
    await Promise.all([sttReady, ttsWs.connect()]);
  } catch (error) {
    console.error('Failed to connect to Cartesia streaming services', error);
    sttReady.catch(() => {});
    socket.send(
      JSON.stringify({
        type: 'server-error',
        message: 'Failed to connect to voice services',
      })
    );
    cleanup();
    return;
  }

  socket.on('message', async (data) => {
    if (closed) {
      return;
    }
    let parsed;
    try {
      parsed = JSON.parse(data);
    } catch (error) {
      console.warn('Received non-JSON message from client');
      return;
    }

    if (parsed.type === 'audio_chunk' && parsed.audio) {
      const buffer = Buffer.from(parsed.audio, 'base64');
      try {
        await sttReady;
        if (!sttWs) {
          return;
        }
        await sttWs.send(buffer);
      } catch (error) {
        console.error('Failed to forward audio chunk to Cartesia STT', error);
      }
    } else if (parsed.type === 'audio_end') {
      try {
        await sttReady;
      } catch (error) {
        console.error('STT stream was not ready to finalize', error);
      }

      if (sttWs) {
        try {
          await sttWs.finalize();
        } catch (error) {
          console.error('Failed to finalize STT stream', error);
        }
      }

      if (!closed) {
        sttReady = initializeSttStream();
        sttReady.catch((error) => {
          console.error('Failed to restart STT stream', error);
          socket.send(
            JSON.stringify({
              type: 'server-error',
              message: 'Failed to restart speech recognition',
            })
          );
        });
      }
    }
  });

  async function handleFinalTranscript(text) {
    socket.send(
      JSON.stringify({
        type: 'user_text',
        text,
      })
    );

    conversation.push({ role: 'user', content: text });
    let assistantText = '';

    try {
      const response = await openai.chat.completions.create({
        model: OPENAI_MODEL,
        messages: conversation,
      });
      assistantText = response.choices?.[0]?.message?.content?.trim() || '';
    } catch (error) {
      console.error('OpenAI request failed', error);
      socket.send(
        JSON.stringify({
          type: 'server-error',
          message: 'Failed to generate response',
        })
      );
      return;
    }

    if (!assistantText) {
      return;
    }

    conversation.push({ role: 'assistant', content: assistantText });

    socket.send(
      JSON.stringify({
        type: 'assistant_text',
        text: assistantText,
      })
    );

    try {
      const stream = await ttsWs.send({
        modelId: CARTESIA_TTS_MODEL,
        transcript: assistantText,
        voice: { mode: 'id', id: CARTESIA_VOICE_ID },
      });

      let sentAudioEnd = false;
      const emitAudioEnd = () => {
        if (sentAudioEnd) {
          return;
        }
        sentAudioEnd = true;
        socket.send(
          JSON.stringify({
            type: 'audio_end',
          })
        );
      };

      let completionResolved = false;
      let resolveCompletion;
      const completion = new Promise((resolve) => {
        resolveCompletion = () => {
          if (completionResolved) {
            return;
          }
          completionResolved = true;
          resolve();
        };
      });

      const forwardAudioChunk = (audioBuffer) => {
        if (!audioBuffer || !audioBuffer.length) {
          return;
        }
        socket.send(
          JSON.stringify({
            type: 'audio_chunk',
            audio: audioBuffer.toString('base64'),
            sampleRate: CARTESIA_TTS_SAMPLE_RATE,
            encoding: 'pcm_s16le',
          })
        );
      };

      const handleStreamErrorEvent = (error) => {
        if (error) {
          console.error('TTS stream error event', error);
        }
        resolveCompletion();
      };

      const handleStreamAbortEvent = () => {
        resolveCompletion();
      };

      const handlePayload = (payload) => {
        if (!payload) {
          return;
        }
        if (payload.type === 'chunk' && payload.data) {
          socket.send(
            JSON.stringify({
              type: 'audio_chunk',
              audio: payload.data,
              sampleRate: CARTESIA_TTS_SAMPLE_RATE,
            encoding: 'pcm_s16le',
          })
        );
        } else if (payload.done) {
          resolveCompletion();
        } else if (payload.type === 'error') {
          console.error('TTS stream error', payload.message);
          resolveCompletion();
        }
      };

      const handleChunk = (incoming) => {
        try {
          let message = incoming;
          if (message instanceof ArrayBuffer) {
            message = Buffer.from(message);
          }

          if (Buffer.isBuffer(message)) {
            if (!message.length) {
              return;
            }
            const text = message.toString('utf8');
            const trimmed = text.trimStart();
            if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
              handlePayload(JSON.parse(text));
            } else {
              forwardAudioChunk(message);
            }
          } else if (typeof message === 'string') {
            const trimmed = message.trim();
            if (!trimmed) {
              return;
            }
            handlePayload(JSON.parse(trimmed));
          }
        } catch (error) {
          console.error('Failed to process TTS chunk', error);
        }
      };

      stream.on('message', handleChunk);
      stream.on('error', handleStreamErrorEvent);
      stream.on('abort', handleStreamAbortEvent);

      const waitForSourceClose = stream.source && typeof stream.source.once === 'function'
        ? stream.source.once('close')
        : stream.once('close');

      waitForSourceClose.then(resolveCompletion).catch((error) => {
        if (error) {
          console.error('TTS stream source close error', error);
        }
        resolveCompletion();
      });

      try {
        await completion;
      } finally {
        emitAudioEnd();
        stream.off('message', handleChunk);
        stream.off('error', handleStreamErrorEvent);
        stream.off('abort', handleStreamAbortEvent);
      }
    } catch (error) {
      console.error('Cartesia TTS streaming failed', error);
      socket.send(
        JSON.stringify({
          type: 'server-error',
          message: 'Failed to synthesize speech',
        })
      );
    }
  }
});

server.listen(PORT, () => {
  console.log(`Backend listening on port ${PORT}`);
});
