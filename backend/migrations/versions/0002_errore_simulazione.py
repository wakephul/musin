"""Motivo del fallimento di una simulazione

Revision ID: 0002
Revises: 0001
"""
from alembic import op
import sqlalchemy as sa

revision = "0002"
down_revision = "0001"


def upgrade() -> None:
    op.add_column("simulations", sa.Column("error_message", sa.Text, nullable=True))


def downgrade() -> None:
    op.drop_column("simulations", "error_message")
