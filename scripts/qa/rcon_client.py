"""Minimal Minecraft RCON client (TCP, little-endian int32 packets)."""

from __future__ import annotations

import socket
import struct
import time
from dataclasses import dataclass
from typing import Optional


RCON_AUTH = 3
RCON_AUTH_RESPONSE = 2
RCON_COMMAND = 2
RCON_RESPONSE = 0


@dataclass
class RconConfig:
    host: str = "127.0.0.1"
    port: int = 25575
    password: str = ""
    timeout: float = 8.0


class RconError(RuntimeError):
    pass


class RconClient:
    def __init__(self, config: RconConfig) -> None:
        self.config = config
        self._sock: Optional[socket.socket] = None
        self._req_id = 0

    def __enter__(self) -> "RconClient":
        self.connect()
        return self

    def __exit__(self, exc_type, exc, tb) -> None:
        self.close()

    def connect(self) -> None:
        if self._sock:
            return
        sock = socket.create_connection(
            (self.config.host, self.config.port), timeout=self.config.timeout
        )
        self._sock = sock
        self._authenticate()

    def close(self) -> None:
        if self._sock:
            try:
                self._sock.close()
            finally:
                self._sock = None

    def command(self, cmd: str, retries: int = 2) -> str:
        last_err: Optional[Exception] = None
        for attempt in range(retries + 1):
            try:
                if not self._sock:
                    self.connect()
                return self._send_command(cmd)
            except (socket.error, RconError, struct.error) as exc:
                last_err = exc
                self.close()
                if attempt < retries:
                    time.sleep(0.5)
        raise RconError(f"RCON command failed after retries: {cmd!r}") from last_err

    def _authenticate(self) -> None:
        assert self._sock is not None
        req_id = self._next_id()
        self._send_packet(req_id, RCON_AUTH, self.config.password)
        authed = False
        deadline = time.time() + self.config.timeout
        while time.time() < deadline:
            resp_id, resp_type, _body = self._read_packet()
            if resp_type == RCON_AUTH_RESPONSE:
                if resp_id == -1:
                    raise RconError("RCON authentication failed (check enable-rcon + password)")
                authed = True
                break
        if not authed:
            raise RconError("RCON authentication timed out")

    def _send_command(self, cmd: str) -> str:
        req_id = self._next_id()
        self._send_packet(req_id, RCON_COMMAND, cmd)
        parts: list[str] = []
        deadline = time.time() + self.config.timeout
        while time.time() < deadline:
            resp_id, resp_type, body = self._read_packet()
            if resp_id != req_id:
                continue
            if body:
                parts.append(body)
            if resp_type == RCON_RESPONSE:
                break
        else:
            raise RconError(f"RCON command timed out: {cmd!r}")
        return "".join(parts).strip()

    def _next_id(self) -> int:
        self._req_id = (self._req_id + 1) & 0x7FFFFFFF
        return self._req_id

    def _send_packet(self, req_id: int, req_type: int, payload: str) -> None:
        assert self._sock is not None
        body = payload.encode("utf-8") + b"\x00\x00"
        packet = struct.pack("<ii", req_id, req_type) + body
        packet = struct.pack("<i", len(packet)) + packet
        self._sock.sendall(packet)

    def _read_packet(self) -> tuple[int, int, str]:
        assert self._sock is not None
        raw_len = self._recv_exact(4)
        (length,) = struct.unpack("<i", raw_len)
        if length < 10:
            raise RconError(f"Invalid RCON packet length: {length}")
        data = self._recv_exact(length)
        req_id, req_type = struct.unpack("<ii", data[:8])
        body = data[8:-2].decode("utf-8", errors="replace")
        return req_id, req_type, body

    def _recv_exact(self, n: int) -> bytes:
        assert self._sock is not None
        chunks: list[bytes] = []
        got = 0
        while got < n:
            part = self._sock.recv(n - got)
            if not part:
                raise RconError("RCON connection closed unexpectedly")
            chunks.append(part)
            got += len(part)
        return b"".join(chunks)


def smoke_test(config: RconConfig) -> dict:
    """Run list + noop; return {ok, list_output, error}."""
    result = {"ok": False, "list_output": "", "error": None}
    try:
        with RconClient(config) as client:
            result["list_output"] = client.command("list")
            result["ok"] = True
    except Exception as exc:  # noqa: BLE001 — QA smoke wrapper
        result["error"] = str(exc)
    return result
