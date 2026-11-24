# Monta o pacote portatil para o cliente em dist\DominioDoChefe.zip
# Leva junto: Node (runtime\) e Chrome (chrome\). O cliente nao precisa instalar nada.
# NAO leva: .sessao (o seu WhatsApp), estado, resultados (os seus testes).
# Uso: npm run empacotar

$ErrorActionPreference = 'Stop'
$raiz = Split-Path -Parent $PSScriptRoot
$nome = 'DominioDoChefe'
$dist = Join-Path $raiz 'dist'
$pasta = Join-Path $dist $nome
$zip = Join-Path $dist "$nome.zip"

function Copiar-Pasta($origem, $destino) {
  robocopy $origem $destino /E /NFL /NDL /NJH /NJS /NP | Out-Null
  if ($LASTEXITCODE -ge 8) { throw "Falha ao copiar $origem" }
}

Write-Host "Limpando dist\..."
if (Test-Path $pasta) { Remove-Item $pasta -Recurse -Force }
if (Test-Path $zip) { Remove-Item $zip -Force }
New-Item -ItemType Directory -Force $pasta | Out-Null

Write-Host "Copiando o sistema..."
Copiar-Pasta (Join-Path $raiz 'src') (Join-Path $pasta 'src')
Copiar-Pasta (Join-Path $raiz 'node_modules') (Join-Path $pasta 'node_modules')
foreach ($f in 'iniciar.bat', 'package.json', 'produtos.xlsx', 'config.exemplo.json') {
  Copy-Item (Join-Path $raiz $f) $pasta
}
Copy-Item (Join-Path $PSScriptRoot 'LEIA-ME.txt') $pasta

Write-Host "Gerando config.json limpo..."
$origemConfig = Join-Path $raiz 'config.json'
if (-not (Test-Path $origemConfig)) { $origemConfig = Join-Path $raiz 'config.exemplo.json' }
node (Join-Path $PSScriptRoot 'config-pacote.js') $origemConfig (Join-Path $pasta 'config.json')
if ($LASTEXITCODE -ne 0) { throw 'Falha ao gerar config.json' }

Write-Host "Copiando o Node..."
$node = (Get-Command node).Source
New-Item -ItemType Directory -Force (Join-Path $pasta 'runtime') | Out-Null
Copy-Item $node (Join-Path $pasta 'runtime\node.exe')

Write-Host "Copiando o Chrome..."
Push-Location $raiz
$chromeExe = node -p 'require(''puppeteer'').executablePath()'
Pop-Location
if (-not (Test-Path $chromeExe)) { throw "Chrome do puppeteer nao encontrado ($chromeExe). Rode npm install." }
Copiar-Pasta (Split-Path -Parent $chromeExe) (Join-Path $pasta 'chrome')

Write-Host "Compactando..."
tar -a -c -f $zip -C $dist $nome
if ($LASTEXITCODE -ne 0) { throw 'Falha ao compactar' }

$mb = [math]::Round((Get-Item $zip).Length / 1MB)
Write-Host ""
Write-Host "Pacote pronto: $zip ($mb MB)"
