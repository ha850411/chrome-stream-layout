#!/usr/bin/env python3
import os
import shutil
import zipfile

TARGETS = ['manifest.json', 'dashboard.html', 'live-player.html', 'assets', 'src']
OUTPUT_NAME = 'chrome-stream-layout.zip'
ROOT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

def main():
    os.chdir(ROOT_DIR)
    out_path = os.path.join(ROOT_DIR, OUTPUT_NAME)

    with zipfile.ZipFile(out_path, 'w', zipfile.ZIP_DEFLATED) as zipf:
        for target in TARGETS:
            if os.path.isfile(target):
                zipf.write(target, target)
            elif os.path.isdir(target):
                for root, _, files in os.walk(target):
                    for f in files:
                        full_p = os.path.join(root, f)
                        rel_p = os.path.relpath(full_p, ROOT_DIR)
                        zipf.write(full_p, rel_p)

    size_kb = os.path.getsize(out_path) / 1024
    print(f"✅ 成功打包: {out_path} ({size_kb:.1f} KB)")

    # 嘗試同步複製到 Windows 桌面 (WSL 環境適用)
    desktop_candidates = [
        os.path.expanduser('/mnt/c/Users/le850/OneDrive/桌面'),
        os.path.expanduser('/mnt/c/Users/le850/Desktop')
    ]
    for desktop in desktop_candidates:
        if os.path.isdir(desktop):
            dest = os.path.join(desktop, OUTPUT_NAME)
            shutil.copy2(out_path, dest)
            print(f"📋 已同步複製到 Windows 桌面: {dest}")
            break

if __name__ == '__main__':
    main()
