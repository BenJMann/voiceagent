from typing import Optional

from openai import AsyncOpenAI

from ..config.settings import settings


class OpenAIClient:
    def __init__(self, api_key: Optional[str] = None, model: Optional[str] = None) -> None:
        self.api_key = api_key or settings.openai_api_key
        self.model = model or settings.openai_model
        self._client = AsyncOpenAI(api_key=self.api_key)

    async def generate_response(self, prompt: str, user_message: str) -> str:
        messages = [
            {"role": "system", "content": prompt},
            {"role": "user", "content": user_message},
        ]
        completion = await self._client.chat.completions.create(
            model=self.model,
            messages=messages,
        )
        return completion.choices[0].message.content or ""

