"""Add trust metadata fields to messages

Revision ID: 002_message_trust
Revises: 001_initial
Create Date: 2026-03-06 00:00:00.000000
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "002_message_trust"
down_revision: str | None = "001_initial"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("messages", sa.Column("answerable", sa.Boolean(), nullable=True))
    op.add_column("messages", sa.Column("confidence", sa.String(), nullable=True))
    op.add_column("messages", sa.Column("citation_status", sa.String(), nullable=True))
    op.add_column("messages", sa.Column("answerability_reason", sa.Text(), nullable=True))
    op.add_column("messages", sa.Column("citations", sa.JSON(), nullable=True))


def downgrade() -> None:
    op.drop_column("messages", "citations")
    op.drop_column("messages", "answerability_reason")
    op.drop_column("messages", "citation_status")
    op.drop_column("messages", "confidence")
    op.drop_column("messages", "answerable")
