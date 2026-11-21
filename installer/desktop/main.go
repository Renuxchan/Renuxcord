/*
 * Renuxcord, a Vencord-based Discord client mod
 * Copyright (c) 2026 Larpbase
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Renuxcord Installer for macOS and Linux: a window like the Windows installer.
//
//	RenuxcordInstaller                           opens the installer
//	RenuxcordInstaller --cli status|install|uninstall [--location <Discord folder>]
//	                                             the same without a window (used by CI)
package main

import (
	"fmt"
	"os"
	"os/exec"
	"runtime"
)

const terminalCommand = "curl -fsSL https://github.com/" + repo + "/releases/download/devbuild/install.sh | sh"

func main() {
	if len(os.Args) > 1 && os.Args[1] == "--cli" {
		os.Exit(runCLI(os.Args[2:]))
	}
	defer func() {
		if r := recover(); r != nil {
			windowFailed(r)
			os.Exit(1)
		}
	}()
	runGUI()
}

// The window needs OpenGL. Without it (some virtual machines), say what to do instead of just vanishing
func windowFailed(reason any) {
	msg := "Renuxcord Installer couldn't open its window on this computer (" + fmt.Sprint(reason) + ").\n\n" +
		"You can install Renuxcord from a terminal instead:\n" + terminalCommand
	fmt.Fprintln(os.Stderr, msg)
	if runtime.GOOS == "darwin" {
		script := fmt.Sprintf("display dialog %q with title %q buttons {\"OK\"} default button 1 with icon caution", msg, "Renuxcord Installer")
		exec.Command("osascript", "-e", script).Run()
		return
	}
	for _, tool := range [][]string{
		{"zenity", "--error", "--title=Renuxcord Installer", "--text=" + msg},
		{"kdialog", "--title", "Renuxcord Installer", "--error", msg},
	} {
		if _, err := exec.LookPath(tool[0]); err == nil {
			exec.Command(tool[0], tool[1:]...).Run()
			return
		}
	}
}

func runCLI(args []string) int {
	command := "status"
	location := ""
	for i := 0; i < len(args); i++ {
		switch args[i] {
		case "status", "install", "uninstall":
			command = args[i]
		case "--location":
			if i+1 < len(args) {
				location = args[i+1]
				i++
			}
		default:
			fmt.Fprintln(os.Stderr, "Usage: RenuxcordInstaller --cli [status|install|uninstall] [--location <Discord folder>]")
			return 2
		}
	}

	installs := FindInstalls()
	if location != "" {
		in, err := CustomInstall(location)
		if err != nil {
			fmt.Fprintln(os.Stderr, "Error:", err)
			return 1
		}
		installs = []Install{in}
	}
	if len(installs) == 0 {
		if NeedsFirstStart() {
			fmt.Fprintln(os.Stderr, "Discord hasn't finished installing itself yet. Open it once, then run this again")
		} else {
			fmt.Fprintln(os.Stderr, "No Discord install found")
		}
		if command == "status" {
			return 0
		}
		return 1
	}

	log := func(s string) { fmt.Println("  " + s) }
	failed := false
	for _, in := range installs {
		fmt.Printf("%s: %s\n", in.Flavor, in.Resources)
		var err error
		switch command {
		case "status":
			log(StatusText(in.Resources) + ", data folder " + DataDirFor(in.Resources))
		case "install":
			err = Patch(in, log)
		case "uninstall":
			err = Unpatch(in, log)
		}
		if err != nil {
			fmt.Fprintln(os.Stderr, "  Error:", err)
			failed = true
		}
	}
	if failed {
		return 1
	}
	return 0
}
