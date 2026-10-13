"""Campagne di simulazioni e set di riferimento

Revision ID: 0004
Revises: 0003
"""
from alembic import op
import sqlalchemy as sa

revision = "0004"
down_revision = "0003"


def upgrade() -> None:
    op.create_table(
        "campaigns",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("network_id", sa.Integer, sa.ForeignKey("networks.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("owner_id", sa.Integer, sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("params", sa.JSON, nullable=False),
        sa.Column("seeds", sa.JSON, nullable=False),
        sa.Column("sweep", sa.JSON, nullable=True),
        sa.Column("reference", sa.String(64), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_campaigns_id", "campaigns", ["id"])

    op.create_table(
        "reference_sets",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("owner_id", sa.Integer, sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("conditions", sa.JSON, nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_reference_sets_id", "reference_sets", ["id"])

    # batch: SQLite (usato dai test) non aggiunge chiavi esterne con ALTER TABLE.
    with op.batch_alter_table("simulations") as batch:
        batch.add_column(sa.Column("campaign_id", sa.Integer, nullable=True))
        batch.create_index("ix_simulations_campaign_id", ["campaign_id"])
        batch.create_foreign_key("fk_simulations_campaign_id", "campaigns", ["campaign_id"], ["id"], ondelete="CASCADE")


def downgrade() -> None:
    with op.batch_alter_table("simulations") as batch:
        batch.drop_constraint("fk_simulations_campaign_id", type_="foreignkey")
        batch.drop_index("ix_simulations_campaign_id")
        batch.drop_column("campaign_id")
    op.drop_table("reference_sets")
    op.drop_table("campaigns")
