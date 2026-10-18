#!/usr/bin/env bash
# The database lives on the organisation's Oracle 19c server, so backups are the DBA's job
# (RMAN, or Data Pump for this schema). This exports the schema with Data Pump when the
# Oracle client tools are on this machine:
#   ./backup.sh production
set -euo pipefail
env="${1:?usage: backup.sh staging|production}"
file=".env.${env}"
[[ -f "$file" ]] || { echo "Missing $file"; exit 1; }
if ! command -v expdp >/dev/null; then
  echo "expdp not found: skipping the export. Make sure the DBA backup covers this schema."
  exit 0
fi
conn=$(grep '^ORACLE_CONNECTION=' "$file" | cut -d= -f2-)
user=$(sed -E 's/.*User Id=([^;]+).*/\1/' <<<"$conn")
pass=$(sed -E 's/.*Password=([^;]+).*/\1/' <<<"$conn")
dsn=$(sed -E 's/.*Data Source=([^;]+).*/\1/' <<<"$conn")
stamp=$(date +%Y%m%d-%H%M%S)
expdp "${user}/${pass}@${dsn}" schemas="${user}" directory=DATA_PUMP_DIR \
  dumpfile="taskboard-${env}-${stamp}.dmp" logfile="taskboard-${env}-${stamp}.log"
echo "Export written to the server's DATA_PUMP_DIR as taskboard-${env}-${stamp}.dmp"
