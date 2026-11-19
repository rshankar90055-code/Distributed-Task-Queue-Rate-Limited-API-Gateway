from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    redis_url: str = "redis://localhost:6379/0"
    celery_broker_url: str = "redis://localhost:6379/1"
    celery_result_backend: str = "redis://localhost:6379/2"

    # Token bucket: burst size and sustained rate (tokens per second)
    rate_limit_capacity: int = 10
    rate_limit_refill_rate: float = 1.0

    model_config = SettingsConfigDict(env_file=".env")


settings = Settings()