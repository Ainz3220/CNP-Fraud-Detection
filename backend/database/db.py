import os
from sqlalchemy import create_engine
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker
from dotenv import load_dotenv

load_dotenv()

DATABASE_URL = os.getenv("DATABASE_URL", "sqlite:///./fraud_detection.db")

engine = create_engine(
    DATABASE_URL,
    connect_args={"check_same_thread": False} if "sqlite" in DATABASE_URL else {},
)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def init_db():
    from database.models import Prediction  # noqa: F401
    Base.metadata.create_all(bind=engine)
    upgrade_db()


def upgrade_db():
    """Add columns introduced after initial schema creation."""
    from sqlalchemy import text, inspect
    insp = inspect(engine)
    try:
        existing = {c["name"] for c in insp.get_columns("predictions")}
        with engine.begin() as conn:
            if "analyst_label" not in existing:
                conn.execute(text("ALTER TABLE predictions ADD COLUMN analyst_label INTEGER"))
            if "feedback_at" not in existing:
                conn.execute(text("ALTER TABLE predictions ADD COLUMN feedback_at TIMESTAMP"))
    except Exception:
        pass
