#!/usr/bin/env python3
"""Static file server with security headers for local/production frontend."""

from __future__ import annotations

import argparse
import os
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer


class SecureStaticHandler(SimpleHTTPRequestHandler):
    def end_headers(self) -> None:
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("X-Frame-Options", "DENY")
        self.send_header("Referrer-Policy", "strict-origin-when-cross-origin")
        self.send_header("Permissions-Policy", "camera=(), microphone=(), geolocation=(self)")
        if os.getenv("FORCE_HTTPS", "").lower() in {"1", "true", "yes"}:
            self.send_header("Strict-Transport-Security", "max-age=31536000; includeSubDomains")
        super().end_headers()


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--port", type=int, default=int(os.getenv("FRONTEND_PORT", "5173")))
    parser.add_argument("--directory", default=".")
    args = parser.parse_args()

    handler = partial(SecureStaticHandler, directory=args.directory)
    server = ThreadingHTTPServer(("127.0.0.1", args.port), handler)
    print(f"Serving {args.directory} on http://127.0.0.1:{args.port}")
    server.serve_forever()


if __name__ == "__main__":
    main()
