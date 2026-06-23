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

    async def transact(self, payload: bytes, *, read_bytes: int, timeout: float | None = None) -> bytes:
        """Write ``payload`` and read exactly ``read_bytes`` back.

        For length-framed protocols (e.g. Modbus-RTU) that have no terminator byte. A
        per-call ``timeout`` overrides the transport default (used for fast device probes).
        Transports that can't do fixed-length reads raise NotImplementedError.
        """
        raise NotImplementedError(f"{type(self).__name__} does not support fixed-length reads")

    async def transact_framed(
        self,
        payload: bytes,
        *,
        header_len: int,
        frame_len,
        timeout: float | None = None,
    ) -> bytes:
        """Write ``payload``, read ``header_len`` bytes, then read the rest of the frame.

        ``frame_len(header)`` returns the total frame length from the header. For protocols
        whose reply length is encoded in a header field (e.g. JK-BMS). Returns the full frame.
        """
        raise NotImplementedError(f"{type(self).__name__} does not support framed reads")

    async def collect(self, payload: bytes, *, duration: float, max_bytes: int = 65536, until=None) -> bytes:
        """Write ``payload``, then read whatever arrives for up to ``duration`` seconds.

        For devices that stream at their own pace (e.g. JK-BMS broadcasts) where a fixed-size
        read would time out. Stops early when ``until(buf)`` returns True (e.g. a full data
        cycle captured) or ``max_bytes`` is reached. Returns the accumulated bytes.
        """
        raise NotImplementedError(f"{type(self).__name__} does not support streaming reads")


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
    if ttype == "tunnel":
        from .tunnel_transport import TunnelTransport

        return TunnelTransport(**config.get("params", {}))
    if ttype == "mock":
        from .mock_transport import MockTransport

        return MockTransport(**config.get("params", {}))
    raise ValueError(f"Unknown transport type: {ttype!r}")
