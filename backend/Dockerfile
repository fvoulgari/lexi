FROM python:3.14-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
WORKDIR /app/backend
COPY backend/requirements.txt backend/requirements-dev.txt ./
RUN pip install --no-cache-dir -r requirements-dev.txt
COPY backend/app ./app
COPY backend/tests ./tests
COPY backend/pyproject.toml backend/alembic.ini ./
COPY backend/alembic ./alembic
COPY data /app/data
COPY scripts/start.sh /app/start.sh
RUN chmod +x /app/start.sh
EXPOSE 8000
CMD ["/app/start.sh"]
