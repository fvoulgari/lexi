from pathlib import Path

from pydantic import Field, SecretStr, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")
    database_url: str
    # Retained as optional parsing compatibility during migration; never used for login.
    shared_password: SecretStr = SecretStr("")
    session_secret: SecretStr = SecretStr("")
    supertokens_connection_uri: str = ""
    supertokens_api_key: SecretStr = SecretStr("")
    google_client_id: str = ""
    google_client_secret: SecretStr = SecretStr("")
    resend_api_key: SecretStr = SecretStr("")
    email_from: str = ""
    cookie_secure: bool = True
    public_origin: str = "http://localhost:8000"
    claim_hours: int = Field(default=48, ge=1, le=168)
    session_hours: int = Field(default=168, ge=1, le=720)
    login_limit: int = Field(default=5, ge=1, le=100)
    static_dir: Path = Path("../frontend/dist")

    @field_validator("database_url")
    @classmethod
    def postgres_url(cls, value):
        if value.startswith("postgres://"):
            value = value.replace("postgres://", "postgresql+psycopg://", 1)
        elif value.startswith("postgresql://"):
            value = value.replace("postgresql://", "postgresql+psycopg://", 1)
        if not value.startswith("postgresql+psycopg://"):
            raise ValueError("PostgreSQL with psycopg is required")
        return value
