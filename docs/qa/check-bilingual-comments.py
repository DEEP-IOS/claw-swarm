#!/usr/bin/env python3
"""
check-bilingual-comments.py
Scan src/**/*.js for comment bilingual coverage.
扫描源码注释的中英双语覆盖率。

A file is "bilingual-covered" if it contains at least one Chinese character
AND at least one English word in its comments (// or /* */ blocks).
一个文件被视为"双语覆盖"，当其注释中同时包含中文字符和英文单词。

Exit code: 0 if uncovered_files=0, else 1
"""

import os
import re
import sys
import json

def extract_comments(content):
    """Extract all comments from JS source.
    提取 JS 源码中的所有注释。"""
    comments = []
    # Single-line comments / 单行注释
    for m in re.finditer(r'//(.*)$', content, re.MULTILINE):
        comments.append(m.group(1))
    # Multi-line comments / 多行注释
    for m in re.finditer(r'/\*(.+?)\*/', content, re.DOTALL):
        comments.append(m.group(1))
    return '\n'.join(comments)

def has_chinese(text):
    """Check if text contains Chinese characters.
    检查文本是否包含中文字符。"""
    return bool(re.search(r'[\u4e00-\u9fff]', text))

def has_english(text):
    """Check if text contains English words (4+ letters).
    检查文本是否包含英文单词（4个以上字母）。"""
    return bool(re.search(r'[A-Za-z]{4,}', text))

def scan_directory(src_dir):
    """Scan all .js files in src directory.
    扫描 src 目录下所有 .js 文件。"""
    results = {
        'total_files': 0,
        'total_comments': 0,
        'bilingual_files': 0,
        'english_only_files': [],
        'chinese_only_files': [],
        'no_comment_files': [],
        'uncovered_files': []
    }

    for root, dirs, files in os.walk(src_dir):
        # Skip node_modules and dist / 跳过 node_modules 和 dist
        dirs[:] = [d for d in dirs if d not in ('node_modules', 'dist')]
        for fname in files:
            if not fname.endswith('.js'):
                continue
            fpath = os.path.join(root, fname)
            rel_path = os.path.relpath(fpath, os.path.dirname(src_dir))
            results['total_files'] += 1

            try:
                with open(fpath, 'r', encoding='utf-8') as f:
                    content = f.read()
            except Exception:
                results['uncovered_files'].append(rel_path)
                continue

            comment_text = extract_comments(content)
            if not comment_text.strip():
                results['no_comment_files'].append(rel_path)
                results['uncovered_files'].append(rel_path)
                continue

            comment_count = len(re.findall(r'(?://|/\*)', content))
            results['total_comments'] += comment_count

            has_zh = has_chinese(comment_text)
            has_en = has_english(comment_text)

            if has_zh and has_en:
                results['bilingual_files'] += 1
            elif has_en and not has_zh:
                results['english_only_files'].append(rel_path)
                results['uncovered_files'].append(rel_path)
            elif has_zh and not has_en:
                results['chinese_only_files'].append(rel_path)
                results['uncovered_files'].append(rel_path)
            else:
                results['uncovered_files'].append(rel_path)

    return results

def main():
    # Find repo root / 查找仓库根目录
    script_dir = os.path.dirname(os.path.abspath(__file__))
    root_dir = os.path.dirname(os.path.dirname(script_dir))
    src_dir = os.path.join(root_dir, 'src')

    if not os.path.isdir(src_dir):
        print(f"ERROR: src directory not found at {src_dir}")
        sys.exit(1)

    results = scan_directory(src_dir)

    # Generate report / 生成报告
    report_path = os.path.join(script_dir, 'comment-bilingual-report.md')
    with open(report_path, 'w', encoding='utf-8') as f:
        f.write('# Comment Bilingual Coverage Report\n')
        f.write('# 代码注释双语覆盖报告\n\n')
        f.write(f'Total JS files scanned: {results["total_files"]}\n')
        f.write(f'Total comments found: {results["total_comments"]}\n')
        f.write(f'Bilingual files: {results["bilingual_files"]}\n')
        f.write(f'English-only files: {len(results["english_only_files"])}\n')
        f.write(f'Chinese-only files: {len(results["chinese_only_files"])}\n')
        f.write(f'No-comment files: {len(results["no_comment_files"])}\n')
        f.write(f'**uncovered_files: {len(results["uncovered_files"])}**\n\n')

        if results['uncovered_files']:
            f.write('## Uncovered Files\n\n')
            for fp in sorted(results['uncovered_files']):
                f.write(f'- {fp}\n')

    # Console output / 控制台输出
    print(f'=== Comment Bilingual Coverage / 注释双语覆盖 ===')
    print(f'total_files={results["total_files"]}')
    print(f'bilingual_files={results["bilingual_files"]}')
    print(f'english_only={len(results["english_only_files"])}')
    print(f'chinese_only={len(results["chinese_only_files"])}')
    print(f'no_comments={len(results["no_comment_files"])}')
    print(f'uncovered_files={len(results["uncovered_files"])}')
    print(f'Report: {report_path}')

    if results['uncovered_files']:
        print('\nUncovered:')
        for fp in sorted(results['uncovered_files']):
            print(f'  {fp}')
        sys.exit(1)
    else:
        print('PASS')
        sys.exit(0)

if __name__ == '__main__':
    main()
