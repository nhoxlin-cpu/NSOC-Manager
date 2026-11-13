# Work Area — IQC

Ứng dụng quản lý vật tư, quét mã và kiểm tra IQC bằng Node.js + SQLite. Giao diện tiếng Việt, hỗ trợ điện thoại và máy tính.

## Chức năng

- Đăng nhập, hồ sơ, đổi mật khẩu và phân quyền `admin`, `inspector`, `viewer` tại server.
- Trang chủ có banner động HANSOL · HEVH · IQC · Chất lượng, hỗ trợ tạm dừng và chế độ giảm chuyển động của thiết bị. Quét & thu thập dữ liệu nằm trong nhóm ô chức năng.
- Mỗi tài khoản tự chọn 3–5 phím tắt, thay đổi thứ tự và dùng lại bố cục đã lưu trên thiết bị khác.
- Quét HS / Stock / Label bằng bàn phím, máy scan hoặc camera điện thoại.
- Quét liên tục mặc định bật trên HS / Stock / Label và camera điền mã CKD / MM / Holding. Nút bật/tắt lưu theo tài khoản; khi tắt, đọc một mã rồi chọn “Quét mã tiếp theo”. Quét điền mã vẫn cần xác nhận box hoặc giao dịch kho riêng.
- Camera toàn màn hình gọn: Barcode / QR, quét liên tục, tự lưu mã mới, cảnh báo trùng, đếm lượt; zoom, flash, âm thanh và rung khi thiết bị hỗ trợ. Dùng camera sau, không có nút lật camera; điều khiển gộp hai hàng và nút quay lại/flash cỡ nhỏ.
- Giữ một mã trước camera không tạo thêm lượt liên tục. HS lưu cả mã trùng; Stock / Label chỉ lưu thêm mã đã có khi người dùng chủ động chọn.
- Kéo khung để di chuyển, kéo góc để đổi kích thước, chụm hai ngón để zoom; có zoom ảnh khi camera không hỗ trợ zoom quang học và nút đặt lại khung.
- Chế độ Nhãn bóng / chói tắt flash, giảm bù phơi sáng nếu thiết bị hỗ trợ và thử tăng tương phản ảnh đọc. Vùng phản chiếu trắng hoàn toàn vẫn cần đổi góc hoặc ánh sáng.
- Kiểm tra trùng toàn bộ lịch sử dùng chung theo loại quét, kể cả khi hai thiết bị quét cùng lúc.
- HS: mã chưa trùng hiện xanh; mã trùng hiện đỏ và vẫn lưu một lượt riêng kèm ảnh. Lịch sử HS tách riêng, ITEM / Barcode là cột thứ hai và Người quét nằm gần cuối; Excel HS có thứ tự tương ứng. Kết quả so sánh được lưu tại lúc quét, không đổi khi xóa lượt trước. Giữ một mã trước camera không tạo thêm lượt hoặc tự báo trùng. Sau khi quét mã khác rồi gặp lại mã cũ, cảnh báo trùng vẫn hoạt động. Mất mạng thì hiện vàng vì chưa đối chiếu toàn server.
- HS / Stock / Label có lịch sử, tổng, Excel và hàng chờ riêng trên từng tab, dùng chung giữa người dùng trong cùng loại quét. Lượt HS trùng trong hàng chờ vẫn được đồng bộ và lưu riêng; retry cùng mã yêu cầu không tạo thêm bản ghi.
- Stock tra MM theo mã Samsung hoặc ITEM code; nhận thêm ITEM / ITEM_CODE / SAMSUNG có nhãn rõ ràng trong barcode. Hiện ITEM code, Item NM, QTY, Maker / Vendor, Lot No khi lưu và trong lịch sử. QTY / LOT_NO trên nhãn được ưu tiên; nếu thiếu thì dùng qty / lot_no trong MM. Thông tin Stock mới giữ tại thời điểm quét, không đổi khi nhập lại MM.
- Giữ lượt quét bằng IndexedDB khi mất mạng và đồng bộ thủ công, chống ghi lặp khi gửi lại yêu cầu.
- Hai nút vuông cạnh Quét camera: mũi tên vòng bật/tắt quét liên tục; camera bật/tắt tự chụp ảnh đối chiếu. Lựa chọn ảnh nhớ theo tài khoản trên thiết bị.
- Khi bật tự chụp, lưu ảnh JPEG toàn khung hình gốc lúc đọc mã, trước tăng tương phản; ảnh đi cùng lượt quét và hàng chờ mất mạng. Có thể xem lại trong lịch sử. Cạnh dài ảnh giới hạn 1280 px để giảm dung lượng.
- Bỏ biểu mẫu nhập barcode trên trang quét. Nếu cần nhập tay, chọn Nhập mã bằng tay trong màn hình camera.
- Lịch sử hiển thị STT / ID, ảnh đối chiếu, QR hoặc Code 128 từ nguyên nội dung mã đã lưu; QR hỗ trợ Unicode, Code 128 dùng ASCII. Bộ tạo mã chạy tại thiết bị, không gửi nội dung sang dịch vụ bên ngoài.
- Chỉ **Stock** có QTY: lấy trường QTY rõ ràng trong barcode, nếu thiếu thì dùng cột qty trong MM. Không suy từ Selling Q’ty hay MOQ. HS / Label và Stock chưa có nguồn QTY để trống. Tổng theo toàn bộ lịch sử loại quét đang chọn; gửi lại yêu cầu không cộng lặp, xóa lượt quét cập nhật tổng. Lượt Stock cũ giữ QTY đã ghi, không tự gán QTY MM mới cho lịch sử cũ.
- Xuất lịch sử quét `.xlsx` có STT / ID và cột số lượng.
- Tra cứu MM không có chế độ quét liên tục. Camera đọc một mã rồi đóng để xem kết quả, không đổi tùy chọn quét của HS / Stock / Label / CKD. Kết quả dài có Xem thêm để đọc hết các dòng.
- Tra cứu MM mở bằng 4 thư mục lớn dạng lưới 2 × 2: Location / Item code / Spec / Nhập file (admin). Mỗi thư mục mở một trang riêng có nút quay lại. Ba trang tra cứu có nút Xem, hỗ trợ quét camera và đường dẫn giữ đúng trang khi tải lại. Spec dùng description; CSV nhận tiêu đề Spec.
- Nhập MM từ Excel **.xls / .xlsx**, tối đa 32 MB, đọc đủ tất cả sheet (kể cả sheet ẩn), hoặc CSV UTF-8 cũ 2 MB. Tìm tiêu đề trong 100 dòng đầu, báo số dòng của từng sheet. File mẫu dạng LOCATION / ITEM CD / ITEM NM / SPEC / BARCODE_NO / QTY được hỗ trợ, không cần thêm Selling Q’ty hay MOQ không có trong file. Giữ từng barcode, lô, vị trí, Maker / BP_NM, QTY thập phân, ngày nhập và thông tin nhãn; chỉ bỏ dòng tổng cuối sheet khi chỉ có QTY. Nhập lại cập nhật theo barcode, không nhân đôi và không xóa các barcode ngoài file. Nếu một sheet có lỗi thì toàn bộ workbook chưa được nhập.
- CKD: nhập XLSX hai sheet (Sheet1 SO, Sheet2 CKD model list), quét Samsung rồi ITEM bằng camera Barcode/QR hoặc máy quét. Đối chiếu Material Code / HS Code, Selling Code, SO Maker và Maker; hiện Item, Description, Vendor, MOQ, Selling Qty và tổng box.
- Camera CKD hiển thị hai ô Samsung / ITEM riêng; dấu × xóa riêng một mã và giữ mã còn lại. Chọn ô để quét lại vào đúng vị trí.
- CKD ưu tiên phần quét ở trên; đơn hàng SO nằm bên dưới, mặc định thu gọn, có nút đổi đơn và xổ/ẩn. Thanh quét dùng nút liên tục và tự chụp ảnh giống mục thu thập dữ liệu; có tên phiên, nhập tay/máy quét, ảnh riêng Samsung/ITEM khi xác nhận, xem ảnh và QR/mã vạch trong lịch sử. Quét camera vẫn hỗ trợ zoom, kéo/đổi cỡ khung, flash, rung, âm thanh và nhãn bóng.
- CKD luôn hỏi Lưu / Không lưu. Lưu NG chỉ ghi lịch sử, không cộng SO. Tổng các box PASS gộp theo Samsung trong cùng đơn, gồm nhiều ITEM bán. Lịch sử gắn nhãn Thiếu / Đủ / Dư; box vượt Selling Qty có cảnh báo trước khi lưu. MOQ có nhiều quy cách yêu cầu nhập số lượng box thực tế và tính lại.
- Mỗi file CKD nhập tạo một phiên đơn hàng riêng để không làm thay đổi lịch sử đơn cũ; mã box và mã yêu cầu chống cộng lặp. Xuất lịch sử CKD ra XLSX.
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

42 bài kiểm tra bao gồm phân quyền, CSRF, CSV, dữ liệu bền, chống trùng, xác nhận đồng thời, tồn kho, đổi mật khẩu, định dạng Excel, cấu hình riêng theo tài khoản, chuyển đổi dữ liệu cũ và ranh giới vùng quét.

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

Nhập file tại **Tra cứu MM → Nhập file** hoặc **Cài đặt → Dữ liệu MM**. Các tiêu đề `Item Code`, `Item NM` / `Item Name`, `Barcode`, `Mark`, `Lot No` tương ứng với `item_code`, `item`, `samsung`, `maker`, `lot_no`. Tiêu đề `Spec` tương ứng `description`; không dùng đồng thời hai tiêu đề này trong cùng file. Maker có thể trống nếu có Vendor; CKD vẫn cần Maker để đối chiếu. Mẫu cũ không có qty / lot_no giữ hai giá trị Stock đã lưu; có cột nhưng ô trống thì xóa giá trị tương ứng về chưa xác định.

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

## File Excel MM nhiều sheet

Tại Tra cứu MM → Nhập file, chọn trực tiếp file .xls hoặc .xlsx. Mỗi sheet dữ liệu cần các cột LOCATION, ITEM CD, ITEM NM, SPEC, BARCODE_NO và QTY. Các cột S/L, Receipt DT, BP_CD, BP_NM, CUST_LBL_NO, LOT_NO, MAKER, LABEL_STS được lưu kèm nếu có. Một ITEM có nhiều barcode / vị trí / lô vẫn giữ đủ từng dòng. QTY được phép có phần thập phân; không tự suy Selling Q’ty hoặc MOQ từ tồn kho.

Giới hạn Excel: 100 sheet, 250.000 dòng dữ liệu tổng cộng, 256 cột mỗi sheet; đọc trong worker có giới hạn bộ nhớ và thời gian. Sheet trống được báo riêng; sheet có dữ liệu nhưng không nhận diện được tiêu đề sẽ làm dừng toàn bộ lượt nhập, không bỏ qua âm thầm. Sau thành công, màn hình báo số dòng của mọi sheet và dòng tổng đã loại. Workbook và dữ liệu người dùng không được lưu trong Git.

Dữ liệu Excel MM được lưu theo BARCODE_NO trong bảng tồn chi tiết, tách khỏi danh mục CKD cũ cần Selling Q’ty / MOQ. Tra cứu MM hợp nhất hai nguồn; Stock ưu tiên đúng barcode của MM Excel và lưu snapshot QTY / Lot / Maker / Vendor tại lúc quét. Nhập Excel không sửa workbook SO / model list của CKD.

Bộ đọc SheetJS CE 0.20.3 được vendored tại lib/vendor, kèm giấy phép Apache-2.0 và thông báo nguồn; không cần tải thư viện lúc chạy.
