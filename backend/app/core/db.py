"""Database engine and session factory (PostgreSQL-only runtime)."""

from __future__ import annotations

from sqlalchemy import create_engine
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session, declarative_base, sessionmaker

from app.core.config import Settings

Base = declarative_base()

_engine: Engine | None = None
_SessionLocal: sessionmaker | None = None


def _build_postgresql_url(database_url: str) -> str:
    """Ensure the URL uses a sync driver for migrations/sessions."""
    if "+asyncpg" in database_url:
        return database_url.replace("+asyncpg", "+psycopg2")
    if not database_url.startswith("postgresql"):
        return f"postgresql+psycopg2://{database_url}"
    return database_url


def init_db(settings: Settings) -> Engine:
    """Initialize PostgreSQL engine and session factory."""
    global _engine, _SessionLocal

    database_url = settings.storage.database_url
    if not database_url:
        raise RuntimeError(
            "PostgreSQL runtime requires DATABASE_URL or POSTGRES_* "
            "environment variables (including POSTGRES_PASSWORD)."
        )
    url = _build_postgresql_url(database_url)

    _engine = create_engine(
        url,
        echo=settings.server.debug,
        pool_pre_ping=True,
    )

    _SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=_engine)

    return _engine


def get_session() -> Session:
    """Get a new database session. Must be closed by caller."""
    if _SessionLocal is None:
        raise RuntimeError("Database not initialized - call init_db() first")
    return _SessionLocal()


def get_engine() -> Engine:
    """Get the current database engine."""
    if _engine is None:
        raise RuntimeError("Database not initialized - call init_db() first")
    return _engine


def create_all_tables() -> None:
    """Create all tables defined in SQLAlchemy models (dev convenience)."""
    if _engine is None:
        raise RuntimeError("Database not initialized")
    Base.metadata.create_all(bind=_engine)


def drop_all_tables() -> None:
    """Drop all tables (DANGER - dev only)."""
    if _engine is None:
        raise RuntimeError("Database not initialized")
    Base.metadata.drop_all(bind=_engine)
