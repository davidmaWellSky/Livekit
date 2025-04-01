@echo off
echo LiveKit SIP Call Test
echo ==================
set "PHONE_NUMBER=%~1"
if "%PHONE_NUMBER%"=="" (
  set "PHONE_NUMBER=+14014578910"
  echo Using default phone number: %PHONE_NUMBER%
) else (
  echo Using provided phone number: %PHONE_NUMBER%
)

echo Installing dependencies...
call npm install

echo.
echo Initiating SIP call to %PHONE_NUMBER%
echo.
node test-sip-call.js %PHONE_NUMBER%

echo.
echo Test completed.
echo Check sip-call-test.log for detailed logs.