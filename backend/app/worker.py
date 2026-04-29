"""Celery worker: background jobs (re-embedding, etc.).

Currently lean — most operations are sync because they're fast enough. This
exists as a hook for future heavy lifting (full reindex, batch embed, email).
"""
from celery import Celery
from app.core.config import settings

celery_app = Celery("wiki", broker=settings.redis_url, backend=settings.redis_url)
celery_app.conf.task_routes = {"app.worker.*": {"queue": "default"}}


@celery_app.task
def ping():
    return "pong"
