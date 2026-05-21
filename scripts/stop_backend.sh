#!/bin/bash
pkill -f "uvicorn app.main:app"
pkill -f "app.services.telegram_bot"
echo "Backend and Telegram bot stopped."
