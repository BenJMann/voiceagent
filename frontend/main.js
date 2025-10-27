const startButton = document.getElementById('startButton');
const stopButton = document.getElementById('stopButton');
const statusText = document.getElementById('statusText');
const transcriptEl = document.getElementById('transcript');
const responseEl = document.getElementById('response');

let websocket = null;
let mediaRecorder = null;
let mediaStream = null;
let audioContext = null;
let playbackQueue = Promise.resolve();

const backendWsUrl = () => {
  const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
  const host = window.location.hostname || 'localhost';
  const defaultPort = '8000';
  return `${protocol}://${host}:${defaultPort}/ws/audio`;
};

function setStatus(message) {
  statusText.textContent = message;
}

function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i += 1) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function base64ToArrayBuffer(base64) {
  const binary = atob(base64);
  const len = binary.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

async function playAudioChunk(base64Audio) {
  if (!audioContext) {
    audioContext = new (window.AudioContext || window.webkitAudioContext)();
  }

  const buffer = base64ToArrayBuffer(base64Audio);
  playbackQueue = playbackQueue.then(async () => {
    if (audioContext.state === 'suspended') {
      await audioContext.resume();
    }
    const audioBuffer = await audioContext.decodeAudioData(buffer.slice(0));
    const source = audioContext.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(audioContext.destination);
    source.start(0);
    await new Promise((resolve) => {
      source.onended = resolve;
    });
  });
  await playbackQueue;
}

function resetUI() {
  transcriptEl.textContent = '';
  responseEl.textContent = '';
}

function closeWebSocket() {
  if (websocket && websocket.readyState === WebSocket.OPEN) {
    websocket.send(JSON.stringify({ type: 'close' }));
    websocket.close();
  }
  websocket = null;
}

const handleMessage = async (event) => {
  const message = JSON.parse(event.data);
  if (message.type === 'transcript') {
    transcriptEl.textContent = message.text;
  } else if (message.type === 'response_text') {
    responseEl.textContent = message.text;
  } else if (message.type === 'audio') {
    await playAudioChunk(message.data);
  } else if (message.type === 'response_end') {
    setStatus('Agent response complete. You can speak again.');
    startButton.disabled = false;
    stopButton.disabled = true;
  } else if (message.type === 'error') {
    setStatus(`Error: ${message.message}`);
  }
};

const handleClose = () => {
  setStatus('Connection closed.');
  stopButton.disabled = true;
  startButton.disabled = false;
};

const handleError = () => {
  setStatus('WebSocket connection error. Make sure the backend is running.');
  stopButton.disabled = true;
  startButton.disabled = false;
};

async function waitForOpen(ws) {
  if (ws.readyState === WebSocket.OPEN) {
    return;
  }

  await new Promise((resolve, reject) => {
    const handleOpen = () => {
      cleanup();
      resolve();
    };

    const handleErrorEvent = (event) => {
      cleanup();
      reject(event);
    };

    const cleanup = () => {
      ws.removeEventListener('open', handleOpen);
      ws.removeEventListener('error', handleErrorEvent);
    };

    ws.addEventListener('open', handleOpen, { once: true });
    ws.addEventListener('error', handleErrorEvent, { once: true });
  });
}

async function connectWebSocket() {
  if (websocket) {
    if (websocket.readyState === WebSocket.OPEN) {
      return;
    }
    if (websocket.readyState === WebSocket.CONNECTING) {
      await waitForOpen(websocket);
      return;
    }
  }

  websocket = new WebSocket(backendWsUrl());
  websocket.addEventListener('message', handleMessage);
  websocket.addEventListener('close', handleClose);
  websocket.addEventListener('error', handleError);

  await waitForOpen(websocket);
  setStatus('Connected. Recording in progress...');
}

async function startConversation() {
  if (typeof window.MediaRecorder === 'undefined') {
    setStatus('MediaRecorder API is not supported in this browser.');
    startButton.disabled = false;
    stopButton.disabled = true;
    return;
  }

  resetUI();
  startButton.disabled = true;
  stopButton.disabled = false;
  setStatus('Preparing microphone...');

  try {
    await connectWebSocket();
  } catch (error) {
    setStatus('Unable to connect to backend WebSocket.');
    startButton.disabled = false;
    stopButton.disabled = true;
    return;
  }

  try {
    mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const options = { mimeType: 'audio/webm;codecs=opus' };
    mediaRecorder = new MediaRecorder(mediaStream, options);
  } catch (error) {
    setStatus(`Microphone error: ${error.message}`);
    startButton.disabled = false;
    stopButton.disabled = true;
    return;
  }

  mediaRecorder.addEventListener('dataavailable', async (event) => {
    if (event.data.size > 0 && websocket?.readyState === WebSocket.OPEN) {
      const arrayBuffer = await event.data.arrayBuffer();
      const payload = arrayBufferToBase64(arrayBuffer);
      websocket.send(
        JSON.stringify({
          type: 'audio',
          data: payload,
        }),
      );
    }
  });

  mediaRecorder.addEventListener('stop', () => {
    if (mediaStream) {
      mediaStream.getTracks().forEach((track) => track.stop());
      mediaStream = null;
    }
  });

  mediaRecorder.start(250);
  setStatus('Recording... Speak now.');
}

function stopConversation() {
  if (mediaRecorder && mediaRecorder.state !== 'inactive') {
    mediaRecorder.stop();
  }
  if (websocket && websocket.readyState === WebSocket.OPEN) {
    websocket.send(JSON.stringify({ type: 'end' }));
    setStatus('Processing response...');
  } else {
    setStatus('Connection is not open.');
  }
  stopButton.disabled = true;
}

startButton.addEventListener('click', startConversation);
stopButton.addEventListener('click', stopConversation);
window.addEventListener('beforeunload', () => {
  closeWebSocket();
  if (mediaStream) {
    mediaStream.getTracks().forEach((track) => track.stop());
  }
});
