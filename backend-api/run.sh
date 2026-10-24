#!/bin/sh
# Starts the Vehicle Expense Tracker on its OWN Java API and OWN database.
#   Website:     http://localhost:8081
#   Admin page:  http://localhost:8081/admin.html   (admin / admin12345 unless changed in .env)
#   API docs:    http://localhost:8081/swagger-ui.html
# Data is stored in backend-api/data/ and kept between restarts.
MVN="$(command -v mvn || echo "$HOME/.local/bin/mvn")"
cd "$(dirname "$0")" || exit 1
if [ -f .env ]; then set -a; . ./.env; set +a; fi
if curl -s --max-time 2 "http://localhost:${PORT:-8081}/api/health" | grep -q '"UP"'; then
  echo "The server is already running: open http://localhost:${PORT:-8081}"
  echo "(To restart it, press Ctrl+C in the terminal where it runs, then run ./run.sh again.)"
  open "http://localhost:${PORT:-8081}" 2>/dev/null
  exit 0
fi
echo "Starting on http://localhost:8081 ..."
exec "$MVN" -q spring-boot:run -Dspring-boot.run.profiles=local
