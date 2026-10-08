from collections.abc import Generator

from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from backend.core.config import get_settings


settings = get_settings()


class Base(DeclarativeBase):
    """Base declarative class for SQLAlchemy models."""


connect_args = {"check_same_thread": False} if settings.database_url.startswith("sqlite") else {}
pool_options = (
    {"pool_size": 10, "max_overflow": 20, "pool_recycle": 1800}
    if settings.database_url.startswith(("mysql", "mariadb", "postgresql"))
    else {}
)
engine = create_engine(settings.database_url, pool_pre_ping=True, connect_args=connect_args, **pool_options)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine, class_=Session)


def get_db() -> Generator[Session, None, None]:
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
