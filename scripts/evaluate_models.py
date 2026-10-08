from __future__ import annotations

import json

from backend.core.config import get_settings
from ml_models.common import read_json_file


settings = get_settings()


def main() -> None:
    payload = read_json_file(settings.model_metrics_path, default={"assets": {}})
    print(json.dumps(payload, indent=2))


if __name__ == "__main__":
    main()
