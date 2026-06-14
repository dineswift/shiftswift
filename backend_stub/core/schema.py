"""Schema introspection — tolerate databases before all migrations are applied."""

from __future__ import annotations

from typing import Any

_schema_cache: dict[str, frozenset[str]] = {}


def table_columns(conn: Any, table_name: str) -> frozenset[str]:
    cached = _schema_cache.get(table_name)
    if cached is not None:
        return cached
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT column_name
            FROM information_schema.columns
            WHERE table_schema = current_schema()
              AND table_name = %s
            """,
            (table_name,),
        )
        cols = frozenset(str(row[0]) for row in cur.fetchall())
    _schema_cache[table_name] = cols
    return cols


def clear_schema_cache() -> None:
    _schema_cache.clear()


def column_expr(
    conn: Any,
    *,
    table: str,
    column: str,
    alias: str | None = "e",
    null_sql: str | None = None,
) -> str:
    """Return `alias.column` or a typed NULL placeholder when the column is missing."""
    if column in table_columns(conn, table):
        return f"{alias}.{column}" if alias else column
    if null_sql:
        return null_sql
    return f"NULL AS {column}"
