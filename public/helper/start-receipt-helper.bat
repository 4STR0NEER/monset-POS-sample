@echo off
rem Starts the receipt helper (receipt-helper.ps1, keep it in the same folder).
rem Put a shortcut to this file in the Startup folder (Win+R, type shell:startup) so it starts at login.

rem Exact Windows name of the receipt printer. Leave blank to use the first printer named like XP-58 / POS-58.
set RECEIPT_PRINTER=

rem The live POS address if it is not a *.pages.dev or *.vercel.app address, e.g. https://pos.example.com
rem (comma separated for more than one).
set RECEIPT_ALLOW=

start "" powershell -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "%~dp0receipt-helper.ps1"
