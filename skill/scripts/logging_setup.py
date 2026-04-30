from __future__ import annotations

import logging
from datetime import datetime
from pathlib import Path


def configure_daily_file_logging(base_dir: Path, *, level: int = logging.INFO) -> Path:
    """Route root logging to ./logs/YYYYMMDD.log with per-line timestamps."""
    logs_dir = base_dir / "logs"
    logs_dir.mkdir(parents=True, exist_ok=True)

    log_path = logs_dir / f"{datetime.now().strftime('%Y%m%d')}.log"
    logging.basicConfig(
        level=level,
        format="[%(asctime)s] [%(levelname)s] %(message)s",
        datefmt="%H:%M:%S",
        handlers=[logging.FileHandler(log_path, encoding="utf-8")],
        force=True,
    )
    return log_path
