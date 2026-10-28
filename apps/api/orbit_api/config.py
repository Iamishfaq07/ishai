import re
from functools import lru_cache
from typing import Annotated, Literal
from urllib.parse import urlsplit

from pydantic import AliasChoices, Field, SecretStr, field_validator, model_validator
from pydantic_settings import BaseSettings, NoDecode, SettingsConfigDict

_DEV_SECRET = "dev-only-insecure-secret-change-me"  # noqa: S105 - rejected outside development
_DEV_PROXY_SECRET = "orbit-local-proxy-secret-for-development-only"  # noqa: S105 - never valid in production


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    env: Literal["development", "test", "production"] = Field(
        "development", validation_alias=AliasChoices("ORBIT_ENV", "ENV")
    )
    database_url: str = Field(
        "sqlite+aiosqlite:///./orbit.db", validation_alias=AliasChoices("ORBIT_DATABASE_URL")
    )
    # Postgres TLS (db.connect_args): verify = encrypted and the server's certificate checked (production default);
    # require = encrypted, certificate not checked; off = whatever the URL says. asyncpg's own default encrypts
    # without checking who answers, so someone on the network path could pose as the database.
    database_ssl: Literal["verify", "require", "off"] | None = Field(
        None, validation_alias=AliasChoices("ORBIT_DATABASE_SSL"))
    redis_url: str | None = Field(None, validation_alias=AliasChoices("ORBIT_REDIS_URL"))
    hosted_apply: bool = Field(False, validation_alias="ORBIT_HOSTED_APPLY")
    apply_worker_secret: SecretStr | None = Field(None, min_length=32, validation_alias="ORBIT_APPLY_WORKER_SECRET")
    # How many API processes serve this deployment. Live-session state (WS tickets, socket ownership, the engine
    # a screenshot is routed to, rate limits) is in process memory, so only 1 is supported until it moves to
    # Redis. Declared so a scaled-out deploy fails loudly at boot instead of breaking sessions at random.
    api_replicas: int = Field(1, ge=1, validation_alias=AliasChoices("ORBIT_API_REPLICAS", "API_REPLICAS"))
    jwt_secret: SecretStr = Field(SecretStr(_DEV_SECRET), validation_alias=AliasChoices("ORBIT_JWT_SECRET"))
    # Hard cap on any sign-in: after this, sign in again (web and desktop).
    jwt_ttl_minutes: int = 60 * 24 * 7
    # Web sessions also end after this long unused; each request made in the last stretch renews the cookie (up to
    # the hard cap). A stolen, unused web cookie is dead in days, not a week. Desktop tokens (OS keychain) use the cap.
    session_idle_hours: float = Field(72.0, gt=0, validation_alias=AliasChoices("ORBIT_SESSION_IDLE_HOURS"))
    # A JSON array or a comma-separated list ("https://a.example, http://tauri.localhost").
    cors_origins: Annotated[list[str], NoDecode] = Field(
        ["http://localhost:5173", "http://localhost:1420", "http://tauri.localhost", "tauri://localhost"],
        validation_alias=AliasChoices("ORBIT_CORS_ORIGINS"),
    )
    upload_dir: str = Field("./uploads", validation_alias=AliasChoices("ORBIT_UPLOAD_DIR"))
    max_upload_bytes: int = Field(5 * 1024 * 1024, gt=0, le=5 * 1024 * 1024)
    # Welcome credits for a new account (credits.py): resume-AI credits and interview minutes, once. Sign-up is open
    # without email verification, so they go to one account per network (IP) per ORBIT_WELCOME_IP_DAYS (0 = one per
    # network for good), and to at most ORBIT_WELCOME_DAILY accounts a rolling day: fake accounts can't farm them.
    welcome_resume_credits: int = Field(1, ge=0, validation_alias=AliasChoices("ORBIT_WELCOME_RESUME_CREDITS"))
    # One resume credit covers this many single "Fix with AI" fixes (one ATS check, one section or line rewritten);
    # imports, tailoring, cover letters and whole-resume rewrites still use a full credit (resumes/allowance.py).
    resume_fixes_per_credit: int = Field(5, ge=1, le=50, validation_alias=AliasChoices("ORBIT_RESUME_FIXES_PER_CREDIT"))
    welcome_interview_minutes: int = Field(20, ge=0, validation_alias=AliasChoices("ORBIT_WELCOME_INTERVIEW_MINUTES"))
    welcome_ip_days: int = Field(30, ge=0, validation_alias=AliasChoices("ORBIT_WELCOME_IP_DAYS",
                                                                         "ORBIT_FREE_RESUME_AI_IP_DAYS"))
    welcome_daily_limit: int = Field(100, ge=0, validation_alias=AliasChoices("ORBIT_WELCOME_DAILY"))
    # Credit packs for sale over UPI, overriding the defaults in billing/packs.py (validated at startup).
    # Monthly plans (billing/monthly.py): a plan for 30 days, paid once; nothing renews. JSON list replaces defaults.
    monthly_plans_json: str | None = Field(None, validation_alias=AliasChoices("ORBIT_MONTHLY_PLANS_JSON"))
    credit_packs_json: str | None = Field(None, validation_alias=AliasChoices("ORBIT_CREDIT_PACKS_JSON"))
    # UPI payments (billing/upi.py): the UPI ID people pay to and the name their UPI app shows. Unset = nothing can
    # be bought. Each payment is checked by the admin against the bank statement (UTR) before its credits land.
    upi_id: str | None = Field(None, validation_alias=AliasChoices("ORBIT_UPI_ID"))
    upi_name: str = Field("Orbit", validation_alias=AliasChoices("ORBIT_UPI_NAME"))
    # Paying the UPI ID by hand (a QR, then a UTR the admin checks). Off: new orders go through Razorpay in India and
    # PayPal abroad only; UPI orders already open can still be finished and approved.
    manual_upi: bool = Field(False, validation_alias=AliasChoices("ORBIT_MANUAL_UPI"))
    # Razorpay (billing/razorpay.py): cards (international ones once Razorpay enables them), UPI, netbanking and
    # wallets, confirmed automatically. With the key id and secret set, packs are bought through Razorpay's checkout
    # instead of the manual UPI flow. The webhook secret confirms payments whose page was closed before it returned.
    # Also read as plain RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET, the names Razorpay's own guides use.
    razorpay_key_id: str | None = Field(
        None, validation_alias=AliasChoices("ORBIT_RAZORPAY_KEY_ID", "RAZORPAY_KEY_ID"))
    razorpay_key_secret: SecretStr | None = Field(
        None, validation_alias=AliasChoices("ORBIT_RAZORPAY_KEY_SECRET", "RAZORPAY_KEY_SECRET"))
    razorpay_webhook_secret: SecretStr | None = Field(
        None, validation_alias=AliasChoices("ORBIT_RAZORPAY_WEBHOOK_SECRET"))
    # Razorpay takes cards issued outside India only once it has enabled international payments for the account.
    # Until this is on, pages don't promise buyers abroad that their card will work.
    # Prices outside India (billing/pricing.py): a pack's or plan's own `price_usd_cents` (every default one has
    # it), else dollars at this many rupees to the dollar, plus this markup. The rate also turns a dollar sale into
    # its rupee equivalent for reports.
    usd_inr_rate: float = Field(88.0, gt=1, validation_alias=AliasChoices("ORBIT_USD_INR"))
    intl_markup: float = Field(1.3, ge=1, le=5, validation_alias=AliasChoices("ORBIT_INTL_MARKUP"))
    razorpay_international: bool = Field(False, validation_alias=AliasChoices("ORBIT_RAZORPAY_INTERNATIONAL"))
    # PayPal (billing/paypal.py): how buyers outside India pay their dollar prices (a PayPal account, or a card where
    # PayPal offers it). On when the REST app's client id and secret are set. The webhook id (from the app's webhook
    # settings) lets the API believe PayPal's webhooks; without it, payments still land on the buyer's return and
    # through the reconciler. "sandbox" takes no real money; "live" does.
    paypal_client_id: str | None = Field(None, validation_alias=AliasChoices("ORBIT_PAYPAL_CLIENT_ID"))
    paypal_client_secret: SecretStr | None = Field(None, validation_alias=AliasChoices("ORBIT_PAYPAL_CLIENT_SECRET"))
    paypal_webhook_id: str | None = Field(None, validation_alias=AliasChoices("ORBIT_PAYPAL_WEBHOOK_ID"))
    paypal_env: Literal["sandbox", "live"] = Field("sandbox", validation_alias=AliasChoices("ORBIT_PAYPAL_ENV"))
    # Referrals (billing/referrals.py, docs/BILLING.md "Referrals"): invite links, and the admin's creator and campus
    # codes. Off until the owner has reviewed the values below; while off nothing is attributed, discounted or
    # rewarded. The inviter gets `referral_reward_minutes` interview minutes when an invited account's first payment
    # lands, at most `referral_monthly_cap` rewards a calendar month; the invited account's first purchase is
    # `referral_discount_percent` off (a creator or campus code has its own).
    referrals: bool = Field(False, validation_alias=AliasChoices("ORBIT_REFERRALS"))
    referral_reward_minutes: int = Field(30, ge=0, le=600, validation_alias=AliasChoices(
        "ORBIT_REFERRAL_REWARD_MINUTES"))
    referral_discount_percent: int = Field(10, ge=0, le=50, validation_alias=AliasChoices(
        "ORBIT_REFERRAL_DISCOUNT_PERCENT"))
    referral_monthly_cap: int = Field(10, ge=0, le=1000, validation_alias=AliasChoices("ORBIT_REFERRAL_MONTHLY_CAP"))
    # Enable the explicit FIRST10 campaign (0 disables it). The campaign is fixed at 10%;
    # other referral discounts do not stack while it is enabled.
    first_purchase_percent: int = Field(10, ge=0, le=50, validation_alias=AliasChoices(
        "ORBIT_FIRST_PURCHASE_PERCENT"))
    # Career Evidence Vault (evidence/routes.py): off until switched on; while off its API answers 404 and live
    # sessions don't read it.
    evidence_vault: bool = Field(False, validation_alias=AliasChoices("ORBIT_EVIDENCE_VAULT"))

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
    # The mock interviewer's natural voice (voice/routes.py): Deepgram Aura text-to-speech, streamed through the API
    # so the key stays on the server. On when a Deepgram key is set, unless turned off here. Each account gets this
    # many characters a day (about 100 questions at 20k); past it, the device's own voice reads the questions.
    # Mock interviews in Hindi and Hinglish (practice_language.py). Off until the owner has checked transcription and
    # review quality on real Hindi/Hinglish answers; English stays the default either way.
    multilingual: bool = Field(False, validation_alias=AliasChoices("ORBIT_MULTILINGUAL"))
    # Live sessions in other languages (live_language.py, DECISIONS D62): the setup's "Interview language" and "Answer
    # in". English stays the default either way; off, every new or reopened live session is English again.
    live_languages: bool = Field(True, validation_alias=AliasChoices("ORBIT_LIVE_LANGUAGES"))
    # The camera coach in mock interviews (sessions/camera.py): on-device numbers about facing the camera. Off until
    # the owner has tried it on their own devices.
    personal_interview_rounds: bool = Field(False, validation_alias=AliasChoices("ORBIT_PERSONAL_INTERVIEW_ROUNDS"))
    video_mock: bool = Field(False, validation_alias=AliasChoices("ORBIT_VIDEO_MOCK"))
    natural_voice: bool = Field(True, validation_alias=AliasChoices("ORBIT_NATURAL_VOICE"))
    tts_daily_chars: int = Field(20000, ge=0, validation_alias=AliasChoices("ORBIT_TTS_DAILY_CHARS"))
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
    # Orbit for Business (D82): Google's Indexing API, told when a job page is published, changed or closed. The
    # service account's JSON key (the whole file's text), whose client_email is an Owner of the site in Search
    # Console. Unset: no pings (Google still finds jobs through the sitemap).
    google_indexing_sa_json: SecretStr | None = Field(
        None, validation_alias=AliasChoices("ORBIT_GOOGLE_INDEXING_SA_JSON"))
    business_ipinfo_token: SecretStr | None = Field(None, validation_alias=AliasChoices("ORBIT_BUSINESS_IPINFO_TOKEN"))
    # Continue with Google. Both must be set or the button stays hidden. The redirect URI registered in
    # Google Cloud is ORBIT_GOOGLE_REDIRECT_URI, or (when unset) localhost's own callback in development and
    # {ORBIT_WEB_URL}/api/v1/auth/google/callback in production, where the site proxies /api.
    google_client_id: str | None = Field(None, validation_alias=AliasChoices("ORBIT_GOOGLE_CLIENT_ID"))
    google_client_secret: SecretStr | None = Field(None, validation_alias=AliasChoices("ORBIT_GOOGLE_CLIENT_SECRET"))
    gmail_redirect_uri: str | None = Field(None, validation_alias=AliasChoices("ORBIT_GMAIL_REDIRECT_URI"))
    google_redirect_uri: str | None = Field(None, validation_alias=AliasChoices("ORBIT_GOOGLE_REDIRECT_URI"))
    # The API's own public base URL (https://api.orbitanswer.com in production). When known, links the API hands out
    # (desktop installer downloads) are built from it instead of the request's Host header. Unset, Railway's
    # RAILWAY_PUBLIC_DOMAIN is used (that may be the *.up.railway.app name rather than the custom domain, so
    # production sets this explicitly).
    api_public_url: str | None = Field(None, validation_alias=AliasChoices("ORBIT_API_PUBLIC_URL"))
    railway_public_domain: str | None = Field(None, validation_alias=AliasChoices("RAILWAY_PUBLIC_DOMAIN"))
    # SameSite for the session cookie. The web app reaches the API through its own /api proxy or at the API's own
    # address on a subdomain (same site either way), so Lax works and blocks the cookie on cross-site requests.
    # "none" only for a web app that calls the API cross-site.
    cookie_samesite: Literal["lax", "strict", "none"] = Field(
        "lax", validation_alias=AliasChoices("ORBIT_COOKIE_SAMESITE")
    )
    # The Domain of the web app's cookies (auth/security.py cookie_domain, D80). Unset: in production, the web app's
    # own domain when the API is on a subdomain of it, so the site can call the API directly; "" = host-only.
    cookie_domain: str | None = Field(None, validation_alias=AliasChoices("ORBIT_COOKIE_DOMAIN"))
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

    # Jobs (job_portal/, docs/DECISIONS.md D43). Sources refresh in the background; unset = on, except in the test
    # environment (no network there: tests fetch through a mock transport).
    jobs_refresh: bool | None = Field(None, validation_alias=AliasChoices("ORBIT_JOBS_REFRESH"))
    # Source ids to leave off, comma-separated (e.g. "remoteok,jobicy").
    jobs_sources_off: str = Field("", validation_alias=AliasChoices("ORBIT_JOBS_SOURCES_OFF"))
    # Company job boards added to (or taken off) the built-in list, as JSON (job_portal/companies.py).
    jobs_boards_json: str | None = Field(None, validation_alias=AliasChoices("ORBIT_JOBS_BOARDS_JSON"))
    # Countries besides India that a board answering one country at a time (SmartRecruiters) is asked for, as ISO
    # codes, comma-separated: one more call per board and country every 6 hours. The other boards send every
    # country's posts in one answer.
    jobs_board_countries: str = Field("US,GB,CA,DE,AU", validation_alias=AliasChoices("ORBIT_JOBS_BOARD_COUNTRIES"))
    # The share of one CPU the job refresh's own work may take (reading posts and their skills, writing them), so
    # requests stay quick next to it and, where CPU is billed by use, its cost stays small (job_portal/pace.py). 0.04
    # leaves most of even a tenth of a CPU (the worst case measured) to requests. 0 = unpaced. Unset: 0.04, and
    # unpaced in tests.
    jobs_cpu_share: float | None = Field(None, ge=0, le=1, validation_alias=AliasChoices("ORBIT_JOBS_CPU_SHARE"))
    # Free AI per account per day (UTC): fit checks, and search profiles read from a resume. The admin has no cap.
    jobs_fit_daily: int = Field(15, ge=0, validation_alias=AliasChoices("ORBIT_JOBS_FIT_DAILY"))
    # Offer AI's negotiation plans a day, free (the admin has no cap).
    # LinkedIn AI's profile reads a day, free (the admin has no cap).
    linkedin_read_daily: int = Field(3, ge=0, validation_alias=AliasChoices("ORBIT_LINKEDIN_READ_DAILY"))
    # Code AI's interviewer reviews a day, free (the admin has no cap).
    code_review_daily: int = Field(15, ge=0, validation_alias=AliasChoices("ORBIT_CODE_REVIEW_DAILY"))
    offers_plan_daily: int = Field(5, ge=0, validation_alias=AliasChoices("ORBIT_OFFERS_PLAN_DAILY"))
    jobs_profile_daily: int = Field(5, ge=0, validation_alias=AliasChoices("ORBIT_JOBS_PROFILE_DAILY"))
    # Optional search APIs, each on only when its key is set. Adzuna's free tier: 25 calls a minute, 250 a day,
    # 2,500 a month; JSearch (RapidAPI) bills per call, so it stops at 90% of ORBIT_JSEARCH_MONTHLY_BUDGET.
    adzuna_app_id: str | None = Field(None, validation_alias=AliasChoices("ORBIT_ADZUNA_APP_ID"))
    adzuna_app_key: SecretStr | None = Field(None, validation_alias=AliasChoices("ORBIT_ADZUNA_APP_KEY"))
    jsearch_key: SecretStr | None = Field(None, validation_alias=AliasChoices("ORBIT_JSEARCH_KEY"))
    jsearch_monthly_budget: int = Field(200, ge=0, validation_alias=AliasChoices("ORBIT_JSEARCH_MONTHLY_BUDGET"))
    contact_search_key: SecretStr | None = Field(None, validation_alias=AliasChoices("ORBIT_CONTACT_SEARCH_KEY"))
    # Optional Hunter.io key: verified work emails and the company's email format in the job contact finder.
    contact_hunter_key: SecretStr | None = Field(None, validation_alias=AliasChoices("ORBIT_HUNTER_API_KEY"))
    contact_deepseek_search: bool = Field(True, validation_alias=AliasChoices("ORBIT_CONTACT_DEEPSEEK_SEARCH"))
    contact_deepseek_search_cost_usd: float = Field(0.00075, ge=0, le=1,
        validation_alias=AliasChoices("ORBIT_CONTACT_DEEPSEEK_SEARCH_COST_USD"))
    contact_searxng_url: str | None = Field(None, max_length=1000,
        validation_alias=AliasChoices("ORBIT_CONTACT_SEARXNG_URL"))

    @field_validator("contact_searxng_url", mode="before")
    @classmethod
    def search_service(cls, value: object) -> str | None:
        if value is None or value == "":
            return None
        if not isinstance(value, str):
            raise ValueError("Search service must be a URL.")
        value = value.strip().rstrip("/")
        if not value:
            return None
        parts = urlsplit(value)
        if (parts.scheme not in ("http", "https") or not parts.hostname or parts.username or parts.password
                or parts.query or parts.fragment or re.search(r"[\s\x00-\x1f]", value)):
            raise ValueError("Use the operator-managed SearXNG base URL without credentials, query or fragment.")
        # Only server configuration can set this URL. Private service DNS is intentional; candidate inputs never set it.
        _ = parts.port
        return value

    # The Contact page (contact/routes.py): at most this many messages a rolling day from everyone together (each
    # network also has its own limits), so a flood can't bury the Inbox. Messages the admin marked done or spam are
    # deleted this many days after that (0 = kept until deleted by hand).
    contact_daily_cap: int = Field(300, ge=1, validation_alias=AliasChoices("ORBIT_CONTACT_DAILY_CAP"))
    contact_retention_days: int = Field(365, ge=0, validation_alias=AliasChoices("ORBIT_CONTACT_RETENTION_DAYS"))

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
    # Sign-up approval: new accounts can't use anything until the admin approves them or grants a plan for a while
    # (Settings → Users), and the admin gets an email for each new sign-up. Unset: on in production, off in
    # development/test. Accounts that existed before are unaffected.
    signup_approval: bool | None = Field(None, validation_alias=AliasChoices("ORBIT_SIGNUP_APPROVAL"))
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

    @field_validator("cors_origins", mode="before")
    @classmethod
    def _origins_list(cls, v: object) -> object:
        if not isinstance(v, str):
            return v
        if v.strip().startswith("["):
            import json

            return json.loads(v)
        # Origins never end in "/"; a pasted "https://app.example/" would otherwise never match the browser's Origin.
        return [o.strip().rstrip("/") for o in v.split(",") if o.strip()]

    @field_validator("upi_id", mode="before")
    @classmethod
    def _upi_id(cls, v: object) -> object:
        if isinstance(v, str):
            v = v.strip() or None
        if isinstance(v, str) and not re.fullmatch(r"[A-Za-z0-9.\-_]{2,256}@[A-Za-z][A-Za-z0-9.\-]{1,64}", v):
            raise ValueError("ORBIT_UPI_ID must look like name@bank (for example yourname@okicici)")
        return v

    @field_validator("razorpay_key_id", "razorpay_key_secret", "razorpay_webhook_secret", "proxy_secret",
                     "paypal_client_id", "paypal_client_secret", "paypal_webhook_id", mode="before")
    @classmethod
    def _razorpay_trimmed(cls, v: object) -> object:
        # Keys pasted into a dashboard often carry a space or line break, which Razorpay answers with a 401.
        return (v.strip() or None) if isinstance(v, str) else v

    @field_validator("jobs_board_countries", mode="before")
    @classmethod
    def _country_codes(cls, v: object) -> object:
        if not isinstance(v, str):
            return v
        codes = [c.strip().upper() for c in v.split(",") if c.strip()]
        if any(not re.fullmatch(r"[A-Z]{2}", c) for c in codes):
            raise ValueError("ORBIT_JOBS_BOARD_COUNTRIES must be two-letter country codes, comma-separated (US,GB)")
        return ",".join(dict.fromkeys(c for c in codes if c != "IN"))  # India is always asked for

    @field_validator("stt_price_per_minute", mode="before")
    @classmethod
    def _blank_price_is_unknown(cls, v: object) -> object:
        return None if isinstance(v, str) and not v.strip() else v

    @model_validator(mode="after")
    def _hosted_worker_config(self) -> "Settings":
        if self.hosted_apply and self.apply_worker_secret is None:
            raise ValueError("ORBIT_HOSTED_APPLY requires ORBIT_APPLY_WORKER_SECRET (32+ random characters)")
        return self

    @model_validator(mode="after")
    def _public_url_from_the_host(self) -> "Settings":
        # Railway names the domain bare (orbit-api-sg-production.up.railway.app), always served over https.
        domain = (self.railway_public_domain or "").strip().strip("/")
        if not (self.api_public_url or "").strip() and domain:
            self.api_public_url = f"https://{domain}"
        return self

    @model_validator(mode="after")
    def _reject_insecure_production(self) -> "Settings":
        if self.env == "production":
            secret = self.jwt_secret.get_secret_value()
            # The .env.example placeholder is 33 characters, so length alone let it through.
            if (secret == _DEV_SECRET or len(secret) < 32 or "change-me" in secret.lower()
                    or len(set(secret)) < 12):
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
            proxy = self.proxy_secret.get_secret_value().strip() if self.proxy_secret else ""
            if len(proxy) < 32 or proxy == _DEV_PROXY_SECRET or len(set(proxy)) < 12:
                # Not usable: trust no proxy (limits key on the socket peer) and warn at startup (main.py), rather
                # than refuse to start. Refusing took production down twice when Render didn't have the secret.
                self.proxy_secret = None
            if self.api_replicas != 1:
                raise ValueError("ORBIT_API_REPLICAS must be 1: live-session state is process-local (tickets, "
                                 "socket ownership, screenshot routing, rate limits). See docs/DECISIONS.md D12.")
            if not (self.admin_email and "@" in self.admin_email):
                raise ValueError("ORBIT_ADMIN_EMAIL must be set in production (the admin is never inferred)")
            # Public sign-up without email verification or approval is allowed: a new account's only free
            # spend is its welcome credits (credits.py), which go to one account per network and to a capped
            # number a day, so throwaway addresses can't farm provider spend.
            if self.public_signup and not self.verification_required and not self.approval_required \
                    and self.welcome_daily_limit > 1_000:
                raise ValueError("Public sign-up with ORBIT_EMAIL_VERIFICATION=off and no sign-up approval needs "
                                 "ORBIT_WELCOME_DAILY at 1000 or less (welcome credits are the free spend)")
            if self.verification_required and self.others_can_sign_in and not self.smtp_host:
                raise ValueError("Email verification is required for non-admin users but ORBIT_SMTP_HOST is not "
                                 "set, so nobody could verify. Configure SMTP, or for a private list of exact "
                                 "addresses set ORBIT_EMAIL_VERIFICATION=off.")
            if self.captcha_provider == "turnstile" and not (self.turnstile_site_key and self.turnstile_secret_key):
                raise ValueError("ORBIT_CAPTCHA_PROVIDER=turnstile needs TURNSTILE_SITE_KEY and TURNSTILE_SECRET_KEY")
        # SMTP is optional for an admin-only deploy: email features are then disabled. It's never faked to the
        # dev outbox in production (see email.py).
        elif self.proxy_secret is None:
            self.proxy_secret = SecretStr(_DEV_PROXY_SECRET)
        if self.env == "production" and bool(self.razorpay_key_id) != bool(self.razorpay_key_secret):
            raise ValueError("Set both ORBIT_RAZORPAY_KEY_ID and ORBIT_RAZORPAY_KEY_SECRET, or leave both empty")
        if self.env == "production" and self.razorpay_key_id and not self.razorpay_webhook_secret:
            raise ValueError("ORBIT_RAZORPAY_WEBHOOK_SECRET is required when production checkout is enabled")
        if self.env == "production" and bool(self.google_client_id) != bool(self.google_client_secret):
            raise ValueError("Set both ORBIT_GOOGLE_CLIENT_ID and ORBIT_GOOGLE_CLIENT_SECRET, or leave both empty")
        return self

    @property
    def jobs_refresh_on(self) -> bool:
        return self.jobs_refresh if self.jobs_refresh is not None else self.env != "test"

    @property
    def jobs_pace(self) -> float:
        if self.jobs_cpu_share is not None:
            return self.jobs_cpu_share
        return 0.0 if self.env == "test" else 0.04

    @property
    def approval_required(self) -> bool:
        return self.signup_approval if self.signup_approval is not None else self.env == "production"

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
    def google_enabled(self) -> bool:
        secret = self.google_client_secret.get_secret_value().strip() if self.google_client_secret else ""
        return bool((self.google_client_id or "").strip() and secret)

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
