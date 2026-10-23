#!/bin/bash
# ──────────────────────────────────────────────
#  동해카라반펜션 예약 서버 — 오라클 클라우드(우분투) 설치 스크립트
#  사용법:  bash ~/dhcaravan/cloud/setup.sh
#  (여러 번 실행해도 괜찮습니다)
# ──────────────────────────────────────────────
set -e
SITE="$(cd "$(dirname "$0")/.." && pwd)"
ME="$(whoami)"

echo
echo "===== 1/5. 한국 시간 설정 · 프로그램 설치 ====="
sudo timedatectl set-timezone Asia/Seoul
sudo apt-get update -y
sudo apt-get install -y python3 git ffmpeg sqlite3 curl

# 메모리 1GB 서버(E2.1.Micro)는 동영상 압축 때 메모리가 모자라므로 스왑 2GB 추가
if [ ! -f /swapfile ] && [ "$(free -m | awk '/Mem:/{print $2}')" -lt 2000 ]; then
  sudo fallocate -l 2G /swapfile
  sudo chmod 600 /swapfile
  sudo mkswap /swapfile
  sudo swapon /swapfile
  echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab >/dev/null
fi

echo
echo "===== 2/5. 관리자 계정 ====="
mkdir -p "$SITE/private"
chmod 700 "$SITE/private"
if [ -f "$SITE/admin_config.json" ]; then
  echo "이미 있음 (바꾸려면 admin_config.json 을 지우고 다시 실행)"
else
  read -r -p "관리자 아이디 [admin]: " AID
  AID=${AID:-admin}
  while true; do
    read -r -s -p "새 관리자 비밀번호 (10자 이상, 화면에 안 보임): " APW; echo
    [ ${#APW} -ge 10 ] && break
    echo "10자 이상으로 입력하세요."
  done
  AID="$AID" APW="$APW" python3 - "$SITE/admin_config.json" <<'EOF'
import json, os, sys
with open(sys.argv[1], 'w', encoding='utf-8') as f:
    json.dump({'id': os.environ['AID'], 'pw': os.environ['APW']}, f, ensure_ascii=False, indent=2)
EOF
  chmod 600 "$SITE/admin_config.json"
fi

echo
echo "===== 3/5. GitHub 자동 올리기 설정 ====="
git -C "$SITE" config user.name "dhc-cloud-server"
git -C "$SITE" config user.email "dhc-cloud-server@users.noreply.github.com"
git -C "$SITE" config credential.helper store
if [ -f "$HOME/.git-credentials" ]; then
  echo "이미 있음"
else
  read -r -s -p "GitHub 토큰 붙여넣기 (github_pat_... / 나중에 하려면 그냥 엔터): " TOKEN; echo
  if [ -n "$TOKEN" ]; then
    echo "https://syyoon2-dhc:${TOKEN}@github.com" > "$HOME/.git-credentials"
    chmod 600 "$HOME/.git-credentials"
  fi
fi
chmod +x "$SITE/cloud/sync.sh"

echo
echo "===== 4/5. 서버 자동 실행 등록 ====="
sudo tee /etc/systemd/system/dhc.service >/dev/null <<EOF
[Unit]
Description=Donghae Caravan booking server
After=network-online.target
Wants=network-online.target

[Service]
User=$ME
WorkingDirectory=$SITE
ExecStart=/usr/bin/python3 $SITE/server.py
Restart=always
RestartSec=5
Environment=PYTHONUNBUFFERED=1 PYTHONUTF8=1

[Install]
WantedBy=multi-user.target
EOF

sudo tee /etc/systemd/system/dhc-sync.service >/dev/null <<EOF
[Unit]
Description=Donghae Caravan GitHub sync

[Service]
Type=oneshot
User=$ME
ExecStart=$SITE/cloud/sync.sh
EOF

sudo tee /etc/systemd/system/dhc-sync.timer >/dev/null <<EOF
[Unit]
Description=Donghae Caravan GitHub sync every 2 minutes

[Timer]
OnBootSec=1min
OnUnitActiveSec=2min

[Install]
WantedBy=timers.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable dhc.service dhc-sync.timer
sudo systemctl restart dhc.service
sudo systemctl start dhc-sync.timer
sleep 2
if curl -fs -o /dev/null http://localhost:8000/; then
  echo "서버 실행 중"
else
  echo "서버가 아직 안 켜졌습니다 → sudo journalctl -u dhc -n 30 으로 확인"
fi

echo
echo "===== 5/5. Tailscale Funnel (인터넷 주소) ====="
if ! command -v tailscale >/dev/null; then
  curl -fsSL https://tailscale.com/install.sh | sh
fi
echo "아래에 나오는 https://login.tailscale.com/... 주소를 PC 브라우저에 붙여넣어 로그인하세요."
sudo tailscale up --ssh --hostname=dhc
echo "Funnel 허용 주소가 나오면 그 주소도 브라우저에서 열어 [Enable] 을 누르세요."
sudo tailscale funnel --bg 8000

echo
echo "================================================"
echo " 설치 완료! 아래 https://....ts.net 주소가 예약 서버 주소입니다."
tailscale funnel status
echo " 이 서버의 공인 IP (알리고에 등록): $(curl -fs https://api.ipify.org)"
echo "================================================"
