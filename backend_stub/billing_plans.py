"""Load subscription plans from database (editable) with code fallback."""

from __future__ import annotations

import json
import os
from dataclasses import dataclass
from typing import Any

from billing_config import PLANS as DEFAULT_PLANS


@dataclass(frozen=True)
class SubscriptionPlan:
    id: str
    name: str
    description: str
    stripe_price_id_env: str
    billing_interval: str
    max_employees: int
    price_gbp_ex_vat: float
    features: tuple[str, ...]
    stripe_price_id: str | None = None
    base_price_gbp_ex_vat: float | None = None
    price_per_active_employee_gbp_ex_vat: float = 0.0
    monthly_cap_gbp_ex_vat: float | None = None
    stripe_seat_price_id_env: str = ""
    stripe_seat_price_id: str | None = None
    level_label: str = ""


def _db_conn() -> Any:
    import psycopg2

    url = os.getenv("DATABASE_URL")
    if not url:
        return None
    return psycopg2.connect(url)


def _row_to_plan(row: tuple) -> SubscriptionPlan:
    if len(row) >= 13:
        (
            plan_id,
            name,
            description,
            interval,
            max_emp,
            price,
            features,
            env_key,
            stripe_price,
            base_price,
            per_head,
            monthly_cap,
            seat_env,
            seat_price,
        ) = row
    else:
        plan_id, name, description, interval, max_emp, price, features, env_key, stripe_price = row
        base_price, per_head, monthly_cap, seat_env, seat_price = None, 0, None, "", None
    if isinstance(features, str):
        feature_list = json.loads(features)
    else:
        feature_list = features or []
    return SubscriptionPlan(
        id=plan_id,
        name=name,
        description=description or "",
        stripe_price_id_env=env_key or "",
        billing_interval=interval,
        max_employees=int(max_emp),
        price_gbp_ex_vat=float(price),
        features=tuple(feature_list),
        stripe_price_id=stripe_price,
        base_price_gbp_ex_vat=float(base_price) if base_price is not None else None,
        price_per_active_employee_gbp_ex_vat=float(per_head or 0),
        monthly_cap_gbp_ex_vat=float(monthly_cap) if monthly_cap is not None else None,
        stripe_seat_price_id_env=seat_env or "",
        stripe_seat_price_id=seat_price,
    )


def list_plans_from_db(active_only: bool = True) -> list[SubscriptionPlan]:
    conn = _db_conn()
    if not conn:
        return []
    try:
        with conn.cursor() as cur:
            sql = """
                SELECT id, name, description, billing_interval, max_employees,
                       price_gbp_ex_vat, features, stripe_price_id_env, stripe_price_id,
                       base_price_gbp_ex_vat, price_per_active_employee_gbp_ex_vat,
                       monthly_cap_gbp_ex_vat, stripe_seat_price_id_env, stripe_seat_price_id
                FROM subscription_plans
            """
            if active_only:
                sql += " WHERE is_active = TRUE"
            sql += " ORDER BY sort_order ASC, price_gbp_ex_vat ASC"
            cur.execute(sql)
            rows = cur.fetchall()
        return [_row_to_plan(row) for row in rows]
    except Exception:
        return []
    finally:
        conn.close()


def get_plan(plan_id: str) -> SubscriptionPlan | None:
    conn = _db_conn()
    if conn:
        try:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    SELECT id, name, description, billing_interval, max_employees,
                           price_gbp_ex_vat, features, stripe_price_id_env, stripe_price_id,
                           base_price_gbp_ex_vat, price_per_active_employee_gbp_ex_vat,
                           monthly_cap_gbp_ex_vat, stripe_seat_price_id_env, stripe_seat_price_id
                    FROM subscription_plans
                    WHERE id = %s AND is_active = TRUE
                    """,
                    (plan_id,),
                )
                row = cur.fetchone()
                if row:
                    return _row_to_plan(row)
        except Exception:
            pass
        finally:
            conn.close()

    for plan in DEFAULT_PLANS:
        if plan.id == plan_id:
            return SubscriptionPlan(
                id=plan.id,
                name=plan.name,
                description=plan.description,
                stripe_price_id_env=plan.stripe_price_id_env,
                billing_interval=plan.billing_interval,
                max_employees=plan.max_employees,
                price_gbp_ex_vat=plan.price_gbp_ex_vat,
                features=plan.features,
                base_price_gbp_ex_vat=plan.base_price_gbp_ex_vat,
                price_per_active_employee_gbp_ex_vat=plan.price_per_active_employee_gbp_ex_vat,
                monthly_cap_gbp_ex_vat=plan.monthly_cap_gbp_ex_vat,
                stripe_seat_price_id_env=plan.stripe_seat_price_id_env,
                level_label=getattr(plan, "level_label", "") or "",
            )
    return None


def list_plans() -> list[SubscriptionPlan]:
    db_plans = list_plans_from_db()
    if db_plans:
        return db_plans
    return [
        SubscriptionPlan(
            id=plan.id,
            name=plan.name,
            description=plan.description,
            stripe_price_id_env=plan.stripe_price_id_env,
            billing_interval=plan.billing_interval,
            max_employees=plan.max_employees,
            price_gbp_ex_vat=plan.price_gbp_ex_vat,
            features=plan.features,
            base_price_gbp_ex_vat=plan.base_price_gbp_ex_vat,
            price_per_active_employee_gbp_ex_vat=plan.price_per_active_employee_gbp_ex_vat,
            monthly_cap_gbp_ex_vat=plan.monthly_cap_gbp_ex_vat,
            stripe_seat_price_id_env=plan.stripe_seat_price_id_env,
            level_label=getattr(plan, "level_label", "") or "",
        )
        for plan in DEFAULT_PLANS
    ]


def resolve_stripe_price_id(plan: SubscriptionPlan) -> str | None:
    if plan.stripe_price_id:
        return plan.stripe_price_id
    if plan.stripe_price_id_env:
        return os.getenv(plan.stripe_price_id_env) or None
    return None


def resolve_stripe_seat_price_id(plan: SubscriptionPlan) -> str | None:
    if plan.stripe_seat_price_id:
        return plan.stripe_seat_price_id
    if plan.stripe_seat_price_id_env:
        return os.getenv(plan.stripe_seat_price_id_env) or None
    return None
