"""wait-api-health.sh treats 307 to /health as up (FORCE_HTTPS on loopback)."""

from __future__ import annotations

import os
import socket
import subprocess
import threading
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
WAIT_SCRIPT = REPO / "deploy" / "cloudpanel" / "wait-api-health.sh"


class _RedirectHealth(BaseHTTPRequestHandler):
    def do_GET(self) -> None:
        if self.path.startswith("/health"):
            self.send_response(307)
            self.send_header("Location", f"https://127.0.0.1:{self.server.server_address[1]}/health")
            self.send_header("Content-Length", "0")
            self.end_headers()
            return
        self.send_response(404)
        self.end_headers()

    def log_message(self, format: str, *args) -> None:  # noqa: A003
        return


class _OkHealth(BaseHTTPRequestHandler):
    def do_GET(self) -> None:
        body = b'{"status":"ok"}'
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, format: str, *args) -> None:  # noqa: A003
        return


class _BusyHealth(BaseHTTPRequestHandler):
    def do_GET(self) -> None:
        self.send_response(503)
        self.send_header("Content-Length", "0")
        self.end_headers()

    def log_message(self, format: str, *args) -> None:  # noqa: A003
        return


def _serve(handler: type[BaseHTTPRequestHandler]) -> tuple[HTTPServer, threading.Thread, int]:
    sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    sock.bind(("127.0.0.1", 0))
    port = sock.getsockname()[1]
    sock.close()
    server = HTTPServer(("127.0.0.1", port), handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    return server, thread, port


def _run_wait(url: str) -> subprocess.CompletedProcess[str]:
    env = os.environ.copy()
    env["SHIFTSWIFT_HEALTH_URL"] = url
    env["SHIFTSWIFT_HEALTH_ATTEMPTS"] = "2"
    env["SHIFTSWIFT_HEALTH_SLEEP"] = "0"
    env["SHIFTSWIFT_SKIP_JOURNAL"] = "1"
    return subprocess.run(
        ["bash", str(WAIT_SCRIPT)],
        check=False,
        capture_output=True,
        text=True,
        env=env,
    )


def test_wait_script_treats_307_to_health_as_up() -> None:
    server, _thread, port = _serve(_RedirectHealth)
    try:
        result = _run_wait(f"http://127.0.0.1:{port}/health")
    finally:
        server.shutdown()
        server.server_close()
    assert result.returncode == 0, result.stdout + result.stderr
    assert "API is up" in result.stdout
    assert "307" in result.stdout
    assert "FORCE_HTTPS" in result.stdout


def test_wait_script_treats_200_as_up() -> None:
    server, _thread, port = _serve(_OkHealth)
    try:
        result = _run_wait(f"http://127.0.0.1:{port}/health")
    finally:
        server.shutdown()
        server.server_close()
    assert result.returncode == 0, result.stdout + result.stderr
    assert "HTTP 200" in result.stdout
    assert "API is up" in result.stdout


def test_wait_script_treats_503_as_down() -> None:
    server, _thread, port = _serve(_BusyHealth)
    try:
        result = _run_wait(f"http://127.0.0.1:{port}/health")
    finally:
        server.shutdown()
        server.server_close()
    assert result.returncode == 1, result.stdout + result.stderr
    assert "HTTP 503" in result.stdout
    assert "Frontend rsync skipped" in result.stdout
