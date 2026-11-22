# 내 컴퓨터에서 시험할 때 쓰는 서버 (배포에는 안 쓰임, .vercelignore로 제외)
# 보통 서버와 같지만 "저장해 두지 말 것(no-store)"을 알려서, 파일을 고치면 바로 새 내용이 보이게 함
import http.server
import sys


class NoCacheHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()


if __name__ == '__main__':
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8123
    http.server.ThreadingHTTPServer(('127.0.0.1', port), NoCacheHandler).serve_forever()
