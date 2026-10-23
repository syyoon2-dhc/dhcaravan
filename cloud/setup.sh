#!/bin/bash
# ──────────────────────────────────────────────
#  동해카라반펜션 예약 서버 — 클라우드 서버(우분투) 설치 스크립트
#  사용법:  bash ~/dhcaravan/cloud/setup.sh
#  (여러 번 실행해도 괜찮습니다)
#  · iwinv 처럼 root 로 접속한 경우: 일반 계정 dhc 를 만들어 /home/dhc/dhcaravan 에서 실행 (보안)
#  · 오라클처럼 ubuntu 계정으로 접속한 경우: 그 계정 · 그 폴더 그대로 실행
# ──────────────────────────────────────────────
set -e
SRC="$(cd "$(dirname "$0")/.." && pwd)"
if [ "$(id -u)" = 0 ]; then
  SUDO=""
else
  SUDO="sudo"
fi

echo
echo "===== 1/5. 한국 시간 설정 · 프로그램 설치 ====="
$SUDO timedatectl set-timezone Asia/Seoul
$SUDO apt-get update -y
$SUDO apt-get install -y python3 git ffmpeg sqlite3 curl sudo

# 메모리 1GB 서버는 동영상 압축 때 메모리가 모자라므로 스왑 2GB 추가
if [ ! -f /swapfile ] && [ "$(free -m | awk '/Mem:/{print $2}')" -lt 2000 ]; then
  $SUDO fallocate -l 2G /swapfile
  $SUDO chmod 600 /swapfile
  $SUDO mkswap /swapfile
  $SUDO swapon /swapfile
  echo '/swapfile none swap sw 0 0' | $SUDO tee -a /etc/fstab >/dev/null
fi

if [ "$(id -u)" = 0 ]; then
  RUN_USER=dhc
  id "$RUN_USER" >/dev/null 2>&1 || useradd -m -s /bin/bash "$RUN_USER"
  SITE="/home/$RUN_USER/dhcaravan"
  if [ "$SRC" != "$SITE" ] && [ ! -d "$SITE/.git" ]; then
    cp -a "$SRC" "$SITE"
  fi
  chown -R "$RUN_USER:$RUN_USER" "$SITE"
  AS="sudo -u $RUN_USER -H"
else
  RUN_USER="$(whoami)"
  SITE="$SRC"
  AS=""
fi
USER_HOME="$(getent passwd "$RUN_USER" | cut -d: -f6)"
echo "실행 계정: $RUN_USER / 폴더: $SITE"
cd "$SITE"

echo
echo "===== 2/5. 관리자 계정 ====="
$AS mkdir -p "$SITE/private"
$AS chmod 700 "$SITE/private"
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
  $AS env AID="$AID" APW="$APW" python3 - "$SITE/admin_config.json" <<'EOF'
import json, os, sys
with open(sys.argv[1], 'w', encoding='utf-8') as f:
    json.dump({'id': os.environ['AID'], 'pw': os.environ['APW']}, f, ensure_ascii=False, indent=2)
EOF
  $AS chmod 600 "$SITE/admin_config.json"
fi

echo
echo "===== 3/5. GitHub 자동 올리기 설정 ====="
$AS git -C "$SITE" config user.name "dhc-cloud-server"
$AS git -C "$SITE" config user.email "dhc-cloud-server@users.noreply.github.com"
$AS git -C "$SITE" config credential.helper store
CRED="$USER_HOME/.git-credentials"
if [ -f "$CRED" ]; then
  echo "이미 있음"
else
  read -r -s -p "GitHub 토큰 붙여넣기 (github_pat_... / 나중에 하려면 그냥 엔터): " TOKEN; echo
  if [ -n "$TOKEN" ]; then
    echo "https://syyoon2-dhc:${TOKEN}@github.com" | $AS tee "$CRED" >/dev/null
    $AS chmod 600 "$CRED"
  fi
fi
$AS chmod +x "$SITE/cloud/sync.sh"
# sync.sh 가 프로그램이 바뀌었을 때 서버를 재시작할 수 있게 (이 명령 하나만 허용)
echo "$RUN_USER ALL=(root) NOPASSWD: /usr/bin/systemctl restart dhc" | $SUDO tee /etc/sudoers.d/dhc-restart >/dev/null
$SUDO chmod 440 /etc/sudoers.d/dhc-restart

echo
echo "===== 4/5. 서버 자동 실행 등록 ====="
$SUDO tee /etc/systemd/system/dhc.service >/dev/null <<EOF
[Unit]
Description=Donghae Caravan booking server
After=network-online.target
Wants=network-online.target

[Service]
User=$RUN_USER
WorkingDirectory=$SITE
ExecStart=/usr/bin/python3 $SITE/server.py
Restart=always
RestartSec=5
Environment=PYTHONUNBUFFERED=1 PYTHONUTF8=1

[Install]
WantedBy=multi-user.target
EOF

$SUDO tee /etc/systemd/system/dhc-sync.service >/dev/null <<EOF
[Unit]
Description=Donghae Caravan GitHub sync

[Service]
Type=oneshot
User=$RUN_USER
ExecStart=$SITE/cloud/sync.sh
EOF

$SUDO tee /etc/systemd/system/dhc-sync.timer >/dev/null <<EOF
[Unit]
Description=Donghae Caravan GitHub sync every 2 minutes

[Timer]
OnBootSec=1min
OnUnitActiveSec=2min

[Install]
WantedBy=timers.target
EOF

$SUDO systemctl daemon-reload
$SUDO systemctl enable dhc.service dhc-sync.timer
$SUDO systemctl restart dhc.service
$SUDO systemctl start dhc-sync.timer
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
$SUDO tailscale up --ssh --hostname=dhc
echo "Funnel 허용 주소가 나오면 그 주소도 브라우저에서 열어 [Enable] 을 누르세요."
$SUDO tailscale funnel --bg 8000

echo
echo "================================================"
echo " 설치 완료! 아래 https://....ts.net 주소가 예약 서버 주소입니다."
tailscale funnel status
echo " 이 서버의 공인 IP (알리고에 등록): $(curl -fs https://api.ipify.org)"
echo "================================================"
