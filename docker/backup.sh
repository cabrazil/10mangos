#!/usr/bin/env bash
# Backup diário do banco 10mangos (mantém os últimos 14 dias)
# Cron sugerido (crontab -e):  30 3 * * * /home/ubuntu/10mangos/backup.sh >> /home/ubuntu/10mangos/backups/backup.log 2>&1
set -euo pipefail
cd "$(dirname "$0")"
source .env

FILE="/backups/10mangos_$(date +%Y%m%d_%H%M%S).dump"
docker exec 10mangos_postgres pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc -f "$FILE"
find ./backups -name '10mangos_*.dump' -mtime +14 -delete
echo "$(date '+%F %T') backup ok: $FILE"
