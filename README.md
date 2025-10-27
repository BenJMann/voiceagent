# Voice Agent

A minimal end-to-end prototype that lets users speak with a customer-service voice agent. The app consists of a FastAPI backend that proxies audio to Cartesia for speech recognition and speech synthesis, and a lightweight browser frontend that captures microphone audio and streams it to the backend while playing synthesized responses.

## Project structure

```
├── backend
│   ├── app
│   │   ├── config
│   │   │   └── settings.py
│   │   ├── services
│   │   │   ├── cartesia.py
│   │   │   └── openai_client.py
│   │   └── main.py
│   ├── company_profile.txt
│   └── requirements.txt
├── frontend
│   ├── index.html
│   ├── main.js
│   └── style.css
└── .env.example
```

## Configuration

1. Copy `.env.example` to `.env` and populate it with your Cartesia and OpenAI credentials. Adjust the default model, voice, or company profile path as needed.
2. Update `backend/company_profile.txt` with the latest company-specific details you want the agent to reference during conversations.

## Backend setup

```bash
cd backend
python -m venv .venv
source .venv/bin/activate  # On Windows use `.venv\\Scripts\\activate`
pip install -r requirements.txt
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

The backend exposes a WebSocket at `ws://localhost:8000/ws/audio` that accepts base64 encoded microphone audio chunks (WebM/Opus) and streams Cartesia-generated WAV audio back to the client.

## Frontend setup

The frontend is a static page. You can open `frontend/index.html` directly in a browser or serve it with a simple HTTP server for local development:

```bash
cd frontend
python -m http.server 5173
```

Then visit [http://localhost:5173](http://localhost:5173) in your browser. The page connects to `ws://localhost:8000/ws/audio` by default.

## Usage

1. Start the backend server.
2. Open the frontend in a browser that supports `MediaRecorder` (recent versions of Chrome, Edge, or Firefox).
3. Click **Start Conversation** and speak into your microphone.
4. Click **Stop Conversation** to send the recorded audio to the backend. The transcribed text, LLM response, and synthesized voice will stream back to the browser.

## Notes

- The backend keeps prompts synchronized with `backend/company_profile.txt`. Editing this file does not require a restart.
- Ensure your Cartesia account has access to the specified STT and TTS models.
- For production deployments you should secure the WebSocket with authentication and HTTPS/WSS.
