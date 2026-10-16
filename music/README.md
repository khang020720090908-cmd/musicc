# Sóng · Media Hub

Ứng dụng web nghe, xem và tải nhạc/video từ YouTube và SoundCloud (FastAPI + yt-dlp + Tailwind).

## Cài đặt
```bash
python -m venv .venv && source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -r requirements.txt
```
Cài thêm **ffmpeg** (bắt buộc để xuất MP3 320kbps và ghép video+audio):
`sudo apt install ffmpeg` · `brew install ffmpeg` · `winget install ffmpeg`

## Chạy
```bash
uvicorn app.main:app --reload
```
Mở http://127.0.0.1:8000

## Cấu trúc
```
app/
  main.py                  # khởi tạo FastAPI, static, template
  routes/search.py         # /api/youtube/search, /api/soundcloud/search
  routes/stream.py         # /api/stream/audio (proxy hỗ trợ Range)
  routes/download.py       # /api/download/youtube, /api/download/soundcloud
  services/ytdlp_service.py# toàn bộ logic yt-dlp
  templates/index.html     # SPA
  static/app.js, style.css
```

## Lưu ý
- Chế độ "Xem video" dùng YouTube Iframe; "Nghe nhạc" phát audio qua proxy backend nên visualizer đọc được âm thanh thật. Với iframe, visualizer là mô phỏng (YouTube không cho đọc âm thanh).
- Luôn cập nhật yt-dlp (`pip install -U yt-dlp`) vì YouTube thay đổi thường xuyên.
- Chỉ tải nội dung bạn có quyền sử dụng; tuân thủ điều khoản của YouTube/SoundCloud.
- Chỉ nên chạy cá nhân/nội bộ. Nếu đưa lên internet, hãy thêm xác thực và giới hạn tốc độ.

## Xử lý lỗi 403 khi phát (`/api/stream/audio` trả 502/403)
Lỗi này do YouTube từ chối link luồng, không phải do ứng dụng. Thử lần lượt:
1. **Cập nhật yt-dlp:** `pip install -U "yt-dlp[default]"` (gói `default` có bộ giải thử thách JS của YouTube).
2. **Cài môi trường chạy JS:** YouTube hiện cần Deno (khuyên dùng) hoặc Node.js để yt-dlp giải được link. Cài `deno` hoặc `node` rồi khởi động lại.
3. **Kiểm tra bằng dòng lệnh** trên cùng máy chủ:
   `yt-dlp -f bestaudio -g "https://www.youtube.com/watch?v=pajHsiqQt-E"` rồi `curl -I -r 0-1000 "<link>"`. Nếu curl vẫn 403 thì lỗi nằm ở yt-dlp/IP, không ở code web.
4. **IP máy chủ bị chặn** (VPS, cloud, hosting thường bị YouTube chặn): xuất cookies từ trình duyệt đã đăng nhập, rồi chạy
   `YTDLP_COOKIES=/path/cookies.txt uvicorn app.main:app` (hoặc `YTDLP_COOKIES_BROWSER=chrome` nếu chạy trên máy cá nhân).
5. Thử ép client khác: `YTDLP_YT_CLIENTS=android_vr,tv uvicorn app.main:app`.
Nếu vẫn lỗi, hãy dán đầu ra của lệnh ở bước 3 để xác định nguyên nhân.

### Cơ chế dự phòng khi nguồn phát từ chối
Khi phát audio YouTube, máy chủ thử lần lượt: link mặc định, rồi các client `android_vr`, `tv`, `web_safari`, `ios` (có kiểm tra thử trước khi dùng);
nếu vẫn bị từ chối, yt-dlp sẽ tải file âm thanh về cache tạm rồi phát từ đó. Nếu cả hai đều thất bại, giao diện tự chuyển sang
trình phát YouTube nhúng (chạy bằng IP của người xem nên không bị chặn theo IP máy chủ). Tính năng Tải MP3/Video vẫn cần yt-dlp trên máy chủ hoạt động được.

### Khi yt-dlp trên máy chủ vẫn 403 ở mọi client
Đó là dấu hiệu YouTube chặn IP máy chủ. Cách xử lý, theo thứ tự hiệu quả:
- Chạy app trên máy cá nhân (IP nhà), hoặc
- Dùng proxy dân cư: `YTDLP_PROXY=http://user:pass@host:port uvicorn app.main:app`, hoặc
- Dùng cookies: `YTDLP_COOKIES=/path/cookies.txt` (nên dùng tài khoản phụ).
Kiểm tra nhanh: `yt-dlp --version`, rồi `yt-dlp -v -f bestaudio -o test.m4a "<link YouTube>"`. Nếu lệnh này cũng 403 thì lỗi không nằm ở code web.

### Môi trường chạy JS và IPv4/IPv6
- yt-dlp 2025.11 trở lên cần `deno` (mặc định) hoặc `node` để giải thử thách của YouTube. App tự dùng `node` nếu không thấy `deno`.
  Termux: `pkg install nodejs`. Linux/macOS: cài deno hoặc node qua trình quản lý gói.
- Link googlevideo gắn với IP lúc trích xuất (tham số `ip=`). App tự ép proxy dùng đúng IPv4/IPv6 tương ứng.
- Nhớ cập nhật yt-dlp **bên trong venv của app**: `pip install -U "yt-dlp[default]"`.

### Lỗi 403 khi tải (máy có cả IPv4 và IPv6)
App mặc định ép yt-dlp dùng IPv4 (`YTDLP_IP=4`) để bước lấy link và bước tải dùng cùng một IP. Nếu mạng bạn chỉ ổn với IPv6, chạy
`YTDLP_IP=6 uvicorn app.main:app`; muốn để yt-dlp tự chọn: `YTDLP_IP=auto`.
Thử tay trên Termux: `yt-dlp -4 -f bestaudio -o test.m4a "<link>"` (so sánh với bản không có `-4`).
