#!/bin/bash
# Lädt spl.flotech.dev per SFTP zu IONOS hoch. Nutzt Zugang und Passwort von flotech.dev:
#   ~/.config/flotech-web/sftp.conf (HOST, BENUTZER) und Schlüsselbund-Eintrag flotech-sftp.
#   ACHTUNG: Der Login landet in der Wurzel des ganzen Webspace. Ziel ist nur der Ordner spl/.
# Setzt die Version des Offline-Speichers (sw.js) auf den aktuellen Commit, damit Geräte das Update holen.
set -euo pipefail
cd "$(dirname "$0")"
source "$HOME/.config/flotech-web/sftp.conf"
ZIEL=spl
PASS=$(security find-generic-password -s flotech-sftp -a "$BENUTZER" -w)
[ -z "$(git status --porcelain)" ] || { echo "Erst committen, dann hochladen" >&2; exit 1; }
STAND=$(git rev-parse --short HEAD)

TMP=$(mktemp -d)
cp -R index.html app.js texte.js stream.css spl.css manifest.webmanifest .htaccess bilder schrift "$TMP/"
sed "s/^const STAND = .*/const STAND = \"$STAND\";/" sw.js > "$TMP/sw.js"
find "$TMP" -name .DS_Store -delete

BATCH=$(mktemp)
{
  echo "-mkdir $ZIEL"
  echo "cd $ZIEL"
  echo "-mkdir bilder"; echo "-mkdir schrift"
  (cd "$TMP" && find . -type f | sed 's#^\./##' | while read -r f; do echo "put \"$TMP/$f\" \"$f\""; done)
} > "$BATCH"
echo "Ziel: $BENUTZER@$HOST:$ZIEL · Stand $STAND · $(grep -c '^put' "$BATCH") Dateien"
read -p "Hochladen? [j/N] " OK; [ "$OK" = "j" ] || { echo "Abgebrochen"; rm -r "$BATCH" "$TMP"; exit 1; }
SFTP_PASS="$PASS" /usr/bin/expect <<EXP
set timeout 120
spawn sftp -oBatchMode=no -oStrictHostKeyChecking=accept-new -b "$BATCH" "$BENUTZER@$HOST"
expect {
  -re "(?i)password:" { send "\$env(SFTP_PASS)\r"; exp_continue }
  eof
}
catch wait r
exit [lindex \$r 3]
EXP
rm -r "$BATCH" "$TMP"
echo "✅ Hochgeladen. Prüfen: https://spl.flotech.dev"
