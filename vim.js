// A tiny line-oriented vim for the marks file. No insert mode: marks are
// moved and deleted, not typed. Pure logic, no Herdr imports, so it can be
// tested with plain node.
//
// Normal:  h j k l, arrows, 0 ^ $, w b, gg G, {count}G, counts (3j, 2dd)
//          dd dj dk dG dgg, yy yj yk, p P, u, ctrl-r, V, :, ZZ ZQ, Enter
// Visual:  V, then motions; d / x delete, y yank, Esc / V cancel
// Command: :w :q :q! :wq :x :{line}
//
// key(k) returns null or an action for the host:
//   { action: "close", discard? }  { action: "save", close? }  { action: "jump", row }

export class Vim {
  constructor(text) {
    const body = (text ?? "").replace(/\n+$/, "");
    this.lines = body === "" ? [""] : body.split("\n");
    this.row = 0;
    this.col = 0;
    this.want = 0;
    this.mode = "normal"; // normal | visual | command
    this.anchor = 0;
    this.cmd = "";
    this.pending = "";
    this.count = "";
    this.opN = 1;
    this.reg = null;
    this.undos = [];
    this.redos = [];
    this.dirty = false;
    this.msg = "";
  }

  text() {
    const body = this.lines.join("\n").replace(/\n+$/, "");
    return body.trim() === "" ? "" : body + "\n";
  }

  last() {
    return this.lines.length - 1;
  }

  clamp() {
    this.row = Math.max(0, Math.min(this.row, this.last()));
    const len = this.lines[this.row].length;
    this.col = Math.max(0, Math.min(this.col, Math.max(0, len - 1)));
  }

  goRow(r) {
    this.row = r;
    this.col = this.want;
    this.clamp();
  }

  goCol(c) {
    this.col = c;
    this.clamp();
    this.want = c === Infinity ? Infinity : this.col;
  }

  firstNonBlank(r = this.row) {
    const m = this.lines[r].search(/\S/);
    return m < 0 ? 0 : m;
  }

  snapshot() {
    this.undos.push({ lines: [...this.lines], row: this.row, col: this.col, dirty: this.dirty });
    if (this.undos.length > 200) this.undos.shift();
    this.redos = [];
  }

  restore(from, to) {
    const s = from.pop();
    if (!s) return false;
    to.push({ lines: [...this.lines], row: this.row, col: this.col, dirty: this.dirty });
    this.lines = s.lines;
    this.row = s.row;
    this.col = s.col;
    this.dirty = true;
    this.clamp();
    return true;
  }

  // Linewise delete or yank of rows a..b (either order).
  lineOp(op, a, b) {
    const lo = Math.max(0, Math.min(a, b));
    const hi = Math.min(this.last(), Math.max(a, b));
    const n = hi - lo + 1;
    this.reg = this.lines.slice(lo, hi + 1);
    if (op === "d") {
      this.snapshot();
      this.lines.splice(lo, n);
      if (this.lines.length === 0) this.lines = [""];
      this.dirty = true;
      this.row = Math.min(lo, this.last());
      this.goCol(this.firstNonBlank());
      if (n > 2) this.msg = `${n} fewer lines`;
    } else {
      this.row = lo;
      this.clamp();
      if (n > 2) this.msg = `${n} lines yanked`;
    }
  }

  put(after, n) {
    if (!this.reg) return;
    this.snapshot();
    const block = [];
    for (let i = 0; i < n; i++) block.push(...this.reg);
    const empty = this.lines.length === 1 && this.lines[0] === "";
    if (empty) {
      this.lines = block;
      this.row = 0;
    } else {
      const at = after ? this.row + 1 : this.row;
      this.lines.splice(at, 0, ...block);
      this.row = at;
    }
    this.dirty = true;
    this.goCol(this.firstNonBlank());
    if (block.length > 2) this.msg = `${block.length} more lines`;
  }

  wordForward(n) {
    for (let i = 0; i < n; i++) {
      const line = this.lines[this.row];
      const rest = line.slice(this.col);
      const m = rest.match(/^\S*\s+/);
      if (m && this.col + m[0].length < line.length) this.col += m[0].length;
      else if (this.row < this.last()) {
        this.row++;
        this.col = this.firstNonBlank();
      } else this.col = Math.max(0, line.length - 1);
    }
    this.want = this.col;
  }

  wordBack(n) {
    for (let i = 0; i < n; i++) {
      const before = this.lines[this.row].slice(0, this.col);
      const m = before.match(/\S+\s*$/);
      if (m) this.col -= m[0].length;
      else if (this.row > 0) {
        this.row--;
        const prev = this.lines[this.row].match(/\S+\s*$/);
        this.col = prev ? prev.index : 0;
      }
    }
    this.want = this.col;
  }

  // Shared by normal and visual mode. True when k was a motion.
  motion(k, n, hadCount) {
    switch (k) {
      case "h": case "left": this.goCol(this.col - n); return true;
      case "l": case "right": case "space": this.goCol(this.col + n); return true;
      case "j": case "down": case "ctrl-n": this.goRow(this.row + n); return true;
      case "k": case "up": case "ctrl-p": this.goRow(this.row - n); return true;
      case "0": case "home": this.goCol(0); return true;
      case "^": this.goCol(this.firstNonBlank()); return true;
      case "$": case "end": this.goCol(Infinity); return true;
      case "w": this.wordForward(n); return true;
      case "b": this.wordBack(n); return true;
      case "G": this.goRow(hadCount ? n - 1 : this.last()); this.goCol(this.firstNonBlank()); return true;
      default: return false;
    }
  }

  runCommand() {
    const c = this.cmd.trim();
    this.mode = "normal";
    this.cmd = "";
    if (c === "") return null;
    if (/^\d+$/.test(c)) {
      this.goRow(Number(c) - 1);
      return null;
    }
    switch (c) {
      case "q":
        if (this.dirty) {
          this.msg = "E37: No write since last change (add ! to override)";
          return null;
        }
        return { action: "close" };
      case "q!": case "qa!": return { action: "close", discard: true };
      case "w": return { action: "save" };
      case "wq": case "wq!": case "x": case "x!": case "wqa": case "xa": return { action: "save", close: true };
      default:
        this.msg = `E492: Not an editor command: ${c}`;
        return null;
    }
  }

  key(k) {
    this.msg = "";

    if (this.mode === "command") {
      if (k === "escape" || k === "ctrl-c") { this.mode = "normal"; this.cmd = ""; }
      else if (k === "enter") return this.runCommand();
      else if (k === "backspace") {
        if (this.cmd === "") this.mode = "normal";
        else this.cmd = this.cmd.slice(0, -1);
      } else if (k === "space") this.cmd += " ";
      else if (k.length === 1) this.cmd += k;
      return null;
    }

    if (k === "escape" || k === "ctrl-c") {
      if (this.mode === "visual") { this.mode = "normal"; return null; }
      if (this.pending || this.count) { this.pending = ""; this.count = ""; return null; }
      return k === "escape" ? { action: "close" } : null;
    }

    if (/^[1-9]$/.test(k) || (k === "0" && this.count)) {
      this.count += k;
      return null;
    }
    const hadCount = this.count !== "";
    const n = hadCount ? Number(this.count) : 1;
    this.count = "";

    const op = this.pending;
    this.pending = "";

    if (op === "g" || op === "dg" || op === "yg") {
      if (k !== "g") return null;
      const target = hadCount ? n - 1 : 0;
      if (op === "g") { this.goRow(target); this.goCol(this.firstNonBlank()); }
      else this.lineOp(op[0], this.row, target);
      return null;
    }

    if (op === "Z") {
      if (k === "Z") return { action: "save", close: true };
      if (k === "Q") return { action: "close", discard: true };
      return null;
    }

    if (op === "d" || op === "y") {
      const m = this.opN * n;
      if (k === op) this.lineOp(op, this.row, this.row + m - 1);
      else if (k === "j" || k === "down") this.lineOp(op, this.row, this.row + m);
      else if (k === "k" || k === "up") this.lineOp(op, this.row, this.row - m);
      else if (k === "G") this.lineOp(op, this.row, hadCount ? n - 1 : this.last());
      else if (k === "g") this.pending = op + "g";
      return null;
    }

    if (this.mode === "visual") {
      if (this.motion(k, n, hadCount)) return null;
      if (k === "g") this.pending = "g";
      else if (k === "d" || k === "x" || k === "D" || k === "X") { this.lineOp("d", this.anchor, this.row); this.mode = "normal"; }
      else if (k === "y" || k === "Y") { this.lineOp("y", this.anchor, this.row); this.mode = "normal"; }
      else if (k === "V" || k === "v") this.mode = "normal";
      else if (k === "o") { const a = this.anchor; this.anchor = this.row; this.goRow(a); }
      else if (k === ":") { this.mode = "command"; this.cmd = ""; }
      return null;
    }

    if (this.motion(k, n, hadCount)) return null;
    switch (k) {
      case "g": case "Z": this.pending = k; break;
      case "d": case "y": this.pending = k; this.opN = n; break;
      case "Y": this.lineOp("y", this.row, this.row + n - 1); break;
      case "p": this.put(true, n); break;
      case "P": this.put(false, n); break;
      case "u": for (let i = 0; i < n; i++) if (!this.restore(this.undos, this.redos)) { this.msg = "Already at oldest change"; break; } break;
      case "ctrl-r": for (let i = 0; i < n; i++) if (!this.restore(this.redos, this.undos)) { this.msg = "Already at newest change"; break; } break;
      case "V": case "v": this.mode = "visual"; this.anchor = this.row; break;
      case ":": this.mode = "command"; this.cmd = ""; break;
      case "enter": return { action: "jump", row: this.row };
    }
    return null;
  }

  // Rows the visual selection covers, or null.
  selection() {
    if (this.mode !== "visual") return null;
    return [Math.min(this.anchor, this.row), Math.max(this.anchor, this.row)];
  }
}
