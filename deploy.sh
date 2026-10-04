#!/usr/bin/env bash
#
# 冰島任務 · 一鍵部署到 GitHub Pages
#
# 用法（在 iceland-trip 資料夾裡執行）：
#   ./deploy.sh                 # repo 名稱預設 iceland-trip
#   ./deploy.sh my-iceland      # 自訂 repo 名稱
#   ./deploy.sh my-iceland "更新第 5 天行程"   # 第二個參數是 commit 訊息
#
# 會做的事：
#   1. 沒有 git 就 git init（分支 main）
#   2. git add -A + commit
#   3. 有 gh 而且已登入：建立公開 repo 並 push（repo 已存在就直接 push）
#   4. 開啟 GitHub Pages（main / root），已開啟就略過
#   5. 印出網址 https://<帳號>.github.io/<repo>/
#
set -e

cd "$(dirname "$0")"

REPO_NAME="${1:-iceland-trip}"
COMMIT_MSG="${2:-更新冰島任務行程網頁 $(date '+%Y-%m-%d %H:%M')}"

info() { printf '\033[1;36m▸ %s\033[0m\n' "$*"; }
ok()   { printf '\033[1;32m✓ %s\033[0m\n' "$*"; }
warn() { printf '\033[1;33m! %s\033[0m\n' "$*"; }
fail() { printf '\033[1;31m✗ %s\033[0m\n' "$*" >&2; exit 1; }

command -v git >/dev/null 2>&1 || fail "找不到 git，請先安裝（macOS：xcode-select --install）"

# ---------- gh 狀態 ----------
HAS_GH=0
if command -v gh >/dev/null 2>&1 && gh auth status >/dev/null 2>&1; then
  HAS_GH=1
  OWNER="$(gh api user -q .login)"
fi

# ---------- 1. git init ----------
if [ ! -d .git ]; then
  info "初始化 git repo"
  git init -b main >/dev/null 2>&1 || git init >/dev/null
  ok "git init 完成"
fi

# commit 需要作者資訊；沒設定的話用 GitHub 帳號（只寫進這個 repo，不動全域設定）
if [ -z "$(git config user.email || true)" ] || [ -z "$(git config user.name || true)" ]; then
  if [ "$HAS_GH" = 1 ]; then
    GH_ID="$(gh api user -q .id)"
    git config user.name  "$OWNER"
    git config user.email "${GH_ID}+${OWNER}@users.noreply.github.com"
    warn "沒有設定 git 作者，這個 repo 先用 $OWNER <${GH_ID}+${OWNER}@users.noreply.github.com>"
  else
    fail "請先設定 git 作者：git config --global user.name \"你的名字\" && git config --global user.email \"you@example.com\""
  fi
fi

# ---------- 2. add + commit ----------
git add -A
if git diff --cached --quiet; then
  warn "沒有新的變更，略過 commit"
else
  git commit -m "$COMMIT_MSG" >/dev/null
  ok "已 commit：$COMMIT_MSG"
fi

git rev-parse --verify HEAD >/dev/null 2>&1 || fail "repo 裡還沒有任何 commit，請確認資料夾內有檔案"
git branch -M main

# ---------- 沒有 gh：給手動步驟 ----------
if [ "$HAS_GH" != 1 ]; then
  warn "沒有偵測到已登入的 GitHub CLI（gh），請手動完成："
  cat <<EOF

  1. 安裝並登入：brew install gh && gh auth login
     （或到 https://github.com/new 建一個公開 repo，名稱：$REPO_NAME）
  2. git remote add origin https://github.com/<你的帳號>/$REPO_NAME.git
  3. git push -u origin main
  4. GitHub repo → Settings → Pages → Source 選 Deploy from a branch → main / (root) → Save
  5. 網址：https://<你的帳號>.github.io/$REPO_NAME/

EOF
  exit 0
fi

# ---------- 3. 建 repo / push ----------
if gh repo view "$OWNER/$REPO_NAME" >/dev/null 2>&1; then
  info "GitHub 上已經有 $OWNER/$REPO_NAME，直接 push"
  if ! git remote get-url origin >/dev/null 2>&1; then
    git remote add origin "https://github.com/$OWNER/$REPO_NAME.git"
  fi
  git push -u origin main
else
  info "建立公開 repo $OWNER/$REPO_NAME 並 push"
  if git remote get-url origin >/dev/null 2>&1; then
    # 已有 origin（例如之前手動加過）→ 只建 repo，再 push 到既有的 origin
    gh repo create "$REPO_NAME" --public
    git push -u origin main
  else
    gh repo create "$REPO_NAME" --public --source=. --push
  fi
fi
ok "程式碼已上傳：https://github.com/$OWNER/$REPO_NAME"

# ---------- 4. 開啟 GitHub Pages ----------
info "開啟 GitHub Pages（main / root）"
if gh api -X POST "repos/$OWNER/$REPO_NAME/pages" \
     -f "source[branch]=main" -f "source[path]=/" >/dev/null 2>&1; then
  ok "GitHub Pages 已開啟"
else
  warn "GitHub Pages 可能已經開啟過了（或權限不足），略過"
fi

# ---------- 5. 網址 ----------
if [ "$REPO_NAME" = "$OWNER.github.io" ]; then
  URL="https://$OWNER.github.io/"
else
  URL="https://$OWNER.github.io/$REPO_NAME/"
fi
PAGES_URL="$(gh api "repos/$OWNER/$REPO_NAME/pages" -q .html_url 2>/dev/null || true)"
[ -n "$PAGES_URL" ] && URL="$PAGES_URL"

echo
ok "完成！第一次部署大約要等 1～2 分鐘"
printf '\n   \033[1m%s\033[0m\n\n' "$URL"
echo "   部署進度：https://github.com/$OWNER/$REPO_NAME/actions"
echo
