#!/usr/bin/env python3
"""Opt-in non-truncation probe using only disposable provider identities.

Run from backend with its installed dependencies. No Lexi database, email sending,
custom hashing or real credentials. Core URI/key come from protected job variables.
"""

import argparse
import asyncio
import json
import os
from urllib.parse import urlsplit
from uuid import uuid4


def configuration():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--allow-synthetic-core-writes", action="store_true", required=True
    )
    parser.parse_args()
    uri = os.environ.get("LEXI_CORE_PROBE_URI", "")
    key = os.environ.get("LEXI_CORE_PROBE_KEY", "")
    parsed = urlsplit(uri)
    if not key or not (
        parsed.scheme == "https"
        or (parsed.scheme == "http" and parsed.hostname in {"127.0.0.1", "localhost"})
    ):
        raise ValueError("Protected Core URI/key are required; HTTPS except loopback")
    return uri, key


async def probe(uri, key):
    from supertokens_python import InputAppInfo, SupertokensConfig, init
    from supertokens_python.asyncio import delete_user
    from supertokens_python.recipe import emailpassword
    from supertokens_python.recipe.emailpassword.asyncio import sign_in, sign_up
    from supertokens_python.recipe.emailpassword.interfaces import (
        SignUpOkResult,
        SignInOkResult,
        WrongCredentialsError,
    )

    init(
        app_info=InputAppInfo(
            app_name="Lexi synthetic hashing probe",
            api_domain="http://localhost",
            website_domain="http://localhost",
        ),
        supertokens_config=SupertokensConfig(connection_uri=uri, api_key=key),
        framework="fastapi",
        mode="asgi",
        recipe_list=[emailpassword.init()],
    )
    identities = []
    try:
        for name, password in [
            ("minimum_ascii", "A" * 14 + "Z"),
            ("maximum_ascii", "A" * 127 + "Z"),
            ("maximum_unicode", "α" * 40 + "A" * 87 + "Z"),
        ]:
            assert 15 <= len(password) <= 128
            email = "lexi-hash-probe-" + uuid4().hex + "@example.invalid"
            created = await sign_up("public", email, password)
            if not isinstance(created, SignUpOkResult):
                raise RuntimeError("synthetic_signup_failed")
            identities.append(created.user.id)
            correct = await sign_in("public", email, password)
            incorrect = await sign_in("public", email, password[:-1] + "Y")
            passed = isinstance(correct, SignInOkResult) and isinstance(
                incorrect, WrongCredentialsError
            )
            print(
                json.dumps(
                    {
                        "check": name,
                        "characters": len(password),
                        "utf8_bytes": len(password.encode()),
                        "result": "PASS" if passed else "FAIL",
                    }
                ),
                flush=True,
            )
            if not passed:
                raise RuntimeError("password_nontruncation_failed")
    finally:
        failures = 0
        for subject in identities:
            try:
                await delete_user(subject)
            except Exception:
                failures += 1
        print(
            json.dumps(
                {
                    "synthetic_cleanup": "PASS" if not failures else "FAIL",
                    "created": len(identities),
                    "cleanup_failures": failures,
                }
            ),
            flush=True,
        )
        if failures:
            raise RuntimeError("synthetic_cleanup_failed")


if __name__ == "__main__":
    try:
        asyncio.run(probe(*configuration()))
    except Exception as error:
        # Provider exceptions can contain identifiers/credentials. Never print them.
        print(
            json.dumps({"result": "FAIL", "error_type": type(error).__name__}),
            flush=True,
        )
        raise SystemExit(1) from None
