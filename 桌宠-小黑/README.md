# 小黑 Codex 桌宠

按小黑人形参考图制作的透明背景桌宠，包含 9 种状态、57 帧动画：坐姿眨眼、左右跑步、挥手、跳跃、失落、趴下等待确认、任务运行跑步、完成后抬眼眨眼。

## 文件结构

```text
README.md
xiaohei/
  pet.json          # 桌宠名称与素材路径
  spritesheet.webp  # 透明动画图集
```

请将 `pet.json` 和 `spritesheet.webp` 放在同一目录，勿修改二者的对应文件名。

## 安装（macOS / Linux）

适用于支持本地自定义桌宠的 Codex 桌面应用。在本工作区根目录打开终端，执行：

```sh
pet_dir="${CODEX_HOME:-$HOME/.codex}/pets/xiaohei"
mkdir -p "$pet_dir"
cp ./xiaohei/pet.json ./xiaohei/spritesheet.webp "$pet_dir/"
```

默认安装目录为 `~/.codex/pets/xiaohei/`。如果设置了 `CODEX_HOME`，则安装到该目录下的 `pets/xiaohei/`。上述命令会覆盖目标目录中同名的小黑文件；如需保留旧版，请先备份。

也可以手动复制整个 `xiaohei` 文件夹到 `~/.codex/pets/`。

## 启用

1. 安装完成后，打开 Codex 的桌宠选择界面。
2. 选择「小黑」。
3. 如果列表没有刷新，完全退出并重新打开 Codex 后再查看。

本工作区的成品已复制到当前电脑的 `/Users/gump/.codex/pets/xiaohei/`，但尚未确认在应用内选中启用。若所用版本没有本地自定义桌宠入口，仅复制文件不能保证显示。

## 卸载

先在应用内切换到其他桌宠，再删除安装目录下的 `xiaohei` 文件夹即可。

## 素材规格

- 图集：1536 × 1872，8 列 × 9 行。
- 单帧：192 × 208，WebP RGBA 透明背景。
- 已通过图集格式校验与动作视觉检查。
