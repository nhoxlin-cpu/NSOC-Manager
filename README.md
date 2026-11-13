# Work Area — IQC

Ứng dụng quản lý vật tư, quét mã và kiểm tra IQC bằng Node.js + SQLite. Giao diện tiếng Việt, hỗ trợ điện thoại và máy tính.

## Chức năng

- Đăng nhập, hồ sơ, đổi mật khẩu và phân quyền `admin`, `inspector`, `viewer` tại server.
- Trang chủ có banner động HANSOL · HEVH · IQC · Chất lượng, hỗ trợ tạm dừng và chế độ giảm chuyển động của thiết bị. Quét & thu thập dữ liệu nằm trong nhóm ô chức năng.
- Mỗi tài khoản tự chọn 3–5 phím tắt, thay đổi thứ tự và dùng lại bố cục đã lưu trên thiết bị khác.
- Quét HS / Stock / Label bằng bàn phím, máy scan hoặc camera điện thoại.
- Quét liên tục mặc định bật trên HS / Stock / Label và camera điền mã CKD / MM / Holding. Nút bật/tắt lưu theo tài khoản; khi tắt, đọc một mã rồi chọn “Quét mã tiếp theo”. Quét điền mã vẫn cần xác nhận box hoặc giao dịch kho riêng.
- Camera toàn màn hình gọn: Barcode / QR, quét liên tục, tự lưu mã mới, cảnh báo trùng, đếm lượt; zoom, flash, âm thanh và rung khi thiết bị hỗ trợ. Dùng camera sau, không có nút lật camera; điều khiển gộp hai hàng và nút quay lại/flash cỡ nhỏ.
- Giữ một mã trước camera không tạo thêm lượt liên tục. Stock / Label chỉ lưu thêm mã đã có khi người dùng chủ động chọn; HS luôn chặn lưu trùng.
- Kéo khung để di chuyển, kéo góc để đổi kích thước, chụm hai ngón để zoom; có zoom ảnh khi camera không hỗ trợ zoom quang học và nút đặt lại khung.
- Chế độ Nhãn bóng / chói tắt flash, giảm bù phơi sáng nếu thiết bị hỗ trợ và thử tăng tương phản ảnh đọc. Vùng phản chiếu trắng hoàn toàn vẫn cần đổi góc hoặc ánh sáng.
- Kiểm tra trùng toàn bộ lịch sử dùng chung theo loại quét, kể cả khi hai thiết bị quét cùng lúc.
- HS: mã chưa trùng hiện xanh; mã trùng hiện đỏ và không lưu thêm, kể cả yêu cầu bỏ qua kiểm tra trùng. Giữ một mã trước camera không tạo thêm lượt hoặc tự báo trùng. Sau khi quét mã khác rồi gặp lại mã cũ, cảnh báo trùng vẫn hoạt động. Mất mạng thì hiện vàng vì chưa đối chiếu toàn server.
- HS / Stock / Label có lịch sử, tổng, Excel và hàng chờ riêng trên từng tab, dùng chung giữa người dùng trong cùng loại quét. Lượt HS trùng khi đồng bộ giữ trong hàng chờ kèm ảnh để xem hoặc chủ động bỏ.
- Stock tra MM theo mã Samsung hoặc ITEM code; nhận thêm ITEM / ITEM_CODE / SAMSUNG có nhãn rõ ràng trong barcode. Hiện ITEM code, Item NM, QTY, Maker / Vendor, Lot No khi lưu và trong lịch sử. QTY / LOT_NO trên nhãn được ưu tiên; nếu thiếu thì dùng qty / lot_no trong MM. Thông tin Stock mới giữ tại thời điểm quét, không đổi khi nhập lại MM.
- Giữ lượt quét bằng IndexedDB khi mất mạng và đồng bộ thủ công, chống ghi lặp khi gửi lại yêu cầu.
- Hai nút vuông cạnh Quét camera: mũi tên vòng bật/tắt quét liên tục; camera bật/tắt tự chụp ảnh đối chiếu. Lựa chọn ảnh nhớ theo tài khoản trên thiết bị.
- Khi bật tự chụp, lưu ảnh JPEG toàn khung hình gốc lúc đọc mã, trước tăng tương phản; ảnh đi cùng lượt quét và hàng chờ mất mạng. Có thể xem lại trong lịch sử. Cạnh dài ảnh giới hạn 1280 px để giảm dung lượng.
- Bỏ biểu mẫu nhập barcode trên trang quét. Nếu cần nhập tay, chọn Nhập mã bằng tay trong màn hình camera.
- Lịch sử hiển thị STT / ID, ảnh đối chiếu, QR hoặc Code 128 từ nguyên nội dung mã đã lưu; QR hỗ trợ Unicode, Code 128 dùng ASCII. Bộ tạo mã chạy tại thiết bị, không gửi nội dung sang dịch vụ bên ngoài.
- Chỉ **Stock** có QTY: lấy trường QTY rõ ràng trong barcode, nếu thiếu thì dùng cột qty trong MM. Không suy từ Selling Q’ty hay MOQ. HS / Label và Stock chưa có nguồn QTY để trống. Tổng theo toàn bộ lịch sử loại quét đang chọn; gửi lại yêu cầu không cộng lặp, xóa lượt quét cập nhật tổng. Lượt Stock cũ giữ QTY đã ghi, không tự gán QTY MM mới cho lịch sử cũ.
- Xuất lịch sử quét `.xlsx` có STT / ID và cột số lượng.
- Nhập danh mục MM từ CSV UTF-8 trong menu **Cài đặt → Dữ liệu MM** (thu gọn trong trang tài khoản, chỉ admin). Trang Tra cứu MM không còn biểu mẫu nhập file. Mẫu cũ 9 cột vẫn dùng được; mẫu mới bổ sung qty và lot_no tùy chọn.
- CKD: đối chiếu hai nhãn và Maker với MM, xác nhận box theo phiếu/lô, chặn box trùng và số lượng vượt mục tiêu.
- Holding room: nhập/xuất theo ITEM và Location, chặn tồn âm, lịch sử dùng chung.

## Yêu cầu

Node.js **24.11.1 hoặc bản vá mới hơn trong dòng 24**. Server không cần cài thư viện npm bên ngoài. `node:sqlite` ở bản Node nền 24.11.1 có cảnh báo experimental.

```sh
node scripts/create-user.mjs
node server.mjs
```

Tạo tài khoản đầu tiên với quyền **admin**; mật khẩu 8–128 ký tự, nhập riêng tại terminal. Không có tài khoản hoặc mật khẩu mặc định.

Mở `http://127.0.0.1:3000`. Mặc định server chỉ nghe trên loopback và lưu database tại `data/work-area.sqlite`.

## Kiểm tra

```sh
node --test tests/*.test.mjs
```

28 bài kiểm tra bao gồm phân quyền, CSRF, CSV, dữ liệu bền, chống trùng, xác nhận đồng thời, tồn kho, đổi mật khẩu, định dạng Excel, cấu hình riêng theo tài khoản, chuyển đổi dữ liệu cũ và ranh giới vùng quét.

Giao diện camera đã được thử bằng video mô phỏng, giải mã ảnh QR / Code128, phục hồi ảnh barcode tương phản thấp, kéo/đổi cỡ khung và thao tác pinch. Hoạt động phần cứng flash, zoom, rung và phơi sáng phụ thuộc thiết bị/trình duyệt; chưa xác minh trên sản phẩm bóng thật của người dùng.

## Cài với Docker trên Linux

Cần Docker Engine, Compose và một tên miền trỏ về VPS.

```sh
cp .env.example .env
```

Sửa `DOMAIN` thành tên miền thật, không kèm `https://`, và điền `ACME_EMAIL`. Cho phép cổng 80/443 tới Caddy; không mở cổng backend 3000.

```sh
docker compose config --quiet
docker compose up -d --build
docker compose exec app node scripts/create-user.mjs
```

Mở `https://TEN-MIEN-CUA-BAN` sau khi Caddy cấp được chứng chỉ hợp lệ. Cấu hình dùng một tiến trình app, database và ảnh trong volume `work_area_data`.

Nếu VPS có web server khác đang dùng cổng 80/443, cần ghép hostname vào proxy hiện có thay vì chạy thêm Caddy dùng cùng cổng. Không dùng `docker compose down -v` khi cần giữ dữ liệu.

## Chạy native trên Windows hoặc Linux

Dự án chạy trực tiếp bằng Node. Khi phục vụ Internet, cấu hình môi trường:

| Biến | Giá trị / mục đích |
| --- | --- |
| `NODE_ENV` | `production` |
| `APP_ORIGIN` | Origin HTTPS chính xác, ví dụ `https://iqc.example.com`, không có `/` cuối |
| `HOST` | `127.0.0.1` khi dùng reverse proxy trên cùng máy |
| `PORT` | Mặc định `3000` |
| `DB_PATH` | Đường dẫn SQLite riêng tư, ngoài vùng public |

Khởi động `node server.mjs` bằng trình quản lý dịch vụ của hệ điều hành. Chuyển tiếp hostname HTTPS tới backend. Server từ chối origin HTTP ở chế độ production và đặt cookie Secure. Thiết lập tài khoản hệ điều hành, quyền thư mục, proxy và startup service theo môi trường thực tế; cấu hình quản trị riêng của VPS không được lưu trong repository này.

## Dữ liệu MM

Dùng `examples/mm-template.csv`, hoặc tải CSV mẫu từ giao diện quản trị. Lưu CSV UTF-8 từ Excel, dấu phẩy phân cách cột:

| Cột | Nội dung |
| --- | --- |
| `item_code` | Mã ITEM duy nhất |
| `samsung` | Toàn bộ barcode đối chiếu, duy nhất |
| `item` | Tên hàng |
| `description` | Mô tả |
| `maker` | Một Maker chính xác |
| `vendor` | Nhà cung cấp, có thể trống |
| `location` | Vị trí, có thể trống |
| `selling_qty` | Số lượng mục tiêu, số nguyên dương |
| `moq` | Số lượng chuẩn trong box, số nguyên dương |
| `qty` | Tùy chọn: QTY Stock khi barcode không có QTY; trống nếu chưa biết |
| `lot_no` | Tùy chọn: Lot No Stock khi barcode không có LOT / LOT_NO |

Nhập file tại menu **Cài đặt → Dữ liệu MM**. Các tiêu đề `Item Code`, `Item NM` / `Item Name`, `Barcode`, `Mark`, `Lot No` tương ứng với `item_code`, `item`, `samsung`, `maker`, `lot_no`. Maker có thể trống nếu có Vendor; CKD vẫn cần Maker để đối chiếu. Mẫu cũ không có qty / lot_no giữ hai giá trị Stock đã lưu; có cột nhưng ô trống thì xóa giá trị tương ứng về chưa xác định.

Tối đa 2 MB và 10.000 dòng mỗi lượt. Ô có dấu phẩy cần đặt trong dấu nháy. Một dòng không hợp lệ sẽ hủy toàn bộ batch. Nhập lại ITEM cập nhật ITEM đó, không xóa các ITEM khác.

## Sao lưu

```sh
node scripts/backup.mjs
```

Lệnh dùng cùng `DB_PATH` với server và tạo snapshot nhất quán dưới thư mục `backups` cạnh database. Với Docker:

```sh
docker compose exec app node scripts/backup.mjs
```

Giữ bản sao riêng tư ngoài VPS và kiểm tra khả năng khôi phục. Database chứa người dùng đã băm mật khẩu, phiên đăng nhập, dữ liệu công việc và ảnh.

## Giới hạn hiện tại

- Chưa có OCR ảnh, chatbot AI hoặc bảng quy đổi AI ↔ MI cho cắt chân linh kiện.
- CKD hiện so khớp chính xác hai barcode sau khi bỏ khoảng trắng ở hai đầu và chuyển chữ hoa; Maker phải khớp một Maker trong MM. Chưa phân tích định dạng hai nhãn khác nhau hoặc nhiều Maker.
- Selling Q’ty hiện lấy từ MM làm mục tiêu cho từng ITEM trong mỗi phiếu/lô, chưa có nghiệp vụ đơn hàng/SO riêng.
- Không có service worker; hàng chờ giúp giữ lượt quét khi ứng dụng đã mở, không bảo đảm mở lại trang khi hoàn toàn mất mạng.
- Chưa có tự đăng ký, khôi phục mật khẩu qua email, giao diện khóa người dùng hoặc thay đổi vai trò.
- Chưa kiểm thử tải lớn hoặc mọi loại thiết bị camera.

## Phạm vi repository

Repository chứa mã nguồn, test, CSV mẫu không có dữ liệu và cấu hình triển khai mẫu. `.env`, SQLite, ảnh quét, backups, phiên đăng nhập và thiết lập quản trị riêng của VPS được giữ ngoài Git.

Bộ đọc dự phòng `@zxing/library` 0.21.3 được self-host trong `public/vendor`. Các thông báo và giấy phép Apache-2.0 / MIT nằm trong cùng thư mục.
