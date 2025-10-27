from pathlib import Path
from typing import Optional

from dotenv import load_dotenv
import os

ROOT_DIR = Path(__file__).resolve().parents[3]
BACKEND_DIR = ROOT_DIR / "backend"
load_dotenv(ROOT_DIR / ".env")


class Settings:
    cartesia_api_key: str
    cartesia_stt_model: str
    cartesia_tts_voice: str
    openai_api_key: str
    openai_model: str
    company_profile_path: Path

    def __init__(
        self,
        cartesia_api_key: Optional[str] = None,
        cartesia_stt_model: Optional[str] = None,
        cartesia_tts_voice: Optional[str] = None,
        openai_api_key: Optional[str] = None,
        openai_model: Optional[str] = None,
        company_profile_path: Optional[Path] = None,
    ) -> None:
        self.cartesia_api_key = cartesia_api_key or os.getenv("CARTESIA_API_KEY", "")
        self.cartesia_stt_model = cartesia_stt_model or os.getenv(
            "CARTESIA_STT_MODEL", "cartesia-stt-default"
        )
        self.cartesia_tts_voice = cartesia_tts_voice or os.getenv(
            "CARTESIA_TTS_VOICE", "alloy"
        )
        self.openai_api_key = openai_api_key or os.getenv("OPENAI_API_KEY", "")
        self.openai_model = openai_model or os.getenv(
            "OPENAI_MODEL", "gpt-4o-mini"
        )
        default_profile = BACKEND_DIR / "company_profile.txt"
        self.company_profile_path = company_profile_path or Path(
            os.getenv("COMPANY_PROFILE_PATH", default_profile)
        )

    def load_company_profile(self) -> str:
        if not self.company_profile_path.exists():
            return ""
        return self.company_profile_path.read_text(encoding="utf-8")


settings = Settings()
