from functools import lru_cache
from typing import Literal

from pydantic import AliasChoices, Field, SecretStr, field_validator, model_validator
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
    # How many API processes serve this deployment. Live-session state (WS tickets, socket ownership, the engine
    # a screenshot is routed to, rate limits) is in process memory, so only 1 is supported until it moves to
    # Redis. Declared so a scaled-out deploy fails loudly at boot instead of breaking sessions at random.
    api_replicas: int = Field(1, ge=1, validation_alias=AliasChoices("ORBIT_API_REPLICAS", "API_REPLICAS"))
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

    # Backup LLM: any OpenAI-compatible Chat Completions API (OpenAI, Gemini's OpenAI endpoint, OpenRouter, Groq…).
    # Used only when DeepSeek fails before its first token (see providers/llm/fallback.py). Unset = no backup.
    fallback_llm_base_url: str | None = Field(None, validation_alias=AliasChoices("ORBIT_FALLBACK_LLM_BASE_URL"))
    fallback_llm_api_key: SecretStr | None = Field(None, validation_alias=AliasChoices("ORBIT_FALLBACK_LLM_API_KEY"))
    fallback_llm_model: str | None = Field(None, validation_alias=AliasChoices("ORBIT_FALLBACK_LLM_MODEL"))
    fallback_llm_name: str = Field("backup", validation_alias=AliasChoices("ORBIT_FALLBACK_LLM_NAME"))
    fallback_llm_vision: bool = Field(False, validation_alias=AliasChoices("ORBIT_FALLBACK_LLM_VISION"))
    # JSON object merged into every backup request (provider-specific options such as reasoning effort).
    fallback_llm_extra_json: str | None = Field(None, validation_alias=AliasChoices("ORBIT_FALLBACK_LLM_EXTRA_JSON"))
    # No first token from the primary within this many seconds (plus headroom when "thinking") counts as a failure.
    llm_first_token_timeout_s: float = Field(
        10.0, gt=0, validation_alias=AliasChoices("ORBIT_LLM_FIRST_TOKEN_TIMEOUT_S")
    )

    # Dense half of hybrid retrieval: "hash" (default: no deps, no memory) or "bge-small" (local ONNX model via
    # fastembed, ~+200 MB RAM, better recall; see retrieval/embeddings.py and docs/RETRIEVAL.md).
    embedder: Literal["hash", "bge-small"] = Field("hash", validation_alias=AliasChoices("ORBIT_EMBEDDER"))
    embedding_cache_dir: str | None = Field(None, validation_alias=AliasChoices("ORBIT_EMBEDDING_CACHE_DIR"))

    # Observability. Logs default to JSON lines in production. Sentry stays off unless a DSN is set.
    log_format: Literal["json", "text"] | None = Field(None, validation_alias=AliasChoices("ORBIT_LOG_FORMAT"))
    sentry_dsn: str | None = Field(None, validation_alias=AliasChoices("ORBIT_SENTRY_DSN"))
    # How often an idle durable-job worker polls for due jobs (reports), seconds.
    job_poll_s: float = Field(2.0, validation_alias=AliasChoices("ORBIT_JOB_POLL_S"))
    # A session left open (disconnected, no new transcript) this long is ended and reported (sessions/cleanup.py).
    abandoned_session_min: float = Field(60.0, validation_alias=AliasChoices("ORBIT_ABANDONED_SESSION_MIN"))
    # How often that sweep runs, seconds.
    session_sweep_s: float = Field(300.0, validation_alias=AliasChoices("ORBIT_SESSION_SWEEP_S"))
    # Live-minute metering: usage is committed (and the plan limit enforced) this often during a session.
    live_heartbeat_s: float = Field(15.0, validation_alias=AliasChoices("ORBIT_LIVE_HEARTBEAT_S"))
    # Extra/override LLM prices for internal cost estimates (see providers/llm/pricing.py).
    llm_pricing_json: str | None = Field(None, validation_alias=AliasChoices("ORBIT_LLM_PRICING_JSON"))
    # Speech-to-text list price per audio minute for cost estimates (admin cost dashboard). Default: Deepgram Nova-3
    # streaming pay-as-you-go at the time of writing; set your contracted rate. Unset (empty) = STT cost unknown.
    stt_price_per_minute: float | None = Field(0.0077, validation_alias=AliasChoices("ORBIT_STT_PRICE_PER_MINUTE"))
    # Plan limits/features/prices overrides (see entitlements.py). Validated at startup.
    plans_json: str | None = Field(None, validation_alias=AliasChoices("ORBIT_PLANS_JSON"))

    desktop_updates_dir: str | None = Field(None, validation_alias=AliasChoices("ORBIT_DESKTOP_UPDATES_DIR"))
    # Or serve desktop updates straight from GitHub Releases (for hosts without a persistent disk). The token
    # only needs read access to this one repo's contents (fine-grained PAT: Contents → Read-only).
    updates_github_repo: str | None = Field(None, validation_alias=AliasChoices("ORBIT_UPDATES_GITHUB_REPO"))
    updates_github_token: SecretStr | None = Field(
        None, validation_alias=AliasChoices("ORBIT_UPDATES_GITHUB_TOKEN")
    )
    web_url: str = Field("http://localhost:5173", validation_alias=AliasChoices("ORBIT_WEB_URL"))
    # The API's own public base URL (e.g. https://orbit-api.onrender.com). When set, links the API hands out (desktop
    # installer downloads) are built from it instead of the request's Host header.
    api_public_url: str | None = Field(None, validation_alias=AliasChoices("ORBIT_API_PUBLIC_URL"))
    # SameSite for the session cookie. The web app reaches the API through its own /api proxy (same site), so Lax
    # works and blocks the cookie on cross-site requests. "none" only for a web app that calls the API cross-site.
    cookie_samesite: Literal["lax", "strict", "none"] = Field(
        "lax", validation_alias=AliasChoices("ORBIT_COOKIE_SAMESITE")
    )
    # Shared with the web app's edge proxy (wrangler secret PROXY_SECRET). Requests carrying it may state the real
    # client IP (X-Orbit-Client-IP); every other request is keyed by the address the host's own edge recorded
    # (right-most X-Forwarded-For), so a caller can't pick its own IP to dodge per-IP limits. Unset = trust the
    # left-most X-Forwarded-For (uvicorn's --proxy-headers).
    proxy_secret: SecretStr | None = Field(None, validation_alias=AliasChoices("ORBIT_PROXY_SECRET"))
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

    @field_validator("stt_price_per_minute", mode="before")
    @classmethod
    def _blank_price_is_unknown(cls, v: object) -> object:
        return None if isinstance(v, str) and not v.strip() else v

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
            if self.fallback_llm_base_url:
                if not (self.fallback_llm_api_key and self.fallback_llm_model):
                    raise ValueError("ORBIT_FALLBACK_LLM_BASE_URL needs ORBIT_FALLBACK_LLM_API_KEY and _MODEL")
                if not self.fallback_llm_base_url.startswith("https://"):
                    raise ValueError("ORBIT_FALLBACK_LLM_BASE_URL must be https:// in production")
            if self.fallback_llm_extra_json:
                import json

                if not isinstance(json.loads(self.fallback_llm_extra_json), dict):
                    raise ValueError("ORBIT_FALLBACK_LLM_EXTRA_JSON must be a JSON object")
            if "*" in self.cors_origins:
                raise ValueError("ORBIT_CORS_ORIGINS must list exact origins in production (no '*')")
            if self.proxy_secret is not None and len(self.proxy_secret.get_secret_value()) < 32:
                raise ValueError("ORBIT_PROXY_SECRET must be a random value of 32+ chars")
            if self.api_replicas != 1:
                raise ValueError("ORBIT_API_REPLICAS must be 1: live-session state is process-local (tickets, "
                                 "socket ownership, screenshot routing, rate limits). See docs/DECISIONS.md D12.")
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
