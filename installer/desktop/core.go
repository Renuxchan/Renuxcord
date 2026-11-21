/*
 * Renuxcord, a Vencord-based Discord client mod
 * Copyright (c) 2026 Larpbase
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// The installer's logic for macOS and Linux. It does the same as scripts/renuxcord/install.sh: download Renuxcord
// into its data folder, rename Discord's app.asar to _app.asar and put a tiny app.asar in its place that loads
// Renuxcord, which then loads Discord's own code.
package main

import (
	"bytes"
	"encoding/binary"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"runtime"
	"sort"
	"strconv"
	"strings"
	"time"
)

const repo = "Renuxchan/Renuxcord"

var (
	requiredFiles = []string{"patcher.js", "preload.js", "renderer.js", "renderer.css"}
	optionalFiles = []string{"renuxcord-mcp.mjs"}
	requireRe     = regexp.MustCompile(`require\("([^"]*)"\)`)
	flatpakRe     = regexp.MustCompile(`/flatpak/app/([^/]+)/`)
	appVersionRe  = regexp.MustCompile(`app-(\d+(?:\.\d+)*)`)
)

// Where the release files come from. RENUXCORD_RELEASE_URL (also file://) lets CI test a local build
func releaseURL() string {
	if u := os.Getenv("RENUXCORD_RELEASE_URL"); u != "" {
		return strings.TrimSuffix(u, "/")
	}
	return "https://github.com/" + repo + "/releases/download/devbuild"
}

// Install is one Discord on this computer
type Install struct {
	Flavor    string // Stable, PTB, Canary or Custom
	Resources string // the folder holding app.asar
	Process   string // Discord's process name, for closing and reopening it
	Command   string // how to start it again (an app bundle on macOS, a command or binary on Linux)
}

func (in Install) Label() string {
	where := in.Resources
	if h := home(); h != "" && strings.HasPrefix(where, h) {
		where = "~" + strings.TrimPrefix(where, h)
	}
	if runtime.GOOS == "darwin" {
		where = strings.TrimSuffix(where, "/Contents/Resources")
	} else {
		where = strings.TrimSuffix(where, "/resources")
	}
	return in.Flavor + "  ·  " + where
}

type flavor struct {
	name, macApp, process, homeDir, flatpak, command string
	linuxDirs                                        []string
}

var flavors = []flavor{
	{"Stable", "Discord.app", "Discord", "discord", "com.discordapp.Discord", "discord", []string{"discord", "Discord"}},
	{"PTB", "Discord PTB.app", "DiscordPTB", "discordptb", "", "discord-ptb", []string{"discord-ptb", "DiscordPTB"}},
	{"Canary", "Discord Canary.app", "DiscordCanary", "discordcanary", "com.discordapp.DiscordCanary", "discord-canary", []string{"discord-canary", "DiscordCanary"}},
}

func home() string {
	h, _ := os.UserHomeDir()
	return h
}

func configHome() string {
	if x := os.Getenv("XDG_CONFIG_HOME"); x != "" {
		return x
	}
	return filepath.Join(home(), ".config")
}

func isFile(p string) bool {
	st, err := os.Stat(p)
	return err == nil && !st.IsDir()
}

// app-1.0.99 sorts before app-1.0.170
func versionLess(a, b string) bool {
	pa, pb := appVersionRe.FindStringSubmatch(a), appVersionRe.FindStringSubmatch(b)
	if pa == nil || pb == nil {
		return a < b
	}
	x, y := strings.Split(pa[1], "."), strings.Split(pb[1], ".")
	for i := 0; i < len(x) || i < len(y); i++ {
		var u, v int
		if i < len(x) {
			u, _ = strconv.Atoi(x[i])
		}
		if i < len(y) {
			v, _ = strconv.Atoi(y[i])
		}
		if u != v {
			return u < v
		}
	}
	return false
}

func candidates(f flavor) []Install {
	var out []Install
	add := func(res, command string) { out = append(out, Install{f.name, res, f.process, command}) }

	if runtime.GOOS == "darwin" {
		for _, base := range []string{"/Applications", filepath.Join(home(), "Applications")} {
			bundle := filepath.Join(base, f.macApp)
			add(filepath.Join(bundle, "Contents", "Resources"), bundle)
		}
		return out
	}

	// Discord 1.0 for Linux installs itself into ~/.config/<dir>/app-<version> on first start, like Windows does.
	// Newest first, so the list shows the version that actually runs
	apps, _ := filepath.Glob(filepath.Join(configHome(), f.homeDir, "app-*", "resources"))
	sort.Slice(apps, func(i, j int) bool { return versionLess(apps[j], apps[i]) })
	for _, res := range apps {
		add(res, f.command)
	}

	// Older packages (and some distros' own) keep the whole app under /usr/share, /opt and so on
	for _, dir := range f.linuxDirs {
		for _, base := range []string{"/usr/share", "/usr/lib", "/usr/lib64", "/opt", filepath.Join(home(), ".local/share"), home()} {
			add(filepath.Join(base, dir, "resources"), f.command)
		}
	}
	if f.flatpak != "" {
		for _, base := range []string{"/var/lib/flatpak/app", filepath.Join(home(), ".local/share/flatpak/app")} {
			add(filepath.Join(base, f.flatpak, "current/active/files/discord/resources"), "flatpak run "+f.flatpak)
		}
	}
	return out
}

// FindInstalls lists every Discord this installer can patch
func FindInstalls() []Install {
	seen := map[string]bool{}
	var out []Install
	for _, f := range flavors {
		for _, in := range candidates(f) {
			if !isFile(filepath.Join(in.Resources, "app.asar")) {
				continue
			}
			if real, err := filepath.EvalSymlinks(in.Resources); err == nil {
				in.Resources = real
			}
			if seen[in.Resources] {
				continue
			}
			seen[in.Resources] = true
			out = append(out, in)
		}
	}
	return out
}

// CustomInstall turns a folder the user picked (Discord's folder, its resources folder or a .app) into an Install
func CustomInstall(dir string) (Install, error) {
	for _, res := range []string{dir, filepath.Join(dir, "resources"), filepath.Join(dir, "Contents", "Resources")} {
		if isFile(filepath.Join(res, "app.asar")) {
			return Install{Flavor: "Custom", Resources: res, Process: "Discord", Command: ""}, nil
		}
	}
	return Install{}, errors.New("there's no app.asar in that folder. Pick Discord's own folder or its resources folder")
}

// Linux: the deb/rpm/tar.gz is only a launcher until Discord has started once
func NeedsFirstStart() bool {
	if runtime.GOOS != "linux" {
		return false
	}
	_, err := exec.LookPath("discord")
	return err == nil
}

// DataDirFor is the folder Discord's Renuxcord reads its files and settings from
func DataDirFor(resources string) string {
	if d := os.Getenv("RENUXCORD_USER_DATA_DIR"); d != "" {
		return d
	}
	if m := flatpakRe.FindStringSubmatch(resources + "/"); m != nil {
		// Flatpak Discord only sees its own config folder
		return filepath.Join(home(), ".var/app", m[1], "config/Renuxcord")
	}
	if runtime.GOOS == "darwin" {
		return filepath.Join(home(), "Library/Application Support/Renuxcord")
	}
	return filepath.Join(configHome(), "Renuxcord")
}

type State int

const (
	Vanilla State = iota
	Patched
	OtherMod
)

// StateOf says whether Discord in that folder loads Renuxcord, another mod, or nothing
func StateOf(resources string) (State, string) {
	app := filepath.Join(resources, "app.asar")
	if isFile(filepath.Join(resources, "_app.asar")) {
		if st, err := os.Stat(app); err == nil && st.Size() < 4096 {
			b, _ := os.ReadFile(app)
			if bytes.Contains(b, []byte("Renuxcord")) {
				target := ""
				if m := requireRe.FindSubmatch(b); m != nil {
					target = string(m[1])
				}
				return Patched, target
			}
		}
		return OtherMod, "Another client mod (probably Vencord) is installed here"
	}
	if isFile(filepath.Join(resources, "app", "index.js")) {
		return OtherMod, "Another client mod is installed here (it has an app folder)"
	}
	return Vanilla, ""
}

func StatusText(resources string) string {
	switch s, msg := StateOf(resources); s {
	case Patched:
		return "Renuxcord is installed"
	case OtherMod:
		return msg
	default:
		return "Renuxcord isn't installed"
	}
}

// StubAsar is the tiny app.asar that loads Renuxcord. Same format install.mjs and install.sh write
func StubAsar(patcher string) []byte {
	path, _ := json.Marshal(patcher)
	index := []byte("require(" + string(path) + "); // Renuxcord")
	pkg := []byte(`{"name":"discord","main":"index.js"}`)
	header := []byte(fmt.Sprintf(`{"files":{"index.js":{"size":%d,"offset":"0"},"package.json":{"size":%d,"offset":"%d"}}}`, len(index), len(pkg), len(index)))
	padded := (len(header) + 3) / 4 * 4

	out := make([]byte, 16+padded+len(index)+len(pkg))
	binary.LittleEndian.PutUint32(out[0:], 4)
	binary.LittleEndian.PutUint32(out[4:], uint32(8+padded))
	binary.LittleEndian.PutUint32(out[8:], uint32(4+padded))
	binary.LittleEndian.PutUint32(out[12:], uint32(len(header)))
	copy(out[16:], header)
	copy(out[16+padded:], index)
	copy(out[16+padded+len(index):], pkg)
	return out
}

func fetch(url string) ([]byte, error) {
	if strings.HasPrefix(url, "file://") {
		return os.ReadFile(strings.TrimPrefix(url, "file://"))
	}
	req, err := http.NewRequest("GET", url, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("User-Agent", "RenuxcordInstaller")
	resp, err := (&http.Client{Timeout: 3 * time.Minute}).Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("HTTP %d", resp.StatusCode)
	}
	return io.ReadAll(resp.Body)
}

// Download puts the newest Renuxcord into data/dist. Files are swapped in only once all of them arrived
func Download(data string, log func(string)) error {
	dist := filepath.Join(data, "dist")
	if err := os.MkdirAll(dist, 0o755); err != nil {
		return err
	}
	log("Downloading Renuxcord into " + dist)

	var got []string
	for _, name := range append(append([]string{}, requiredFiles...), optionalFiles...) {
		b, err := fetch(releaseURL() + "/" + name)
		if err != nil {
			if contains(requiredFiles, name) {
				return fmt.Errorf("couldn't download %s: %w", name, err)
			}
			continue
		}
		if err := os.WriteFile(filepath.Join(dist, name+".download"), b, 0o644); err != nil {
			return err
		}
		got = append(got, name)
	}
	for _, name := range got {
		if err := os.Rename(filepath.Join(dist, name+".download"), filepath.Join(dist, name)); err != nil {
			return err
		}
	}
	// Keeps a package.json further up (with "type": "module") from changing how these files load
	return os.WriteFile(filepath.Join(dist, "package.json"), []byte("{}"), 0o644)
}

func contains(list []string, s string) bool {
	for _, x := range list {
		if x == s {
			return true
		}
	}
	return false
}

func writable(dir string) bool {
	f, err := os.CreateTemp(dir, ".renuxcord-check-*")
	if err != nil {
		return false
	}
	name := f.Name()
	f.Close()
	os.Remove(name)
	return true
}

func shellQuote(s string) string {
	return "'" + strings.ReplaceAll(s, "'", `'\''`) + "'"
}

// runAsAdmin runs a shell script with admin rights: the password prompt on macOS, polkit on Linux
func runAsAdmin(script string) error {
	var cmd *exec.Cmd
	switch {
	case runtime.GOOS == "darwin":
		escaped := strings.NewReplacer(`\`, `\\`, `"`, `\"`).Replace(script)
		cmd = exec.Command("osascript", "-e", `do shell script "`+escaped+`" with administrator privileges`)
	default:
		pkexec, err := exec.LookPath("pkexec")
		if err != nil {
			return errors.New("this Discord folder needs admin rights and pkexec isn't installed. Run install.sh in a terminal instead")
		}
		cmd = exec.Command(pkexec, "/bin/sh", "-c", script)
	}
	out, err := cmd.CombinedOutput()
	if err != nil {
		return fmt.Errorf("%v %s", err, strings.TrimSpace(string(out)))
	}
	return nil
}

func explain(err error) error {
	if err == nil {
		return nil
	}
	if runtime.GOOS == "darwin" && (errors.Is(err, os.ErrPermission) || strings.Contains(err.Error(), "not permitted")) {
		return errors.New("macOS blocked changes to Discord. Open System Settings › Privacy & Security › App Management, " +
			"turn on Renuxcord Installer, then try again")
	}
	return err
}

// Patch installs (or repairs) Renuxcord into one Discord
func Patch(in Install, log func(string)) error {
	if s, msg := StateOf(in.Resources); s == OtherMod {
		return errors.New(msg + ". Uninstall it first")
	}

	data := DataDirFor(in.Resources)
	if err := Download(data, log); err != nil {
		return err
	}

	stub := StubAsar(filepath.Join(data, "dist", "patcher.js"))
	app := filepath.Join(in.Resources, "app.asar")
	backup := filepath.Join(in.Resources, "_app.asar")

	if writable(in.Resources) {
		if !isFile(backup) {
			if err := os.Rename(app, backup); err != nil {
				return explain(err)
			}
		}
		if err := os.WriteFile(app, stub, 0o644); err != nil {
			// Never leave Discord without an app.asar
			if !isFile(app) {
				os.Rename(backup, app)
			}
			return explain(err)
		}
	} else {
		log("This Discord folder belongs to the system, asking for your password")
		tmp, err := os.CreateTemp("", "renuxcord-*.asar")
		if err != nil {
			return err
		}
		defer os.Remove(tmp.Name())
		if _, err := tmp.Write(stub); err != nil {
			return err
		}
		tmp.Close()

		script := ""
		if !isFile(backup) {
			script = "mv " + shellQuote(app) + " " + shellQuote(backup) + " && "
		}
		script += "cp " + shellQuote(tmp.Name()) + " " + shellQuote(app) + " && chmod 644 " + shellQuote(app)
		if err := runAsAdmin(script); err != nil {
			return explain(err)
		}
	}

	log("Discord in " + in.Resources + " now loads Renuxcord")
	return nil
}

// Unpatch puts Discord's own app.asar back
func Unpatch(in Install, log func(string)) error {
	if s, _ := StateOf(in.Resources); s != Patched {
		log("Renuxcord isn't installed in " + in.Resources)
		return nil
	}
	app := filepath.Join(in.Resources, "app.asar")
	backup := filepath.Join(in.Resources, "_app.asar")
	if writable(in.Resources) {
		if err := os.Rename(backup, app); err != nil {
			return explain(err)
		}
	} else if err := runAsAdmin("mv -f " + shellQuote(backup) + " " + shellQuote(app)); err != nil {
		return explain(err)
	}
	log("Restored Discord's own app.asar in " + in.Resources)
	return nil
}

// ---- Discord itself ----

func IsRunning(in Install) bool {
	return exec.Command("pgrep", "-x", in.Process).Run() == nil
}

// Quit closes Discord and waits for it, so it starts fresh with the new files
func Quit(in Install) {
	if runtime.GOOS == "darwin" {
		app := strings.TrimSuffix(filepath.Base(in.Command), ".app")
		exec.Command("osascript", "-e", `quit app "`+app+`"`).Run()
	} else {
		exec.Command("pkill", "-x", in.Process).Run()
	}
	for i := 0; i < 50 && IsRunning(in); i++ {
		time.Sleep(100 * time.Millisecond)
	}
	if IsRunning(in) {
		exec.Command("pkill", "-9", "-x", in.Process).Run()
		time.Sleep(500 * time.Millisecond)
	}
}

func Start(in Install) error {
	var cmd *exec.Cmd
	switch {
	case runtime.GOOS == "darwin" && in.Command != "":
		cmd = exec.Command("open", in.Command)
	case strings.HasPrefix(in.Command, "flatpak run "):
		cmd = exec.Command("flatpak", "run", strings.TrimPrefix(in.Command, "flatpak run "))
	case in.Command != "":
		if path, err := exec.LookPath(in.Command); err == nil {
			cmd = exec.Command(path)
			break
		}
		fallthrough
	default:
		bin := filepath.Join(filepath.Dir(in.Resources), in.Process)
		if !isFile(bin) {
			return errors.New("open Discord again yourself")
		}
		cmd = exec.Command(bin)
	}
	cmd.Stdout, cmd.Stderr = nil, nil
	return cmd.Start()
}

// OpenFolder shows a folder in Finder or the file manager
func OpenFolder(dir string) error {
	os.MkdirAll(dir, 0o755)
	if runtime.GOOS == "darwin" {
		return exec.Command("open", dir).Start()
	}
	return exec.Command("xdg-open", dir).Start()
}
