// Harpoon: marks on terminals, on any machine, kept in a plain file.
//
// Opened as a popup with `mod.open:harpoon` (bound to `ctrl-space h`); the
// next key picks what to do:
//   h      edit the marks file in a floating nvim (move / delete lines)
//   a      mark the focused terminal (does nothing if already marked)
//   1-9    go to that mark (selects its space and tab, focuses its pane)
//   esc    close
//   click  a mark to go to it
//
// Marks file: ~/.config/herdr-app/data/harpoon/marks.txt, one mark per line.
// The first word is the terminal address (`t7` here, `arch/t2` on machine
// "arch"); the rest of the line is a note for you and is ignored.
//
// The editor is nvim with no config (`--clean`), started with `hc run` and
// shown with Herdr's own terminal.peek, which gives it the keyboard and
// closes when nvim exits.

import { View, div } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import {
  appHome, hc, exec, run, theme, props, focused, panes, spaces, terminals,
  readTextFile, writeTextFile, closeOverlay, notify,
} from "herdr";

const DIR = () => `${appHome()}/data/harpoon`;
const FILE = () => `${DIR()}/marks.txt`;
const NVIM = ["nvim", "--clean", "-n", "-i", "NONE", "+set number nowrap"];

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

export default class Harpoon extends View {
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

  async ensureDir() {
    await exec("mkdir", ["-p", DIR()]);
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
          await this.ensureDir();
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
    if (!addr) return;
    const w = where(addr);
    if (w) {
      if (w.space && !w.space.active) run("space.select", { id: w.space.id });
      if (w.tab && !w.tab.active) run("tab.select", { id: w.tab.id });
      run("pane.focus", { pane: w.pane.pane });
    } else if (terminals().some((t) => t.address === addr && t.state === "live")) {
      run("terminal.peek", { terminal: addr });
    } else {
      notify({ title: `Harpoon ${n}`, body: `${addr} is gone`, level: "warning", timeout: 2500 });
    }
  }

  edit(cx) {
    cx.spawn(async (cx) => {
      try {
        await this.ensureDir();
        const text = await readTextFile(FILE());
        if (text === null) await writeTextFile(FILE(), "", null);
        const r = await hc(["run", "--bg", "--json", "--rm", "--no-parent", "--cwd", DIR(), "--", ...NVIM, FILE()]);
        if (r.code !== 0) throw new Error(r.stderr || r.stdout);
        const terminal = JSON.parse(r.stdout).address;
        // Peek only knows terminals the app has already seen: wait for it.
        for (let i = 0; i < 40 && !terminals().some((t) => t.address === terminal && t.state === "live"); i++) await cx.sleep(50);
        this.close();
        run("terminal.peek", { terminal });
        return;
      } catch (e) {
        notify({ title: "Harpoon", body: `Couldn't open the editor: ${e}`, level: "error" });
      }
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
