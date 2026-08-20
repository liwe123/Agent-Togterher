#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Agent Console —— 宿主机 Cursor 桥接客户端

功能：
  1. 周期心跳：向 Agent Console 后端上报节点 online，使 integration_nodes 中
     的 Cursor 节点（默认 id=1）状态保持 online。
  2. 任务轮询：扫描 docker bind mount 共享目录
     E:/Agents/data/bridges/workspace-*/Cursor/task-*/，发现带 PROMPT.md 且
     output.md 为空/缺失的任务目录。
  3. 打开 IDE：发现新任务时用本机 Cursor 启动器打开该任务目录。
  4. 完成判定：当 output.md 出现非空内容，标记任务完成并写 events.jsonl。

约束：仅依赖 Python 标准库（urllib/json/os/time/subprocess/logging/threading）。
     后端跑在 Docker 容器里，data/bridges 通过 bind mount 与宿主机实时共享，
     因此本脚本直接读宿主机路径即可看到后端生成的任务目录。
"""

import json
import logging
import os
import subprocess
import threading
import time
import urllib.error
import urllib.request

# ========================= 可配置常量（集中定义） =========================
# 后端 base URL（docker-compose 端口映射，宿主可直连 127.0.0.1:8000）
BACKEND_BASE = "http://127.0.0.1:8000"
# 集成节点 id（seed 数据：id=1, name="Cursor", mode="bridge"）
NODE_ID = 1
# bridges 根目录（docker-compose: ./data/bridges:/app/data/bridges）
BRIDGES_ROOT = "E:/Agents/data/bridges"
# 本机 Cursor 启动器路径（无头 IDE 启动器，可带目录参数打开项目）
CURSOR_BIN = "E:/cursor/resources/app/bin/cursor"
# Cursor 节点版本号（上报用）
CLIENT_VERSION = "1.0.0"
# 心跳间隔（秒）
HEARTBEAT_INTERVAL = 10
# 任务轮询间隔（秒）
POLL_INTERVAL = 5
# 单次 HTTP 请求超时（秒）
HTTP_TIMEOUT = 5
# 本地状态文件（记录已打开/已完成的任务，避免重复拉起）
STATE_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), ".cursor_client_state.json")
# 日志级别
LOG_LEVEL = logging.INFO

# 任务目录下的关键文件名
PROMPT_FILE = "PROMPT.md"
OUTPUT_FILE = "output.md"
EVENTS_FILE = "events.jsonl"

# ========================= 日志配置 =========================
logging.basicConfig(
    level=LOG_LEVEL,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
log = logging.getLogger("cursor_bridge_client")

# ========================= 共享状态 =========================
# 处理中的任务数（已被打开但还未完成），由轮询线程更新，心跳线程读取。
_processing_count = 0
_state_lock = threading.Lock()

# 已打开 / 已完成的任务目录绝对路径集合（内存 + 落盘）
_opened_tasks: set = set()
_completed_tasks: set = set()


# ========================= 状态持久化 =========================
def load_state():
    """从本地状态文件加载已打开/已完成任务记录。"""
    global _opened_tasks, _completed_tasks
    if not os.path.isfile(STATE_FILE):
        return
    try:
        with open(STATE_FILE, "r", encoding="utf-8") as f:
            data = json.load(f)
        _opened_tasks = set(data.get("opened", []))
        _completed_tasks = set(data.get("completed", []))
        log.info("已加载本地状态：已打开 %d 个，已完成 %d 个任务",
                 len(_opened_tasks), len(_completed_tasks))
    except Exception as e:  # noqa: BLE001
        log.warning("加载状态文件失败（忽略，使用空状态）：%s", e)


def save_state():
    """把已打开/已完成任务集合落盘。"""
    try:
        with open(STATE_FILE, "w", encoding="utf-8") as f:
            json.dump(
                {"opened": sorted(_opened_tasks), "completed": sorted(_completed_tasks)},
                f,
                ensure_ascii=False,
                indent=2,
            )
    except Exception as e:  # noqa: BLE001
        log.warning("保存状态文件失败：%s", e)


# ========================= 心跳线程 =========================
def post_heartbeat():
    """向后端发送一次心跳。成功返回节点当前状态字典，失败返回 None。"""
    global _processing_count
    url = f"{BACKEND_BASE}/api/v1/integrations/nodes/{NODE_ID}/heartbeat"
    with _state_lock:
        count = _processing_count
    payload = {
        "node_id": NODE_ID,
        "status": "online",
        "version": CLIENT_VERSION,
        "current_task_count": count,
    }
    data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        url,
        data=data,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=HTTP_TIMEOUT) as resp:
            body = resp.read().decode("utf-8")
            try:
                return json.loads(body)
            except Exception:  # noqa: BLE001
                return {"raw": body}
    except urllib.error.HTTPError as e:
        # 404（节点不存在）/ 其他 HTTP 错误：记录但不退出
        log.warning("心跳被拒绝（HTTP %s）：%s", e.code, e.reason)
    except urllib.error.URLError as e:
        # 后端未启动 / 网络错误：仅记录，持续重试
        log.warning("心跳失败（后端不可达）：%s", e.reason)
    except Exception as e:  # noqa: BLE001
        log.warning("心跳异常：%s", e)
    return None


def heartbeat_loop(stop_event: threading.Event):
    """心跳主循环：定期上报 online，捕获所有异常不退出。"""
    log.info("心跳线程启动：每 %d 秒上报节点 %d 为 online", HEARTBEAT_INTERVAL, NODE_ID)
    while not stop_event.is_set():
        post_heartbeat()
        # 用较短的等待粒度，保证能及时响应退出信号
        for _ in range(HEARTBEAT_INTERVAL):
            if stop_event.is_set():
                break
            time.sleep(1)


# ========================= 任务轮询 =========================
def is_output_done(task_dir: str) -> bool:
    """output.md 存在且内容非空（去除空白后仍有字符）即视为完成。"""
    out_path = os.path.join(task_dir, OUTPUT_FILE)
    if not os.path.isfile(out_path):
        return False
    try:
        with open(out_path, "r", encoding="utf-8") as f:
            content = f.read()
    except Exception:  # noqa: BLE001
        return False
    return len(content.strip()) > 0


def append_event(task_dir: str, event: str, note: str = ""):
    """向任务目录的 events.jsonl 追加一行 JSON 事件（append 模式）。"""
    path = os.path.join(task_dir, EVENTS_FILE)
    record = {
        "event": event,
        "ts": time.strftime("%Y-%m-%dT%H:%M:%S", time.localtime()),
        "note": note,
    }
    try:
        with open(path, "a", encoding="utf-8") as f:
            f.write(json.dumps(record, ensure_ascii=False) + "\n")
    except Exception as e:  # noqa: BLE001
        log.warning("写入事件日志失败 %s：%s", path, e)


def open_cursor(task_dir: str):
    """调用本机 Cursor 启动器打开任务目录。失败仅记录，不影响主循环。"""
    if not os.path.isfile(CURSOR_BIN):
        log.error("Cursor 启动器不存在：%s（跳过打开，但仍标记任务已发现）", CURSOR_BIN)
        return False
    try:
        # 使用 Popen 非阻塞启动，避免等待 IDE 退出；隐藏子进程窗口输出
        subprocess.Popen(
            [CURSOR_BIN, task_dir],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            # Windows 下分离控制台，避免占用当前终端
            creationflags=getattr(subprocess, "CREATE_NEW_CONSOLE", 0),
        )
        log.info("已用 Cursor 打开任务目录：%s", task_dir)
        return True
    except Exception as e:  # noqa: BLE001
        log.error("打开 Cursor 失败：%s", e)
        return False


def scan_tasks():
    """扫描所有任务目录，处理『打开 IDE』与『完成判定』。"""
    global _processing_count, _opened_tasks, _completed_tasks
    if not os.path.isdir(BRIDGES_ROOT):
        log.warning("bridges 根目录不存在：%s（等待后端生成任务）", BRIDGES_ROOT)
        return

    changed = False
    for ws_name in sorted(os.listdir(BRIDGES_ROOT)):
        ws_path = os.path.join(BRIDGES_ROOT, ws_name)
        if not os.path.isdir(ws_path):
            continue
        cursor_path = os.path.join(ws_path, "Cursor")
        if not os.path.isdir(cursor_path):
            continue
        # 遍历 task-* 目录
        try:
            task_names = sorted(os.listdir(cursor_path))
        except Exception:  # noqa: BLE001
            continue
        for t_name in task_names:
            if not t_name.startswith("task-"):
                continue
            task_dir = os.path.join(cursor_path, t_name)
            if not os.path.isdir(task_dir):
                continue

            # 必须有 PROMPT.md 才视为有效任务
            prompt_path = os.path.join(task_dir, PROMPT_FILE)
            if not os.path.isfile(prompt_path):
                continue

            abs_dir = os.path.abspath(task_dir)

            # 情况 A：尚未打开 => 拉起 Cursor
            if abs_dir not in _opened_tasks:
                log.info("发现新任务：%s", abs_dir)
                open_cursor(abs_dir)
                _opened_tasks.add(abs_dir)
                append_event(abs_dir, "client_opened", "Cursor IDE launched")
                changed = True

            # 情况 B：未完成但 output.md 已非空 => 标记完成
            if abs_dir not in _completed_tasks and is_output_done(task_dir):
                _completed_tasks.add(abs_dir)
                append_event(abs_dir, "client_completed", "output.md written")
                log.info("任务完成（output.md 已写入）：%s", abs_dir)
                changed = True

    if changed:
        # 处理中任务数 = 已打开 - 已完成
        in_progress = _opened_tasks - _completed_tasks
        with _state_lock:
            _processing_count = len(in_progress)
        save_state()
        log.info("当前处理中任务数：%d", _processing_count)


def poll_loop(stop_event: threading.Event):
    """任务轮询主循环。"""
    log.info("轮询线程启动：每 %d 秒扫描任务目录", POLL_INTERVAL)
    while not stop_event.is_set():
        try:
            scan_tasks()
        except Exception as e:  # noqa: BLE001
            # 单个任务/扫描异常不影响主循环
            log.error("轮询异常（已忽略）：%s", e)
        for _ in range(POLL_INTERVAL):
            if stop_event.is_set():
                break
            time.sleep(1)


# ========================= 主入口 =========================
def main():
    load_state()
    # 启动时先据已加载状态计算一次处理中任务数
    with _state_lock:
        global _processing_count
        _processing_count = len(_opened_tasks - _completed_tasks)

    stop_event = threading.Event()
    hb_thread = threading.Thread(target=heartbeat_loop, args=(stop_event,), daemon=True)
    poll_thread = threading.Thread(target=poll_loop, args=(stop_event,), daemon=True)
    hb_thread.start()
    poll_thread.start()

    log.info("Cursor 桥接客户端已启动（Ctrl+C 退出）")
    try:
        while True:
            time.sleep(1)
    except KeyboardInterrupt:
        log.info("收到中断信号，正在优雅退出……")
    finally:
        stop_event.set()
        hb_thread.join(timeout=5)
        poll_thread.join(timeout=5)
        save_state()
        log.info("客户端已退出。")


if __name__ == "__main__":
    main()
