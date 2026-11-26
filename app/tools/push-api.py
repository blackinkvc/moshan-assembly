#!/usr/bin/env python3
"""用 GitHub REST API 推送到 main。

为什么需要它：本机到 github.com:443 的 HTTPS 与 SSH 都不通（代理对 github.com
返回 502），但 api.github.com 可达。所以提交改走 Git Data API，
而不是 `git push`。

做法：比对「远端 main 的树」与「本地 HEAD 的树」，只上传有差异的文件
（blob sha 用同一套哈希，可直接比较），拼一棵新树、建一个提交、移动分支。

用法：
    python3 tools/push-api.py                 # 提交信息取 HEAD 的
    python3 tools/push-api.py -m "message"    # 覆盖提交信息

令牌来源：macOS 钥匙串（security find-internet-password -s github.com）
或环境变量 GITHUB_TOKEN。
"""
import argparse
import base64
import json
import subprocess
import sys
import urllib.error
import urllib.request

OWNER, REPO, BRANCH = "blackinkvc", "moshan-assembly", "main"
API = f"https://api.github.com/repos/{OWNER}/{REPO}"


def token():
    try:
        return subprocess.check_output(
            ["security", "find-internet-password", "-s", "github.com", "-w"], text=True
        ).strip()
    except Exception:
        import os

        t = os.environ.get("GITHUB_TOKEN")
        if not t:
            sys.exit("找不到令牌：钥匙串里没有 github.com，也没设 GITHUB_TOKEN")
        return t


TOKEN = token()


def api(method, path, body=None):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(
        API + path if path.startswith("/") else path,
        data=data,
        method=method,
        headers={
            "Authorization": f"Bearer {TOKEN}",
            "Accept": "application/vnd.github+json",
            "Content-Type": "application/json",
            "User-Agent": "moshan-push",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=180) as r:
            return json.loads(r.read().decode() or "{}")
    except urllib.error.HTTPError as e:
        sys.exit(f"{method} {path} 失败：{e.code} {e.read().decode()[:300]}")


def git(*args, text=True):
    return subprocess.check_output(["git", *args], text=text).strip()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("-m", "--message")
    args = ap.parse_args()

    head = api("GET", f"/git/ref/heads/{BRANCH}")["object"]["sha"]
    remote = {e["path"]: e["sha"] for e in api("GET", f"/git/trees/{head}?recursive=1")["tree"] if e["type"] == "blob"}

    local = {}
    for line in git("ls-tree", "-r", "HEAD").split("\n"):
        if not line:
            continue
        meta, path = line.split("\t", 1)
        local[path] = meta.split()[2]

    changed = sorted(p for p, sha in local.items() if remote.get(p) != sha)
    gone = sorted(p for p in remote if p not in local)
    if not changed and not gone:
        print("远端已是最新，无需推送")
        return

    print(f"远端 {head[:8]} · 待传 {len(changed)} 个文件" + (f"，删除 {len(gone)} 个" if gone else ""))

    tree = []
    for path in changed:
        raw = subprocess.check_output(["git", "cat-file", "blob", f"HEAD:{path}"])
        blob = api("POST", "/git/blobs", {"content": base64.b64encode(raw).decode(), "encoding": "base64"})
        tree.append({"path": path, "mode": "100644", "type": "blob", "sha": blob["sha"]})
        print(f"  + {path} ({len(raw)}B)")
    for path in gone:
        tree.append({"path": path, "mode": "100644", "type": "blob", "sha": None})
        print(f"  - {path}")

    base_tree = api("GET", f"/git/commits/{head}")["tree"]["sha"]
    new_tree = api("POST", "/git/trees", {"base_tree": base_tree, "tree": tree})["sha"]

    msg = args.message or git("log", "-1", "--format=%B")
    name = git("config", "user.name")
    email = git("config", "user.email")
    commit = api(
        "POST",
        "/git/commits",
        {
            "message": msg,
            "tree": new_tree,
            "parents": [head],
            "author": {"name": name, "email": email},
            "committer": {"name": name, "email": email},
        },
    )
    api("PATCH", f"/git/refs/heads/{BRANCH}", {"sha": commit["sha"], "force": True})
    print(f"已推送 {commit['sha'][:8]} → {commit['html_url']}")


if __name__ == "__main__":
    main()
