# Chrome Web Store 素材

此目錄包含 Chrome Stream Layout 的中英文商店文案與可直接上傳的圖片。

## 檔案

- `store-listing.zh-TW.md`：繁體中文名稱、簡短說明、詳細說明與圖片替代文字
- `store-listing.en.md`：英文名稱、summary、詳細說明與圖片替代文字
- `images/zh-TW/`：繁體中文商店截圖，皆為 1280×800 PNG
- `images/en/`：英文商店截圖，皆為 1280×800 PNG
- `images/global/promo-small-440x280.png`：全語系共用的小型宣傳圖
- `images/global/promo-marquee-1400x560.png`：全語系共用的 Marquee 宣傳圖
- `generate_store_assets.py`：以現有 extension icon 重產所有圖片的腳本

## 上傳建議

1. 中文商店語系使用 `images/zh-TW/` 的 3 張截圖。
2. 英文商店語系使用 `images/en/` 的 3 張截圖。
3. 小型與 Marquee 宣傳圖無法依語系分開，使用 `images/global/` 的圖檔。
4. 商店 icon 直接使用專案內的 `assets/icon128.png`。
5. 上架前以實際安裝版本再確認畫面與文案功能一致。

## 重新產生圖片

```bash
python docs/generate_store_assets.py
```

腳本需要 Pillow，並使用 Windows 內建的 Segoe UI 與 Microsoft JhengHei 字型。圖片中的來源畫面為無品牌的抽象示意，不代表或暗示與特定串流平台合作。

## 官方規格依據

- 截圖：1280×800 或 640×400，至少 1 張、最多 5 張；建議使用 1280×800。
- 小型宣傳圖：440×280 PNG 或 JPEG。
- Marquee 宣傳圖：1400×560 PNG 或 JPEG，選填。
- 簡短說明：純文字，最多 132 個字元。

參考：[Creating a great listing page](https://developer.chrome.com/docs/webstore/best-listing)、[Complete your listing information](https://developer.chrome.com/docs/webstore/cws-dashboard-listing/)。
