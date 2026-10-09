.PHONY: help pack clean test test-browser icons

help:
	@echo "可用指令:"
	@echo "  make pack         - 快速打包擴充功能成 zip (並同步複製到 Windows 桌面)"
	@echo "  make clean        - 清除本地打包產生的 zip 檔案"
	@echo "  make test         - 執行單元測試"
	@echo "  make test-browser - 執行瀏覽器整合測試"
	@echo "  make icons        - 重新生成擴充功能圖示"

# 快速打包
pack:
	@python3 scripts/pack.py

# 清理產出
clean:
	@rm -f chrome-stream-layout.zip
	@echo "🧹 已清理本地 zip 檔案"

# 執行測試
test:
	@npm test

test-browser:
	@npm run test:browser

# 重新生成圖示
icons:
	@python3 scripts/generate_icons.py
