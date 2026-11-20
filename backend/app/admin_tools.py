"""Explicit operator bootstrap and read-only ownership inspection.

Run only against a deliberately selected database after taking a backup.
"""

import argparse
import json

from sqlalchemy import select

from app.config import Settings
from app.database import database
from app.legacy_claims import profile_report
from app.legacy_models import SecurityEvent
from app.models import Account, Profile


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)
    bootstrap = sub.add_parser("bootstrap-admin")
    bootstrap.add_argument("--subject", required=True)
    bootstrap.add_argument("--apply", action="store_true")
    sub.add_parser("legacy-report")
    args = parser.parse_args()
    engine, sessions = database(Settings().database_url)
    try:
        with sessions.begin() as db:
            if args.command == "legacy-report":
                rows = db.scalars(
                    select(Profile).where(Profile.is_legacy.is_(True))
                ).all()
                report = []
                for profile in rows:
                    owner = db.scalar(
                        select(Account.id).where(Account.profile_id == profile.id)
                    )
                    report.append(
                        {
                            "profile_id": str(profile.id),
                            "display_name": profile.display_name,
                            "claimed": owner is not None,
                            **profile_report(db, profile.id),
                        }
                    )
                print(json.dumps(report, indent=2, ensure_ascii=False))
                return
            account = db.scalar(
                select(Account)
                .where(Account.provider_subject == args.subject)
                .with_for_update()
            )
            if account is None:
                parser.error(
                    "No account for that subject. "
                    "Sign in first; never guess an identity."
                )
            existing = db.scalars(select(Account).where(Account.role == "admin")).all()
            if existing and account.role != "admin":
                parser.error(
                    "An administrator already exists. "
                    "Use the authenticated role-management interface."
                )
            print(
                json.dumps(
                    {
                        "account_id": str(account.id),
                        "profile_id": str(account.profile_id),
                        "current_role": account.role,
                        "proposed_role": "admin",
                        "apply": args.apply,
                    },
                    indent=2,
                )
            )
            if args.apply:
                # Serialize operator bootstrap without a permanent privileged login.
                # An advisory transaction lock is local to the bootstrap operation.
                from sqlalchemy import text

                db.execute(text("SELECT pg_advisory_xact_lock(742195104)"))
                existing = db.scalars(
                    select(Account).where(Account.role == "admin")
                ).all()
                if existing and account.role != "admin":
                    parser.error(
                        "Another bootstrap created an administrator; no change made."
                    )
                account.role = "admin"
                db.add(
                    SecurityEvent(
                        actor_account_id=account.id,
                        event="administrator_bootstrapped",
                        resource_id=str(account.id),
                    )
                )
    finally:
        engine.dispose()


if __name__ == "__main__":
    main()
