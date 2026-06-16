#!/usr/bin/env bash
# Arranca vite dev, detecta el puerto real y actualiza nginx
set -euo pipefail

NGINX_CONF="/etc/nginx/sites-available/wealth-os"
LOG=$(mktemp)

# Arranca vite en background, captura output
node node_modules/.bin/vite dev --host 127.0.0.1 2>&1 | tee "$LOG" &
VITE_PID=$!

# Espera hasta que vite indique el puerto
for i in $(seq 1 30); do
  PORT=$(grep -oP '(?<=http://127\.0\.0\.1:)\d+' "$LOG" 2>/dev/null | head -1)
  [ -n "$PORT" ] && break
  sleep 1
done

if [ -z "$PORT" ]; then
  echo "ERROR: no se pudo detectar el puerto de vite"
  kill $VITE_PID 2>/dev/null
  exit 1
fi

echo "Vite arrancó en puerto $PORT — actualizando nginx"

# Actualiza el proxy de nginx con el puerto real
sudo sed -i "s|proxy_pass http://127\.0\.0\.1:[0-9]\+;|proxy_pass http://127.0.0.1:${PORT};|g" "$NGINX_CONF"
sudo nginx -s reload

echo "nginx apunta a http://127.0.0.1:${PORT} → accede via http://localhost:3333"

# Mantiene el proceso de vite en primer plano
wait $VITE_PID
