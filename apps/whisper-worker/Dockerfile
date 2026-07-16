FROM python:3.12-slim
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg && rm -rf /var/lib/apt/lists/*
WORKDIR /worker
COPY apps/whisper-worker/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY apps/whisper-worker/app ./app
EXPOSE 8090
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8090"]
