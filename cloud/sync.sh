#!/bin/bash
# 2분마다 자동 실행 (dhc-sync.timer)
#  · 관리자 화면에서 바꾼 사진 · 요금 · 팝업 · 성수기 설정 → GitHub 에 올림 (홈페이지 반영)
#  · GitHub 에 새로 올라온 내용 → 받아옴 (프로그램이 바뀌었으면 서버 재시작)
#  기록: private/sync.log
cd "$(dirname "$0")/.." || exit 1
LOG=private/sync.log
log() { echo "$(date '+%F %T') $*" >> "$LOG"; }

before=$(git rev-parse HEAD)

if [ -n "$(git status --porcelain)" ]; then
  git add -A
  git commit -q -m "관리자 화면에서 수정 (클라우드 서버)"
  log "변경 저장"
fi

if ! git pull -q --rebase origin master; then
  git rebase --abort 2>/dev/null
  log "받기 실패 — 같은 파일을 PC 와 클라우드에서 동시에 고쳤을 수 있음"
  exit 1
fi

if [ "$(git rev-list --count origin/master..HEAD)" -gt 0 ]; then
  if git push -q origin HEAD:master; then
    log "GitHub 올리기 완료"
  else
    log "GitHub 올리기 실패 — 토큰(~/.git-credentials) 확인"
  fi
fi

after=$(git rev-parse HEAD)
if [ "$before" != "$after" ] && git diff --name-only "$before" "$after" | grep -q '\.py$'; then
  sudo systemctl restart dhc
  log "프로그램 갱신 → 서버 재시작"
fi
