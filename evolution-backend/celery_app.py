import os
from celery import Celery

broker_url = os.getenv("CELERY_BROKER_URL", "amqp://guest:guest@evolution_rabbitmq:5672//")
celery_app = Celery("evolution_tasks", broker=broker_url, include=["tasks"])

celery_app.conf.update(
    task_serializer="json",
    accept_content=["json"],
    result_serializer="json",
    timezone="America/Asuncion",
    enable_utc=True,
)