"""Shared background loops for API and scheduler entrypoints."""

from __future__ import annotations

import asyncio
import logging
import os
from datetime import datetime, timedelta, timezone

from app.core.db import get_session

logger = logging.getLogger(__name__)


async def exam_merge_loop(container) -> None:
    """Auto-merge verified learned questions into main bank on schedule."""
    while True:
        try:
            interval_hours = 6
            try:
                interval_hours = max(1, int(container.db.get_setting("exam.merge_interval_hours", "6")))
            except (ValueError, TypeError):
                pass

            merge_enabled = container.db.get_setting(
                "exam.auto_merge_enabled", "true"
            ).lower() in ("true", "1", "yes", "on")

            if not merge_enabled:
                await asyncio.sleep(3600)
                continue

            await asyncio.sleep(interval_hours * 3600)

            result = container.exam_merge_service.merge_verified_to_main()
            if result["merged"] > 0:
                logger.info("exam_auto_merge", extra={"context": result})
        except asyncio.CancelledError:
            break
        except Exception as exc:
            logger.error("exam_auto_merge_failed", extra={"context": {"error": str(exc)}})
            await asyncio.sleep(3600)


async def backup_scheduler(container) -> None:
    """Run automated system + user backups on schedule."""
    await asyncio.sleep(60)
    while True:
        try:
            enabled = container.db.get_setting(
                "backup.enabled", "true"
            ).lower() in ("true", "1", "yes", "on")

            if not enabled:
                await asyncio.sleep(3600)
                continue

            interval_hours = 6
            try:
                interval_hours = max(1, int(container.db.get_setting("backup.interval_hours", "6")))
            except (ValueError, TypeError):
                pass

            await asyncio.sleep(interval_hours * 3600)

            sys_result = container.backup_service.create_system_backup()
            user_result = container.backup_service.create_user_backup()

            for path in [sys_result["path"], user_result["path"]]:
                try:
                    container.backup_service.rclone_sync(path)
                except Exception as exc:
                    logger.warning("backup_rclone_skip: %s", exc)

            for path in [sys_result["path"], user_result["path"]]:
                try:
                    await container.backup_service.telegram_backup(path)
                except Exception as exc:
                    logger.warning("backup_telegram_skip: %s", exc)

        except asyncio.CancelledError:
            break
        except Exception as exc:
            logger.error("backup_scheduler_failed", extra={"context": {"error": str(exc)}})
            await asyncio.sleep(3600)


async def subscription_expiry_loop(container) -> None:
    """Check for expired subscriptions every hour."""
    await asyncio.sleep(120)
    while True:
        try:
            token = os.getenv("TELEGRAM_BOT_TOKEN", "")

            try:
                from app.core.models import User, UserSubscription

                session = get_session()
                now_dt = datetime.now(timezone.utc)
                three_days = now_dt + timedelta(days=3)
                soon = (
                    session.query(UserSubscription)
                    .filter(
                        UserSubscription.status == "active",
                        UserSubscription.end_at.between(now_dt, three_days),
                    )
                    .all()
                )
                if soon and token:
                    from telegram import Bot

                    bot = Bot(token=token)
                    for sub in soon:
                        user = session.query(User).filter(User.id == sub.user_id).first()
                        if user and user.telegram_chat_id:
                            days_left = (sub.end_at - now_dt).days
                            try:
                                await bot.send_message(
                                    chat_id=int(user.telegram_chat_id),
                                    text=(
                                        "*Subscription Expiring Soon*\n\n"
                                        f"Your plan expires in *{days_left} days*.\n"
                                        "Use /renew to continue your service."
                                    ),
                                    parse_mode="Markdown",
                                )
                            except Exception:
                                pass
                session.close()
            except Exception as exc:
                logger.warning("expiry_warning_failed: %s", exc)

            expired_users = container.subscription_service.expire_overdue()
            if expired_users:
                logger.info("auto_expired: %s subscriptions", len(expired_users))
                if token:
                    try:
                        from telegram import Bot

                        bot = Bot(token=token)
                        for user_info in expired_users:
                            chat_id = user_info.get("telegram_chat_id")
                            if chat_id:
                                await bot.send_message(
                                    chat_id=int(chat_id),
                                    text=(
                                        "*Subscription Expired*\n\n"
                                        "Your subscription has expired.\n"
                                        "Use /renew to purchase a new plan."
                                    ),
                                    parse_mode="Markdown",
                                )
                    except Exception as exc:
                        logger.warning("expiry_notify_failed: %s", exc)
        except asyncio.CancelledError:
            break
        except Exception as exc:
            logger.error("expiry_check_failed: %s", exc)
        await asyncio.sleep(3600)
