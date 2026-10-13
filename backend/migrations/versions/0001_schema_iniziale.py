"""Schema iniziale

Revision ID: 0001
Revises:
"""
from alembic import op
import sqlalchemy as sa

revision = "0001"
down_revision = None

STATUSES = ("PENDING", "RUNNING", "COMPLETED", "FAILED", "ABORTED")


def _timestamps():
    return (
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )


def upgrade() -> None:
    # Le installazioni nate prima delle migrazioni hanno già queste tabelle
    # (create da Base.metadata.create_all): in quel caso non c'è nulla da fare.
    if sa.inspect(op.get_bind()).has_table("users"):
        return

    op.create_table(
        "users",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("email", sa.String(255), nullable=False),
        sa.Column("hashed_password", sa.String(255), nullable=False),
        sa.Column("is_active", sa.Boolean, nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_users_id", "users", ["id"])
    op.create_index("ix_users_email", "users", ["email"], unique=True)

    op.create_table(
        "networks",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("description", sa.Text),
        sa.Column("definition", sa.JSON, nullable=False),
        sa.Column("parent_id", sa.Integer, sa.ForeignKey("networks.id", ondelete="SET NULL")),
        sa.Column("owner_id", sa.Integer, sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        *_timestamps(),
    )
    op.create_index("ix_networks_id", "networks", ["id"])
    op.create_index("ix_networks_name", "networks", ["name"])

    op.create_table(
        "stimuli",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("description", sa.Text),
        sa.Column("file_path", sa.String(512)),
        sa.Column("definition", sa.JSON),
        sa.Column("parent_id", sa.Integer, sa.ForeignKey("stimuli.id", ondelete="SET NULL")),
        sa.Column("owner_id", sa.Integer, sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        *_timestamps(),
    )
    op.create_index("ix_stimuli_id", "stimuli", ["id"])
    op.create_index("ix_stimuli_name", "stimuli", ["name"])

    op.create_table(
        "simulations",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("network_id", sa.Integer, sa.ForeignKey("networks.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("stimulus_id", sa.Integer, sa.ForeignKey("stimuli.id", ondelete="SET NULL")),
        sa.Column("owner_id", sa.Integer, sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("duration_ms", sa.Float, nullable=False),
        sa.Column("experiment_params", sa.JSON, nullable=False),
        sa.Column("status", sa.Enum(*STATUSES, name="simulationstatus"), nullable=False),
        sa.Column("celery_task_id", sa.String(255)),
        sa.Column("results_path", sa.String(512)),
        *_timestamps(),
    )
    op.create_index("ix_simulations_id", "simulations", ["id"])
    op.create_index("ix_simulations_name", "simulations", ["name"])
    op.create_index("ix_simulations_celery_task_id", "simulations", ["celery_task_id"], unique=True)


def downgrade() -> None:
    for table in ("simulations", "stimuli", "networks", "users"):
        op.drop_table(table)
