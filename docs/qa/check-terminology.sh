#!/usr/bin/env bash
# check-terminology.sh — 检查中文文档术语一致性
# 用法: bash docs/qa/check-terminology.sh
# 退出码: 0=PASS, 1=FAIL

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"

# Key term pairs to validate (wrong_term → correct_term)
# 关键术语验证对（错误翻译 → 正确翻译）
declare -A WRONG_TERMS
WRONG_TERMS["信息素引擎"]="OK"                  # correct, skip / 正确用法
WRONG_TERMS["费洛蒙"]="信息素"                   # wrong translation / 错误翻译
WRONG_TERMS["断路器"]="熔断器"                   # inconsistent / 术语不统一
WRONG_TERMS["子智能体"]="子代理"                 # inconsistent / 术语不统一
WRONG_TERMS["消息队列"]="消息总线"               # wrong concept / 概念不对应
WRONG_TERMS["仪表板"]="Dashboard"               # mixed style → keep English / 保持英文
WRONG_TERMS["仪表盘"]="Dashboard"               # mixed style → keep English / 保持英文（控制台指南中除外）
WRONG_TERMS["知识库"]="知识图谱"                 # wrong concept / 概念不对应
WRONG_TERMS["遗传算法"]="GEP"                    # keep abbreviation / 保持缩写

# Collect zh-CN files
# 收集中文文件
ZH_FILES=()
while IFS= read -r -d '' f; do
  ZH_FILES+=("$f")
done < <(find "$ROOT_DIR/docs/zh-CN" -name "*.md" -print0 2>/dev/null)

if [ -f "$ROOT_DIR/README.zh-CN.md" ]; then
  ZH_FILES+=("$ROOT_DIR/README.zh-CN.md")
fi

ISSUES=0
ISSUE_LOG=""

for wrong in "${!WRONG_TERMS[@]}"; do
  correct="${WRONG_TERMS[$wrong]}"
  if [ "$correct" = "OK" ]; then
    continue
  fi
  for f in "${ZH_FILES[@]}"; do
    REL_PATH="${f#$ROOT_DIR/}"
    MATCHES=$(grep -Fn "$wrong" "$f" 2>/dev/null || true)
    if [ -n "$MATCHES" ]; then
      COUNT=$(echo "$MATCHES" | wc -l)
      ISSUES=$((ISSUES + COUNT))
      ISSUE_LOG+="  $REL_PATH: '$wrong' should be '$correct' ($COUNT hits)\n"
    fi
  done
done

echo "=== 术语一致性检查 / Terminology Consistency Check ==="
echo "Files scanned: ${#ZH_FILES[@]}"
echo "Terms checked: ${#WRONG_TERMS[@]}"
echo "Issues: $ISSUES"

if [ $ISSUES -gt 0 ]; then
  echo ""
  echo "Issues found:"
  echo -e "$ISSUE_LOG"
  echo "FAIL"
  exit 1
else
  echo "PASS"
  exit 0
fi
