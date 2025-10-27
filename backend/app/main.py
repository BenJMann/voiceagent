import base64
from io import BytesIO

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware

from .config.settings import settings
from .services.cartesia import CartesiaClient
from .services.openai_client import OpenAIClient

app = FastAPI(title="Voice Agent Backend")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
async def health_check() -> dict[str, str]:
    return {"status": "ok"}


@app.websocket("/ws/audio")
async def audio_websocket(websocket: WebSocket) -> None:
    await websocket.accept()
    buffer = BytesIO()
    cartesia_client = CartesiaClient()
    openai_client = OpenAIClient()
    try:
        while True:
            message = await websocket.receive_json()
            message_type = message.get("type")

            if message_type == "audio":
                audio_chunk = base64.b64decode(message.get("data", ""))
                buffer.write(audio_chunk)
            elif message_type == "end":
                audio_bytes = buffer.getvalue()
                buffer = BytesIO()
                if not audio_bytes:
                    await websocket.send_json(
                        {
                            "type": "error",
                            "message": "No audio received before end signal.",
                        }
                    )
                    continue

                transcript = await cartesia_client.transcribe(audio_bytes)
                company_profile = settings.load_company_profile()
                system_prompt = (
                    "You are a helpful, professional customer service agent. "
                    "Use the provided company information to tailor your answers.\n\n"
                    f"Company details:\n{company_profile}"
                )
                response_text = await openai_client.generate_response(
                    system_prompt, transcript
                )

                await websocket.send_json({"type": "transcript", "text": transcript})
                await websocket.send_json({"type": "response_text", "text": response_text})

                async for audio_chunk in cartesia_client.synthesize(response_text):
                    await websocket.send_json(
                        {
                            "type": "audio",
                            "data": base64.b64encode(audio_chunk).decode(),
                        }
                    )

                await websocket.send_json({"type": "response_end"})
            elif message_type == "close":
                break
    except WebSocketDisconnect:
        return
    except Exception as exc:  # pragma: no cover - for observability
        await websocket.send_json({"type": "error", "message": str(exc)})
    finally:
        await cartesia_client.aclose()


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("app.main:app", host="0.0.0.0", port=8000, reload=True)
