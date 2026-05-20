import json
from datetime import datetime
from sqlalchemy import Column, Integer, String, Float, Text, DateTime
from database.db import Base


class Prediction(Base):
    __tablename__ = "predictions"

    id = Column(Integer, primary_key=True, index=True)
    timestamp = Column(DateTime, default=datetime.utcnow)
    transaction_data = Column(Text)  # JSON string
    model_used = Column(String(50))
    fraud_probability = Column(Float)
    verdict = Column(String(30))
    explanation = Column(Text)  # JSON string
    created_at = Column(DateTime, default=datetime.utcnow)

    def set_transaction_data(self, data: dict):
        self.transaction_data = json.dumps(data)

    def get_transaction_data(self) -> dict:
        return json.loads(self.transaction_data) if self.transaction_data else {}

    def set_explanation(self, data):
        self.explanation = json.dumps(data)

    def get_explanation(self):
        return json.loads(self.explanation) if self.explanation else {}
