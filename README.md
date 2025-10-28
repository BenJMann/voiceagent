# Voice Agent

This project provides a full-stack voice chat experience that streams microphone audio from the browser to a backend service, transcribes the speech with Cartesia, generates customer-support replies with OpenAI, and streams synthesized speech back to the user in real time.

## Project Structure

- `frontend/` – React single-page app built with Vite that captures microphone audio, streams it to the backend, and plays synthesized audio responses. Environment variables are loaded with `dotenv` via `vite.config.js`.
- `backend/` – Node.js server that uses Express and WebSockets to stream audio, Cartesia for speech-to-text and text-to-speech, and the OpenAI SDK for conversation responses. Configuration is handled through `dotenv`.

## Prerequisites

- Node.js 18+
- Cartesia API key with STT and TTS access
- OpenAI API key

## Environment Variables

Each package has its own `.env` file. Copy the provided examples and update them with your credentials.

```bash
cp frontend/.env.example frontend/.env
cp backend/.env.example backend/.env
```

### Backend `.env`

```
PORT=4000
CARTESIA_API_KEY=your_cartesia_key
CARTESIA_STT_MODEL=ink-whisper
CARTESIA_STT_SAMPLE_RATE=16000
CARTESIA_LANGUAGE=en
CARTESIA_TTS_MODEL=sonic-en-v1
CARTESIA_TTS_SAMPLE_RATE=24000
CARTESIA_VOICE_ID=alloy
OPENAI_API_KEY=your_openai_key
OPENAI_MODEL=gpt-4o-mini
```

You can edit `backend/company_details.txt` to update the information used in the system prompt for the AI agent.

### Frontend `.env`

```
VITE_PORT=5173
VITE_BACKEND_WS_URL=ws://localhost:4000/ws/audio
```

`VITE_BACKEND_WS_URL` should match the WebSocket endpoint exposed by the backend.

## Installation

Install dependencies for both the frontend and backend:

```bash
cd frontend && npm install
cd ../backend && npm install
```

## Running Locally

Start the backend server:

```bash
cd backend
npm start
```

In a separate terminal, start the frontend dev server:

```bash
cd frontend
npm run dev
```

Open the browser at the URL shown by Vite (default `http://localhost:5173`). Press **Start Talking** to stream audio to the backend and hear streaming responses from the agent.

## Production Build

To produce a production build of the frontend:

```bash
cd frontend
npm run build
```

The output will be written to `frontend/dist/`.

## Notes

- The backend streams audio chunks directly to Cartesia STT using PCM 16-bit samples at 16 kHz and broadcasts live transcription updates back to the browser.
- When the backend receives a finalized transcript, it queries OpenAI with the system prompt derived from the company details file, synthesizes the response with Cartesia TTS, and streams audio chunks to the frontend.
- The frontend queues incoming audio chunks to ensure smooth playback without gaps.
