"""add_plan_entitlements

Revision ID: c3f4a9d8e2b1
Revises: b2c3d4e5f678
Create Date: 2026-05-19 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'c3f4a9d8e2b1'
down_revision: Union[str, Sequence[str], None] = 'b2c3d4e5f678'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('subscription_plans', sa.Column('max_devices', sa.Integer(), server_default='1', nullable=False))
    op.add_column('subscription_plans', sa.Column('allowed_services', sa.JSON(), nullable=True))
    op.add_column('subscription_plans', sa.Column('rate_limit_rpm', sa.Integer(), server_default='60', nullable=False))


def downgrade() -> None:
    op.drop_column('subscription_plans', 'rate_limit_rpm')
    op.drop_column('subscription_plans', 'allowed_services')
    op.drop_column('subscription_plans', 'max_devices')
