"""
Service layer — organized by domain module.

Module boundaries:
- captcha: solver_service, cache_service
- exam: exam_service, exam_merge_service
- users: user_service, user_key_service, subscription_service, payment_service
- platform: key_service, backup_service, alert_service, audit_service, usage_service
- telegram: telegram_bot
- extension: extension_service
"""
