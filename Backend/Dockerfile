# The one shared backend everyone's app talks to. Built and started by docker-compose.yml.
FROM python:3.13-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY *.py ./

EXPOSE 8000
# 1. "import auth" sets up/upgrades the database tables once, before the processes start
#    (so several processes don't all try to create a new table at the same moment).
# 2. WEB_WORKERS processes (docker-compose.yml) share the work across CPU cores.
# --timeout-graceful-shutdown: live-update connections stay open, so don't wait for them on restart.
CMD ["sh", "-c", "python -c 'import auth' && exec uvicorn auth:app --host 0.0.0.0 --port 8000 --workers ${WEB_WORKERS:-1} --timeout-graceful-shutdown 3"]
