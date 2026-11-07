// Harpoon: marks on terminals, on any machine, kept in a plain file.
//
// Opened as a popup with `mod.open:harpoon` (bound to `ctrl-space h`); the
// next key picks what to do:
//   h      edit the marks in a floating vim-like window (vim.js)
//   a      mark the focused terminal (does nothing if already marked)
//   1-9    go to that mark (selects its space and tab, focuses its pane)
//   esc    close
//   click  a mark to go to it
//
// Marks file: ~/.config/herdr-app/data/harpoon/marks.txt, one mark per line.
// The first word is the terminal address (`t7` here, `arch/t2` on machine
// "arch"); the rest of the line is a note for you and is ignored.
//
// The editor is drawn by this mod (props.role "editor"), no terminal: it
// opens at once and takes the keyboard itself. Esc saves and closes, :q! drops
// changes, Enter goes to the mark under the cursor.

import { View, div } from "gpui-kit";
import { Vim } from "./vim.js";
import { v_flex, h_flex } from "gpui-base";
import {
  appHome, exec, run, theme, settings, props, focused, panes, spaces, terminals,
  readTextFile, writeTextFile, openOverlay, closeOverlay, notify,
} from "herdr";

const DIR = () => `${appHome()}/data/harpoon`;
const FILE = () => `${DIR()}/marks.txt`;

function parse(text) {
  return (text ?? "")
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#"))
    .map((l) => l.split(/\s+/)[0]);
}

function where(addr) {
  const pane = panes().find((p) => p.terminal === addr);
  if (!pane) return null;
  const space = spaces().find((s) => s.tabs.some((t) => t.id === pane.tab));
  const tab = space?.tabs.find((t) => t.id === pane.tab);
  return { pane, space, tab };
}

function describe(addr) {
  const w = where(addr);
  if (!w) {
    const live = terminals().some((t) => t.address === addr && t.state === "live");
    return live ? "(no pane, will peek)" : "(gone)";
  }
  const machine = w.space?.machine ? `${w.space.machine}: ` : "";
  return `${machine}${w.space?.name ?? "?"} › ${w.tab?.name ?? "?"} · ${w.pane.program?.name ?? w.pane.title ?? ""}`;
}

async function ensureDir() {
  await exec("mkdir", ["-p", DIR()]);
}

// Show a marked terminal: its space, its tab, its pane (any machine).
function goTo(addr, label) {
  const w = where(addr);
  if (w) {
    if (w.space && !w.space.active) run("space.select", { id: w.space.id });
    if (w.tab && !w.tab.active) run("tab.select", { id: w.tab.id });
    run("pane.focus", { pane: w.pane.pane });
  } else if (terminals().some((t) => t.address === addr && t.state === "live")) {
    run("terminal.peek", { terminal: addr });
  } else {
    notify({ title: `Harpoon ${label}`, body: `${addr} is gone`, level: "warning", timeout: 2500 });
  }
}

// The popup: ctrl-space h, then a key.
class Menu {
  init(_props, cx) {
    this.handle = cx.focus_handle();
    this.marks = [];
    this.handle.focus();
    cx.timer.after(60, () => this.handle.focus());
    cx.spawn(async (cx) => {
      this.marks = parse(await readTextFile(FILE()));
      cx.notify();
    });
  }

  close() {
    closeOverlay(props().overlay);
  }

  add(cx) {
    const addr = focused()?.terminal;
    if (!addr) {
      notify({ title: "Harpoon", body: "No terminal focused", level: "warning", timeout: 2500 });
      return this.close();
    }
    cx.spawn(async (cx) => {
      try {
        const text = await readTextFile(FILE());
        if (!parse(text).includes(addr)) {
          await ensureDir();
          const base = text ?? "";
          const sep = base && !base.endsWith("\n") ? "\n" : "";
          await writeTextFile(FILE(), `${base}${sep}${addr}  ${describe(addr)}\n`, text);
          notify({ title: `Harpoon ${parse(text).length + 1}`, body: describe(addr), level: "success", timeout: 1800 });
        }
      } catch (e) {
        notify({ title: "Harpoon", body: String(e), level: "error" });
      }
      this.close();
    });
  }

  jump(n) {
    const addr = this.marks[n - 1];
    this.close();
    if (addr) goTo(addr, n);
  }

  edit(cx) {
    cx.spawn(async (cx) => {
      const text = await readTextFile(FILE());
      openOverlay({
        kind: "window",
        key: "harpoon-editor",
        width: 640,
        height: 340,
        mod: "harpoon",
        props: { role: "editor", text, pane: focused()?.pane ?? null },
      });
      this.close();
    });
  }

  render() {
    const t = theme();
    const key = (k) => div().px(5).rounded(4).bg(t.raised).text_color(t.foreground).child(k);
    return v_flex()
      .id("harpoon")
      .track_focus(this.handle)
      .w_full()
      .p(14)
      .gap(6)
      .bg(t.popover)
      .text_size(13)
      .on_key_down((e, cx) => {
        const k = e.key;
        if (k === "escape") this.close();
        else if (k === "h") this.edit(cx);
        else if (k === "a") this.add(cx);
        else if (/^[1-9]$/.test(k)) this.jump(Number(k));
        else return;
        cx.stop_propagation();
      })
      .child(
        h_flex().items_center().gap(6).text_size(11).text_color(t.dim)
          .child(div().flex_1().text_size(14).font_semibold().text_color(t.foreground).child("Harpoon"))
          .child(key("a")).child("add")
          .child(key("h")).child("edit")
          .child(key("1-9")).child("go"),
      )
      .when(this.marks.length === 0, (el) => el.child(div().py(6).text_color(t.dim).child("No marks yet. Press a to mark this terminal.")))
      .children(
        this.marks.slice(0, 9).map((addr, i) => {
          const here = focused()?.terminal === addr;
          return h_flex()
            .id(`hp-${i}`)
            .px(8)
            .py(4)
            .gap(10)
            .rounded(6)
            .items_center()
            .cursor_pointer()
            .hover((s) => s.bg(t.hover))
            .on_click(() => this.jump(i + 1))
            .child(div().w(14).text_color(t.accent).font_semibold().child(String(i + 1)))
            .child(div().w(70).flex_none().truncate().text_color(here ? t.accent : t.muted).child(addr))
            .child(div().flex_1().truncate().text_color(t.foreground).child(describe(addr)));
        }),
      );
  }
}

// Keys as vim.js names them: typed characters as themselves ("$", "V"),
// others by name ("escape", "enter", "space"), control chords as "ctrl-r".
function vimKey(e) {
  if (e.modifiers.control) return `ctrl-${e.key}`;
  const c = e.key_char;
  if (c && c.length === 1 && c !== " ") return c;
  return e.key;
}

const LINE = 20;

// The marks editor: a floating window this mod draws.
class Editor {
  init(_props, cx) {
    const p = props();
    this.expected = p.text ?? null;
    this.vim = new Vim(p.text ?? "");
    this.top = 0;
    this.rows = 12;
    this.handle = cx.focus_handle();
    this.handle.focus();
    cx.timer.after(60, () => this.handle.focus());
  }

  close(back = true) {
    const { overlay, pane } = props();
    closeOverlay(overlay);
    if (back && pane) run("pane.focus", { pane });
  }

  async save() {
    const text = this.vim.text();
    await ensureDir();
    await writeTextFile(FILE(), text, this.expected);
    this.expected = text;
    this.vim.dirty = false;
    this.vim.msg = `"marks.txt" ${parse(text).length} marks written`;
  }

  act(r, cx) {
    if (!r) return;
    cx.spawn(async (cx) => {
      try {
        if (r.action === "save") {
          await this.save();
          if (r.close) return this.close();
        } else if (r.action === "close") {
          if (this.vim.dirty && !r.discard) await this.save();
          return this.close();
        } else if (r.action === "jump") {
          const addr = parse(this.vim.lines[r.row])[0];
          if (!addr) return;
          if (this.vim.dirty) await this.save();
          this.close(false);
          goTo(addr, r.row + 1);
          return;
        }
      } catch (e) {
        this.vim.msg = `E: ${e}`;
      }
      cx.notify();
    });
  }

  render() {
    const t = theme();
    const v = this.vim;
    const mono = settings().font_family ?? "JetBrains Mono";
    if (v.row < this.top) this.top = v.row;
    if (v.row >= this.top + this.rows) this.top = v.row - this.rows + 1;
    this.top = Math.max(0, Math.min(this.top, Math.max(0, v.lines.length - this.rows)));
    const sel = v.selection();
    const cursorOn = v.mode !== "command";

    const line = (text, i) => {
      const here = i === v.row;
      const picked = sel && i >= sel[0] && i <= sel[1];
      const body = h_flex().flex_1().min_w(0).overflow_hidden().whitespace_nowrap();
      if (here && cursorOn) {
        const ch = text[v.col] ?? " ";
        body
          .child(div().child(text.slice(0, v.col)))
          .child(div().bg(t.foreground).text_color(t.background).child(ch === " " ? "\u00a0" : ch))
          .child(div().child(text.slice(v.col + 1)));
      } else body.child(div().child(text || "\u00a0"));
      return h_flex()
        .id(`ln-${i}`)
        .h(LINE)
        .flex_none()
        .px(8)
        .gap(10)
        .items_center()
        .when(Boolean(picked), (el) => el.bg(t.selection))
        .when(here && !picked, (el) => el.bg(t.hover))
        .child(div().w(22).flex_none().text_right().text_color(here ? t.accent : t.dim).child(String(i + 1)))
        .child(body.text_color(t.foreground));
    };

    const mode = v.mode === "visual" ? "-- VISUAL LINE --" : "";
    const left = v.mode === "command" ? `:${v.cmd}` : v.msg || mode;
    const bad = v.msg.startsWith("E");

    return v_flex()
      .id("hp-editor")
      .track_focus(this.handle)
      .size_full()
      .bg(t.popover)
      .text_size(13)
      .on_key_down((e, cx) => {
        this.act(v.key(vimKey(e)), cx);
        cx.stop_propagation();
        cx.notify();
      })
      .child(
        h_flex().h(30).flex_none().px(12).gap(8).items_center().border_b(1).border_color(t.border)
          .child(div().font_semibold().text_color(t.foreground).child("Harpoon marks"))
          .when(v.dirty, (el) => el.child(div().text_color(t.dim).child("[+]")))
          .child(div().flex_1())
          .child(div().text_size(11).text_color(t.dim).child("Enter go · :w save · Esc save & close · :q! drop")),
      )
      .child(
        v_flex()
          .id("hp-lines")
          .flex_1()
          .min_h(0)
          .py(4)
          .overflow_hidden()
          .font_family(mono)
          .on_size_change((size, cx) => {
            const rows = Math.max(1, Math.floor((size.height - 8) / LINE));
            if (rows !== this.rows) { this.rows = rows; cx.notify(); }
          })
          .children(v.lines.slice(this.top, this.top + this.rows).map((l, k) => line(l, this.top + k))),
      )
      .child(
        h_flex().h(24).flex_none().px(10).gap(8).items_center().border_t(1).border_color(t.border).font_family(mono).text_size(12)
          .child(
            h_flex().flex_1().min_w(0).items_center()
              .child(div().truncate().text_color(bad ? t.blocked : v.mode === "visual" ? t.accent : t.foreground).child(left))
              .when(v.mode === "command", (el) => el.child(div().flex_none().w(7).h(14).bg(t.foreground))),
          )
          .child(div().text_color(t.dim).child(`${v.pending}${v.count}`))
          .child(div().text_color(t.dim).child(`${v.row + 1},${v.col + 1}`)),
      );
  }
}

export default class Harpoon extends View {
  init(p, cx) {
    this.inner = props()?.role === "editor" ? new Editor() : new Menu();
    this.inner.init(p, cx);
  }
  render(cx) {
    return this.inner.render(cx);
  }
}
