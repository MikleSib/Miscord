from __future__ import annotations

import threading
import time


MISCORD_EPOCH_MS = 1420070400000
_WORKER_ID = 1
_PROCESS_ID = 1
_lock = threading.Lock()
_last_millisecond = 0
_increment = 0


def generate_snowflake() -> str:
    global _last_millisecond, _increment
    with _lock:
        millisecond = int(time.time() * 1000)
        if millisecond == _last_millisecond:
            _increment = (_increment + 1) & 0xFFF
            if _increment == 0:
                while millisecond <= _last_millisecond:
                    millisecond = int(time.time() * 1000)
        else:
            _increment = 0
        _last_millisecond = millisecond
        value = (
            ((millisecond - MISCORD_EPOCH_MS) << 22)
            | (_WORKER_ID << 17)
            | (_PROCESS_ID << 12)
            | _increment
        )
        return str(value)
