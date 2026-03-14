#!/usr/bin/env bash
# check-zh-style.sh — 扫描中文文档的机翻腔禁词
# 用法: bash docs/qa/check-zh-style.sh
# 退出码: 0=PASS, 1=FAIL

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
BANNED_FILE="$SCRIPT_DIR/zh-banned-phrases.txt"

if [ ! -f "$BANNED_FILE" ]; then
  echo "ERROR: $BANNED_FILE not found"
  exit 1
fi

# Collect all zh-CN markdown files + README.zh-CN.md
# 收集所有中文 markdown 文件
ZH_FILES=()
while IFS= read -r -d '' f; do
  ZH_FILES+=("$f")
done < <(find "$ROOT_DIR/docs/zh-CN" -name "*.md" -print0 2>/dev/null)

if [ -f "$ROOT_DIR/README.zh-CN.md" ]; then
  ZH_FILES+=("$ROOT_DIR/README.zh-CN.md")
fi

if [ ${#ZH_FILES[@]} -eq 0 ]; then
  echo "ERROR: No zh-CN files found"
  exit 1
fi

VIOLATIONS=0
VIOLATION_LOG=""

# Read banned phrases (skip comments and empty lines)
# 读取禁词（跳过注释和空行）
PHRASES=()
while IFS= read -r line; do
  line="${line%%#*}"       # strip inline comments / 去除行内注释
  line="${line%"${line##*[![:space:]]}"}"  # trim trailing / 去除尾部空白
  line="${line#"${line%%[![:space:]]*}"}"  # trim leading / 去除前部空白
  if [ -n "$line" ]; then
    PHRASES+=("$line")
  fi
done < "$BANNED_FILE"

for f in "${ZH_FILES[@]}"; do
  REL_PATH="${f#$ROOT_DIR/}"
  for phrase in "${PHRASES[@]}"; do
    # Use grep -Fn for fixed-string matching
    # 使用 grep -Fn 做固定字符串匹配
    MATCHES=$(grep -Fn "$phrase" "$f" 2>/dev/null || true)
    if [ -n "$MATCHES" ]; then
      COUNT=$(echo "$MATCHES" | wc -l)
      VIOLATIONS=$((VIOLATIONS + COUNT))
      VIOLATION_LOG+="  $REL_PATH: '$phrase' ($COUNT hits)\n"
    fi
  done
done

echo "=== 中文机翻腔检查 / Chinese Style Check ==="
echo "Files scanned: ${#ZH_FILES[@]}"
echo "Banned phrases: ${#PHRASES[@]}"
echo "Violations: $VIOLATIONS"

if [ $VIOLATIONS -gt 0 ]; then
  echo ""
  echo "Violations found:"
  echo -e "$VIOLATION_LOG"
  echo "FAIL"
  exit 1
else
  echo "PASS"
  exit 0
fi
