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
    # DeepSeek-V4.1-Flash. "deepseek-chat"/"deepseek-reasoner" are now aliases of it; thinking is chosen per
    # request (LLMRequest.thinking), not by switching models.
    deepseek_model: str = Field("deepseek-flash", validation_alias=AliasChoices("DEEPSEEK_MODEL"))
    deepseek_reasoning_model: str = Field(
        "deepseek-flash", validation_alias=AliasChoices("DEEPSEEK_REASONING_MODEL")
    )

    desktop_updates_dir: str | None = Field(None, validation_alias=AliasChoices("ORBIT_DESKTOP_UPDATES_DIR"))
    # Or serve desktop updates straight from GitHub Releases (for hosts without a persistent disk). The token
    # only needs read access to this one repo's contents (fine-grained PAT: Contents → Read-only).
    updates_github_repo: str | None = Field(None, validation_alias=AliasChoices("ORBIT_UPDATES_GITHUB_REPO"))
    updates_github_token: SecretStr | None = Field(
        None, validation_alias=AliasChoices("ORBIT_UPDATES_GITHUB_TOKEN")
    )
    web_url: str = Field("http://localhost:5173", validation_alias=AliasChoices("ORBIT_WEB_URL"))
    smtp_host: str | None = Field(None, validation_alias=AliasChoices("ORBIT_SMTP_HOST"))
    smtp_port: int = Field(587, validation_alias=AliasChoices("ORBIT_SMTP_PORT"))
    smtp_username: str | None = Field(None, validation_alias=AliasChoices("ORBIT_SMTP_USERNAME"))
    smtp_password: SecretStr | None = Field(None, validation_alias=AliasChoices("ORBIT_SMTP_PASSWORD"))
    smtp_starttls: bool = Field(True, validation_alias=AliasChoices("ORBIT_SMTP_STARTTLS"))
    email_from: str = Field("Orbit <no-reply@localhost>", validation_alias=AliasChoices("ORBIT_EMAIL_FROM"))

    deepgram_api_key: SecretStr | None = Field(None, validation_alias=AliasChoices("DEEPGRAM_API_KEY"))
    deepgram_model: str = Field("nova-3", validation_alias=AliasChoices("DEEPGRAM_MODEL"))

    # Admin (advanced settings). The admin can edit provider keys/models in-app; the override is
    # encrypted at rest with config_secret. If admin_email is unset, the first registered user is admin.
    admin_email: str | None = Field(None, validation_alias=AliasChoices("ORBIT_ADMIN_EMAIL"))
    config_secret: SecretStr | None = Field(None, validation_alias=AliasChoices("ORBIT_CONFIG_SECRET"))
    # Who may sign up / sign in: comma-separated emails and/or "@domain" entries, or "*" for anyone.
    # The admin is always allowed. Unset: open in development/test, admin-only in production — the
    # server spends one shared provider key, so a public URL must not mean public usage.
    allowed_emails: str | None = Field(None, validation_alias=AliasChoices("ORBIT_ALLOWED_EMAILS"))

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
            if self.is_sqlite:
                raise ValueError("ORBIT_DATABASE_URL must be Postgres in production, not SQLite")
        # SMTP is optional: without it, email verification / password reset are disabled (fine for a
        # private single-user deploy). It's never faked to the dev outbox in production (see email.py).
        return self

    @property
    def is_sqlite(self) -> bool:
        return self.database_url.startswith("sqlite")

    def email_allowed(self, email: str) -> bool:
        email = email.strip().lower()
        if self.admin_email and email == self.admin_email.strip().lower():
            return True
        if self.allowed_emails is None:
            return self.env != "production" or not self.admin_email
        entries = {e.strip().lower() for e in self.allowed_emails.split(",") if e.strip()}
        if "*" in entries:
            return True
        return email in entries or ("@" in email and "@" + email.rsplit("@", 1)[1] in entries)


@lru_cache
def get_settings() -> Settings:
    return Settings()
