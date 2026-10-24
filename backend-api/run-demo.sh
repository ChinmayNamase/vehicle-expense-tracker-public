#!/bin/sh
# Use Maven from PATH, or the copy installed in ~/.local/bin
MVN="$(command -v mvn || echo "$HOME/.local/bin/mvn")"
# Starts the API with the H2 demo database (no setup needed).
# Admin page: http://localhost:8081/admin.html   (login admin / admin12345 unless ADMIN_PASSWORD is set)
cd "$(dirname "$0")" && exec "$MVN" -q spring-boot:run -Dspring-boot.run.profiles=demo
