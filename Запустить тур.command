#!/bin/bash
# Запуск виртуального тура в браузере.
# Двойной клик по этому файлу — тур откроется автоматически.
# Чтобы остановить сервер, закройте окно терминала.

cd "$(dirname "$0")" || exit 1

PORT=8123
while lsof -i :$PORT >/dev/null 2>&1; do
  PORT=$((PORT+1))
done

echo "Виртуальный тур запускается на http://localhost:$PORT"
echo "Не закрывайте это окно, пока смотрите тур."
echo ""

( sleep 1 && open "http://localhost:$PORT/index.html" ) &

if command -v python3 >/dev/null 2>&1; then
  python3 -m http.server "$PORT"
else
  echo "Не найден python3. Установите его или запустите любой другой локальный сервер в этой папке."
  read -r -p "Нажмите Enter, чтобы закрыть..."
fi
