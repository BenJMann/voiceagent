import base64
from typing import AsyncIterator, Optional

import httpx

from ..config.settings import settings


class CartesiaClient:
    def __init__(self, api_key: Optional[str] = None) -> None:
        self.api_key = api_key or settings.cartesia_api_key
        self._base_url = "https://api.cartesia.ai"
        self._client = httpx.AsyncClient(
            base_url=self._base_url,
            headers={"Authorization": f"Bearer {self.api_key}"},
            timeout=30.0,
        )

    async def transcribe(self, audio_bytes: bytes) -> str:
        """Send recorded audio to Cartesia's STT endpoint."""
        response = await self._client.post(
            "/v1/stt",
            json={
                "model": settings.cartesia_stt_model,
                "audio": base64.b64encode(audio_bytes).decode(),
                "format": "webm",
            },
        )
        response.raise_for_status()
        data = response.json()
        return data.get("text", "")

    async def synthesize(self, text: str) -> AsyncIterator[bytes]:
        """Stream audio bytes from Cartesia's TTS endpoint."""
        async with self._client.stream(
            "POST",
            "/v1/tts/stream",
            json={
                "voice": settings.cartesia_tts_voice,
                "text": text,
                "format": "wav",
            },
        ) as response:
            response.raise_for_status()
            async for chunk in response.aiter_bytes():
                if chunk:
                    yield chunk

    async def aclose(self) -> None:
        await self._client.aclose()
