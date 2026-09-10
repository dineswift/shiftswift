#!/usr/bin/env python3
"""Static file server for SwiftHelp frontend."""

from __future__ import annotations

import argparse
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--port", type=int, default=5380)
    parser.add_argument("--directory", default=".")
    args = parser.parse_args()
    handler = partial(SimpleHTTPRequestHandler, directory=args.directory)
    server = ThreadingHTTPServer(("127.0.0.1", args.port), handler)
    print(f"SwiftHelp frontend http://127.0.0.1:{args.port}")
    server.serve_forever()


if __name__ == "__main__":
    main()
