# Cai Work Area tren Ubuntu

Ho tro VPS Ubuntu 22.04 / 24.04 moi, x64 hoac ARM64. Can Internet de tai Node 24 va Caddy. Bo Ubuntu gom install.sh, verify-extract.py va recovery.zip (ma ung dung, du lieu, anh, tai khoan va giao dien offline da sao luu). Khong can quet/nhap lai hang hay tao lai tai khoan.

1. Tai WorkArea-Ubuntu-Installer.zip tu GitHub rieng tu, tai len VPS Ubuntu (SFTP/scp).
2. Giai nen: unzip WorkArea-Ubuntu-Installer.zip -d work-area-ubuntu
3. Chay: cd work-area-ubuntu
4. Cai: sudo bash install.sh --domain TEN-MIEN-CUA-BAN
5. Tro DNS ten mien ve IP VPS moi, mo cong 80/443 tren firewall/nha cung cap. Caddy tu cap HTTPS khi DNS va cong dung. Neu can dung chung ten mien cu, dung server cu truoc khi chuyen de tranh hai noi cung nhan du lieu.
6. Truy cap https://TEN-MIEN-CUA-BAN va dang nhap bang tai khoan cu. Kiem tra MM, anh, Holding va lich su truoc khi dua vao su dung.

Neu VPS da co proxy, dung --no-https roi tu cau hinh proxy HTTPS toi 127.0.0.1:3000. Script khong sua firewall/SSH hay ghi de server da cai.

Xem trang thai: sudo systemctl status work-area
Xem loi: sudo journalctl -u work-area -n 80 --no-pager
Khoi dong lai: sudo systemctl restart work-area
Ma nguon: /opt/work-area
Du lieu: /var/lib/work-area/work-area.sqlite
Cau hinh: /etc/work-area/server.env
Proxy: /etc/caddy/Caddyfile

Du lieu va tai khoan trong goi la tai thoi diem sao luu, khong tu dong gom cac giao dich phat sinh sau do. Co the chi dinh ban sao luu moi: sudo bash install.sh --domain TEN-MIEN --backup /duong-dan/backup-moi.zip
Giua file ZIP rieng tu. Xem RESTORE.md trong recovery.zip de biet them chi tiet.

Neu cai dat dung giua chung, khong xoa database de chay lai. Doc log va sua cau hinh/dich vu tai cac duong dan tren. Script co tinh tu choi ghi de ban cai da ton tai.
