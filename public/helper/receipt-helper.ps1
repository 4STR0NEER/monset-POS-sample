# Sample POS receipt helper. Runs on the front desk PC and lets the POS web app print receipts
# straight to the receipt printer as ESC/POS commands, through the normal Windows print queue
# (so it shares the printer safely with the old POS). Chrome's page layout is never involved.
#
#   POST http://127.0.0.1:9123/print   body: base64 ESC/POS bytes   -> prints
#   GET  http://127.0.0.1:9123/        -> status page (open it in Chrome to check the helper is up)
#
# Started by start-receipt-helper.bat. Errors go to receipt-helper.log next to this file.
param(
  [string]$Printer = $env:RECEIPT_PRINTER, # blank = first printer named like XP-58 / POS-58
  [string]$Allow = $env:RECEIPT_ALLOW,     # extra allowed site origins, comma separated
  [int]$Port = 9123,
  [string]$OutFile                         # testing only: write the bytes here instead of printing
)
$ErrorActionPreference = 'Stop'
$log = Join-Path $PSScriptRoot 'receipt-helper.log'
function Log($m) { Add-Content -Path $log -Value "$(Get-Date -Format s)  $m" }

Add-Type -TypeDefinition @'
using System;
using System.ComponentModel;
using System.Runtime.InteropServices;
public static class RawPrinter {
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  public class DOCINFO { public string pDocName; public string pOutputFile; public string pDataType; }
  [DllImport("winspool.drv", CharSet = CharSet.Unicode, SetLastError = true)] static extern bool OpenPrinter(string name, out IntPtr h, IntPtr defaults);
  [DllImport("winspool.drv", SetLastError = true)] static extern bool ClosePrinter(IntPtr h);
  [DllImport("winspool.drv", CharSet = CharSet.Unicode, SetLastError = true)] static extern int StartDocPrinter(IntPtr h, int level, [In] DOCINFO di);
  [DllImport("winspool.drv", SetLastError = true)] static extern bool EndDocPrinter(IntPtr h);
  [DllImport("winspool.drv", SetLastError = true)] static extern bool StartPagePrinter(IntPtr h);
  [DllImport("winspool.drv", SetLastError = true)] static extern bool EndPagePrinter(IntPtr h);
  [DllImport("winspool.drv", SetLastError = true)] static extern bool WritePrinter(IntPtr h, byte[] buf, int count, out int written);
  // RAW = bytes go to the printer untouched; the driver does no rendering.
  public static void Send(string printer, byte[] data) {
    IntPtr h;
    if (!OpenPrinter(printer, out h, IntPtr.Zero)) throw new Win32Exception();
    try {
      if (StartDocPrinter(h, 1, new DOCINFO { pDocName = "POS receipt", pDataType = "RAW" }) == 0) throw new Win32Exception();
      try {
        StartPagePrinter(h);
        int written;
        if (!WritePrinter(h, data, data.Length, out written)) throw new Win32Exception();
        EndPagePrinter(h);
      } finally { EndDocPrinter(h); }
    } finally { ClosePrinter(h); }
  }
}
'@

if (-not $Printer -and -not $OutFile) {
  $Printer = Get-Printer | Where-Object Name -match 'XP-?58|POS-?58' | Select-Object -First 1 -ExpandProperty Name
}
$allowed = @($Allow -split ',' | ForEach-Object { $_.Trim().TrimEnd('/') } | Where-Object { $_ })
# Only the POS may print: the live site, its Cloudflare / Vercel addresses, local dev, and whatever RECEIPT_ALLOW adds.
function Allowed($origin) {
  $origin -and ($origin -match '^https://([a-z0-9-]+\.)*(pages\.dev|vercel\.app)$' -or
    $origin -match '^http://(localhost|127\.0\.0\.1)(:\d+)?$' -or $allowed -contains $origin)
}

function Reply($stream, $code, $text, $origin) {
  $body = [Text.Encoding]::UTF8.GetBytes($text)
  # Refusals carry CORS too, so the POS can show the real reason instead of "helper not running".
  $cors = if ($origin) { "Access-Control-Allow-Origin: $origin`r`nAccess-Control-Allow-Private-Network: true`r`nAccess-Control-Allow-Methods: GET, POST, OPTIONS`r`nAccess-Control-Allow-Headers: Content-Type`r`n" } else { '' }
  $head = [Text.Encoding]::ASCII.GetBytes("HTTP/1.1 $code`r`nContent-Type: text/plain; charset=utf-8`r`nContent-Length: $($body.Length)`r`nConnection: close`r`n$cors`r`n")
  $stream.Write($head, 0, $head.Length)
  $stream.Write($body, 0, $body.Length)
}

try {
  $listener = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback, $Port)
  $listener.Start()
} catch {
  Log "Could not listen on port $Port (helper already running?): $_"
  exit 1
}
Log "Started on http://127.0.0.1:$Port, printer: '$Printer'"

while ($true) {
  $client = $listener.AcceptTcpClient()
  try {
    $stream = $client.GetStream()
    $stream.ReadTimeout = 5000
    $buf = New-Object byte[] 262144
    $got = 0; $end = -1
    while ($end -lt 0 -and $got -lt $buf.Length) {
      $n = $stream.Read($buf, $got, $buf.Length - $got)
      if ($n -le 0) { break }
      $got += $n
      $end = [Text.Encoding]::ASCII.GetString($buf, 0, $got).IndexOf("`r`n`r`n")
    }
    if ($end -lt 0) { continue }
    $lines = [Text.Encoding]::ASCII.GetString($buf, 0, $end) -split "`r`n"
    $method, $path = $lines[0].Split(' ')[0, 1]
    $h = @{}
    foreach ($l in $lines | Select-Object -Skip 1) { $i = $l.IndexOf(':'); if ($i -gt 0) { $h[$l.Substring(0, $i).Trim().ToLower()] = $l.Substring($i + 1).Trim() } }
    $origin = $h['origin']

    if ($method -eq 'OPTIONS') { Reply $stream '204 No Content' '' $origin; continue }
    if ($method -eq 'GET') { Reply $stream '200 OK' "Receipt helper is running. Printer: '$Printer'" $origin; continue }
    if ($method -ne 'POST' -or $path -ne '/print') { Reply $stream '404 Not Found' 'Unknown request.' $origin; continue }
    if (-not (Allowed $origin)) { Log "Refused print from origin '$origin'"; Reply $stream '403 Forbidden' "This site ($origin) is not allowed to print. Add it to RECEIPT_ALLOW." $origin; continue }
    if (-not $Printer -and -not $OutFile) { Reply $stream '500 Internal Server Error' 'No receipt printer found. Set RECEIPT_PRINTER in start-receipt-helper.bat.' $origin; continue }

    $len = [int]$h['content-length']
    $start = $end + 4
    if ($start + $len -gt $buf.Length) { Reply $stream '413 Payload Too Large' 'Receipt too large.' $origin; continue }
    while ($got -lt $start + $len) {
      $n = $stream.Read($buf, $got, $start + $len - $got)
      if ($n -le 0) { break }
      $got += $n
    }
    $data = [Convert]::FromBase64String([Text.Encoding]::ASCII.GetString($buf, $start, $len))
    if ($OutFile) { [IO.File]::WriteAllBytes($OutFile, $data) } else { [RawPrinter]::Send($Printer, $data) }
    Reply $stream '200 OK' 'Printed.' $origin
  } catch {
    Log "Error: $_"
    try { Reply $stream '500 Internal Server Error' "Printing failed: $_" $origin } catch {}
  } finally {
    $client.Close()
  }
}
