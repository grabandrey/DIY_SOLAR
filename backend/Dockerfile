FROM python:3.12-slim

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY app ./app
COPY config ./config

EXPOSE 8000

# uvicorn serves the FastAPI app; the poller starts via the lifespan handler.
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
