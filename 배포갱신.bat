@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo.
echo  ===== 동해카라반펜션 홈페이지 배포 갱신 =====
echo.
git add -A
git commit -m "사진/내용 업데이트"
git pull --rebase origin master
git push
echo.
echo  ============================================
echo   배포 완료! 1~2분 후 인터넷 사이트에 반영됩니다.
echo   https://syyoon2-dhc.github.io/dhcaravan/
echo  ============================================
echo.
pause
