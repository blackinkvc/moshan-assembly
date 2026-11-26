// macOS 上发布时不要弹出多余的控制台窗口
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    moshan_assembly_lib::run()
}
