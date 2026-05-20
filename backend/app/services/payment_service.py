"""Payment management service — records, approval, rejection."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Optional

from sqlalchemy.orm import Session

from app.core.models import PaymentRecord


class PaymentService:
    """Manages payment records and approval workflow."""

    def __init__(self, session_factory):
        self._session_factory = session_factory

    def _session(self) -> Session:
        return self._session_factory()

    def create_payment(
        self,
        user_id: int,
        amount: int,
        payment_method: str = "upi",
        upi_reference: str | None = None,
        payer_name: str | None = None,
        payment_screenshot_path: str | None = None,
        payment_note: str = "",
        subscription_id: int | None = None,
        plan_id: int | None = None,
        payment_ref: str | None = None,
        upi_id_used: str | None = None,
        payee_name_used: str | None = None,
        telegram_user_id: str | None = None,
    ) -> PaymentRecord:
        session = self._session()
        try:
            from datetime import timedelta
            now = datetime.now(timezone.utc)
            payment = PaymentRecord(
                user_id=user_id,
                subscription_id=subscription_id,
                plan_id=plan_id,
                telegram_user_id=telegram_user_id,
                payment_method=payment_method,
                amount=amount,
                upi_reference=upi_reference,
                payer_name=payer_name,
                payment_screenshot_path=payment_screenshot_path,
                payment_note=payment_note,
                payment_ref=payment_ref,
                upi_id_used=upi_id_used,
                payee_name_used=payee_name_used,
                status="pending_payment",
                submitted_at=now,
                expires_at=now + timedelta(hours=24),
            )
            session.add(payment)
            session.commit()
            session.refresh(payment)
            return payment
        except Exception:
            session.rollback()
            raise
        finally:
            session.close()

    def get_payment(self, payment_id: int) -> PaymentRecord | None:
        session = self._session()
        try:
            return session.query(PaymentRecord).filter(PaymentRecord.id == payment_id).first()
        finally:
            session.close()

    def list_payments(
        self,
        status: str | None = None,
        user_id: int | None = None,
        offset: int = 0,
        limit: int = 50,
    ) -> tuple[list[PaymentRecord], int]:
        session = self._session()
        try:
            q = session.query(PaymentRecord)
            if status:
                q = q.filter(PaymentRecord.status == status)
            if user_id:
                q = q.filter(PaymentRecord.user_id == user_id)
            total = q.count()
            payments = q.order_by(PaymentRecord.created_at.desc()).offset(offset).limit(limit).all()
            return payments, total
        finally:
            session.close()

    def approve_payment(
        self,
        payment_id: int,
        verified_by_admin_id: int | None = None,
    ) -> PaymentRecord | None:
        session = self._session()
        try:
            payment = session.query(PaymentRecord).filter(PaymentRecord.id == payment_id).first()
            if not payment:
                return None
            now = datetime.now(timezone.utc)
            payment.status = "approved"
            payment.verified_by_admin_id = verified_by_admin_id
            payment.verified_at = now
            payment.updated_at = now
            session.commit()
            session.refresh(payment)
            return payment
        except Exception:
            session.rollback()
            raise
        finally:
            session.close()

    def reject_payment(
        self,
        payment_id: int,
        rejection_reason: str = "",
        verified_by_admin_id: int | None = None,
    ) -> PaymentRecord | None:
        session = self._session()
        try:
            payment = session.query(PaymentRecord).filter(PaymentRecord.id == payment_id).first()
            if not payment:
                return None
            now = datetime.now(timezone.utc)
            payment.status = "rejected"
            payment.rejection_reason = rejection_reason
            payment.verified_by_admin_id = verified_by_admin_id
            payment.verified_at = now
            payment.updated_at = now
            session.commit()
            session.refresh(payment)
            return payment
        except Exception:
            session.rollback()
            raise
        finally:
            session.close()

    def get_pending_count(self) -> int:
        session = self._session()
        try:
            return session.query(PaymentRecord).filter(
                PaymentRecord.status.in_([
                    "pending_payment", "screenshot_submitted", "ready_for_admin_approval",
                    "ocr_processing", "ocr_matched", "ocr_mismatch"
                ])
            ).count()
        finally:
            session.close()

    def get_user_payments(self, user_id: int) -> list[PaymentRecord]:
        session = self._session()
        try:
            return (
                session.query(PaymentRecord)
                .filter(PaymentRecord.user_id == user_id)
                .order_by(PaymentRecord.created_at.desc())
                .all()
            )
        finally:
            session.close()
