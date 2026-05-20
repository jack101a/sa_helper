# Task P3 — Telegram Plans, Entitlements & Lifecycle

> **Tasks**: T11, T12, T13, T14, T15  
> **Priority**: P3 (after P0, P1, P2)  
> **Depends on**: None (can run parallel to P2)  
> **Estimated changes**: ~100 lines modified across existing files

---

## Files to Read First

1. `backend/app/core/models.py` — lines 129-163 (`SubscriptionPlan` model)
2. `backend/app/services/subscription_service.py` — entire file (211 lines)
3. `backend/app/services/user_key_service.py` — lines 194-248 (`bind_device`)
4. `backend/app/api/admin_routes/subscriptions.py` — entire file (117 lines)
5. `backend/app/api/admin_routes/payments.py` — lines 52-179 (approve flow)
6. `backend/app/services/telegram_bot.py` — lines 1-100 (init, commands)
7. `backend/app/main.py` — lifespan function

---

## T11: Add Plan Entitlement Columns

### Goal

Add `max_devices`, `allowed_services`, and `rate_limit_rpm` to `SubscriptionPlan` so admin can control per-plan entitlements.

### Step 11.1: Add columns to ORM model

**File**: `backend/app/core/models.py`  
**Location**: Inside `SubscriptionPlan` class (around line 129-163)

**Find the existing column definitions** and add these new columns AFTER the existing ones (before `created_at`):

```python
    max_devices = Column(Integer, default=1, nullable=False, server_default="1")
    allowed_services = Column(JSON, default=dict, nullable=True)  # e.g., {"captcha": true, "solver": true, "autofill": true}
    rate_limit_rpm = Column(Integer, default=60, nullable=False, server_default="60")
```

**Update `to_dict()`** method of `SubscriptionPlan` (if it exists) to include these fields:
```python
    def to_dict(self):
        d = {
            # ... existing fields ...
        }
        # Add new fields
        d["max_devices"] = self.max_devices
        d["allowed_services"] = self.allowed_services or {}
        d["rate_limit_rpm"] = self.rate_limit_rpm
        return d
```

> **Important**: Read the model file carefully. If `to_dict()` already exists, just add the new fields. If it doesn't exist, check how other models serialize (some use `__dict__` or a utility function).

### Step 11.2: Create Alembic migration

Run this command to generate migration:
```bash
cd backend && python -m alembic revision --autogenerate -m "add_plan_entitlements"
```

If autogenerate doesn't work (due to dual DB setup), create migration manually:

**Create NEW file**: `backend/migrations/versions/{auto_generated}_add_plan_entitlements.py`

```python
"""Add plan entitlement columns.

Revision ID: (auto-generated)
"""
from alembic import op
import sqlalchemy as sa

def upgrade():
    op.add_column('subscription_plans', sa.Column('max_devices', sa.Integer(), server_default='1', nullable=False))
    op.add_column('subscription_plans', sa.Column('allowed_services', sa.JSON(), nullable=True))
    op.add_column('subscription_plans', sa.Column('rate_limit_rpm', sa.Integer(), server_default='60', nullable=False))

def downgrade():
    op.drop_column('subscription_plans', 'rate_limit_rpm')
    op.drop_column('subscription_plans', 'allowed_services')
    op.drop_column('subscription_plans', 'max_devices')
```

### Step 11.3: Update admin subscription routes

**File**: `backend/app/api/admin_routes/subscriptions.py`  
**Location**: `create_plan()` function (line 28-50)

**Update the create_plan call** to pass new fields:

```python
        plan = container.subscription_service.create_plan(
            code=body.get("code"),
            name=body["name"],
            monthly_limit=body.get("monthly_limit", 1000),
            duration_days=body.get("duration_days", 30),
            price_amount=body.get("price_amount", 0),
            currency=body.get("currency", "INR"),
            description=body.get("description", ""),
            max_devices=body.get("max_devices", 1),
            allowed_services=body.get("allowed_services", {}),
            rate_limit_rpm=body.get("rate_limit_rpm", 60),
        )
```

**File**: `backend/app/services/subscription_service.py`  
**Update `create_plan()`** to accept and pass new parameters:

```python
    def create_plan(
        self,
        code: str,
        name: str,
        monthly_limit: int = 3000,
        duration_days: int = 30,
        price_amount: int = 0,
        currency: str = "INR",
        description: str = "",
        max_devices: int = 1,
        allowed_services: dict | None = None,
        rate_limit_rpm: int = 60,
    ) -> SubscriptionPlan:
        session = self._session()
        try:
            plan = SubscriptionPlan(
                code=code,
                name=name,
                description=description,
                monthly_limit=monthly_limit,
                duration_days=duration_days,
                price_amount=price_amount,
                currency=currency,
                max_devices=max_devices,
                allowed_services=allowed_services or {},
                rate_limit_rpm=rate_limit_rpm,
            )
            session.add(plan)
            session.commit()
            session.refresh(plan)
            return plan
        except Exception:
            session.rollback()
            raise
        finally:
            session.close()
```

---

## T12: Enforce Service Entitlements in Payment Approval

### Goal

When a payment is approved and subscription created, copy `plan.allowed_services` into the API key's entitlements.

**File**: `backend/app/api/admin_routes/payments.py`  
**Location**: Inside `approve_payment()`, after the API key is created (around line 143)

**Find this block** (around line 132-143):
```python
            existing_key = session.query(UserApiKey).filter(...)
            if not existing_key:
                ...
                svc.create_key(user_id=user.id)
```

**Add AFTER the key creation block** (still inside the `if plan:` block):
```python
            # Copy plan entitlements to API key
            if plan.allowed_services:
                try:
                    # Get the active key (just created or existing)
                    active_key = session.query(UserApiKey).filter(
                        UserApiKey.user_id == user.id,
                        UserApiKey.status == "active",
                    ).first()
                    if active_key:
                        container.db.update_api_key_entitlements(
                            int(active_key.id),
                            services=plan.allowed_services,
                        )
                except Exception as e:
                    logger.warning(f"entitlement_copy_failed: {e}")
```

> **Important**: First check if `db.update_api_key_entitlements()` exists. Search for it with: `grep -rn "update_api_key_entitlements" backend/app/`. If it doesn't exist, check the `api_key_entitlements` table schema and create a method in `database.py` that does an INSERT/UPDATE.

---

## T13: Device Limit Per Plan

### Goal

Replace the hardcoded 1-device-per-key limit in `UserKeyService.bind_device()` with the plan's `max_devices` setting.

**File**: `backend/app/services/user_key_service.py`  
**Location**: `bind_device()` method (lines 194-248)

**Find this block** (around line 218-229):
```python
            # Check if key already has an active device (one-device policy)
            active_device = (
                session.query(UserApiKeyDevice)
                .filter(
                    UserApiKeyDevice.api_key_id == api_key_id,
                    UserApiKeyDevice.status == "active",
                )
                .first()
            )
            if active_device and active_device.device_fingerprint != device_fingerprint:
                # Device mismatch — reject
                return None  # Caller should handle as "device_mismatch"
```

**Replace with:**
```python
            # Check device limit from user's plan
            max_devices = 1  # default
            try:
                key = session.query(UserApiKey).filter(UserApiKey.id == api_key_id).first()
                if key and key.user_id:
                    from app.core.models import UserSubscription, SubscriptionPlan
                    sub = (
                        session.query(UserSubscription)
                        .filter(
                            UserSubscription.user_id == key.user_id,
                            UserSubscription.status == "active",
                        )
                        .order_by(UserSubscription.created_at.desc())
                        .first()
                    )
                    if sub and sub.plan_id:
                        plan = session.query(SubscriptionPlan).filter(
                            SubscriptionPlan.id == sub.plan_id
                        ).first()
                        if plan and plan.max_devices:
                            max_devices = plan.max_devices
            except Exception:
                pass  # Fall back to default of 1

            active_devices = (
                session.query(UserApiKeyDevice)
                .filter(
                    UserApiKeyDevice.api_key_id == api_key_id,
                    UserApiKeyDevice.status == "active",
                )
                .all()
            )
            # Check if this device is already bound
            for dev in active_devices:
                if dev.device_fingerprint == device_fingerprint:
                    dev.last_seen_at = now
                    session.commit()
                    return dev
            # Check if device limit reached
            if len(active_devices) >= max_devices:
                return None  # Caller should handle as "device_limit_reached"
```

---

## T14: Subscription Auto-Expiry

### Goal

Add a background task that expires subscriptions past their `end_at` date and notifies users.

### Step 14.1: Add `expire_overdue()` to SubscriptionService

**File**: `backend/app/services/subscription_service.py`  
**Add this method** to the `SubscriptionService` class:

```python
    def expire_overdue(self) -> list[dict]:
        """Find and expire all active subscriptions past end_at. Returns list of expired user info."""
        session = self._session()
        try:
            now = datetime.now(timezone.utc)
            overdue = (
                session.query(UserSubscription)
                .filter(
                    UserSubscription.status == "active",
                    UserSubscription.end_at < now,
                )
                .all()
            )
            expired_users = []
            for sub in overdue:
                sub.status = "expired"
                sub.updated_at = now
                user = session.query(User).filter(User.id == sub.user_id).first()
                if user:
                    user.status = "expired"
                    user.updated_at = now
                    expired_users.append({
                        "user_id": user.id,
                        "name": user.full_name,
                        "telegram_chat_id": user.telegram_chat_id,
                        "telegram_user_id": user.telegram_user_id,
                    })
            session.commit()
            return expired_users
        except Exception:
            session.rollback()
            raise
        finally:
            session.close()
```

### Step 14.2: Add expiry scheduler to main.py

**File**: `backend/app/main.py`

**Add this function:**

```python
async def _subscription_expiry_loop(container) -> None:
    """Check for expired subscriptions every hour."""
    await asyncio.sleep(120)  # wait 2 min after startup
    while True:
        try:
            expired_users = container.subscription_service.expire_overdue()
            if expired_users:
                logger.info(f"auto_expired: {len(expired_users)} subscriptions")
                # Notify users via Telegram
                token = os.getenv("TELEGRAM_BOT_TOKEN", "")
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
                                        "⚠️ *Subscription Expired*\n\n"
                                        "Your subscription has expired.\n"
                                        "Use /renew to purchase a new plan."
                                    ),
                                    parse_mode="Markdown",
                                )
                    except Exception as e:
                        logger.warning(f"expiry_notify_failed: {e}")
        except asyncio.CancelledError:
            break
        except Exception as e:
            logger.error(f"expiry_check_failed: {e}")
        await asyncio.sleep(3600)  # check every hour
```

**Add to lifespan:**
```python
    expiry_task = asyncio.create_task(_subscription_expiry_loop(container))
```
**And shutdown:**
```python
    expiry_task.cancel()
```

---

## T15: Telegram /renew Command + Expiry Warnings

### Goal

Add `/renew` command that re-uses the existing plan selection flow, and add expiry warning messages (3 days before).

**File**: `backend/app/services/telegram_bot.py`

> **This is a large file (1328 lines).** Read it carefully before editing.

### Step 15.1: Add /renew handler

**Find where command handlers are registered** (look for `application.add_handler` calls or a `CommandHandler` pattern).

**Add a new command handler** following the same pattern:

```python
# Register the /renew command (add near other CommandHandler registrations)
application.add_handler(CommandHandler("renew", self._handle_renew))
```

**Add the handler method** (find where other `_handle_*` methods are defined):

```python
    async def _handle_renew(self, update, context):
        """Handle /renew — shortcut to plan selection for existing users."""
        tg_user_id = str(update.effective_user.id)
        
        # Check if user exists
        from app.core.db import get_session
        from app.core.models import User
        session = get_session()
        try:
            user = session.query(User).filter(
                User.telegram_user_id == tg_user_id
            ).first()
            if not user:
                await update.message.reply_text(
                    "❌ You're not registered yet.\nUse /register to create an account."
                )
                return
            
            # Set state to plan selection (reuse existing flow)
            # Look for the existing state management pattern — the bot uses
            # telegram_user_states.json to track conversation state.
            # Set the user's state to the plan selection step.
            self._set_user_state(tg_user_id, {
                "step": "select_plan",
                "user_id": user.id,
                "is_renewal": True,
                "name": user.full_name,
                "phone": user.phone_number,
            })
            
            # Show plan picker (reuse existing method)
            # Find the method that displays plans as inline keyboard buttons
            # and call it here. It's likely called _show_plans or similar.
            await self._show_plan_selection(update, context)
            
        finally:
            session.close()
```

> **CRITICAL**: The exact method names (`_set_user_state`, `_show_plan_selection`) may differ. Read the telegram_bot.py file to find:
> 1. How state is set (search for `telegram_user_states` or `_states`)
> 2. How plans are displayed (search for `InlineKeyboardButton` or `plan`)
> 3. Follow the exact same patterns.

### Step 15.2: Add expiry warning to the expiry loop

**File**: `backend/app/main.py`  
**Modify `_subscription_expiry_loop`** to also check for soon-expiring subscriptions:

Add this block BEFORE the `expire_overdue()` call:

```python
            # Check for subscriptions expiring in 3 days — send warning
            try:
                from app.core.db import get_session
                from app.core.models import UserSubscription, User
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
                                        f"⏰ *Subscription Expiring Soon*\n\n"
                                        f"Your plan expires in *{days_left} days*.\n"
                                        f"Use /renew to continue your service."
                                    ),
                                    parse_mode="Markdown",
                                )
                            except Exception:
                                pass
                session.close()
            except Exception as e:
                logger.warning(f"expiry_warning_failed: {e}")
```

> **Note**: Add `from datetime import timedelta` to imports in main.py if not already present. Also add `import os` if needed.

---

## Verification

```bash
# 1. Model check
cd backend && python -c "
from app.core.models import SubscriptionPlan
print('max_devices' in [c.name for c in SubscriptionPlan.__table__.columns])
"

# 2. Subscription service check
cd backend && python -c "
from app.services.subscription_service import SubscriptionService
print(hasattr(SubscriptionService, 'expire_overdue'))
"

# 3. Telegram bot check
cd backend && python -c "from app.services.telegram_bot import *; print('OK')"
```

---

## Summary of Changes

| File | Change |
|------|--------|
| `models.py` | +3 columns on `SubscriptionPlan` + update `to_dict()` |
| `migrations/versions/...` | [NEW] Alembic migration for plan entitlement columns |
| `subscription_service.py` | +3 params on `create_plan()`, +1 new method `expire_overdue()` |
| `subscriptions.py` | Pass new fields in `create_plan` route |
| `payments.py` | Copy `allowed_services` to key entitlements on approve |
| `user_key_service.py` | Replace hardcoded 1-device with plan-based `max_devices` |
| `main.py` | +~40 lines — expiry scheduler + warnings |
| `telegram_bot.py` | +~30 lines — `/renew` command handler |
