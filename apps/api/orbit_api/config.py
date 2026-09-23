from functools import lru_cache
from typing import Literal

from pydantic import AliasChoices, Field, SecretStr, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

_DEV_SECRET = "dev-only-insecure-secret-change-me"  # noqa: S105 - rejected outside development


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    env: Literal["development", "test", "production"] = Field(
        "development", validation_alias=AliasChoices("ORBIT_ENV")
    )
    database_url: str = Field(
        "sqlite+aiosqlite:///./orbit.db", validation_alias=AliasChoices("ORBIT_DATABASE_URL")
    )
    redis_url: str | None = Field(None, validation_alias=AliasChoices("ORBIT_REDIS_URL"))
    jwt_secret: SecretStr = Field(SecretStr(_DEV_SECRET), validation_alias=AliasChoices("ORBIT_JWT_SECRET"))
    jwt_ttl_minutes: int = 60 * 24 * 7
    cors_origins: list[str] = Field(
        ["http://localhost:5173", "http://localhost:1420", "http://tauri.localhost", "tauri://localhost"],
        validation_alias=AliasChoices("ORBIT_CORS_ORIGINS"),
    )
    upload_dir: str = Field("./uploads", validation_alias=AliasChoices("ORBIT_UPLOAD_DIR"))
    max_upload_bytes: int = 10 * 1024 * 1024

    llm_provider: Literal["auto", "deepseek", "mock"] = Field(
        "auto", validation_alias=AliasChoices("ORBIT_LLM_PROVIDER")
    )
    stt_provider: Literal["auto", "deepgram", "mock"] = Field(
        "auto", validation_alias=AliasChoices("ORBIT_STT_PROVIDER")
    )

    deepseek_api_key: SecretStr | None = Field(None, validation_alias=AliasChoices("DEEPSEEK_API_KEY"))
    deepseek_base_url: str = Field(
        "https://api.deepseek.com", validation_alias=AliasChoices("DEEPSEEK_BASE_URL")
    )
    deepseek_model: str = Field("deepseek-chat", validation_alias=AliasChoices("DEEPSEEK_MODEL"))
    deepseek_reasoning_model: str = Field(
        "deepseek-reasoner", validation_alias=AliasChoices("DEEPSEEK_REASONING_MODEL")
    )

    desktop_updates_dir: str | None = Field(None, validation_alias=AliasChoices("ORBIT_DESKTOP_UPDATES_DIR"))
    web_url: str = Field("http://localhost:5173", validation_alias=AliasChoices("ORBIT_WEB_URL"))
    smtp_host: str | None = Field(None, validation_alias=AliasChoices("ORBIT_SMTP_HOST"))
    smtp_port: int = Field(587, validation_alias=AliasChoices("ORBIT_SMTP_PORT"))
    smtp_username: str | None = Field(None, validation_alias=AliasChoices("ORBIT_SMTP_USERNAME"))
    smtp_password: SecretStr | None = Field(None, validation_alias=AliasChoices("ORBIT_SMTP_PASSWORD"))
    smtp_starttls: bool = Field(True, validation_alias=AliasChoices("ORBIT_SMTP_STARTTLS"))
    email_from: str = Field("Orbit <no-reply@localhost>", validation_alias=AliasChoices("ORBIT_EMAIL_FROM"))

    deepgram_api_key: SecretStr | None = Field(None, validation_alias=AliasChoices("DEEPGRAM_API_KEY"))
    deepgram_model: str = Field("nova-3", validation_alias=AliasChoices("DEEPGRAM_MODEL"))

    @model_validator(mode="after")
    def _reject_insecure_production(self) -> "Settings":
        if self.env == "production":
            if self.jwt_secret.get_secret_value() == _DEV_SECRET or len(self.jwt_secret.get_secret_value()) < 32:
                raise ValueError("ORBIT_JWT_SECRET must be set to a random value of 32+ chars in production")
            # Reject mock explicitly AND the "auto" fallback-to-mock case: a missing key must fail loudly,
            # not silently serve canned answers / fake transcription in production.
            if self.llm_provider == "mock" or (self.llm_provider == "auto" and not self.deepseek_api_key):
                raise ValueError("DEEPSEEK_API_KEY is required in production (no mock LLM fallback)")
            if self.stt_provider == "mock" or (self.stt_provider == "auto" and not self.deepgram_api_key):
                raise ValueError("DEEPGRAM_API_KEY is required in production (no mock STT fallback)")
            if not self.smtp_host:
                raise ValueError("ORBIT_SMTP_HOST is required in production (verification and reset emails)")
            if self.is_sqlite:
                raise ValueError("ORBIT_DATABASE_URL must be Postgres in production, not SQLite")
        return self

    @property
    def is_sqlite(self) -> bool:
        return self.database_url.startswith("sqlite")


@lru_cache
def get_settings() -> Settings:
    return Settings()
