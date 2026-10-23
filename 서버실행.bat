@echo off
chcp 65001 >nul
cd /d "%~dp0"
title 동해카라반펜션 서버 (이 창을 닫으면 예약을 받을 수 없습니다)
:loop
echo.
echo  ===== 동해카라반펜션 서버 시작 (%date% %time%) =====
echo   예약 관리 : http://localhost:8000/booking-admin.html
echo   이 창은 닫지 말고 최소화해 두세요.
echo.
python server.py
echo.
echo  서버가 멈췄습니다. 5초 후 자동으로 다시 시작합니다...
timeout /t 5 /nobreak >nul
goto loop
