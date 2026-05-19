#!/usr/bin/env bash
# Project-local PostgreSQL cluster — fully self-contained.
# No system service, no sudo, data lives in ./.pgdata and is gitignored.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PGDATA="$ROOT/.pgdata"
PGPORT="${PGPORT:-54329}"
PGDB="medixus_karte"
PGLOG="$ROOT/.pgdata/server.log"

# Locate PostgreSQL 14+ binaries portably (mac ARM/Intel, Linux).
detect_pgbin() {
  if command -v pg_ctl >/dev/null 2>&1; then PGBIN="$(dirname "$(command -v pg_ctl)")"; return; fi
  if command -v brew >/dev/null 2>&1; then
    for v in 17 16 15 14; do
      p="$(brew --prefix "postgresql@$v" 2>/dev/null || true)"
      [ -n "$p" ] && [ -x "$p/bin/pg_ctl" ] && { PGBIN="$p/bin"; return; }
    done
  fi
  for p in \
    /opt/homebrew/opt/postgresql@1*/bin /usr/local/opt/postgresql@1*/bin \
    /usr/lib/postgresql/1*/bin /usr/pgsql-1*/bin /opt/postgresql/1*/bin; do
    [ -x "$p/pg_ctl" ] && { PGBIN="$p"; return; }
  done
  echo "[pg] PostgreSQL が見つかりません。インストールしてください:" >&2
  echo "      mac:  brew install postgresql@16" >&2
  echo "      Linux: apt-get install postgresql-16  (または同等)" >&2
  echo "      もしくは Docker を使用: docker compose up -d db （README参照）" >&2
  echo "      既存のPostgresを使う場合は pg.sh を使わず .env の DATABASE_URL を設定" >&2
  exit 1
}
PGBIN=""
detect_pgbin
export PATH="$PGBIN:$PATH"
# macOS: postmaster becomes multithreaded during startup unless LC_ALL is a valid locale
export LC_ALL=C
export LANG=C

case "${1:-}" in
  init)
    if [ -d "$PGDATA" ]; then echo "[pg] cluster already exists at $PGDATA"; exit 0; fi
    echo "[pg] initdb -> $PGDATA"
    initdb -D "$PGDATA" -U postgres --encoding=UTF8 --locale=C --auth=trust >/dev/null
    # listen only on localhost, custom port, socket inside data dir
    {
      echo "port = $PGPORT"
      echo "listen_addresses = '127.0.0.1'"
      echo "unix_socket_directories = '$PGDATA'"
      echo "fsync = off"            # dev-only: faster, this is a disposable local cluster
      echo "synchronous_commit = off"
    } >> "$PGDATA/postgresql.conf"
    pg_ctl -D "$PGDATA" -l "$PGLOG" -w start >/dev/null
    createdb -h 127.0.0.1 -p "$PGPORT" -U postgres "$PGDB" || true
    pg_ctl -D "$PGDATA" -w stop >/dev/null
    echo "[pg] initialized. db=$PGDB port=$PGPORT user=postgres (trust auth, localhost only)"
    ;;
  start)
    if pg_ctl -D "$PGDATA" status >/dev/null 2>&1; then echo "[pg] already running"; exit 0; fi
    pg_ctl -D "$PGDATA" -l "$PGLOG" -w start >/dev/null
    echo "[pg] started on 127.0.0.1:$PGPORT"
    ;;
  stop)
    pg_ctl -D "$PGDATA" -w stop >/dev/null 2>&1 && echo "[pg] stopped" || echo "[pg] not running"
    ;;
  status)
    pg_ctl -D "$PGDATA" status || true
    ;;
  *)
    echo "usage: pg.sh {init|start|stop|status}"; exit 1;;
esac
