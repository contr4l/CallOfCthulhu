#!/usr/bin/env python3
"""Read the documented single-line systemd EnvironmentFile without executing it."""
import json
import os
import pathlib
import shlex
import sys


def validate(values):
    if any(any(c in value for c in "\n\r\0") for value in values.values()):
        raise ValueError("Values must be single-line strings")
    port = int(values["PORT"])
    if not 1 <= port <= 65535:
        raise ValueError("PORT must be between 1 and 65535")
    if not pathlib.Path(values["DATABASE_PATH"]).is_absolute():
        raise ValueError("DATABASE_PATH must be absolute")
    return values


def read_config(path):
    values = {}
    for line in path.read_text().splitlines():
        if not line.strip() or line.lstrip().startswith(("#", ";")):
            continue
        key, separator, value = line.partition("=")
        if not separator or not key.strip().isidentifier():
            raise ValueError("Invalid environment assignment")
        parts = shlex.split(value, comments=False)
        if len(parts) != 1:
            raise ValueError("Values must be single-line strings, quoted when needed")
        values[key.strip()] = parts[0]
    return validate(values)


def main():
    path = pathlib.Path(sys.argv[1])
    if sys.argv[2] == "--ensure" and not path.exists():
        root = pathlib.Path(sys.argv[3])
        legacy = root / "CallOfCthulhu/data/game.sqlite"
        database = os.environ.get("DATABASE_PATH", str(legacy if legacy.exists() else root / "shared/game.sqlite"))
        values = {"HOST": "0.0.0.0", "PORT": os.environ.get("DEPLOY_PORT", "10086"), "DATABASE_PATH": database}
        for key in ("REGISTRATION_INVITE_CODE", "APP_ORIGINS", "NODE_ENV"):
            if key in os.environ:
                values[key] = os.environ[key]
        validate(values)
        path.parent.mkdir(parents=True, exist_ok=True)
        with open(path, "x", opener=lambda p, flags: os.open(p, flags, 0o600)) as stream:
            stream.write("".join(key + "=" + json.dumps(value, ensure_ascii=False) + "\n" for key, value in values.items()))
    values = read_config(path)
    if sys.argv[2] != "--ensure":
        key = sys.argv[2]
        if key not in ("PORT", "DATABASE_PATH"):
            raise ValueError("Only deployment metadata may be printed")
        print(values[key])


if __name__ == "__main__":
    main()
