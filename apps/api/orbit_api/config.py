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

    # Observability. Logs default to JSON lines in production. Sentry stays off unless a DSN is set.
    log_format: Literal["json", "text"] | None = Field(None, validation_alias=AliasChoices("ORBIT_LOG_FORMAT"))
    sentry_dsn: str | None = Field(None, validation_alias=AliasChoices("ORBIT_SENTRY_DSN"))
    # How often an idle durable-job worker polls for due jobs (reports), seconds.
    job_poll_s: float = Field(2.0, validation_alias=AliasChoices("ORBIT_JOB_POLL_S"))
    # Live-minute metering: usage is committed (and the plan limit enforced) this often during a session.
    live_heartbeat_s: float = Field(15.0, validation_alias=AliasChoices("ORBIT_LIVE_HEARTBEAT_S"))
    # Extra/override LLM prices for internal cost estimates (see providers/llm/pricing.py).
    llm_pricing_json: str | None = Field(None, validation_alias=AliasChoices("ORBIT_LLM_PRICING_JSON"))

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
    # encrypted at rest with config_secret. Required in production (the server refuses to start without it);
    # only in development/test does the first registered user stand in for an unset admin.
    admin_email: str | None = Field(None, validation_alias=AliasChoices("ORBIT_ADMIN_EMAIL"))
    config_secret: SecretStr | None = Field(None, validation_alias=AliasChoices("ORBIT_CONFIG_SECRET"))
    # Who may sign up / sign in: comma-separated emails and/or "@domain" entries, or "*" for anyone.
    # The admin is always allowed. Unset: open in development/test, admin-only in production — the
    # server spends one shared provider key, so a public URL must not mean public usage.
    allowed_emails: str | None = Field(None, validation_alias=AliasChoices("ORBIT_ALLOWED_EMAILS"))

    # Email verification before paid-provider features (live, screenshots, mock, AI review). Unset: required in
    # production, off in development/test. The admin is always exempt (configured by env, not by signup).
    email_verification: Literal["required", "off"] | None = Field(
        None, validation_alias=AliasChoices("ORBIT_EMAIL_VERIFICATION")
    )
    # CSRF defence for cookie-authenticated browser requests (Origin check + per-session token header).
    # Unset: on everywhere except the test environment. Bearer-token (desktop) requests are never affected.
    csrf_protection: bool | None = Field(None, validation_alias=AliasChoices("ORBIT_CSRF_PROTECTION"))
    # Bot protection on sign-up / password reset. "none" or "turnstile" (Cloudflare). Provider-neutral: the
    # client asks GET /v1/auth/config which widget to render. Skipped only in the test environment.
    captcha_provider: Literal["none", "turnstile"] = Field(
        "none", validation_alias=AliasChoices("ORBIT_CAPTCHA_PROVIDER", "CAPTCHA_PROVIDER")
    )
    captcha_enabled: bool | None = Field(
        None, validation_alias=AliasChoices("ORBIT_CAPTCHA_ENABLED", "CAPTCHA_ENABLED")
    )
    turnstile_site_key: str | None = Field(
        None, validation_alias=AliasChoices("ORBIT_TURNSTILE_SITE_KEY", "TURNSTILE_SITE_KEY")
    )
    turnstile_secret_key: SecretStr | None = Field(
        None, validation_alias=AliasChoices("ORBIT_TURNSTILE_SECRET_KEY", "TURNSTILE_SECRET_KEY")
    )

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
            # Without an explicit admin, sign-up would be open and "first user = admin" would hand unlimited
            # use of the shared provider keys to whoever registers first.
            if not (self.admin_email and "@" in self.admin_email):
                raise ValueError("ORBIT_ADMIN_EMAIL must be set in production (the admin is never inferred)")
            # Anyone other than the admin can sign in → they must be able to prove their inbox, or turn
            # verification off explicitly (allowed only for a private, owner-vetted list of exact addresses).
            if self.public_signup and not self.verification_required:
                raise ValueError("ORBIT_EMAIL_VERIFICATION=off is not allowed with public sign-up "
                                 "(ORBIT_ALLOWED_EMAILS contains '*' or an @domain entry)")
            if self.verification_required and self.others_can_sign_in and not self.smtp_host:
                raise ValueError("Email verification is required for non-admin users but ORBIT_SMTP_HOST is not "
                                 "set, so nobody could verify. Configure SMTP, or for a private list of exact "
                                 "addresses set ORBIT_EMAIL_VERIFICATION=off.")
            if self.captcha_provider == "turnstile" and not (self.turnstile_site_key and self.turnstile_secret_key):
                raise ValueError("ORBIT_CAPTCHA_PROVIDER=turnstile needs TURNSTILE_SITE_KEY and TURNSTILE_SECRET_KEY")
        # SMTP is optional for an admin-only deploy: email features are then disabled. It's never faked to the
        # dev outbox in production (see email.py).
        return self

    @property
    def verification_required(self) -> bool:
        if self.email_verification is not None:
            return self.email_verification == "required"
        return self.env == "production"

    @property
    def csrf_enabled(self) -> bool:
        return self.csrf_protection if self.csrf_protection is not None else self.env != "test"

    @property
    def captcha_active(self) -> bool:
        """On when a provider is configured. CAPTCHA_ENABLED=false bypasses it only outside production."""
        if self.captcha_provider == "none" or not (self.turnstile_site_key and self.turnstile_secret_key):
            return False
        return not (self.captcha_enabled is False and self.env != "production")

    def _allow_entries(self) -> set[str]:
        return {e.strip().lower() for e in (self.allowed_emails or "").split(",") if e.strip()}

    @property
    def public_signup(self) -> bool:
        """Anyone (or anyone at a domain) may create an account — the case abuse protection is for."""
        if self.allowed_emails is None:
            return self.env != "production"
        return any(e == "*" or e.startswith("@") for e in self._allow_entries())

    @property
    def others_can_sign_in(self) -> bool:
        """Someone other than the admin may sign in (public sign-up or a non-empty allowlist)."""
        if self.allowed_emails is None:
            return self.env != "production"
        admin = (self.admin_email or "").strip().lower()
        return any(e != admin for e in self._allow_entries())

    def is_admin_email(self, email: str) -> bool:
        return bool(self.admin_email) and email.strip().lower() == (self.admin_email or "").strip().lower()

    @property
    def is_sqlite(self) -> bool:
        return self.database_url.startswith("sqlite")

    def email_allowed(self, email: str) -> bool:
        email = email.strip().lower()
        if self.admin_email and email == self.admin_email.strip().lower():
            return True
        if self.allowed_emails is None:
            return self.env != "production"
        entries = self._allow_entries()
        if "*" in entries:
            return True
        return email in entries or ("@" in email and "@" + email.rsplit("@", 1)[1] in entries)


@lru_cache
def get_settings() -> Settings:
    return Settings()
