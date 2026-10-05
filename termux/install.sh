#!/data/data/com.termux/files/usr/bin/sh
# บ้านแว่นไร่ขิง — ติดตั้ง / อัปเดต บนมือถือ Android (แอป Termux)
#
#   sh ~/Manage-Banwaenraikhing/termux/install.sh
#
# รันซ้ำได้ทุกครั้งที่อัปเดตโค้ด ข้อมูลลูกค้าที่มีอยู่ในมือถือแล้วจะไม่ถูกทับ
# หลังติดตั้ง ระบบทำงานเบื้องหลัง ดับแล้วเปิดใหม่เอง และเปิดเองตอนเปิดเครื่อง (ถ้ามีแอป Termux:Boot)

set -eu

SERVICE=banwaenraikhing
APP_DIR=$(cd "$(dirname "$0")/.." && pwd)
PREFIX=${PREFIX:-/data/data/com.termux/files/usr}
SV_DIR="$PREFIX/var/service/$SERVICE"
LOG_FILE="$PREFIX/var/log/sv/$SERVICE/current"
BOOT_FILE="$HOME/.termux/boot/start-$SERVICE"
export SVDIR="$PREFIX/var/service" LOGDIR="$PREFIX/var/log"

step () { printf '\n==> %s\n' "$*"; }
ok () { printf '    ✓ %s\n' "$*"; }
warn () { printf '    ⚠️  %s\n' "$*"; }
die () { printf '\n❌ %s\n' "$*" >&2; exit 1; }
ask () { printf '%s' "$1"; REPLY=''; read -r REPLY; }

healthy () {
  node -e "fetch('http://127.0.0.1:$1/healthz').then(r => process.exit(r.ok ? 0 : 1), () => process.exit(1))" 2>/dev/null
}
service_running () { sv status "$SERVICE" 2>/dev/null | grep -q '^run:'; }

case "$PREFIX" in
  */com.termux/*) ;;
  *) die 'สคริปต์นี้ใช้ในแอป Termux บนมือถือ Android เท่านั้น (บนคอมให้ใช้ Docker ตาม README)' ;;
esac
cd "$APP_DIR"
[ -f server/index.js ] || die "ไม่พบโค้ดระบบใน $APP_DIR"

# ---------- 1. โปรแกรมที่ต้องใช้ ----------
step '1/6 ตรวจโปรแกรมที่ต้องใช้'
node_ok () {
  command -v node >/dev/null 2>&1 &&
    node -e 'const [a, b] = process.versions.node.split(".").map(Number); process.exit(a > 22 || (a === 22 && b >= 13) ? 0 : 1)'
}
PKGS=''
if ! command -v node >/dev/null 2>&1; then
  PKGS="$PKGS nodejs-lts"
elif ! node_ok; then
  die "Node.js ในเครื่องเก่าเกินไป ($(node -v)) ต้องใช้ 22.13 ขึ้นไป ให้รัน  pkg upgrade  แล้วรันสคริปต์นี้ใหม่"
fi
command -v npm >/dev/null 2>&1 || PKGS="$PKGS npm"
[ -f "$PREFIX/etc/profile.d/start-services.sh" ] || PKGS="$PKGS termux-services"
command -v ifconfig >/dev/null 2>&1 || PKGS="$PKGS net-tools"
if [ -n "$PKGS" ]; then
  echo "    กำลังติดตั้ง:$PKGS (ต้องต่ออินเทอร์เน็ต)"
  # shellcheck disable=SC2086
  pkg install -y $PKGS || die 'ติดตั้งโปรแกรมไม่สำเร็จ ลองรัน  pkg upgrade  แล้วรันสคริปต์นี้ใหม่'
fi
node_ok || die 'ติดตั้ง Node.js ไม่สำเร็จ'
ok "Node.js $(node -v), npm $(npm -v)"

# ---------- 2. ส่วนประกอบของระบบ ----------
step '2/6 ติดตั้งส่วนประกอบของระบบ (npm)'
npm ci --omit=dev --no-audit --no-fund --loglevel=error || die 'npm ติดตั้งไม่สำเร็จ ตรวจอินเทอร์เน็ตแล้วรันใหม่'
ok 'เรียบร้อย'

# ---------- 3. PIN ----------
step '3/6 ตั้งค่า PIN'
if [ -f .env ]; then
  ok 'ใช้ค่าเดิมในไฟล์ .env'
  rm -f .env.mac
elif [ -f .env.mac ]; then
  mv .env.mac .env && chmod 600 .env
  ok 'ใช้ PIN เดียวกับเครื่อง Mac'
else
  while :; do
    ask '    ตั้ง PIN สำหรับเข้าใช้งาน (ตัวเลข 6 หลักขึ้นไป): ' || die 'ต้องรันสคริปต์นี้ในหน้าต่าง Termux เพื่อพิมพ์ PIN'
    case "$REPLY" in
      '' | *[!0-9]*) warn 'ใส่ตัวเลขเท่านั้น' ;;
      *) [ ${#REPLY} -ge 6 ] && break; warn 'ต้องมีอย่างน้อย 6 หลัก' ;;
    esac
  done
  sed "s/^APP_PIN=.*/APP_PIN=$REPLY/" .env.example > .env
  chmod 600 .env
  ok 'บันทึก PIN แล้ว (เปลี่ยนทีหลังได้ที่ไฟล์ .env)'
fi
PORT=$(sed -n 's/^PORT=//p' .env | tail -n 1 | tr -dc '0-9')
PORT=${PORT:-3000}

# ถ้ามีระบบที่เปิดด้วย npm start ค้างอยู่ ต้องปิดก่อน ไม่งั้นจะชนพอร์ตกัน
if healthy "$PORT" && ! service_running; then
  die "มีระบบเปิดอยู่แล้วที่พอร์ต $PORT (น่าจะเปิดด้วย npm start) ให้ไปหน้าต่างนั้นกด Ctrl+C ก่อน แล้วรันสคริปต์นี้ใหม่"
fi

# ---------- 4. ข้อมูลลูกค้า ----------
step '4/6 ข้อมูลลูกค้า และไฟล์สำรองนอก Termux'
# ไฟล์สำรองใน data/backups/ จะหายไปพร้อม Termux ถ้าแอปถูกลบ จึงก๊อปไปไว้ในโฟลเดอร์ Documents ของมือถือด้วย
SHARED="$HOME/storage/shared"
if [ ! -d "$SHARED" ] && command -v termux-setup-storage >/dev/null 2>&1; then
  echo '    ขอสิทธิ์เข้าถึงไฟล์ในมือถือ ให้กด "อนุญาต" ที่หน้าจอมือถือ (รอ 60 วินาที)'
  termux-setup-storage >/dev/null 2>&1 || true
  i=0
  while [ ! -d "$SHARED" ] && [ "$i" -lt 60 ]; do sleep 1; i=$((i + 1)); done
fi
COPY_DIR=''
if [ -d "$SHARED" ] && mkdir -p "$SHARED/Documents/banwaenraikhing-backups" 2>/dev/null; then
  COPY_DIR="$SHARED/Documents/banwaenraikhing-backups"
  if ! grep -q '^BACKUP_COPY_DIR=' .env; then
    printf '\n# ก๊อปไฟล์สำรองไปไว้นอกแอป Termux (โฟลเดอร์ Documents ของมือถือ) เผื่อ Termux ถูกลบ\nBACKUP_COPY_DIR=%s\n' "$COPY_DIR" >> .env
  fi
  ok 'ไฟล์สำรองจะถูกก๊อปไปไว้ที่ Documents/banwaenraikhing-backups ของมือถือด้วย'
else
  warn 'ไม่ได้สิทธิ์เข้าถึงไฟล์ในมือถือ ไฟล์สำรองจะอยู่ใน Termux อย่างเดียว (พิมพ์ termux-setup-storage กดอนุญาต แล้วรันสคริปต์นี้ใหม่)'
fi
mkdir -p data
if [ -s data/banwaenraikhing.db ]; then
  COUNT=$(node --disable-warning=ExperimentalWarning -e "const { DatabaseSync } = require('node:sqlite'); const db = new DatabaseSync('data/banwaenraikhing.db', { readOnly: true }); console.log(db.prepare('SELECT COUNT(*) AS n FROM customers').get().n)" 2>/dev/null || echo '?')
  ok "ใช้ข้อมูลเดิมในมือถือ ($COUNT รายการ) ไม่ทับ"
else
  # ไฟล์ที่ติดมากับ zip (data/import/), ไฟล์ใน Download หรือไฟล์สำรองใน Documents (กรณีลง Termux ใหม่) เลือกไฟล์ใหม่สุด
  CANDIDATES="data/import/*.db $HOME/storage/downloads/banwaenraikhing*.db"
  [ -z "$COPY_DIR" ] || CANDIDATES="$CANDIDATES $COPY_DIR/*.db"
  # shellcheck disable=SC2086
  SRC=$(ls -t $CANDIDATES 2>/dev/null | head -n 1 || true)
  if [ -n "$SRC" ]; then
    ask "    พบไฟล์ข้อมูล $SRC  นำเข้าเลยไหม? [Y/n] " || REPLY=''
    case "$REPLY" in
      n | N | no) warn 'ข้ามการนำเข้า เริ่มจากฐานข้อมูลว่าง (นำเข้าทีหลังได้ ดู README)' ;;
      *) node --disable-warning=ExperimentalWarning server/import.js "$SRC" --yes || die 'นำเข้าข้อมูลไม่สำเร็จ' ;;
    esac
  else
    warn 'ไม่พบไฟล์ข้อมูล เริ่มจากฐานข้อมูลว่าง (นำเข้าทีหลังได้ ดู README)'
  fi
fi

# ---------- 5. ให้ทำงานเบื้องหลัง ----------
step '5/6 ตั้งให้ระบบทำงานเบื้องหลัง และเปิดใหม่เองถ้าดับ'
mkdir -p "$SV_DIR/log"
cat > "$SV_DIR/run" <<RUN
#!$PREFIX/bin/sh
exec "$PREFIX/bin/sh" "$APP_DIR/termux/run.sh" 2>&1
RUN
chmod 700 "$SV_DIR/run"
ln -sf "$PREFIX/share/termux-services/svlogger" "$SV_DIR/log/run"
# shellcheck disable=SC1091
. "$PREFIX/etc/profile.d/start-services.sh"
i=0
until sv status "$SERVICE" >/dev/null 2>&1; do
  i=$((i + 1))
  [ "$i" -le 30 ] || die 'ตัวจัดการ service ยังไม่ทำงาน ให้ปิดแล้วเปิดแอป Termux ใหม่ แล้วรันสคริปต์นี้อีกครั้ง'
  sleep 1
done
sv-enable "$SERVICE" >/dev/null 2>&1 || sv up "$SERVICE" >/dev/null
sv restart "$SERVICE" >/dev/null 2>&1 || true
i=0
until healthy "$PORT"; do
  i=$((i + 1))
  if [ "$i" -gt 40 ]; then
    warn 'ระบบยังไม่ตอบ ดู log ล่าสุด:'
    tail -n 20 "$LOG_FILE" 2>/dev/null || true
    die "ตรวจ error ด้านบน แล้วรันใหม่ (ดู log ต่อ: tail -f $LOG_FILE)"
  fi
  sleep 1
done
ok 'ระบบทำงานแล้ว'

# ---------- 6. เปิดเองตอนเปิดเครื่อง ----------
step '6/6 ให้เปิดเองตอนเปิดเครื่อง'
mkdir -p "$HOME/.termux/boot"
cat > "$BOOT_FILE" <<BOOT
#!$PREFIX/bin/sh
# เปิดระบบบ้านแว่นไร่ขิงเองเมื่อเปิดเครื่อง (ใช้กับแอป Termux:Boot)
termux-wake-lock
. "$PREFIX/etc/profile.d/start-services.sh"
BOOT
chmod 700 "$BOOT_FILE"
ok 'พร้อมแล้ว ถ้าลงแอป Termux:Boot และเปิดแอปนั้น 1 ครั้ง'

IPS=$(node -e "console.log(require('./server/net').lanAddresses().join(' '))" 2>/dev/null || true)
echo
echo '✅ ติดตั้งเสร็จแล้ว'
echo "   มือถือเครื่องนี้:       http://localhost:$PORT"
if [ -n "$IPS" ]; then
  for ip in $IPS; do echo "   เครื่องอื่นในร้าน:     http://$ip:$PORT"; done
else
  echo "   เครื่องอื่นในร้าน:     http://<IP มือถือ>:$PORT  (ดู IP ที่ ตั้งค่า → Wi-Fi → ชื่อ Wi-Fi ที่ต่ออยู่)"
fi
cat <<HELP

คำสั่งที่ใช้บ่อย (พิมพ์ใน Termux)
   sv status $SERVICE      ดูสถานะ
   sv restart $SERVICE     รีสตาร์ตระบบ
   sv down $SERVICE        ปิดชั่วคราว (เปิดใหม่: sv up $SERVICE)
   tail -f $LOG_FILE
                                 ดู log (ออกด้วย Ctrl+C)
ถ้าพิมพ์ sv แล้วขึ้น fail: unable to change to service directory
ให้ปิดหน้าต่าง Termux (หรือ ssh) แล้วเปิดใหม่ 1 ครั้ง

อย่าลืม: ตั้งแบตเตอรี่ของแอป Termux เป็น "ไม่จำกัด" และอย่ากด Exit ที่แจ้งเตือนของ Termux
HELP
[ -z "$COPY_DIR" ] || echo "ไฟล์สำรองนอก Termux: โฟลเดอร์ Documents/banwaenraikhing-backups (ก๊อปไปเก็บที่อื่นเป็นประจำด้วย)"

for z in "$HOME"/storage/downloads/banwaen*.zip; do
  [ -f "$z" ] || continue
  ask "ลบไฟล์ $(basename "$z") ในโฟลเดอร์ Download ทิ้งไหม (ในไฟล์มีข้อมูลลูกค้าและ PIN)? [y/N] " || REPLY=''
  case "$REPLY" in y | Y | yes) rm -f "$z" && ok 'ลบแล้ว' ;; esac
done
