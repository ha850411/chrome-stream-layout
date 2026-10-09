#!/usr/bin/env python3
import argparse
from datetime import datetime
import os
import subprocess
import zipfile

TARGETS = ['manifest.json', 'dashboard.html', 'live-player.html', 'assets', 'src']
PACKAGE_NAME = 'chrome-stream-layout'
ROOT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def get_git_hash() -> str:
    """取得當前 git 短 commit hash，若無法取得則回傳 unknown"""
    try:
        res = subprocess.run(
            ['git', 'rev-parse', '--short', 'HEAD'],
            cwd=ROOT_DIR,
            capture_output=True,
            text=True,
            check=True
        )
        git_hash = res.stdout.strip()
        if git_hash:
            return git_hash
    except Exception:
        pass
    return 'unknown'


def get_timestamp() -> str:
    """取得產出日期 YmdHis 格式字串 (例如 20261010005015)"""
    return datetime.now().strftime('%Y%m%d%H%M%S')


def build_filename(git_hash: str, timestamp: str) -> str:
    return f"{PACKAGE_NAME}-{git_hash}-{timestamp}.zip"


def pack(out_dir: str = None) -> str:
    if out_dir is None:
        out_dir = os.path.join(ROOT_DIR, 'dist')
    os.makedirs(out_dir, exist_ok=True)

    git_hash = get_git_hash()
    timestamp = get_timestamp()
    filename = build_filename(git_hash, timestamp)
    out_path = os.path.join(out_dir, filename)

    os.chdir(ROOT_DIR)
    with zipfile.ZipFile(out_path, 'w', zipfile.ZIP_DEFLATED) as zipf:
        for target in TARGETS:
            if os.path.isfile(target):
                zipf.write(target, target)
            elif os.path.isdir(target):
                for root, _, files in os.walk(target):
                    if '__pycache__' in root:
                        continue
                    for f in files:
                        if f.startswith('.'):
                            continue
                        full_p = os.path.join(root, f)
                        rel_p = os.path.relpath(full_p, ROOT_DIR)
                        zipf.write(full_p, rel_p)

    size_kb = os.path.getsize(out_path) / 1024
    rel_path = os.path.relpath(out_path, ROOT_DIR)
    print(f"✅ 成功打包: {rel_path} ({size_kb:.1f} KB)")
    print(f"📦 檔案名稱: {filename}")
    print(f"📁 儲存路徑: {out_path}")
    return out_path


def main():
    parser = argparse.ArgumentParser(description="Package Chrome Stream Layout extension")
    parser.add_argument(
        "--out-dir",
        default=os.path.join(ROOT_DIR, 'dist'),
        help="輸出目錄 (預設為專案內 dist/ 目錄)"
    )
    args = parser.parse_args()
    pack(args.out_dir)


if __name__ == '__main__':
    main()
