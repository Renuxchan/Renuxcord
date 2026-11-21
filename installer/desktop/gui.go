/*
 * Renuxcord, a Vencord-based Discord client mod
 * Copyright (c) 2026 Larpbase
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

package main

import (
	_ "embed"
	"image/color"
	"strings"

	"fyne.io/fyne/v2"
	"fyne.io/fyne/v2/app"
	"fyne.io/fyne/v2/canvas"
	"fyne.io/fyne/v2/container"
	"fyne.io/fyne/v2/dialog"
	"fyne.io/fyne/v2/layout"
	"fyne.io/fyne/v2/theme"
	"fyne.io/fyne/v2/widget"
)

//go:embed icon.png
var iconPNG []byte

// The website's colours
var (
	colBg      = color.NRGBA{0x0c, 0x0c, 0x0d, 0xff}
	colSurface = color.NRGBA{0x17, 0x17, 0x1a, 0xff}
	colRaised  = color.NRGBA{0x22, 0x22, 0x26, 0xff}
	colLine    = color.NRGBA{0x2c, 0x2c, 0x31, 0xff}
	colText    = color.NRGBA{0xf2, 0xf0, 0xeb, 0xff}
	colMuted   = color.NRGBA{0x9a, 0x97, 0x8f, 0xff}
	colAccent  = color.NRGBA{0xff, 0x5a, 0x2c, 0xff}
)

type rxTheme struct{}

func (rxTheme) Color(name fyne.ThemeColorName, _ fyne.ThemeVariant) color.Color {
	switch name {
	case theme.ColorNameBackground:
		return colBg
	case theme.ColorNameButton, theme.ColorNameInputBackground, theme.ColorNameMenuBackground, theme.ColorNameOverlayBackground:
		return colSurface
	case theme.ColorNameHover, theme.ColorNamePressed:
		return colRaised
	case theme.ColorNamePrimary, theme.ColorNameFocus, theme.ColorNameSelection:
		return colAccent
	case theme.ColorNameForegroundOnPrimary:
		return colBg
	case theme.ColorNameForeground:
		return colText
	case theme.ColorNamePlaceHolder, theme.ColorNameDisabled:
		return colMuted
	case theme.ColorNameSeparator, theme.ColorNameInputBorder:
		return colLine
	}
	return theme.DefaultTheme().Color(name, theme.VariantDark)
}

func (rxTheme) Font(s fyne.TextStyle) fyne.Resource     { return theme.DefaultTheme().Font(s) }
func (rxTheme) Icon(n fyne.ThemeIconName) fyne.Resource { return theme.DefaultTheme().Icon(n) }
func (rxTheme) Size(n fyne.ThemeSizeName) float32       { return theme.DefaultTheme().Size(n) }

func text(s string, size float32, c color.Color, bold bool) *canvas.Text {
	t := canvas.NewText(s, c)
	t.TextSize = size
	t.TextStyle = fyne.TextStyle{Bold: bold}
	return t
}

func runGUI() {
	a := app.NewWithID("dev.renuxcord.installer")
	a.Settings().SetTheme(rxTheme{})
	icon := fyne.NewStaticResource("icon.png", iconPNG)
	a.SetIcon(icon)

	w := a.NewWindow("Renuxcord Installer")
	w.SetIcon(icon)

	logo := canvas.NewImageFromResource(icon)
	logo.FillMode = canvas.ImageFillContain
	logo.SetMinSize(fyne.NewSize(60, 60))
	header := container.NewHBox(
		logo,
		container.NewVBox(
			layout.NewSpacer(),
			text("Renuxcord", 30, colText, true),
			text("217 plugins, Renuxcord exclusives, the AI bridge and auto-updates", 13, colMuted, false),
			layout.NewSpacer(),
		),
	)

	installs := FindInstalls()
	status := widget.NewLabel("")
	status.Importance = widget.LowImportance

	logText := widget.NewLabel("")
	logText.TextStyle = fyne.TextStyle{Monospace: true}
	logText.Wrapping = fyne.TextWrapWord
	logScroll := container.NewVScroll(logText)
	logScroll.SetMinSize(fyne.NewSize(584, 190))
	logBox := container.NewStack(canvas.NewRectangle(colSurface), container.NewPadded(logScroll))

	appendLog := func(line string) {
		fyne.Do(func() {
			logText.SetText(strings.TrimPrefix(logText.Text+"\n"+line, "\n"))
			logScroll.ScrollToBottom()
		})
	}

	bar := widget.NewProgressBarInfinite()
	bar.Hide()

	picker := widget.NewSelect(nil, nil)
	picker.PlaceHolder = "No Discord found"
	installButton := widget.NewButton("Install / Repair", nil)
	installButton.Importance = widget.HighImportance
	uninstallButton := widget.NewButton("Uninstall", nil)
	folderButton := widget.NewButton("Open Renuxcord folder", nil)
	otherButton := widget.NewButton("Other Discord folder…", nil)

	current := func() (Install, bool) {
		i := picker.SelectedIndex()
		if i < 0 || i >= len(installs) {
			return Install{}, false
		}
		return installs[i], true
	}

	updateStatus := func() {
		in, ok := current()
		if !ok {
			if NeedsFirstStart() {
				status.SetText("Open Discord once so it finishes installing, then press Look again")
			} else {
				status.SetText("Discord isn't installed")
			}
			installButton.Disable()
			uninstallButton.Disable()
			return
		}
		status.SetText(StatusText(in.Resources))
		installButton.Enable()
		if s, _ := StateOf(in.Resources); s == Patched {
			uninstallButton.Enable()
		} else {
			uninstallButton.Disable()
		}
	}

	// Changing the options fires OnChanged, which must not change them again
	reloading := false
	reloadPicker := func(selectIndex int) {
		reloading = true
		labels := make([]string, len(installs))
		for i, in := range installs {
			labels[i] = in.Label()
		}
		picker.SetOptions(labels)
		if selectIndex >= len(labels) || selectIndex < 0 {
			selectIndex = 0
		}
		if len(labels) > 0 {
			picker.SetSelectedIndex(selectIndex)
		} else {
			picker.ClearSelected()
		}
		reloading = false
		updateStatus()
	}
	picker.OnChanged = func(string) {
		if !reloading {
			updateStatus()
		}
	}

	busy := func(on bool) {
		for _, b := range []*widget.Button{installButton, uninstallButton, otherButton} {
			if on {
				b.Disable()
			} else {
				b.Enable()
			}
		}
		if on {
			picker.Disable()
			bar.Show()
			bar.Start()
		} else {
			picker.Enable()
			bar.Stop()
			bar.Hide()
			updateStatus()
		}
	}

	run := func(install bool) {
		in, ok := current()
		if !ok {
			return
		}
		busy(true)
		go func() {
			wasRunning := IsRunning(in)
			if wasRunning {
				appendLog("Closing Discord")
				Quit(in)
			}

			var err error
			if install {
				err = Patch(in, appendLog)
			} else {
				err = Unpatch(in, appendLog)
			}

			if err == nil || wasRunning {
				appendLog("Starting Discord")
				if startErr := Start(in); startErr != nil {
					appendLog(startErr.Error())
				}
			}

			fyne.Do(func() {
				busy(false)
				if err != nil {
					appendLog("Error: " + err.Error())
					dialog.ShowError(err, w)
				} else if install {
					appendLog("Done. Renuxcord is in Discord: Settings › Renuxcord")
				} else {
					appendLog("Done. Discord is back to normal. Your settings stay in " + DataDirFor(in.Resources))
				}
			})
		}()
	}

	installButton.OnTapped = func() { run(true) }
	uninstallButton.OnTapped = func() { run(false) }
	folderButton.OnTapped = func() {
		dir := DataDirFor("")
		if in, ok := current(); ok {
			dir = DataDirFor(in.Resources)
		}
		if err := OpenFolder(dir); err != nil {
			dialog.ShowError(err, w)
		}
	}
	otherButton.OnTapped = func() {
		dialog.ShowFolderOpen(func(uri fyne.ListableURI, err error) {
			if err != nil || uri == nil {
				return
			}
			in, err := CustomInstall(uri.Path())
			if err != nil {
				dialog.ShowError(err, w)
				return
			}
			installs = append(installs, in)
			reloadPicker(len(installs) - 1)
		}, w)
	}
	lookAgain := widget.NewButton("Look again", func() {
		installs = FindInstalls()
		reloadPicker(0)
	})

	reloadPicker(0)
	if len(installs) > 0 {
		appendLog("Ready to install the newest Renuxcord from github.com/" + repo)
	} else {
		appendLog("No Discord found. Install Discord, or pick its folder with Other Discord folder…")
	}

	body := container.NewVBox(
		header,
		widget.NewSeparator(),
		text("DISCORD INSTALL", 11, colMuted, true),
		container.NewBorder(nil, nil, nil, container.NewHBox(lookAgain, otherButton), picker),
		status,
		container.NewGridWithColumns(3, installButton, uninstallButton, folderButton),
		bar,
		logBox,
		text("Free and open source (GPL-3.0). github.com/"+repo, 11, colMuted, false),
	)

	w.SetContent(container.NewStack(canvas.NewRectangle(colBg), container.NewPadded(container.NewPadded(body))))
	w.Resize(fyne.NewSize(680, 560))
	w.SetFixedSize(true)
	w.CenterOnScreen()
	w.ShowAndRun()
}
