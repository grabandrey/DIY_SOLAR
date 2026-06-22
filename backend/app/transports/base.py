"""Transport abstraction.

A transport is the physical link to a device. Drivers send a command and get raw bytes
back without caring whether the wire underneath is a USB serial adapter, a raw HID
device, TCP, or a mock for testing. Adding a new link type = adding a new Transport.
"""

from __future__ import annotations

import abc
import asyncio
from typing import Any, Dict


class Transport(abc.ABC):
    @abc.abstractmethod
    async def open(self) -> None:
        ...

    @abc.abstractmethod
    async def close(self) -> None:
        ...

    @abc.abstractmethod
    async def query(self, payload: bytes, *, expect_terminator: bytes = b"\r") -> bytes:
        """Write ``payload`` and read a response up to ``expect_terminator``."""
        ...


def build_transport(config: Dict[str, Any]) -> Transport:
    """Factory: build a transport from a config dict.

    Imports are local so the app can run even if an optional dependency (e.g. pyserial)
    is missing for a transport type that isn't being used.
    """

    ttype = config.get("type", "serial")
    if ttype == "serial":
        from .serial_transport import SerialTransport

        return SerialTransport(**config.get("params", {}))
    if ttype == "hidraw":
        from .hidraw_transport import HidRawTransport

        return HidRawTransport(**config.get("params", {}))
    if ttype == "tcp":
        from .tcp_transport import TcpTransport

        return TcpTransport(**config.get("params", {}))
    if ttype == "mock":
        from .mock_transport import MockTransport

        return MockTransport(**config.get("params", {}))
    raise ValueError(f"Unknown transport type: {ttype!r}")
