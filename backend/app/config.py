from pathlib import Path

from pydantic import Field, SecretStr, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")
    database_url: str
    shared_password: SecretStr
    session_secret: SecretStr
    cookie_secure: bool = True
    public_origin: str = "http://localhost:8000"
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

    @field_validator("shared_password", "session_secret")
    @classmethod
    def secret_length(cls, value, info):
        minimum = 32 if info.field_name == "session_secret" else 12
        if not minimum <= len(value.get_secret_value()) <= 256:
            raise ValueError(f"{info.field_name} must have {minimum}–256 characters")
        return value
