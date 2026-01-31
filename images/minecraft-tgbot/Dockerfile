FROM python:3.13-alpine

RUN pip install --no-cache-dir 'python-telegram-bot[socks]'

COPY bot.py /app/bot.py

ENTRYPOINT ["python3", "-u", "/app/bot.py"]
