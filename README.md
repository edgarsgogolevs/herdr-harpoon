# Harpoon for Herdr

[Harpoon](https://github.com/ThePrimeagen/harpoon)-style marks for the
[Herdr](https://herdr.dev) app. Mark the terminals you keep going back to,
then jump to any of them with two keys. Marks work across machines: a terminal
on a remote Herdr machine (`arch/t2`) is marked and jumped to the same way as
a local one.

<!-- ![Harpoon](preview.png) -->

## What it does

Press `ctrl-space h` and a small popup lists your marks. The next key decides:

| Keys | Does |
|---|---|
| `ctrl-space h a` | Mark the focused terminal (does nothing if it's already marked) |
| `ctrl-space h 1`–`9` | Go to that mark: selects its space and tab, focuses its pane |
| `ctrl-space h h` | Edit the marks in a floating, vim-like window |
| `esc` | Close the popup |

You can also click a mark in the popup to go to it.

### The marks editor

The editor is drawn by the mod itself (no terminal, no nvim), so it opens
instantly. It knows enough vim to reorder and delete lines:

| | |
|---|---|
| Move | `h j k l`, arrows, `0` `^` `$`, `w` `b`, `gg` `G`, `{n}G`, counts (`3j`) |
| Delete / yank | `dd` `{n}dd` `dj` `dk` `dG` `dgg`, `yy` `Y`, `p` `P` (`ddp` swaps lines) |
| Visual line | `V`, move, then `d`/`x` delete, `y` yank, `o` other end, `esc` cancel |
| Undo | `u`, `ctrl-r` |
| Commands | `:w` `:q` `:q!` `:wq` `:x` `:{line}`, `ZZ` `ZQ` |
| Extras | `Enter` goes to the mark under the cursor (saving first) |

- **`esc` in normal mode saves and closes**, like closing Harpoon's quick menu.
  Use `:q!` to drop changes; `:q` refuses while there are unsaved changes.
- There is no insert mode: add marks with `ctrl-space h a`.
- The window can be dragged and reopens where you left it.

### The marks file

Marks live in `~/.config/herdr-app/data/harpoon/marks.txt`, one per line. The
first word is the terminal address; the rest of the line is a note (space,
tab and program when the mark was added) and is ignored. Line order is slot
order. Lines starting with `#` are skipped.

```
t11  herdr config › 4 · Claude Code
t4  herdr config › herdring · Python
arch/t2  arch: ~ › 1 · zsh
```

- A mark is a terminal, not a folder. If its terminal ends, the popup shows
  `(gone)` and jumping to it shows a warning; delete it in the editor.
- A marked terminal that is running but has no pane (a sub-agent) opens with
  Herdr's peek instead.
- Each computer running the Herdr app keeps its own marks file, but marks can
  point at terminals on any connected machine.

## Setup

Requires the Herdr app (built and tested on 0.1.13).

1. Clone this repo as a mod folder:

   ```sh
   git clone https://github.com/edgarsgogolevs/herdr-harpoon ~/.config/herdr-app/mods/harpoon
   ```

   The folder must be named `harpoon`: the editor window opens the mod by
   that name.

2. Bind the key. Add this line to the `"global"` section of
   `~/.config/herdr-app/keys.json`:

   ```json
   "ctrl-space h": "mod.open:harpoon",
   ```

   Any other key works too; the popup handles the keys after it.

3. Check it loaded:

   ```sh
   herdr-app check ~/.config/herdr-app/mods/harpoon
   ```

Herdr reloads mods and keys live, so there's nothing to restart. To update,
`git pull` in the mod folder.

## Files

| File | |
|---|---|
| `main.js` | The popup, the editor window, marking and jumping |
| `vim.js` | The vim emulation: pure logic, no Herdr imports |
| `mod.json` | Opens the mod as a popup at the top of the window |
