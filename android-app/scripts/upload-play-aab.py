#!/usr/bin/env python3
"""Upload an Android App Bundle to Google Play (internal / alpha / beta / production)."""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

from google.oauth2 import service_account
from googleapiclient.discovery import build
from googleapiclient.http import MediaFileUpload


SCOPES = ["https://www.googleapis.com/auth/androidpublisher"]


def main() -> int:
    parser = argparse.ArgumentParser(description="Upload AAB to Google Play Console")
    parser.add_argument("--aab", required=True, type=Path)
    parser.add_argument("--package", required=True)
    parser.add_argument("--track", default="internal")
    parser.add_argument("--credentials", required=True, type=Path)
    args = parser.parse_args()

    if not args.aab.is_file():
        print(f"AAB not found: {args.aab}", file=sys.stderr)
        return 1
    if not args.credentials.is_file():
        print(f"Credentials not found: {args.credentials}", file=sys.stderr)
        return 1

    creds = service_account.Credentials.from_service_account_file(
        str(args.credentials),
        scopes=SCOPES,
    )
    service = build("androidpublisher", "v3", credentials=creds, cache_discovery=False)
    edit = service.edits().insert(body={}, packageName=args.package).execute()
    edit_id = edit["id"]

    media = MediaFileUpload(str(args.aab), mimetype="application/octet-stream", resumable=True)
    bundle = (
        service.edits()
        .bundles()
        .upload(editId=edit_id, packageName=args.package, media_body=media)
        .execute()
    )
    version_code = bundle["versionCode"]

    service.edits().tracks().update(
        editId=edit_id,
        packageName=args.package,
        track=args.track,
        body={"releases": [{"versionCodes": [str(version_code)], "status": "completed"}]},
    ).execute()

    service.edits().commit(editId=edit_id, packageName=args.package).execute()
    print(f"Uploaded versionCode {version_code} to track '{args.track}'")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
