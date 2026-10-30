# The one shared backend everyone's app talks to. Built and started by docker-compose.yml.
FROM python:3.13-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY *.py ./

EXPOSE 8000
# --timeout-graceful-shutdown: live-update connections stay open, so don't wait for them on restart
CMD ["uvicorn", "auth:app", "--host", "0.0.0.0", "--port", "8000", "--timeout-graceful-shutdown", "3"]
