$ErrorActionPreference = 'Stop'

$root = Join-Path $PSScriptRoot 'public'
$listener = [System.Net.HttpListener]::new()
$listener.Prefixes.Add('http://localhost:4173/')
$listener.Start()
Write-Host 'Vista previa disponible en http://localhost:4173/'

try {
    while ($listener.IsListening) {
        $context = $listener.GetContext()
        $path = [uri]::UnescapeDataString($context.Request.Url.AbsolutePath).TrimStart('/')
        if ([string]::IsNullOrWhiteSpace($path)) { $path = 'legacy.html' }

        $candidate = [IO.Path]::GetFullPath((Join-Path $root $path))
        $safeRoot = [IO.Path]::GetFullPath($root) + [IO.Path]::DirectorySeparatorChar
        if (-not $candidate.StartsWith($safeRoot, [StringComparison]::OrdinalIgnoreCase) -or -not (Test-Path -LiteralPath $candidate -PathType Leaf)) {
            $context.Response.StatusCode = 404
            $context.Response.Close()
            continue
        }

        $extension = [IO.Path]::GetExtension($candidate).ToLowerInvariant()
        $mime = @{
            '.html' = 'text/html; charset=utf-8'; '.js' = 'text/javascript; charset=utf-8';
            '.css' = 'text/css; charset=utf-8'; '.json' = 'application/json; charset=utf-8';
            '.svg' = 'image/svg+xml'; '.png' = 'image/png'; '.jpg' = 'image/jpeg'; '.jpeg' = 'image/jpeg';
            '.ico' = 'image/x-icon'; '.pdf' = 'application/pdf'
        }[$extension]
        $context.Response.ContentType = if ($mime) { $mime } else { 'application/octet-stream' }
        $bytes = [IO.File]::ReadAllBytes($candidate)
        $context.Response.ContentLength64 = $bytes.Length
        $context.Response.OutputStream.Write($bytes, 0, $bytes.Length)
        $context.Response.Close()
    }
}
finally {
    $listener.Close()
}
