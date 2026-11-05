#!/usr/bin/env bash
# Prueba de humo del OAuth del MCP de Bitácora contra un entorno desplegado (local o producción). Solo usa peticiones anónimas:
# no necesita credenciales y no modifica datos. Uso: scripts/smoke-oauth.sh https://bitacora-novedades.alegra.com
#
# Comprueba: metadatos de recurso protegido (RFC 9728), 401 con resource_metadata, que /oauth/token no se cachea,
# que no revela el motivo del rechazo y que un cliente que insiste recibe 429 con Retry-After.
set -u
BASE="${1:?uso: $0 <url-base>}"
BASE="${BASE%/}"
fail=0
ok()  { echo "  OK   $1"; }
bad() { echo "  FALLA $1"; fail=1; }
check() { if eval "$2"; then ok "$1"; else bad "$1"; fi; }

echo "== Metadatos de recurso protegido"
for p in /.well-known/oauth-protected-resource /.well-known/oauth-protected-resource/api/mcp; do
  body=$(curl -s -m 15 -o /tmp/smoke_body -w '%{http_code}' "$BASE$p")
  check "$p -> 200" "[ \"$body\" = 200 ]"
  check "$p declara authorization_servers y el recurso /api/mcp" "grep -q '\"authorization_servers\"' /tmp/smoke_body && grep -q '/api/mcp' /tmp/smoke_body"
done
body=$(curl -s -m 15 -o /tmp/smoke_body -w '%{http_code}' "$BASE/.well-known/oauth-authorization-server")
check "/.well-known/oauth-authorization-server -> 200 con token_endpoint" "[ \"$body\" = 200 ] && grep -q token_endpoint /tmp/smoke_body"

echo "== 401 del MCP sin credenciales"
hdr=$(curl -s -m 15 -i -X POST "$BASE/api/mcp" -H 'content-type: application/json' -d '{"jsonrpc":"2.0","id":1,"method":"initialize"}')
check "responde 401" "echo \"\$hdr\" | head -1 | grep -q ' 401'"
check "WWW-Authenticate empieza por Bearer" "echo \"\$hdr\" | grep -i '^www-authenticate: Bearer'"
check "WWW-Authenticate trae resource_metadata" "echo \"\$hdr\" | grep -i '^www-authenticate:' | grep -q 'resource_metadata=\"$BASE/.well-known/oauth-protected-resource/api/mcp\"'"

echo "== /oauth/token con credenciales inválidas"
CID="smoke-$(date +%s)-$RANDOM" # cliente único: el freno es por IP+cliente, no afecta a nadie más
req() { curl -s -m 15 -i -X POST "$BASE/oauth/token" -H 'content-type: application/x-www-form-urlencoded' --data "grant_type=refresh_token&refresh_token=invalido-$RANDOM&client_id=$CID"; }
first=$(req)
check "refresh inválido -> 400 invalid_grant" "echo \"\$first\" | head -1 | grep -q ' 400' && echo \"\$first\" | grep -q '\"error\":\"invalid_grant\"'"
check "Cache-Control: no-store" "echo \"\$first\" | grep -qi '^cache-control: no-store'"
check "no revela el motivo (sin error_description)" "! echo \"\$first\" | grep -q error_description"
last=""
for _ in $(seq 1 12); do last=$(req); done
check "tras 10+ fallos seguidos responde 429" "echo \"\$last\" | head -1 | grep -q ' 429'"
check "429 incluye Retry-After" "echo \"\$last\" | grep -qi '^retry-after: [0-9]'"

echo
if [ "$fail" = 0 ]; then echo "TODO OK ($BASE)"; else echo "HAY FALLAS ($BASE)"; exit 1; fi
