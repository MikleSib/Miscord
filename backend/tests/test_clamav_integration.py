import os
from pathlib import Path

import pytest

from app.services.clamav import MalwareDetected, scan_file


EICAR = (
    b"X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!"
    b"$H+H*"
)


@pytest.mark.asyncio
async def test_clamav_rejects_eicar(tmp_path: Path) -> None:
    if os.getenv("WEBHOOK_CLAMAV_INTEGRATION") != "1":
        pytest.skip("Set WEBHOOK_CLAMAV_INTEGRATION=1 when clamd is available")

    sample = tmp_path / "eicar.com"
    sample.write_bytes(EICAR)

    with pytest.raises(MalwareDetected):
        await scan_file(sample)
