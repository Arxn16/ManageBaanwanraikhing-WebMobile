#!/data/data/com.termux/files/usr/bin/sh
# ตัวรันระบบบน Termux — termux-services (runit) เรียกไฟล์นี้ และเปิดใหม่ให้เองถ้าระบบดับ
# ไม่ต้องรันเอง ใช้ "sv up banwaenraikhing" แทน

cd "$(dirname "$0")/.." || exit 1
PATH="${PREFIX:-/data/data/com.termux/files/usr}/bin:$PATH"
export PATH

# กันมือถือหลับจนเครื่องอื่นเข้าไม่ได้
command -v termux-wake-lock >/dev/null 2>&1 && termux-wake-lock

exec node --env-file-if-exists=.env --disable-warning=ExperimentalWarning server/index.js
