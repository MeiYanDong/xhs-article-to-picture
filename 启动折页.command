#!/bin/zsh
set -e

cd "$(dirname "$0")"

export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
if [[ -s "$NVM_DIR/nvm.sh" ]]; then
  source "$NVM_DIR/nvm.sh"
fi

if ! command -v npm >/dev/null 2>&1; then
  print "未找到 Node.js / npm。请先安装 Node.js 22。"
  read "? 按回车关闭…"
  exit 1
fi

if [[ ! -d node_modules ]]; then
  npm install
fi

npm run dev &
server_pid=$!

cleanup() {
  kill "$server_pid" >/dev/null 2>&1 || true
}
trap cleanup EXIT INT TERM

for _ in {1..60}; do
  if curl --silent --fail http://127.0.0.1:4173 >/dev/null 2>&1; then
    open -a "Google Chrome" http://127.0.0.1:4173
    wait "$server_pid"
    exit $?
  fi
  sleep 0.25
done

print "本地服务未能在 15 秒内启动。"
exit 1
